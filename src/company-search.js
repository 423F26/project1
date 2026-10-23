'use strict';

const version = require('../package.json').version;
const SEC_USER_AGENT = `FinancialBiasDetector/${version} (charles.smith26@student.montana.edu)`;
const SEC_TICKERS = 'https://www.sec.gov/files/company_tickers.json';
const SEC_SUBMISSIONS = 'https://data.sec.gov/submissions/CIK';
const GERMAN_PORTAL = 'https://www.unternehmensregister.de';
const timeout = () => AbortSignal.timeout(12_000);
let tickerCache;
let tickerCacheExpires = 0;

class SearchError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

async function jsonResponse(fetcher, url, headers) {
  let response;
  try { response = await fetcher(url, { headers, signal: timeout() }); }
  catch { throw new SearchError('The filing source could not be reached. Please try again.'); }
  if (!response.ok) throw new SearchError(`The filing source returned HTTP ${response.status}. Please try again.`);
  if (!response.body) throw new SearchError('The filing source returned an empty response. Please try again.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) throw new SearchError('The filing source response was too large. Please try again.');
      chunks.push(value);
    }
  } finally { reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new SearchError('The filing source returned unreadable data. Please try again.'); }
}

function normalize(value) { return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim(); }

async function companyDirectory(fetcher) {
  const canCache = fetcher === fetch;
  if (canCache && tickerCache && Date.now() < tickerCacheExpires) return tickerCache;
  const data = await jsonResponse(fetcher, SEC_TICKERS, { 'user-agent': SEC_USER_AGENT, accept: 'application/json' });
  const entries = Object.values(data).filter((item) => item && Number.isInteger(Number(item.cik_str)) && item.title && item.ticker);
  if (canCache) { tickerCache = entries; tickerCacheExpires = Date.now() + 6 * 60 * 60 * 1000; }
  return entries;
}

function companyMatches(entries, query) {
  const term = normalize(query);
  const numeric = /^\d{1,10}$/.test(term);
  const cikQuery = numeric ? term.replace(/^0+(?=\d)/, '') : '';
  return entries.map((entry) => {
    const name = normalize(entry.title), ticker = normalize(entry.ticker), cik = String(entry.cik_str);
    const rank = numeric && cik.endsWith(cikQuery) ? (cik === cikQuery ? 0 : 1)
      : ticker === term ? 0 : name === term ? 1 : name.startsWith(term) ? 2 : (name.includes(term) || ticker.includes(term)) ? 3 : 99;
    return { entry, rank };
  }).filter((item) => item.rank < 99).sort((a, b) => a.rank - b.rank || a.entry.title.localeCompare(b.entry.title)).slice(0, 5).map(({ entry }) => entry);
}

const TOPIC_TERMS = {
  revenue: /revenue|sales|turnover|contract with customers|umsatzerl[eö]se|umsatz|erl[oö]se/i,
  estimates: /reserve|allowance|estimate|impairment|provision|r[uü]ckstell|sch[aä]tz|wertminderung/i,
  depreciation: /depreciation|amortization|useful life|asset lives|abschreibung|nutzungsdauer/i,
  non_gaap: /non.?gaap|non.?ifrs|adjusted|bereinigt/i
};

function topicMatches(topic, ...values) {
  return !topic || (TOPIC_TERMS[topic] && TOPIC_TERMS[topic].test(values.filter(Boolean).join(' ')));
}

