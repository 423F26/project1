'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { searchUs, validateSearch } = require('../src/company-search');

const forms = ['10-K', '20-F', '40-F', '10-KT', '10-Q', '10-QT', '8-K', '6-K', '3', '4', '5', '13D', '13G', '13F-HR', 'S-1', 'F-1', '424B5', '485BPOS', 'N-CSR'];
const recent = { form: [], filingDate: [], reportDate: [], accessionNumber: [], primaryDocDescription: [], primaryDocument: [] };
forms.forEach((form, i) => {
  recent.form.push(form);
  recent.filingDate.push(`2026-01-${String(i + 1).padStart(2, '0')}`);
  recent.reportDate.push(`2025-12-${String(i + 1).padStart(2, '0')}`);
  recent.accessionNumber.push(`0000320193-26-${String(i + 1).padStart(6, '0')}`);
  recent.primaryDocDescription.push('');
  recent.primaryDocument.push('filing.htm');
});

async function search(formType) {
  let request = 0;
  return (await searchUs({ company: 'AAPL', formType, fetcher: async () => {
    request += 1;
    return request === 1
      ? new Response(JSON.stringify({ 0: { cik_str: 320193, title: 'Apple Inc.', ticker: 'AAPL' } }))
      : new Response(JSON.stringify({ name: 'Apple Inc.', filings: { recent } }));
  } }))[0].filings.map((filing) => filing.form);
}

test('SEC filing categories cover supported current, ownership, registration and other forms', async () => {
  assert.deepEqual(await search('annual'), ['10-K', '20-F', '40-F', '10-KT']);
  assert.deepEqual(await search('quarterly'), ['10-Q', '10-QT']);
  assert.deepEqual(await search('current'), ['8-K', '6-K']);
  assert.deepEqual(await search('ownership'), ['3', '4', '5', '13D', '13G', '13F-HR']);
  assert.deepEqual(await search('registration'), ['S-1', 'F-1', '424B5', '485BPOS']);
  assert.deepEqual(await search('other'), ['N-CSR']);
  for (const type of ['annual', 'interim', 'other']) assert.doesNotThrow(() => validateSearch('Siemens', type, '', 'DE'));
});
