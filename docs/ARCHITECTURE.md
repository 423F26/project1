# Architecture

Follow the [Repository guide](../AGENTS.md), [Design](agents/DESIGN.md), and [Ponytail](agents/PONYTAIL.md).

## Services and ownership

Visitor → Cloudflare Access → Cloudflare Tunnel → `127.0.0.1:19283` → Node HTTPS service. The web container retains its 0.25 CPU / 128 MiB limit. One separate Python scheduler serializes sentiment and report subprocesses within **4 CPU / 8 GiB**, without published worker ports. Each subprocess releases its models before another job starts. German sentiment translation finishes and unloads before FinBERT classification. Report inference uses a temporary loopback-only llama.cpp server and never calls a hosted model.

- `src/server.js`: host/method/body checks, existing feed/search/sentiment APIs, HTML rendering.
- `src/rss.js`: eight fixed feeds collected at startup and hourly; saved history survives source failures.
- `src/company-store.js`: durable company identity, filing metadata, cached comparison proposals, manual report creation.
- `src/company-pages.js`: company/report pages, bounded JSON endpoints, isolated document delivery.
- `src/analysis-store.js` and `src/analysis-schema.sql`: shared SQLite schema and legacy jobs.
- `src/worker_scheduler.py`: one queue owner; subprocess deadlines and recovery.
- `src/analysis_worker.py`: bounded publisher retrieval, uploads, translation, sentiment.
- `src/report_worker.py`: local reports, exact quotation validation, coverage, assessment synthesis, shared quota pruning.
- `public/index.html`, `public/company.js`, `public/company.css`, and `public/viewer.js`: bilingual controls, page styling, and PDF/HTML evidence navigation. Company styles/scripts are inlined; styling makes no new requests.

## Company identity and cached history

SEC companies use padded CIKs. Feed grouping uses CIK when the filing URL supplies it; unidentified source entries do not create guessed companies. German companies use the exact NFC-normalized registry company description; there is no fuzzy entity matching. Different registry descriptions remain separate until the publisher provides a stronger identity contract.

The analysis database retains companies, filing metadata, report runs, assessments, and downloaded-document metadata. SEC filings deduplicate by CIK/accession; German filings deduplicate by validated registry URL. The RSS database remains independently persistent. Saved SEC feed entries are imported into the catalog at web startup and on collection. Searches retain their returned metadata without downloading documents or starting models. A unique search company opens its history page; ambiguous searches present company links. Source failures can return matching saved companies.

Existing U.S. sentiment jobs are imported using CIK. German legacy jobs lack company identity and are attached only when a later saved search has the exact publication URL. No identity is inferred from a report title. Existing job URLs and stored JSON remain supported. Job links are derived from current jobs when reading a company page; catalog backfills only add missing records. Metadata retention is distinct from artifact retention.

## Request contracts

Existing APIs remain available except that home-feed date overrides now return `400`:

| Route | Contract |
| --- | --- |
| `GET /` | First page of today's feed |
| `GET /api/filings?source=&secOffset=&otherOffset=` | Today's saved feed page; publisher filter and bounded cursors |
| `GET /api/company-filings?market=&company=&formType=&year=&topic=` | Existing bounded publisher search plus retained company choices |
| `POST /api/analysis-jobs`, `GET /api/analysis-jobs?ids=...`, `GET /api/analysis-jobs/{id}` | Existing selected-filing sentiment jobs |
| `POST /api/analysis-jobs/{id}/upload` | Existing bounded German original upload |
| `GET /analysis/{id}` | Existing sentiment details, explicitly separate from bias |
| `GET /companies/{companyId}` | Company assessment, report history, all known filings, manual controls |
| `GET /api/companies/{companyId}` | Same saved company data as JSON |
| `GET /api/company-filings/{filingId}/prior` | Earlier cached filing with the same form and a known earlier reporting period; no retrieval |
| `POST /api/report-runs` | `{companyId, primaryId, priorId?, additionalIds?}`; 1–40 cached filings from one company; returns `202 {id,status}` |
| `GET /reports/{id}`, `GET /api/report-runs/{id}` | Saved report/progress, in HTML or JSON; `?status=1` returns only bounded progress metadata |
| `GET /documents/{filingId}?report={id}&anchor={anchor}` | Original-layout document viewer and linked explanations |
| `GET /documents/{filingId}/source` | Stored PDF or sanitized HTML/escaped text; never a caller-supplied path |
| `GET /viewer-assets/pdf.mjs`, `GET /viewer-assets/pdf.worker.mjs` | Two fixed self-hosted PDF.js assets |

Company-page selection state contains only same-company filing IDs, resolved and labeled from the saved catalog. Selections from other pages remain visible and removable beside the report controls. Filter values remain in their query parameters; stale state cannot override them. Comparison suggestions cannot overwrite a newer primary or manual comparison choice.

