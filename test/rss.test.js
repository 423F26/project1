'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { HOUR, sources, parseFeed, openStore, startCollector, fetchXml } = require('../src/rss');
const { renderFeed } = require('../src/server');

const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><guid>one</guid><title>Bank &amp; &lt;script&gt;alert(1)&lt;/script&gt;</title>
  <link>http://www.sec.gov/Archives/edgar/one</link><pubDate>Wed, 30 Sep 2026 12:00:00 GMT</pubDate>
  <description>&lt;p&gt;A &amp;amp; B&lt;/p&gt;</description></item>
</channel></rss>`;

test('accepts dated BaFin-style RSS and Atom entries without GUIDs', () => {
  const fetchedAt = '2026-09-30T13:00:00.000Z';
  const bafin = parseFeed('<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item><title>Notice</title><link>https://www.bafin.de/notice</link><dc:date>2026-09-30T12:00:00Z</dc:date></item></channel></rss>', sources[3][1], 'BaFin', fetchedAt);
  assert.equal(bafin[0].itemId, bafin[0].link);
  assert.equal(bafin[0].publishedAt, '2026-09-30T12:00:00.000Z');
  const atom = parseFeed('<feed><entry><id>ecb-1</id><title>ECB update</title><link href="https://www.ecb.europa.eu/update"/><updated>2026-09-30T12:00:00Z</updated></entry></feed>', sources[0][1], 'ECB', fetchedAt);
  assert.equal(atom[0].itemId, 'ecb-1');
  assert.equal(atom[0].link, 'https://www.ecb.europa.eu/update');
});

test('parses feed entries, persists and deduplicates across restarts, and escapes rendered text', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rss-test-'));
  try {
    const file = join(directory, 'rss.sqlite');
    const items = parseFeed(rss, sources[5][1], 'SEC', '2026-09-30T13:00:00.000Z');
    assert.equal(items.length, 1);
    assert.equal(items[0].link, 'https://www.sec.gov/Archives/edgar/one');
    assert.equal(items[0].excerpt, 'A & B');
    let store = openStore(file);
    store.save(items);
    store.save(items);
    store.save([{ ...items[0], sourceUrl: sources[6][1] }]);
    assert.equal(store.recent({ now: '2026-09-30T14:00:00Z' }).length, 1);
    store.close();
    store = openStore(file);
    assert.equal(store.recent({ now: '2026-09-30T14:00:00Z' }).length, 1);
    const html = renderFeed(store.recent({ now: '2026-09-30T14:00:00Z' }));
    assert.match(html, /SEC filing/);
    assert.match(html, /data-de="Veröffentlicht">Published<\/span>: <time[^>]*>09-30-2026 <span data-de="um">at<\/span> 6:00 AM MDT<\/time> · <span data-de="Abgerufen um">Fetched at<\/span> <time[^>]*>7:00 AM MDT<\/time>/);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /A &amp; B/);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('one site-wide hourly refresh continues after a source fails and skips overlap', async () => {
  let tick, release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [], errors = [], saved = [];
  const collector = startCollector({ save: (items) => saved.push(...items) }, {
    now: () => new Date('2026-09-30T13:00:00.000Z'),
    schedule: (callback, delay) => { tick = callback; assert.equal(delay, HOUR); return 0; },
    logger: { error: (message) => errors.push(message) },
    fetcher: async (url, options) => {
      calls.push(url);
      if (calls.length === 1) await gate;
      if (url === sources[3][1]) throw new Error('unavailable');
      if (url.includes('sec.gov')) assert.match(options.headers['user-agent'], /charles\.smith26@student\.montana\.edu/);
      else assert.doesNotMatch(options.headers['user-agent'], /@/);
      return new Response(rss, { status: 200 });
    }
  });
  await tick();
  assert.equal(calls.length, 1);
  release();
  await collector.ready;
  assert.equal(calls.length, 8);
  assert.equal(saved.length, 7);
  assert.equal(errors.length, 1);
  await tick();
  assert.equal(calls.length, 16);
  collector.stop();
});

test('rejects malformed XML, oversized feeds, and redirects to another host', async () => {
  assert.throws(() => parseFeed('<!DOCTYPE rss><rss/>', sources[0][1], 'ECB', new Date().toISOString()), /Invalid feed XML/);
  await assert.rejects(fetchXml(sources[0][1], 'test', async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))), /exceeds 2 MiB/);
  await assert.rejects(fetchXml(sources[0][1], 'test', async () => new Response(null, {
    status: 302, headers: { location: 'https://example.com/feed.xml' }
  })), /outside its publisher host/);
});

test('decodes the Windows-1252 encoding used by SEC feeds', async () => {
  const bytes = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="windows-1252"?><rss><channel><item><title>Caf'), Buffer.from([0xe9]), Buffer.from('</title><link>https://www.sec.gov/item</link></item></channel></rss>')]);
  const xml = await fetchXml(sources[5][1], 'test', async () => new Response(bytes));
  assert.equal(parseFeed(xml, sources[5][1], 'SEC', '2026-09-30T13:00:00Z')[0].title, 'Café');
});

test('applies corrections and finds 20 distinct links beyond repeated rows', () => {
  const store = openStore(':memory:');
  try {
    const item = parseFeed(rss, sources[5][1], 'SEC', '2026-09-30T13:00:00Z')[0];
    store.save([item]);
    store.save([{ ...item, title: 'Corrected', excerpt: 'Updated excerpt' }]);
    assert.equal(store.recent({ now: '2026-09-30T14:00:00Z' })[0].title, 'Corrected');
    assert.equal(store.recent({ now: '2026-09-30T14:00:00Z' })[0].excerpt, 'Updated excerpt');
    store.save(Array.from({ length: 110 }, (_, i) => ({ ...item, itemId: `repeat-${i}` })));
    store.save(Array.from({ length: 20 }, (_, i) => ({ ...item, itemId: `distinct-${i}`, link: `https://www.sec.gov/item-${i}`, publishedAt: '2026-09-29T12:00:00Z' })));
    assert.equal(store.recent({ now: '2026-09-30T14:00:00Z' }).length, 20);
  } finally { store.close(); }
});

