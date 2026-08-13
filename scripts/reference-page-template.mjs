const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const isKebabCase = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '');
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');
const jsonForHtml = (value) => JSON.stringify(value, null, 2).replaceAll('<', '\\u003c');

const addRequiredText = (failures, value, label) => {
  if (!hasText(value)) failures.push(`${label} is required`);
};
const addUniqueFailures = (failures, values, label) => {
  const seen = new Set();
  values.forEach((value) => {
    if (seen.has(value)) failures.push(`${label} is duplicated: ${value}`);
    seen.add(value);
  });
};

export const validateReferencePage = (page, projectRegistry) => {
  const failures = [];
  if (page?.schemaVersion !== '1.0.0') failures.push('schemaVersion must be 1.0.0');
  if (!isKebabCase(page?.id)) failures.push('id must be lowercase kebab-case');
  if (!isKebabCase(page?.slug)) failures.push('slug must be lowercase kebab-case');

  const project = projectRegistry?.projects?.find((item) => item.id === page?.projectId);
  if (!project) failures.push(`Unknown projectId: ${page?.projectId}`);
  if (project) {
    if (project.dataAsset.status !== 'versioned-canonical') {
      failures.push(`${page.projectId} does not have a versioned canonical dataset`);
    }
    if (page.dataset?.id !== project.dataAsset.datasetId) failures.push('dataset.id must match the parent project');
    if (page.dataset?.version !== project.dataAsset.version) failures.push('dataset.version must match the parent project');
    if (page.dataset?.manifestPath !== project.dataAsset.manifestPath) {
      failures.push('dataset.manifestPath must match the parent project');
    }
    if (page.dataset?.publicPath !== project.dataAsset.publicPath) {
      failures.push('dataset.publicPath must match the parent project');
    }
    if (page.methodology?.lastReviewed !== project.lastReviewed) {
      failures.push('methodology.lastReviewed must match the parent project review date');
    }
  }

  for (const field of ['title', 'description', 'cardTitle', 'cardDescription', 'eyebrow', 'heading', 'introduction']) {
    addRequiredText(failures, page?.[field], field);
  }
  if (typeof page?.sitemapPriority !== 'number'
    || page.sitemapPriority < 0
    || page.sitemapPriority > 1) failures.push('sitemapPriority must be a number from 0 to 1');
  addRequiredText(failures, page?.answer?.heading, 'answer.heading');
  addRequiredText(failures, page?.answer?.body, 'answer.body');

  if (page?.visualizationViews !== undefined) {
    if (!Array.isArray(page.visualizationViews) || page.visualizationViews.length === 0) {
      failures.push('visualizationViews must contain at least one view when provided');
    } else {
      const allowedParams = new Set(['type', 'family', 'pokemon', 'sort', 'size']);
      page.visualizationViews.forEach((view, index) => {
        addRequiredText(failures, view?.label, `visualizationViews[${index}].label`);
        addRequiredText(failures, view?.description, `visualizationViews[${index}].description`);
        addRequiredText(failures, view?.href, `visualizationViews[${index}].href`);
        try {
          const url = new URL(view?.href, projectRegistry.site.origin);
          if (!String(view?.href).startsWith('/')) {
            failures.push(`visualizationViews[${index}].href must be root-relative`);
          }
          if (project && url.pathname !== project.appPath) {
            failures.push(`visualizationViews[${index}].href must target the parent interactive app`);
          }
          [...url.searchParams.keys()].forEach((param) => {
            if (!allowedParams.has(param)) failures.push(`visualizationViews[${index}].href has unsupported parameter: ${param}`);
          });
          if (![...url.searchParams.keys()].some((param) => allowedParams.has(param))) {
            failures.push(`visualizationViews[${index}].href must include view state`);
          }
        } catch {
          failures.push(`visualizationViews[${index}].href is invalid`);
        }
      });
      addUniqueFailures(failures, page.visualizationViews.map((view) => view.href), 'Visualization view');
    }
  }

  if (!Array.isArray(page?.facts) || page.facts.length < 3) {
    failures.push('facts must contain at least three items');
  } else {
    page.facts.forEach((fact, index) => {
      for (const field of ['label', 'value', 'detail']) {
        addRequiredText(failures, fact?.[field], `facts[${index}].${field}`);
      }
    });
    addUniqueFailures(failures, page.facts.map((fact) => fact.label), 'Fact label');
  }

  if (!Array.isArray(page?.sections) || page.sections.length < 2) {
    failures.push('sections must contain at least two explanatory sections');
  } else {
    page.sections.forEach((section, index) => {
      if (!isKebabCase(section?.id)) failures.push(`sections[${index}].id must be lowercase kebab-case`);
      addRequiredText(failures, section?.heading, `sections[${index}].heading`);
      if (!Array.isArray(section?.paragraphs) || section.paragraphs.length === 0) {
        failures.push(`sections[${index}].paragraphs must not be empty`);
      } else {
        section.paragraphs.forEach((paragraph, paragraphIndex) => {
          addRequiredText(failures, paragraph, `sections[${index}].paragraphs[${paragraphIndex}]`);
        });
      }
    });
    addUniqueFailures(failures, page.sections.map((section) => section.id), 'Section id');
  }

  if (!page?.table || typeof page.table !== 'object') {
    failures.push('table is required');
  } else {
    addRequiredText(failures, page.table.caption, 'table.caption');
    if (!Array.isArray(page.table.columns) || page.table.columns.length < 2) {
      failures.push('table.columns must contain at least two columns');
    } else {
      page.table.columns.forEach((column, index) => addRequiredText(failures, column, `table.columns[${index}]`));
      addUniqueFailures(failures, page.table.columns, 'Table column');
    }
    if (!Array.isArray(page.table.rows) || page.table.rows.length === 0) {
      failures.push('table.rows must not be empty');
    } else {
      page.table.rows.forEach((row, index) => {
        if (!Array.isArray(row) || row.length !== page.table.columns?.length) {
          failures.push(`table.rows[${index}] must match the column count`);
        } else {
          row.forEach((cell, cellIndex) => addRequiredText(failures, cell, `table.rows[${index}][${cellIndex}]`));
        }
      });
    }
  }

  if (!isDate(page?.methodology?.lastReviewed)) {
    failures.push('methodology.lastReviewed must use YYYY-MM-DD');
  }
  addRequiredText(failures, page?.methodology?.summary, 'methodology.summary');
  if (!Array.isArray(page?.methodology?.sources) || page.methodology.sources.length === 0) {
    failures.push('methodology.sources must contain at least one source');
  } else {
    page.methodology.sources.forEach((source, index) => {
      addRequiredText(failures, source?.name, `methodology.sources[${index}].name`);
      addRequiredText(failures, source?.role, `methodology.sources[${index}].role`);
      try {
        const url = new URL(source?.url);
        if (url.protocol !== 'https:') failures.push(`methodology.sources[${index}].url must use HTTPS`);
      } catch {
        failures.push(`methodology.sources[${index}].url must be an absolute URL`);
      }
    });
  }

  if (!Array.isArray(page?.limitations) || page.limitations.length === 0) {
    failures.push('limitations must contain at least one disclosed limitation');
  } else {
    page.limitations.forEach((limitation, index) => addRequiredText(failures, limitation, `limitations[${index}]`));
  }
  if (!Array.isArray(page?.faq) || page.faq.length < 2) {
    failures.push('faq must contain at least two questions');
  } else {
    page.faq.forEach((item, index) => {
      addRequiredText(failures, item?.question, `faq[${index}].question`);
      addRequiredText(failures, item?.answer, `faq[${index}].answer`);
    });
    addUniqueFailures(failures, page.faq.map((item) => item.question), 'FAQ question');
  }
  return failures;
};

