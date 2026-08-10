import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const config = {
  ga4PropertyId: process.env.GA4_PROPERTY_ID || '538946986',
  searchConsoleProperty: process.env.GSC_SITE_URL || 'sc-domain:otakudataviz.com',
  sheetId: process.env.GOOGLE_SHEET_ID || '1lI4PMgqxdZ2DT0-xbcv3N3YQktbdJJ-Ng-wTuyW66aM',
  outputPath: process.env.DASHBOARD_DATA_PATH || 'data/weekly-performance.json',
  reportDays: Number(process.env.REPORT_DAYS || 7),
  backfillWeeks: process.env.BACKFILL_WEEKS ? Number(process.env.BACKFILL_WEEKS) : null,
  historyStartDate: process.env.HISTORY_START_DATE || '2020-01-01',
  skipSheets: process.env.SKIP_SHEETS === '1'
};

const googleScopes = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
];

const iso = (date) => date.toISOString().slice(0, 10);

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const parseIsoDate = (value) => new Date(`${value}T00:00:00Z`);

const gaDateToIso = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

const weekStartSunday = (dateText) => {
  const date = parseIsoDate(dateText);
  return iso(addDays(date, -date.getUTCDay()));
};

const completeWeekWindow = () => {
  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const daysSinceSaturday = (utcToday.getUTCDay() + 1) % 7;
  const end = addDays(utcToday, -(daysSinceSaturday || 7));
  const days = Number.isFinite(config.reportDays) && config.reportDays > 0 ? config.reportDays : 7;
  const start = addDays(end, -(days - 1));
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(days - 1));

  return {
    current: { startDate: iso(start), endDate: iso(end) },
    previous: { startDate: iso(previousStart), endDate: iso(previousEnd) }
  };
};

const historyWeekWindows = (currentRange, count = config.backfillWeeks) => {
  const days = Number.isFinite(config.reportDays) && config.reportDays > 0 ? config.reportDays : 7;
  const windows = [];
  const currentEnd = new Date(`${currentRange.endDate}T00:00:00Z`);
  const total = Number.isFinite(count) && count > 0 ? count : 4;

  for (let index = total - 1; index >= 0; index -= 1) {
    const end = addDays(currentEnd, -(index * days));
    const start = addDays(end, -(days - 1));
    windows.push({ startDate: iso(start), endDate: iso(end) });
  }

  return windows;
};

const historyWeekWindowsFromStart = (startDate, currentRange) => {
  const windows = [];
  let start = parseIsoDate(weekStartSunday(startDate));
  const currentEnd = parseIsoDate(currentRange.endDate);

  while (start <= currentEnd) {
    const end = addDays(start, 6);
    windows.push({
      startDate: iso(start),
      endDate: iso(end > currentEnd ? currentEnd : end)
    });
    start = addDays(start, 7);
  }

  return windows;
};

const base64url = (input) => Buffer
  .from(input)
  .toString('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const getServiceAccount = async () => {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  }

  return null;
};

const serviceAccountAccessToken = async () => {
  const credentials = await getServiceAccount();
  if (!credentials) return null;
  if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS must point to a service account JSON key.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: credentials.client_email,
    scope: googleScopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const unsignedJwt = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = createSign('RSA-SHA256')
    .update(unsignedJwt)
    .sign(credentials.private_key);
  const assertion = `${unsignedJwt}.${base64url(signature)}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Service account token request failed: ${body.error_description || body.error || response.statusText}`);
  }
  return body.access_token;
};

const getAccessToken = async () => {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;

  const serviceAccountToken = await serviceAccountAccessToken();
  if (serviceAccountToken) return serviceAccountToken;

  try {
    return execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim();
  } catch {
    // Fall back to the active gcloud user account for environments that do not use ADC.
  }

  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON key, set GOOGLE_ACCESS_TOKEN, or authenticate gcloud before running the dashboard updater.');
  }
};

const apiFetch = async (url, token, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = body?.error?.message || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }

  return body;
};

const gaRunReport = async (token, payload) => {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${config.ga4PropertyId}:runReport`;
  return apiFetch(url, token, { method: 'POST', body: JSON.stringify(payload) });
};

const gscQuery = async (token, payload) => {
  const site = encodeURIComponent(config.searchConsoleProperty);
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`;
  return apiFetch(url, token, { method: 'POST', body: JSON.stringify(payload) });
};

const metricValue = (row, index) => Number(row?.metricValues?.[index]?.value || 0);

const isAiReferralSource = (value = '') => /(?:chatgpt|openai|perplexity|copilot|gemini|bard|claude|anthropic|poe\.com|you\.com)/i.test(value);

const isBrandedQuery = (value = '') => {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return normalized.includes('otakudataviz')
    || normalized.includes('otaku data viz')
    || normalized.includes('otaku data visualization');
};

const excludePreviewPageFilter = {
  notExpression: {
    filter: {
      fieldName: 'pageLocation',
      stringFilter: {
        matchType: 'CONTAINS',
        value: 'preview=1',
        caseSensitive: false
      }
    }
  }
};

