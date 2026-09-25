# Architecture

All agents must read [agents/PONYTAIL.md](agents/PONYTAIL.md) before planning changes and again before every commit. Use its philosophy when making architecture decisions: understand the affected flow, reuse existing capabilities, and choose the smallest correct change. See the [Repository guide](../AGENTS.md) for the required workflow.

## Shape

```text
Internet → Cloudflare Access → Cloudflare Tunnel → 127.0.0.1:19283 → Compose container → src/server.js
```

The service is deliberately stateless. Its only success response is the self-contained Financial Bias Detector HTML document for `GET /`; all validation errors remain plaintext.

## Landmarks

| Location | Purpose | Change carefully when |
| --- | --- | --- |
| [docs/agents/PONYTAIL.md](agents/PONYTAIL.md) | Verbatim development philosophy; required reading before planning and committing | Preserve unchanged; put repository-specific guidance in [AGENTS.md](../AGENTS.md) |
| [src/server.js](../src/server.js) | HTTPS server, validation, headers, timeouts, rate limiting | Changing request behavior or security controls |
| [public/index.html](../public/index.html) | Static interface, inline styles, one inline language script, fixed September 2026 feed fixtures | Changing the UI or fixed prototype content |
| [src/dev.js](../src/dev.js) | Local development entry point with automatic certificates and loopback binding | Changing developer setup; reuses `createServer` |
| [compose.yaml](../compose.yaml) | Local-only port publishing, certificate mount, runtime restrictions | Changing deployment or resource limits |
| [Dockerfile](../Dockerfile) | Minimal unprivileged Node runtime image | Changing the runtime or build inputs |
| [package.json](../package.json) | Commands and release version | Releasing or adding a development command |
| [test/configuration.test.js](../test/configuration.test.js) | Endpoint and host-validation checks | Changing server behavior |

## Request contract

```text
TLS 1.2+ request
  ├─ known Host?            no → 421
  ├─ below rate limit?      no → 429
  ├─ GET?                  no → 405
  ├─ exact path /?         no → 404
  ├─ empty body?           no → 413
  └─ return HTML           yes → 200
```

`src/server.js` does not trust forwarded client-IP headers. Its local rate limit uses the direct socket address, which is intentional: Cloudflare Access and the tunnel/firewall enforce the real network boundary.

## Security invariants

- TLS key and certificate paths are mandatory at startup.
- `ALLOWED_HOSTS` is mandatory and exact-match only.
- No cookies, CORS, request parsing, server-side storage, logging of requests, or dependencies exist. The root document includes a visual U.S./Germany filing-market choice and native search fields, but the choice and Search button are inert and cannot submit a form or make a request. Filing retrieval and RSS syncing are deferred.
- The single inline script changes only translated page text, accessible labels, and `<html lang>`; it saves `en` or `de` under `pageLanguage` in browser local storage when available. It does not change the selected filing market, entered text, filters, or feed fixtures. Its `data-cfasync="false"` attribute keeps Cloudflare Rocket Loader from intercepting it.
- The service rejects bodies and transfer encodings, caps header size/count and keep-alive work, and returns plaintext errors. Its HTML response has a restrictive CSP with a SHA-256 hash for that inline script, HSTS, `Referrer-Policy: no-referrer`, and may load only HTTPS publisher thumbnails. The other CSP restrictions remain in place.

Preserve these invariants unless the change is explicitly approved and documented in this file and `CHANGELOG.md`.