const renderStructuredData = (page, registry, project) => {
  const origin = registry.site.origin;
  const canonical = `${origin}/references/${page.slug}.html`;
  const projectUrl = `${origin}${project.landingPath}`;
  const publicDataUrl = `${origin}${page.dataset.publicPath}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: registry.site.name,
        url: `${origin}/`
      },
      {
        '@type': 'WebPage',
        '@id': `${canonical}#webpage`,
        url: canonical,
        name: page.title,
        description: page.description,
        inLanguage: 'en',
        dateModified: page.methodology.lastReviewed,
        isPartOf: { '@id': `${origin}/#website` },
        about: { '@id': `${canonical}#dataset` },
        breadcrumb: { '@id': `${canonical}#breadcrumb` }
      },
      {
        '@type': 'Dataset',
        '@id': `${canonical}#dataset`,
        name: page.dataset.id,
        description: project.dataAsset.description,
        version: page.dataset.version,
        url: projectUrl,
        isPartOf: { '@id': `${projectUrl}#webpage` },
        creator: { '@id': `${origin}/#organization` },
        distribution: {
          '@type': 'DataDownload',
          contentUrl: publicDataUrl,
          encodingFormat: 'application/json'
        }
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonical}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
          { '@type': 'ListItem', position: 2, name: 'Projects', item: `${origin}/projects.html` },
          { '@type': 'ListItem', position: 3, name: project.structuredData.breadcrumbName, item: projectUrl },
          { '@type': 'ListItem', position: 4, name: page.heading, item: canonical }
        ]
      },
      {
        '@type': 'FAQPage',
        '@id': `${canonical}#faq`,
        url: canonical,
        mainEntity: page.faq.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer }
        }))
      }
    ]
  };
};

