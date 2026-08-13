import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadProjectRegistry, siteFileFromPath } from './project-registry.mjs';
import { renderReferencePage, validateReferencePage } from './reference-page-template.mjs';

const root = process.cwd();

export const verifyReferencePageTemplate = async ({ repositoryRoot = root } = {}) => {
  const failures = [];
  const [registry, fixture, schema] = await Promise.all([
    loadProjectRegistry({ root: repositoryRoot }),
    readFile(path.join(repositoryRoot, 'tests/fixtures/reference-page.json'), 'utf8').then(JSON.parse),
    readFile(path.join(repositoryRoot, 'schemas/reference-page.schema.json'), 'utf8').then(JSON.parse)
  ]);

  if (schema?.$id !== 'https://otakudataviz.com/schemas/reference-page.schema.json') {
    failures.push('Reference-page schema has an unexpected $id');
  }
  validateReferencePage(fixture, registry).forEach((failure) => failures.push(`Fixture: ${failure}`));

  const project = registry.projects.find((item) => item.id === fixture.projectId);
  try {
    const manifest = JSON.parse(await readFile(siteFileFromPath(repositoryRoot, fixture.dataset.manifestPath), 'utf8'));
    if (manifest.datasetId !== fixture.dataset.id) failures.push('Fixture dataset id does not match its manifest');
    if (manifest.version !== fixture.dataset.version) failures.push('Fixture dataset version does not match its manifest');
    if (`/${manifest.publishedFile}` !== fixture.dataset.publicPath) {
      failures.push('Fixture public dataset path does not match its manifest');
    }
    await access(siteFileFromPath(repositoryRoot, fixture.dataset.publicPath));
  } catch (error) {
    failures.push(`Fixture dataset association is invalid (${error.message})`);
  }

  let html = '';
  try {
    html = renderReferencePage(fixture, registry);
    if (html !== renderReferencePage(fixture, registry)) failures.push('Reference-page rendering is not deterministic');
  } catch (error) {
    failures.push(error.message);
  }

  if (html) {
    const canonical = `${registry.site.origin}/references/${fixture.slug}.html`;
    const requiredFragments = [
      `<link rel="canonical" href="${canonical}"`,
      `data-reference-page-id="${fixture.id}"`,
      `data-dataset-version="${fixture.dataset.version}"`,
      `data-reference-project-id="${fixture.projectId.replaceAll('-', '_')}"`,
      `data-reference-project-path="${project.landingPath}"`,
      `href="${project.landingPath}" data-event="click_related_project"`,
      'id="answer"',
      'id="key-facts"',
      'id="explore-views"',
      `href="${fixture.visualizationViews[0].href}" data-event="open_interactive_visualization" data-state-link`,
      'id="full-table"',
      'id="methodology"',
      'id="faq"',
      'class="nav-toggle"',
      `"description": "${project.dataAsset.description}"`,
      '"@type": "Organization"',
      `"name": "${registry.site.name}"`,
      `"contentUrl": "${registry.site.origin}${fixture.dataset.publicPath}"`
    ];
    requiredFragments.forEach((fragment) => {
      if (!html.includes(fragment)) failures.push(`Rendered fixture is missing: ${fragment}`);
    });

    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!jsonLdMatch) {
      failures.push('Rendered fixture has no JSON-LD block');
    } else {
      try {
        const document = JSON.parse(jsonLdMatch[1]);
        const types = new Set(document['@graph'].map((node) => node['@type']));
        for (const type of ['Organization', 'WebPage', 'Dataset', 'BreadcrumbList', 'FAQPage']) {
          if (!types.has(type)) failures.push(`Rendered fixture JSON-LD has no ${type} node`);
        }
        const datasetNode = document['@graph'].find((node) => node['@type'] === 'Dataset');
        const creatorNode = document['@graph'].find((node) => node['@id'] === datasetNode?.creator?.['@id']);
        if (datasetNode?.description !== project.dataAsset.description) {
          failures.push('Rendered fixture Dataset description does not match the canonical data asset');
        }
        if (creatorNode?.['@type'] !== 'Organization' || creatorNode?.name !== registry.site.name) {
          failures.push('Rendered fixture Dataset creator does not resolve to the site Organization');
        }
      } catch (error) {
        failures.push(`Rendered fixture JSON-LD is invalid (${error.message})`);
      }
    }
  }

  const unsafeFixture = structuredClone(fixture);
  unsafeFixture.heading = '<script>alert("unsafe")</script>';
  try {
    const safeHtml = renderReferencePage(unsafeFixture, registry);
    if (safeHtml.includes('<script>alert("unsafe")</script>')) failures.push('Renderer does not escape HTML content');
    if (!safeHtml.includes('&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;')) {
      failures.push('Renderer escaping test did not produce the expected safe text');
    }
  } catch (error) {
    failures.push(`Renderer escaping test failed (${error.message})`);
  }

  const invalidFixture = structuredClone(fixture);
  invalidFixture.facts = invalidFixture.facts.slice(0, 2);
  invalidFixture.dataset.version = '0.0.0';
  const expectedFailures = validateReferencePage(invalidFixture, registry);
  if (!expectedFailures.some((failure) => failure.includes('at least three'))) {
    failures.push('Reference-page validation does not reject thin fact sections');
  }
  if (!expectedFailures.some((failure) => failure.includes('dataset.version'))) {
    failures.push('Reference-page validation does not reject dataset version drift');
  }

  return { failures };
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = await verifyReferencePageTemplate();
  if (result.failures.length) {
    console.error(`Reference-page template verification failed (${result.failures.length}):`);
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
  } else {
    console.log('Reference-page schema, fixture, renderer, dataset contract, structured data, and safety checks passed.');
  }
}
