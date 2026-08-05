import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const origin = 'https://otakudataviz.com';
const projects = [
  {
    name: 'Dragon Ball Sociogram',
    landing: '/projects/dragon-ball-sociogram.html',
    app: '/dragonball-character-sociogram/',
    appAliases: ['/dragonball-character-sociogram/', '/dragonball-character-sociogram/index.html']
  },
  {
    name: 'Manga and Anime Timeline',
    landing: '/projects/manga-anime-timeline.html',
    app: '/manga-timeline.html'
  },
  {
    name: 'Pokedex Type Treemap',
    landing: '/projects/pokedex-type-treemap.html',
    app: '/pokemon_territory_map.html'
  },
  {
    name: 'Nintendo Game Universe Map',
    landing: '/projects/nintendo-game-universe-map.html',
    app: '/nintendo-game-universe-map.html'
  },
  {
    name: 'Gundam Universe Map',
    landing: '/projects/gundam-universe-map.html',
    app: '/gundam-universe-map.html'
  }
];

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const siteFile = (urlPath, base = root) => {
  const pathname = decodeURIComponent(urlPath).replace(/^\//, '');
  if (!pathname) return path.join(base, 'index.html');
  if (pathname.endsWith('/')) return path.join(base, pathname, 'index.html');
  return path.join(base, pathname);
};
const readSiteFile = (urlPath, base = root) => readFile(siteFile(urlPath, base), 'utf8');
const appPaths = (project) => project.appAliases || [project.app];
const matchesApp = (pathname, project) => appPaths(project).includes(pathname);
const parseJsonLd = (html, label) => {
  const blocks = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  check(blocks.length > 0, `${label}: no JSON-LD block found`);
  for (const block of blocks) {
    try {
      JSON.parse(block[1]);
    } catch (error) {
      failures.push(`${label}: invalid JSON-LD (${error.message})`);
    }
  }
};

for (const project of projects) {
  const landingHtml = await readSiteFile(project.landing);
  const appHtml = await readSiteFile(project.app);
  const canonical = `${origin}${project.landing}`;
  const appUrl = `${origin}${project.app}`;

  parseJsonLd(landingHtml, `${project.name} landing`);
  parseJsonLd(appHtml, `${project.name} interactive`);

  for (const [surface, html] of [['landing', landingHtml], ['interactive', appHtml]]) {
    check(
      html.includes(`<link rel="canonical" href="${canonical}"`),
      `${project.name}: ${surface} canonical is not ${canonical}`
    );
    check(
      html.includes(`<meta property="og:url" content="${canonical}"`),
      `${project.name}: ${surface} og:url is not ${canonical}`
    );
  }

  check(
    landingHtml.includes(`"url": "${canonical}"`),
    `${project.name}: landing JSON-LD does not use the canonical landing URL`
  );
  check(
    appHtml.includes(`"url": "${appUrl}"`),
    `${project.name}: interactive JSON-LD does not identify its app URL`
  );
  check(
    appHtml.includes(`"mainEntityOfPage": "${canonical}"`),
    `${project.name}: interactive JSON-LD does not point to its landing page`
  );
  check(
    appHtml.includes("const isAnalyticsPreview = new URLSearchParams(window.location.search).get('preview') === '1';")
      && appHtml.includes("gtag('config', 'G-653DY2M8K5', { send_page_view: !isAnalyticsPreview });"),
    `${project.name}: preview iframe pageviews are not disabled`
  );

  const linkMatches = [...landingHtml.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*data-event="open_interactive_visualization"/g)]
    .map((match) => new URL(match[1], `${origin}${project.landing}`).pathname);
  check(linkMatches.length > 0, `${project.name}: no Open Interactive Visualization links found`);
  check(
    linkMatches.every((pathname) => matchesApp(pathname, project)),
    `${project.name}: an interactive button does not target ${project.app}`
  );

  const previewMatches = [...landingHtml.matchAll(/<iframe\b[^>]*src="([^"]+)"/g)]
    .map((match) => new URL(match[1].replace(/&amp;/g, '&'), `${origin}${project.landing}`));
  check(
    previewMatches.some((url) => matchesApp(url.pathname, project) && url.searchParams.get('preview') === '1'),
    `${project.name}: landing preview iframe does not target the interactive page with preview=1`
  );

  const relatedLinks = [...landingHtml.matchAll(/<a\b[^>]*class="related-card"[^>]*href="([^"]+)"/g)]
    .map((match) => new URL(match[1], `${origin}${project.landing}`).pathname);
  check(
    relatedLinks.every((pathname) => pathname === '/index.html' || projects.some((item) => item.landing === pathname)),
    `${project.name}: a related-project card bypasses a canonical landing page`
  );
}

const sitemap = await readFile(path.join(root, 'docs/sitemap.xml'), 'utf8');
for (const project of projects) {
  check(sitemap.includes(`<loc>${origin}${project.landing}</loc>`), `${project.name}: canonical landing missing from sitemap`);
  for (const appPath of appPaths(project)) {
    check(!sitemap.includes(`<loc>${origin}${appPath}</loc>`), `${project.name}: interactive app should not be in sitemap`);
  }
}

for (const page of ['index.html', 'projects.html']) {
  const html = await readFile(path.join(root, page), 'utf8');
  for (const project of projects) {
    check(
      html.includes(`href="${project.landing.replace(/^\//, '')}"`),
      `${page}: project card missing canonical landing link for ${project.name}`
    );
  }
}

const filesToMirror = [
  'assets/js/analytics-events.js',
  ...projects.flatMap((project) => [project.landing.replace(/^\//, ''), siteFile(project.app).slice(root.length + 1)])
];

const analyticsEvents = await readFile(path.join(root, 'assets/js/analytics-events.js'), 'utf8');
check(
  analyticsEvents.includes('if (isPreview) return;'),
  'Shared analytics tracker does not suppress custom events inside preview iframes'
);

for (const relativePath of filesToMirror) {
  const [source, published] = await Promise.all([
    readFile(path.join(root, relativePath), 'utf8'),
    readFile(path.join(root, 'docs', relativePath), 'utf8')
  ]);
  check(source === published, `${relativePath}: source and docs copy differ`);
}

const pagesToCheck = [
  'index.html',
  'projects.html',
  ...projects.flatMap((project) => [project.landing.replace(/^\//, ''), siteFile(project.app).slice(root.length + 1)])
];
for (const relativePath of pagesToCheck) {
  const html = await readFile(path.join(root, relativePath), 'utf8');
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const raw = match[1].replace(/&amp;/g, '&');
    if (!raw || raw.includes('${') || raw.startsWith('#') || /^(?:mailto:|tel:|javascript:|data:)/.test(raw)) continue;
    const url = new URL(raw, `${origin}/${relativePath}`);
    if (url.origin !== origin) continue;
    try {
      await access(siteFile(url.pathname));
    } catch {
      failures.push(`${relativePath}: missing local target ${url.pathname}`);
    }
  }
}

if (failures.length) {
  console.error(`Project URL verification failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Project URL verification passed for ${projects.length} landing/app pairs.`);
  console.log('Canonical tags, Open Graph URLs, JSON-LD relationships, sitemap entries, buttons, previews, related links, project cards, local targets, and docs mirrors are consistent.');
}
