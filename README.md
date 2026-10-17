# Untitled (Zwicky)
> Group 1, ESOF423, Fall 2026 · Professor Daniel DeFrance · Montana State University

Browse saved SEC filings and BaFin/ECB updates in English or German. Company search and bias analysis are planned.

[Web app](https://esof423.csit.help)

## Project Authors

- Owen Sanford ([oogwaysprophecy732](https://github.com/oogwaysprophecy732))
- Charles Smith ([chropic](https://github.com/chropic))

## Navigation

[Agile Documentation](docs/agile/README.md)

[Operations](docs/OPERATIONS.md)

[Architecture](docs/ARCHITECTURE.md)

[Agents](docs/agents/AGENTS.md)

[Design language](docs/agents/DESIGN.md)

[Planned bias analysis](docs/BIAS.md)

## Local Deployment & Security

Install Node.js 22.13+, npm, and OpenSSL. Run `npm ci` and `npm run dev`. Open `https://localhost:8443`. See [Operations](docs/OPERATIONS.md) for setup and configuration.

With Docker Compose, HTTPS is published at `127.0.0.1:19283`.

The app container runs unprivileged with all Linux capabilities dropped. It can write to its RSS volume and temporary storage. Defaults: 0.25 CPU, 128 MiB memory, 32 processes, and 10 requests/minute per direct socket source address. A separate initialization service runs as root to set volume ownership.
