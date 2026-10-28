'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');
const { createServer } = require('../src/server');
const { normalizeFilings, openAnalysisStore } = require('../src/analysis-store');

const sec = { market: 'US', cik: '0000320193', accession: '0000320193-26-000001', url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-20260926.htm', title: 'Example 10-K', formType: '10-K' };
const german = { market: 'DE', url: 'https://www.unternehmensregister.de/de/publication/example', title: 'Example Jahresabschluss', formType: '' };

function apiRequest(server, { method, url, body, headers = {} }) {
  return new Promise((resolve) => {
    const request = new EventEmitter();
    Object.assign(request, { method, url, headers: { host: 'localhost', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
    server.emit('request', request, { writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders; }, end(value) { this.body = value; resolve(this); } });
    if (body !== undefined) {
      request.emit('data', Buffer.from(body));
      request.emit('end');
    }
  });
}

function createTestServer(analysisStore) {
  return createServer({ tls: {}, allowedHosts: new Set(['localhost']), rateLimit: 10,
    html: readFileSync(require.resolve('../public/index.html'), 'utf8'), analysisStore, analysisDataDir: '/missing-analysis-data' });
}

test('validates source references and rejects arbitrary fetch destinations', () => {
  assert.equal(normalizeFilings([sec, german]).length, 2);
  for (const item of [
    { ...sec, url: 'https://attacker.example/Archives/edgar/data/320193/000032019326000001/a.htm' },
    { ...sec, url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/../secret' },
    { ...german, url: 'https://www.unternehmensregister.de/de/search?redirect=https://attacker.example/' },
    { ...german, url: 'http://www.unternehmensregister.de/de/publication/example' }
  ]) assert.throws(() => normalizeFilings([item]));
});

test('deduplicates queued jobs across repeated requests', () => {
  const store = openAnalysisStore(':memory:');
  try {
    const first = store.enqueue([sec, sec])[0];
    assert.equal(store.enqueue([sec]).length, 1);
    const duplicate = store.enqueue([sec])[0];
    assert.equal(first.id, duplicate.id);
    assert.equal(duplicate.status, 'queued');
  } finally { store.close(); }
});

test('persists queued jobs across store restarts', () => {
  const directory = mkdtempSync(join(__dirname, '.analysis-test-'));
  const path = join(directory, 'analysis.sqlite');
  try {
    let store = openAnalysisStore(path);
    const job = store.enqueue([sec])[0];
    store.close();
    store = openAnalysisStore(path);
    assert.equal(store.get(job.id).status, 'queued');
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('accepts same-origin job creation, status polling, and completed result retrieval', async () => {
  const directory = mkdtempSync(join(__dirname, '.analysis-api-test-'));
  const dataDirectory = join(directory, 'data');
  mkdirSync(dataDirectory);
  const store = openAnalysisStore(join(dataDirectory, 'analysis.sqlite'));
  const server = createServer({ tls: {}, allowedHosts: new Set(['localhost']), rateLimit: 10,
    html: readFileSync(require.resolve('../public/index.html'), 'utf8'), analysisStore: store, analysisDataDir: dataDirectory });
  try {
    const created = await apiRequest(server, { method: 'POST', url: '/api/analysis-jobs', body: JSON.stringify({ filings: [sec, german] }),
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(JSON.stringify({ filings: [sec, german] }))), origin: 'https://localhost' } });
    assert.equal(created.status, 202);
    const jobs = JSON.parse(created.body).jobs;
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every(job => job.status === 'queued'));
    const batch = await apiRequest(server, { method: 'GET', url: `/api/analysis-jobs?ids=${jobs.map(job => job.id).join(',')}` });
    assert.equal(batch.status, 200);
    assert.equal(JSON.parse(batch.body).jobs.length, 2);
    const one = await apiRequest(server, { method: 'GET', url: `/api/analysis-jobs/${jobs[0].id}` });
    assert.equal(one.status, 200);
    assert.equal(JSON.parse(one.body).job.id, jobs[0].id);
    assert.equal(JSON.parse(one.body).result, null);
    const resultDirectory = join(dataDirectory, 'documents');
    mkdirSync(resultDirectory);
    writeFileSync(join(resultDirectory, `${jobs[0].id}.result.json`), JSON.stringify({ passages: [{ original: '<script>source</script>', sentiment: { label: 'neutral' } }] }));
    const db = new DatabaseSync(join(dataDirectory, 'analysis.sqlite'));
    db.prepare("UPDATE analysis_jobs SET status='complete' WHERE id=?").run(jobs[0].id);
    db.close();
    const final = await apiRequest(server, { method: 'GET', url: `/api/analysis-jobs/${jobs[0].id}` });
    assert.equal(final.status, 200);
    assert.equal(JSON.parse(final.body).result.passages[0].sentiment.label, 'neutral');
    const page = await apiRequest(server, { method: 'GET', url: `/analysis/${jobs[0].id}?lang=de` });
    assert.equal(page.status, 200);
    assert.match(page.body, /Analysedetails/);
    assert.match(page.body, /&lt;script&gt;source&lt;\/script&gt;/);
    assert.match(page.body, /neutral/);
    const pendingPage = await apiRequest(server, { method: 'GET', url: `/analysis/${jobs[1].id}` });
    assert.match(pendingPage.body, /queued/);
    const crossOrigin = await apiRequest(server, { method: 'POST', url: '/api/analysis-jobs', body: JSON.stringify({ filings: [sec] }),
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' } });
    assert.equal(crossOrigin.status, 403);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('rejects malformed, oversized, and missing job requests', async () => {
  const store = openAnalysisStore(':memory:');
  const server = createTestServer(store);
  try {
    const invalid = await apiRequest(server, { method: 'POST', url: '/api/analysis-jobs', body: JSON.stringify({ filings: [{ ...sec, url: 'https://example.com/' }] }), headers: { 'content-type': 'application/json' } });
    assert.equal(invalid.status, 400);
    const oversized = await apiRequest(server, { method: 'POST', url: '/api/analysis-jobs', headers: { 'content-type': 'application/json', 'content-length': '20000' } });
    assert.equal(oversized.status, 413);
    const missing = await apiRequest(server, { method: 'GET', url: '/api/analysis-jobs/00000000-0000-4000-8000-000000000000' });
    assert.equal(missing.status, 404);
  } finally { store.close(); }
});

test('streams manual documents into separate jobs while preserving registry results and rejecting unsafe uploads', async () => {
  const directory = mkdtempSync('/tmp/analysis-upload-test-');
  const store = openAnalysisStore(join(directory, 'analysis.sqlite'));
  const db = new DatabaseSync(join(directory, 'analysis.sqlite'));
  const server = createServer({ tls: {}, allowedHosts: new Set(['localhost']), rateLimit: 100,
    html: readFileSync(require.resolve('../public/index.html'), 'utf8'), analysisStore: store, analysisDataDir: directory });
  const original = store.enqueue([german])[0];
  db.prepare("UPDATE analysis_jobs SET status='unavailable', error='CAPTCHA required' WHERE id=?").run(original.id);
  const upload = (overrides = {}) => new Promise(resolve => {
    const body = Buffer.from('financial statement '.repeat(100));
    const request = Readable.from([body.subarray(0, 7), body.subarray(7)]);
    Object.assign(request, { method: 'POST', url: `/api/analysis-jobs/${original.id}/upload?filename=report.txt&language=en`,
      headers: { host: 'localhost', origin: 'https://localhost', 'content-length': String(body.length), 'content-type': 'application/octet-stream', ...overrides.headers },
      socket: { remoteAddress: '127.0.0.1' } });
    if (overrides.url) request.url = overrides.url;
    server.emit('request', request, { writeHead(status) { this.status = status; }, end(body) { this.body = body; resolve(this); } });
  });
  try {
    const created = await upload();
    assert.equal(created.status, 202);
    const replacement = JSON.parse(created.body).jobs[0];
    assert.notEqual(replacement.id, original.id);
    assert.equal(replacement.status, 'queued');
    assert.equal(store.get(original.id).status, 'unavailable');
    const saved = readFileSync(join(directory, 'uploads', `${replacement.id}.upload`));
    assert.equal(saved.toString(), 'financial statement '.repeat(100));
    const metadata = db.prepare('SELECT * FROM analysis_uploads WHERE job_id=?').get(replacement.id);
    assert.equal(metadata.language, 'en');
    assert.equal(metadata.filename, 'report.txt');
    assert.equal(metadata.sha256, require('node:crypto').createHash('sha256').update(saved).digest('hex'));
    assert.equal(store.storageBytes(), saved.length);
    for (const [overrides, status] of [
      [{ headers: { origin: 'https://attacker.example' } }, 403],
      [{ headers: { 'sec-fetch-site': 'cross-site' } }, 403],
      [{ headers: { 'content-length': String(26 * 1024 * 1024) } }, 413],
      [{ headers: { 'transfer-encoding': 'chunked' } }, 413],
      [{ url: `/api/analysis-jobs/${original.id}/upload?filename=..%2Fsecret.pdf&language=en` }, 400],
      [{ url: `/api/analysis-jobs/${original.id}/upload?filename=report.exe&language=en` }, 400],
      [{ url: `/api/analysis-jobs/${original.id}/upload?filename=report.pdf&language=en` }, 400],
      [{ url: `/api/analysis-jobs/${original.id}/upload?filename=report.txt&language=fr` }, 400],
      [{ headers: { 'content-length': '9999' } }, 400]
    ]) assert.equal((await upload(overrides)).status, status);
    const { readdirSync } = require('node:fs');
    assert.deepEqual(readdirSync(join(directory, 'uploads')), [`${replacement.id}.upload`]);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM analysis_jobs').get().count, 2);
    db.prepare("UPDATE analysis_jobs SET status='classifying' WHERE id=?").run(original.id);
    assert.equal((await upload()).status, 409);
    db.prepare("UPDATE analysis_jobs SET status='unavailable', artifact_bytes=? WHERE id=?").run(25 * 1024 ** 3, original.id);
    assert.equal((await upload()).status, 507);
  } finally { db.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});


test('completed filings retain accessible result links in both languages', () => {
  const html = readFileSync(require.resolve('../public/index.html'), 'utf8');
  const code = html.slice(html.indexOf('    function renderAnalysisStatus('), html.indexOf('    async function pollAnalysis('));
  const context = {
    analysisStatusByGroup: new Map(), language: 'en',
    searchCopy: { en: { analysisFailed: n => `Failed ${n}` }, de: { analysisFailed: n => `Fehlgeschlagen ${n}` } },
    companyResultsContent: { querySelectorAll: () => [] },
    document: { createElement: tag => ({ tag }) }
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  context.applyAnalysisJobs('company', [{ id: '123', title: 'Filing', status: 'complete' }, { status: 'failed' }]);
  for (const language of ['en', 'de']) {
    context.language = language;
    const node = { children: [], append(...children) { this.children.push(...children); } };
    context.renderAnalysisStatus('company', node);
    const link = node.children[1];
    assert.equal(link.href, `/analysis/123?lang=${language}`);
    assert.equal(link.rel, 'noopener noreferrer');
    assert.match(link.textContent, language === 'de' ? /Ergebnisse/ : /Results/);
  }
});

test('unavailable and failed filings show individual reasons as text in both languages', () => {
  const html = readFileSync(require.resolve('../public/index.html'), 'utf8');
  const code = html.slice(html.indexOf('    function renderAnalysisStatus('), html.indexOf('    async function pollAnalysis('));
  const context = {
    analysisStatusByGroup: new Map(), language: 'en',
    searchCopy: { en: { analysisFailed: n => `Failed ${n}`, analysisUnavailable: n => `Unavailable ${n}` },
      de: { analysisFailed: n => `Fehlgeschlagen ${n}`, analysisUnavailable: n => `Nicht verfügbar ${n}` } },
    companyResultsContent: { querySelectorAll: () => [] },
    document: { createElement: tag => ({ tag }) }
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  const error = 'The source requires registration to view the document. <script>unsafe</script>';
  context.applyAnalysisJobs('company', [{ title: 'Siemens', status: 'unavailable', error }]);
  for (const language of ['en', 'de']) {
    context.language = language;
    const node = { children: [], append(...children) { this.children.push(...children); } };
    context.renderAnalysisStatus('company', node);
    assert.match(node.textContent, language === 'de' ? /Nicht verfügbar 1/ : /Unavailable 1/);
    assert.equal(node.children[1].textContent, `Siemens: ${language === 'de' ? 'Grund' : 'Reason'}: ${error}`);
    assert.equal(node.children[1].innerHTML, undefined);
  }
  context.applyAnalysisJobs('mixed', [{ title: 'Siemens', status: 'unavailable', error },
    { title: 'Other filing', status: 'failed', error: 'Local analysis failed.' }, { id: '123', title: 'Complete', status: 'complete' }]);
  const node = { children: [], append(...children) { this.children.push(...children); } };
  context.renderAnalysisStatus('mixed', node);
  assert.equal(node.children[1].textContent, `Siemens: Grund: ${error}`);
  assert.equal(node.children[3].textContent, 'Other filing: Grund: Local analysis failed.');
  assert.equal(node.children[5].href, '/analysis/123?lang=de');
});

test('upload fallback preserves file and language across page-language changes and polls the replacement job', async () => {
  const html = readFileSync(require.resolve('../public/index.html'), 'utf8');
  const code = html.slice(html.indexOf('    function renderAnalysisStatus('), html.indexOf('    async function pollAnalysis('));
  const nodes = [];
  const createElement = tag => {
    const node = { tag, children: [], events: {}, dataset: {}, append(...children) { this.children.push(...children); },
      setAttribute() {}, addEventListener(name, listener) { this.events[name] = listener; } };
    nodes.push(node); return node;
  };
  const status = createElement('div');
  const footer = { dataset: { analysisKey: 'company' }, querySelector: () => status };
  const copies = { analysisUnavailable: n => `Unavailable ${n}`, analysisQueued: n => `Queued ${n}`, analysisRunning: n => `Running ${n}` };
  let posted, polled = false;
  const context = { analysisStatusByGroup: new Map(), analysisUploadFiles: new Map(), activeAnalysisRuns: new Map(),
    language: 'en', searchCopy: { en: copies, de: copies }, URLSearchParams,
    companyResultsContent: { querySelectorAll: () => [footer] }, document: { createElement }, syncSelectionControls() {}, pollAnalysis() { polled = true; },
    async fetch(url, options) { posted = { url, options }; return { ok: true, text: async () => JSON.stringify({ jobs: [{ id: 'uploaded', title: 'Statement', market: 'DE', status: 'queued' }] }) }; }
  };
  vm.createContext(context); vm.runInContext(code, context);
  context.applyAnalysisJobs('company', [{ id: 'original', title: 'Statement', market: 'DE', status: 'unavailable', error: 'CAPTCHA required' },
    { id: 'complete', title: 'Other report', status: 'complete' }]);
  const latest = predicate => nodes.findLast(predicate);
  assert.equal(latest(node => node.tag === 'summary').textContent, 'Upload downloaded original');
  const file = { name: 'original.pdf', size: 1024 };
  const input = latest(node => node.type === 'file'); input.files = [file]; input.events.change();
  const confirm = latest(node => node.type === 'checkbox'); confirm.checked = true; confirm.events.change();
  const language = latest(node => node.tag === 'select'); language.value = 'en'; language.events.change();
  context.language = 'de'; context.renderAnalysisStatus('company', status);
  assert.equal(latest(node => node.tag === 'summary').textContent, 'Heruntergeladenes Original hochladen');
  assert.equal(latest(node => node.tag === 'select').value, 'en');
  assert.equal(latest(node => node.type === 'checkbox').checked, true);
  const button = latest(node => node.tag === 'button'); assert.equal(button.disabled, false);
  const success = context.fetch;
  context.fetch = async () => ({ ok: false, text: async () => 'Upload interrupted' });
  await button.events.click();
  assert.equal(context.analysisUploadFiles.get('original').file, file);
  assert.equal(latest(node => node.tag === 'button').disabled, false);
  assert.ok(nodes.some(node => node.textContent === 'Upload interrupted'));
  context.fetch = success;
  await latest(node => node.tag === 'button').events.click();
  assert.match(posted.url, /original\/upload\?filename=original.pdf&language=en/);
  assert.equal(posted.options.body, file);
  assert.deepEqual([...context.activeAnalysisRuns.get('company')], ['uploaded', 'complete']);
  assert.equal(polled, true);
  assert.equal(context.analysisUploadFiles.has('original'), false);
});
