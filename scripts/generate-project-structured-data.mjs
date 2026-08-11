import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  canonicalUrl,
  defaultRepositoryRoot,
  loadProjectRegistry,
  siteFileFromPath
} from './project-registry.mjs';

const startMarker = '  <!-- project-structured-data:start -->';
const endMarker = '  <!-- project-structured-data:end -->';
const managedBlockPattern = /^[ \t]*<!-- project-structured-data:start -->[\s\S]*?^[ \t]*<!-- project-structured-data:end -->/m;
const jsonLdBlockPattern = /^[ \t]*<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gm;

const nodesFromDocument = (document) => (
  Array.isArray(document?.['@graph']) ? document['@graph'] : [document]
);
const hasType = (node, expectedType) => {
  const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
  return types.includes(expectedType);
};

const findFaqBlock = (html, label) => {
  for (const match of html.matchAll(jsonLdBlockPattern)) {
    let document;
    try {
      document = JSON.parse(match[1]);
    } catch (error) {
      throw new Error(`${label}: invalid JSON-LD (${error.message})`);
    }
    const faq = nodesFromDocument(document).find((node) => hasType(node, 'FAQPage'));
    if (faq) return { block: match[0], faq };
  }
  throw new Error(`${label}: no FAQPage JSON-LD node found`);
};

const renderGraph = (registry, project, faqNode) => {
  const origin = registry.site.origin;
  const homeUrl = canonicalUrl(registry, '/');
  const projectsUrl = canonicalUrl(registry, '/projects.html');
  const canonical = canonicalUrl(registry, project.landingPath);
  const appUrl = canonicalUrl(registry, project.appPath);
  const imageUrl = canonicalUrl(registry, project.social.imagePath);
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;
  const webpageId = `${canonical}#webpage`;
  const appId = `${appUrl}#application`;
  const imageId = `${canonical}#primaryimage`;
  const breadcrumbId = `${canonical}#breadcrumb`;
  const faqId = `${canonical}#faq`;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: registry.site.name,
        url: homeUrl
      },
      {
        '@type': 'WebSite',
        '@id': websiteId,
        url: homeUrl,
        name: registry.site.name,
        publisher: { '@id': organizationId }
      },
      {
        '@type': 'ImageObject',
        '@id': imageId,
        url: imageUrl,
        caption: project.social.imageAlt
      },
      {
        '@type': 'WebPage',
        '@id': webpageId,
        url: canonical,
        name: project.seo.title,
        description: project.seo.description,
        inLanguage: 'en',
        dateModified: project.lastReviewed,
        isPartOf: { '@id': websiteId },
        mainEntity: { '@id': appId },
        breadcrumb: { '@id': breadcrumbId },
        primaryImageOfPage: { '@id': imageId },
        hasPart: { '@id': faqId }
      },
      {
        '@type': 'WebApplication',
        '@id': appId,
        name: project.structuredData.appName,
        url: appUrl,
        mainEntityOfPage: canonical,
        description: project.structuredData.appDescription,
        applicationCategory: project.structuredData.applicationCategory,
        operatingSystem: 'Any',
        isAccessibleForFree: true,
        image: imageUrl,
        author: { '@id': organizationId }
      },
      {
        '@type': 'BreadcrumbList',
        '@id': breadcrumbId,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: homeUrl },
          { '@type': 'ListItem', position: 2, name: 'Projects', item: projectsUrl },
          {
            '@type': 'ListItem',
            position: 3,
            name: project.structuredData.breadcrumbName,
            item: canonical
          }
        ]
      },
      {
        ...faqNode,
        '@context': undefined,
        '@type': 'FAQPage',
        '@id': faqId,
        url: canonical
      }
    ]
  };
};

const renderManagedBlock = (registry, project, faqNode) => {
  const graph = renderGraph(registry, project, faqNode);
  const json = JSON.stringify(graph, (key, value) => value === undefined ? undefined : value, 2)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return [
    startMarker,
    '  <script type="application/ld+json">',
    json,
    '  </script>',
    endMarker
  ].join('\n');
};

const expectedHtml = (html, registry, project) => {
  const { block: faqBlock, faq } = findFaqBlock(html, project.name);
  const managedBlock = renderManagedBlock(registry, project, faq);
  if (managedBlockPattern.test(html)) return html.replace(managedBlockPattern, managedBlock);
  return html.replace(faqBlock, managedBlock);
};

export const verifyProjectStructuredData = async ({ root = defaultRepositoryRoot } = {}) => {
  const registry = await loadProjectRegistry({ root });
  const failures = [];

  for (const project of registry.projects) {
    const filePath = siteFileFromPath(root, project.landingPath);
    try {
      const html = await readFile(filePath, 'utf8');
      if (html !== expectedHtml(html, registry, project)) {
        failures.push(`${project.name}: generated structured data is out of date`);
      }
    } catch (error) {
      failures.push(`${project.name}: ${error.message}`);
    }
  }

  return { failures, projectCount: registry.projects.length };
};

export const updateProjectStructuredData = async ({ root = defaultRepositoryRoot } = {}) => {
  const registry = await loadProjectRegistry({ root });
  for (const project of registry.projects) {
    const filePath = siteFileFromPath(root, project.landingPath);
    const html = await readFile(filePath, 'utf8');
    await writeFile(filePath, expectedHtml(html, registry, project));
  }
  return { projectCount: registry.projects.length };
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const checkOnly = process.argv.includes('--check');
  try {
    const result = checkOnly
      ? await verifyProjectStructuredData()
      : await updateProjectStructuredData();
    if (result.failures?.length) {
      throw new Error(result.failures.join('\n'));
    }
    console.log(`Project structured-data ${checkOnly ? 'check' : 'generation'} passed for ${result.projectCount} projects.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
