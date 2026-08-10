# Otaku Data Viz Strategy

This document defines the product direction and decision criteria for Otaku Data Viz. It is intended to keep architecture, content, analytics, and business work focused on building a defensible visual reference platform rather than accumulating unrelated pages or features.

## Product thesis

Otaku Data Viz is a **reference product with a media distribution engine and a data-product moat**.

- The reference product gives fans, writers, and researchers trustworthy answers and useful ways to explore fandom data.
- The media engine helps those answers earn discovery through search, AI answer engines, backlinks, communities, and direct sharing.
- The data layer creates defensibility through structured, versioned, source-transparent datasets that can support multiple experiences and, eventually, licensing or partnerships.

The primary user value is not the visualization by itself. It is making a complex fandom question easier to answer, understand, verify, and cite.

## Market definition

Otaku Data Viz uses a bottom-up, usage-based market model instead of treating all spending in anime, manga, or gaming as addressable revenue.

### Audience universe

The global audience interested in anime, manga, Japanese gaming, and adjacent fandoms.

This establishes category headroom, but it is not Otaku Data Viz's addressable market by itself.

### Total addressable market

All structured-information occasions Otaku Data Viz could theoretically answer, including searches, factual questions, comparisons, timelines, rankings, catalogs, relationships, release histories, and visual exploration.

If a revenue TAM is needed, it should be derived from addressable reference usage and realistic monetization yields, not total industry revenue.

### Serviceable available market

Primarily English-language reference occasions in franchises where Otaku Data Viz can legally acquire, verify, maintain, and differentiate the underlying data.

The primary audience is fans. Secondary audiences may include journalists, creators, researchers, educators, community contributors, publishers, and organizations that need structured fandom information.

### Serviceable obtainable market

The reference sessions and citations Otaku Data Viz can realistically capture through:

- Google and other organic search;
- AI and answer-engine discovery;
- backlinks and editorial citations;
- fandom communities and direct sharing;
- direct and returning visitors; and
- future embeds, partnerships, or data licensing.

SOM should be estimated by question or query cluster and updated with observed performance. It should not be presented as a precise percentage of the global fandom audience.

## 2030 north star

> By 2030, Otaku Data Viz will be the most trusted independent visual data reference for anime, manga, and Japanese gaming—the source fans, writers, and answer engines cite when a fandom question needs evidence—powered by a maintained corpus of versioned, source-transparent datasets and a sustainable business.

### Ambition markers, not production quotas

- Reach 1 million monthly engaged reference sessions as a category-authority outcome, with 5 million monthly visits as a stretch outcome.
- Maintain approximately 25–50 authoritative flagship datasets rather than optimizing for a raw dataset count.
- Use those datasets to support hundreds of substantive reference answers, pages, comparisons, and interactive experiences.
- Earn category-leading search visibility across multiple durable fandom topics.
- Earn recurring citations from relevant media, communities, researchers, and answer engines.
- Build meaningful direct and returning usage.
- Develop diversified revenue that can sustain data maintenance and product development; $1 million in annual revenue is an upside business outcome, not the product's purpose.

These markers must be recalibrated as actual demand, maintenance cost, and monetization evidence develop.

## Primary operating metric

The primary operating metric is **Monthly Engaged Reference Sessions**.

An engaged reference session begins on, or meaningfully uses, a canonical reference or interactive experience and meets at least one useful-engagement signal, such as:

- remaining engaged for more than 10 seconds;
- viewing two or more pages;
- opening or using the visualization;
- searching, filtering, selecting, comparing, or changing a meaningful state;
- following a related reference;
- sharing, downloading, or copying a link; or
- returning in a later session.

This metric measures useful audience scale. It must be interpreted with the authority and quality guardrails below so the product does not optimize for artificial interaction or dwell time.

## Reference authority scorecard

No single number proves that Otaku Data Viz is becoming definitive. Review the following measures together.

### Discovery and authority

