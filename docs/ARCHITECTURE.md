# Architecture

The app serves a filing-search prototype and a working feed of saved financial updates. Company search, full-document retrieval, and [bias analysis](BIAS.md) are not implemented.

## Main parts

| File | Role |
| --- | --- |
| [src/server.js](../src/server.js) | HTTPS requests, security checks, feed rendering, and JSON responses |
| [src/rss.js](../src/rss.js) | Eight fixed feeds, hourly collection, XML parsing, and SQLite storage |
| [public/index.html](../public/index.html) | Layout, styles, language toggle, feed filters, and pagination |
| [src/dev.js](../src/dev.js) | Local server and development certificates |
| [compose.yaml](../compose.yaml) / [Dockerfile](../Dockerfile) | Deployment, storage ownership, and container limits |
| [package.json](../package.json) / [package-lock.json](../package-lock.json) | Commands, project version, and locked dependencies |
| [test/](../test/) | Server, feed, and language checks |

## Request flow

Deployment path: visitor → Cloudflare Access → Cloudflare Tunnel → `127.0.0.1:19283` → container → HTTPS server. See [Operations](OPERATIONS.md) for setup.

The server checks requests in this order:

1. Rate limit: excess requests return `429`.
2. Allowed hostname: an unknown host returns `421`.
3. Method: anything except `GET` returns `405`.
4. Route and input:
   - `/` without a query returns the first feed page as HTML.
   - `/api/filings` returns rendered feed HTML, items, counts, and pagination data as JSON. Invalid filters return `400`.
   - Other paths, or a query on `/`, return `404`.
   - Both supported routes reject a nonzero `Content-Length` or any transfer encoding with `413`.

The feed API accepts `source` (empty, `SEC`, `BaFin`, or `ECB`), inclusive `from`/`to` dates (`YYYY-MM-DD`), and separate `secOffset`/`otherOffset` cursors (integers from 0 to 1,000,000).

## Feed and page behavior

Sources are the U.S. Securities and Exchange Commission (SEC), Germany's financial regulator (BaFin), and the European Central Bank (ECB). The collector reads three SEC, two BaFin, and three ECB feeds at startup and hourly. It skips overlapping refreshes. SQLite, a database stored in one file, holds metadata and excerpts; repeated source/item IDs update existing rows. Display queries remove duplicate links. Failed feeds leave saved data intact; history is never pruned automatically.

Each page has up to 20 display entries, including at most eight SEC company groups. Each group includes all its matching filings, so a page may contain more than 20 filing links. The latest filing is shown first; additional filings are collapsed. BaFin and ECB entries show a linked title, publisher, and available date. Filters and page changes read saved data only and replace the displayed results.

One inline script controls English/German labels and feed requests. It preserves entered values and selections, saves `pageLanguage` when browser storage permits, and leaves publisher text in its source language. Some generated labels remain English; see [Operations](OPERATIONS.md#using-the-page).

## Security boundary

- TLS 1.2+, certificate/key paths, and an exact hostname allowlist are required. Rate limits use the direct socket address and ignore forwarded IP headers; tunnel users may share one limit.
- There are no cookies, CORS access, or request-body parsing. Headers, request time, and connection reuse are limited; errors are plaintext.
- Feed fetches use fixed publisher URLs, a 10-second timeout, a 2 MiB limit, and HTTPS redirects restricted to the original host. Unsafe XML is rejected. Displayed text is escaped and filing links require HTTPS.
- HTML uses a restrictive Content Security Policy (CSP): the single inline script is allowed by its SHA-256 hash, feed requests stay on the same origin, and forms/frames are blocked. HSTS requires future HTTPS visits; referrer headers are disabled.
- The app container runs as `node`, with all Linux capabilities dropped and a read-only filesystem except its RSS volume and temporary storage. A separate root initialization service sets volume ownership.

Follow the [Repository guide](agents/AGENTS.md) when changing these boundaries.
