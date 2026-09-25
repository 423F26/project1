'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = readFileSync(require.resolve('../public/index.html'), 'utf8');
const script = html.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);

function page(saved, storageUnavailable = false) {
  const elements = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)].map(match => {
    const attributes = new Map([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    return {
      attributes,
      textContent: html.slice(match.index + match[0].length).split('<', 1)[0],
      getAttribute(name) { return attributes.get(name) ?? null; },
      setAttribute(name, value) { attributes.set(name, value); }
    };
  });
  const find = (name, value) => elements.find(element => element.getAttribute(name) === value);
  const toggle = find('id', 'language-toggle');
  toggle.addEventListener = (_event, listener) => { toggle.click = listener; };
  const document = {
    documentElement: { lang: 'en' },
    getElementById: id => find('id', id),
    querySelectorAll: selector => elements.filter(element => element.getAttribute(selector.slice(1, -1)) !== null)
  };
  const savedValues = new Map(saved ? [['pageLanguage', saved]] : []);
  const storage = {
    getItem: key => savedValues.get(key) ?? null,
    setItem: (key, value) => savedValues.set(key, value)
  };
  const context = { document, localStorage: storage };
  if (storageUnavailable) Object.defineProperty(context, 'localStorage', { get() { throw new Error('storage denied'); } });
  const company = find('id', 'us-company');
  company.value = 'BMW';
  const filingType = find('id', 'us-type');
  filingType.selectedIndex = 1;
  const checkbox = {
    checked: true,
    getAttribute() { return null; }
  };
  elements.push(checkbox);
  vm.runInNewContext(script, context);
  return { document, elements, find, toggle, savedValues, company, filingType, checkbox };
}

test('switches both ways, including accessible text, without changing search state', () => {
  const view = page();
  assert.equal(view.document.documentElement.lang, 'en');
  assert.equal(view.toggle.textContent, 'Deutsch');
  const originals = view.elements.filter(element => element.getAttribute('data-de') !== null)
    .map(element => [element, element.textContent]);
  const originalAttrs = view.elements.flatMap(element => ['aria-label', 'placeholder', 'alt']
    .filter(name => element.getAttribute(`data-de-${name}`) !== null)
    .map(name => [element, name, element.getAttribute(name)]));
  view.toggle.click();
  assert.equal(view.document.documentElement.lang, 'de');
  assert.equal(view.toggle.textContent, 'English');
  for (const [element] of originals) assert.equal(element.textContent, element.getAttribute('data-de'));
  for (const [element, name] of originalAttrs) assert.equal(element.getAttribute(name), element.getAttribute(`data-de-${name}`));
  assert.equal(view.toggle.getAttribute('aria-label'), 'Seite auf Englisch anzeigen');
  assert.equal(view.savedValues.get('pageLanguage'), 'de');
  assert.equal(view.company.value, 'BMW');
  assert.equal(view.filingType.selectedIndex, 1);
  assert.equal(view.checkbox.checked, true);
  assert.equal(view.find('aria-current', 'true').getAttribute('class'), 'market-option selected');
  assert.equal(view.elements.find(element => element.textContent === 'Deutsche Bank: Bad news').textContent, 'Deutsche Bank: Bad news');
  view.toggle.click();
  assert.equal(view.document.documentElement.lang, 'en');
  assert.equal(view.toggle.textContent, 'Deutsch');
  for (const [element, text] of originals) assert.equal(element.textContent, text);
  for (const [element, name, value] of originalAttrs) assert.equal(element.getAttribute(name), value);
  assert.equal(view.savedValues.get('pageLanguage'), 'en');
});

test('restores a saved language and falls back when storage is unavailable', () => {
  const restored = page('de');
  assert.equal(restored.document.documentElement.lang, 'de');
  assert.equal(restored.toggle.textContent, 'English');
  assert.equal(restored.find('class', 'search-heading').textContent, 'Markt für Berichte auswählen');
  assert.equal(restored.find('id', 'rss-url').getAttribute('placeholder'), 'RSS-Feed-URL hinzufügen');
  const noStorage = page(undefined, true);
  assert.equal(noStorage.document.documentElement.lang, 'en');
  noStorage.toggle.click();
  assert.equal(noStorage.document.documentElement.lang, 'de');
  noStorage.toggle.click();
  assert.equal(noStorage.document.documentElement.lang, 'en');
});
