# Architecture

The app searches recent U.S. company filings from SEC data and German publication results from the official Unternehmensregister. It also serves a feed of saved financial updates. Selected search results can be retrieved, text-extracted, and classified for financial sentiment by a separate local CPU worker. Full bias analysis remains unimplemented; sentiment is not a bias finding or score.

## Main parts

| File | Role |
| --- | --- |
| [src/server.js](https://github.com/423F26/project1/blob/main/src/server.js) | HTTPS requests, security checks, feed rendering, and JSON responses |
| [src/company-search.js](https://github.com/423F26/project1/blob/main/src/company-search.js) | SEC company lookup and submissions; official German registry search and result parsing |
| [src/rss.js](https://github.com/423F26/project1/blob/main/src/rss.js) | Eight fixed feeds, hourly collection, XML parsing, and SQLite storage |
| [src/analysis-store.js](https://github.com/423F26/project1/blob/main/src/analysis-store.js), [src/analysis_worker.py](https://github.com/423F26/project1/blob/main/src/analysis_worker.py) | Persistent selected-filing jobs, bounded document extraction, local English FinBERT inference, and local German-to-English translation |
| [public/index.html](https://github.com/423F26/project1/blob/main/public/index.html) | Layout, styles, language toggle, feed filters, and pagination |
| [src/dev.js](https://github.com/423F26/project1/blob/main/src/dev.js) | Local server and development certificates |
| [compose.yaml](https://github.com/423F26/project1/blob/main/compose.yaml) / [Dockerfile](https://github.com/423F26/project1/blob/main/Dockerfile) | Deployment, storage ownership, and container limits |
| [package.json](https://github.com/423F26/project1/blob/main/package.json) / [package-lock.json](https://github.com/423F26/project1/blob/main/package-lock.json) | Commands, project version, and locked dependencies |
| [test/](https://github.com/423F26/project1/tree/main/test) | Server, feed, and language checks |
| [_config.yml](https://github.com/423F26/project1/blob/main/_config.yml), [_layouts/default.html](https://github.com/423F26/project1/blob/main/_layouts/default.html), [assets/docs.css](https://github.com/423F26/project1/blob/main/assets/docs.css) | GitHub Pages documentation publishing, layout, and styles |

## Request flow

Deployment path: visitor → Cloudflare Access → Cloudflare Tunnel → `127.0.0.1:19283` → container → HTTPS server. See [Operations](OPERATIONS.md) for setup.

The server checks requests in this order:

1. Rate limit: excess requests return `429`.
2. Allowed hostname: an unknown host returns `421`.
3. Method: only `GET`, `POST /api/analysis-jobs`, and `POST /api/analysis-jobs/{jobId}/upload` are accepted; both POST routes validate the browser Origin when supplied and reject cross-site requests.
4. Route and input:
   - `/` without a query returns the first feed page as HTML.
   - `/api/filings` returns rendered feed HTML, items, counts, and pagination data as JSON. Invalid filters return `400`.
   - `/api/company-filings` validates the selected market, company query, filing type, year, and topic. U.S. searches return recent matching SEC filings; German searches filter up to 30 entries from the first page of official Unternehmensregister publications. Invalid input returns `400`; filing-source failures return `502`.
   - `POST /api/analysis-jobs` accepts 1–40 selected SEC or German registry references, validates publisher hosts and paths, and returns deduplicated persistent job IDs. Request bodies are limited to 16 KiB and cross-origin requests are rejected.
   - `POST /api/analysis-jobs/{jobId}/upload?filename=...&language=en|de` streams a raw document for an unavailable or failed German job. It creates a separate queued job and preserves the original. The request requires a declared size of 1 byte–25 MiB; chunked uploads, unsafe filenames, unsupported extensions, and invalid language choices are rejected.
   - `GET /analysis/{jobId}` displays a completed job’s stored result as text. `GET /api/analysis-jobs?ids=...` returns up to 40 statuses for polling. `GET /api/analysis-jobs/{jobId}` returns one status and, when complete, its sentiment result and passages.
   - Other paths, or a query on `/`, return `404`. Existing feed and company-search APIs reject request bodies.

The feed API accepts `source` (empty, `SEC`, `BaFin`, or `ECB`), inclusive `from`/`to` dates (`YYYY-MM-DD`), and separate `secOffset`/`otherOffset` cursors (integers from 0 to 1,000,000).

U.S. company lookup uses SEC's company ticker directory and public submissions data. Results are limited to five matching companies and eight recent matching filings per company. Both market modes share the same search layout. Filing type choices reflect the selected market: SEC form groups in the U.S. and annual/interim/other publication categories in Germany. Year and topic filters are applied to the available filing metadata. Topic matching checks filing titles and source descriptions only; it does not inspect statement text. German search fetches and parses up to 30 entries from the first page of official register publication results, then filters those entries by publication year, type, and topic. German results therefore do not search older result pages when a filter excludes entries from the first page. Search itself stores no German results and retrieves no filing contents; selected results can be queued for retrieval by the analysis worker. The register may require registration for some deposited financial statements.

Selecting **Analyze selected** queues those current search results only. The Node service stores job metadata in `analysis.sqlite`; the separate worker retrieves HTTPS documents on the fixed publisher hosts and verified issuer catalogs described below, follows redirects only on the same host, and limits each download and combined filing content to 25 MiB. For German publication pages, it first attempts the verified issuer match described below. Otherwise, it reads an embedded `publicationText` body from the viewer data when present, without executing scripts or analyzing page navigation. Otherwise, it follows up to five same-host links with document file extensions. When none exist, a publication URL with a single payload uses the register viewer's public `/api/pub-html` endpoint with that same payload; listing text is never used as filing content. HTML/XML/plain text and text-based PDF are attempted; encrypted, scanned, unsupported, login-gated, too-short, or otherwise unreadable documents finish as unavailable. The UI shows each unavailable or failed filing's stored error reason as plain text, alongside any completed result links. The app does not claim complete review coverage for unreadable documents. Retrieved originals and extracted passage results are stored in `/analysis`. The worker applies a 25 GiB logical artifact quota, pruning the oldest completed jobs first; active jobs are never pruned. Host filesystem quotas are separate and may be needed for a hard disk cap.

English passages use `ProsusAI/finbert` on CPU. Registry publications explicitly marked `language=en` by the publisher bypass translation, including translation-model loading, regardless of their German market or URL. Other German-market publications retain German-to-English translation using `Helsinki-NLP/opus-mt-de-en` before FinBERT classification; missing or ambiguous language metadata does not bypass translation. Original text and any translation/model revision are retained together. Jobs that bypass translation store null translation fields and null translation-model metadata, even if another job has already loaded the translator. Each passage result contains positive, negative, and neutral probabilities. The model's license is CC BY-NC-SA 4.0 and limits use to non-commercial purposes; include attribution and retain the license notice. The translation model lists Apache 2.0. Model weights are downloaded during worker image build and their resolved revisions are recorded with results; the container runs offline and filing text is never sent to a model provider. This pipeline reports sentiment only and does not calculate bias, risk, or investment advice.

## German document fallbacks

Automatic issuer matching initially covers **Siemens AG annual statements and consolidated annual reports** listed in its official English/German annual-report catalogs. The registry metadata must identify Siemens AG exactly, an unambiguous report type, an explicit fiscal period from October 1 to September 30, and the document language. Exemption notices, subsidiary filings, missing periods, unknown issuers, ambiguous results, and mismatched report types are never replaced with a parent-company report. Unsupported or failed issuer matches retain registry retrieval, followed by manual upload when unavailable.

The worker selects a unique matching PDF filename from the corresponding language catalog, validates the extracted issuer identity and year, and accepts only Siemens asset URLs under `assets.new.siemens.com/siemens/assets/api/uuid:` or its `assets.ctfassets.net/17si5cpawjzf/` tenant. The report URL is recorded in the result. Catalog changes that prevent a verified match fall back safely. Additional issuers need verified adapters; the worker does not search arbitrary websites or accept user-supplied download hosts.

Unavailable/failed German jobs expose **Upload downloaded original**. Users download the original through their browser, complete any CAPTCHA there, choose PDF/HTML/XML/TXT and its language, and confirm that it belongs to the selected publication. The server streams it to `/analysis/uploads/{newJobId}.upload` with a generated filename and restricted permissions, then transactionally creates a new job plus `analysis_uploads` metadata. Files are never served or executed. Uploaded documents use the existing extraction and inference limits and require no worker network access. English uploads skip translation based on the user's explicit language choice. Results mark uploads as user-supplied, preserve the original registry reference, and record the filename and SHA-256; they do not assert an independently verified match.

The 25 GiB logical storage limit counts queued uploads and concurrent upload reservations. The worker accounts for active input files when pruning completed artifacts; it removes staged inputs after success or failure, and clears uncommitted orphan files older than an hour at startup. The web server removes interrupted/invalid uploads. Upload bodies have a 120-second deadline; JSON job creation keeps its five-second body deadline and 16 KiB limit, while headers retain a five-second deadline. Uploads use the existing shared volume and need no new service or dependency.

## Feed and page behavior

Sources are the U.S. Securities and Exchange Commission (SEC), Germany's financial regulator (BaFin), and the European Central Bank (ECB). The collector reads three SEC, two BaFin, and three ECB feeds at startup and hourly. It skips overlapping refreshes. SQLite, a database stored in one file, holds metadata and excerpts; repeated source/item IDs update existing rows. Display queries remove duplicate links. Failed feeds leave saved data intact; history is never pruned automatically.

Each page has up to 20 display entries, including at most eight SEC company groups. Each group includes all its matching filings, so a page may contain more than 20 filing links. The latest filing is shown first; additional filings are collapsed. BaFin and ECB entries show a linked title, publisher, and available date. Filters and page changes read saved data only and replace the displayed results.

One inline script controls English/German labels and feed requests. It preserves entered values and selections, saves `pageLanguage` when browser storage permits, and leaves publisher text in its source language. Some generated labels remain English; see [Operations](OPERATIONS.md#using-the-page).

## Documentation website

GitHub Pages builds the existing Markdown files with Jekyll after pushes to `main`. One shared layout and stylesheet match the webapp's colors and typography. Navigation is generated from the rendered pages; internal Markdown links become website links. Agile records and app/runtime files are excluded and linked on GitHub. See [publishing details](OPERATIONS.md#documentation-website).

## Security boundary

- TLS 1.2+, certificate/key paths, and an exact hostname allowlist are required. Rate limits use the direct socket address and ignore forwarded IP headers; tunnel users may share one limit.
- There are no cookies or CORS access. Job creation accepts a bounded JSON body, and the upload route accepts a bounded streamed document; other APIs reject request bodies. Headers, request time, and connection reuse are limited; errors are plaintext.
- Feed fetches use fixed publisher URLs, a 10-second timeout, a 2 MiB limit, and HTTPS redirects restricted to the original host. Company search makes bounded requests to fixed SEC and Unternehmensregister endpoints with a 12-second timeout and an 8 MiB response limit. Unsafe XML is rejected. Displayed text is escaped and filing links require HTTPS.
- HTML uses a restrictive Content Security Policy (CSP): the single inline script is allowed by its SHA-256 hash, feed requests stay on the same origin, and forms/frames are blocked. HSTS requires future HTTPS visits; referrer headers are disabled.
- The web container runs as `node`, with all Linux capabilities dropped and a read-only filesystem except its RSS and analysis volumes and temporary storage. It retains its 0.25 CPU and 128 MiB memory limits. A separate unprivileged Python analysis worker has no published ports, a read-only root filesystem, a 256 MiB temporary filesystem, 64-process limit, 2 CPU and 4 GiB memory limits. Root initialization services only set named-volume ownership.

Follow the [Repository guide](../AGENTS.md) when changing these boundaries.
