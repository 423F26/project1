'use strict';

const { DatabaseSync } = require('node:sqlite');
const { XMLParser, XMLValidator } = require('fast-xml-parser');

const HOUR = 60 * 60 * 1000;
const sources = [
  ['ECB', 'https://www.ecb.europa.eu/rss/press.html'],
  ['ECB', 'https://www.ecb.europa.eu/rss/statpress.html'],
  ['ECB', 'https://www.ecb.europa.eu/rss/procurements.html'],
  ['BaFin', 'https://www.bafin.de/EN/service/rss/_function/RSS_Aufsicht.xml?nn=187494'],
  ['BaFin', 'https://www.bafin.de/EN/service/rss/_function/RSS_Presse.xml?nn=187494'],
  ['SEC', 'https://www.sec.gov/Archives/edgar/usgaap.rss.xml'],
  ['SEC', 'https://www.sec.gov/Archives/edgar/xbrlrss.all.xml'],
  ['SEC', 'https://www.sec.gov/Archives/edgar/xbrl-rr.rss.xml']
];
const parser = new XMLParser({ ignoreAttributes: false, htmlEntities: true });

function value(field) {
  if (typeof field === 'string' || typeof field === 'number') return String(field);
  if (field && typeof field === 'object') return value(field['#text']);
  return '';
}

function clean(field) {
  return value(field).replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, (entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (entity[1] !== '#') return named[entity.slice(1, -1).toLowerCase()];
    const point = entity[2]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(3, -1), 16) : Number.parseInt(entity.slice(2, -1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  }).replace(/\s+/g, ' ').trim();
}

function field(item, names) {
  for (const name of names) {
    const result = clean(item[name]);
    if (result) return result;
  }
  return '';
}

function formType(item, excerpt) {
  const explicit = field(item, ['edgar:formType', 'formType', 'edgar:form', 'form']);
  if (explicit) return explicit;
  const code = /^([A-Z0-9-]{1,12})$/.exec(excerpt)?.[1];
  return code ?? '';
}

function itemLink(field) {
  const raw = typeof field === 'object' && field !== null ? field['@_href'] : value(field);
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' && ['www.sec.gov', 'www.ecb.europa.eu', 'www.bafin.de'].includes(url.hostname)) url.protocol = 'https:';
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

function parseFeed(xml, sourceUrl, publisher, fetchedAt) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid feed XML');
  const data = parser.parse(xml);
  const entries = data.rss?.channel?.item ?? data.feed?.entry ?? [];
  if (!data.rss && !data.feed) throw new Error('Not an RSS or Atom document');
  return (Array.isArray(entries) ? entries : [entries]).flatMap((item) => {
    const link = itemLink(item.link);
    const rawTitle = clean(item.title);
    const companyName = field(item, ['edgar:companyName', 'companyName', 'company']);
    const title = publisher === 'SEC'
      ? (companyName || rawTitle.replace(/\s+\(\d{6,}\)\s+\(Filer\)$/i, ''))
      : rawTitle;
    if (!link || !title) return [];
    const rawDate = value(item.pubDate ?? item['dc:date'] ?? item.published ?? item.updated);
    const date = Date.parse(rawDate);
    const excerpt = clean(item.description ?? item.summary ?? item['content:encoded']).slice(0, 500);
    return [{
      sourceUrl, publisher, itemId: value(item.guid ?? item.id) || link,
      title, link, publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
      excerpt, companyName: publisher === 'SEC' ? title : '',
      formType: publisher === 'SEC' ? formType(item, excerpt) : '', fetchedAt
    }];
  });
}

