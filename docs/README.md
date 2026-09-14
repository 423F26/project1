# Project map

Before planning changes and again before every commit, all agents must read [PONYTAIL.md](PONYTAIL.md) in full and follow the [Repository guide](../AGENTS.md). The philosophy is preserved verbatim here as the shared reference for choosing the smallest correct change after understanding the problem.

| Need | Start here |
| --- | --- |
| Required philosophy before planning or committing | [Ponytail](PONYTAIL.md) |
| Understand the request path or change code | [Architecture](architecture.md) |
| Run or modify the container deployment | [Operations](operations.md) |
| Record or release a change | [Changelog](../CHANGELOG.md) |
| Plan or record sprint work | [Agile documentation](agile/README.md) |
| Rules for contributors and agents | [Repository guide](../AGENTS.md) |

## Release rule

`package.json` is the version source of truth. Use Semantic Versioning:

- **Patch** (`0.0.1` → `0.0.2`): documentation, fixes, or hardening with no interface change.
- **Minor** (`0.0.1` → `0.1.0`): backward-compatible configuration or behavior additions. Before `1.0.0`, use a minor increment for incompatible changes as well.
- **Major** (`0.1.0` → `1.0.0`): the first stable release, after the endpoint, deployment, configuration, and security contract are established.

Every change belongs under `Unreleased` in `CHANGELOG.md`. At release, move those entries into a dated version section and update `package.json` in the same change.

## Fast checks

```powershell
npm test
git diff --check
docker compose config  # when Docker is installed
```
