# Changelog

## Unreleased

- Fixed Compose startup with new or previously root-owned RSS volumes by initializing their ownership before the unprivileged application starts.

- Moved RSS collection to an hourly backend job with persistent SQLite storage and live homepage entries; removed visitor RSS controls and fictional news cards. Publisher corrections are applied on refresh, SEC text respects its declared encoding, and duplicate rows cannot hide recent distinct entries.

- Excluded the language script from Cloudflare Rocket Loader so the CSP-permitted toggle runs on the live site.
- Added an English/German page-text toggle that remembers the browser choice and a CSP hash allowing only its inline script.
- Replaced the old search controls with a country-aware filing-search mockup, keeping the homepage news feed and RSS panel visible. Search and country selection remain visual placeholders.
- Replace the task-count SVG burndown with an Excel workbook containing five work-unit sprint charts and an editable backlog and completion log.
