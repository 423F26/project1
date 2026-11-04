# Operations

## Run locally

Install Node.js 22.13 or newer, npm, Python 3.13, and OpenSSL. From the repository directory:

```powershell
npm ci
npm run dev
```

Open `https://localhost:8443` and accept the local self-signed certificate warning. The server listens only on `127.0.0.1`, restarts when loaded JavaScript files change, and stops with Ctrl+C. Check the HTML response with `curl.exe -k https://localhost:8443/` on Windows.

Development needs no `.env`. It creates a one-year certificate in ignored `certs/dev/` and a database at `data/rss.sqlite`. With the server stopped, delete `certs/dev/` to replace an expired certificate, or delete `data/rss.sqlite` to erase local feed history. To change the port in PowerShell, run `$env:PORT = '8765'` before `npm run dev`.

Install Python worker dependencies with `python3 -m pip install -r requirements-worker.txt` (Windows: `python`). Run **one** scheduler in a second terminal:

```sh
python3 src/worker_scheduler.py
```

Do not run a separate sentiment worker beside the scheduler. For local report generation, set `REPORT_MODEL_PATH` to the pinned Q4_K_M GGUF and `LLAMA_SERVER` to the pinned llama.cpp server binary. The Docker worker build supplies both. A missing local model produces an explicit unavailable report; it never calls an API. Development sentiment checkpoints use ignored `data/models`; deployed checkpoints are baked into the worker image.

## Using the page

- **Recent Filings** always means the current **America/Denver** day, including daylight saving time. Publication dates are filtered before company grouping and pagination. Unknown publication dates are excluded. Source filtering and numbered pages remain; historical date overrides are rejected. Old records are retained.
- **Find company filings** searches SEC names/tickers/CIKs or the official German register. Searches retain their returned metadata, but never download documents or run models. One matched company opens its permanent company page; ambiguous matches provide company links. Matching saved companies remain searchable when a publisher is unavailable. Existing publisher bounds still apply: up to five SEC companies/eight recent filings each, or 30 first-page German results. The company page accumulates all locally discovered filings across searches and feeds; it is not a complete publisher archive.
- **Company pages** show the dated combined assessment, saved report history, and all known filings with pagination and type/year/metadata-topic filters. Metadata-only documents are distinguished from downloaded originals and legacy sentiment jobs. No assessment exists until a manual report succeeds far enough to generate one.
- **Run report manually**: select a primary filing. The app proposes a cached earlier filing only when form and reporting-period metadata support comparison. Confirm, replace, or omit it; select additional same-company filings as context if needed. The explicit confirmation starts a persistent background run, including retrieval. Missing comparison metadata never triggers a publisher history lookup. A run may take an hour; return to its saved progress page later.
- Reports display **What changed**, **Bias review**, then **Financial risk profile**, without tabs. Source quotes link to original-layout PDF pages or sanitized HTML with evidence highlights and explanations. XML/TXT use escaped text. Unsupported indicators show unavailable. Missing anchors and document/coverage limits are disclosed.
- Reports and the combined company assessment contain saved **English and German** explanations; source text stays in its original language. Language switching never starts inference and preserves report selections and filters. The home page saves `pageLanguage` when storage is available.
- Company assessments group dated findings across saved reports, link to contributing reports, and preserve conflicting/historical concerns. They have **no company-wide score**. Later silence does not resolve earlier findings.

The worker rejects mismatched source quotations and malformed outputs. Report output is capped at 4 MiB and company assessments at 1 MiB; exceeding a limit retains the previous validated checkpoint. It checkpoints validated entries and publishes partial results on errors or the one-hour deadline. **All current reports remain partial:** complete-document review and table interpretation have not been validated. Numeric bias scores are withheld pending team-approved English and German calibration examples. A successful extraction, empty finding list, or working queue does not prove neutrality or model quality. Existing `/analysis/{id}` and sentiment JSON endpoints remain available as sentiment, not bias reports.

The collector retains its eight fixed feeds, startup/hourly collection, and saved entries on source failure. Collection, visits, searches, and language switches never run analysis. There is no hosted-model integration or API fallback.

## German document fallbacks

Analysis first tries a verified matching issuer report, then the registry. Automatic issuer coverage currently supports Siemens AG annual statements/consolidated annual reports in verified catalogs, with matching legal entity, fiscal period, report type, and language. It does not substitute group reports for subsidiary filings or exemption notices. Other issuers and uncertain matches use registry retrieval or manual upload.

For a German filing marked unavailable or failed:

1. Open its linked register publication, complete any CAPTCHA yourself, and download the original document.
2. Expand **Upload downloaded original** beneath that filing's error.
3. Choose PDF, HTML, XML, or TXT (up to 25 MiB), explicitly select the document language, and confirm that the file belongs to this publication.
4. Choose **Upload and analyze**. A separate job runs through the existing worker; its results link appears in the same status area. The original job is preserved.

