# Operations

## Run locally

Install Node.js 22.13 or newer, npm, and OpenSSL. From the repository directory:

```powershell
npm ci
npm run dev
```

Open `https://localhost:8443` and accept the local self-signed certificate warning. The server listens only on `127.0.0.1`, restarts when loaded JavaScript files change, and stops with Ctrl+C. Check the HTML response with `curl.exe -k https://localhost:8443/` on Windows.

Development needs no `.env`. It creates a one-year certificate in ignored `certs/dev/` and a database at `data/rss.sqlite`. With the server stopped, delete `certs/dev/` to replace an expired certificate, or delete `data/rss.sqlite` to erase local feed history. To change the port in PowerShell, run `$env:PORT = '8765'` before `npm run dev`.

## Using the page

- **Find company filings** is a prototype: its search button does nothing. United States is selected; Germany is unavailable.
- **Recent Filings** works. Expand the source/date filters, apply or clear them, and use numbered pages or previous/next controls. Dates include both endpoints and use the publication date, falling back to the collection date. Pages contain up to 20 entries, including at most eight SEC company groups; expand a group to see its other matching filings. Links open the original sources in new tabs.
- **Deutsch / English** changes marked page labels and preserves inputs. English is the default; `pageLanguage=de` in browser storage restores German. If storage is blocked, the choice lasts for that visit. Publisher text stays in its source language. Generated SEC form labels, expansion text, new-tab descriptions, and some pagination labels remain English. Empty messages loaded after filtering/paging are not reapplied to the selected language.

The backend collects eight feeds at startup and hourly, independently of visits. Failed sources keep saved entries. An empty database or unmatched filter shows an empty message. Hourly polling can miss entries removed by publishers between checks. Full-document retrieval and [bias analysis](BIAS.md) are planned.

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

The one-time `rss-data-init` service runs as root to give `node` ownership of the `rss_data` volume, then exits. The app runs unprivileged with all capabilities dropped. Limits: 0.25 CPU, 128 MiB RAM, 32 processes, read-only root filesystem, writable `/data`, and an 8 MiB restricted `/tmp`. Restart policy: `unless-stopped`.

Outbound HTTPS to the fixed feeds is required. SEC requests include `charles.smith26@student.montana.edu` in the User-Agent. Feed history stays in `rss_data` across rebuilds and `docker compose down`; `docker compose down -v` erases it. There is no automatic pruning.

## Documentation website

[Read the documentation](https://423f26.github.io/project1/) on GitHub Pages. GitHub builds it from `main` and the repository root using Jekyll. Every push to `main` triggers publishing; changes appear after the build and deployment finish, usually within a few minutes, rather than instantly. Uncommitted changes and other branches do not update the site.

Edit the existing Markdown files; do not maintain separate website copies. README is the landing page and first navigation link. Sidebar labels and browser titles use filenames without extensions; document headings stay unchanged. Files are grouped by repository folder, with all folders expanded. The desktop sidebar stays visible while scrolling; on narrow screens, a sticky Menu button opens it. Agile records remain on GitHub. Source-code links also open GitHub because application files are excluded from the site.

The layout lives in `_layouts/default.html`, folder navigation in `_includes/docs-tree.html`, styles in `assets/docs.css`, and publishing configuration in `_config.yml`. The header reads “Project #1 Documentation”; the repository link is in the bottom-right footer. In repository **Settings → Pages**, keep **Deploy from a branch**, **main**, and **/(root)** selected, with no custom domain. Check the **pages build and deployment** run in **Actions** if an update fails. The documentation site is English; the webapp's language toggle is separate.

## Configuration

`.env` supplies Compose substitutions; the app does not load it directly. Compose currently forwards only `ALLOWED_HOSTS` and the two TLS paths.

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

The project version is **0.2.0**. Keep [package.json](https://github.com/423F26/project1/blob/main/package.json), both project-version fields in [package-lock.json](https://github.com/423F26/project1/blob/main/package-lock.json), and the collector User-Agent in sync. Patch releases fix or document existing behavior; minor releases add behavior and cover incompatible changes before 1.0.0; 1.0.0 marks the first stable contract. Human maintainers own the [Agile records](https://github.com/423F26/project1/tree/main/docs/agile); agents leave them untouched.
