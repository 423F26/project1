# Financial Bias Detector

> Group 1, ESOF423, Fall 2026 · Professor Daniel DeFrance · Montana State University

[Live Webapp](https://esof423.csit.help) · login with GitHub or associated email

## Project Authors

- Owen Sanford ([oogwaysprophecy732](https://github.com/oogwaysprophecy732))
- Charles Smith ([chropic](https://github.com/chropic))

## Navigation

[Architecture](docs/architecture.md) · [Operations](docs/operations.md) · [Agile Documentation](docs/agile/README.md) · [Change Log](CHANGELOG.md) · [Agent Guide](AGENTS.md) · [Ponytail Philosophy](docs/PONYTAIL.md)

Agents must read the [Ponytail philosophy](docs/PONYTAIL.md) before planning changes and again before every commit, as required by the [Agent Guide](AGENTS.md).

## Local Deployment & Security

For development without Docker, install Node.js 22+ and OpenSSL, then run `npm run dev`. Open https://localhost:8443 and accept the local certificate warning. Certificates are generated automatically and code changes restart the server. See [Operations](docs/operations.md) for details.

With Docker Compose, HTTPS is published at `127.0.0.1:19283`.

The container is unprivileged, read-only, and capability-free. Its defaults are limited to 0.25 CPU, 64 MiB memory, 32 PIDs, and 10 requests per minute per source address.

TLS 1.2+, host/method/path/body validation, `nosniff`, HSTS, short timeouts, capped headers/connections, and local rate limiting remain enabled. Cloudflare Access does not protect a directly reachable origin.
