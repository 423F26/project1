"use strict";
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const template = readFileSync(
  require.resolve("../public/index.html"),
  "utf8",
).replace(
  "<!-- FEED_ITEMS -->",
  '<p class="feed-status"></p><nav class="feed-pagination" data-total-pages="1"><button id="previous-page"></button><div class="page-numbers"></div><span class="page-ellipsis"></span><button id="next-page"></button></nav>',
);
function page(t, saved, denied = false) {
  const dom = new JSDOM(template, {
    url: "https://localhost/",
    runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.fetch = () => assert.fail("Language changes must not request data");
  if (saved) w.localStorage.setItem("pageLanguage", saved);
  if (denied)
    Object.defineProperty(w, "localStorage", {
      get() {
        throw Error("storage denied");
      },
    });
  w.document.getElementById("us-company").value = "BMW";
  w.document.getElementById("filing-type").value = "quarterly";
  w.document.querySelector("[name=source]").value = "ECB";
  w.eval(w.document.querySelector("script").textContent);
  return w;
}
test("switches both languages without requests or losing company, type, source or year selections", (t) => {
  const w = page(t),
    d = w.document;
  d.getElementById("reporting-year").value = "2025";
  const selector = d.getElementById("language-select");
  selector.value = "de";
  selector.dispatchEvent(new w.Event("change"));
  assert.equal(d.documentElement.lang, "de");
  assert.equal(selector.value, "de");
  assert.equal(
    d.querySelector(".feed-heading").textContent,
    "Aktuelle Berichte",
  );
  assert.equal(d.getElementById("us-company").value, "BMW");
  assert.equal(d.getElementById("filing-type").value, "quarterly");
  assert.equal(d.getElementById("reporting-year").value, "2025");
  assert.equal(d.querySelector("[name=source]").value, "ECB");
  selector.value = "en";
  selector.dispatchEvent(new w.Event("change"));
  d.querySelector('input[name="market"][value="DE"]').click();
  assert.equal(d.getElementById("company-label").textContent, "Company name or EUID");
  assert.equal(d.getElementById("year-label").textContent, "Reporting year");
  assert.equal(d.getElementById("company-search-submit").textContent, "Find filings");
  assert.equal(d.getElementById("us-company").placeholder, "e.g., Siemens AG");
  assert.equal(w.localStorage.getItem("pageLanguage"), "en");
  assert.equal(selector.getAttribute("aria-label"), "Language");
  selector.value = "en";
  selector.dispatchEvent(new w.Event("change"));
  assert.equal(d.getElementById("us-company").placeholder, "e.g., Siemens AG");
  selector.value = "de";
  selector.dispatchEvent(new w.Event("change"));
  assert.equal(d.getElementById("us-company").placeholder, "z. B. Siemens AG");
  d.querySelector('input[name="market"][value="US"]').click();
  d.getElementById("filing-type").value = "quarterly";
  selector.value = "en";
  selector.dispatchEvent(new w.Event("change"));
  assert.equal(d.documentElement.lang, "en");
  assert.equal(d.querySelector(".feed-heading").textContent, "Recent Filings");
  assert.equal(d.getElementById("filing-type").value, "quarterly");
  assert.equal(w.localStorage.getItem("pageLanguage"), "en");
  assert.equal(d.querySelector("[name=from]"), null);
});
test("restores saved language and supports storage denial", (t) => {
  const w = page(t, "de");
  assert.equal(w.document.documentElement.lang, "de");
  assert.equal(
    w.document.querySelector(".search-heading").textContent,
    "Unternehmensberichte finden",
  );
  const privatePage = page(t, null, true);
  privatePage.document.getElementById("language-select").value = "de";
  privatePage.document.getElementById("language-select").dispatchEvent(new privatePage.Event("change"));
  assert.equal(privatePage.document.documentElement.lang, "de");
  privatePage.document.getElementById("language-select").value = "en";
  privatePage.document.getElementById("language-select").dispatchEvent(new privatePage.Event("change"));
  assert.equal(privatePage.document.documentElement.lang, "en");
});