- Non-branded search impressions and clicks by question cluster.
- Percentage of tracked queries ranking in the top 10 and top 3.
- Number and share of canonical pages receiving organic clicks.
- Branded searches and direct traffic.
- Relevant referring domains, editorial backlinks, and citations.
- Search visibility distributed across franchises rather than concentrated in one project.

### Usefulness and repeat usage

- Monthly Engaged Reference Sessions.
- Reference-page-to-visualization rate.
- Meaningful visualization interactions and completed explorations.
- Multi-page and related-reference exploration.
- Returning-user rate.
- Deep-link creation, shares, downloads, and embeds.

### Data trust and maintenance

- Percentage of datasets and records with documented provenance.
- Percentage of published answers computed from canonical data.
- Dataset freshness and last-reviewed dates.
- Automated validation coverage and passing status.
- Corrections received, correction rate, and time to correct.
- Maintenance time per dataset and per reference experience.

### Citation and defensibility

- Editorial and research citations from relevant sources.
- AI-answer visibility, referrals, and citation frequency across a fixed benchmark question set.
- Citation accuracy: whether the correct page is cited and the underlying claim is represented faithfully.
- Experiences, answers, or tools supported per canonical dataset.
- Dataset downloads, embed usage, reuse requests, and licensing inquiries.

### Business sustainability

- Revenue per thousand engaged reference sessions.
- Revenue by advertising, sponsorship, licensing, partnership, and service work.
- Renewal or repeat-partner rate.
- Dependence on the largest traffic source, franchise, page, and revenue source.
- Data maintenance and operating cost relative to revenue.

Revenue is initially a lagging sustainability measure. It must not override factual independence or data quality.

## Backlog decision test

Evaluate every material feature, page, dataset, or architecture proposal against these questions:

1. Does it create or improve a reusable data asset?
2. Does it improve trust, provenance, accuracy, freshness, or maintainability?
3. Can it support multiple valuable reference answers or experiences?
4. Is there demonstrated audience demand or a clear way to test demand?
5. Can its effect on authority, usefulness, retention, or sustainability be measured?

A proposal that satisfies at least three questions is normally platform work. A proposal that satisfies fewer than three needs a compelling strategic reason or should be deprioritized.

The final review question is:

> Does this work move Otaku Data Viz toward becoming a defensible visual reference platform, or does it merely add another feature or page?

## Current priority order

1. Establish this strategy and reference-authority scorecard.
2. Record a reliable analytics baseline and instrument meaningful reference usage.
3. Replace manually duplicated production files with one canonical build process.
4. Create a versioned, source-transparent canonical data layer, beginning with one pilot dataset.
5. Build reusable reference, metadata, structured-data, sitemap, and related-link templates.
6. Launch one demand-led reference cluster from the pilot dataset.
7. Make visualization states linkable, shareable, and citeable.
8. Evaluate the pilot after sufficient indexing and usage time.
9. Repeat the model for the strongest next franchise or question cluster.
10. Add authority-building and monetization layers after the reference model demonstrates repeatable value.

## Near-term non-goals

Until the foundation and pilot demonstrate repeatable growth, avoid prioritizing:

- one-off visualizations without reusable data or demonstrated demand;
- mass-generated derivative pages;
- arbitrary dataset or content-count targets;
- a formal social-media publishing operation;
- internationalization without a maintainable localization workflow;
- a public API before external reuse demand exists;
- aggressive advertising or premium membership work;
- AI-specific optimization tricks that do not improve the underlying reference; and
- major visual redesigns without a measured usability problem.

## Review cadence

- Review the scorecard monthly for directional changes.
- Review question-cluster and page performance quarterly, allowing sufficient time for search indexing and seasonality.
- Review this strategy every six months or when material evidence changes the market, product thesis, or business model.
- Record changes to definitions before comparing historical performance so metrics remain interpretable.

The performance dashboard is the source of truth for current measurements. This document defines what should be measured and why; it should not duplicate a rapidly aging traffic snapshot.