Uploads and inference remain local to the deployed app/worker. Uploaded English documents bypass translation. The result records the registry reference, user-supplied filename and SHA-256, or the actual issuer URL for automatic retrieval. All existing readability/word-count/model limits apply; uploads do not add OCR. Staged uploads count toward the 25 GiB quota and are removed after processing. Upload requests have a two-minute deadline; a full quota rejects new uploads. If upload fails, the chosen file/language are retained in the current page so it can be retried.

Rebuild both app and worker after deploying this change. The existing shared analysis volume and initialization service are reused; the new metadata table is created automatically without changing existing jobs.

## Deploy with Docker Compose

1. Install Docker with Compose. Copy `.env.example` to `.env` and set `ALLOWED_HOSTS=esof423.csit.help` for the documented public hostname. Use the actual hostname if deploying elsewhere; comma-separated hostnames are allowed, without schemes or ports.
2. Put the deployment certificate in `certs/tls.crt` and its matching private key in `certs/tls.key`. Use a Cloudflare Origin CA or publicly trusted certificate covering the public hostname.
3. Run:

   ```powershell
   docker compose up --build -d
   docker compose ps -a
   docker compose logs --tail=50 plaintext
   ```

4. Configure Cloudflare Access and a Tunnel to `https://127.0.0.1:19283`. Set `originServerName` and `httpHostHeader` to the certificate's public hostname. Keep TLS verification enabled; use `caPool` for a private certificate authority. See [Cloudflare's origin settings](https://developers.cloudflare.com/tunnel/reference/origin-parameters/).

Compose publishes only `127.0.0.1:19283`. Keep the origin private; Cloudflare Access cannot protect a separately reachable origin. Keep Rocket Loader from handling the inline script through its `data-cfasync="false"` attribute; do not weaken CSP to admit injected scripts.

The one-time `rss-data-init` and `analysis-data-init` services run as root only to set ownership of their named volumes, then exit. The app runs unprivileged with all capabilities dropped. Its limits remain 0.25 CPU, 128 MiB RAM, 32 processes, read-only root filesystem, writable `/data` and `/analysis`, and an 8 MiB restricted `/tmp`. The separate `analysis-worker` has no published ports, a read-only root filesystem, writable `/analysis`, a 256 MiB restricted `/tmp`, 64-process limit, 4 CPU, 8 GiB RAM, and restart policy `unless-stopped`.

Unexpected job failures show the processing stage and exception type in the UI; the full traceback is written to the worker log. Run `docker compose logs --tail=100 analysis-worker` from the directory containing `compose.yaml`. From another directory, find the container with `docker ps --filter label=com.docker.compose.service=analysis-worker --format '{{.Names}}'`, then run `docker logs --tail=100 <container-name>`. After deploying a worker update, retry the failed filing to capture a fresh error.

The worker image downloads ProsusAI FinBERT and Helsinki-NLP German-to-English translation weights during build and records their resolved revisions. It also builds the pinned llama.cpp runtime and converts the pinned Qwen3-4B-Instruct-2507 checkpoint to Q4_K_M GGUF, retaining a SHA-256 manifest. Build disk usage is substantially larger than the quantized runtime model; reserve room for the original checkpoint and intermediate conversion. Build requires access to Hugging Face; the running worker is configured offline and sends no filing text externally. FinBERT's CC BY-NC-SA 4.0 license restricts its use to non-commercial purposes; preserve attribution and license terms from [Model notices](MODEL-NOTICES.md), also copied into the worker image. The translation model's published license is Apache 2.0.

`analysis_data` stores the company catalog, jobs, reports, assessments, original documents, anchors, and legacy passage results. The 25 GiB logical cap includes all of these artifacts plus staged uploads. Terminal report payloads and unprotected old originals can be pruned; queued/active report inputs and active jobs are protected. Catalog metadata survives pruning. Removed report payloads show unavailable; removed document views return `410`. Assessments referring to a pruned report are invalidated. A named Docker volume has no portable hard-size limit in this Compose file, so configure a host filesystem/volume quota if a physical cap is required. `docker compose down -v` removes both `rss_data` and `analysis_data`.

Outbound HTTPS to the fixed feeds, SEC data endpoints, and Unternehmensregister is required. SEC requests include `charles.smith26@student.montana.edu` in the User-Agent. Feed history stays in `rss_data` across rebuilds and `docker compose down`; `docker compose down -v` erases it. There is no automatic pruning.

## Documentation website

[Read the documentation](https://423f26.github.io/project1/) on GitHub Pages. GitHub builds it from `main` and the repository root using Jekyll. Every push to `main` triggers publishing; changes appear after the build and deployment finish, usually within a few minutes, rather than instantly. Uncommitted changes and other branches do not update the site.

Edit the existing Markdown files; do not maintain separate website copies. README is the landing page and first navigation link. Sidebar labels and browser titles use filenames without extensions; document headings stay unchanged. Files are grouped by repository folder, with all folders expanded. The desktop sidebar stays visible while scrolling; on narrow screens, a sticky Menu button opens it. Agile records remain on GitHub. Source-code links also open GitHub because application files are excluded from the site.

The layout lives in `_layouts/default.html`, folder navigation in `_includes/docs-tree.html`, styles in `assets/docs.css`, and publishing configuration in `_config.yml`. The header reads “Project #1 Documentation”; the repository link is in the bottom-right footer. In repository **Settings → Pages**, keep **Deploy from a branch**, **main**, and **/(root)** selected, with no custom domain. Check the **pages build and deployment** run in **Actions** if an update fails. The documentation site is English; the webapp's language toggle is separate.

## Configuration

`.env` supplies Compose substitutions; the app does not load it directly. Compose sets `ALLOWED_HOSTS`, the two TLS paths, and a fixed `ANALYSIS_DATA_DIR` for the shared analysis volume.

| Process setting | Direct start (`npm start`) | Development (`npm run dev`) |
| --- | --- | --- |
| `ALLOWED_HOSTS` | Required exact hostname list | Fixed: `localhost`, `127.0.0.1` |
| `TLS_KEY_PATH`, `TLS_CERT_PATH` | Required readable files | Generated in `certs/dev/` |
| `PORT` | Default 8443; Docker image sets 19283 | Default 8443 |
| `RATE_LIMIT` | Default 10 requests/minute per socket source address | Fixed at 10 |
| `RSS_DB_PATH` | Default `/data/rss.sqlite`; parent directory must exist | Fixed at `data/rss.sqlite` |

For Docker overrides, edit the service's `environment` in [compose.yaml](https://github.com/423F26/project1/blob/main/compose.yaml); a port change must also update both sides of its port mapping. The direct server binds to `0.0.0.0`; development binds to loopback. Forwarded IP headers are ignored, so tunnel users may share a rate limit. See [Architecture](ARCHITECTURE.md) for request checks.

Never commit `.env`, certificates, private keys, or runtime data.

## Checks and releases

Run `npm test` and `git diff --check`; the test command selects `python3` on POSIX and `python` on Windows. Run `docker compose config` after Compose changes. UI checks cover English/German, retained inputs, keyboard focus, 320px reflow, empty/populated feeds, cached comparison proposals, and PDF/HTML evidence navigation.

### Local model acceptance and benchmarks

Software tests use controlled source/model fixtures. They do not establish financial-review accuracy. Before enabling scores, humans must approve reviewed English and German examples covering the documented score cases, misleading claims explained elsewhere, non-bias sentiment, contradictory periods, unsupported claims, risk indicators, incomplete tables/pages, and adversarial instructions. Check both saved explanation languages against original evidence. Keep scores withheld until that review and complete-coverage validation are approved; do not enable scores through an unreviewed environment flag.

To measure a representative cached English pair and German pair on the target machine:

1. Build the worker and collect/cache each filing's metadata using normal search. Obtain filing IDs from the company JSON endpoint.
2. Finish pending runs and stop the scheduler: `docker compose stop analysis-worker`.
3. Run each pair separately in the existing constrained service:

   ```sh
   docker compose run --rm analysis-worker python src/benchmark_reports.py --primary PRIMARY_ID --prior PRIOR_ID --output /analysis/benchmark-en.json
   docker compose run --rm analysis-worker python src/benchmark_reports.py --primary PRIMARY_ID --prior PRIOR_ID --output /analysis/benchmark-de.json
   ```

4. Inspect elapsed time, child peak memory, coverage/rejections, status, stored evidence, and both languages. Target: at most 3600 seconds of active processing within 8 GiB / 4 CPU. Queue waiting is excluded. A partial report alone is not a quality pass.
5. Resume with `docker compose up -d analysis-worker`.

Implementation-environment validation on November 4, 2026: automated Node/Python checks passed. `docker compose config` could not run because Docker is not installed. Real English/German model benchmarks and image execution were not run: the environment has neither the worker image nor model weights. **Memory, throughput, model quality, and image build remain unverified.** Do not read fixture tests as completion of these deployment checks.

The project version remains **0.2.1** pending release. Keep package manifests and collector User-Agent synchronized when releasing. Human maintainers own the [Agile records](https://github.com/423F26/project1/tree/main/docs/agile); agents leave them untouched.
