# Repository guide

Before planning any changes, read [docs/PONYTAIL.md](docs/PONYTAIL.md) in full, then [../OPERATIONS.md](../OPERATIONS.md) for the architecture, Docker operations, and release history. Apply the Ponytail philosophy to the work: understand the problem and affected flow, reuse what exists, and make the smallest correct change.

Before every commit, read [docs/PONYTAIL.md](docs/PONYTAIL.md) again and check the proposed diff against it and the requirements below. These reading steps are mandatory for all agents, including documentation-only work. Preserve the philosophy file verbatim; keep repository-specific guidance here and in the other docs.

## Required for every change

1. Keep the service intentionally small: one `GET /` endpoint that returns the static HTML document; validation errors remain plaintext. Do not add routes, dependencies, state, or external services without explicit approval.
2. Update the relevant file in `docs/` when behavior, security, deployment, configuration, or structure changes.
3. Add a concise entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).
4. Before a release, move `Unreleased` entries to a dated version section and increment `package.json` using the policy in [../OPERATIONS.md](../OPERATIONS.md).
5. Run `npm test` and `git diff --check`. Run `docker compose config` when Docker is available and Compose changed.

## Sprint documentation

Before starting scoped work, inspect `docs/agile/product-backlog.md` and its sprint document under `docs/agile/sprints/`. When a sprint item changes state, update both matching rows in the same change. Do not create burndown charts, timesheets, hour estimates, or individual performance records.

Never commit `.env`, `certs/`, private keys, certificates, or generated runtime files.

## Repository layout

Keep application code in `src/`, the static interface in `public/`, tests in `test/`, and project records in `docs/`. Keep the repository root for standard project and deployment configuration only.
