# Untitled (Zwicky)
> Group 1, ESOF423, Fall 2026 · Professor Daniel DeFrance · Montana State University

Search recent U.S. company filings from the SEC or German publications from the official Unternehmensregister, with results displayed in the app. Both market modes share company, type, year, and topic controls; type options reflect each market's source. Topic matches currently use titles and source descriptions rather than full filing text. Select search results for local passage-level sentiment analysis in a separate CPU worker. Sentiment is not bias analysis. Browse saved SEC, BaFin, and ECB updates in English or German.

[Web app](https://esof423.csit.help)

[Documentation website](https://423f26.github.io/project1/)

## Project Authors

- Owen Sanford ([oogwaysprophecy732](https://github.com/oogwaysprophecy732))
- Charles Smith ([chropic](https://github.com/chropic))

## Navigation

[Agile Documentation](https://github.com/423F26/project1/tree/main/docs/agile)

[Operations](docs/OPERATIONS.md)

[Architecture](docs/ARCHITECTURE.md)

[Agents](AGENTS.md)

[Design language](docs/agents/DESIGN.md)

[Planned bias analysis](docs/BIAS.md)

## Local Deployment & Security

Install Node.js 22.13+, npm, and OpenSSL. Run `npm ci` and `npm run dev`. Open `https://localhost:8443`. See [Operations](docs/OPERATIONS.md) for setup and configuration.

With Docker Compose, HTTPS is published at `127.0.0.1:19283`.

The web container runs unprivileged with all Linux capabilities dropped. Its limits remain 0.25 CPU, 128 MiB memory, and 32 processes. A separate local inference worker is capped at 2 CPU, 4 GiB memory, and 64 processes. It uses FinBERT (non-commercial license) for English sentiment and local translation for German text. Analysis artifacts have a 25 GiB application quota with oldest-completed-first pruning; see [Operations](docs/OPERATIONS.md).
