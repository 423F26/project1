'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { createServer } = require('../src/server');

const template = readFileSync(require.resolve('../public/index.html'), 'utf8');
const server = createServer({ tls: {}, allowedHosts: new Set(['localhost']), rateLimit: 10, html: template });
const request = new EventEmitter();
Object.assign(request, { method: 'GET', url: '/', headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } });
let html;
server.emit('request', request, {
  writeHead(status) { assert.equal(status, 200); },
  end(body) { html = body; }
});
const script = html.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);

function page(saved, storageUnavailable = false) {
  const elements = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)].map(match => {
    const attributes = new Map([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    return {
      attributes,
      dataset: Object.fromEntries([...attributes].filter(([name]) => name.startsWith('data-'))
        .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
      textContent: html.slice(match.index + match[0].length).split('<', 1)[0],
      getAttribute(name) { return attributes.get(name) ?? null; },
      setAttribute(name, value) { attributes.set(name, value); },
      addEventListener() {}
    };
  });
  const find = (name, value) => elements.find(element => element.getAttribute(name) === value);
  const querySelector = selector => selector.startsWith('#')
    ? find('id', selector.slice(1))
    : elements.find(element => (element.getAttribute('class') ?? '').split(' ').includes(selector.slice(1)));
  for (const element of elements) element.querySelector = querySelector;
  const toggle = find('id', 'language-toggle');
  toggle.addEventListener = (_event, listener) => { toggle.click = listener; };
  const document = {
    documentElement: { lang: 'en' },
    getElementById: id => find('id', id),
    querySelector,
    querySelectorAll: selector => elements.filter(element => element.getAttribute(selector.slice(1, -1)) !== null)
  };
  const savedValues = new Map(saved ? [['pageLanguage', saved]] : []);
  const storage = {
    getItem: key => savedValues.get(key) ?? null,
    setItem: (key, value) => savedValues.set(key, value)
  };
  const context = { document, localStorage: storage, fetch() { assert.fail('Changing language must not request feed data'); } };
  if (storageUnavailable) Object.defineProperty(context, 'localStorage', { get() { throw new Error('storage denied'); } });
  const company = find('id', 'us-company');
  company.value = 'BMW';
  const filingType = find('id', 'us-type');
  filingType.selectedIndex = 1;
  const source = find('name', 'source');
  source.value = 'ECB';
  const from = find('name', 'from');
  from.value = '2026-09-01';
  vm.runInNewContext(script, context);
  return { document, elements, find, toggle, savedValues, company, filingType, source, from };
}

test('switches both ways, including accessible text, without changing search state', () => {
  const view = page();
  assert.equal(view.document.documentElement.lang, 'en');
  assert.equal(view.find('id', 'language-flag').textContent, '🇩🇪');
  assert.equal(view.find('id', 'language-name').textContent, 'Deutsch');
  const originals = view.elements.filter(element => element.getAttribute('data-de') !== null)
    .map(element => [element, element.textContent]);
  const originalAttrs = view.elements.flatMap(element => ['aria-label', 'placeholder', 'alt']
    .filter(name => element.getAttribute(`data-de-${name}`) !== null)
    .map(name => [element, name, element.getAttribute(name)]));
  view.toggle.click();
  assert.equal(view.document.documentElement.lang, 'de');
  assert.equal(view.find('id', 'language-flag').textContent, '🇺🇸');
  assert.equal(view.find('id', 'language-flag').getAttribute('aria-hidden'), 'true');
  assert.equal(view.find('id', 'language-name').textContent, 'English');
  for (const [element] of originals) assert.equal(element.textContent, element.getAttribute('data-de'));
  for (const [element, name] of originalAttrs) assert.equal(element.getAttribute(name), element.getAttribute(`data-de-${name}`));
  assert.equal(view.toggle.getAttribute('aria-label'), 'Seite auf Englisch anzeigen');
  assert.equal(view.savedValues.get('pageLanguage'), 'de');
  assert.equal(view.company.value, 'BMW');
  assert.equal(view.filingType.selectedIndex, 1);
  assert.equal(view.source.value, 'ECB');
  assert.equal(view.from.value, '2026-09-01');
  assert.equal(view.find('aria-current', 'true').getAttribute('class'), 'market-option selected');
  assert.equal(view.find('class', 'feed-heading').textContent, 'Aktuelle Berichte');
  view.toggle.click();
  assert.equal(view.document.documentElement.lang, 'en');
  assert.equal(view.find('id', 'language-name').textContent, 'Deutsch');
  for (const [element, text] of originals) assert.equal(element.textContent, text);
  for (const [element, name, value] of originalAttrs) assert.equal(element.getAttribute(name), value);
  assert.equal(view.savedValues.get('pageLanguage'), 'en');
});

test('restores a saved language and falls back when storage is unavailable', () => {
  const restored = page('de');
  assert.equal(restored.document.documentElement.lang, 'de');
  assert.equal(restored.find('id', 'language-name').textContent, 'English');
  assert.equal(restored.find('class', 'search-heading').textContent, 'Unternehmensberichte finden');
  assert.equal(restored.find('class', 'feed-heading').textContent, 'Aktuelle Berichte');
  const noStorage = page(undefined, true);
  assert.equal(noStorage.document.documentElement.lang, 'en');
  noStorage.toggle.click();
  assert.equal(noStorage.document.documentElement.lang, 'de');
  noStorage.toggle.click();
  assert.equal(noStorage.document.documentElement.lang, 'en');
});
