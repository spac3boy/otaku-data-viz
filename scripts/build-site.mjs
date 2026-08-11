import { access, copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadProjectRegistry, siteFileFromPath } from './project-registry.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, '..');
const projectRegistry = await loadProjectRegistry({ root: repositoryRoot });

const projectAppEntries = projectRegistry.projects.map((project) => {
  const source = path.relative(repositoryRoot, siteFileFromPath(repositoryRoot, project.appPath));
  return { source, target: source };
});

// The repository root is the canonical source. GitHub Pages publishes /docs.
// Keep this list intentionally small so unrelated local files cannot be deployed.
export const siteEntries = [
  { source: '.nojekyll', target: '.nojekyll' },
  { source: 'CNAME', target: 'CNAME' },
  { source: 'robots.txt', target: 'robots.txt' },
  { source: 'sitemap.xml', target: 'sitemap.xml' },
  { source: 'index.html', target: 'index.html' },
  { source: 'projects.html', target: 'projects.html' },
  { source: 'about.html', target: 'about.html' },
  { source: 'contact.html', target: 'contact.html' },
  { source: 'lab.html', target: 'lab.html' },
  ...projectAppEntries,
  { source: 'projects', target: 'projects' },
  { source: 'assets', target: 'assets' },
  { source: 'data/weekly-performance.json', target: 'data/weekly-performance.json' },
  { source: 'analytics-dashboard.html', target: 'analytics/index.html' },
  { source: 'analytics/fixtures', target: 'analytics/fixtures' },
  { source: 'apple-touch-icon.png', target: 'apple-touch-icon.png' },
  { source: 'favicon-16x16.png', target: 'favicon-16x16.png' },
  { source: 'favicon-32x32.png', target: 'favicon-32x32.png' },
  { source: 'favicon.ico', target: 'favicon.ico' },
  { source: 'favicon.svg', target: 'favicon.svg' }
];

const ignoredNames = new Set(['.DS_Store']);
const ignoredPublishedPaths = new Set([
  'assets/images/dragon-ball-sociogram-og.svg',
  'assets/images/dragon-ball-sociogram-pinterest.svg',
  'assets/images/manga-anime-timeline-og.svg',
  'assets/images/manga-anime-timeline-pinterest.svg',
  'assets/images/pokedex-type-treemap-og.svg',
  'assets/images/pokedex-type-treemap-pinterest.svg',
  'assets/images/site-og.svg'
]);
const sitePath = (value) => value.split(path.sep).join('/');

const pathExists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const walkFiles = async (directory, relativeDirectory = '') => {
  const files = [];
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignoredNames.has(entry.name)) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(directory, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
};

const expandSiteEntries = async (root = repositoryRoot) => {
  const expected = new Map();

  for (const entry of siteEntries) {
    const sourcePath = path.join(root, entry.source);
    if (!await pathExists(sourcePath)) {
      throw new Error(`Canonical site source is missing: ${entry.source}`);
    }

    const sourceStat = await stat(sourcePath);
    const sourceFiles = sourceStat.isDirectory()
      ? await walkFiles(sourcePath)
      : [''];

    for (const relativePath of sourceFiles) {
      const source = path.join(sourcePath, relativePath);
      const target = sitePath(path.join(entry.target, relativePath));
      if (ignoredPublishedPaths.has(target)) continue;
      if (expected.has(target)) {
        throw new Error(`Published path is mapped more than once: ${target}`);
      }
      expected.set(target, source);
    }
  }

  return expected;
};

export const verifySiteBuild = async ({ root = repositoryRoot } = {}) => {
  const docsRoot = path.join(root, 'docs');
  const expected = await expandSiteEntries(root);
  const failures = [];

  for (const [target, source] of expected) {
    const published = path.join(docsRoot, target);
    if (!await pathExists(published)) {
      failures.push(`${target}: missing from docs build`);
      continue;
    }

    const [sourceBytes, publishedBytes] = await Promise.all([
      readFile(source),
      readFile(published)
    ]);
    if (!sourceBytes.equals(publishedBytes)) {
      failures.push(`${target}: docs build differs from canonical source`);
    }
  }

  if (await pathExists(docsRoot)) {
    const publishedFiles = await walkFiles(docsRoot);
    for (const publishedFile of publishedFiles) {
      const target = sitePath(publishedFile);
      if (!expected.has(target) && !ignoredPublishedPaths.has(target)) {
        failures.push(`${target}: unmanaged file in docs build`);
      }
    }
  }

  return {
    failures,
    fileCount: expected.size
  };
};

export const buildSite = async ({ root = repositoryRoot } = {}) => {
  const docsRoot = path.join(root, 'docs');
  const expected = await expandSiteEntries(root);
  const existingFiles = await pathExists(docsRoot) ? await walkFiles(docsRoot) : [];
  const unmanagedFiles = existingFiles
    .map(sitePath)
    .filter((file) => !expected.has(file) && !ignoredPublishedPaths.has(file));

  if (unmanagedFiles.length) {
    throw new Error([
      'Refusing to overwrite docs while it contains unmanaged files:',
      ...unmanagedFiles.map((file) => `- ${file}`),
      'Add intentional files to siteEntries or remove them explicitly.'
    ].join('\n'));
  }

  for (const [target, source] of expected) {
    const published = path.join(docsRoot, target);
    await mkdir(path.dirname(published), { recursive: true });
    await copyFile(source, published);
  }

  const verification = await verifySiteBuild({ root });
  if (verification.failures.length) {
    throw new Error(`Site build verification failed:\n${verification.failures.map((failure) => `- ${failure}`).join('\n')}`);
  }

  return verification;
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const checkOnly = process.argv.includes('--check');
  const result = checkOnly
    ? await verifySiteBuild()
    : await buildSite();

  if (result.failures.length) {
    console.error(`Site build check failed (${result.failures.length}):`);
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
  } else {
    console.log(`${checkOnly ? 'Site build check' : 'Site build'} passed for ${result.fileCount} published files.`);
  }
}
