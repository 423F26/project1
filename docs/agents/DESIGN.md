# UI/UX Design Template

Approved direction: Zwicky is a quiet, professional financial reading interface. Simplicity and accessibility come first. Use the product name Zwicky in shared page branding while keeping page titles specific to their content. Follow the team's [bias specification](../BIAS.md); do not invent scores or analysis results. Local passage-level sentiment and evidence-based report generation are separate capabilities. Reports remain partial until coverage is validated; numeric scores stay hidden pending team calibration approval.

## Visual rules

| Token | Value |
| --- | --- |
| OLED canvas / surface | `#000000` / `#101214` |
| Primary / secondary / excerpt text | `#EEEAE3` / `#B8B8B5` / `#D2D2CF` |
| Placeholder / control border / separator | `#949494` / `#777777` / `#34373B` |
| Accent / accent text | `#BFD8ED` / `#000000` |

- Arial/Helvetica body and controls, 16px; labels and metadata generally 14px, with SEC filing metadata currently 13px. Georgia/Times headings: page 40/34/30px desktop/tablet/phone, news section 28px, article 23/22px. Normal weight, sentence case.
- Center content at 1086px maximum. Horizontal gutters: 40px desktop, 24px tablet, 16px phone. No fixed content heights or truncated stories.
- Keep the search area on the page background without a card, gradient, glow, or animation. Search controls have 8px radius and 46px minimum height; company input is 54px, 18px desktop/16px phone. Main buttons are at least 44px; primary action 48px. Feed filters remain visibly expanded; controls are 40px high. Pagination buttons are at least 28px wide and 36px high. Use a labeled native English/Deutsch dropdown with a decorative language icon.
- Header, filing search, then updates. Use a plain-language company label; market sits beside the search heading. Primary action aligns right; phone fields and action span the width.
- Thin article separators. SEC feed entries use one company heading and compact form, Added, and Published details; other publishers retain their notice titles. At 480px, stack fields/header. Target 320px and zoom without horizontal scrolling.
- No gradients, glow, ornamental charts, invented freshness badges, external fonts, or extra navigation without real destinations.

## Behavior and accessibility

Use visible labels, native controls, semantic headings, underlined links, a skip link, and clear keyboard focus. Target WCAG AA contrast and reflow. The language dropdown has a decorative language icon and explicit English/Deutsch text; market names remain explicit: **🇺🇸 United States / 🇩🇪 Germany**. Language and filing market are independent. Both markets share the same company/type/year/topic form layout, with type options adapted to each source. U.S. mode searches SEC filings in the app. Germany mode shows publication results from the official Unternehmensregister; linked titles open the registry documents in a new tab, and the interface explains that some deposited statements require registration. Topic filters match titles and source descriptions only, and German filters operate on the first page of results.

Keep every existing search input, option, default, saved language (`pageLanguage`), storage-denied fallback, and empty-feed message. Group SEC submissions under a linked company heading; each eligible filing has a linked readable form and labeled Added and Published times in Mountain time. Existing records without first-discovery time are excluded from Recent Filings but remain in company history. Limit each page to eight SEC company groups and 20 display entries; additional eligible SEC filings remain in the More filings disclosure. Filter the rolling previous 24 hours by first discovery before grouping, counts, and pagination; exclude future and unknown first-discovery times. Keep source controls always visible. Other publisher entries show their linked notice title and publisher. Language switching preserves input, selections, and current feed text. Links open in a new tab with `noopener noreferrer` and an accessible description. Remove the subtitle, topic explanation, feed description, and filter disclosure heading.

Keep the Recent Filings feed visible until a search is submitted. Use plain-language company search labels and do not simulate results. Unique company matches open their permanent history page; ambiguous matches expose company-page links. History lives on company pages, never in date overrides on the home feed. Preserve the eight backend feeds, startup/hourly collection, and saved entries on failure. Respect reduced-motion preferences and reflow at 320px and zoom without horizontal scrolling.

Preserve `<!-- FEED_ITEMS -->`, escaping, the single inline script for language and feed controls, its SHA-256 CSP, and `data-cfasync="false"`. Keep feed requests same-origin under CSP. See [Operations](../OPERATIONS.md#using-the-page) for current translation limits. Company pages lead with the dated saved assessment, then report history, cached filings, and manual report controls. Source evidence opens a self-hosted PDF viewer or a sanitized, script-free HTML document with linked explanations. XML/TXT use escaped text. No company-wide score. Page visits, search, collection, and language switches never start models. Preserve selected filings and filters when switching page language. Keep report sections together without tabs. No new dependencies for styling. Exclude mockup examples, carousel controls, and review-stage heights from production.

## Curation

Compare documentation with actual behavior, remove confirmed orphan artifacts and stale references, and prefer useful content over accumulation. Inspect uncertain files before deleting them.
