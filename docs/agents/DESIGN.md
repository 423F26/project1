# UI/UX Design Template

Approved direction: a quiet, professional financial reading interface. Simplicity and accessibility come first. No established branding; use the descriptive title “Financial review.” Follow the team's [planned bias specification](../BIAS.md); do not invent scores or analysis results. Analysis is not implemented.

## Visual rules

| Token | Value |
| --- | --- |
| OLED canvas / surface | `#000000` / `#101214` |
| Primary / secondary / excerpt text | `#EEEAE3` / `#B8B8B5` / `#D2D2CF` |
| Placeholder / control border / separator | `#949494` / `#777777` / `#34373B` |
| Accent / accent text | `#BFD8ED` / `#000000` |

- Arial/Helvetica body and controls, 16px; labels and metadata generally 14px, with SEC filing metadata currently 13px. Georgia/Times headings: page 40/34/30px desktop/tablet/phone, news section 28px, article 23/22px. Normal weight, sentence case.
- Center content at 1086px maximum. Horizontal gutters: 40px desktop, 24px tablet, 16px phone. No fixed content heights or truncated stories.
- Search surface radius 12px; search controls radius 8px, minimum height 46px. Company input 54px, 18px text desktop/16px phone. Main buttons at least 44px; primary action 48px. Feed filter controls are 40px high; pagination buttons are at least 28px wide and 36px high. Language button has rounded ends.
- Header, filing search, then updates. Company field spans the full width; three secondary selects follow. Market sits beside the search heading. Primary action aligns right; phone fields and action span the width.
- Thin article separators and a 104px publisher column (82px at tablet width). Excerpts max 70ch. At 760px, topic gets its own row; at 480px, stack fields/header and put metadata above stories. Target 320px and zoom without horizontal scrolling.
- No gradients, glow, ornamental charts, invented freshness badges, external fonts, or extra navigation without real destinations.

## Behavior and accessibility

Use visible labels, native controls, semantic headings, underlined links, a skip link, and clear keyboard focus. Target WCAG AA contrast and reflow. Flags are decorative (`aria-hidden`); text remains explicit: **🇺🇸 English / 🇩🇪 Deutsch**, **🇺🇸 United States / 🇩🇪 Germany**. Language and filing market are independent. U.S. remains selected; Germany is visibly unavailable.

Keep every existing input, option, default, saved language (`pageLanguage`), storage-denied fallback, source URL/date, ordering, and empty-feed message. Group SEC submissions under a company heading; every filing remains a direct link and exposes its readable form, date/time, and accession reference. Limit each feed page to eight SEC company groups while including every matching filing in each selected group. Other publisher entries show only the linked article title, publisher, and date, with no excerpts or secondary action links. The collapsed publisher/date filters and numbered pagination controls query saved records only without skipping filings; selecting a page replaces the current results. Switching languages preserves input/selection and publisher text. Filing titles open in a new tab with `noopener noreferrer` and an accessible description.

The current UI has a publisher description beneath Recent Filings, but no filing-search availability notice or design-preview footer. Search remains an inert prototype until retrieval is implemented; do not simulate results. Preserve the eight backend feeds, startup/hourly collection, and saved entries on failure. Each page contains up to 20 display entries, including at most eight SEC company groups and all matching filings within them; additional company filings are collapsed.

Preserve `<!-- FEED_ITEMS -->`, escaping, the single inline script for language and feed controls, its SHA-256 CSP, and `data-cfasync="false"`. Keep feed requests same-origin under CSP. See [Operations](../OPERATIONS.md#using-the-page) for current translation limits. No new dependencies for styling. Exclude mockup examples, carousel controls, and review-stage heights from production.

## Curation

Compare documentation with actual behavior, remove confirmed orphan artifacts and stale references, and prefer useful content over accumulation. Inspect uncertain files before deleting them.
