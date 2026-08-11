import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createContext, runInContext } from 'node:vm';
import { verifySiteBuild } from './build-site.mjs';
import { canonicalUrl, loadProjectRegistry, siteFileFromPath } from './project-registry.mjs';
import { verifyProjectStructuredData } from './generate-project-structured-data.mjs';
import { verifyRelatedProjectCards } from './generate-related-project-cards.mjs';
import { renderSitemap } from './generate-sitemap.mjs';
import { validatePokemonDataset } from './validate-pokemon-data.mjs';

const root = process.cwd();
const projectRegistry = await loadProjectRegistry({ root });
const origin = projectRegistry.site.origin;
const projects = projectRegistry.projects.map((project) => ({
  ...project,
  landing: project.landingPath,
  app: project.appPath
}));

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const structuredDataBuild = await verifyProjectStructuredData({ root });
structuredDataBuild.failures.forEach((failure) => failures.push(`Structured data: ${failure}`));
const relatedCardBuild = await verifyRelatedProjectCards({ root });
relatedCardBuild.failures.forEach((failure) => failures.push(`Related cards: ${failure}`));

const pokemonDataset = await validatePokemonDataset({ root });
pokemonDataset.failures.forEach((failure) => failures.push(`Pokémon dataset: ${failure}`));
const siteFile = (urlPath, base = root) => siteFileFromPath(base, urlPath);
const readSiteFile = (urlPath, base = root) => readFile(siteFile(urlPath, base), 'utf8');
const appPaths = (project) => project.appAliases || [project.app];
const matchesApp = (pathname, project) => appPaths(project).includes(pathname);
const decodeHtml = (value) => value
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&apos;', "'");
const titleValue = (html) => {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1].trim()) : null;
};
const metaValue = (html, attribute, value) => {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attributePattern = new RegExp(`\\b${attribute}="${escapedValue}"`, 'i');
  const tag = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((candidate) => attributePattern.test(candidate));
  const content = tag?.match(/\bcontent="([^"]*)"/i);
  return content ? decodeHtml(content[1]) : null;
};
const jsonLdNodes = (documents) => documents.flatMap((document) => (
  Array.isArray(document?.['@graph']) ? document['@graph'] : [document]
));
const hasSchemaType = (node, expectedType) => {
  const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
  return types.includes(expectedType);
};
const parseJsonLd = (html, label) => {
  const blocks = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  check(blocks.length > 0, `${label}: no JSON-LD block found`);
  const documents = [];
  for (const block of blocks) {
    try {
      documents.push(JSON.parse(block[1]));
    } catch (error) {
      failures.push(`${label}: invalid JSON-LD (${error.message})`);
    }
  }
  return documents;
};