test('keeps first discovery across later scrapes and duplicate feeds at the inclusive 24-hour boundary', () => {
  const store = openStore(':memory:');
  try {
    const first = parseFeed(rss, sources[5][1], 'SEC', '2026-09-30T12:00:00.000Z')[0];
    store.save([first]);
    store.save([{ ...first, sourceUrl: sources[6][1], fetchedAt: '2026-10-01T11:59:00.000Z' }]);
    assert.equal(store.recent({ now: '2026-10-01T12:00:00.000Z' }).length, 1);
    assert.equal(store.recent({ now: '2026-10-01T12:00:00.001Z' }).length, 0);
    store.close();
  } finally { try { store.close(); } catch {} }
});

test('migrates legacy feed rows without inventing first-discovery times', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rss-migration-'));
  try {
    const file = join(directory, 'old.sqlite'), database = new DatabaseSync(file);
    database.exec(`CREATE TABLE feed_items (source_url TEXT NOT NULL,publisher TEXT NOT NULL,item_id TEXT NOT NULL,title TEXT NOT NULL,link TEXT NOT NULL,published_at TEXT,excerpt TEXT NOT NULL,fetched_at TEXT NOT NULL,company_name TEXT NOT NULL DEFAULT '',form_type TEXT NOT NULL DEFAULT '',PRIMARY KEY(source_url,item_id))`);
    database.prepare('INSERT INTO feed_items VALUES(?,?,?,?,?,?,?,?,?,?)').run('old-feed','SEC','old','Legacy Co','https://www.sec.gov/legacy','2026-10-01T11:00:00Z','','2026-10-01T11:30:00Z','Legacy Co','10-K');
    database.close();
    const store = openStore(file);
    try {
      store.save([{ sourceUrl: 'new-feed', publisher: 'SEC', itemId: 'new-id', title: 'Updated Legacy Co', link: 'https://www.sec.gov/legacy', publishedAt: '2026-10-01T11:55:00Z', excerpt: '', fetchedAt: '2026-10-01T11:59:00Z', companyName: 'Legacy Co', formType: '10-K' }]);
      assert.equal(store.recent({ now: '2026-10-01T12:00:00Z' }).length, 0);
    }
    finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
