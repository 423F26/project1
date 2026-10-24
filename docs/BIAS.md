# Financial bias: planned analysis

This is the team's agreed specification. The app can retrieve selected filings and run local passage-level financial sentiment. It does **not** produce bias findings, calculate bias scores, or highlight documents. Sentiment is not financial bias and must never be substituted for the documented review rules or score.

The planned report helps finance professionals and everyday investors understand a company. Use plain explanations while keeping useful figures, terms, and qualifications. The scoring rules are product choices that still need testing against reviewed examples.

## What counts as bias?

Financial bias is wording, selection, or presentation that hides important financial meaning or steers readers away from a balanced view of the evidence. It can affect understanding of performance, financial condition, costs, obligations, or risk, even when individual statements are accurate.

Review document features, not people's psychology. A finding does not prove dishonesty, fraud, or falsity. A score of 100 means no qualifying bias was detected in the reviewed material; it does not verify accuracy or completeness. This is a project definition, not a regulatory definition.

## Review rules

Review relevant text, tables, notes, definitions, and explanations before flagging an issue. Support may appear elsewhere in the filing. Compare available filings and reasonably comparable periods, accounting for changes in scope, policies, estimates, and stated explanations. Cite each filing and period used. A change alone proves neither bias nor risk.

| Check | Flag when |
| --- | --- |
| Unclear language | Vague or empty wording, unexplained assumptions, or missing background hides financially important meaning. Explain technical terms even when no penalty applies. |
| Selective presentation | Emphasis, loaded language, misleading comparisons, or unjustified certainty steers interpretation. Tone alone is insufficient; balance follows evidence, not equal praise and criticism. |
| Claims and comparisons | Claims lack a stated basis, figures conflict, or comparisons omit needed periods, benchmarks, populations, or metric definitions. Check scope differences before calling a contradiction. |
| Predictions and opinions | They contradict the document or are presented as guaranteed. Uncertainty or missing assumptions alone does not justify a penalty for a clearly labeled prediction or opinion. |
| Financial relationships | The document identifies ownership, pay, business ties, or other incentives. Explain these without penalizing their existence alone. Distinguish the author from the host or distributor. |

Figures, named sources, or reasoning can support a claim. An external citation counts as attributed support, not independent verification. Missing support does not prove a claim false: explain what is missing and why it matters. Flag only omissions shown within the reviewed documents; do not infer undisclosed facts or relationships.

Label each issue **supported finding** when the documents show the problem, or **potential concern** when its interpretation is uncertain. Explain that uncertainty. A missing basis can be a supported finding without proving falsity. Group repeated or related evidence of one problem into one finding across all reviewed filings.

## Bias score

Use one score for the reviewed filing set: **100 = least detected bias; 0 = most**. It describes those documents, not the entire company. Financial risk and filing changes do not affect it by themselves. Do not adjust for document length.

Rate each distinct issue on three equally weighted factors:

| Factor | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| Unclear language | Meaning clear | Slight ambiguity | Meaning substantially obscured | Essential meaning hidden or distorted |
| Steering | None | Mild emphasis | Substantial selective framing | Strongly misleading framing |
| Financial importance | No meaningful effect | Minor context | Important to understanding | Central to performance, condition, costs, obligations, or risk |

Financial importance measures the effect on understanding, not the topic's importance alone. Importance 0 means no penalty. Explaining a technical term or disclosing a relationship alone is not a scored issue.

```text
base penalty = 60 × (language + steering + importance) / 9
issue penalty = base penalty × evidence multiplier × repetition multiplier
total penalty = min(15, sum of importance-1 penalties)
                + sum of importance-2 and importance-3 penalties
bias score = max(0, 100 − total penalty), rounded to the nearest integer
```

