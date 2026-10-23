# Architecture

The app searches recent U.S. company filings from SEC data and displays German publication search results from the official Unternehmensregister. It also serves a working feed of saved financial updates. Full-document retrieval across markets and [bias analysis](BIAS.md) are not implemented.

## Main parts

| File | Role |
| --- | --- |
| [src/server.js](https://github.com/423F26/project1/blob/main/src/server.js) | HTTPS requests, security checks, feed rendering, and JSON responses |
| [src/company-search.js](https://github.com/423F26/project1/blob/main/src/company-search.js) | SEC company lookup and submissions; official German registry search and result parsing |
| [src/rss.js](https://github.com/423F26/project1/blob/main/src/rss.js) | Eight fixed feeds, hourly collection, XML parsing, and SQLite storage |
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
3. Method: anything except `GET` returns `405`.
4. Route and input:
   - `/` without a query returns the first feed page as HTML.
   - `/api/filings` returns rendered feed HTML, items, counts, and pagination data as JSON. Invalid filters return `400`.
   - `/api/company-filings` validates the selected market, company query, filing type, year, and topic. U.S. searches return recent matching SEC filings; German searches filter up to 30 entries from the first page of official Unternehmensregister publications. Invalid input returns `400`; filing-source failures return `502`.
   - Other paths, or a query on `/`, return `404`.
   - Both API routes reject a nonzero `Content-Length` or any transfer encoding with `413`.

The feed API accepts `source` (empty, `SEC`, `BaFin`, or `ECB`), inclusive `from`/`to` dates (`YYYY-MM-DD`), and separate `secOffset`/`otherOffset` cursors (integers from 0 to 1,000,000).

U.S. company lookup uses SEC's company ticker directory and public submissions data. Results are limited to five matching companies and eight recent matching filings per company. Both market modes share the same search layout. Filing type choices reflect the selected market: SEC form groups in the U.S. and annual/interim/other publication categories in Germany. Year and topic filters are applied to the available filing metadata. Topic matching checks filing titles and source descriptions only; it does not inspect statement text. German search fetches and parses up to 30 entries from the first page of official register publication results, then filters those entries by publication year, type, and topic. German results therefore do not search older result pages when a filter excludes entries from the first page. Filing titles link to the original register pages; the app does not store German results or retrieve filing contents. The register may require registration for some deposited financial statements.

## Feed and page behavior

Sources are the U.S. Securities and Exchange Commission (SEC), Germany's financial regulator (BaFin), and the European Central Bank (ECB). The collector reads three SEC, two BaFin, and three ECB feeds at startup and hourly. It skips overlapping refreshes. SQLite, a database stored in one file, holds metadata and excerpts; repeated source/item IDs update existing rows. Display queries remove duplicate links. Failed feeds leave saved data intact; history is never pruned automatically.

Each page has up to 20 display entries, including at most eight SEC company groups. Each group includes all its matching filings, so a page may contain more than 20 filing links. The latest filing is shown first; additional filings are collapsed. BaFin and ECB entries show a linked title, publisher, and available date. Filters and page changes read saved data only and replace the displayed results.

One inline script controls English/German labels and feed requests. It preserves entered values and selections, saves `pageLanguage` when browser storage permits, and leaves publisher text in its source language. Some generated labels remain English; see [Operations](OPERATIONS.md#using-the-page).

## Documentation website

GitHub Pages builds the existing Markdown files with Jekyll after pushes to `main`. One shared layout and stylesheet match the webapp's colors and typography. Navigation is generated from the rendered pages; internal Markdown links become website links. Agile records and app/runtime files are excluded and linked on GitHub. See [publishing details](OPERATIONS.md#documentation-website).

## Security boundary

- TLS 1.2+, certificate/key paths, and an exact hostname allowlist are required. Rate limits use the direct socket address and ignore forwarded IP headers; tunnel users may share one limit.
- There are no cookies, CORS access, or request-body parsing. Headers, request time, and connection reuse are limited; errors are plaintext.
- Feed fetches use fixed publisher URLs, a 10-second timeout, a 2 MiB limit, and HTTPS redirects restricted to the original host. Company search makes bounded requests to fixed SEC and Unternehmensregister endpoints with a 12-second timeout and an 8 MiB response limit. Unsafe XML is rejected. Displayed text is escaped and filing links require HTTPS.
- HTML uses a restrictive Content Security Policy (CSP): the single inline script is allowed by its SHA-256 hash, feed requests stay on the same origin, and forms/frames are blocked. HSTS requires future HTTPS visits; referrer headers are disabled.
- The app container runs as `node`, with all Linux capabilities dropped and a read-only filesystem except its RSS volume and temporary storage. A separate root initialization service sets volume ownership.

Follow the [Repository guide](../AGENTS.md) when changing these boundaries.