function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS feed_items (
    source_url TEXT NOT NULL,
    publisher TEXT NOT NULL,
    item_id TEXT NOT NULL,
    title TEXT NOT NULL,
    link TEXT NOT NULL,
    published_at TEXT,
    excerpt TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    company_name TEXT NOT NULL DEFAULT '',
    form_type TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (source_url, item_id)
  )`);
  const columns = new Set(db.prepare('PRAGMA table_info(feed_items)').all().map((column) => column.name));
  if (!columns.has('company_name')) db.exec("ALTER TABLE feed_items ADD COLUMN company_name TEXT NOT NULL DEFAULT ''");
  if (!columns.has('form_type')) db.exec("ALTER TABLE feed_items ADD COLUMN form_type TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE INDEX IF NOT EXISTS feed_items_recent ON feed_items(COALESCE(published_at, fetched_at) DESC)');
  const insert = db.prepare(`INSERT INTO feed_items
    (source_url, publisher, item_id, title, link, published_at, excerpt, fetched_at, company_name, form_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source_url, item_id) DO UPDATE SET
      publisher = excluded.publisher, title = excluded.title, link = excluded.link,
      published_at = excluded.published_at, excerpt = excluded.excerpt, fetched_at = excluded.fetched_at,
      company_name = excluded.company_name, form_type = excluded.form_type`);
  const recent = db.prepare(`SELECT publisher, title, link, published_at, excerpt, company_name, form_type FROM (
    SELECT publisher, title, link, published_at, excerpt, company_name, form_type,
      COALESCE(published_at, fetched_at) AS sort_date,
      ROW_NUMBER() OVER (PARTITION BY link ORDER BY COALESCE(published_at, fetched_at) DESC) AS rank
    FROM feed_items WHERE (? = '' OR publisher = ?)
      AND (? = '' OR date(COALESCE(published_at, fetched_at)) >= date(?))
      AND (? = '' OR date(COALESCE(published_at, fetched_at)) <= date(?))
    ) WHERE rank = 1 ORDER BY sort_date DESC, link ASC LIMIT ? OFFSET ?`);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM (
    SELECT link, ROW_NUMBER() OVER (PARTITION BY link ORDER BY COALESCE(published_at, fetched_at) DESC) AS rank
    FROM feed_items WHERE (? = '' OR publisher = ?)
      AND (? = '' OR date(COALESCE(published_at, fetched_at)) >= date(?))
      AND (? = '' OR date(COALESCE(published_at, fetched_at)) <= date(?))
    ) WHERE rank = 1`);
  return {
    save(items) {
      db.exec('BEGIN');
      try {
        for (const item of items) insert.run(item.sourceUrl, item.publisher, item.itemId, item.title, item.link, item.publishedAt, item.excerpt, item.fetchedAt, item.companyName ?? '', item.formType ?? '');
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    recent({ limit = 20, offset = 0, source = '', from = '', to = '' } = {}) {
      return recent.all(source, source, from, from, to, to, limit, offset);
    },
    page({ limit = 20, offset = 0, source = '', from = '', to = '' } = {}) {
      const rows = recent.all(source, source, from, from, to, to, limit, offset);
      let secCount = 0;
      const items = rows.filter((row) => row.publisher !== 'SEC' || secCount++ < 8);
      const count = total.get(source, source, from, from, to, to).count;
      const nextOffset = offset + rows.length;
      return { items, nextOffset, hasMore: nextOffset < count };
    },
    close: () => db.close()
  };
}

async function fetchXml(url, userAgent, fetcher = fetch) {
  const host = new URL(url).host;
  const signal = AbortSignal.timeout(10_000);
  let target = url;
  let response;
  for (let redirects = 0; redirects < 3; redirects++) {
    response = await fetcher(target, { headers: { 'user-agent': userAgent, accept: 'application/rss+xml, application/atom+xml, text/xml, application/xml' }, signal, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw new Error('Feed redirect has no location');
    const next = new URL(location, target);
    if (next.protocol !== 'https:' || next.host !== host) throw new Error('Feed redirected outside its publisher host');
    target = next.href;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Feed exceeds 2 MiB');
      chunks.push(chunk);
    }
  } finally { reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  const declaration = bytes.subarray(0, 256).toString('ascii').match(/<\?xml\b[^>]*encoding\s*=\s*["']([^"']+)["']/i);
  return new TextDecoder(declaration?.[1] ?? 'utf-8', { fatal: true }).decode(bytes);
}

function startCollector(store, { fetcher = fetch, now = () => new Date(), schedule = setInterval, logger = console } = {}) {
  let running = false;
  async function refresh() {
    if (running) return;
    running = true;
    try {
      for (const [publisher, url] of sources) {
        try {
          const userAgent = publisher === 'SEC'
            ? 'FinancialBiasDetector/0.0.1 (charles.smith26@student.montana.edu)'
            : 'FinancialBiasDetector/0.0.1';
          const xml = await fetchXml(url, userAgent, fetcher);
          store.save(parseFeed(xml, url, publisher, now().toISOString()));
        } catch (error) { logger.error(`RSS refresh failed for ${url}: ${error.message}`); }
      }
    } finally { running = false; }
  }
  const ready = refresh();
  const timer = schedule(refresh, HOUR);
  return { ready, refresh, stop: () => clearInterval(timer) };
}

module.exports = { HOUR, sources, parseFeed, openStore, startCollector, fetchXml };
