'use strict';

const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const { open } = require('node:fs/promises');
const { join, extname } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const https = require('node:https');
const { openStore, startCollector } = require('./rss');
const { SearchError, searchUs, searchGermany, validateSearch } = require('./company-search');
const { MAX_FILINGS, MAX_UPLOAD, MAX_STORAGE, openAnalysisStore } = require('./analysis-store');

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
  clearTimeout(response.requestDeadline);
  response.writeHead(status, { ...headers, ...extraHeaders, 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function readJsonBody(request, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, tooLarge = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) tooLarge = true;
      else if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON request body.'), { status: 400 })); }
    });
    request.on('error', () => reject(Object.assign(new Error('Could not read request body.'), { status: 400 })));
  });
}

function safeStatus(job) {
  const { id, market, title, status, error, created_at, updated_at, completed_at } = job;
  return { id, market, title, status, error, createdAt: created_at, updatedAt: updated_at, completedAt: completed_at };
}

function readAnalysisResult(dataDir, id) {
  const raw = readFileSync(join(dataDir ?? '/analysis', 'documents', `${id}.result.json`));
  if (raw.length > 16 * 1024 * 1024) throw new Error('Analysis result exceeds the response limit.');
  return JSON.parse(raw.toString('utf8'));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function renderFeed(items) {
  if (!items.length) return '<p class="feed-empty" data-de="Noch keine Meldungen verfügbar. Bitte versuchen Sie es später erneut.">No updates available yet. Please check back later.</p>';
  const filingNames = { '10-K': 'Annual report', '10-Q': 'Quarterly report', '8-K': 'Current report', '20-F': 'Foreign issuer annual report', '6-K': 'Foreign issuer report', 'S-1': 'Registration statement', '4': 'Insider ownership change', '13F-HR': 'Institutional investment manager holdings', '424B1': 'Prospectus', '424B2': 'Prospectus supplement', '424B3': 'Prospectus', '424B4': 'Prospectus', '424B5': 'Prospectus supplement', '424B7': 'Prospectus', '487': 'Pre-effective pricing amendment' };
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
    const excerpt = item.excerpt && !/^\w[\w-]{0,11}$/.test(item.excerpt) ? `<p class="summary">${escapeHtml(item.excerpt)}</p>` : '';
    return `<div class="filing-entry${primary ? ' primary-filing' : ''}" data-link="${escapeHtml(item.link)}">${primary ? `<h3>${link}</h3>` : `<p class="filing-title">${link}</p>`}<p class="filing-meta">${date}${accession ? `<span>Accession ${escapeHtml(accession)}</span>` : ''}</p>${excerpt}</div>`;
  };
  return groups.map((group) => {
    if (group.item) {
      const item = group.item;
      const date = item.published_at ? `<time datetime="${escapeHtml(item.published_at)}">${escapeHtml(item.published_at.slice(0, 10))}</time>` : '';
      const heading = item.title;
      return `<article class="feed-item" data-publisher="${escapeHtml(item.publisher)}"><div class="meta"><span class="publisher">${escapeHtml(item.publisher)}</span>${date}</div><h3><a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(heading)}<span class="visually-hidden"> (opens in a new tab)</span></a></h3></article>`;
    }
    return `<article class="feed-item company-group" data-publisher="SEC" data-company="${escapeHtml(group.company.toLocaleLowerCase())}"><div class="meta"><span class="publisher">SEC</span></div>${filingEntry(group.filings[0], group.company, true)}${group.filings.length > 1 ? `<details class="more-filings"><summary>+${group.filings.length - 1} more filing${group.filings.length === 2 ? '' : 's'}</summary><div class="filing-list">${group.filings.slice(1).map((item) => filingEntry(item, group.company)).join('')}</div></details>` : ''}</article>`;
  }).join('');
}

