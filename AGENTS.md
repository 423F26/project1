# Repository guide

Before planning any changes, read [docs/agents/PONYTAIL.md](docs/agents/PONYTAIL.md) in full, then [docs/OPERATIONS.md](docs/OPERATIONS.md) for deployment and operational guidance. Also read the Agile records in [docs/agile/README.md](docs/agile/README.md). Apply the Ponytail philosophy to the work: understand the problem and affected flow, reuse what exists, and make the smallest correct change.

Before every commit, read [docs/agents/PONYTAIL.md](docs/agents/PONYTAIL.md) again and check the proposed diff against it and the requirements below. These reading steps are mandatory for all agents, including documentation-only work. Preserve the philosophy file verbatim; keep repository-specific guidance here and in the other docs.

## Required for every change

1. Keep the service intentionally small: Ponytail philosophy. Do not add routes, dependencies, state, or external services without explicit approval.
2. Update the relevant file in `docs/` when behavior, security, deployment, configuration, or structure changes.
3. Before a release, move `Unreleased` entries to a dated version section and increment `package.json` using the policy in [docs/OPERATIONS.md](docs/OPERATIONS.md).
4. Run `npm test` and `git diff --check`. Run `docker compose config` when Docker is available and Compose changed.

## Sprint documentation

Before starting scoped work, explicitly acknowledge review of `docs/agile/`, inspect `docs/agile/PRODUCT_BACKLOG.md`, and read the matching sprint's `GOAL.md` and `BACKLOG.md`. When a task changes state, scope, maintainer, or sprint, update both matching backlog rows in the same change; update the sprint goal if the objective changes. Regenerate `docs/agile/BURNDOWN.svg` when Agile records change. Ask the user before proceeding if the task has no matching backlog item, its sprint is unclear, or it conflicts with the sprint goal. Do not create timesheets, hour estimates, or individual performance records.

Never commit `.env`, `certs/`, private keys, certificates, or generated runtime files.

## Repository layout

Keep application code in `src/`, the static interface in `public/`, tests in `test/`, and project records in `docs/`. Keep the repository root for standard project and deployment configuration only.
