# Unnamed Financial Bias Detector 

> Group 1, ESOF423, Fall 2026 · Professor Daniel DeFrance · Montana State University

[Webapp Link](https://esof423.csit.help)

## Project Authors

- Owen Sanford ([oogwaysprophecy732](https://github.com/oogwaysprophecy732))
- Charles Smith ([chropic](https://github.com/chropic))

## Navigation

[Agile Documentation](docs/agile/README.md)

[Operations](docs/OPERATIONS.md)

[Agents](docs/agents/AGENTS.md)

## Local Deployment & Security

Run `npm ci` and `npm run dev`. Open https://localhost:8443. See [Operations](docs/OPERATIONS.md) for details.

With Docker Compose, HTTPS is published at `127.0.0.1:19283`.

The container is unprivileged and capability-free, with a writable volume only for its RSS database. Its defaults are limited to 0.25 CPU, 128 MiB memory, 32 PIDs, and 10 requests per minute per source address.