- Evidence multiplier: **1** for a supported finding; **0.5** for a potential concern.
- Repetition multiplier: **1** normally; **1.25** only when repetition makes the problem materially more prominent. Explain the increase; do not charge separate full penalties for the same problem.
- Keep intermediate values unrounded; round the final score with halves upward.
- Potential concerns have no separate total cap and can reduce the score to 0. Show their uncertainty beside the score and each finding's contribution.

Examples: no qualifying findings → **100**; only minor issues at their combined cap → **85**; one supported issue rated 3/3/3 → **40**, or **25** with prominent repetition; one potential concern rated 3/3/3 → **70**.

**Withhold the score** for summary-only or incomplete reviews, including missing pages, unreadable scans, or tables that cannot be interpreted. Still summarize available material and flag issues it supports. Identify filings, periods, and coverage limits; missing analysis is not evidence of neutrality. A complete review of one filing may receive a score labeled as based on that filing alone.

## Report order

1. **What changed:** Start with the selected filing's picture of the company: business, revenue sources, segments, recent results, financial position, and major disclosed uncertainties. Then compare a prior filing for the same company. Identify both filings and periods. Show meaningful changes in figures, segment results, risks, policies, estimates, and management explanations. Link to evidence in both filings where possible. Separate reported facts, calculated values, and interpretation; preserve qualifications and identify missing information. A change alone does not establish its cause.
2. **Bias review:** Show findings, source passages, uncertainty, review limits, and one score only when eligible.
3. **Financial risk profile:** Show separate indicators for ability to meet payments (liquidity and obligations), debt and borrowing (leverage), cash flow, and exposure to interest rates, currencies, or other prices. Each needs a value, unit, period, definition or formula, and source passage/table. Mark missing data as unavailable. Ratios may differ across industries, periods, or accounting rules. Risk alone is not bias; do not combine indicators into another overall score.

Keep these sections in one report without requiring tab changes. The report is limited to the reviewed documents and is not investment advice or an investor suitability rating.

Preserve source layout, tables, and page references. Connect exact highlighted passages to explanations. Use explicit finding labels, not color alone. Keep original text in its source language; write summaries and explanations in the selected website language. Support English and German documents.

## Future collection

When full bias analysis is implemented, analyze new material during [hourly feed collection](ARCHITECTURE.md#feed-and-page-behavior) and publish results automatically. Retrieve full linked documents when available; otherwise apply the no-score rule. The selected-filing sentiment worker does not perform this review or alter its rules or research basis.

## Sentiment model boundary

The selected-filing worker classifies extracted passages as positive, negative, or neutral with local CPU inference. English passages use ProsusAI FinBERT. German passages are translated locally to English before classification; the original passage remains the source text, and the translation is recorded as model input provenance. These outputs are sentiment only: they do not identify bias, support claims, establish document completeness, or affect score eligibility. FinBERT weights are licensed CC BY-NC-SA 4.0 for non-commercial use only. German sentiment quality must be evaluated on reviewed financial-document examples before being described as reliable. Unreadable, inaccessible, unsupported, or incomplete documents are unavailable and cannot be represented as fully analyzed.

## Research basis

These sources inform the rules; they are not outside evidence for judging individual filings:

- [IFRS Conceptual Framework](https://www.ifrs.org/issued-standards/list-of-standards/conceptual-framework/): neutrality, paragraph 2.15. Full standard access may require a subscription.
- [CFA: misrepresentation](https://www.cfainstitute.org/standards/professionals/code-ethics-standards/standards-of-practice-i-c) and [conflicts of interest](https://www.cfainstitute.org/standards/professionals/code-ethics-standards/standards-of-practice-vi-a).
- [SEC: management discussion and analysis](https://www.sec.gov/rules-regulations/2003/12/commission-guidance-regarding-managements-discussion-analysis-financial-condition-results-operations).
- [CFA: behavioral biases](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/the-behavioral-biases-of-individuals): background only; the app does not diagnose people.
- [IFRS 7](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-7-financial-instruments-disclosures/): financial risk disclosure categories.