Company listing filters are `form` (existing form groups or an exact source form), `year`, `topic` (existing metadata topic choices), `offset` (20 filings/page), and `reportOffset` (20 reports/page). `lang=en|de` selects saved explanation language. Form/year/topic filtering never changes the home feed's date boundary.

The home feed always compares **publication timestamps** against the current **America/Denver** calendar day, including daylight saving changes. Unknown dates are excluded. Filtering precedes grouping, counts, and pagination, so a company's collapsed filings cannot include older dates. History is not deleted. Display dates/times use Mountain time too.

## Reports and evidence

Report creation is manual. The user confirms a primary filing, optional proposed cached prior filing, and optional additional context filings. Prior candidates must have the same form, a known earlier reporting period, and an earlier filing date. German metadata receives a comparison period only when an explicit supported date is present. Missing comparable metadata yields no proposal. SEC index pages must identify a unique matching primary document before retrieval.

Reports follow [BIAS.md](BIAS.md): what changed, bias review, financial risk profile. Bounded section reviews produce bilingual entries with exact original-source quotes. Reconciliation checks relevant other sections for explanations; comparison checks use both selected periods. The worker rejects unknown anchors, nonmatching quotations, invalid categories/ratings, missing languages/units/periods, unsupported figures, and invalid numeric changes. Calculated changes bind before/after values to the selected prior/current filings and use decimal arithmetic. Amounts must retain their adjacent source units and cited periods. Partial numbers, lost signs/scales, and ambiguous number separators are rejected; ambiguous formatted amounts remain quoted without a calculated delta. Numerical changes and the documented score formula are implemented in code, independently of generated prose. Sentiment is never substituted for bias.

The worker checkpoints validated entries, with a 4 MiB report-output ceiling and a 1 MiB assessment ceiling. Before reconciliation, candidate findings remain potential concerns. Progress polling reads metadata only, without reloading growing report payloads. Unavailable sources, invalid output, timeouts, and missing model installation produce explicit partial/unavailable states. The deadline is one hour of active processing including retrieval and company synthesis; queue waiting is separate. Restart recovery requeues interrupted work. Company synthesis processes saved reports incrementally, cites contributing report IDs and dates, groups concerns, and must not treat later silence as resolution. It has no company score.

**Current coverage ceiling:** table interpretation and complete-document review have not been validated. Reports therefore remain partial and the numeric score stays withheld. The calculation function requires complete coverage and calibration approval; neither is inferred from successful extraction or a zero-finding response. Team-reviewed English and German calibration and hardware measurements are release work, not established capabilities.

## Viewer and artifact lifecycle

PDF.js renders the stored original PDF, with page anchors, clickable passage overlays, and native disclosures containing readable extracted text for each page. HTML uses a maintained sanitizer and a sandboxed, script-free source response; safe table structure and inline formatting survive. Source scripts, network requests, forms, frames, and unsafe styling are removed. XML/TXT use escaped text. Quotes can span HTML text nodes. Missing exact positions are explicitly disclosed. Viewer scripts and workers are served locally; the main page retains its single hashed inline script.

Originals and anchor files live under `/analysis/library`; legacy originals/results remain under `/analysis/documents`, with uploads staged under `/analysis/uploads`. Upload provenance retains user-supplied status, filename, language, and SHA-256. Legacy German bundles preserve their actual linked original for viewing; ambiguous multi-document bundles are unavailable rather than mapped to invented anchors.

The shared 25 GiB logical cap counts legacy jobs, library artifacts, report payloads, assessments, and upload reservations. Publication reserves space under a SQLite write transaction. Old terminal report payloads and unprotected originals may be pruned; active/queued report inputs and active sentiment work are protected. Pruned reports have an explicit unavailable state, removed documents return `410`, and associated assessments are invalidated. Company/filing metadata remains. A host filesystem quota is still needed for a physical disk cap.

## Security and publishing

TLS 1.2+, exact host allowlists, direct-socket rate limits, bounded headers, same-origin POST checks, JSON size limits, upload limits, fixed retrieval hosts, and read-only unprivileged containers remain in place. Report creation accepts at most 16 KiB; uploads retain the 25 MiB/120-second limit. Filing contents are untrusted model input and have no tools or external model access. The loopback inference endpoint is not exposed by Compose.

The home page retains its restrictive CSP. Company/report/viewer pages permit only self-hosted scripts, same-origin reads, the fixed PDF worker, and isolated same-origin document frames. Source HTML has `script-src 'none'`, `default-src 'none'`, and `sandbox allow-same-origin` without script permission. No source-provided executable content is admitted.

GitHub Pages continues to publish repository Markdown via Jekyll on pushes to `main`; runtime source and Agile records stay excluded. See [Operations](OPERATIONS.md) for deployment, model provenance, validation limits, and publishing.
