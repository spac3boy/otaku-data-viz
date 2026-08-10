# Otaku Data Viz Measurement Framework

This document records the analytics baseline and defines how Otaku Data Viz measures progress toward becoming a trusted visual reference platform. Product direction and backlog criteria are defined in [`STRATEGY.md`](STRATEGY.md).

## Baseline before reference-engagement instrumentation

The latest complete local reporting window available when this framework was introduced was August 2–8, 2026.

| Metric | Baseline |
| --- | ---: |
| Active users | 18 |
| Sessions | 36 |
| Views | 97 |
| GA4 engagement rate | 63.9% |
| Google organic clicks | 5 |
| Google organic impressions | 282 |
| Google organic CTR | 1.77% |
| Average Google position | 9.74 |
| Share-control clicks | 1 |
| Copy-link clicks | 0 |

The raw baseline came from the weekly dashboard output generated on August 9, 2026. It is a directional starting point, not evidence of a stable traffic rate; the site is still small enough for individual visits to create large percentage changes.

**Monthly Engaged Reference Sessions did not exist as a dedicated event before this instrumentation was deployed.** Historical GA4 engagement rate is retained as context, but it must not be relabeled as the new north-star metric. The first clean MERS baseline begins after the `reference_engagement` event reaches production.

## Metric hierarchy

### Primary metric: Monthly Engaged Reference Sessions

Monthly Engaged Reference Sessions, abbreviated **MERS**, is the number of distinct GA4 sessions during a calendar month that contain at least one `reference_engagement` event.

The weekly updater also reports Engaged Reference Sessions for its selected window. Monthly and annual dashboard totals aggregate the same session-based measure over their respective periods.

### Reference sessions

A Reference Session is a GA4 session containing at least one `project_page_view` event on a canonical project landing page or its interactive application.

The updater reports:

- `referenceSessions`;
- `engagedReferenceSessions`;
- `referenceEngagementRate`, calculated as engaged reference sessions divided by reference sessions;
- `visualizationOpens`; and
- `relatedReferenceClicks`.

These metrics exclude preview iframes and normalize landing and interactive URLs to their canonical project.

### Audience and acquisition signals

The updater also reports:

- returning active users;
- direct sessions;
- referral sessions;
- sessions referred by identifiable AI-answer sources;
- branded and non-branded clicks from classified Search Console query rows; and
- branded and non-branded impressions and non-branded impression share.

AI referrals are identified from GA4 session-source names containing known answer-engine domains or brands such as ChatGPT, OpenAI, Perplexity, Copilot, Gemini, Claude, Anthropic, Poe, and You.com. This is a transparent heuristic, not a complete measure of AI citations or zero-click AI visibility.

Queries containing recognizable Otaku Data Viz brand variants are classified as branded. All other visible query rows are classified as non-branded. Search Console can omit anonymized queries, so branded and non-branded values describe the classified query rows and may not add up to sitewide Search Console totals.

## What triggers reference engagement

The shared analytics layer sends `reference_engagement` at most once per page view when a visitor does any of the following:

1. keeps a project page visible for at least 10 seconds;
2. opens the interactive visualization from a reference page;
3. follows a related-project reference;
4. uses a share or copy-link control;
5. activates a button or button-like control inside an interactive visualization;
6. changes an interactive filter; or
7. enters at least two characters into an interactive search field.

The visible-time trigger pauses when the document is hidden, so an abandoned background tab does not qualify merely because ten seconds elapsed.

The event includes the canonical project identity, landing versus interactive page type, surface, and a high-level engagement trigger. Search terms and form values are not sent.

## Interpretation guardrails

- MERS measures useful audience scale, not factual accuracy. Always review it with the data-quality and citation scorecards in `STRATEGY.md`.
- A fast factual answer may satisfy a visitor in fewer than 10 seconds. Search impressions, clicks, query coverage, and citations remain necessary guardrails.
- One session can include multiple project pages. GA4 session reporting deduplicates that session even though each page may send its own event.
- GA4 sessions and Search Console clicks are calculated differently and should be compared directionally, not forced to match.
- Returning-user counts, session acquisition, and search-query classification answer different questions and should not be combined into one composite score.
- An AI referral proves that a source sent a session; it does not prove that an AI answer cited the site accurately.
- Preview traffic remains excluded from pageviews and custom events.
- Traffic is currently low. Prefer absolute changes and multi-week direction over week-over-week percentages.
- MERS should not be optimized by adding unnecessary clicks, delays, or interaction friction.

## Supporting scorecard

Review the primary metric with the following existing measurements:

### Discovery

- Google clicks, impressions, CTR, and average position;
- top queries and their canonical landing pages;
- branded versus non-branded discovery among visible query rows;
- number of canonical pages receiving organic clicks; and
- discovery distributed across multiple projects.

### Usefulness

- reference engagement rate;
- visualization opens;
- related-reference clicks;
- share and copy-link actions; and
- GA4 sitewide engagement rate;
- returning users; and
- direct, referral, and identifiable AI-referral sessions.

### Manual authority checks

The automated dashboard does not currently establish whether an external page or AI answer accurately cites Otaku Data Viz. Review these separately on a monthly or quarterly cadence:

- relevant editorial backlinks and citations;
- AI citation occurrence across a fixed benchmark question set;
- citation destination and claim accuracy;
- notable embeds, downloads, or reuse requests; and
- correction requests and time to resolve them.

## Reporting cadence

- Use the completed weekly window for operational checks.
- Use rolling four-week or calendar-month totals for MERS and discovery direction.
- Use quarterly reviews for query-cluster growth, citations, franchise concentration, and strategy decisions.
- Do not set growth targets until at least four complete post-deployment weeks establish the first MERS baseline.

## Implementation references

- Browser event collection: `assets/js/analytics-events.js`
- Deployed event collection mirror: `docs/assets/js/analytics-events.js`
- GA4 and Search Console reporting: `scripts/update-performance-dashboard.mjs`
- Analytics and URL validation: `scripts/verify-project-urls.mjs`
