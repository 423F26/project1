# AI implementation handoff

**Updated:** 2026-10-24

**Repository state:** `main` at `1fccc3e` (`Add local filing sentiment analysis`)
**Purpose:** Record the remaining work toward the complete financial analysis product. The planning brief supplied on 2026-10-23 describes the product decisions and acceptance goals; this handoff updates its status against the current repository.

## Current state

The app already searches SEC company filings and German Unternehmensregister publications. A user can select results and queue persistent analysis jobs. A separate CPU worker retrieves and extracts supported documents, classifies English passages with local ProsusAI FinBERT, and translates German passages locally before classification. The existing status area reports job progress. Original text and model provenance are retained. German publication pages must expose up to five same-host document links; if links or readable content are unavailable, the job is unavailable rather than treating listing text as a filing. The web and worker resource limits, artifact retention behavior, and FinBERT license terms are documented in [Operations](OPERATIONS.md), [Architecture](ARCHITECTURE.md), and [Model notices](MODEL-NOTICES.md).

This is a sentiment-analysis slice, **not** the complete product. Sentiment does not identify bias, determine financial risk, support a claim, or qualify a filing for a bias score. Follow [the bias specification](BIAS.md); do not imply those features exist.

## Remaining work, in order

1. **Validate the shipped slice in its deployment environment.** Build and run `docker compose`, confirm the web and worker limits, model loading, queue recovery, document paths, shared-volume permissions, and quota pruning. Test representative public SEC filings and German publications, including inaccessible/deposited statements and pages with multiple or unsupported document links. Docker was unavailable during the initial implementation, so container behavior remains unverified. Resolve the three existing stale UI-test failures before relying on the full `npm test` result.
2. **Improve document coverage and provenance.** Current extraction handles HTML/XML/plain text and text-based PDFs; it does not preserve reliable section, table, footnote, page, or XBRL context, and it cannot read scanned PDFs. Implement structured extraction and explicit per-page/per-section coverage. Use OCR only if supported scans are in scope. Never mark partial extraction as complete.
3. **Add structured financial facts and comparisons.** Retrieve SEC Company Facts/XBRL data, preserve concept, unit, currency, dimensions, period, filing, and restatement context, then compare selected and prior filings deterministically. Define and test the corresponding German source path before claiming equivalent coverage.
4. **Calculate the separate risk profile.** Implement documented liquidity/payment, leverage/debt, cash-flow, and market-exposure indicators. Every value needs its source, unit, period, formula, and limitations; unavailable values remain unavailable. Do not combine these indicators into a score.
5. **Decide and authorize contextual reasoning.** The planning brief selected a hosted LLM for contextual comparisons and candidate bias findings, but provider/model, data handling, billing owner, and spending ceiling remain undecided. Obtain explicit approval for sending bounded filing excerpts externally, then specify the output schema and secrets handling. Do not send documents to an external provider before those decisions.
6. **Implement evidence verification and bias scoring.** Verify every cited passage and counterexample against stored source spans, deduplicate related findings, and implement the exact factors, caps, multipliers, rounding, and incomplete-review score withholding in [BIAS.md](BIAS.md). A model must not calculate the final score or verify its own citations.
7. **Build the report experience.** Add the three specified sections—what changed, bias review, and financial risk—to the existing product while preserving its design and security rules. Keep original-language evidence, bilingual explanations, source/page references, clear coverage limits, and safe text rendering. Sentiment, bias, and risk must remain distinct.
8. **Evaluate and operate the complete pipeline.** Create reviewed English and German fixtures for valid findings, counterevidence, missing pages/tables, conflicting periods, and inaccessible documents. Measure numeric accuracy, citation validity, coverage detection, language quality, false positives, latency, and LLM cost. Add versioned provenance, monitoring, retry/backoff, and regression/security checks before presenting outputs as reliable.

## Decisions still needed

- Hosted LLM provider/model, privacy and retention terms, budget ceiling, and the person/account responsible for API access.
- First-release geographic and filing scope for the full report. Existing search covers U.S. SEC and German publications, but not every result is a comparable company filing.
- Human-reviewed examples and acceptance thresholds for the custom bias score and German-language quality.
- Long-term source retention, backup, and hard disk quota policy. The current 25 GiB cap is an application artifact cap; a Docker named volume does not enforce a physical host limit.
- Whether OCR, Office documents, additional German publication formats, and automated hourly analysis are in scope.

FinBERT's current weights are licensed for non-commercial use; review [Model notices](MODEL-NOTICES.md) before any commercial deployment. Do not describe German sentiment as validated until evaluated on reviewed financial documents.

## Working rules

Work in small, testable increments and update the canonical docs with each behavior change. Preserve the existing web-container limits and security boundary unless explicitly approved. Read `AGENTS.md`, `docs/agents/DESIGN.md`, and `docs/agents/PONYTAIL.md` before work. Never edit or regenerate `docs/agile/`.
