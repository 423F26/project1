'use strict';
const { createHash, randomUUID } = require('node:crypto');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const companyId = (market, identity) =>
  `${market.toLowerCase()}-${market === 'US' ? String(identity).padStart(10, '0') : digest(identity.normalize('NFC').trim())}`;
function secReference(item) {
  const match =
    /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/(\d{1,10})\/(\d{18})\/([\w.-]+)$/.exec(
      item.link || '',
    );
  if (!match) return null;
  const accession = `${match[2].slice(0, 10)}-${match[2].slice(10, 12)}-${match[2].slice(12)}`;
  return {
    market: 'US',
    cik: match[1].padStart(10, '0'),
    accession,
    url: item.link,
    title: item.company_name || item.title,
    formType: item.form_type || '',
    filingDate: item.published_at || '',
    reportDate: '',
    name: item.company_name || item.title,
  };
}
function companyStore(db, normalizeFilings) {
  const { topicMatches } = require('./company-search');
  db.function('filing_topic', (topic, title, description) =>
    topicMatches(topic, title, description) ? 1 : 0,
  );
  db.function('filing_form', (filter, form) =>
    !filter ||
    filter === form ||
    (filter === 'annual' && ['10-K', '20-F', 'ANNUAL'].includes(form)) ||
    (filter === 'quarterly' && form === '10-Q') ||
    (filter === 'interim' && form === 'INTERIM') ||
    (filter === 'other' && form === 'OTHER')
      ? 1
      : 0,
  );
  function saveCompany(market, identity, name, ticker = '') {
    const id = companyId(market, identity);
    db.prepare(
      `INSERT INTO companies(id,market,identity,name,ticker) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,ticker=CASE WHEN excluded.ticker<>'' THEN excluded.ticker ELSE ticker END`,
    ).run(id, market, identity, name, ticker);
    return id;
  }
  function saveFiling(company, filing) {
    const item = normalizeFilings([filing])[0],
      id = digest(item.sourceKey);
    db.prepare(
      `INSERT INTO company_filings(id,company_id,source_key,market,url,cik,accession,title,form_type,filed_at,report_date,source_description)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,
      url=CASE WHEN excluded.url LIKE '%-index.htm' THEN url ELSE excluded.url END,
      form_type=CASE WHEN excluded.form_type<>'' THEN excluded.form_type ELSE form_type END,
      filed_at=CASE WHEN excluded.filed_at<>'' THEN excluded.filed_at ELSE filed_at END,
      report_date=CASE WHEN excluded.report_date<>'' THEN excluded.report_date ELSE report_date END,
      source_description=CASE WHEN excluded.source_description<>'' THEN excluded.source_description ELSE source_description END`,
    ).run(
      id,
      company,
      item.sourceKey,
      item.market,
      item.url,
      item.cik,
      item.accession,
      item.title,
      item.formType,
      filing.filingDate || '',
      filing.reportDate || '',
      filing.description || filing.information || '',
    );
    return id;
  }
  return {
    saveSearch(result) {
      if (result.market === 'US')
        for (const c of result.companies) {
          c.companyId = saveCompany('US', c.cik, c.name, c.ticker);
          for (const f of c.filings)
            f.filingId = saveFiling(c.companyId, {
              ...f,
              market: 'US',
              cik: c.cik,
              title: f.description || `${c.name} — ${f.form}`,
              formType: f.form,
            });
        }
      else
        for (const f of result.filings) {
          f.companyId = saveCompany(
            'DE',
            f.company.normalize('NFC').trim(),
            f.company,
          );
          const { germanTypeMatches } = require('./company-search');
          const type = germanTypeMatches(f, 'annual')
            ? 'ANNUAL'
            : germanTypeMatches(f, 'interim')
              ? 'INTERIM'
              : 'OTHER';
          const period =
            /(?:bis|zum|ended|ending)\s+(\d{2})\.(\d{2})\.(\d{4})/i.exec(
              `${f.information || ''} ${f.title}`,
            );
          const reportDate = period
            ? `${period[3]}-${period[2]}-${period[1]}`
            : '';
          f.filingId = saveFiling(f.companyId, {
            ...f,
            market: 'DE',
            filingDate: f.date,
            formType: type,
            reportDate:
              reportDate &&
              !Number.isNaN(Date.parse(reportDate)) &&
              new Date(reportDate).toISOString().slice(0, 10) === reportDate
                ? reportDate
                : '',
          });
        }
      return result;
    },
    saveFeed(items) {
      for (const row of items) {
        const f = secReference(row);
        if (f) {
          const id = companyId('US', f.cik);
          if (!db.prepare('SELECT 1 FROM companies WHERE id=?').get(id))
            saveCompany('US', f.cik, f.name);
          saveFiling(id, f);
        }
      }
    },
    backfill() {
      for (const j of db
        .prepare("SELECT * FROM analysis_jobs WHERE cik<>'' AND market='US'")
        .all()) {
        if (
          db
            .prepare('SELECT 1 FROM company_filings WHERE source_key=?')
            .get(j.source_key)
        )
          continue;
        saveFiling(
          db
            .prepare('SELECT id FROM companies WHERE id=?')
            .get(companyId('US', j.cik))?.id ||
            saveCompany(
              'US',
              j.cik,
              j.title.includes(' — ')
                ? j.title.split(' — ')[0]
                : `SEC CIK ${j.cik}`,
            ),
          {
            market: 'US',
            cik: j.cik,
            accession: j.accession,
            url: j.filing_url,
            title: j.title,
            formType: j.form_type,
          },
        );
      }
    },
    company(
      id,
      { offset = 0, reportOffset = 0, form = '', year = '', topic = '' } = {},
    ) {
      const c = db.prepare('SELECT * FROM companies WHERE id=?').get(id);
      if (!c) return null;
      const args = [id, form, year, year, topic];
      const where =
        "f.company_id=? AND filing_form(?,f.form_type) AND (?='' OR substr(CASE WHEN f.market='US' THEN COALESCE(NULLIF(f.report_date,''),f.filed_at) ELSE f.filed_at END,1,4)=?) AND filing_topic(?,f.title,f.source_description)";
      // German legacy jobs identify publications by exact URL, not inferred company names.
      const filings = db
        .prepare(
          `SELECT f.id,f.company_id,f.source_key,f.market,f.url,f.cik,f.accession,f.title,f.form_type,f.filed_at,f.report_date,f.source_description,
            j.id AS job_id,j.status AS analysis_status,CASE WHEN d.filing_id IS NULL THEN 0 ELSE 1 END AS downloaded
            FROM company_filings f LEFT JOIN analysis_jobs j ON j.id=(
              SELECT id FROM analysis_jobs WHERE source_key=f.source_key OR (market=f.market AND filing_url=f.url)
              ORDER BY status='complete' DESC,status IN ('queued','fetching','extracting','translating','classifying') DESC,created_at DESC LIMIT 1
            ) LEFT JOIN library_documents d ON d.filing_id=f.id WHERE ${where} ORDER BY filed_at DESC,f.id LIMIT 20 OFFSET ?`,
        )
        .all(...args, offset);
      return {
        ...c,
        filings,
        total: db
          .prepare(`SELECT COUNT(*) AS n FROM company_filings f WHERE ${where}`)
          .get(...args).n,
        reports: db
          .prepare(
            'SELECT id,status,stage,error,created_at,completed_at FROM report_runs WHERE company_id=? ORDER BY created_at DESC LIMIT 20 OFFSET ?',
          )
          .all(id, reportOffset),
        reportTotal: db
          .prepare('SELECT COUNT(*) AS n FROM report_runs WHERE company_id=?')
          .get(id).n,
        assessment:
          db
            .prepare(
              'SELECT payload,updated_at FROM company_assessments WHERE company_id=?',
            )
            .get(id) || null,
      };
    },
    lookup(market, query) {
      return db
        .prepare(
          "SELECT * FROM companies WHERE market=? AND (lower(name) LIKE ? ESCAPE '\\' OR lower(ticker)=lower(?) OR identity=?) ORDER BY name LIMIT 5",
        )
        .all(
          market,
          '%' + query.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%',
          query,
          market === 'US' ? query.padStart(10, '0') : query,
        );
    },
    filing(id) {
      return db.prepare('SELECT * FROM company_filings WHERE id=?').get(id);
    },
    prior(id) {
      const f = this.filing(id);
      if (!f || !f.form_type || !f.report_date) return null;
      return (
        db
          .prepare(
            `SELECT * FROM company_filings WHERE company_id=? AND form_type=? AND report_date<>'' AND report_date<? AND filed_at<? ORDER BY report_date DESC,filed_at DESC LIMIT 1`,
          )
          .get(f.company_id, f.form_type, f.report_date, f.filed_at) || null
      );
    },
    reportStatus(id) {
      return (
        db
          .prepare(
            'SELECT id,company_id,status,stage,error,created_at,completed_at FROM report_runs WHERE id=?',
          )
          .get(id) || null
      );
    },
    report(id) {
      return db.prepare('SELECT * FROM report_runs WHERE id=?').get(id) || null;
    },
    enqueueReport({
      companyId: cid,
      primaryId,
      priorId = null,
      additionalIds = [],
    }) {
      if (
        !Array.isArray(additionalIds) ||
        additionalIds.length > 40 ||
        additionalIds.some((x) => typeof x !== 'string')
      )
        throw new Error('Choose at most 40 filings.');
      const ids = [
        ...new Set([primaryId, priorId, ...additionalIds].filter(Boolean)),
      ];
      if (ids.length > 40) throw new Error('Choose at most 40 filings.');
      const filings = ids.map((id) => this.filing(id));
      if (!primaryId || filings.some((f) => !f || f.company_id !== cid))
        throw new Error('Choose cached filings from the same company.');
      if (priorId) {
        const p = this.filing(primaryId),
          b = this.filing(priorId);
        if (
          !p.report_date ||
          !b.report_date ||
          !p.form_type ||
          b.form_type !== p.form_type ||
          b.report_date >= p.report_date ||
          b.filed_at >= p.filed_at
        )
          throw new Error(
            'Choose an earlier comparable filing, or omit comparison.',
          );
      }
      const id = randomUUID(),
        now = new Date().toISOString();
      db.prepare(
        `INSERT INTO report_runs(id,company_id,primary_id,prior_id,filing_ids,status,stage,created_at) VALUES(?,?,?,?,?,'queued','queued',?)`,
      ).run(id, cid, primaryId, priorId, JSON.stringify(ids), now);
      return this.report(id);
    },
    document(id) {
      return (
        db
          .prepare('SELECT * FROM library_documents WHERE filing_id=?')
          .get(id) || null
      );
    },
  };
}
module.exports = { companyStore, companyId, secReference };