const projectPathGroups = new Map([
  ['/projects/dragon-ball-sociogram.html', '/projects/dragon-ball-sociogram.html'],
  ['/dragonball-character-sociogram/', '/projects/dragon-ball-sociogram.html'],
  ['/dragonball-character-sociogram/index.html', '/projects/dragon-ball-sociogram.html'],
  ['/projects/manga-anime-timeline.html', '/projects/manga-anime-timeline.html'],
  ['/manga-timeline.html', '/projects/manga-anime-timeline.html'],
  ['/projects/pokedex-type-treemap.html', '/projects/pokedex-type-treemap.html'],
  ['/pokemon_territory_map.html', '/projects/pokedex-type-treemap.html'],
  ['/projects/nintendo-game-universe-map.html', '/projects/nintendo-game-universe-map.html'],
  ['/nintendo-game-universe-map.html', '/projects/nintendo-game-universe-map.html'],
  ['/projects/gundam-universe-map.html', '/projects/gundam-universe-map.html'],
  ['/gundam-universe-map.html', '/projects/gundam-universe-map.html']
]);

const groupedProjectPath = (value = '/') => {
  let pathname = value;
  try {
    pathname = new URL(value, 'https://otakudataviz.com').pathname;
  } catch {
    pathname = String(value).split(/[?#]/, 1)[0] || '/';
  }
  return projectPathGroups.get(pathname) || pathname;
};

const aggregatePageRows = (pageRows) => {
  const rows = new Map();
  pageRows.forEach((row) => {
    const page = groupedProjectPath(row.page);
    const current = rows.get(page) || {
      page,
      views: 0,
      users: 0,
      organicClicks: 0,
      organicImpressions: 0,
      shareClicks: 0,
      copyLinkClicks: 0
    };
    current.views += Number(row.views || 0);
    current.users += Number(row.users || 0);
    current.organicClicks += Number(row.organicClicks || 0);
    current.organicImpressions += Number(row.organicImpressions || 0);
    current.shareClicks += Number(row.shareClicks || 0);
    current.copyLinkClicks += Number(row.copyLinkClicks || 0);
    rows.set(page, current);
  });
  return [...rows.values()];
};

const aggregateShareEvents = (events) => {
  const rows = new Map();
  events.forEach((event) => {
    const pagePath = groupedProjectPath(event.pagePath);
    const key = `${pagePath}\u0000${event.platform}`;
    const current = rows.get(key) || { ...event, pagePath, shareClicks: 0 };
    current.shareClicks += Number(event.shareClicks || 0);
    rows.set(key, current);
  });
  return [...rows.values()];
};

const earliestGaDate = async (token, currentRange) => {
  const report = await gaRunReport(token, {
    dateRanges: [{ startDate: config.historyStartDate, endDate: currentRange.endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
    limit: 1
  });

  const value = report.rows?.[0]?.dimensionValues?.[0]?.value;
  return value ? gaDateToIso(value) : null;
};

const earliestGscDate = async (token, currentRange) => {
  const report = await gscQuery(token, {
    startDate: config.historyStartDate,
    endDate: currentRange.endDate,
    dimensions: ['date'],
    rowLimit: 1,
    startRow: 0
  });

  return report.rows?.[0]?.keys?.[0] || null;
};

const earliestHistoryDate = async (token, currentRange) => {
  const dates = await Promise.all([
    earliestGaDate(token, currentRange),
    earliestGscDate(token, currentRange)
  ]);

  return dates
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))[0] || currentRange.startDate;
};

const resolveBackfillRanges = async (token, currentRange) => {
  if (Number.isFinite(config.backfillWeeks) && config.backfillWeeks > 0) {
    return historyWeekWindows(currentRange, config.backfillWeeks);
  }

  const earliest = await earliestHistoryDate(token, currentRange);
  return historyWeekWindowsFromStart(earliest, currentRange);
};

const loadBackfilledData = async (token, ranges) => {
  const history = [];
  const details = [];

  for (const range of ranges) {
    history.push(await weeklyTrend(token, range));
    details.push(await weeklyDetail(token, range));
  }

  return { history, details };
};

const trendPoint = (range, values, source = 'api') => ({
  weekStart: range.startDate,
  weekEnd: range.endDate,
  users: Number(values.users || 0),
  sessions: Number(values.sessions || 0),
  views: Number(values.views || 0),
  engagementRate: Number(values.engagementRate || 0),
  referenceSessions: Number(values.referenceSessions || 0),
  engagedReferenceSessions: Number(values.engagedReferenceSessions || 0),
  referenceEngagementRate: Number(values.referenceEngagementRate || 0),
  visualizationOpens: Number(values.visualizationOpens || 0),
  relatedReferenceClicks: Number(values.relatedReferenceClicks || 0),
  returningUsers: Number(values.returningUsers || 0),
  directSessions: Number(values.directSessions || 0),
  referralSessions: Number(values.referralSessions || 0),
  aiReferralSessions: Number(values.aiReferralSessions || 0),
  organicClicks: Number(values.organicClicks || 0),
  organicImpressions: Number(values.organicImpressions || 0),
  organicCtr: Number(values.organicCtr || 0),
  avgPosition: Number(values.avgPosition || 0),
  brandedClicks: Number(values.brandedClicks || 0),
  brandedImpressions: Number(values.brandedImpressions || 0),
  nonBrandedClicks: Number(values.nonBrandedClicks || 0),
  nonBrandedImpressions: Number(values.nonBrandedImpressions || 0),
  classifiedQueryImpressions: Number(values.classifiedQueryImpressions || 0),
  nonBrandedImpressionShare: Number(values.nonBrandedImpressionShare || 0),
  organicPagesWithClicks: Number(values.organicPagesWithClicks || 0),
  shareClicks: Number(values.shareClicks || 0),
  copyLinkClicks: Number(values.copyLinkClicks || 0),
  source
});

const loadExistingHistory = async () => {
  try {
    const existing = JSON.parse(await readFile(config.outputPath, 'utf8'));
    return Array.isArray(existing.history) ? existing.history : [];
  } catch {
    return [];
  }
};

const mergeHistory = (...groups) => {
  const rows = new Map();

  groups.flat().forEach((row) => {
    if (!row?.weekStart || !row?.weekEnd) return;
    rows.set(`${row.weekStart}:${row.weekEnd}`, {
      weekStart: row.weekStart,
      weekEnd: row.weekEnd,
      users: Number(row.users || 0),
      sessions: Number(row.sessions || 0),
      views: Number(row.views || 0),
      engagementRate: Number(row.engagementRate || 0),
      referenceSessions: Number(row.referenceSessions || 0),
      engagedReferenceSessions: Number(row.engagedReferenceSessions || 0),
      referenceEngagementRate: Number(row.referenceEngagementRate || 0),
      visualizationOpens: Number(row.visualizationOpens || 0),
      relatedReferenceClicks: Number(row.relatedReferenceClicks || 0),
      returningUsers: Number(row.returningUsers || 0),
      directSessions: Number(row.directSessions || 0),
      referralSessions: Number(row.referralSessions || 0),
      aiReferralSessions: Number(row.aiReferralSessions || 0),
      organicClicks: Number(row.organicClicks || 0),
      organicImpressions: Number(row.organicImpressions || 0),
      organicCtr: Number(row.organicCtr || 0),
      avgPosition: Number(row.avgPosition || 0),
      brandedClicks: Number(row.brandedClicks || 0),
      brandedImpressions: Number(row.brandedImpressions || 0),
      nonBrandedClicks: Number(row.nonBrandedClicks || 0),
      nonBrandedImpressions: Number(row.nonBrandedImpressions || 0),
      classifiedQueryImpressions: Number(row.classifiedQueryImpressions || 0),
      nonBrandedImpressionShare: Number(row.nonBrandedImpressionShare || 0),
      organicPagesWithClicks: Number(row.organicPagesWithClicks || 0),
      shareClicks: Number(row.shareClicks || 0),
      copyLinkClicks: Number(row.copyLinkClicks || 0),
      source: row.source || 'api'
    });
  });

  return [...rows.values()]
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(-52);
};

const weeklyTrend = async (token, range) => {
  const [ga, reference, acquisition, gsc, discovery, shares] = await Promise.all([
    gaTotals(token, range),
    gaReferenceMetrics(token, range),
    gaAcquisitionMetrics(token, range),
    gscTotals(token, range),
    gscDiscoveryMix(token, range),
    gaShareEvents(token, range)
  ]);
  const values = {
    ...ga,
    ...reference,
    ...acquisition,
    ...gsc,
    ...discovery,
    shareClicks: shares.reduce((sum, row) => sum + row.shareClicks, 0),
    copyLinkClicks: shares
      .filter((row) => row.platform === 'copy_link')
      .reduce((sum, row) => sum + row.shareClicks, 0)
  };

  return trendPoint(range, values, 'api');
};

const weeklyDetail = async (token, range) => {
  const [gaPages, gscPages, topQueries, shareEvents] = await Promise.all([
    gaTopPages(token, range),
    gscTopPages(token, range),
    gscTopQueries(token, range),
    gaShareEvents(token, range)
  ]);

  return {
    range,
    topPages: mergeTopPages(gaPages, gscPages, shareEvents),
    topQueries,
    shareEvents
  };
};

const gaTotals = async (token, range) => {
  const report = await gaRunReport(token, {
    dateRanges: [range],
    dimensionFilter: excludePreviewPageFilter,
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'engagementRate' }
    ]
  });

  const row = report.rows?.[0];
  return {
    users: metricValue(row, 0),
    sessions: metricValue(row, 1),
    views: metricValue(row, 2),
    engagementRate: metricValue(row, 3)
  };
};