function createServer(options) {
  const scripts = [...options.html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  if (scripts.length !== 1) throw new Error('HTML must contain exactly one inline script');
  const scriptHash = createHash('sha256').update(scripts[0][1]).digest('base64');
  const attempts = new Map();
  let uploadingBytes = 0;
  const server = https.createServer({ ...options.tls, maxHeaderSize: 8 * 1024, insecureHTTPParser: false }, async (request, response) => {
    request.once('close', () => clearTimeout(response.requestDeadline));
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
    const url = new URL(request.url, 'https://localhost');
    const createAnalysis = url.pathname === '/api/analysis-jobs' && request.method === 'POST';
    const upload = request.method === 'POST' && /^\/api\/analysis-jobs\/([0-9a-f-]{36})\/upload$/i.exec(url.pathname);
    if (request.method !== 'GET' && !createAnalysis && !upload) return reply(response, 405, 'Method not allowed.\n');
    if (upload) {
      if (request.headers.origin && request.headers.origin !== `https://${request.headers.host}` || request.headers['sec-fetch-site'] === 'cross-site') return reply(response, 403, 'Cross-origin request rejected.\n');
      const size = Number(request.headers['content-length']);
      if (request.headers['transfer-encoding'] || !Number.isSafeInteger(size) || size < 1 || size > MAX_UPLOAD) return reply(response, 413, 'Choose a document up to 25 MiB.\n');
      if (!options.analysisStore) return reply(response, 503, 'Analysis is not configured.\n');
      const original = options.analysisStore.get(upload[1]);
      if (!original || original.market !== 'DE') return reply(response, 404, 'German publication job not found.\n');
      if (!['unavailable', 'failed'].includes(original.status)) return reply(response, 409, 'Wait for retrieval to finish before uploading.\n');
      const filename = url.searchParams.get('filename') ?? '', language = url.searchParams.get('language');
      const contentType = { '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html', '.xml': 'application/xml', '.txt': 'text/plain' }[extname(filename).toLowerCase()];
      if (!filename || filename.length > 120 || /[\u0000-\u001f\u007f/\\]/.test(filename) || !contentType || !['en', 'de'].includes(language)) return reply(response, 400, 'Choose PDF, HTML, XML, or TXT and the document language.\n');
      if (options.analysisStore.storageBytes() + uploadingBytes + size > MAX_STORAGE) return reply(response, 507, 'Analysis storage is full.\n');
      clearTimeout(response.requestDeadline);
      response.requestDeadline = setTimeout(() => request.destroy(), 120_000);
      response.requestDeadline.unref();
      uploadingBytes += size;
      const id = randomUUID(), directory = join(options.analysisDataDir ?? '/analysis', 'uploads'), path = join(directory, `${id}.upload`);
      let queued = false;
      try {
        mkdirSync(directory, { recursive: true });
        const file = await open(path, 'wx', 0o600), hash = createHash('sha256');
        let received = 0, signature = Buffer.alloc(0);
        try {
          for await (const chunk of request) {
            received += chunk.length;
            if (received > size) throw new Error('Upload exceeds its declared size.');
            if (signature.length < 5) signature = Buffer.concat([signature, chunk]).subarray(0, 5);
            hash.update(chunk);
            await file.writeFile(chunk);
          }
        } finally { await file.close(); }
        if (received !== size || contentType === 'application/pdf' && signature.toString('ascii') !== '%PDF-') throw new Error('The uploaded document is incomplete or is not a PDF.');
        const job = options.analysisStore.enqueueUpload(original.id, { id, filename, contentType, language, sha256: hash.digest('hex'), size });
        queued = true;
        return reply(response, 202, JSON.stringify({ jobs: [safeStatus(job)] }), { 'content-type': 'application/json; charset=utf-8' });
      } catch (error) {
        return reply(response, 400, error.code ? 'Could not store the uploaded document.\n' : `${error.message}\n`);
      } finally {
        uploadingBytes -= size;
        if (!queued) rmSync(path, { force: true });
      }
    }
    if (createAnalysis) {
      if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) > 16 * 1024) return reply(response, 413, 'Request body is too large or unsupported.\n');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) return reply(response, 415, 'Expected a JSON request body.\n');
      if (request.headers.origin && request.headers.origin !== `https://${request.headers.host}`) return reply(response, 403, 'Cross-origin request rejected.\n');
      if (request.headers['sec-fetch-site'] === 'cross-site') return reply(response, 403, 'Cross-origin request rejected.\n');
      if (!options.analysisStore) return reply(response, 503, JSON.stringify({ error: 'Analysis is not configured.' }), { 'content-type': 'application/json; charset=utf-8' });
      response.requestDeadline = setTimeout(() => request.destroy(), 5_000);
      response.requestDeadline.unref();
      try {
        const body = await readJsonBody(request);
        const jobs = options.analysisStore.enqueue(body?.filings).map(safeStatus);
        return reply(response, 202, JSON.stringify({ jobs }), { 'content-type': 'application/json; charset=utf-8' });
      } catch (error) {
        return reply(response, error.status ?? 400, JSON.stringify({ error: error.message || 'Invalid analysis request.' }), { 'content-type': 'application/json; charset=utf-8' });
      }
    }
    if (url.pathname === '/api/analysis-jobs') {
      if (request.headers['transfer-encoding'] || (request.headers['content-length'] && request.headers['content-length'] !== '0')) return reply(response, 413, 'Request body not accepted.\n');
      if (!options.analysisStore) return reply(response, 503, JSON.stringify({ error: 'Analysis is not configured.' }), { 'content-type': 'application/json; charset=utf-8' });
      try {
        const ids = (url.searchParams.get('ids') ?? '').split(',');
        if (!ids.length || ids.length > MAX_FILINGS) throw new Error('Invalid job IDs.');
        return reply(response, 200, JSON.stringify({ jobs: options.analysisStore.getMany(ids).map(safeStatus) }), { 'content-type': 'application/json; charset=utf-8' });
      } catch (error) {
        return reply(response, 400, JSON.stringify({ error: error.message || 'Invalid job IDs.' }), { 'content-type': 'application/json; charset=utf-8' });
      }
    }
    const analysisJob = /^\/api\/analysis-jobs\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (analysisJob) {
      if (request.headers['transfer-encoding'] || (request.headers['content-length'] && request.headers['content-length'] !== '0')) return reply(response, 413, 'Request body not accepted.\n');
      if (!options.analysisStore) return reply(response, 503, JSON.stringify({ error: 'Analysis is not configured.' }), { 'content-type': 'application/json; charset=utf-8' });
      const job = options.analysisStore.get(analysisJob[1]);
      if (!job) return reply(response, 404, JSON.stringify({ error: 'Analysis job not found.' }), { 'content-type': 'application/json; charset=utf-8' });
      let result = null;
      if (job.status === 'complete') {
        try {
          result = readAnalysisResult(options.analysisDataDir, job.id);
        } catch { return reply(response, 500, JSON.stringify({ error: 'Stored analysis result is unavailable.' }), { 'content-type': 'application/json; charset=utf-8' }); }
      }
      return reply(response, 200, JSON.stringify({ job: safeStatus(job), result }), { 'content-type': 'application/json; charset=utf-8' });
    }
    const analysisPage = /^\/analysis\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (analysisPage) {
      if (request.headers['transfer-encoding'] || (request.headers['content-length'] && request.headers['content-length'] !== '0')) return reply(response, 413, 'Request body not accepted.\n');
      if (!options.analysisStore) return reply(response, 503, 'Analysis is not configured.\n');
      const job = options.analysisStore.get(analysisPage[1]);
      if (!job) return reply(response, 404, 'Analysis job not found.\n');
      const de = url.searchParams.get('lang') === 'de';
      let output;
      if (job.status === 'complete') {
        try {
          output = JSON.stringify(readAnalysisResult(options.analysisDataDir, job.id), null, 2);
        } catch { output = de ? 'Gespeichertes Analyseergebnis ist nicht verfügbar.' : 'Stored analysis result is unavailable.'; }
      } else output = `${job.status}${job.error ? `: ${job.error}` : ''}`;
      const title = de ? 'Analysedetails' : 'Analysis details';
      const html = `<!doctype html><html lang="${de ? 'de' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><h1>${title}</h1><h2>${escapeHtml(job.title)}</h2><pre style="white-space: pre-wrap; overflow-wrap: anywhere">${escapeHtml(output)}</pre></body></html>`;
      return reply(response, 200, html, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
    }
    if (url.pathname === '/api/filings') {
      if (request.headers['transfer-encoding'] || (request.headers['content-length'] && request.headers['content-length'] !== '0')) return reply(response, 413, 'Request body not accepted.\n');
      const source = url.searchParams.get('source') ?? '';
      const from = url.searchParams.get('from') ?? '', to = url.searchParams.get('to') ?? '';
      const secOffset = Number(url.searchParams.get('secOffset') ?? 0);
      const otherOffset = Number(url.searchParams.get('otherOffset') ?? 0);
      const validDate = (value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
      if (!['', 'SEC', 'BaFin', 'ECB'].includes(source) || !Number.isInteger(secOffset) || secOffset < 0 || secOffset > 1_000_000 || !Number.isInteger(otherOffset) || otherOffset < 0 || otherOffset > 1_000_000 || !validDate(from) || !validDate(to) || (from && to && from > to)) return reply(response, 400, 'Invalid feed filters.\n');
      const page = options.store?.page?.({ limit: 20, secOffset, otherOffset, source, from, to }) ?? { items: [], nextCursor: { secOffset, otherOffset }, hasMore: false };
      const body = JSON.stringify({ html: renderFeed(page.items), ...page });
      return reply(response, 200, body, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    }
    if (url.pathname === '/api/company-filings') {
      if (request.headers['transfer-encoding'] || (request.headers['content-length'] && request.headers['content-length'] !== '0')) return reply(response, 413, 'Request body not accepted.\n');
      const market = url.searchParams.get('market') ?? '';
      const company = url.searchParams.get('company') ?? '';
      const formType = url.searchParams.get('formType') ?? 'any';
      const year = url.searchParams.get('year') ?? '';
      const topic = url.searchParams.get('topic') ?? '';
      if (!['US', 'DE'].includes(market)) return reply(response, 400, 'Choose a supported filing market.\n');
      try {
        validateSearch(company, formType, year, topic, market);
        const fetcher = options.fetcher ?? fetch;
        const result = market === 'US'
          ? { market, companies: await searchUs({ company: company.trim(), formType, year, topic, fetcher }) }
          : { market, filings: await searchGermany(company.trim(), { formType, year, topic, fetcher }) };
        return reply(response, 200, JSON.stringify(result), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      } catch (error) {
        const status = error instanceof SearchError ? error.status : 502;
        const message = error instanceof SearchError ? error.message : 'The filing source could not be searched. Please try again.';
        return reply(response, status, JSON.stringify({ error: message }), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      }
    }
    if (url.pathname !== '/' || url.search) return reply(response, 404, 'Not found.\n');
    if (request.headers['transfer-encoding'] || (request.headers['content-length'] && request.headers['content-length'] !== '0')) {
      return reply(response, 413, 'Request body not accepted.\n');
    }
    request.on('data', () => request.destroy());
    const firstPage = options.store?.page?.({ limit: 20, secOffset: 0, otherOffset: 0 }) ?? { items: options.store?.recent?.() ?? [], nextCursor: { secOffset: 0, otherOffset: 20 }, hasMore: false };
    const pageButtons = Array.from({ length: Math.min(firstPage.totalPages ?? 1, 10) }, (_, index) => `<button type="button" class="page-number" data-page="${index}"${index === 0 ? ' aria-current="page"' : ''}>${index + 1}</button>`).join('');
    const initialCounts = firstPage.totalCounts ?? { sec: 0, other: 0 };
    const html = options.html.replace('<!-- FEED_ITEMS -->', () => `${renderFeed(firstPage.items)}<p class="feed-status" aria-live="polite"></p><nav class="feed-pagination" aria-label="Filing pages" data-total-pages="${firstPage.totalPages ?? 1}" data-sec-count="${initialCounts.sec}" data-other-count="${initialCounts.other}"${firstPage.hasMore ? '' : ' hidden'}><button id="previous-page" type="button" aria-label="Previous page" disabled>‹</button><div class="page-numbers">${pageButtons}</div><span class="page-ellipsis" hidden>…</span><button id="next-page" type="button"><span data-de="Weiter">Next</span> ›</button></nav>`);
    reply(response, 200, html, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src https:; script-src 'sha256-${scriptHash}'; connect-src 'self'; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
    });
  });

  Object.assign(server, { headersTimeout: 5_000, requestTimeout: 120_000, keepAliveTimeout: 2_000, maxRequestsPerSocket: 50, maxHeadersCount: 32 });
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
  const analysisDataDir = process.env.ANALYSIS_DATA_DIR ?? '/analysis';
  mkdirSync(analysisDataDir, { recursive: true });
  const analysisStore = openAnalysisStore(join(analysisDataDir, 'analysis.sqlite'));
  const server = createServer({ tls: { key: readFileSync(key), cert: readFileSync(cert), minVersion: 'TLSv1.2' }, allowedHosts, rateLimit, html: readFileSync(`${__dirname}/../public/index.html`, 'utf8'), store, analysisStore, analysisDataDir });
  server.listen(port, '0.0.0.0', () => console.log(`Listening on https://0.0.0.0:${port}`));
  startCollector(store);
}

module.exports = { createServer, hosts, renderFeed };
