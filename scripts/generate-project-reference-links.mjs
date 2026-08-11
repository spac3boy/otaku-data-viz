import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { defaultRepositoryRoot, loadProjectRegistry, siteFileFromPath } from './project-registry.mjs';
import { loadReferencePages } from './reference-page-registry.mjs';

const blockPattern = /^[ \t]*<!-- project-reference-links:start -->[\s\S]*?^[ \t]*<!-- project-reference-links:end -->\n?/m;
const relatedSectionPattern = /(^[ \t]*<section\b[^>]*id="related-projects"[^>]*>)/m;
const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const renderBlock = (project, pages) => {
  if (!pages.length) return '';
  const cards = pages.map((page) => `
          <a class="related-card reference-card" href="../references/${escapeHtml(page.slug)}.html" data-event="click_related_project">
            <h3>${escapeHtml(page.cardTitle)}</h3>
            <p>${escapeHtml(page.cardDescription)}</p>
          </a>`).join('');
  return `      <!-- project-reference-links:start -->
      <section class="section inner rule-bottom" id="reference-answers">
        <div class="section-bar"><h2>Reference Answers</h2></div>
        <div class="related-grid reference-grid">${cards}
        </div>
      </section>
      <!-- project-reference-links:end -->
`;
};

const expectedHtml = (html, project, pages) => {
  const block = renderBlock(project, pages);
  if (blockPattern.test(html)) return html.replace(blockPattern, block);
  if (!block) return html;
  if (!relatedSectionPattern.test(html)) throw new Error(`${project.name}: related-projects section not found`);
  return html.replace(relatedSectionPattern, `${block}$1`);
};

const context = async (root) => {
  const registry = await loadProjectRegistry({ root });
  const pages = await loadReferencePages({ root, projectRegistry: registry });
  const byProject = new Map(registry.projects.map((project) => [project.id, []]));
  pages.forEach((page) => byProject.get(page.projectId)?.push(page));
  return { registry, byProject, pageCount: pages.length };
};

export const verifyProjectReferenceLinks = async ({ root = defaultRepositoryRoot } = {}) => {
  const { registry, byProject, pageCount } = await context(root);
  const failures = [];
  for (const project of registry.projects) {
    const filePath = siteFileFromPath(root, project.landingPath);
    try {
      const html = await readFile(filePath, 'utf8');
      if (html !== expectedHtml(html, project, byProject.get(project.id))) {
        failures.push(`${project.name}: generated reference links are out of date`);
      }
    } catch (error) {
      failures.push(`${project.name}: ${error.message}`);
    }
  }
  return { failures, pageCount };
};

export const updateProjectReferenceLinks = async ({ root = defaultRepositoryRoot } = {}) => {
  const { registry, byProject, pageCount } = await context(root);
  for (const project of registry.projects) {
    const filePath = siteFileFromPath(root, project.landingPath);
    const html = await readFile(filePath, 'utf8');
    await writeFile(filePath, expectedHtml(html, project, byProject.get(project.id)));
  }
  return { failures: [], pageCount };
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  const checkOnly = process.argv.includes('--check');
  try {
    const result = checkOnly ? await verifyProjectReferenceLinks() : await updateProjectReferenceLinks();
    if (result.failures.length) throw new Error(result.failures.join('\n'));
    console.log(`Project reference-link ${checkOnly ? 'check' : 'generation'} passed for ${result.pageCount} reference page${result.pageCount === 1 ? '' : 's'}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
