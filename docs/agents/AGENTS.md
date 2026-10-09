# Repository guide

Every pass: read [DESIGN.md](DESIGN.md) and [PONYTAIL.md](PONYTAIL.md), then trace the affected flow. Recheck both before committing. Keep responses, plans, and documentation concise; link to canonical guidance instead of repeating it.

- Keep code in `src/`, UI in `public/`, checks in `test/`, and agent guidance here. Root `AGENTS.md` is only the discovery entry point.
- Reuse existing capabilities. Add dependencies, routes, state, or external services only with user authorization.
- Read [Operations](../OPERATIONS.md) for deployment changes and [Architecture](../ARCHITECTURE.md) for service boundaries. Update the relevant canonical document when its contract changes.
- [Agile](../agile/README.md) is human-maintained only. Agents must not create, edit, regenerate, or update any Agile records, workbook, task assignments, sprint documents, or tracking artifacts. Do not duplicate them elsewhere.
- Validate with `npm test` and `git diff --check`; run `docker compose config` when Compose changes. For UI, check both languages, retained inputs, keyboard focus, narrow-screen reflow, and real/empty feeds.
- Remove only confirmed clutter. Check references before deleting files; fix broken local documentation links. Never commit secrets, certificates, runtime data, or editor/OS residue.
