'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');
const { openAnalysisStore } = require('../src/analysis-store');
const { openStore, mountainDay } = require('../src/rss');
const { companyId } = require('../src/company-store');
const { createServer } = require('../src/server');
const { DatabaseSync } = require('node:sqlite');
const cik = '0000320193';
function fixture(year = '2026', n = '000001') {
  return {
    name: 'Apple Inc.',
    ticker: 'AAPL',
    cik,
    filings: [
      {
        form: '10-K',
        filingDate: year + '-10-30',
        reportDate: year + '-09-30',
        accession: `0000320193-${year.slice(2)}-${n}`,
        url: `https://www.sec.gov/Archives/edgar/data/320193/0000320193${year.slice(2)}${n}/report.htm`,
        description: 'Annual report',
      },
    ],
  };
}
function req(server, url, method = 'GET', body, headers = {}) {
  return new Promise((resolve) => {
    const r = new EventEmitter();
    Object.assign(r, {
      method,
      url,
      headers: { host: 'localhost', ...headers },
      socket: { remoteAddress: '127.0.0.1' },
    });
    server.emit('request', r, {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        resolve({ ...this, body });
      },
    });
    if (body !== undefined) {
      r.emit('data', Buffer.from(JSON.stringify(body)));
      r.emit('end');
    }
  });
}
test('Mountain calendar handles midnight, daylight saving time and unknown dates', () => {
  assert.equal(mountainDay('2026-07-01T05:59:59Z'), '2026-06-30');
  assert.equal(mountainDay('2026-07-01T06:00:00Z'), '2026-07-01');
  assert.equal(mountainDay('2026-01-01T06:59:59Z'), '2025-12-31');
  assert.equal(mountainDay('2026-01-01T07:00:00Z'), '2026-01-01');
  assert.equal(mountainDay('2026-03-08T08:59:59Z'), '2026-03-08');
  assert.equal(mountainDay('2026-03-08T09:00:00Z'), '2026-03-08');
  assert.equal(mountainDay('2026-11-01T07:30:00Z'), '2026-11-01');
  assert.equal(mountainDay('2026-11-01T08:30:00Z'), '2026-11-01');
  assert.equal(mountainDay(null), '');
  assert.equal(mountainDay('invalid'), '');
});
test('today filter runs before company grouping and pagination and preserves history', () => {
  const store = openStore(':memory:');
  try {
    const entries = [
      ['2026-07-01T06:00:00Z', 'today'],
      ['2026-07-01T05:59:59Z', 'old'],
      [null, 'unknown'],
    ].map(([date, key]) => ({
      sourceUrl: 'feed',
      publisher: 'SEC',
      itemId: key,
      title: 'Apple',
      companyName: 'Apple',
      link: 'https://www.sec.gov/' + key,
      publishedAt: date,
      excerpt: '',
      fetchedAt: '2026-07-01T10:00:00Z',
    }));
    store.save(entries);
    const p = store.page({ today: '2026-07-01' });
    assert.deepEqual(
      p.items.map((x) => x.link),
      ['https://www.sec.gov/today'],
    );
    assert.equal(p.totalCounts.sec, 1);
    assert.equal(store.page().items.length, 3);
    assert.equal(store.page({ today: '2026-07-02' }).items.length, 0);
  } finally {
    store.close();
  }
});
test('filtering historical feed rows keeps timezone-formatting memory bounded', () => {
  const store = openStore(':memory:');
  try {
    store.save(Array.from({ length: 1500 }, (_, i) => ({
      sourceUrl: 'feed', publisher: 'ECB', itemId: String(i), title: 'Historical filing',
      link: 'https://example.org/' + i, publishedAt: '2025-01-01T12:00:00.000Z',
      excerpt: '', fetchedAt: '2025-01-01T12:00:00.000Z'
    })));
    const before = process.memoryUsage().rss;
    const page = store.page({ today: '2026-11-04' });
    const growth = process.memoryUsage().rss - before;
    assert.equal(page.items.length, 0);
    assert.ok(growth < 32 * 1024 ** 2, `Feed query allocated ${growth} bytes`);
  } finally {
    store.close();
  }
});
test('catalog deduplicates metadata, keeps identities separate, and only queues explicit same-company selections', () => {
  const s = openAnalysisStore(':memory:');
  try {
    const c = s.catalog;
    c.saveSearch({ market: 'US', companies: [fixture('2025'), fixture()] });
    c.saveSearch({ market: 'US', companies: [fixture()] });
    const id = companyId('US', cik),
      company = c.company(id);
    assert.equal(company.total, 2);
    assert.equal(company.reports.length, 0);
    const primary = company.filings[0],
      prior = company.filings[1];
    assert.equal(c.prior(primary.id).id, prior.id);
    assert.equal(
      c.enqueueReport({
        companyId: id,
        primaryId: primary.id,
        priorId: prior.id,
      }).status,
      'queued',
    );
    assert.throws(() =>
      c.enqueueReport({ companyId: 'other', primaryId: primary.id }),
    );
    assert.throws(() =>
      c.enqueueReport({
        companyId: id,
        primaryId: prior.id,
        priorId: primary.id,
      }),
    );
    c.saveSearch({
      market: 'DE',
      filings: [
        {
          company: 'Example GmbH',
          url: 'https://www.unternehmensregister.de/de/publication/a',
          title: 'Report',
          date: '2026-01-01',
        },
        {
          company: 'Example GmbH Berlin',
          url: 'https://www.unternehmensregister.de/de/publication/b',
          title: 'Report',
          date: '2026-01-01',
        },
      ],
    });
    assert.notEqual(
      companyId('DE', 'Example GmbH'),
      companyId('DE', 'Example GmbH Berlin'),
    );
  } finally {
    s.close();
  }
});
test('company history survives restarts without queuing analysis', () => {
  const dir = mkdtempSync(join(tmpdir(), 'company-'));
  try {
    let s = openAnalysisStore(join(dir, 'db'));
    s.catalog.saveSearch({ market: 'US', companies: [fixture()] });
    s.close();
    s = openAnalysisStore(join(dir, 'db'));
    assert.equal(s.catalog.company(companyId('US', cik)).total, 1);
    assert.equal(s.catalog.company(companyId('US', cik)).reports.length, 0);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('company/report APIs validate input, preserve manual execution and isolate source documents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'company-http-')),
    s = openAnalysisStore(join(dir, 'db'));
  try {
    s.catalog.saveSearch({ market: 'US', companies: [fixture()] });
    const id = companyId('US', cik),
      f = s.catalog.company(id).filings[0];
    const server = createServer({
      tls: {},
      allowedHosts: new Set(['localhost']),
      rateLimit: 100,
      html: readFileSync(require.resolve('../public/index.html'), 'utf8'),
      analysisStore: s,
      analysisDataDir: dir,
    });
    assert.equal((await req(server, '/companies/' + id)).status, 200);
    assert.equal(
      (await req(server, '/companies/' + id + '?lang=de')).status,
      200,
    );
    assert.equal(s.catalog.company(id).reports.length, 0);
    assert.equal(
      (await req(server, '/api/filings?from=2020-01-01')).status,
      400,
    );
    assert.equal(
      (
        await req(
          server,
          '/api/report-runs',
          'POST',
          { companyId: id, primaryId: f.id },
          {
            'content-type': 'application/json',
            origin: 'https://evil.example',
          },
        )
      ).status,
      403,
    );
    const r = await req(
      server,
      '/api/report-runs',
      'POST',
      { companyId: id, primaryId: f.id },
      { 'content-type': 'application/json' },
    );
    assert.equal(r.status, 202);
    const rid = JSON.parse(r.body).id;
    assert.equal((await req(server, '/reports/' + rid)).status, 200);
    assert.equal((await req(server, '/api/report-runs/' + rid)).status, 200);
    assert.equal((await req(server, '/documents/' + f.id)).status, 410);
    mkdirSync(join(dir, 'library'));
    writeFileSync(
      join(dir, 'library', f.id + '.source'),
      '<script>alert(1)</script><table><tr><td onclick="evil()" style="text-align:right;background:url(https://evil.example)">Revenue 123</td></tr></table><iframe src="https://evil.example"></iframe><img src="https://evil.example/pixel">',
    );
    writeFileSync(join(dir, 'library', f.id + '.anchors.json'), '[]');
    const db = new DatabaseSync(join(dir, 'db'));
    db.prepare('INSERT INTO library_documents VALUES(?,?,?,?,?,?,?)').run(
      f.id,
      'html',
      f.id + '.source',
      f.id + '.anchors.json',
      '{}',
      100,
      new Date().toISOString(),
    );
    db.close();
    const source = await req(server, '/documents/' + f.id + '/source');
    assert.equal(source.status, 200);
    assert.match(source.body, /<table>/);
    assert.doesNotMatch(source.body, /alert|onclick|evil\.example/);
    assert.match(
      source.headers['content-security-policy'],
      /script-src 'none'/,
    );
    const viewer = await req(server, '/documents/' + f.id);
    assert.equal(viewer.status, 200);
    assert.match(viewer.body, /Evidence and explanations/);
    assert.match(
      viewer.headers['content-security-policy'],
      /worker-src 'self'/,
    );
    assert.equal((await req(server, '/viewer-assets/pdf.mjs')).status, 200);
    assert.equal(
      (await req(server, '/viewer-assets/../../package.json')).status,
      404,
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filing selections survive pagination and status polling stays bounded', async () => {
  const { JSDOM } = require('jsdom'),
    s = openAnalysisStore(':memory:');
  try {
    const company = {
      ...fixture(),
      filings: Array.from(
        { length: 21 },
        (_, i) => fixture('2026', String(i + 1).padStart(6, '0')).filings[0],
      ),
    };
    s.catalog.saveSearch({ market: 'US', companies: [company] });
    const id = companyId('US', cik);
    const server = createServer({
      tls: {},
      allowedHosts: new Set(['localhost']),
      rateLimit: 100,
      html: readFileSync(require.resolve('../public/index.html'), 'utf8'),
      analysisStore: s,
      fetcher: async () => {
        throw Error('Publisher offline');
      },
    });
    const cached = JSON.parse(
      (await req(server, '/api/company-filings?market=US&company=AAPL')).body,
    );
    assert.equal(cached.cachedOnly, true);
    assert.equal(cached.companies[0].companyId, id);
    const first = await req(server, '/companies/' + id),
      one = new JSDOM(first.body, {
        url: 'https://localhost/companies/' + id,
        runScripts: 'outside-only',
      });
    try {
      one.window.eval(one.window.document.querySelector('script').textContent);
      const d = one.window.document,
        checkbox = d.querySelector('[name=additional]');
      checkbox.checked = true;
      d.getElementById('primary').value = checkbox.value;
      const link = d.querySelector('[data-keep-selection]');
      link.addEventListener('click', (e) => e.preventDefault());
      link.click();
      const target = new URL(link.href),
        state = JSON.parse(target.searchParams.get('state'));
      assert.deepEqual(state.additionalIds, [checkbox.value]);
      assert.equal(state.primaryId, checkbox.value);
      assert.ok(target.searchParams.get('offset'));
      const second = await req(server, target.pathname + target.search),
        two = new JSDOM(second.body, {
          url: target.href,
          runScripts: 'outside-only',
        });
      try {
        let submitted;
        two.window.fetch = async (_url, options) => {
          submitted = JSON.parse(options.body);
          return {
            ok: false,
            json: async () => ({ error: 'Fixture captured' }),
          };
        };
        two.window.eval(
          two.window.document.querySelector('script').textContent,
        );
        assert.equal(
          two.window.document.getElementById('primary').value,
          checkbox.value,
        );
        const next = two.window.document.querySelector('[name=additional]');
        next.checked = true;
        two.window.document.getElementById('run').click();
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(
          new Set(submitted.additionalIds),
          new Set([checkbox.value, next.value]),
        );
        const offPage = two.window.document.querySelector(
          `[name=additional][value="${checkbox.value}"]`,
        );
        assert.ok(
          offPage,
          'off-page context stays visible and removable before running',
        );
        offPage.checked = false;
        two.window.document.getElementById('run').click();
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(submitted.additionalIds, [next.value]);
        assert.equal(s.catalog.company(id).reports.length, 0);
      } finally {
        two.window.close();
      }
    } finally {
      one.window.close();
    }
    const f = s.catalog.company(id).filings[0];
    const run = s.catalog.enqueueReport({ companyId: id, primaryId: f.id });
    const status = JSON.parse(
      (await req(server, '/api/report-runs/' + run.id + '?status=1')).body,
    );
    assert.equal(status.status, 'queued');
    assert.equal(status.payload, null);
    assert.equal(status.filing_ids, undefined);
  } finally {
    s.close();
  }
});

test('selection state cannot restore arbitrary controls or forge source labels', async () => {
  const { JSDOM } = require('jsdom');
  const store = openAnalysisStore(':memory:');
  try {
    store.catalog.saveSearch({
      market: 'US',
      companies: [fixture('2025'), fixture()],
    });
    const company = companyId('US', cik),
      filing = store.catalog.company(company).filings[0];
    const server = createServer({
      tls: {},
      allowedHosts: new Set(['localhost']),
      rateLimit: 100,
      html: readFileSync(require.resolve('../public/index.html'), 'utf8'),
      analysisStore: store,
    });
    for (const invalid of [
      null,
      [],
      { additionalIds: [false] },
      { primaryId: 'f'.repeat(64) },
    ]) {
      assert.equal(
        (
          await req(
            server,
            `/companies/${company}?state=${encodeURIComponent(JSON.stringify(invalid))}`,
          )
        ).status,
        400,
      );
    }
    const state = {
      primaryId: filing.id,
      additionalIds: [],
      fields: { year: { value: '2026' }, primary: { text: 'Forged filing' } },
    };
    const response = await req(
      server,
      `/companies/${company}?year=2025&state=${encodeURIComponent(JSON.stringify(state))}`,
    );
    const dom = new JSDOM(response.body, {
      url: 'https://localhost/companies/' + company + '?year=2025',
      runScripts: 'outside-only',
    });
    try {
      dom.window.eval(dom.window.document.querySelector('script').textContent);
      assert.equal(dom.window.document.getElementById('year').value, '2025');
      assert.equal(
        dom.window.document.getElementById('primary').value,
        filing.id,
      );
      assert.doesNotMatch(
        dom.window.document.getElementById('primary').selectedOptions[0]
          .textContent,
        /Forged/,
      );
      assert.equal(store.catalog.company(company).reports.length, 0);
    } finally {
      dom.window.close();
    }
  } finally {
    store.close();
  }
});

test('comparison proposals cannot overwrite a newer company-page selection', async () => {
  const { JSDOM } = require('jsdom'),
    store = openAnalysisStore(':memory:');
  try {
    store.catalog.saveSearch({
      market: 'US',
      companies: [fixture('2024'), fixture('2025'), fixture()],
    });
    const company = companyId('US', cik),
      filings = store.catalog.company(company).filings;
    const server = createServer({
      tls: {},
      allowedHosts: new Set(['localhost']),
      rateLimit: 100,
      html: readFileSync(require.resolve('../public/index.html'), 'utf8'),
      analysisStore: store,
    });
    const response = await req(server, '/companies/' + company);
    const dom = new JSDOM(response.body, {
      url: 'https://localhost/companies/' + company,
      runScripts: 'outside-only',
    });
    try {
      const pending = [];
      dom.window.fetch = () => new Promise((resolve) => pending.push(resolve));
      dom.window.eval(dom.window.document.querySelector('script').textContent);
      const primary = dom.window.document.getElementById('primary'),
        prior = dom.window.document.getElementById('prior');
      const change = (input) =>
        input.dispatchEvent(new dom.window.Event('change'));
      const reply = (filing) => ({
        ok: true,
        json: async () => ({ prior: filing }),
      });
      primary.value = filings[0].id;
      change(primary);
      primary.value = filings[1].id;
      change(primary);
      pending[1](reply(filings[2]));
      await new Promise((resolve) => setImmediate(resolve));
      pending[0](reply(filings[1]));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(prior.value, filings[2].id);
      primary.value = filings[0].id;
      change(primary);
      prior.value = '';
      change(prior);
      pending[2](reply(filings[1]));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(prior.value, '');
    } finally {
      dom.window.close();
    }
  } finally {
    store.close();
  }
});

test('legacy job links reflect current jobs without overwriting cached filing metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-jobs-')),
    path = join(directory, 'db');
  const store = openAnalysisStore(path);
  const db = new DatabaseSync(path);
  try {
    const result = { market: 'US', companies: [fixture()] };
    store.catalog.saveSearch(result);
    const id = companyId('US', cik),
      before = store.catalog.company(id).filings[0];
    const job = store.enqueue([
      {
        market: 'US',
        cik,
        accession: before.accession,
        url: before.url,
        title: 'Legacy job title',
        formType: '10-K',
      },
    ])[0];
    let current = store.catalog.company(id).filings[0];
    assert.equal(current.job_id, job.id);
    assert.equal(current.analysis_status, 'queued');
    assert.equal(current.title, before.title);
    assert.equal(current.filed_at, before.filed_at);
    db.prepare("UPDATE analysis_jobs SET status='complete' WHERE id=?").run(
      job.id,
    );
    assert.equal(
      store.catalog.company(id).filings[0].analysis_status,
      'complete',
    );
    db.prepare('DELETE FROM analysis_jobs WHERE id=?').run(job.id);
    assert.equal(store.catalog.company(id).filings[0].job_id, null);
  } finally {
    db.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
