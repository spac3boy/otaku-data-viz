import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  canonicalUrl,
  defaultRepositoryRoot,
  loadProjectRegistry
} from './project-registry.mjs';

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const renderEntry = (registry, entry) => [
  '  <url>',
  `    <loc>${escapeXml(canonicalUrl(registry, entry.path))}</loc>`,
  `    <lastmod>${entry.lastModified}</lastmod>`,
  `    <priority>${entry.priority.toFixed(1)}</priority>`,
  '  </url>'
].join('\n');

export const renderSitemap = (registry) => {
  const entries = [
    ...registry.staticSitemapEntries.slice(0, 2),
    ...registry.projects.map((project) => ({
      path: project.landingPath,
      lastModified: project.sitemap.lastModified,
      priority: project.sitemap.priority
    })),
    ...registry.staticSitemapEntries.slice(2)
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => renderEntry(registry, entry)),
    '</urlset>',
    ''
  ].join('\n');
};

export const updateSitemap = async ({ root = defaultRepositoryRoot, checkOnly = false } = {}) => {
  const registry = await loadProjectRegistry({ root });
  const sitemapPath = path.join(root, 'sitemap.xml');
  const expected = renderSitemap(registry);

  if (checkOnly) {
    const current = await readFile(sitemapPath, 'utf8');
    if (current !== expected) {
      throw new Error('sitemap.xml is out of date; run npm run metadata:generate');
    }
  } else {
    await writeFile(sitemapPath, expected);
  }

  return { projectCount: registry.projects.length };
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const checkOnly = process.argv.includes('--check');
  try {
    const result = await updateSitemap({ checkOnly });
    console.log(`Project registry and sitemap ${checkOnly ? 'check' : 'generation'} passed for ${result.projectCount} projects.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