export const renderReferencePage = (page, projectRegistry, referencePages = []) => {
  const failures = validateReferencePage(page, projectRegistry);
  if (failures.length) {
    throw new Error(`Reference page validation failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  }
  const project = projectRegistry.projects.find((item) => item.id === page.projectId);
  const canonical = `${projectRegistry.site.origin}/references/${page.slug}.html`;
  const projectHref = project.landingPath;
  const imageUrl = `${projectRegistry.site.origin}${project.social.imagePath}`;
  const sectionLinks = page.sections
    .map((section) => `<a href="#${escapeHtml(section.id)}">${escapeHtml(section.heading)}</a>`)
    .join('\n          ');
  const facts = page.facts.map((fact) => `
          <article class="reference-fact">
            <p class="mini-label">${escapeHtml(fact.label)}</p>
            <strong>${escapeHtml(fact.value)}</strong>
            <p>${escapeHtml(fact.detail)}</p>
          </article>`).join('');
  const tableHead = page.table.columns.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join('');
  const tableRows = page.table.rows.map((row) => `
            <tr>${row.map((cell, index) => index === 0
              ? `<th scope="row">${escapeHtml(cell)}</th>`
              : `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
  const sections = page.sections.map((section) => `
      <section class="section inner rule-bottom reference-section" id="${escapeHtml(section.id)}">
        <div class="section-bar"><h2>${escapeHtml(section.heading)}</h2></div>
        ${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n        ')}
      </section>`).join('\n');
  const sources = page.methodology.sources.map((source) => `
              <li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a> — ${escapeHtml(source.role)}</li>`).join('');
  const limitations = page.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join('');
  const faq = page.faq.map((item) => `
          <details>
            <summary>${escapeHtml(item.question)}</summary>
            <p>${escapeHtml(item.answer)}</p>
          </details>`).join('');
  const visualizationViews = page.visualizationViews || [];
  const visualizationViewSection = visualizationViews.length ? `
      <section class="section inner rule-bottom" id="explore-views">
        <div class="section-bar"><h2>Explore These Views</h2></div>
        <div class="related-grid reference-grid">${visualizationViews.map((view) => `
          <a class="related-card reference-card" href="${escapeHtml(view.href)}" data-event="open_interactive_visualization" data-state-link>
            <h3>${escapeHtml(view.label)}</h3>
            <p>${escapeHtml(view.description)}</p>
          </a>`).join('')}
        </div>
      </section>` : '';
  const relatedPages = referencePages
    .filter((item) => item.projectId === page.projectId && item.id !== page.id)
    .sort((a, b) => a.cardTitle.localeCompare(b.cardTitle));
  const relatedAnswers = relatedPages.length ? `
      <section class="section inner rule-bottom" id="related-answers">
        <div class="section-bar"><h2>Related Data Answers</h2></div>
        <div class="related-grid reference-grid">${relatedPages.map((item) => `
          <a class="related-card reference-card" href="./${escapeHtml(item.slug)}.html" data-event="click_related_project">
            <h3>${escapeHtml(item.cardTitle)}</h3>
            <p>${escapeHtml(item.cardDescription)}</p>
          </a>`).join('')}
        </div>
      </section>` : '';
  const structuredData = jsonForHtml(renderStructuredData(page, projectRegistry, project));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-653DY2M8K5"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-653DY2M8K5');</script>
  <script src="/assets/js/analytics-events.js" defer></script>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="${escapeHtml(projectRegistry.site.name)}" />
  <meta property="og:title" content="${escapeHtml(page.title)}" />
  <meta property="og:description" content="${escapeHtml(page.description)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:image:alt" content="${escapeHtml(project.social.imageAlt)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(page.title)}" />
  <meta name="twitter:description" content="${escapeHtml(page.description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  <link rel="stylesheet" href="/assets/css/site-pages.css?v=20260811" />
  <style>
    .reference-hero { padding-block: clamp(42px, 7vw, 82px); }
    .reference-hero h1 { max-width: 12ch; font-size: clamp(3.4rem, 7.5vw, 7rem); }
    .reference-hero .intro { max-width: 760px; }
    .reference-answer { border: 2px solid var(--ink); padding: clamp(22px, 4vw, 40px); background: var(--paper-deep); }
    .reference-answer h2 { font-size: clamp(2rem, 4vw, 3.7rem); }
    .reference-answer p, .reference-section > p { max-width: 800px; font-size: 1.05rem; line-height: 1.72; }
    .reference-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 20px; }
    .reference-fact { border: 1.5px solid var(--ink); padding: 20px; background: rgba(251,245,232,.75); }
    .reference-fact strong { display: block; margin-block: 10px; font-family: var(--display); font-size: clamp(2.2rem, 5vw, 4rem); line-height: 1; }
    .reference-fact p:last-child { line-height: 1.55; }
    .reference-table-wrap { overflow-x: auto; border: 1.5px solid var(--ink); }
    .reference-table { width: 100%; border-collapse: collapse; background: rgba(251,245,232,.78); }
    .reference-table caption { padding: 14px; text-align: left; font-family: var(--mono); font-size: .78rem; font-weight: 900; }
    .reference-table th, .reference-table td { border-top: 1px solid var(--ink); padding: 12px 14px; text-align: left; }
    .reference-table thead th { background: var(--ink); color: var(--paper-soft); font-family: var(--mono); font-size: .76rem; text-transform: uppercase; }
    .reference-table tbody th { font-weight: 900; }
    .reference-toc { display: flex; flex-wrap: wrap; gap: 10px; padding-block: 18px; }
    .reference-toc a { border: 1.5px solid var(--ink); padding: 9px 12px; font-family: var(--mono); font-size: .72rem; font-weight: 900; text-decoration: none; text-transform: uppercase; }
    .method-grid { display: grid; grid-template-columns: 1.2fr .8fr; gap: 20px; }
    .method-panel { border: 1.5px solid var(--ink); padding: 22px; background: rgba(251,245,232,.74); }
    .method-panel p, .method-panel li { line-height: 1.6; }
    .faq-list { display: grid; gap: 12px; }
    .faq-list details { border: 1.5px solid var(--ink); padding: 18px; background: rgba(251,245,232,.74); }
    .faq-list summary { cursor: pointer; font-weight: 900; }
    .faq-list p { line-height: 1.6; }
    @media (max-width: 760px) { .reference-facts, .method-grid { grid-template-columns: 1fr; } }
  </style>
  <script type="application/ld+json">
${structuredData.split('\n').map((line) => `  ${line}`).join('\n')}
  </script>
</head>
<body data-reference-page-id="${escapeHtml(page.id)}" data-dataset-version="${escapeHtml(page.dataset.version)}" data-reference-project-id="${escapeHtml(project.id.replaceAll('-', '_'))}" data-reference-project-name="${escapeHtml(project.name)}" data-reference-project-category="${escapeHtml(project.analyticsCategory)}" data-reference-project-path="${escapeHtml(project.landingPath)}">
  <div class="page">
    <header class="inner rule-bottom">
      <a class="brand" href="/index.html" aria-label="Otaku Data Viz home"><img class="brand-mark" src="/assets/images/ODV_Homepage_icon.svg" alt="" aria-hidden="true" /><span>Otaku Data Viz</span></a>
      <nav aria-label="Primary navigation">
        <details class="nav-toggle" open>
          <summary class="nav-button" aria-label="Open navigation menu"><span></span></summary>
          <ul><li><a href="/index.html">Home</a></li><li><a href="/projects.html" aria-current="page">Projects</a></li><li><a href="/about.html">About</a></li><li><a href="/lab.html">Lab</a></li><li><a href="/contact.html">Contact</a></li></ul>
        </details>
      </nav>
    </header>
    <main id="main">
      <section class="reference-hero inner rule-bottom">
        <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
        <h1>${escapeHtml(page.heading)}</h1>
        <p class="intro">${escapeHtml(page.introduction)}</p>
        <a class="button" href="${escapeHtml(projectHref)}" data-event="click_related_project">Explore the parent visualization <span aria-hidden="true">--&gt;</span></a>
      </section>
      <nav class="reference-toc inner rule-bottom" aria-label="On this page">
        <a href="#answer">Answer</a>
        <a href="#key-facts">Key facts</a>
        ${visualizationViews.length ? '<a href="#explore-views">Explore views</a>' : ''}
        <a href="#full-table">Full table</a>
        ${sectionLinks}
        <a href="#methodology">Methodology</a>
        <a href="#faq">FAQ</a>
        ${relatedPages.length ? '<a href="#related-answers">Related answers</a>' : ''}
      </nav>
      <section class="section inner rule-bottom" id="answer">
        <div class="reference-answer">
          <p class="mini-label">Direct answer</p>
          <h2>${escapeHtml(page.answer.heading)}</h2>
          <p>${escapeHtml(page.answer.body)}</p>
        </div>
      </section>
      <section class="section inner rule-bottom" id="key-facts">
        <div class="section-bar"><h2>Key Facts</h2></div>
        <div class="reference-facts">${facts}
        </div>
      </section>
${visualizationViewSection}
      <section class="section inner rule-bottom" id="full-table">
        <div class="section-bar"><h2>Full Data Table</h2></div>
        <div class="reference-table-wrap">
          <table class="reference-table">
            <caption>${escapeHtml(page.table.caption)}</caption>
            <thead><tr>${tableHead}</tr></thead>
            <tbody>${tableRows}
            </tbody>
          </table>
        </div>
      </section>
${sections}
      <section class="section inner rule-bottom" id="methodology">
        <div class="section-bar"><h2>Methodology &amp; Sources</h2></div>
        <div class="method-grid">
          <article class="method-panel">
            <p class="mini-label">Dataset ${escapeHtml(page.dataset.version)} · Reviewed ${escapeHtml(page.methodology.lastReviewed)}</p>
            <p>${escapeHtml(page.methodology.summary)}</p>
            <ul>${sources}
            </ul>
          </article>
          <aside class="method-panel">
            <h3>Limitations</h3>
            <ul>${limitations}</ul>
          </aside>
        </div>
      </section>
      <section class="section inner rule-bottom" id="faq">
        <div class="section-bar"><h2>Questions &amp; Answers</h2></div>
        <div class="faq-list">${faq}
        </div>
      </section>
${relatedAnswers}
      <section class="section inner">
        <div class="reference-answer">
          <p class="mini-label">Continue exploring</p>
          <h2>${escapeHtml(project.name)}</h2>
          <p>Open the canonical project page for the full interactive visualization, methodology, and related references.</p>
          <a class="button" href="${escapeHtml(projectHref)}" data-event="click_related_project">Open project <span aria-hidden="true">--&gt;</span></a>
        </div>
      </section>
    </main>
    <footer class="inner">
      <div class="disclaimer"><div class="warn" aria-hidden="true">!</div><div><strong>Reference note</strong><p>This fan-made reference is for educational, analytical, and entertainment purposes. Review the methodology, dataset version, sources, and limitations before citing a result.</p></div></div>
      <div class="barcode" aria-hidden="true"></div>
    </footer>
  </div>
  <script>
    (() => {
      const navToggle = document.querySelector('.nav-toggle');
      if (!navToggle) return;
      const desktopQuery = window.matchMedia('(min-width: 901px)');
      const syncNavMode = () => { navToggle.open = desktopQuery.matches; };
      syncNavMode();
      desktopQuery.addEventListener('change', syncNavMode);
    })();
  </script>
</body>
</html>
`;
};
