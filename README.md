# Untitled (Zwicky)
> Group 1, ESOF423, Fall 2026 · Professor Daniel DeFrance · Montana State University

Search U.S. SEC filings or German Unternehmensregister publications, then open a company's permanent page to review all locally known filings and saved reports. The home feed shows only today's SEC, BaFin, and ECB updates in U.S. Mountain time. Manually select cached filings for local bilingual reports covering changes, potential bias, and disclosed financial risks, with linked PDF/HTML source evidence. Local passage sentiment remains separate from bias. Reports are currently partial and numeric bias scores stay withheld pending reviewed calibration and complete-coverage validation. No hosted model or automatic analysis is used.

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

[Bias analysis specification](docs/BIAS.md)

## Local Deployment & Security

Install Node.js 22.13+, npm, and OpenSSL. Run `npm ci` and `npm run dev`. Open `https://localhost:8443`. See [Operations](docs/OPERATIONS.md) for setup and configuration.

With Docker Compose, HTTPS is published at `127.0.0.1:19283`.

The web container runs unprivileged with all Linux capabilities dropped. Its limits remain 0.25 CPU, 128 MiB memory, and 32 processes. A separate local inference scheduler is capped at 4 CPU, 8 GiB memory, and 64 processes. It serializes pinned Qwen3 4B report inference through llama.cpp and the separate FinBERT sentiment/translation pipeline. FinBERT retains its non-commercial license. Analysis artifacts share a 25 GiB application quota that protects active inputs and prunes eligible old outputs; see [Operations](docs/OPERATIONS.md).