for (const project of projects) {
  const landingHtml = await readSiteFile(project.landing);
  const appHtml = await readSiteFile(project.app);
  const canonical = canonicalUrl(projectRegistry, project.landing);
  const appUrl = canonicalUrl(projectRegistry, project.app);

  const landingJsonLd = parseJsonLd(landingHtml, `${project.name} landing`);
  const appJsonLd = parseJsonLd(appHtml, `${project.name} interactive`);
  const landingNodes = jsonLdNodes(landingJsonLd);
  const landingWebPage = landingNodes.find((node) => hasSchemaType(node, 'WebPage'));
  const landingApplication = landingNodes.find((node) => hasSchemaType(node, 'WebApplication'));
  const landingBreadcrumbs = landingNodes.find((node) => hasSchemaType(node, 'BreadcrumbList'));
  const landingFaq = landingNodes.find((node) => hasSchemaType(node, 'FAQPage'));

  check(titleValue(landingHtml) === project.seo.title, `${project.name}: title does not match the project registry`);
  check(
    metaValue(landingHtml, 'name', 'description') === project.seo.description,
    `${project.name}: meta description does not match the project registry`
  );
  const socialMetadata = new Map([
    ['og:title', project.social.title],
    ['og:description', project.social.description],
    ['og:url', canonical],
    ['og:image', canonicalUrl(projectRegistry, project.social.imagePath)],
    ['og:image:alt', project.social.imageAlt]
  ]);
  socialMetadata.forEach((expectedValue, property) => {
    check(
      metaValue(landingHtml, 'property', property) === expectedValue,
      `${project.name}: ${property} does not match the project registry`
    );
  });
  check(
    landingHtml.includes('id="methodology"'),
    `${project.name}: methodologyPath does not resolve to a methodology section`
  );
  check(Boolean(landingWebPage), `${project.name}: landing JSON-LD has no WebPage node`);
  if (landingWebPage) {
    check(landingWebPage.url === canonical, `${project.name}: WebPage URL does not match the registry`);
    check(landingWebPage.name === project.seo.title, `${project.name}: WebPage name does not match the registry`);
    check(
      landingWebPage.description === project.seo.description,
      `${project.name}: WebPage description does not match the registry`
    );
    check(
      landingWebPage.dateModified === project.lastReviewed,
      `${project.name}: WebPage dateModified does not match the registry`
    );
  }
  check(Boolean(landingApplication), `${project.name}: landing JSON-LD has no WebApplication node`);
  check(Boolean(landingBreadcrumbs), `${project.name}: landing JSON-LD has no BreadcrumbList node`);
  if (landingBreadcrumbs) {
    const items = landingBreadcrumbs.itemListElement || [];
    check(
      items.length === 3
        && items[0]?.position === 1
        && items[0]?.item === canonicalUrl(projectRegistry, '/')
        && items[1]?.position === 2
        && items[1]?.item === canonicalUrl(projectRegistry, '/projects.html')
        && items[2]?.position === 3
        && items[2]?.name === project.structuredData.breadcrumbName
        && items[2]?.item === canonical,
      `${project.name}: breadcrumb trail does not match the project registry`
    );
  }
  check(
    Boolean(landingFaq) && Array.isArray(landingFaq.mainEntity) && landingFaq.mainEntity.length > 0,
    `${project.name}: landing JSON-LD has no populated FAQPage node`
  );

  const appNode = jsonLdNodes(appJsonLd).find((node) => hasSchemaType(node, 'WebApplication'));
  check(Boolean(appNode), `${project.name}: interactive JSON-LD has no WebApplication node`);
  if (appNode) {
    const expectedStructuredData = new Map([
      ['name', project.structuredData.appName],
      ['url', appUrl],
      ['mainEntityOfPage', canonical],
      ['description', project.structuredData.appDescription],
      ['applicationCategory', project.structuredData.applicationCategory],
      ['image', canonicalUrl(projectRegistry, project.social.imagePath)]
    ]);
    expectedStructuredData.forEach((expectedValue, field) => {
      check(
        appNode[field] === expectedValue,
        `${project.name}: interactive JSON-LD ${field} does not match the project registry`
      );
    });
  }

  if (project.dataAsset.status === 'versioned-canonical') {
    try {
      const manifest = JSON.parse(await readFile(siteFile(project.dataAsset.manifestPath), 'utf8'));
      check(
        manifest.datasetId === project.dataAsset.datasetId,
        `${project.name}: canonical dataset id does not match its registry association`
      );
      check(
        manifest.version === project.dataAsset.version,
        `${project.name}: canonical dataset version does not match its registry association`
      );
      check(
        manifest.lastReviewed === project.lastReviewed,
        `${project.name}: canonical dataset review date does not match the registry`
      );
    } catch (error) {
      failures.push(`${project.name}: canonical dataset manifest is invalid (${error.message})`);
    }
  }

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
    landingNodes.some((node) => node?.url === canonical),
    `${project.name}: landing JSON-LD does not use the canonical landing URL`
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
      const dataPath = path.join(root, 'assets/data/pokemon-treemap-data.json');
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
  const expectedRelatedLinks = project.relatedProjectIds
    .map((projectId) => projects.find((item) => item.id === projectId)?.landing)
    .filter(Boolean);
  const uniqueRelatedLinks = new Set(relatedLinks);
  check(
    uniqueRelatedLinks.size === expectedRelatedLinks.length
      && expectedRelatedLinks.every((pathname) => uniqueRelatedLinks.has(pathname)),
    `${project.name}: related-project cards must match the project registry exactly once`
  );
}

const sitemap = await readFile(path.join(root, 'sitemap.xml'), 'utf8');
check(sitemap === renderSitemap(projectRegistry), 'sitemap.xml is not generated from the project registry');
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

const analyticsEvents = await readFile(path.join(root, 'assets/js/analytics-events.js'), 'utf8');
check(
  analyticsEvents.includes('if (isPreview) return;'),
  'Shared analytics tracker does not suppress custom events inside preview iframes'
);
check(
  analyticsEvents.includes("track('reference_engagement'")
    && analyticsEvents.includes('referenceEngagementThreshold = 10_000')
    && analyticsEvents.includes("document.visibilityState === 'visible'"),
  'Shared analytics tracker does not record the visible-time reference engagement signal'
);
check(
  analyticsEvents.includes("markReferenceEngagement('interactive_control'")
    && analyticsEvents.includes("markReferenceEngagement('interactive_filter'")
    && analyticsEvents.includes("markReferenceEngagement('interactive_search'"),
  'Shared analytics tracker does not record meaningful interactive controls'
);

const sourceDashboard = await readFile(path.join(root, 'analytics-dashboard.html'), 'utf8');
check(
  sourceDashboard.includes("const isFixtureMode = isLocalHost && queryParams.get('fixture') === '1';")
    && sourceDashboard.includes('Local fixture mode.')
    && sourceDashboard.includes("activeChartMode = 'reference'"),
  'Analytics dashboard does not expose the guarded local reference-scorecard fixture'
);

try {
  const fixture = JSON.parse(await readFile(path.join(root, 'analytics/fixtures/weekly-performance.json'), 'utf8'));
  check(fixture.fixture === true, 'Analytics dashboard fixture is not labeled as fixture data');
  check(
    Number(fixture.summary?.engagedReferenceSessions) > 0
      && Number(fixture.summary?.referenceSessions) >= Number(fixture.summary?.engagedReferenceSessions)
      && Array.isArray(fixture.history)
      && fixture.history.length >= 4,
    'Analytics dashboard fixture does not exercise the reference scorecard'
  );
} catch (error) {
  failures.push(`Analytics dashboard fixture is invalid JSON (${error.message})`);
}

const siteBuild = await verifySiteBuild({ root });
siteBuild.failures.forEach((failure) => failures.push(`Site build: ${failure}`));

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
  console.log(`Canonical Pokémon dataset ${pokemonDataset.summary.version} passed for ${pokemonDataset.summary.records} species records.`);
  console.log(`Canonical tags, Open Graph URLs, JSON-LD relationships, sitemap entries, buttons, previews, related links, project cards, local targets, and ${siteBuild.fileCount} generated docs files are consistent.`);
}
