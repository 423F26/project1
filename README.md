# Financial Bias Detector

> Group 1, ESOF423, Fall 2026 · Professor Daniel DeFrance · Montana State University

[Live Webapp](https://esof423.csit.help)

## Project Authors

- Owen Sanford ([oogwaysprophecy732](https://github.com/oogwaysprophecy732))
- Charles Smith ([chropic](https://github.com/chropic))

## Navigation

[Architecture](docs/architecture.md) · [Operations](docs/operations.md) · [Agile Documentation](docs/agile/README.md) · [Change Log](CHANGELOG.md) · [Agents](AGENTS.md)

## Local Deployment & Security

`npm run dev`. Open https://localhost:8443. See [Operations](docs/operations.md) for details.

With Docker Compose, HTTPS is published at `127.0.0.1:19283`.

The container is unprivileged, read-only, and capability-free. Its defaults are limited to 0.25 CPU, 64 MiB memory, 32 PIDs, and 10 requests per minute per source address.
