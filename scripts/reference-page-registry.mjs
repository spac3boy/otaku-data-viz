import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { defaultRepositoryRoot, loadProjectRegistry } from './project-registry.mjs';
import { validateReferencePage } from './reference-page-template.mjs';

export const referenceContentDirectory = 'content/reference-pages';

export const loadReferencePages = async ({ root = defaultRepositoryRoot, projectRegistry } = {}) => {
  const registry = projectRegistry || await loadProjectRegistry({ root });
  const directory = path.join(root, referenceContentDirectory);
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  const pages = [];
  const failures = [];

  for (const file of files) {
    try {
      const page = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
      validateReferencePage(page, registry)
        .forEach((failure) => failures.push(`${file}: ${failure}`));
      pages.push(page);
    } catch (error) {
      failures.push(`${file}: ${error.message}`);
    }
  }

  for (const field of ['id', 'slug']) {
    const seen = new Set();
    pages.forEach((page) => {
      if (seen.has(page[field])) failures.push(`Duplicate reference-page ${field}: ${page[field]}`);
      seen.add(page[field]);
    });
  }
  if (failures.length) {
    throw new Error(`Reference-page registry validation failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  }
  return pages;
};
