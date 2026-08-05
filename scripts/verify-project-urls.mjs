import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createContext, runInContext } from 'node:vm';

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

  if (project.name === 'Dragon Ball Sociogram') {
    const nodesMatch = appHtml.match(/^const nodes=(\[.*\]);$/m);
    const linksMatch = appHtml.match(/^const links=(\[.*\]);$/m);
    check(nodesMatch && linksMatch, `${project.name}: embedded network data arrays are missing`);

    if (nodesMatch && linksMatch) {
      try {
        const nodes = JSON.parse(nodesMatch[1]);
        const links = JSON.parse(linksMatch[1]);
        const degree = new Map(nodes.map((node) => [node.id, 0]));
        const relationshipTypeCounts = new Map();
        const seriesCounts = new Map();

        links.forEach((link) => {
          degree.set(link.source, (degree.get(link.source) || 0) + 1);
          degree.set(link.target, (degree.get(link.target) || 0) + 1);
          relationshipTypeCounts.set(link.type, (relationshipTypeCounts.get(link.type) || 0) + 1);
        });
        nodes.forEach((node) => {
          (node.series || []).forEach((series) => {
            seriesCounts.set(series, (seriesCounts.get(series) || 0) + 1);
          });
        });

        const expectedNetworkStats = new Map([
          ['node-count', nodes.length],
          ['link-count', links.length],
          ['type-count', relationshipTypeCounts.size],
          ['series-count', seriesCounts.size],
          ['goku-degree', degree.get('goku') || 0],
          ['vegeta-degree', degree.get('vegeta') || 0],
          ['frieza-degree', degree.get('frieza') || 0],
          ['ally-count', relationshipTypeCounts.get('ally') || 0],
          ['enemy-count', relationshipTypeCounts.get('enemy') || 0],
          ['family-count', relationshipTypeCounts.get('family') || 0],
          ['mentor-count', relationshipTypeCounts.get('mentor') || 0],
          ['db-count', seriesCounts.get('db') || 0],
          ['dbz-count', seriesCounts.get('dbz') || 0],
          ['dbs-count', seriesCounts.get('dbs') || 0]
        ]);

        expectedNetworkStats.forEach((expectedValue, statName) => {
          const pattern = new RegExp(`data-network-stat="${statName}"[^>]*>([\\d,]+)<`, 'g');
          const displayedValues = [...landingHtml.matchAll(pattern)]
            .map((match) => Number(match[1].replace(/,/g, '')));
          check(
            displayedValues.length > 0 && displayedValues.every((value) => value === expectedValue),
            `${project.name}: displayed ${statName} does not match embedded network data (${expectedValue})`
          );
        });
      } catch (error) {
        failures.push(`${project.name}: embedded network data is not valid JSON (${error.message})`);
      }
    }
  }

  if (project.name === 'Pokedex Type Treemap') {
    try {
      const dataPath = path.join(root, 'docs/assets/data/pokemon-treemap-data.json');
      const dataset = JSON.parse(await readFile(dataPath, 'utf8'));
      const pokemon = Array.isArray(dataset.pokemon) ? dataset.pokemon : [];
      check(pokemon.length > 0, `${project.name}: published Pokémon dataset is empty`);
      check(
        Number(dataset.speciesCount) === pokemon.length,
        `${project.name}: dataset speciesCount does not match its Pokémon records`
      );

      const primaryTypeCounts = new Map();
      const generationCounts = new Map();
      const familyCounts = new Map();
      let dualTypeCount = 0;
      let singleTypeCount = 0;

      pokemon.forEach((entry) => {
        primaryTypeCounts.set(entry.primaryType, (primaryTypeCounts.get(entry.primaryType) || 0) + 1);
        generationCounts.set(String(entry.generation), (generationCounts.get(String(entry.generation)) || 0) + 1);
        familyCounts.set(
          entry.evolutionFamilyName,
          (familyCounts.get(entry.evolutionFamilyName) || 0) + 1
        );
        if (Array.isArray(entry.types) && entry.types.length > 1) dualTypeCount += 1;
        if (Array.isArray(entry.types) && entry.types.length === 1) singleTypeCount += 1;
      });

      const expectedPokedexStats = new Map([
        ['species-count', pokemon.length],
        ['primary-type-count', primaryTypeCounts.size],
        ['generation-count', generationCounts.size],
        ['family-count', new Set(pokemon.map((entry) => entry.evolutionFamilyId)).size],
        ['water-count', primaryTypeCounts.get('Water') || 0],
        ['normal-count', primaryTypeCounts.get('Normal') || 0],
        ['grass-count', primaryTypeCounts.get('Grass') || 0],
        ['flying-count', primaryTypeCounts.get('Flying') || 0],
        ['generation-five-count', generationCounts.get('5') || 0],
        ['generation-one-count', generationCounts.get('1') || 0],
        ['generation-six-count', generationCounts.get('6') || 0],
        ['dual-type-count', dualTypeCount],
        ['single-type-count', singleTypeCount],
        ['eevee-family-count', familyCounts.get('Eevee Evolution Family') || 0],
        ['applin-family-count', familyCounts.get('Applin Evolution Family') || 0],
        ['wurmple-family-count', familyCounts.get('Wurmple Evolution Family') || 0]
      ]);

      expectedPokedexStats.forEach((expectedValue, statName) => {
        const pattern = new RegExp(`data-pokedex-stat="${statName}"[^>]*>([\\d,]+)<`, 'g');
        const displayedValues = [...landingHtml.matchAll(pattern)]
          .map((match) => Number(match[1].replace(/,/g, '')));
        check(
          displayedValues.length > 0 && displayedValues.every((value) => value === expectedValue),
          `${project.name}: displayed ${statName} does not match the published dataset (${expectedValue})`
        );
      });
    } catch (error) {
      failures.push(`${project.name}: published Pokémon dataset is not valid JSON (${error.message})`);
    }
  }

  if (project.name === 'Nintendo Game Universe Map') {
    const catalogStart = appHtml.indexOf('    const games = [');
    const catalogEnd = appHtml.indexOf('    const genreColors = {', catalogStart);
    check(catalogStart >= 0 && catalogEnd > catalogStart, `${project.name}: embedded catalog block is missing`);

    if (catalogStart >= 0 && catalogEnd > catalogStart) {
      try {
        const context = createContext(Object.create(null));
        const catalogCode = `${appHtml.slice(catalogStart, catalogEnd)}\nglobalThis.__nintendoGames = games;`;
        runInContext(catalogCode, context, { timeout: 1000 });
        const games = context.__nintendoGames;
        check(Array.isArray(games) && games.length > 0, `${project.name}: embedded catalog is empty`);

        if (Array.isArray(games) && games.length > 0) {
          const countBy = (field) => games.reduce((counts, game) => {
            counts.set(game[field], (counts.get(game[field]) || 0) + 1);
            return counts;
          }, new Map());
          const eraCounts = countBy('era');
          const franchiseCounts = countBy('franchise');
          const genreCounts = countBy('genre');
          const decadeCounts = games.reduce((counts, game) => {
            const decade = Math.floor(Number(game.year) / 10) * 10;
            counts.set(decade, (counts.get(decade) || 0) + 1);
            return counts;
          }, new Map());
          const years = games.map((game) => Number(game.year));
          const firstYear = Math.min(...years);
          const lastYear = Math.max(...years);

          const expectedNintendoStats = new Map([
            ['release-count', games.length],
            ['franchise-count', franchiseCounts.size],
            ['era-count', eraCounts.size],
            ['year-range', `${firstYear}–${lastYear}`],
            ['first-year', firstYear],
            ['last-year', lastYear],
            ['switch-count', eraCounts.get('Switch') || 0],
            ['three-ds-count', eraCounts.get('Nintendo 3DS') || 0],
            ['ds-count', eraCounts.get('Nintendo DS') || 0],
            ['pokemon-count', franchiseCounts.get('Pokémon') || 0],
            ['mario-count', franchiseCounts.get('Mario') || 0],
            ['zelda-count', franchiseCounts.get('Zelda') || 0],
            ['kirby-count', franchiseCounts.get('Kirby') || 0],
            ['platform-count', genreCounts.get('Platform') || 0],
            ['rpg-count', genreCounts.get('RPG') || 0],
            ['adventure-count', genreCounts.get('Adventure') || 0],
            ['decade-2000-count', decadeCounts.get(2000) || 0],
            ['decade-2010-count', decadeCounts.get(2010) || 0],
            ['decade-1990-count', decadeCounts.get(1990) || 0]
          ]);

          expectedNintendoStats.forEach((expectedValue, statName) => {
            const pattern = new RegExp(`data-nintendo-stat="${statName}"[^>]*>([^<]+)<`, 'g');
            const displayedValues = [...landingHtml.matchAll(pattern)].map((match) => match[1].trim());
            check(
              displayedValues.length > 0
                && displayedValues.every((value) => value === String(expectedValue)),
              `${project.name}: displayed ${statName} does not match the embedded catalog (${expectedValue})`
            );
          });
        }
      } catch (error) {
        failures.push(`${project.name}: embedded catalog could not be evaluated (${error.message})`);
      }
    }
  }

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
  const expectedRelatedLinks = projects
    .filter((item) => item.landing !== project.landing)
    .map((item) => item.landing);
  const uniqueRelatedLinks = new Set(relatedLinks);
  check(
    uniqueRelatedLinks.size === expectedRelatedLinks.length
      && expectedRelatedLinks.every((pathname) => uniqueRelatedLinks.has(pathname)),
    `${project.name}: related-project cards must link to every other canonical project exactly once`
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
