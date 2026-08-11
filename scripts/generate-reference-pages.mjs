import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { defaultRepositoryRoot, loadProjectRegistry } from './project-registry.mjs';
import { loadReferencePages } from './reference-page-registry.mjs';
import { renderReferencePage } from './reference-page-template.mjs';

const pathExists = async (filePath) => {
  try { await access(filePath); return true; } catch { return false; }
};

const expectedReferencePages = async (root) => {
  const projectRegistry = await loadProjectRegistry({ root });
  const pages = await loadReferencePages({ root, projectRegistry });
  return new Map(pages.map((page) => [
    `${page.slug}.html`,
    renderReferencePage(page, projectRegistry, pages)
  ]));
};

export const verifyReferencePages = async ({ root = defaultRepositoryRoot } = {}) => {
  const outputDirectory = path.join(root, 'references');
  const expected = await expectedReferencePages(root);
  const failures = [];
  for (const [filename, expectedHtml] of expected) {
    try {
      const current = await readFile(path.join(outputDirectory, filename), 'utf8');
      if (current !== expectedHtml) failures.push(`${filename}: generated page is out of date`);
    } catch {
      failures.push(`${filename}: generated page is missing`);
    }
  }
  if (await pathExists(outputDirectory)) {
    const existing = (await readdir(outputDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
      .map((entry) => entry.name);
    existing.filter((filename) => !expected.has(filename))
      .forEach((filename) => failures.push(`${filename}: unmanaged reference page`));
  }
  return { failures, pageCount: expected.size };
};

export const updateReferencePages = async ({ root = defaultRepositoryRoot } = {}) => {
  const outputDirectory = path.join(root, 'references');
  const expected = await expectedReferencePages(root);
  await mkdir(outputDirectory, { recursive: true });
  for (const [filename, html] of expected) {
    await writeFile(path.join(outputDirectory, filename), html);
  }
  const verification = await verifyReferencePages({ root });
  if (verification.failures.length) throw new Error(verification.failures.join('\n'));
  return verification;
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  const checkOnly = process.argv.includes('--check');
  try {
    const result = checkOnly ? await verifyReferencePages() : await updateReferencePages();
    if (result.failures.length) throw new Error(result.failures.join('\n'));
    console.log(`Reference-page ${checkOnly ? 'check' : 'generation'} passed for ${result.pageCount} page${result.pageCount === 1 ? '' : 's'}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
