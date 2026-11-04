'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

test('accessible PDF text preserves source characters without repeating overlapping review chunks', () => {
  const source = readFileSync(require.resolve('../public/viewer.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(
    source.slice(
      source.indexOf('function extractedPageText'),
      source.indexOf('async function focusEvidence'),
    ),
    context,
  );
  const text = 'Revenue was 120 million USD. Cash flow fell to 40 million USD.';
  const anchors = [
    { id: 'page-1-0', page: 1, text: text.slice(0, 35) },
    { id: 'page-1-25', page: 1, text: text.slice(25) },
    { id: 'page-2-0', page: 2, text: 'A different page.' },
  ];
  assert.equal(context.extractedPageText(anchors, 1), text);
  assert.equal(context.extractedPageText(anchors, 2), 'A different page.');
  assert.equal(context.extractedPageText(anchors, 3), '');
});
