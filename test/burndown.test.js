'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { ValidationError, generate, loadAgile } = require('../scripts/generate-burndown');

function fixture({ product, sprint1, sprint2 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'burndown-'));
  const agile = join(root, 'docs', 'agile');
  mkdirSync(join(agile, 'sprint1'), { recursive: true });
  mkdirSync(join(agile, 'sprint2'), { recursive: true });
  writeFileSync(join(agile, 'PRODUCT_BACKLOG.md'), product ?? [
    '| Task | Sprint | Product work | Status | Maintainer |',
    '| --- | --- | --- | --- | --- |',
    '| #1 | S2 | Carryover | In Progress |  |',
    '| #2 | S2 | New work | Backlog |  |'
  ].join('\n'));
  const goals = (number) => `# Sprint ${number} goal\n\n- Start: 2026-09-${number === 1 ? '01' : '05'}\n- End: 2026-09-${number === 1 ? '04' : '08'}\n`;
  writeFileSync(join(agile, 'sprint1', 'GOAL.md'), goals(1));
  writeFileSync(join(agile, 'sprint2', 'GOAL.md'), goals(2));
  writeFileSync(join(agile, 'sprint1', 'BACKLOG.md'), sprint1 ?? [
    '| Task | Sprint | Product work | Status | Maintainer | Completed |',
    '| --- | --- | --- | --- | --- | --- |',
    '| #1 | S1 | Carryover | Done |  | 2026-09-03 |'
  ].join('\n'));
  writeFileSync(join(agile, 'sprint2', 'BACKLOG.md'), sprint2 ?? [
    '| Task | Sprint | Product work | Status | Maintainer | Completed |',
    '| --- | --- | --- | --- | --- | --- |',
    '| #1 | S2 | Carryover | In Progress |  |  |',
    '| #2 | S2 | New work | Backlog |  |  |'
  ].join('\n'));
  return root;
}

function withFixture(options, callback) {
  const root = fixture(options);
  try { callback(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('generates only completed-work sprints with advisor-facing labels and notes', () => withFixture({}, (root) => {
  const output = generate(root);
  const svg = readFileSync(output, 'utf8');
  assert.match(svg, /Sprint 1/);
  assert.doesNotMatch(svg, /Sprint 2/);
  assert.match(svg, /#1/);
  assert.match(svg, /Remaining tasks/);
  assert.match(svg, /Time period:/);
  assert.doesNotMatch(svg, /Advisor notes|Remaining work =|Scope:/);
  assert.match(svg, /Flat periods:/);
  assert.match(svg, /#1 · 2026-09-03/);
  assert.match(svg, /polyline/);
}));

test('keeps an empty sprint out of the chart', () => withFixture({
  product: ['| Task | Sprint | Product work | Status | Maintainer |', '| --- | --- | --- | --- | --- |', '| #1 | S1 | Done work | Done |  |'].join('\n'),
  sprint1: ['| Task | Sprint | Product work | Status | Maintainer | Completed |', '| --- | --- | --- | --- | --- | --- |', '| #1 | S1 | Done work | Done |  | 2026-09-03 |'].join('\n'),
  sprint2: ''
}, (root) => {
  const svg = readFileSync(generate(root), 'utf8');
  assert.doesNotMatch(svg, /Sprint 2/);
}));

test('rejects malformed completion dates', () => withFixture({ sprint2: [
  '| Task | Sprint | Product work | Status | Maintainer | Completed |',
  '| --- | --- | --- | --- | --- | --- |',
  '| #1 | S2 | Carryover | In Progress |  | 2026-99-99 |',
  '| #2 | S2 | New work | Backlog |  |  |'
].join('\n') }, (root) => {
  assert.throws(() => loadAgile(join(root, 'docs', 'agile')), ValidationError);
}));

test('rejects completion dates outside their sprint', () => withFixture({ sprint2: [
  '| Task | Sprint | Product work | Status | Maintainer | Completed |',
  '| --- | --- | --- | --- | --- | --- |',
  '| #1 | S2 | Carryover | In Progress |  | 2026-09-09 |',
  '| #2 | S2 | New work | Backlog |  |  |'
].join('\n') }, (root) => {
  assert.throws(() => loadAgile(join(root, 'docs', 'agile')), /completion falls outside the sprint/);
}));

test('rejects unknown, duplicate, and missing assigned tasks', () => {
  withFixture({ sprint2: [
    '| Task | Sprint | Product work | Status | Maintainer | Completed |',
    '| --- | --- | --- | --- | --- | --- |',
    '| #1 | S2 | Carryover | In Progress |  |  |',
    '| #9 | S2 | Unknown | Backlog |  |  |'
  ].join('\n') }, (root) => assert.throws(() => loadAgile(join(root, 'docs', 'agile')), /unknown task #9/));
  withFixture({ sprint2: [
    '| Task | Sprint | Product work | Status | Maintainer | Completed |',
    '| --- | --- | --- | --- | --- | --- |',
    '| #1 | S2 | Carryover | In Progress |  |  |',
    '| #1 | S2 | Carryover | In Progress |  |  |',
    '| #2 | S2 | New work | Backlog |  |  |'
  ].join('\n') }, (root) => assert.throws(() => loadAgile(join(root, 'docs', 'agile')), /duplicate task #1/));
  withFixture({ sprint2: [
    '| Task | Sprint | Product work | Status | Maintainer | Completed |',
    '| --- | --- | --- | --- | --- | --- |',
    '| #1 | S2 | Carryover | In Progress |  |  |'
  ].join('\n') }, (root) => assert.throws(() => loadAgile(join(root, 'docs', 'agile')), /#2: missing product-assigned sprint entry/));
});

test('rejects invalid added dates and completion before addition', () => {
  withFixture({ sprint2: [
    '| Task | Sprint | Product work | Status | Maintainer | Added | Completed |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| #1 | S2 | Carryover | In Progress |  | 2026-09-99 |  |',
    '| #2 | S2 | New work | Backlog |  |  |  |'
  ].join('\n') }, (root) => assert.throws(() => loadAgile(join(root, 'docs', 'agile')), /added: invalid date/));
  withFixture({ sprint2: [
    '| Task | Sprint | Product work | Status | Maintainer | Added | Completed |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| #1 | S2 | Carryover | In Progress |  | 2026-09-07 | 2026-09-06 |',
    '| #2 | S2 | New work | Backlog |  |  |  |'
  ].join('\n') }, (root) => assert.throws(() => loadAgile(join(root, 'docs', 'agile')), /completion precedes its added date/));
});
