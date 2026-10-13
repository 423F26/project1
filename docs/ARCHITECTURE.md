# Architecture

Follow the [Repository guide](agents/AGENTS.md), [Ponytail](agents/PONYTAIL.md), and [Design](agents/DESIGN.md) on every pass.

## Shape

```text
Internet → Cloudflare Access → Cloudflare Tunnel → 127.0.0.1:19283 → Compose container → src/server.js
```

The service has one persistent SQLite RSS store. `GET /` returns the Financial Bias Detector HTML document with the first filtered feed page. Same-origin `GET /api/filings` returns later pages or filtered results as JSON; validation errors remain plaintext.

## Landmarks

| Location | Purpose | Change carefully when |
| --- | --- | --- |
| [docs/agents/](agents/AGENTS.md) | Canonical workflow, Ponytail philosophy, and design language | Changing contributor guidance or UI contracts |
| [src/server.js](../src/server.js) | HTTPS server, validation, headers, timeouts, rate limiting | Changing request behavior or security controls |
| [src/rss.js](../src/rss.js) | Fixed feed list, hourly collector, XML parsing, SQLite persistence | Changing ingestion or storage |
| [public/index.html](../public/index.html) | Interface template, inline styles, one inline language script | Changing the UI |
| [src/dev.js](../src/dev.js) | Local development entry point with automatic certificates and loopback binding | Changing developer setup; reuses `createServer` |
| [compose.yaml](../compose.yaml) | RSS-volume ownership initialization, local-only port publishing, certificate mount, runtime restrictions | Changing deployment or resource limits |
| [Dockerfile](../Dockerfile) | Minimal unprivileged Node runtime image | Changing the runtime or build inputs |
| [package.json](../package.json) | Commands and release version | Releasing or adding a development command |
| [test/configuration.test.js](../test/configuration.test.js) | Endpoint and host-validation checks | Changing server behavior |

## Request contract

```text
TLS 1.2+ request
  ├─ known Host?            no → 421
  ├─ below rate limit?      no → 429
  ├─ GET?                  no → 405
  ├─ `GET /` or `/api/filings`? no → 404
  ├─ empty body?           no → 413
  └─ return HTML           yes → 200
```

`src/server.js` does not trust forwarded client-IP headers. Its local rate limit uses the direct socket address, which is intentional: Cloudflare Access and the tunnel/firewall enforce the real network boundary.

## Security invariants

- TLS key and certificate paths are mandatory at startup.
- `ALLOWED_HOSTS` is mandatory and exact-match only.
- No cookies, CORS, or request-body parsing exists. The root document includes a visual U.S./Germany filing-market choice and native search fields; the choice and Search button remain inert. RSS is collected by the backend only; visitors can filter the saved feed by publisher and date through a validated JSON endpoint, and page through results in groups of 20.
- The single inline script changes only translated page text, accessible labels, and `<html lang>`; it saves `en` or `de` under `pageLanguage` in browser local storage when available. It does not change the selected filing market, entered text, filters, or publisher text. Its `data-cfasync="false"` attribute keeps Cloudflare Rocket Loader from intercepting it.
- The collector fetches only the eight fixed publisher URLs. Entries are deduplicated in SQLite; SEC company and form metadata is stored when provided and rendered with escaped text and HTTPS links. The homepage groups SEC filings by company, provides individual filing links with form, timestamp, and accession details, limits each results page to eight SEC company groups, and includes all matching saved filings within each selected group. Date/source filters and pagination only read saved data; they never request publisher feeds. A one-shot Compose service assigns the `/data` volume to the `node` user before the read-only, unprivileged application container starts. Failed feeds do not erase previously saved entries.
- The service rejects bodies and transfer encodings, caps header size/count and keep-alive work, and returns plaintext errors. Its HTML response has a restrictive CSP with a SHA-256 hash for that inline script and same-origin connections for the feed endpoint, HSTS, and `Referrer-Policy: no-referrer`. The other CSP restrictions remain in place.

Preserve these invariants unless the change is explicitly approved and documented here. Human maintainers own the [Agile workbook](agile/AGILE_ARTIFACTS.xlsx); agents leave Agile records untouched.