const acquisitionMetricsFromReports = (sourceReport, returningReport) => {
  const sourceRows = (sourceReport.rows || []).map((row) => ({
    source: row.dimensionValues?.[0]?.value || '(not set)',
    medium: row.dimensionValues?.[1]?.value || '(not set)',
    sessions: metricValue(row, 0)
  }));
  const returningUsers = (returningReport.rows || [])
    .filter((row) => row.dimensionValues?.[0]?.value === 'returning')
    .reduce((sum, row) => sum + metricValue(row, 0), 0);

  return {
    returningUsers,
    directSessions: sourceRows
      .filter((row) => row.source === '(direct)' || row.medium === '(none)')
      .reduce((sum, row) => sum + row.sessions, 0),
    referralSessions: sourceRows
      .filter((row) => row.medium === 'referral')
      .reduce((sum, row) => sum + row.sessions, 0),
    aiReferralSessions: sourceRows
      .filter((row) => isAiReferralSource(row.source))
      .reduce((sum, row) => sum + row.sessions, 0)
  };
};

const gaAcquisitionMetrics = async (token, range) => {
  const [sourceReport, returningReport] = await Promise.all([
    gaRunReport(token, {
      dateRanges: [range],
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [{ name: 'sessions' }],
      limit: 1000
    }),
    gaRunReport(token, {
      dateRanges: [range],
      dimensions: [{ name: 'newVsReturning' }],
      metrics: [{ name: 'activeUsers' }],
      limit: 10
    })
  ]);

  return acquisitionMetricsFromReports(sourceReport, returningReport);
};

