'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { createServer, hosts } = require('../src/server');

test('validates and normalizes allowed hosts', () => {
  assert.deepEqual(hosts('Plaintext.Example.com'), new Set(['plaintext.example.com']));
  assert.throws(() => hosts('https://bad.example.com'));
});

function request(server, { method = 'GET', url = '/', host = 'plaintext.example.com', headers = {} } = {}) {
  const input = new EventEmitter();
  input.method = method;
  input.url = url;
  input.headers = { host, ...headers };
  input.socket = { remoteAddress: '127.0.0.1' };
  const output = {
    writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders; },
    end(body) { this.body = body; }
  };
  server.emit('request', input, output);
  return output;
}

test('serves the HTML root and feed API with the configured request protections', () => {
  const html = readFileSync(require.resolve('../public/index.html'), 'utf8');
  const server = createServer({ tls: {}, allowedHosts: new Set(['plaintext.example.com']), rateLimit: 10, html });
  const success = request(server);
  assert.equal(success.status, 200);
  assert.match(success.body, /No updates available yet/);
  assert.equal(success.headers['content-type'], 'text/html; charset=utf-8');
  const scripts = [...success.body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.match(success.body, /<script data-cfasync="false">/);
  const scriptHash = createHash('sha256').update(scripts[0][1]).digest('base64');
  assert.equal(success.headers['content-security-policy'].split('; ').find(rule => rule.startsWith('script-src ')), `script-src 'sha256-${scriptHash}'`);
  for (const rule of ["default-src 'none'", "img-src https:", "connect-src 'self'", "frame-src 'none'", "form-action 'none'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) assert.ok(success.headers['content-security-policy'].includes(rule));
  assert.equal(success.headers['referrer-policy'], 'no-referrer');
  for (const value of ['Financial review', 'Find company filings', 'Recent Filings']) assert.match(success.body, new RegExp(value));
  for (const value of ['RSS source manager', 'WirtschaftsWoche Finanzen', 'Add RSS feed URL', 'Directional bias']) assert.doesNotMatch(success.body, new RegExp(value));
  assert.match(success.body, /<button id="language-toggle" type="button"/);
  assert.match(success.body, /<button type="button"><span data-de="Berichte suchen">Find filings<\/span><\/button>/);
  assert.equal((success.body.match(/<input[^>]*type="url"/g) ?? []).length, 0);
  assert.equal((success.body.match(/<article/g) ?? []).length, 0);
  assert.equal((success.body.match(/<form\b/g) ?? []).length, 1);
  assert.match(success.body, /<form class="filter-controls">/);
  assert.match(success.body, /<nav class="feed-pagination"[^>]* hidden>/);
  const feed = request(server, { url: '/api/filings' });
  assert.equal(feed.status, 200);
  assert.equal(feed.headers['content-type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(feed.body).items, []);
  assert.equal(request(server, { url: '/api/filings?source=unknown' }).status, 400);
  const notFound = request(server, { url: '/anything' });
  const methodNotAllowed = request(server, { method: 'HEAD' });
  const post = request(server, { method: 'POST' });
  const wrongHost = request(server, { host: 'attacker.example' });
  const body = request(server, { headers: { 'content-length': '1' } });
  for (const response of [notFound, methodNotAllowed, post, wrongHost, body]) assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(notFound.status, 404);
  assert.equal(methodNotAllowed.status, 405);
  assert.equal(post.status, 405);
  assert.equal(wrongHost.status, 421);
  assert.equal(body.status, 413);
});

test('serves saved feed entries without publisher requests', () => {
  const html = readFileSync(require.resolve('../public/index.html'), 'utf8');
  const queries = [];
  const server = createServer({ tls: {}, allowedHosts: new Set(['plaintext.example.com']), rateLimit: 10, html, store: {
    page: options => {
      queries.push(options);
      return {
        items: [{ publisher: 'ECB', title: 'New & important $&', link: 'https://www.ecb.europa.eu/news', published_at: '2026-09-30T12:00:00.000Z', excerpt: 'Policy update' }],
        nextCursor: { secOffset: 0, otherOffset: 1 }, hasMore: false,
        totalPages: 1, totalCounts: { sec: 0, other: 1 }
      };
    }
  } });
  const response = request(server);
  assert.equal(response.status, 200);
  assert.match(response.body, /New &amp; important \$&/);
  assert.match(response.body, /href="https:\/\/www\.ecb\.europa\.eu\/news" target="_blank" rel="noopener noreferrer"/);
  assert.match(response.body, /<span class="publisher">ECB<\/span>/);
  assert.match(response.body, /<time datetime="2026-09-30T12:00:00.000Z">2026-09-30<\/time>/);
  assert.doesNotMatch(response.body, /Policy update/);
  assert.doesNotMatch(response.body, /FEED_ITEMS|RSS source manager|Directional bias/);
  const feed = request(server, { url: '/api/filings?source=ECB&from=2026-09-01&to=2026-09-30' });
  assert.equal(feed.status, 200);
  const page = JSON.parse(feed.body);
  assert.match(page.html, /New &amp; important \$&/);
  assert.doesNotMatch(page.html, /Policy update/);
  assert.deepEqual(queries, [
    { limit: 20, secOffset: 0, otherOffset: 0 },
    { limit: 20, secOffset: 0, otherOffset: 0, source: 'ECB', from: '2026-09-01', to: '2026-09-30' }
  ]);
});
