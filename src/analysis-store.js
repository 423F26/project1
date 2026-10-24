'use strict';

const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;
const CIK = /^\d{10}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FILINGS = 40;
const MAX_TITLE = 500;

function checkedUrl(value, market, cik = '', accession = '') {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid filing URL.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid filing URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid filing URL.');
  if (market === 'US') {
    const directory = accession.replaceAll('-', '');
    const prefix = `/Archives/edgar/data/${Number(cik)}/${directory}/`;
    if (url.origin !== 'https://www.sec.gov' || url.search || !ACCESSION.test(accession) || !CIK.test(cik) || !url.pathname.startsWith(prefix) || url.pathname.slice(prefix.length).includes('..') || !/^[A-Za-z0-9._-]+$/.test(url.pathname.slice(prefix.length))) throw new Error('Invalid SEC filing reference.');
  } else if (market === 'DE') {
    if (url.origin !== 'https://www.unternehmensregister.de' || !/^\/de\/(?:publication|deposits|registerPortalAdvice)(?:\/|$)/.test(url.pathname)) throw new Error('Invalid German register reference.');
  } else throw new Error('Unsupported filing market.');
  return url.href;
}

function normalizeFilings(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_FILINGS) throw new Error(`Choose between 1 and ${MAX_FILINGS} filings.`);
  const normalized = input.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid filing reference.');
    const market = item.market;
    const cik = market === 'US' && typeof item.cik === 'string' ? item.cik : '';
    const accession = market === 'US' && typeof item.accession === 'string' ? item.accession : '';
    const url = checkedUrl(item.url, market, cik, accession);
    const title = typeof item.title === 'string' && item.title.trim() && item.title.length <= MAX_TITLE && !/[\u0000-\u001f\u007f]/.test(item.title)
      ? item.title.trim() : 'Selected filing';
    const formType = typeof item.formType === 'string' && /^[A-Za-z0-9-]{0,12}$/.test(item.formType) ? item.formType : '';
    const sourceKey = market === 'US' ? `US:${cik}:${accession}` : `DE:${url}`;
    return { id: randomUUID(), sourceKey, market, url, cik, accession, title, formType };
  });
  return [...new Map(normalized.map((item) => [item.sourceKey, item])).values()];
}

function openAnalysisStore(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  db.exec(readFileSync(join(__dirname, 'analysis-schema.sql'), 'utf8'));
  return {
    enqueue(filings) {
      const normalized = normalizeFilings(filings);
      db.exec('BEGIN IMMEDIATE');
      try {
        const insert = db.prepare(`INSERT INTO analysis_jobs
          (id, source_key, market, filing_url, cik, accession, title, form_type, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
          ON CONFLICT(source_key) DO UPDATE SET
            status='queued', error='', result_path='', artifact_bytes=0, completed_at='', created_at=excluded.created_at, updated_at=excluded.updated_at
          WHERE analysis_jobs.status IN ('failed','unavailable')`);
        const find = db.prepare('SELECT id, market, title, status FROM analysis_jobs WHERE source_key=?');
        const timestamp = new Date().toISOString();
        for (const item of normalized) insert.run(item.id, item.sourceKey, item.market, item.url, item.cik, item.accession, item.title, item.formType, timestamp, timestamp);
        const jobs = normalized.map((item) => find.get(item.sourceKey));
        db.exec('COMMIT');
        return jobs;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    get(id) {
      if (!UUID.test(id)) return undefined;
      return db.prepare(`SELECT id, market, title, status, error, result_path, created_at, updated_at, completed_at
        FROM analysis_jobs WHERE id=?`).get(id);
    },
    getMany(ids) {
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_FILINGS || ids.some((id) => !UUID.test(id))) throw new Error('Invalid job IDs.');
      const unique = [...new Set(ids)];
      const placeholders = unique.map(() => '?').join(',');
      return db.prepare(`SELECT id, market, title, status, error, created_at, updated_at, completed_at
        FROM analysis_jobs WHERE id IN (${placeholders})`).all(...unique);
    },
    close: () => db.close()
  };
}

module.exports = { MAX_FILINGS, checkedUrl, normalizeFilings, openAnalysisStore };