function filingRows(company, submissions, formType, reportYear, topic = '') {
  const recent = submissions.filings?.recent;
  if (!recent) return [];
  const rows = [];
  for (let index = 0; index < (recent.form?.length ?? 0); index += 1) {
    const form = recent.form[index];
    if (formType === 'annual' && !['10-K', '20-F'].includes(form)) continue;
    if (formType === 'quarterly' && form !== '10-Q') continue;
    const filingDate = recent.filingDate[index] ?? '';
    const reportDate = recent.reportDate[index] ?? '';
    if (reportYear && (reportDate || filingDate).slice(0, 4) !== reportYear) continue;
    const description = recent.primaryDocDescription?.[index] ?? '';
    if (!topicMatches(topic, form, description)) continue;
    const accession = recent.accessionNumber[index];
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession ?? '')) continue;
    const cik = String(company.cik_str).padStart(10, '0');
    const primary = recent.primaryDocument[index] ?? '';
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/`;
    const document = /^[A-Za-z0-9._-]+$/.test(primary) && !primary.includes('..') ? primary : `${accession}-index.htm`;
    rows.push({
      form, filingDate, reportDate, accession,
      description,
      url: `${base}${document}`,
      indexUrl: `${base}${accession}-index.htm`
    });
    if (rows.length === 8) break;
  }
  return rows;
}

async function searchUs({ company, formType = 'any', year = '', topic = '', fetcher = fetch }) {
  const entries = await companyDirectory(fetcher);
  const matches = companyMatches(entries, company);
  if (!matches.length) return [];
  const results = await Promise.all(matches.map(async (entry) => {
    const cik = String(entry.cik_str).padStart(10, '0');
    const data = await jsonResponse(fetcher, `${SEC_SUBMISSIONS}${cik}.json`, { 'user-agent': SEC_USER_AGENT, accept: 'application/json' });
    return {
      name: data.name || entry.title,
      ticker: entry.ticker,
      cik,
      filings: filingRows(entry, data, formType, year, topic)
    };
  }));
  return results;
}

async function germanSearchUrl(company, fetcher = fetch) {
  const tokenResponse = await jsonResponse(fetcher, `${GERMAN_PORTAL}/api/search-token`, { 'user-agent': `FinancialBiasDetector/${version}`, accept: 'application/json' });
  if (typeof tokenResponse.token !== 'string' || !tokenResponse.token || !Number.isFinite(tokenResponse.expiresAt) || tokenResponse.expiresAt <= Date.now()) {
    throw new SearchError('The German registry could not start a search. Please try again.');
  }
  const params = new URLSearchParams({
    areas: 'publications',
    companySearchTerm: company,
    companyName: company,
    onlyPublications: 'true',
    searchToken: tokenResponse.token
  });
  return `${GERMAN_PORTAL}/de/suche?${params}`;
}

async function textResponse(fetcher, url, headers) {
  let response;
  try { response = await fetcher(url, { headers, signal: timeout() }); }
  catch { throw new SearchError('The German company register could not be reached. Please try again.'); }
  if (!response.ok) throw new SearchError(`The German company register returned HTTP ${response.status}. Please try again.`);
  if (!response.body) throw new SearchError('The German company register returned an empty response. Please try again.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) throw new SearchError('The German company register response was too large. Please try again.');
      chunks.push(value);
    }
  } finally { reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}

function decodeHtml(value) {
  const named = { amp: '&', apos: "'", copy: '©', euro: '€', gt: '>', ldquo: '“', lsquo: '‘', lt: '<', mdash: '—', ndash: '–', nbsp: ' ', quot: '"', rdquo: '”', reg: '®', sect: '§', szlig: 'ß', trade: '™', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === '#') {
      const hex = code[1]?.toLowerCase() === 'x';
      const point = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return named[code] ?? entity;
  });
}

function htmlText(value) {
  return decodeHtml(value.replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|span|li)>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function germanFilingRows(html) {
  const rows = [];
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const companyCell = /<t[dh]\b(?=[^>]*data-testid=["']company["'])[^>]*>([\s\S]*?)<\/t[dh]>/i.exec(row)?.[1];
    const informationCell = /<t[dh]\b(?=[^>]*data-testid=["']information["'])[^>]*>([\s\S]*?)<\/t[dh]>/i.exec(row)?.[1];
    const labelCell = /<t[dh]\b(?=[^>]*data-testid=["']label["'])[^>]*>([\s\S]*?)<\/t[dh]>/i.exec(row)?.[1];
    if (!companyCell || !informationCell || !labelCell) continue;
    const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(labelCell);
    const company = htmlText(companyCell), information = htmlText(informationCell), title = anchor && htmlText(anchor[2]);
    if (!company || !information || !title || !anchor) continue;
    let destination;
    try { destination = new URL(decodeHtml(anchor[1]), GERMAN_PORTAL); } catch { continue; }
    if (destination.origin !== GERMAN_PORTAL || !/^\/de\/(?:publication|deposits|registerPortalAdvice)(?:\/|$)/.test(destination.pathname)) continue;
    const rawDate = /<[^>]*data-cy=["']searchResult-date["'][^>]*>([\s\S]*?)<\//i.exec(labelCell)?.[1] ?? '';
    const dateText = htmlText(rawDate);
    const date = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(dateText);
    rows.push({ company, information, title, date: date ? `${date[3]}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}` : '', url: destination.href });
    if (rows.length === 30) break;
  }
  return rows;
}

function germanTypeMatches(filing, formType) {
  if (formType === 'any') return true;
  const text = normalize(`${filing.information} ${filing.title}`).replace(/[\u00ad\u2011]/g, '');
  const annual = /jahresabschluss|jahresfinanzbericht|annual report|annual financial|gesch[aä]ftsbericht|bilanz/i.test(text);
  const interim = /zwischenbericht|halbjahres|quartalsbericht|interim report|quarterly report/i.test(text);
  if (formType === 'annual') return annual || /rechnungslegung.{0,20}finanzberichte/i.test(text);
  if (formType === 'interim') return interim;
  return !annual && !interim;
}

async function searchGermany(company, { formType = 'any', year = '', topic = '', fetcher = fetch } = {}) {
  const url = await germanSearchUrl(company, fetcher);
  const resultsUrl = new URL(url);
  resultsUrl.searchParams.set('areas', 'publications');
  resultsUrl.searchParams.set('onlyPublications', 'true');
  const html = await textResponse(fetcher, resultsUrl.href, {
    'user-agent': `FinancialBiasDetector/${version}`,
    accept: 'text/html,application/xhtml+xml'
  });
  return germanFilingRows(html).filter((filing) =>
    germanTypeMatches(filing, formType) &&
    (!year || filing.date.startsWith(`${year}-`)) &&
    topicMatches(topic, filing.title, filing.information)
  );
}

function validateSearch(query, formType, year, topic = '', market = 'US') {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) throw new SearchError('Enter a company name, ticker, or identifier (2–100 characters).', 400);
  const validTypes = market === 'DE' ? ['any', 'annual', 'interim', 'other'] : ['any', 'annual', 'quarterly'];
  if (!validTypes.includes(formType)) throw new SearchError('Choose a valid filing type.', 400);
  if (!['', 'revenue', 'estimates', 'depreciation', 'non_gaap'].includes(topic)) throw new SearchError('Choose a valid topic.', 400);
  const currentYear = new Date().getUTCFullYear();
  if (year && (!/^\d{4}$/.test(year) || Number(year) < 1990 || Number(year) > currentYear + 1)) throw new SearchError('Choose a valid reporting year.', 400);
}

module.exports = { SearchError, searchUs, germanSearchUrl, searchGermany, germanFilingRows, validateSearch, topicMatches, germanTypeMatches };
