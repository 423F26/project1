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
    const title = clean(item.title);
    if (!link || !title) return [];
    const rawDate = value(item.pubDate ?? item['dc:date'] ?? item.published ?? item.updated);
    const date = Date.parse(rawDate);
    return [{
      sourceUrl, publisher, itemId: value(item.guid ?? item.id) || link,
      title, link, publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
      excerpt: clean(item.description ?? item.summary ?? item['content:encoded']).slice(0, 500), fetchedAt
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
    PRIMARY KEY (source_url, item_id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS feed_items_recent ON feed_items(COALESCE(published_at, fetched_at) DESC)');
  const insert = db.prepare(`INSERT INTO feed_items
    (source_url, publisher, item_id, title, link, published_at, excerpt, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source_url, item_id) DO UPDATE SET
      publisher = excluded.publisher, title = excluded.title, link = excluded.link,
      published_at = excluded.published_at, excerpt = excluded.excerpt, fetched_at = excluded.fetched_at`);
  const recent = db.prepare(`SELECT publisher, title, link, published_at, excerpt FROM (
    SELECT publisher, title, link, published_at, excerpt,
      COALESCE(published_at, fetched_at) AS sort_date,
      ROW_NUMBER() OVER (PARTITION BY link ORDER BY COALESCE(published_at, fetched_at) DESC) AS rank
    FROM feed_items
  ) WHERE rank = 1 ORDER BY sort_date DESC LIMIT 20`);
  return {
    save(items) {
      db.exec('BEGIN');
      try {
        for (const item of items) insert.run(item.sourceUrl, item.publisher, item.itemId, item.title, item.link, item.publishedAt, item.excerpt, item.fetchedAt);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    recent: () => recent.all(),
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