const referenceMetricsFromReport = (report) => {
  const rows = new Map((report.rows || []).map((row) => [
    row.dimensionValues?.[0]?.value || '',
    {
      events: metricValue(row, 0),
      sessions: metricValue(row, 1)
    }
  ]));
  const referenceSessions = rows.get('project_page_view')?.sessions || 0;
  const engagedReferenceSessions = rows.get('reference_engagement')?.sessions || 0;

  return {
    referenceSessions,
    engagedReferenceSessions,
    referenceEngagementRate: referenceSessions
      ? engagedReferenceSessions / referenceSessions
      : 0,
    visualizationOpens: rows.get('open_interactive_visualization')?.events || 0,
    relatedReferenceClicks: rows.get('click_related_project')?.events || 0
  };
};

const gaReferenceMetrics = async (token, range) => {
  const report = await gaRunReport(token, {
    dateRanges: [range],
    dimensions: [{ name: 'eventName' }],
    metrics: [
      { name: 'eventCount' },
      { name: 'sessions' }
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        inListFilter: {
          values: [
            'project_page_view',
            'reference_engagement',
            'open_interactive_visualization',
            'click_related_project'
          ]
        }
      }
    },
    limit: 20
  });

  return referenceMetricsFromReport(report);
};

const gaTopPages = async (token, range) => {
  const report = await gaRunReport(token, {
    dateRanges: [range],
    dimensions: [{ name: 'pagePath' }],
    dimensionFilter: excludePreviewPageFilter,
    metrics: [
      { name: 'screenPageViews' },
      { name: 'activeUsers' }
    ],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 25
  });

  return aggregatePageRows((report.rows || []).map((row) => ({
    page: row.dimensionValues?.[0]?.value || '/',
    views: metricValue(row, 0),
    users: metricValue(row, 1),
    organicClicks: 0,
    organicImpressions: 0,
    shareClicks: 0,
    copyLinkClicks: 0
  })));
};

