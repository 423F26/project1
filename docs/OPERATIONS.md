# Operations

## Run locally

Install Node.js 22.13 or newer, npm, Python 3.13, and OpenSSL. From the repository directory:

```powershell
npm ci
npm run dev
```

Open `https://localhost:8443` and accept the local self-signed certificate warning. The server listens only on `127.0.0.1`, restarts when loaded JavaScript files change, and stops with Ctrl+C. Check the HTML response with `curl.exe -k https://localhost:8443/` on Windows.

Development needs no `.env`. It creates a one-year certificate in ignored `certs/dev/` and a database at `data/rss.sqlite`. With the server stopped, delete `certs/dev/` to replace an expired certificate, or delete `data/rss.sqlite` to erase local feed history. To change the port in PowerShell, run `$env:PORT = '8765'` before `npm run dev`.

Install the local worker dependencies with `python -m pip install -r requirements-worker.txt`. In a second terminal, run `python src/analysis_worker.py`; its first start downloads the two public model checkpoints into ignored `data/models/`. It stores filing artifacts in ignored `data/analysis/`. It sends no filing text to external services. Stop the worker with Ctrl+C.

## Using the page

- **Find company filings** uses the same control layout in both markets. United States searches the SEC by company name, ticker, or CIK; Germany searches by company name or EUID. Filing type choices change to match each market, while year and topic controls stay in the same position. The U.S. year filter uses the report period when available; the German year filter uses publication date. German search filters up to 30 entries from the first page of official Unternehmensregister results, so older matching items may not appear if they are on later pages. Topic filters match filing titles and source descriptions only; they do not inspect the full statements. German result titles open original registry pages in a new tab; some deposited financial statements require registration. Expand a company group to select individual filings or **Select all** for that company. Expanding a company enables **Analyze selected** beneath its filings; collapsing it clears that company's selections. The button queues selected filings and reports job progress in the existing status area. The Recent Filings feed remains visible until a company search is submitted; use its button to return to the feed.
- **Recent Filings** works. Expand the source/date filters, apply or clear them, and use numbered pages or previous/next controls. Dates include both endpoints and use the publication date, falling back to the collection date. Pages contain up to 20 entries, including at most eight SEC company groups; expand a group to see its other matching filings. Links open the original sources in new tabs.
- **Deutsch / English** changes marked page labels and preserves inputs. English is the default; `pageLanguage=de` in browser storage restores German. If storage is blocked, the choice lasts for that visit. Publisher text stays in its source language. Generated SEC form labels, expansion text, new-tab descriptions, stored analysis error reasons, and some pagination labels remain English. Empty messages loaded after filtering/paging are not reapplied to the selected language.

The backend collects eight feeds at startup and hourly, independently of visits. Failed sources keep saved entries. An empty database or unmatched filter shows an empty message. Hourly polling can miss entries removed by publishers between checks. **Analyze selected** queues current SEC or German search results; status and individual failure reasons appear in the existing analysis status area. Completed jobs link to a plain-text details page containing the stored result. Full results are also available from `GET /api/analysis-jobs/{jobId}`. For German results, the worker retrieves linked same-host documents (up to five), or uses the register viewer’s public content endpoint with the selected publication’s payload when there are no document links. If it cannot retrieve or fully extract the publication, the result is unavailable rather than analyzing the registry listing. After updating the worker, select the unavailable filing and choose **Analyze selected** again to retry it. Inaccessible, login-gated, unsupported, scanned, or unreadable documents also receive an unavailable status. English text is classified by local FinBERT; German text is translated locally before classification. This is sentiment, not the planned [bias analysis](BIAS.md).

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

The one-time `rss-data-init` and `analysis-data-init` services run as root only to set ownership of their named volumes, then exit. The app runs unprivileged with all capabilities dropped. Its limits remain 0.25 CPU, 128 MiB RAM, 32 processes, read-only root filesystem, writable `/data` and `/analysis`, and an 8 MiB restricted `/tmp`. The separate `analysis-worker` has no published ports, a read-only root filesystem, writable `/analysis`, a 256 MiB restricted `/tmp`, 64-process limit, 2 CPU, 4 GiB RAM, and restart policy `unless-stopped`.

The worker image downloads ProsusAI FinBERT and Helsinki-NLP German-to-English translation weights during build and records their resolved revisions in each completed result. Build requires access to Hugging Face; the running worker is configured offline and sends no filing text externally. FinBERT's CC BY-NC-SA 4.0 license restricts its use to non-commercial purposes; preserve attribution and license terms from [Model notices](MODEL-NOTICES.md), also copied into the worker image. The translation model's published license is Apache 2.0.

`analysis_data` stores source files and passage results. The worker enforces a 25 GiB logical artifact cap and prunes the oldest completed jobs before saving new results; in-progress jobs are retained. A named Docker volume has no portable hard-size limit in this Compose file, so configure a host filesystem/volume quota if a physical cap is required. `docker compose down -v` removes both `rss_data` and `analysis_data`.

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

Run `npm test` and `git diff --check`. Run `docker compose config` after Compose changes. For UI changes, check both languages, retained inputs, keyboard focus, small screens, and populated/empty feeds.

The project version is **0.2.1**. Keep [package.json](https://github.com/423F26/project1/blob/main/package.json), both project-version fields in [package-lock.json](https://github.com/423F26/project1/blob/main/package-lock.json), and the collector User-Agent in sync. Patch releases fix or document existing behavior; minor releases add behavior and cover incompatible changes before 1.0.0; 1.0.0 marks the first stable contract. Human maintainers own the [Agile records](https://github.com/423F26/project1/tree/main/docs/agile); agents leave them untouched.
