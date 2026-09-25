# Operations

## Local development (without Docker)

Install Node.js 22+ (with npm) and OpenSSL, then run `npm run dev` from the repository directory. No `npm install` or `.env` setup is needed; the project has no dependencies.

Open https://localhost:8443 and accept the self-signed development certificate warning. The server binds only to `127.0.0.1` and restarts when its JavaScript files change. Stop it with Ctrl+C. To check the endpoint from a terminal, run `curl -k https://localhost:8443/`; expect the Financial Bias Detector HTML document.

The command creates and reuses a one-year certificate in ignored `certs/dev/`, separate from deployment certificates. Delete `certs/dev/` and restart to regenerate an expired certificate. The same HTTPS server and request protections apply, including the 10 requests/minute limit.

The interface is a static filing-search prototype above the September 2026 news snapshot and RSS source manager. The U.S./Germany choice is visual only; U.S. search fields are shown. The Search button is inert, with no filing retrieval, analysis, storage, or backend fetch connected. The news cards contain fictional demo scores. Live filing search and RSS syncing are deferred.

## Compose deployment

```powershell
Copy-Item .env.example .env
# Put the Cloudflare Origin CA certificate in certs/tls.crt and its private key in certs/tls.key.
docker compose up --build -d
```

`compose.yaml` binds the service only to `127.0.0.1:19283`. A Cloudflare Tunnel should connect to `https://127.0.0.1:19283`, validate the origin certificate, and send the public hostname in `Host`.

## Configuration

| Input | Set in | Required | Notes |
| --- | --- | --- | --- |
| `ALLOWED_HOSTS` | `.env` | Yes | Exact public hostname; comma-separated values are allowed. |
| `certs/tls.crt` | Host filesystem | Yes | Cloudflare Origin CA or publicly trusted certificate. |
| `certs/tls.key` | Host filesystem | Yes | Matching private key; never commit it. |
| `PORT` | Image environment | No | Fixed at `19283` by default. |
| `RATE_LIMIT` | Image environment | No | Defaults to 10 requests/minute per direct source address. |

## Runtime boundary

| Control | Default |
| --- | --- |
| Published address | `127.0.0.1:19283` |
| User | `node` (unprivileged) |
| Linux capabilities | All dropped |
| Filesystem | Read-only; `/tmp` is an 8 MiB restricted tmpfs |
| CPU / memory / PIDs | 0.25 CPU / 64 MiB / 32 |
| Restart | `unless-stopped` |

Do not change the port mapping to `0.0.0.0` unless a firewall limits inbound traffic to Cloudflare IP ranges. Cloudflare Access is an edge control and cannot protect an origin that is independently reachable.

## Release rule

`package.json` is the version source of truth. Use Semantic Versioning:

- **Patch** (`0.0.1` → `0.0.2`): documentation, fixes, or hardening with no interface change.
- **Minor** (`0.0.1` → `0.1.0`): backward-compatible configuration or behavior additions. Before `1.0.0`, use a minor increment for incompatible changes as well.
- **Major** (`0.1.0` → `1.0.0`): the first stable release, after the endpoint, deployment, configuration, and security contract are established.

Every change belongs under `Unreleased` in `CHANGELOG.md`. At release, move those entries into a dated version section and update `package.json` in the same change.

## Fast checks

```powershell
npm test
git diff --check
docker compose config  # when Docker is installed
```
