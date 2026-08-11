import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  defaultRepositoryRoot,
  loadProjectRegistry,
  siteFileFromPath
} from './project-registry.mjs';

const startMarker = '          <!-- related-project-cards:start -->';
const endMarker = '          <!-- related-project-cards:end -->';
const managedBlockPattern = /^[ \t]*<!-- related-project-cards:start -->[\s\S]*?^[ \t]*<!-- related-project-cards:end -->/m;
const relatedGridPattern = /(<div class="related-grid">\n)([\s\S]*?)(\n\s*<\/div>)/;

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const renderCard = (sourceProject, targetProject) => {
  const copy = sourceProject.relatedCardOverrides?.[targetProject.id] || targetProject.relatedCard;
  const href = path.posix.relative(
    path.posix.dirname(sourceProject.landingPath),
    targetProject.landingPath
  );
  return [
    `          <a class="related-card" href="${escapeHtml(href)}" data-event="click_related_project">`,
    `            <h3>${escapeHtml(copy.title)}</h3>`,
    `            <p>${escapeHtml(copy.description)}</p>`,
    '          </a>'
  ].join('\n');
};

const renderManagedBlock = (registry, project) => {
  const projectsById = new Map(registry.projects.map((item) => [item.id, item]));
  const cards = project.relatedProjectIds.map((relatedId) => {
    const target = projectsById.get(relatedId);
    if (!target) throw new Error(`${project.name}: unknown related project ${relatedId}`);
    return renderCard(project, target);
  });
  return [startMarker, ...cards, endMarker].join('\n');
};

const expectedHtml = (html, registry, project) => {
  const managedBlock = renderManagedBlock(registry, project);
  if (managedBlockPattern.test(html)) return html.replace(managedBlockPattern, managedBlock);
  if (!relatedGridPattern.test(html)) throw new Error(`${project.name}: related-grid container not found`);
  return html.replace(
    relatedGridPattern,
    (match, opening, currentCards, closing) => `${opening}${managedBlock}${closing}`
  );
};

export const verifyRelatedProjectCards = async ({ root = defaultRepositoryRoot } = {}) => {
  const registry = await loadProjectRegistry({ root });
  const failures = [];
  for (const project of registry.projects) {
    const filePath = siteFileFromPath(root, project.landingPath);
    try {
      const html = await readFile(filePath, 'utf8');
      if (html !== expectedHtml(html, registry, project)) {
        failures.push(`${project.name}: generated related-project cards are out of date`);
      }
    } catch (error) {
      failures.push(`${project.name}: ${error.message}`);
    }
  }
  return { failures, projectCount: registry.projects.length };
};

export const updateRelatedProjectCards = async ({ root = defaultRepositoryRoot } = {}) => {
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
      ? await verifyRelatedProjectCards()
      : await updateRelatedProjectCards();
    if (result.failures?.length) throw new Error(result.failures.join('\n'));
    console.log(`Related-project card ${checkOnly ? 'check' : 'generation'} passed for ${result.projectCount} projects.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
