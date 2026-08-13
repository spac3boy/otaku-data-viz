import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultRepositoryRoot = path.resolve(scriptDirectory, '..');
export const registryRelativePath = 'config/project-registry.json';

const isSitePath = (value) => {
  if (typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || /[?#]/.test(value)) return false;

  try {
    return !decodeURIComponent(value).split('/').some((segment) => segment === '.' || segment === '..');
  } catch {
    return false;
  }
};
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const addDuplicateFailures = (values, label, failures) => {
  const seen = new Set();
  values.forEach((value) => {
    if (seen.has(value)) failures.push(`${label} is duplicated: ${value}`);
    seen.add(value);
  });
};

export const validateProjectRegistry = (registry) => {
  const failures = [];
  if (registry?.schemaVersion !== '1.0.0') failures.push('schemaVersion must be 1.0.0');
  if (!hasText(registry?.site?.name)) failures.push('site.name is required');

  try {
    const origin = new URL(registry?.site?.origin);
    if (origin.pathname !== '/' || origin.search || origin.hash) {
      failures.push('site.origin must not include a path, query, or fragment');
    }
  } catch {
    failures.push('site.origin must be an absolute URL');
  }

  if (!Array.isArray(registry?.projects) || registry.projects.length === 0) {
    failures.push('projects must contain at least one project');
    return failures;
  }

  const projectIds = registry.projects.map((project) => project.id);
  addDuplicateFailures(projectIds, 'Project id', failures);
  addDuplicateFailures(registry.projects.map((project) => project.landingPath), 'Landing path', failures);
  addDuplicateFailures(registry.projects.map((project) => project.appPath), 'App path', failures);
  addDuplicateFailures(registry.projects.flatMap((project) => project.appAliases || []), 'App alias', failures);
  const knownIds = new Set(projectIds);

  registry.projects.forEach((project, index) => {
    const label = hasText(project.id) ? project.id : `projects[${index}]`;
    if (!hasText(project.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.id)) {
      failures.push(`${label}: id must be a lowercase kebab-case value`);
    }
    if (!hasText(project.name)) failures.push(`${label}: name is required`);
    if (!hasText(project.analyticsCategory)) failures.push(`${label}: analyticsCategory is required`);
    if (!isSitePath(project.landingPath) || !project.landingPath.startsWith('/projects/')) {
      failures.push(`${label}: landingPath must be a canonical /projects/ path`);
    }
    if (!isSitePath(project.appPath)) failures.push(`${label}: appPath must be a root-relative site path`);
    if (project.appPath === project.landingPath) failures.push(`${label}: appPath must differ from landingPath`);
    if (!Array.isArray(project.appAliases) || !project.appAliases.includes(project.appPath)) {
      failures.push(`${label}: appAliases must include appPath`);
    } else if (project.appAliases.some((alias) => !isSitePath(alias))) {
      failures.push(`${label}: every app alias must be a root-relative site path`);
    }

    for (const field of ['title', 'description']) {
      if (!hasText(project.seo?.[field])) failures.push(`${label}: seo.${field} is required`);
    }
    for (const field of ['title', 'description', 'imagePath', 'imageAlt']) {
      if (!hasText(project.social?.[field])) failures.push(`${label}: social.${field} is required`);
    }
    if (!isSitePath(project.social?.imagePath)) failures.push(`${label}: social.imagePath must be root-relative`);
    for (const field of ['breadcrumbName', 'appName', 'appDescription', 'applicationCategory']) {
      if (!hasText(project.structuredData?.[field])) failures.push(`${label}: structuredData.${field} is required`);
    }

    if (!['embedded-curated', 'versioned-canonical'].includes(project.dataAsset?.status)) {
      failures.push(`${label}: dataAsset.status is not supported`);
    }
    if (project.dataAsset?.status === 'versioned-canonical') {
      if (!hasText(project.dataAsset.datasetId)) failures.push(`${label}: canonical data requires datasetId`);
      if (!hasText(project.dataAsset.description)) {
        failures.push(`${label}: canonical data requires description`);
      } else if (project.dataAsset.description.trim().length < 50
        || project.dataAsset.description.trim().length > 5000) {
        failures.push(`${label}: canonical data description must be between 50 and 5000 characters`);
      }
      if (!hasText(project.dataAsset.version)) failures.push(`${label}: canonical data requires version`);
      if (!isSitePath(project.dataAsset.manifestPath)) failures.push(`${label}: canonical data requires manifestPath`);
      if (!isSitePath(project.dataAsset.publicPath)) failures.push(`${label}: canonical data requires publicPath`);
    }

    if (project.methodologyPath !== `${project.landingPath}#methodology`) {
      failures.push(`${label}: methodologyPath must target the landing-page methodology section`);
    }
    for (const field of ['title', 'description']) {
      if (!hasText(project.relatedCard?.[field])) failures.push(`${label}: relatedCard.${field} is required`);
    }
    if (!Array.isArray(project.relatedProjectIds)) {
      failures.push(`${label}: relatedProjectIds must be an array`);
    } else {
      addDuplicateFailures(project.relatedProjectIds, `${label} related project`, failures);
      project.relatedProjectIds.forEach((relatedId) => {
        if (relatedId === project.id) failures.push(`${label}: cannot relate to itself`);
        if (!knownIds.has(relatedId)) failures.push(`${label}: unknown related project ${relatedId}`);
      });
    }
    if (project.relatedCardOverrides !== undefined) {
      if (!project.relatedCardOverrides
        || Array.isArray(project.relatedCardOverrides)
        || typeof project.relatedCardOverrides !== 'object') {
        failures.push(`${label}: relatedCardOverrides must be an object`);
      } else {
        Object.entries(project.relatedCardOverrides).forEach(([relatedId, override]) => {
          if (!project.relatedProjectIds?.includes(relatedId)) {
            failures.push(`${label}: related card override is not in relatedProjectIds: ${relatedId}`);
          }
          for (const field of ['title', 'description']) {
            if (!hasText(override?.[field])) {
              failures.push(`${label}: relatedCardOverrides.${relatedId}.${field} is required`);
            }
          }
        });
      }
    }

    if (!isDate(project.lastReviewed)) failures.push(`${label}: lastReviewed must use YYYY-MM-DD`);
    if (!isDate(project.sitemap?.lastModified)) failures.push(`${label}: sitemap.lastModified must use YYYY-MM-DD`);
    if (typeof project.sitemap?.priority !== 'number'
      || project.sitemap.priority < 0
      || project.sitemap.priority > 1) {
      failures.push(`${label}: sitemap.priority must be a number from 0 to 1`);
    }
  });

  if (!Array.isArray(registry.staticSitemapEntries)) {
    failures.push('staticSitemapEntries must be an array');
  } else {
    addDuplicateFailures(registry.staticSitemapEntries.map((entry) => entry.path), 'Static sitemap path', failures);
    registry.staticSitemapEntries.forEach((entry) => {
      if (!isSitePath(entry.path)) failures.push(`Static sitemap path is invalid: ${entry.path}`);
      if (!isDate(entry.lastModified)) failures.push(`${entry.path}: lastModified must use YYYY-MM-DD`);
      if (typeof entry.priority !== 'number' || entry.priority < 0 || entry.priority > 1) {
        failures.push(`${entry.path}: priority must be a number from 0 to 1`);
      }
    });
  }

  return failures;
};

export const loadProjectRegistry = async ({ root = defaultRepositoryRoot } = {}) => {
  const registryPath = path.join(root, registryRelativePath);
  let registry;
  try {
    registry = JSON.parse(await readFile(registryPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${registryRelativePath}: ${error.message}`);
  }

  const failures = validateProjectRegistry(registry);
  if (failures.length) {
    throw new Error(`Project registry validation failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  }
  return registry;
};

export const canonicalUrl = (registry, sitePath) => new URL(sitePath, registry.site.origin).href;

export const siteFileFromPath = (root, sitePath) => {
  const pathname = decodeURIComponent(sitePath).replace(/^\//, '');
  if (!pathname) return path.join(root, 'index.html');
  if (pathname.endsWith('/')) return path.join(root, pathname, 'index.html');
  return path.join(root, pathname);
};