const gaShareEvents = async (token, range) => {
  const basePayload = {
    dateRanges: [range],
    dimensions: [{ name: 'pagePath' }, { name: 'customEvent:platform' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        stringFilter: { matchType: 'EXACT', value: 'social_share_click' }
      }
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 100
  };

  try {
    const report = await gaRunReport(token, basePayload);
    return aggregateShareEvents((report.rows || []).map((row) => ({
      pagePath: row.dimensionValues?.[0]?.value || '/',
      platform: row.dimensionValues?.[1]?.value || 'unknown',
      shareClicks: metricValue(row, 0),
      eventName: 'social_share_click',
      destinationUrl: ''
    })));
  } catch (error) {
    const fallback = await gaRunReport(token, {
      ...basePayload,
      dimensions: [{ name: 'pagePath' }]
    });

    return aggregateShareEvents((fallback.rows || []).map((row) => ({
      pagePath: row.dimensionValues?.[0]?.value || '/',
      platform: 'all',
      shareClicks: metricValue(row, 0),
      eventName: 'social_share_click',
      destinationUrl: '',
      note: `Platform split unavailable until the GA4 event parameter "platform" is registered as a custom dimension. Original error: ${error.message}`
    })));
  }
};

const gscTotals = async (token, range) => {
  const report = await gscQuery(token, {
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: [],
    rowLimit: 1
  });

  const row = report.rows?.[0] || {};
  return {
    organicClicks: Number(row.clicks || 0),
    organicImpressions: Number(row.impressions || 0),
    organicCtr: Number(row.ctr || 0),
    avgPosition: Number(row.position || 0)
  };
};

const searchDiscoveryFromReport = (report) => {
  const values = (report.rows || []).reduce((summary, row) => {
    const branded = isBrandedQuery(row.keys?.[0] || '');
    const prefix = branded ? 'branded' : 'nonBranded';
    summary[`${prefix}Clicks`] += Number(row.clicks || 0);
    summary[`${prefix}Impressions`] += Number(row.impressions || 0);
    return summary;
  }, {
    brandedClicks: 0,
    brandedImpressions: 0,
    nonBrandedClicks: 0,
    nonBrandedImpressions: 0
  });
  const classifiedQueryImpressions = values.brandedImpressions + values.nonBrandedImpressions;

  return {
    ...values,
    classifiedQueryImpressions,
    nonBrandedImpressionShare: classifiedQueryImpressions
      ? values.nonBrandedImpressions / classifiedQueryImpressions
      : 0
  };
};

const organicPageCoverageFromReport = (report) => ({
  organicPagesWithClicks: (report.rows || []).filter((row) => Number(row.clicks || 0) > 0).length
});

const gscDiscoveryMix = async (token, range) => {
  const [queryReport, pageReport] = await Promise.all([
    gscQuery(token, {
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ['query'],
      rowLimit: 25000,
      startRow: 0
    }),
    gscQuery(token, {
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ['page'],
      rowLimit: 25000,
      startRow: 0
    })
  ]);

  return {
    ...searchDiscoveryFromReport(queryReport),
    ...organicPageCoverageFromReport(pageReport)
  };
};

const gscTopPages = async (token, range) => {
  const report = await gscQuery(token, {
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: ['page'],
    rowLimit: 25
  });

  return (report.rows || []).map((row) => ({
    page: row.keys?.[0] || '',
    organicClicks: Number(row.clicks || 0),
    organicImpressions: Number(row.impressions || 0),
    organicCtr: Number(row.ctr || 0),
    position: Number(row.position || 0)
  }));
};

const gscTopQueries = async (token, range) => {
  const report = await gscQuery(token, {
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: ['query', 'page'],
    rowLimit: 25
  });

  return (report.rows || []).map((row) => ({
    query: row.keys?.[0] || '',
    queryType: isBrandedQuery(row.keys?.[0] || '') ? 'branded' : 'non-branded',
    topPage: groupedProjectPath(row.keys?.[1] || ''),
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: Number(row.position || 0)
  }));
};

const mergeTopPages = (gaPages, gscPages, shareEvents) => {
  const rows = new Map();

  aggregatePageRows(gaPages).forEach((page) => rows.set(page.page, { ...page }));

  gscPages.forEach((page) => {
    const key = groupedProjectPath(page.page);
    const current = rows.get(key) || {
      page: key,
      views: 0,
      users: 0,
      shareClicks: 0,
      copyLinkClicks: 0
    };
    rows.set(key, {
      ...current,
      organicClicks: Number(current.organicClicks || 0) + Number(page.organicClicks || 0),
      organicImpressions: Number(current.organicImpressions || 0) + Number(page.organicImpressions || 0)
    });
  });

  aggregateShareEvents(shareEvents).forEach((event) => {
    const current = rows.get(event.pagePath) || {
      page: event.pagePath,
      views: 0,
      users: 0,
      organicClicks: 0,
      organicImpressions: 0,
      shareClicks: 0,
      copyLinkClicks: 0
    };
    current.shareClicks += event.shareClicks;
    if (event.platform === 'copy_link') current.copyLinkClicks += event.shareClicks;
    rows.set(event.pagePath, current);
  });

  return [...rows.values()].sort((a, b) => b.views - a.views).slice(0, 25);
};

const sheetNameA1 = (sheetName) => `'${sheetName.replace(/'/g, "''")}'`;

const sheetClear = async (token, sheetName) => {
  const range = encodeURIComponent(`${sheetNameA1(sheetName)}!A:AZ`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${range}:clear`;
  await apiFetch(url, token, { method: 'POST', body: '{}' });
};

const sheetWrite = async (token, sheetName, rows) => {
  await sheetClear(token, sheetName);
  if (!rows.length) return;
  const range = encodeURIComponent(`${sheetNameA1(sheetName)}!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${range}?valueInputOption=RAW`;
  await apiFetch(url, token, {
    method: 'PUT',
    body: JSON.stringify({ values: rows })
  });
};

const buildInsights = (current, previous, topPages, topQueries, shareEvents) => {
  const pct = (now, before) => {
    if (!before && !now) return 'flat';
    if (!before) return 'new activity';
    const change = (now - before) / before;
    return `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`;
  };

  const topPage = topPages[0]?.page || 'No top page yet';
  const topQuery = topQueries[0]?.query || 'No top query yet';
  const topShare = shareEvents[0];

  return [
    `Users were ${pct(current.users, previous.users)} week over week, with ${current.users.toLocaleString('en-US')} users and ${current.views.toLocaleString('en-US')} views.`,
    `${current.engagedReferenceSessions.toLocaleString('en-US')} of ${current.referenceSessions.toLocaleString('en-US')} reference sessions were engaged (${(current.referenceEngagementRate * 100).toFixed(1)}%).`,
    `Google Search delivered ${current.organicClicks.toLocaleString('en-US')} clicks from ${current.organicImpressions.toLocaleString('en-US')} impressions.`,
    `${current.nonBrandedImpressions.toLocaleString('en-US')} classified query impressions were non-branded; AI sources referred ${current.aiReferralSessions.toLocaleString('en-US')} sessions.`,
    `Top page: ${topPage}. Top query: ${topQuery}.`,
    topShare
      ? `Most shared item: ${topShare.pagePath} via ${topShare.platform} (${topShare.shareClicks.toLocaleString('en-US')} clicks).`
      : 'No share button clicks were reported for this window.'
  ];
};

const main = async () => {
  const token = await getAccessToken();
  const ranges = completeWeekWindow();

  const [
    gaCurrent,
    gaPrevious,
    referenceCurrent,
    referencePrevious,
    acquisitionCurrent,
    acquisitionPrevious,
    gscCurrent,
    gscPrevious,
    discoveryCurrent,
    discoveryPrevious,
    gaPages,
    gscPages,
    topQueries,
    shareEvents,
    previousShareEvents
  ] = await Promise.all([
    gaTotals(token, ranges.current),
    gaTotals(token, ranges.previous),
    gaReferenceMetrics(token, ranges.current),
    gaReferenceMetrics(token, ranges.previous),
    gaAcquisitionMetrics(token, ranges.current),
    gaAcquisitionMetrics(token, ranges.previous),
    gscTotals(token, ranges.current),
    gscTotals(token, ranges.previous),
    gscDiscoveryMix(token, ranges.current),
    gscDiscoveryMix(token, ranges.previous),
    gaTopPages(token, ranges.current),
    gscTopPages(token, ranges.current),
    gscTopQueries(token, ranges.current),
    gaShareEvents(token, ranges.current),
    gaShareEvents(token, ranges.previous)
  ]);

  const summary = {
    ...gaCurrent,
    ...referenceCurrent,
    ...acquisitionCurrent,
    ...gscCurrent,
    ...discoveryCurrent,
    shareClicks: shareEvents.reduce((sum, row) => sum + row.shareClicks, 0),
    copyLinkClicks: shareEvents
      .filter((row) => row.platform === 'copy_link')
      .reduce((sum, row) => sum + row.shareClicks, 0)
  };

  const previous = {
    ...gaPrevious,
    ...referencePrevious,
    ...acquisitionPrevious,
    ...gscPrevious,
    ...discoveryPrevious,
    shareClicks: previousShareEvents.reduce((sum, row) => sum + row.shareClicks, 0),
    copyLinkClicks: previousShareEvents
      .filter((row) => row.platform === 'copy_link')
      .reduce((sum, row) => sum + row.shareClicks, 0)
  };

  const topPages = mergeTopPages(gaPages, gscPages, shareEvents);
  const insights = buildInsights(summary, previous, topPages, topQueries, shareEvents);
  const updatedAt = new Date().toISOString();
  const existingHistory = await loadExistingHistory();
  const backfillRanges = await resolveBackfillRanges(token, ranges.current);
  const { history: backfilledHistory, details: backfilledDetails } = await loadBackfilledData(token, backfillRanges);
  const backfillStart = backfilledHistory[0]?.weekStart;
  const retainedHistory = backfillStart
    ? existingHistory.filter((row) => row.weekEnd < backfillStart)
    : existingHistory;
  const history = mergeHistory(
    retainedHistory,
    backfilledHistory
  );

  const dashboard = {
    site: 'Otaku Data Viz',
    updatedAt,
    ga4PropertyId: config.ga4PropertyId,
    measurementId: 'G-653DY2M8K5',
    searchConsoleProperty: config.searchConsoleProperty,
    sheetId: config.sheetId,
    week: {
      start: ranges.current.startDate,
      end: ranges.current.endDate,
      label: `${ranges.current.startDate} to ${ranges.current.endDate}`
    },
    summary,
    previous,
    history,
    topPages,
    topQueries,
    shareEvents,
    insights
  };

  if (process.env.DRY_RUN === '1') {
    console.log(JSON.stringify({
      status: 'dry_run_success',
      week: dashboard.week.label,
      historyWeeks: history.length,
      currentChartWindow: backfilledHistory.map((row) => ({
        weekStart: row.weekStart,
        weekEnd: row.weekEnd,
        users: row.users,
        sessions: row.sessions,
        views: row.views,
        referenceSessions: row.referenceSessions,
        engagedReferenceSessions: row.engagedReferenceSessions,
        referenceEngagementRate: row.referenceEngagementRate,
        visualizationOpens: row.visualizationOpens,
        relatedReferenceClicks: row.relatedReferenceClicks,
        returningUsers: row.returningUsers,
        directSessions: row.directSessions,
        referralSessions: row.referralSessions,
        aiReferralSessions: row.aiReferralSessions,
        organicClicks: row.organicClicks,
        organicImpressions: row.organicImpressions,
        brandedImpressions: row.brandedImpressions,
        nonBrandedImpressions: row.nonBrandedImpressions,
        nonBrandedImpressionShare: row.nonBrandedImpressionShare,
        organicPagesWithClicks: row.organicPagesWithClicks,
        shareClicks: row.shareClicks
      })),
      topPages: topPages.length,
      topQueries: topQueries.length,
      shareEvents: shareEvents.length
    }, null, 2));
    return;
  }

  await mkdir(path.dirname(config.outputPath), { recursive: true });
  await writeFile(config.outputPath, `${JSON.stringify(dashboard, null, 2)}\n`);

  const detailsByWeek = new Map(
    backfilledDetails.map((detail) => [`${detail.range.startDate}:${detail.range.endDate}`, detail])
  );
  const weeklySummaryRows = [
    ['week_start', 'week_end', 'users', 'sessions', 'views', 'engagement_rate', 'reference_sessions', 'engaged_reference_sessions', 'reference_engagement_rate', 'visualization_opens', 'related_reference_clicks', 'returning_users', 'direct_sessions', 'referral_sessions', 'ai_referral_sessions', 'organic_clicks', 'organic_impressions', 'organic_ctr', 'avg_position', 'branded_clicks', 'branded_impressions', 'non_branded_clicks', 'non_branded_impressions', 'classified_query_impressions', 'non_branded_impression_share', 'organic_pages_with_clicks', 'share_clicks', 'copy_link_clicks', 'top_page', 'top_query', 'summary', 'updated_at'],
    ...history.map((row) => {
      const detail = detailsByWeek.get(`${row.weekStart}:${row.weekEnd}`);
      const rowSummary = row.weekStart === ranges.current.startDate && row.weekEnd === ranges.current.endDate
        ? insights.join(' ')
        : '';
      return [
        row.weekStart,
        row.weekEnd,
        row.users,
        row.sessions,
        row.views,
        row.engagementRate,
        row.referenceSessions,
        row.engagedReferenceSessions,
        row.referenceEngagementRate,
        row.visualizationOpens,
        row.relatedReferenceClicks,
        row.returningUsers,
        row.directSessions,
        row.referralSessions,
        row.aiReferralSessions,
        row.organicClicks,
        row.organicImpressions,
        row.organicCtr,
        row.avgPosition,
        row.brandedClicks,
        row.brandedImpressions,
        row.nonBrandedClicks,
        row.nonBrandedImpressions,
        row.classifiedQueryImpressions,
        row.nonBrandedImpressionShare,
        row.organicPagesWithClicks,
        row.shareClicks,
        row.copyLinkClicks,
        detail?.topPages?.[0]?.page || '',
        detail?.topQueries?.[0]?.query || '',
        rowSummary,
        updatedAt
      ];
    })
  ];

  const topPageRows = [
    ['week_start', 'week_end', 'page', 'views', 'users', 'organic_clicks', 'organic_impressions', 'share_clicks', 'copy_link_clicks'],
    ...backfilledDetails.flatMap((detail) => detail.topPages.map((row) => [
      detail.range.startDate,
      detail.range.endDate,
      row.page,
      row.views,
      row.users,
      row.organicClicks,
      row.organicImpressions,
      row.shareClicks,
      row.copyLinkClicks
    ]))
  ];

  const topQueryRows = [
    ['week_start', 'week_end', 'query', 'query_type', 'clicks', 'impressions', 'ctr', 'position', 'top_page'],
    ...backfilledDetails.flatMap((detail) => detail.topQueries.map((row) => [
      detail.range.startDate,
      detail.range.endDate,
      row.query,
      row.queryType,
      row.clicks,
      row.impressions,
      row.ctr,
      row.position,
      row.topPage
    ]))
  ];

  const shareEventRows = [
    ['week_start', 'week_end', 'page_path', 'platform', 'share_clicks', 'event_name', 'destination_url'],
    ...backfilledDetails.flatMap((detail) => {
      if (!detail.shareEvents.length) {
        return [[
          detail.range.startDate,
          detail.range.endDate,
          'No social_share_click events reported',
          'none',
          0,
          'social_share_click',
          ''
        ]];
      }
      return detail.shareEvents.map((row) => [
        detail.range.startDate,
        detail.range.endDate,
        row.pagePath,
        row.platform,
        row.shareClicks,
        row.eventName,
        row.destinationUrl
      ]);
    })
  ];

  const dashboardRows = [
    ['Otaku Data Viz Performance Dashboard'],
    ['GA4 Property ID', config.ga4PropertyId, 'Search Console Property', config.searchConsoleProperty],
    ['Measurement ID', 'G-653DY2M8K5', 'Weekly Run', 'Sunday 8:00 AM Eastern'],
    ['Metric', 'This Week', 'Previous Week', 'WoW Change'],
    ['Users', summary.users, previous.users, `${summary.users - previous.users}`],
    ['Sessions', summary.sessions, previous.sessions, `${summary.sessions - previous.sessions}`],
    ['Views', summary.views, previous.views, `${summary.views - previous.views}`],
    ['Engagement rate', summary.engagementRate, previous.engagementRate, `${summary.engagementRate - previous.engagementRate}`],
    ['Reference sessions', summary.referenceSessions, previous.referenceSessions, `${summary.referenceSessions - previous.referenceSessions}`],
    ['Engaged reference sessions', summary.engagedReferenceSessions, previous.engagedReferenceSessions, `${summary.engagedReferenceSessions - previous.engagedReferenceSessions}`],
    ['Reference engagement rate', summary.referenceEngagementRate, previous.referenceEngagementRate, `${summary.referenceEngagementRate - previous.referenceEngagementRate}`],
    ['Visualization opens', summary.visualizationOpens, previous.visualizationOpens, `${summary.visualizationOpens - previous.visualizationOpens}`],
    ['Related-reference clicks', summary.relatedReferenceClicks, previous.relatedReferenceClicks, `${summary.relatedReferenceClicks - previous.relatedReferenceClicks}`],
    ['Returning users', summary.returningUsers, previous.returningUsers, `${summary.returningUsers - previous.returningUsers}`],
    ['Direct sessions', summary.directSessions, previous.directSessions, `${summary.directSessions - previous.directSessions}`],
    ['Referral sessions', summary.referralSessions, previous.referralSessions, `${summary.referralSessions - previous.referralSessions}`],
    ['AI referral sessions', summary.aiReferralSessions, previous.aiReferralSessions, `${summary.aiReferralSessions - previous.aiReferralSessions}`],
    ['Organic clicks', summary.organicClicks, previous.organicClicks, `${summary.organicClicks - previous.organicClicks}`],
    ['Organic impressions', summary.organicImpressions, previous.organicImpressions, `${summary.organicImpressions - previous.organicImpressions}`],
    ['Organic CTR', summary.organicCtr, previous.organicCtr, `${summary.organicCtr - previous.organicCtr}`],
    ['Avg. organic position', summary.avgPosition, previous.avgPosition, `${summary.avgPosition - previous.avgPosition}`],
    ['Branded clicks (classified queries)', summary.brandedClicks, previous.brandedClicks, `${summary.brandedClicks - previous.brandedClicks}`],
    ['Branded impressions (classified queries)', summary.brandedImpressions, previous.brandedImpressions, `${summary.brandedImpressions - previous.brandedImpressions}`],
    ['Non-branded clicks (classified queries)', summary.nonBrandedClicks, previous.nonBrandedClicks, `${summary.nonBrandedClicks - previous.nonBrandedClicks}`],
    ['Non-branded impressions (classified queries)', summary.nonBrandedImpressions, previous.nonBrandedImpressions, `${summary.nonBrandedImpressions - previous.nonBrandedImpressions}`],
    ['Non-branded impression share', summary.nonBrandedImpressionShare, previous.nonBrandedImpressionShare, `${summary.nonBrandedImpressionShare - previous.nonBrandedImpressionShare}`],
    ['Organic pages with clicks', summary.organicPagesWithClicks, previous.organicPagesWithClicks, `${summary.organicPagesWithClicks - previous.organicPagesWithClicks}`],
    ['Share clicks', summary.shareClicks, previous.shareClicks, `${summary.shareClicks - previous.shareClicks}`],
    ['Copy-link clicks', summary.copyLinkClicks, previous.copyLinkClicks, `${summary.copyLinkClicks - previous.copyLinkClicks}`],
    ['Latest weekly readout', insights.join(' ')],
    ['Trend history', `${backfillRanges[0].startDate} to ${backfillRanges[backfillRanges.length - 1].endDate}`, `${backfilledHistory.length} API-backed weekly buckets; local dashboard aggregates weekly, monthly, and annual views`]
  ];

  const automationRows = [
    ['run_at', 'status', 'week_start', 'week_end', 'notes', 'next_steps'],
    [
      updatedAt,
      'success',
      ranges.current.startDate,
      ranges.current.endDate,
      `Rebuilt Sheet tabs idempotently from API data. Dashboard history contains ${history.length} weekly rows for weekly, monthly, and annual local dashboard views.`,
      shareEvents.some((row) => row.note)
        ? 'Register platform as a GA4 event-scoped custom dimension for platform-level share splits.'
        : ''
    ]
  ];

  if (!config.skipSheets) {
    await Promise.all([
      sheetWrite(token, 'Dashboard', dashboardRows),
      sheetWrite(token, 'Weekly Summary', weeklySummaryRows),
      sheetWrite(token, 'Top Pages', topPageRows),
      sheetWrite(token, 'Top Queries', topQueryRows),
      sheetWrite(token, 'Share Events', shareEventRows),
      sheetWrite(token, 'Automation Notes', automationRows)
    ]);
  }

  console.log(JSON.stringify({
    status: 'success',
    week: dashboard.week.label,
    historyWeeks: history.length,
    sheetsUpdated: !config.skipSheets,
    sheet: `https://docs.google.com/spreadsheets/d/${config.sheetId}/edit`,
    localDashboard: 'analytics-dashboard.html'
  }, null, 2));
};

