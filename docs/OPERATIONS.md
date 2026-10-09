# Operations

## Local development (without Docker)

Install Node.js 22.13+ (with npm) and OpenSSL, run `npm ci`, then run `npm run dev` from the repository directory. No `.env` setup is needed for development.

Open https://localhost:8443 and accept the self-signed development certificate warning. The server binds only to `127.0.0.1` and restarts when its JavaScript files change. Stop it with Ctrl+C. To check the endpoint from a terminal, run `curl -k https://localhost:8443/`; expect the Financial Bias Detector HTML document.

The command creates and reuses a one-year certificate in ignored `certs/dev/`, separate from deployment certificates. Delete `certs/dev/` and restart to regenerate an expired certificate. The same HTTPS server and request protections apply, including the 10 requests/minute limit.

The [Refined Reading desk](agents/DESIGN.md) interface is a static filing-search prototype above live RSS updates. Its availability notice is omitted by design; no search handler is connected. The U.S./Germany filing-market choice is visual only; U.S. search fields are shown. The Search button is inert, with no filing retrieval or bias analysis connected. There are no visitor-facing RSS settings or bias scores.

The backend fetches three ECB, two BaFin, and three SEC feeds once at startup and every 60 minutes thereafter. Page visits read saved entries and never trigger publisher requests. The 20 newest distinct links appear on the homepage. A source failure leaves saved entries available; if the database has no entries yet, the page shows an empty message. Polling hourly can miss items that rotate out of a feed between polls; SEC documents that its listed feeds contain a limited set of recent filings. Feed text remains in its published language. Development data lives in ignored `data/rss.sqlite`; delete that file to reset local RSS history.

The `🇩🇪 Deutsch`/`🇺🇸 English` button switches page text immediately and updates the document language. The page starts in English unless `pageLanguage` is saved as `de` in browser local storage. Clearing that key restores English on the next visit; if storage is blocked, the button still works until the page closes. Language switching leaves entered search text, selected options, the filing-market display, and the live feed text in place. The server allows the page's one inline language script by its SHA-256 CSP hash and keeps the other CSP restrictions.

Cloudflare Rocket Loader must leave the inline language script alone; its `data-cfasync="false"` attribute opts that script out. Do not allow Rocket Loader or analytics scripts through the CSP just to make the toggle work.

## Compose deployment

```powershell
Copy-Item .env.example .env
# Put the Cloudflare Origin CA certificate in certs/tls.crt and its private key in certs/tls.key.
docker compose up --build -d
```

`compose.yaml` binds the service only to `127.0.0.1:19283`. A Cloudflare Tunnel should connect to `https://127.0.0.1:19283`, validate the origin certificate, and send the public hostname in `Host`.

Compose stores RSS entries in the `rss_data` named volume mounted at `/data`. Preserve this volume across container rebuilds to retain feed history. The application keeps all fetched entries and does not prune them automatically. The container needs outbound HTTPS access to the eight publisher feeds. Only SEC requests identify the project with `charles.smith26@student.montana.edu` in the User-Agent.

Before the application starts, the one-shot `rss-data-init` service assigns the volume contents to the unprivileged `node` user. This also repairs ownership on volumes created by an older deployment. The service exits after initialization; the application container itself still runs unprivileged.

## Configuration

| Input | Set in | Required | Notes |
| --- | --- | --- | --- |
| `ALLOWED_HOSTS` | `.env` | Yes | Exact public hostname; comma-separated values are allowed. |
| `certs/tls.crt` | Host filesystem | Yes | Cloudflare Origin CA or publicly trusted certificate. |
| `certs/tls.key` | Host filesystem | Yes | Matching private key; never commit it. |
| `PORT` | Image environment | No | Fixed at `19283` by default. |
| `RATE_LIMIT` | Image environment | No | Defaults to 10 requests/minute per direct source address. |
| `RSS_DB_PATH` | Process environment | No | Defaults to `/data/rss.sqlite` in the container; development uses `data/rss.sqlite`. |

## Runtime boundary

| Control | Default |
| --- | --- |
| Published address | `127.0.0.1:19283` |
| User | `node` (unprivileged) |
| Linux capabilities | All dropped |
| Filesystem | Read-only except the `/data` RSS volume; `/tmp` is an 8 MiB restricted tmpfs |
| CPU / memory / PIDs | 0.25 CPU / 128 MiB / 32 |
| Restart | `unless-stopped` |

Do not change the port mapping to `0.0.0.0` unless a firewall limits inbound traffic to Cloudflare IP ranges. Cloudflare Access is an edge control and cannot protect an origin that is independently reachable.

## Release rule

`package.json` is the version source of truth. Use Semantic Versioning:

- **Patch** (`0.0.1` → `0.0.2`): documentation, fixes, or hardening with no interface change.
- **Minor** (`0.0.1` → `0.1.0`): backward-compatible configuration or behavior additions. Before `1.0.0`, use a minor increment for incompatible changes as well.
- **Major** (`0.1.0` → `1.0.0`): the first stable release, after the endpoint, deployment, configuration, and security contract are established.

Human maintainers track changes in the [Agile workbook](agile/AGILE_ARTIFACTS.xlsx); agents leave Agile records untouched. Update `package.json` when releasing.

## Fast checks

```powershell
npm test
git diff --check
docker compose config  # when Docker is installed
```
