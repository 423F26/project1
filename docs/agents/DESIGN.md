# Refined Reading desk

Approved direction: a quiet, professional financial reading interface. Simplicity and accessibility come first. No established branding; use the descriptive title “Financial review.” **Do not define bias or invent scores, categories, confidence, rankings, or analysis results.** The team owns that definition.

## Visual rules

| Token | Value |
| --- | --- |
| OLED canvas / surface | `#000000` / `#101214` |
| Primary / secondary / excerpt text | `#EEEAE3` / `#B8B8B5` / `#D2D2CF` |
| Placeholder / control border / separator | `#949494` / `#777777` / `#34373B` |
| Accent / accent text | `#BFD8ED` / `#000000` |

- Arial/Helvetica body and controls, 16px; labels and metadata at least 14px. Georgia/Times headings: page 40/34/30px desktop/tablet/phone, news section 28px, article 23/22px. Normal weight, sentence case.
- Center content at 1086px maximum. Gutters 40px desktop, 24px tablet, 16px phone. Spacing scale 4/8/12/16/24/32px. No fixed content heights or truncated stories.
- Search surface radius 12px; native controls radius 8px, minimum height 46px. Company input 54px, 18px text desktop/16px phone. Buttons at least 44px; primary action 48px. Language button has rounded ends.
- Header, filing search, then updates. Company field spans the full width; three secondary selects follow. Market sits beside the search heading. Primary action aligns right; phone fields and action span the width.
- Thin article separators and a 104px publisher column, rather than repeated cards. Excerpts max 70ch. At 760px, topic gets its own row; at 480px, stack fields/header and put metadata above stories. Support 320px and zoom without horizontal scrolling.
- No gradients, glow, ornamental charts, invented freshness badges, external fonts, or extra navigation without real destinations.

## Behavior and accessibility

Use visible labels, native controls, semantic headings, underlined links, a skip link, and clear keyboard focus. Target WCAG AA contrast and reflow. Flags are decorative (`aria-hidden`); text remains explicit: **🇺🇸 English / 🇩🇪 Deutsch**, **🇺🇸 United States / 🇩🇪 Germany**. Language and filing market are independent. U.S. remains selected; Germany is visibly unavailable.

Keep every existing input, option, default, saved language (`pageLanguage`), storage-denied fallback, source URL/date, ordering, and empty-feed message. Group SEC submissions under a company heading; every filing remains a direct link and exposes its readable form, date/time, and accession reference. Limit each feed page to eight SEC company groups while including every matching filing in each selected group. Other publisher entries show only the linked article title, publisher, and date, with no excerpts or secondary action links. The collapsed publisher/date filters and plain underlined “Show 20 more” link query saved records only without skipping filings. Switching languages preserves input/selection and publisher text. Filing titles open in a new tab with `noopener noreferrer` and an accessible description.

The requested production UI omits the filing-search availability notice, publisher tagline, and design-preview footer. Search remains an inert prototype until retrieval is implemented; do not simulate results. Preserve the eight backend feeds, startup/hourly collection, latest 20 distinct links, and saved entries on failure.

Preserve `<!-- FEED_ITEMS -->`, escaping, one inline language script, its SHA-256 CSP, and `data-cfasync="false"`. Keep feed requests same-origin under CSP. No new dependencies for styling. Exclude mockup examples, carousel controls, and review-stage heights from production.

## Curation

Apply the supplied slop.md principles: compare documentation with actual behavior, remove confirmed orphan artifacts and stale references, and prefer useful content over accumulation. Uncertainty is a reason to inspect, not delete. This concise rule replaces copying the full audit taxonomy into each agent's context.