if (process.env.VERIFY_PROJECT_GROUPING === '1') {
  const expectedGroups = [
    ['/dragonball-character-sociogram/', '/projects/dragon-ball-sociogram.html'],
    ['/dragonball-character-sociogram/index.html', '/projects/dragon-ball-sociogram.html'],
    ['/manga-timeline.html', '/projects/manga-anime-timeline.html'],
    ['/pokemon_territory_map.html', '/projects/pokedex-type-treemap.html'],
    ['/nintendo-game-universe-map.html', '/projects/nintendo-game-universe-map.html'],
    ['/gundam-universe-map.html', '/projects/gundam-universe-map.html']
  ];
  const mismatches = expectedGroups.filter(([input, expected]) => groupedProjectPath(input) !== expected);
  if (mismatches.length) {
    throw new Error(`Project grouping verification failed: ${JSON.stringify(mismatches)}`);
  }
  const referenceFixture = referenceMetricsFromReport({
    rows: [
      { dimensionValues: [{ value: 'project_page_view' }], metricValues: [{ value: '14' }, { value: '10' }] },
      { dimensionValues: [{ value: 'reference_engagement' }], metricValues: [{ value: '9' }, { value: '7' }] },
      { dimensionValues: [{ value: 'open_interactive_visualization' }], metricValues: [{ value: '4' }, { value: '3' }] },
      { dimensionValues: [{ value: 'click_related_project' }], metricValues: [{ value: '2' }, { value: '2' }] }
    ]
  });
  if (
    referenceFixture.referenceSessions !== 10
    || referenceFixture.engagedReferenceSessions !== 7
    || referenceFixture.referenceEngagementRate !== 0.7
    || referenceFixture.visualizationOpens !== 4
    || referenceFixture.relatedReferenceClicks !== 2
  ) {
    throw new Error(`Reference metric verification failed: ${JSON.stringify(referenceFixture)}`);
  }
  const acquisitionFixture = acquisitionMetricsFromReports({
    rows: [
      { dimensionValues: [{ value: '(direct)' }, { value: '(none)' }], metricValues: [{ value: '4' }] },
      { dimensionValues: [{ value: 'chatgpt.com' }, { value: 'referral' }], metricValues: [{ value: '2' }] },
      { dimensionValues: [{ value: 'reddit.com' }, { value: 'referral' }], metricValues: [{ value: '3' }] }
    ]
  }, {
    rows: [
      { dimensionValues: [{ value: 'new' }], metricValues: [{ value: '6' }] },
      { dimensionValues: [{ value: 'returning' }], metricValues: [{ value: '5' }] }
    ]
  });
  if (
    acquisitionFixture.returningUsers !== 5
    || acquisitionFixture.directSessions !== 4
    || acquisitionFixture.referralSessions !== 5
    || acquisitionFixture.aiReferralSessions !== 2
  ) {
    throw new Error(`Acquisition metric verification failed: ${JSON.stringify(acquisitionFixture)}`);
  }
  const discoveryFixture = searchDiscoveryFromReport({
    rows: [
      { keys: ['otaku data viz'], clicks: 1, impressions: 10 },
      { keys: ['anime history timeline'], clicks: 4, impressions: 90 }
    ]
  });
  if (
    discoveryFixture.brandedClicks !== 1
    || discoveryFixture.brandedImpressions !== 10
    || discoveryFixture.nonBrandedClicks !== 4
    || discoveryFixture.nonBrandedImpressions !== 90
    || discoveryFixture.nonBrandedImpressionShare !== 0.9
  ) {
    throw new Error(`Search discovery verification failed: ${JSON.stringify(discoveryFixture)}`);
  }
  const coverageFixture = organicPageCoverageFromReport({
    rows: [
      { keys: ['https://otakudataviz.com/a'], clicks: 2, impressions: 20 },
      { keys: ['https://otakudataviz.com/b'], clicks: 0, impressions: 12 },
      { keys: ['https://otakudataviz.com/c'], clicks: 1, impressions: 8 }
    ]
  });
  if (coverageFixture.organicPagesWithClicks !== 2) {
    throw new Error(`Organic page coverage verification failed: ${JSON.stringify(coverageFixture)}`);
  }
  console.log(`Project analytics grouping passed for ${expectedGroups.length} interactive URL variants.`);
  console.log('Reference session metric mapping passed for the offline GA4 fixture.');
  console.log('Acquisition and branded discovery mapping passed for offline fixtures.');
} else {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
