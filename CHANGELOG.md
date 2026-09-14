# Changelog

This project uses [Semantic Versioning](https://semver.org/). Keep new work under `Unreleased` until it is released.

## Unreleased

### Added

- Lightweight product and sprint backlogs with required agent status updates; excludes burndown and timesheet tracking.
- Static Financial Bias Detector HTML interface with five illustrative September 2026 news cards and inert search controls.
- `npm run dev` starts the existing HTTPS server on localhost with automatic development certificates and restart on code changes, without Docker or npm dependencies.

### Changed

- Moved application code to `src/` and the static interface to `public/`, keeping deployment configuration at the repository root.
- `GET /` now returns the hardened HTML interface while validation errors remain plaintext; the container includes the static document.
- Preserved the Ponytail philosophy in `docs/PONYTAIL.md` and made it required agent reading before planning changes and before every commit, with links from the project and architecture guides.
- Docker Compose and image HTTPS port changed to `19283`.
- Reformatted the README as the project landing page.

## 0.0.1 — 2026-09-09

### Added

- Minimal, hardened plaintext HTTPS service and Docker Compose deployment.
- Repository guide and navigable architecture/operations documentation.
