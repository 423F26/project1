'use strict';

const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const https = require('node:https');
const { openStore, startCollector } = require('./rss');

const headers = {
  'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'
};

function hosts(value) {
  const result = new Set((value ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));
  if (!result.size || [...result].some((host) => !/^[a-z0-9.-]+$/.test(host))) throw new Error('ALLOWED_HOSTS must be DNS hostnames');
  return result;
}

function reply(response, status, body = '', extraHeaders = {}) {
  response.writeHead(status, { ...headers, ...extraHeaders, 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function renderFeed(items) {
  if (!items.length) return '<p class="feed-empty" data-de="Noch keine Meldungen verfügbar. Bitte versuchen Sie es später erneut.">No updates available yet. Please check back later.</p>';
  const filingNames = { '10-K': 'Annual report', '10-Q': 'Quarterly report', '8-K': 'Current report', '20-F': 'Foreign issuer annual report', '6-K': 'Foreign issuer report', 'S-1': 'Registration statement', '4': 'Insider ownership change', '13F-HR': 'Institutional investment manager holdings', '424B2': 'Prospectus supplement', '487': 'Pre-effective pricing amendment' };
  const groups = [], companies = new Map();
  for (const item of items) {
    if (item.publisher !== 'SEC') { groups.push({ item }); continue; }
    const name = item.company_name || item.title;
    const key = name.trim().toLocaleLowerCase();
    let group = companies.get(key);
    if (!group) { group = { company: name, filings: [] }; companies.set(key, group); groups.push(group); }
    group.filings.push(item);
  }
  const filingEntry = (item, company, primary = false) => {
    const label = item.form_type ? `${filingNames[item.form_type] ?? 'SEC filing'} (Form ${item.form_type})` : 'SEC filing';
    const heading = `${company} — ${label}`;
    const date = item.published_at ? `<time datetime="${escapeHtml(item.published_at)}">${escapeHtml(item.published_at.slice(0, 10))} · ${escapeHtml(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(item.published_at)))}</time>` : '';
    const accession = /\/(\d{10}-\d{2}-\d{6})-index\.htm(?:[?#].*)?$/i.exec(item.link)?.[1] ?? '';
    const link = `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(heading)}<span class="visually-hidden"> (opens in a new tab)</span></a>`;
    return `<div class="filing-entry${primary ? ' primary-filing' : ''}" data-link="${escapeHtml(item.link)}">${primary ? `<h3>${link}</h3>` : `<p class="filing-title">${link}</p>`}<p class="filing-meta">${date}${accession ? `<span>Accession ${escapeHtml(accession)}</span>` : ''}</p></div>`;
  };
  return groups.map((group) => {
    if (group.item) {
      const item = group.item;
      const date = item.published_at ? `<time datetime="${escapeHtml(item.published_at)}">${escapeHtml(item.published_at.slice(0, 10))}</time>` : '';
      const heading = item.title;
      const action = `<a class="open-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">Open update<span class="visually-hidden"> (opens in a new tab)</span></a>`;
      const excerpt = item.excerpt ? `<p class="summary">${escapeHtml(item.excerpt)}</p>` : '';
      return `<article class="feed-item" data-publisher="${escapeHtml(item.publisher)}"><div class="meta"><span class="publisher">${escapeHtml(item.publisher)}</span>${date}</div><h3><a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(heading)}<span class="visually-hidden"> (opens in a new tab)</span></a></h3>${action}${excerpt}</article>`;
    }
    return `<article class="feed-item company-group" data-publisher="SEC" data-company="${escapeHtml(group.company.toLocaleLowerCase())}"><div class="meta"><span class="publisher">SEC</span></div>${group.filings.map((item, index) => filingEntry(item, group.company, index === 0)).join('')}${group.filings.length > 1 ? `<details class="more-filings"><summary>+${group.filings.length - 1} more filing${group.filings.length === 2 ? '' : 's'}</summary><div class="filing-list">${group.filings.slice(1).map((item) => filingEntry(item, group.company)).join('')}</div></details>` : ''}</article>`;
  }).join('');
}

function createServer(options) {
  const scripts = [...options.html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  if (scripts.length !== 1) throw new Error('HTML must contain exactly one inline script');
  const scriptHash = createHash('sha256').update(scripts[0][1]).digest('base64');
  const attempts = new Map();
  const server = https.createServer({ ...options.tls, maxHeaderSize: 8 * 1024, insecureHTTPParser: false }, (request, response) => {
    const now = Date.now();
    const client = request.socket.remoteAddress ?? 'unknown';
    const state = attempts.get(client);
    const recent = !state || now - state.startedAt >= 60_000
      ? { startedAt: now, count: 1 }
      : { startedAt: state.startedAt, count: state.count + 1 };
    attempts.set(client, recent);
    if (attempts.size > 1_000) {
      for (const [ip, item] of attempts) if (now - item.startedAt > 60_000) attempts.delete(ip);
      if (attempts.size > 1_000) attempts.delete(attempts.keys().next().value);
    }

    const host = request.headers.host?.toLowerCase().replace(/:\d+$/, '');
    if (recent.count > options.rateLimit) return reply(response, 429, 'Too many requests.\n');
    if (!options.allowedHosts.has(host)) return reply(response, 421, 'Misdirected request.\n');
    if (request.method !== 'GET') return reply(response, 405, 'Method not allowed.\n');
    const url = new URL(request.url, 'https://localhost');
    if (url.pathname === '/api/filings') {
      if (request.headers['transfer-encoding'] || (request.headers['content-length'] && request.headers['content-length'] !== '0')) return reply(response, 413, 'Request body not accepted.\n');
      const source = url.searchParams.get('source') ?? '';
      const from = url.searchParams.get('from') ?? '', to = url.searchParams.get('to') ?? '';
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const validDate = (value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
      if (!['', 'SEC', 'BaFin', 'ECB'].includes(source) || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000 || !validDate(from) || !validDate(to) || (from && to && from > to)) return reply(response, 400, 'Invalid feed filters.\n');
      const page = options.store?.page?.({ limit: 20, offset, source, from, to }) ?? { items: [], nextOffset: offset, hasMore: false };
      const body = JSON.stringify({ html: renderFeed(page.items), ...page });
      return reply(response, 200, body, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    }
    if (url.pathname !== '/' || url.search) return reply(response, 404, 'Not found.\n');
    if (request.headers['transfer-encoding'] || (request.headers['content-length'] && request.headers['content-length'] !== '0')) {
      return reply(response, 413, 'Request body not accepted.\n');
    }
    request.on('data', () => request.destroy());
    const firstPage = options.store?.page?.({ limit: 20, offset: 0 }) ?? { items: options.store?.recent?.() ?? [], nextOffset: 20, hasMore: false };
    const html = options.html.replace('<!-- FEED_ITEMS -->', () => `${renderFeed(firstPage.items)}<p class="feed-status" aria-live="polite"></p>${firstPage.hasMore ? '<button class="show-more" type="button" data-de="20 weitere anzeigen" data-offset="' + firstPage.nextOffset + '">Show 20 more</button>' : ''}`);
    reply(response, 200, html, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src https:; script-src 'sha256-${scriptHash}'; connect-src 'self'; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
    });
  });

  Object.assign(server, { headersTimeout: 5_000, requestTimeout: 5_000, keepAliveTimeout: 2_000, maxRequestsPerSocket: 50, maxHeadersCount: 32 });
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8443);
  const allowedHosts = hosts(process.env.ALLOWED_HOSTS);
  const rateLimit = Number(process.env.RATE_LIMIT ?? 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(rateLimit) || rateLimit < 1) throw new Error('PORT and RATE_LIMIT must be positive integers');
  const key = process.env.TLS_KEY_PATH, cert = process.env.TLS_CERT_PATH;
  if (!key || !cert) throw new Error('TLS_KEY_PATH and TLS_CERT_PATH are required');
  const store = openStore(process.env.RSS_DB_PATH ?? '/data/rss.sqlite');
  const server = createServer({ tls: { key: readFileSync(key), cert: readFileSync(cert), minVersion: 'TLSv1.2' }, allowedHosts, rateLimit, html: readFileSync(`${__dirname}/../public/index.html`, 'utf8'), store });
  server.listen(port, '0.0.0.0', () => console.log(`Listening on https://0.0.0.0:${port}`));
  startCollector(store);
}

module.exports = { createServer, hosts, renderFeed };
