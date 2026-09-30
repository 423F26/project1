'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
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
    assert.equal(store.recent().length, 1);
    store.close();
    store = openStore(file);
    assert.equal(store.recent().length, 1);
    const html = renderFeed(store.recent());
    assert.match(html, /Bank &amp; alert\(1\)/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /A &amp; B/);
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
    assert.equal(store.recent()[0].title, 'Corrected');
    assert.equal(store.recent()[0].excerpt, 'Updated excerpt');
    store.save(Array.from({ length: 110 }, (_, i) => ({ ...item, itemId: `repeat-${i}` })));
    store.save(Array.from({ length: 20 }, (_, i) => ({ ...item, itemId: `distinct-${i}`, link: `https://www.sec.gov/item-${i}`, publishedAt: '2026-09-29T12:00:00Z' })));
    assert.equal(store.recent().length, 20);
  } finally { store.close(); }
});
