const primary = document.getElementById('primary');
const prior = document.getElementById('prior');
const status = document.getElementById('status');
const de = pageData.lang === 'de';

function collectSelection() {
  const additionalIds = new Set(pageData.selection.additionalIds);
  for (const input of document.querySelectorAll('[name=additional]')) {
    if (input.checked) additionalIds.add(input.value);
    else additionalIds.delete(input.value);
  }
  return {
    primaryId: primary.value,
    priorId: prior.value,
    additionalIds: [...additionalIds],
  };
}

for (const link of [
  document.getElementById('language'),
  ...document.querySelectorAll('[data-keep-selection]'),
]) {
  link.addEventListener('click', () => {
    const target = new URL(link.href, location.href);
    target.searchParams.set('state', JSON.stringify(collectSelection()));
    link.href = target.pathname + target.search;
  });
}

let suggestionRequest = 0;
primary.addEventListener('change', async () => {
  const request = ++suggestionRequest;
  const primaryId = primary.value;
  prior.value = '';
  status.textContent = '';
  if (!primaryId) return;
  try {
    const response = await fetch(`/api/company-filings/${primaryId}/prior`);
    if (!response.ok) throw new Error();
    const { prior: candidate } = await response.json();
    if (
      request !== suggestionRequest ||
      primary.value !== primaryId ||
      !candidate
    )
      return;
    if (![...prior.options].some((option) => option.value === candidate.id)) {
      const option = document.createElement('option');
      option.value = candidate.id;
      option.textContent = `${candidate.form_type} · ${candidate.title} · ${candidate.report_date}`;
      prior.append(option);
    }
    prior.value = candidate.id;
  } catch {
    if (request === suggestionRequest)
      status.textContent = de
        ? 'Vergleich nicht verfügbar.'
        : 'Comparison unavailable.';
  }
});
// A user-selected comparison takes precedence over a pending automatic proposal.
prior.addEventListener('change', () => {
  suggestionRequest += 1;
});

for (const name of ['form', 'year', 'topic'])
  document.getElementById(name).value = pageData.filters[name];
for (const input of document.querySelectorAll('[name=additional]'))
  input.checked = pageData.selection.additionalIds.includes(input.value);

document.getElementById('filters').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = new URLSearchParams(new FormData(event.target));
  query.set('lang', pageData.lang);
  query.set('state', JSON.stringify(collectSelection()));
  location.search = query.toString();
});

document.getElementById('run').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch('/api/report-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId: pageData.id, ...collectSelection() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    location.href = `/reports/${result.id}?lang=${pageData.lang}`;
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});
