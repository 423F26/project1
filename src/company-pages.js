'use strict';
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const sanitize = require('sanitize-html');
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const idPattern = /^(?:us-\d{10}|de-[a-f0-9]{64})$/;
const uuidPattern = /^[a-f0-9-]{36}$/;
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const style = readFileSync(join(__dirname, '../public/company.css'), 'utf8');
const companyScript = readFileSync(
  join(__dirname, '../public/company.js'),
  'utf8',
);
const states = {
  queued: ['Queued', 'In der Warteschlange'],
  running: ['In progress', 'In Bearbeitung'],
  partial: ['Partial report', 'Teilbericht'],
  complete: ['Complete', 'Abgeschlossen'],
  unavailable: ['Unavailable', 'Nicht verfügbar'],
  failed: ['Failed', 'Fehlgeschlagen'],
  fetching: ['Retrieving document', 'Dokument wird abgerufen'],
  retrieving: ['Retrieving documents', 'Dokumente werden abgerufen'],
  extracting: ['Reading document', 'Dokument wird gelesen'],
  translating: ['Translating', 'Übersetzung läuft'],
  classifying: ['Analyzing sentiment', 'Sentiment wird analysiert'],
  reviewing: ['Reviewing passages', 'Textstellen werden geprüft'],
  summarizing: ['Writing summary', 'Zusammenfassung wird erstellt'],
  reconciling: ['Checking findings', 'Befunde werden abgeglichen'],
  'company-assessment': [
    'Updating company assessment',
    'Unternehmensüberblick wird aktualisiert',
  ],
  starting: ['Starting', 'Wird gestartet'],
  recovered: ['Queued after restart', 'Nach Neustart eingereiht'],
  finished: ['Finished', 'Beendet'],
  pruned: ['Removed by storage quota', 'Wegen Speicherlimit entfernt'],
  retrieved: ['Document retrieved', 'Dokument abgerufen'],
  publisher: ['Publisher document', 'Original des Herausgebers'],
  registry: ['Registry document', 'Registerdokument'],
  issuer: ['Issuer document', 'Dokument des Unternehmens'],
  manual_upload: ['Uploaded original', 'Hochgeladenes Original'],
};
function stateText(value, lang) {
  return esc(states[value]?.[lang === 'de' ? 1 : 0] || value || '');
}
function selectionFor(catalog, companyId, raw) {
  const state = raw ? JSON.parse(raw) : {};
  if (!state || typeof state !== 'object' || Array.isArray(state))
    throw new Error('Invalid filing selection.');
  const { primaryId = '', priorId = '', additionalIds = [] } = state;
  if (
    typeof primaryId !== 'string' ||
    typeof priorId !== 'string' ||
    !Array.isArray(additionalIds) ||
    additionalIds.length > 40
  )
    throw new Error('Invalid filing selection.');
  if (
    additionalIds.some(
      (id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id),
    )
  )
    throw new Error('Invalid filing selection.');
  for (const id of [primaryId, priorId, ...additionalIds].filter(Boolean)) {
    if (
      typeof id !== 'string' ||
      !/^[a-f0-9]{64}$/.test(id) ||
      catalog.filing(id)?.company_id !== companyId
    )
      throw new Error('Choose cached filings from the same company.');
  }
  return { primaryId, priorId, additionalIds: [...new Set(additionalIds)] };
}
function page(title, body, data, script = '') {
  const inline = `const pageData=${json(data)};
try {
  const saved=localStorage.getItem('pageLanguage');
  if (!new URLSearchParams(location.search).has('lang') && saved==='de' && pageData.lang!=='de') {
    const target=new URL(location.href);target.searchParams.set('lang','de');location.replace(target.pathname+target.search);
  } else localStorage.setItem('pageLanguage',pageData.lang);
} catch {}
const languageSelect=document.getElementById('language-select');
if(languageSelect){languageSelect.value=pageData.lang;languageSelect.addEventListener('change',()=>{const lang=languageSelect.value==='de'?'de':'en';try{localStorage.setItem('pageLanguage',lang)}catch{}const target=new URL(location.href);target.searchParams.set('lang',lang);if(typeof collectSelection==='function')target.searchParams.set('state',JSON.stringify(collectSelection()));location.assign(target.pathname+target.search+target.hash)});}
${script}

`;
  const html = `<!doctype html><html lang="${data.lang || 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Zwicky | ${esc(title)}</title><style>${style}</style></head><body><a class="skip" href="#main">${data.lang === 'de' ? 'Zum Inhalt' : 'Skip to content'}</a><main id="main" tabindex="-1"><header class="page-header"><a class="product-name" href="/">Zwicky</a><label class="language-picker"><span class="visually-hidden">${data.lang === 'de' ? 'Sprache' : 'Language'}</span><select id="language-select" aria-label="${data.lang === 'de' ? 'Sprache' : 'Language'}"><option value="en"${data.lang === 'en' ? ' selected' : ''}>English</option><option value="de"${data.lang === 'de' ? ' selected' : ''}>Deutsch</option></select></label></header>${body}</main><script type="module" data-cfasync="false">${inline}</script></body></html>`;
  return {
    html,
    csp: `default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'sha256-${createHash('sha256').update(inline).digest('base64')}'; connect-src 'self'; worker-src 'self'; img-src 'self' data:; frame-src 'self'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
  };
}
function bilingual(value, lang) {
  return esc(value?.[lang] || value?.en || '');
}
function evidence(items, lang, reportId, target = 'what-changed') {
  return (items || [])
    .map(
      (e) =>
        `<blockquote><a href="/documents/${esc(e.filingId)}?report=${esc(reportId)}&anchor=${encodeURIComponent(e.anchor || '')}&evidence=${createHash(
          'sha256',
        )
          .update(JSON.stringify([target, e.quote]))
          .digest('hex')
          .slice(
            0,
            16,
          )}&lang=${lang}">${esc(e.quote)}</a><br><small>${esc(e.reference || e.anchor)}${e.period ? ` · ${lang === 'de' ? 'Berichtszeitraum' : 'Filing period'}: ${esc(e.period)}` : ''}</small></blockquote>`,
    )
    .join('');
}
function reportBody(r, lang) {
  const de = lang === 'de',
    p = r.payload ? JSON.parse(r.payload) : null;
  if (!p)
    return `<h1>${de ? 'Bericht' : 'Report'}</h1><p>${stateText(r.status, lang)}</p><p>${esc(r.error)}</p><p id="status" role="status">${r.stage !== r.status && ['queued', 'running'].includes(r.status) ? stateText(r.stage, lang) : ''}</p>`;
  return `<h1>${de ? 'Unternehmensbericht' : 'Company report'}</h1><p>${esc(r.created_at)} · ${stateText(r.status, lang)}</p><p id="status" role="status">${r.stage !== r.status && ['queued', 'running'].includes(r.status) ? stateText(r.stage, lang) : ''}</p><p>${de ? 'Ausgewählte Dokumente' : 'Selected documents'}: ${(p.filings || []).map((f) => `<a href="/documents/${esc(f.id)}?report=${r.id}&lang=${lang}">${esc(f.formType)} ${esc(f.title)} (${esc(f.period)})</a> ${stateText(f.status, lang)} ${esc(f.error || '')}`).join(' · ')}</p><p>${bilingual(p.limits, lang)}</p><p>${esc(r.error)}</p>
  <section id="what-changed"><h2>${de ? 'Was hat sich geändert?' : 'What changed'}</h2>${(p.summary || []).map((x) => `<p>${bilingual(x.text, lang)}</p>${evidence(x.evidence, lang, r.id)}`).join('') || `<p>${de ? 'Zusammenfassung nicht verfügbar.' : 'Summary unavailable.'}</p>`}${(p.changes || []).map((x) => `<p>${bilingual(x.text, lang)}</p>${x.delta !== undefined ? `<p>${de ? 'Absolute Änderung' : 'Absolute change'}: ${esc(x.delta)} ${/^(%|percent|prozent)$/i.test(x.unit) ? (de ? 'Prozentpunkte' : 'percentage points') : esc(x.unit)} (${esc(x.periods)})</p>` : ''}${evidence(x.evidence, lang, r.id)}`).join('') || `<p>${de ? 'Keine validierten vergleichbaren Änderungen verfügbar.' : 'No validated comparable changes available.'}</p>`}</section>
  <section id="bias-review"><h2>${de ? 'Bias-Prüfung' : 'Bias review'}</h2><p>${de ? 'Numerischer Score bis zur Freigabe der Kalibrierung nicht verfügbar.' : 'Numeric score unavailable pending calibration approval.'}</p>${(p.findings || []).map((f, i) => `<article id="finding-${i}"><h3>${bilingual(f.title, lang)}</h3><p>${f.label === 'supported finding' ? (de ? 'Belegter Befund' : 'Supported finding') : de ? 'Möglicher Anlass zur Sorge' : 'Potential concern'}</p><p>${bilingual(f.explanation, lang)}</p><p>${bilingual(f.uncertainty, lang)}</p><p>${de ? 'Bewertungen (Sprache / Lenkung / finanzielle Bedeutung)' : 'Ratings (language / steering / financial importance)'}: ${esc(f.language)} / ${esc(f.steering)} / ${esc(f.importance)}</p>${evidence(f.evidence, lang, r.id, `finding-${i}`)}</article>`).join('') || `<p>${de ? 'Keine validierten Befunde. Dies belegt keine Neutralität.' : 'No validated findings. This does not establish neutrality.'}</p>`}</section>
  <section id="financial-risk"><h2>${de ? 'Finanzielles Risikoprofil' : 'Financial risk profile'}</h2>${[
    'liquidity',
    'leverage',
    'cash_flow',
    'market_exposure',
  ]
    .map(
      (k) =>
        `<article><h3>${{ liquidity: de ? 'Liquidität und Verpflichtungen' : 'Liquidity and obligations', leverage: de ? 'Verschuldung' : 'Debt and leverage', cash_flow: de ? 'Cashflow' : 'Cash flow', market_exposure: de ? 'Marktrisiken' : 'Market exposure' }[k]}</h3>${
          (p.risks || [])
            .filter((x) => x.category === k)
            .map(
              (x) =>
                `<p>${bilingual(x.text, lang)} — ${esc(x.value)} ${esc(x.unit)} · ${esc(x.period)}</p><p>${bilingual(x.definition, lang)}</p>${evidence(x.evidence, lang, r.id, 'financial-risk')}`,
            )
            .join('') || `<p>${de ? 'Nicht verfügbar' : 'Unavailable'}</p>`
        }</article>`,
    )
    .join('')}</section>`;
}
const reportScript = `if(['queued','running'].includes(pageData.status)){async function poll(){try{const response=await fetch('/api/report-runs/'+location.pathname.split('/').pop()+'?status=1');if(!response.ok)throw Error(pageData.lang==='de'?'Status nicht verfügbar.':'Status unavailable.');const run=await response.json();document.getElementById('status').textContent=(run.stage === run.status ? '' : pageData.labels[run.stage]||run.stage)+(run.error?': '+run.error:'');if(!['queued','running'].includes(run.status)){location.reload();return;}}catch(error){document.getElementById('status').textContent=error.message;}setTimeout(poll,15000);}setTimeout(poll,15000);}`;
async function handleCompanyRequest({
  request,
  response,
  url,
  options,
  catalog,
  reply,
  readJsonBody,
}) {
  const path = url.pathname;
  const send = (status, body, extra = {}) => {
    reply(response, status, body, extra);
    return true;
  };
  const sendJson = (status, data) =>
    send(status, JSON.stringify(data), {
      'content-type': 'application/json; charset=utf-8',
    });
  if (
    request.method === 'GET' &&
    (request.headers['transfer-encoding'] ||
      (request.headers['content-length'] &&
        request.headers['content-length'] !== '0'))
  )
    return send(413, 'Request body not accepted.\n');
  if (path.startsWith('/viewer-assets/')) {
    const assets = {
      'pdf.mjs': 'pdfjs-dist/legacy/build/pdf.mjs',
      'pdf.worker.mjs': 'pdfjs-dist/legacy/build/pdf.worker.mjs',
    };
    const asset = assets[path.slice('/viewer-assets/'.length)];
    if (!asset) return send(404, 'Not found.\n');
    return send(200, readFileSync(require.resolve(asset)), {
      'content-type': 'text/javascript; charset=utf-8',
    });
  }
  if (!catalog)
    return sendJson(503, { error: 'Company reports are not configured.' });
  const lang = url.searchParams.get('lang') === 'de' ? 'de' : 'en',
    de = lang === 'de';
  try {
    if (path === '/api/report-runs' && request.method === 'POST') {
      if (
        (request.headers.origin &&
          request.headers.origin !== `https://${request.headers.host}`) ||
        request.headers['sec-fetch-site'] === 'cross-site'
      )
        return send(403, 'Cross-origin request rejected.\n');
      if (
        request.headers['transfer-encoding'] ||
        Number(request.headers['content-length'] || 0) > 16384
      )
        return send(413, 'Request too large.\n');
      if (
        !/^application\/json(?:\s*;|$)/i.test(
          request.headers['content-type'] || '',
        )
      )
        return send(415, 'Expected JSON.\n');
      response.requestDeadline = setTimeout(() => request.destroy(), 5000);
      response.requestDeadline.unref();
      const body = await readJsonBody(request);
      const r = catalog.enqueueReport(body || {});
      return sendJson(202, { id: r.id, status: r.status });
    }
    const prior = /^\/api\/company-filings\/([a-f0-9]{64})\/prior$/.exec(path);
    if (prior) return sendJson(200, { prior: catalog.prior(prior[1]) });
    const company = /^\/(api\/)?companies\/([^/]+)$/.exec(path);
    if (company) {
      if (!idPattern.test(company[2])) return send(404, 'Not found.\n');
      const offset = Number(url.searchParams.get('offset') || 0),
        reportOffset = Number(url.searchParams.get('reportOffset') || 0),
        form = url.searchParams.get('form') || '',
        year = url.searchParams.get('year') || '',
        topic = url.searchParams.get('topic') || '';
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > 1000000 ||
        !Number.isSafeInteger(reportOffset) ||
        reportOffset < 0 ||
        reportOffset > 1000000 ||
        !/^[-A-Za-z0-9]{0,12}$/.test(form) ||
        (year && !/^\d{4}$/.test(year)) ||
        !['', 'revenue', 'estimates', 'depreciation', 'non_gaap'].includes(
          topic,
        )
      )
        return send(400, 'Invalid company filters.\n');
      const c = catalog.company(company[2], {
        offset,
        reportOffset,
        form,
        year,
        topic,
      });
      if (!c) return send(404, 'Company not found.\n');
      if (company[1]) return sendJson(200, c);
      const assessment = c.assessment ? JSON.parse(c.assessment.payload) : null;
      const selection = selectionFor(
        catalog,
        c.id,
        url.searchParams.get('state'),
      );
      const available = new Map(c.filings.map((f) => [f.id, f]));
      for (const id of [selection.primaryId, selection.priorId].filter(Boolean))
        available.set(id, catalog.filing(id));
      const opts = (selected) =>
        [...available.values()]
          .map(
            (f) =>
              `<option value="${f.id}"${f.id === selected ? ' selected' : ''}>${esc(f.form_type)} · ${esc(f.title)} · ${esc(f.report_date || f.filed_at || '—')}</option>`,
          )
          .join('');
      const offPage = selection.additionalIds
        .filter((id) => !c.filings.some((f) => f.id === id))
        .map((id) => catalog.filing(id));
      const context = offPage.length
        ? `<details><summary>${de ? 'Zusätzliche Auswahl auf anderen Seiten' : 'Additional selections on other pages'} (${offPage.length})</summary><ul class="company-filings">${offPage.map((f) => `<li><label><span><input name="additional" type="checkbox" value="${f.id}" checked> ${esc(f.form_type)} · ${esc(f.title)} · ${esc(f.report_date || f.filed_at || '—')}</span></label><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${de ? 'Original öffnen (neuer Tab)' : 'Open original (new tab)'}</a></li>`).join('')}</ul></details>`
        : '';
      const body = `<h1>${esc(c.name)}</h1><p class="muted">${c.market === 'US' ? `${de ? 'Vereinigte Staaten' : 'United States'} · ${esc(c.ticker)} · CIK ${esc(c.identity)}` : de ? 'Deutschland' : 'Germany'}</p><section><h2>${de ? 'Unternehmensüberblick' : 'Company assessment'}</h2>${assessment ? `<p>${esc(c.assessment.updated_at)}</p><p>${bilingual(assessment.overview, lang)}</p>${(assessment.concerns || []).map((x) => `<p>${bilingual(x.text, lang)}</p><p>${(x.reports || []).map((r) => `<a href="/reports/${esc(r)}?lang=${lang}">${esc(assessment.reportDates?.[r] || r)}</a>`).join(' · ')}</p>`).join('')}<details><summary>${de ? 'Historische Befunde — nicht automatisch erledigt' : 'Historical findings — not automatically resolved'}</summary>${(assessment.timeline || []).map((x) => `<p><a href="/reports/${esc(x.reportId)}?lang=${lang}">${esc(x.date)}: ${bilingual(x.title, lang)}</a></p>`).join('')}</details>` : `<p>${de ? 'Keine gespeicherte Bewertung verfügbar. Starten Sie einen Bericht manuell.' : 'No saved assessment available. Start a report manually.'}</p>`}<p>${de ? 'Bewertungen beziehen sich auf datierte Dokumente, nicht auf das gesamte Unternehmen.' : 'Assessments describe dated documents; they do not establish a company-wide score.'}</p></section>
      <section><h2>${de ? 'Gespeicherte Berichte' : 'Saved reports'}</h2>${c.reports.map((r) => `<p><a href="/reports/${r.id}?lang=${lang}">${esc(r.created_at)}</a> · ${stateText(r.status, lang)}${['queued', 'running'].includes(r.status) && r.stage !== r.status ? ` · ${stateText(r.stage, lang)}` : ''}</p>`).join('') || `<p>${de ? 'Noch keine Berichte.' : 'No reports yet.'}</p>`}<nav aria-label="${de ? 'Berichtsverlauf' : 'Report history'}">${reportOffset ? `<a data-keep-selection href="?${esc(new URLSearchParams({ lang, offset: String(offset), form, year, topic, reportOffset: String(Math.max(0, reportOffset - 20)) }))}">${de ? 'Neuere Berichte' : 'Newer reports'}</a> ` : ''}${reportOffset + 20 < c.reportTotal ? `<a data-keep-selection href="?${esc(new URLSearchParams({ lang, offset: String(offset), form, year, topic, reportOffset: String(reportOffset + 20) }))}">${de ? 'Ältere Berichte' : 'Older reports'}</a>` : ''}</nav></section>
      <section><h2>${de ? 'Alle bekannten Berichte' : 'All known filings'}</h2><form id="filters" class="controls"><label>${de ? 'Berichtsart' : 'Filing type'}<select id="form" name="form"><option value="">${de ? 'Alle Berichte' : 'Any filing'}</option><option value="annual">${de ? 'Jahresberichte' : 'Annual reports'}</option>${form && !['annual', 'quarterly', 'interim', 'other'].includes(form) ? `<option value="${esc(form)}">${esc(form)}</option>` : ''}${c.market === 'US' ? `<option value="quarterly">${de ? 'Quartalsberichte' : 'Quarterly reports'}</option>` : `<option value="interim">${de ? 'Zwischenberichte' : 'Interim reports'}</option><option value="other">${de ? 'Sonstige Veröffentlichungen' : 'Other publications'}</option>`}</select></label><label>${de ? 'Jahr' : 'Year'}<input id="year" name="year" inputmode="numeric" pattern="[0-9]{4}"></label><label>${de ? 'Thema (Metadaten)' : 'Topic (metadata)'}<select id="topic" name="topic"><option value="">${de ? 'Alle Themen' : 'All topics'}</option><option value="revenue">${de ? 'Umsatzrealisierung' : 'Revenue recognition'}</option><option value="estimates">${de ? 'Rückstellungen und Schätzungen' : 'Reserves and estimates'}</option><option value="depreciation">${de ? 'Abschreibungen und Nutzungsdauern' : 'Depreciation and useful lives'}</option><option value="non_gaap">${de ? 'Nicht-GAAP-Kennzahlen' : 'Non-GAAP measures'}</option></select></label><button>${de ? 'Filtern' : 'Filter'}</button></form><p>${c.total} ${de ? 'bekannte Dokumente' : 'known filings'}</p><ul class="company-filings">${c.filings.map((f) => `<li><label><span><input name="additional" type="checkbox" value="${f.id}"> ${esc(f.title)}</span></label><p class="filing-meta">${esc(f.form_type)} · ${esc(f.filed_at || '—')} · ${esc(f.report_date || '—')} · ${f.downloaded ? (de ? 'Heruntergeladen' : 'Downloaded') : f.analysis_status === 'complete' ? (de ? 'Gespeichertes Sentiment' : 'Legacy sentiment cached') : de ? 'Nur Metadaten' : 'Metadata only'} · ${stateText(f.analysis_status, lang)}</p><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${de ? 'Original öffnen (neuer Tab)' : 'Open original (new tab)'}</a>${f.downloaded ? ` · <a href="/documents/${f.id}?lang=${lang}">${de ? 'Dokument ansehen' : 'View document'}</a>` : ''}${f.job_id ? ` · <a href="/analysis/${f.job_id}?lang=${lang}">${de ? 'Sentiment' : 'Sentiment'}</a>` : ''}</li>`).join('')}</ul><nav>${offset ? `<a data-keep-selection href="?${esc(new URLSearchParams({ lang, offset: String(Math.max(0, offset - 20)), form, year, topic }))}">${de ? 'Zurück' : 'Previous'}</a> ` : ''}${offset + 20 < c.total ? `<a data-keep-selection href="?${esc(new URLSearchParams({ lang, offset: String(offset + 20), form, year, topic }))}">${de ? 'Weiter' : 'Next'}</a>` : ''}</nav></section>
      <section><h2>${de ? 'Bericht manuell starten' : 'Run report manually'}</h2>${context}<div class="controls"><label>${de ? 'Hauptdokument' : 'Primary filing'}<select id="primary"><option value="">${de ? 'Auswählen' : 'Choose filing'}</option>${opts(selection.primaryId)}</select></label><label>${de ? 'Vergleich bestätigen oder weglassen' : 'Confirm or omit prior filing'}<select id="prior"><option value="">${de ? 'Kein Vergleich' : 'No comparison'}</option>${opts(selection.priorId)}</select></label></div><p>${de ? 'Markierte Dokumente werden zusätzlich geprüft. Nur bekannte Dokumente desselben Unternehmens; bis zu einer Stunde Verarbeitung.' : 'Checked filings are additional context. Only known filings from this company; processing may take an hour.'}</p><div class="report-actions"><button id="run" class="primary-action">${de ? 'Auswahl bestätigen und Bericht starten' : 'Confirm selection and run report'}</button></div><p id="status" role="status"></p></section>`;
      const p = page(
        c.name,
        body,
        { lang, id: c.id, selection, filters: { form, year, topic } },
        companyScript,
      );
      return send(200, p.html, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': p.csp,
      });
    }
    const report = /^\/(api\/report-runs|reports)\/([a-f0-9-]{36})$/.exec(path);
    if (report) {
      const r =
        url.searchParams.get('status') === '1'
          ? catalog.reportStatus(report[2])
          : catalog.report(report[2]);
      if (!r) return send(404, 'Report not found.\n');
      if (report[1].startsWith('api'))
        return sendJson(200, {
          ...r,
          payload: r.payload ? JSON.parse(r.payload) : null,
        });
      const p = page(
        'Company report',
        `<p><a href="/companies/${r.company_id}?lang=${lang}">${de ? 'Zum Unternehmen' : 'Back to company'}</a></p>${reportBody(r, lang)}`,
        {
          lang,
          status: r.status,
          labels: Object.fromEntries(
            Object.entries(states).map(([key, labels]) => [
              key,
              labels[de ? 1 : 0],
            ]),
          ),
        },
        reportScript,
      );
      return send(200, p.html, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': p.csp,
      });
    }
    const document = /^\/documents\/([a-f0-9]{64})(\/source)?$/.exec(path);
    if (document) {
      const f = catalog.filing(document[1]),
        d = catalog.document(document[1]);
      if (!f || !d) return send(410, 'Document unavailable or pruned.\n');
      const root = options.analysisDataDir || '/analysis';
      const source = join(root, 'library', `${f.id}.source`);
      if (!existsSync(source))
        return send(410, 'Document unavailable or pruned.\n');
      if (document[2]) {
        if (d.kind === 'pdf')
          return send(200, readFileSync(source), {
            'content-type': 'application/pdf',
            'content-security-policy':
              "default-src 'none'; frame-ancestors 'self'",
          });
        let content = readFileSync(source, 'utf8');
        if (d.kind !== 'html') content = `<pre>${esc(content)}</pre>`;
        content = sanitize(content, {
          allowedTags: sanitize.defaults.allowedTags.concat(['html', 'body']),
          allowedAttributes: {
            '*': ['style'],
            td: ['colspan', 'rowspan', 'style'],
            th: ['colspan', 'rowspan', 'style'],
          },
          allowedStyles: {
            '*': {
              'text-align': [/^(?:left|right|center|justify)$/],
              'font-weight': [/^(?:bold|normal|[1-9]00)$/],
              'font-style': [/^(?:normal|italic)$/],
              'white-space': [/^(?:pre|pre-wrap|normal|nowrap)$/],
              'vertical-align': [/^(?:top|middle|bottom)$/],
              'border-collapse': [/^(?:collapse|separate)$/],
              width: [/^(?:auto|[0-9]{1,3}(?:\.[0-9]+)?(?:px|pt|em|%))$/],
              'font-size': [/^[0-9]{1,2}(?:\.[0-9]+)?(?:px|pt|em|%)$/],
              'font-family': [/^[a-zA-Z ,'-]+$/],
              padding: [/^[0-9 .pxtem%]+$/],
              margin: [/^[0-9 .pxtem%]+$/],
            },
          },
          nonTextTags: [
            'script',
            'style',
            'textarea',
            'option',
            'noscript',
            'iframe',
            'object',
            'svg',
            'math',
          ],
        });
        return send(
          200,
          `<!doctype html><meta charset="utf-8"><style>body{background:#fff;color:#000;font:16px/1.5 Arial}table{border-collapse:collapse}td,th{padding:4px}mark{background:#BFD8ED;color:#000}</style>${content}`,
          {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy':
              "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-same-origin",
          },
        );
      }
      const provenance = JSON.parse(d.provenance);
      let anchors = [];
      try {
        anchors = JSON.parse(
          readFileSync(join(root, 'library', `${f.id}.anchors.json`), 'utf8'),
        );
      } catch {}
      const rid = url.searchParams.get('report'),
        r = uuidPattern.test(rid || '') ? catalog.report(rid) : null,
        payload = r?.payload ? JSON.parse(r.payload) : null;
      const entries = [];
      for (const key of ['summary', 'changes', 'findings', 'risks'])
        for (const [i, item] of (payload?.[key] || []).entries())
          for (const e of item.evidence || [])
            if (e.filingId === f.id)
              entries.push({
                ...e,
                explanation:
                  (item.explanation || item.text)?.[lang] ||
                  (item.explanation || item.text)?.en ||
                  '',
                target:
                  key === 'findings'
                    ? `finding-${i}`
                    : key === 'risks'
                      ? 'financial-risk'
                      : 'what-changed',
              });
      for (const e of entries)
        e.evidenceKey = createHash('sha256')
          .update(JSON.stringify([e.target, e.quote]))
          .digest('hex')
          .slice(0, 16);
      const p = page(
        f.title,
        `<h1>${esc(f.title)}</h1><p><a href="/companies/${f.company_id}?lang=${lang}">${de ? 'Zum Unternehmen' : 'Company page'}</a> · <a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${de ? 'Original (neuer Tab)' : 'Original (new tab)'}</a></p><p>${stateText(provenance.retrieval, lang)}</p>${provenance.upload ? `<p>${de ? 'Vom Nutzer bereitgestellt; Zuordnung nicht unabhängig geprüft.' : 'User-supplied original; publication match not independently verified.'} ${esc(provenance.upload.filename)} · SHA-256: ${esc(provenance.upload.sha256)}</p>` : ''}${(
          provenance.documents || []
        )
          .filter((u) => typeof u === 'string' && u.startsWith('https://'))
          .map(
            (u) =>
              `<p><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${de ? 'Abgerufene Originalquelle (neuer Tab)' : 'Retrieved original source (new tab)'}</a></p>`,
          )
          .join(
            '',
          )}<div class="document-layout"><div id="viewer" role="region" aria-label="${de ? 'Dokument' : 'Document'}" tabindex="0"></div><aside><h2>${de ? 'Belege und Erläuterungen' : 'Evidence and explanations'}</h2><p id="status" role="status"></p>${entries.map((e, i) => `<article><button data-evidence="${i}">${esc(e.reference || e.anchor)}</button><blockquote>${esc(e.quote)}</blockquote><p>${esc(e.explanation)}</p>${r ? `<a href="/reports/${r.id}?lang=${lang}#${e.target}">${de ? 'Zum Befund' : 'Back to finding'}</a>` : ''}</article>`).join('')}</aside></div>`,
        { lang, kind: d.kind, id: f.id, anchors, entries },
        readFileSync(join(__dirname, '../public/viewer.js'), 'utf8'),
      );
      return send(200, p.html, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': p.csp,
      });
    }
    return send(404, 'Not found.\n');
  } catch (error) {
    return sendJson(error.status || 400, {
      error: error.code ? 'Stored content unavailable.' : error.message,
    });
  }
}
module.exports = { handleCompanyRequest, reportBody };
