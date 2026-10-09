# Financial bias: definition and analysis scope

This document records the team’s agreed scope for the future analysis model. It does not describe an implemented capability. The scoring constants are product choices requiring calibration against reviewed examples, not a validated statistical measure.

## Definition

Financial bias is a tendency in the selection, presentation, or explanation of financial information that obscures financially relevant meaning or steers interpretation away from a balanced assessment of the evidence provided. In this project, it includes vague or empty wording, unexplained assumptions or background knowledge, selective emphasis, unsupported factual claims, unexplained comparisons, contradictions, and unjustified certainty when these affect understanding of performance, financial condition, costs, obligations, or risk. Individual statements can be accurate while their presentation is biased. Documented financial relationships provide context about possible incentives, but do not establish biased treatment by themselves. The app evaluates observable features of documents; it does not diagnose an author’s or reader’s psychological biases. A finding identifies a supported problem or potential concern, rather than establishing dishonesty, fraud, or factual falsity. A score of 100 means no qualifying bias was detected in the reviewed document, not that its accuracy or completeness was independently verified.

The definition synthesizes [IFRS neutrality guidance, paragraph 2.15](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/conceptual-framework-for-financial-reporting.pdf?bypass=on), [CFA guidance on misrepresentation](https://www.cfainstitute.org/standards/professionals/code-ethics-standards/standards-of-practice-i-c), and [SEC guidance on balanced management discussion](https://www.sec.gov/rules-regulations/2003/12/commission-guidance-regarding-managements-discussion-analysis-financial-condition-results-operations). This is a project definition, not a regulatory definition.

## Audience and evidence boundary

Serve finance professionals and people investing in their free time. Explain language for someone with no finance background while preserving the figures, terminology, qualifications, and detail useful to professionals.

Use only evidence within the reviewed document. Check relevant passages, tables, notes, definitions, and explanations across the document before flagging a problem. Research sources in this file justify the analysis rules; they are not external evidence used to assess individual documents.

- A factual claim has support when relevant figures, identifiable attribution, or reasoning connect evidence to the claim. Support may appear elsewhere in the document.
- Recognize an external citation as attributed support; do not imply its contents were retrieved or verified. Distinguish attribution from independent corroboration.
- A reported revenue figure may be supported by the document’s financial table. An unsupported assertion such as “industry leader” needs a stated basis; repeating it does not supply evidence.
- Missing support does not establish that a claim is false. Identify the specific missing basis and why it matters.
- Flag omissions demonstrable within the document: missing support for claims, unexplained comparisons, or unresolved contradictions. Do not infer undisclosed facts or relationships from outside information.

## Detection rules

- **Obscuring language:** Explain technical terms even when no penalty applies. Penalize vague wording, empty statements, or reliance on unexplained background knowledge only when financially relevant meaning is obscured. Check whether nearby text or another section supplies the explanation.
- **Steering:** Assess selective emphasis, loaded wording, misleading comparisons, and uncertainty presented as certainty. Positive or negative tone alone does not qualify. Balance follows the evidence, not an equal count of favorable and unfavorable statements.
- **Claims and comparisons:** Identify absent support, inconsistent figures or statements, and comparisons lacking the basis needed to interpret them, such as period, benchmark, population, or metric definition. Account for differences in scope before calling statements contradictory.
- **Forecasts and opinions:** Do not penalize clearly labeled predictions or opinions solely because they are uncertain or lack supporting assumptions. They can still qualify when contradicted by the document or presented as guaranteed outcomes.
- **Relationships:** Flag only documented ownership, compensation, commercial relationships, or other relevant incentives. Explain the relationship without a score penalty for its existence alone. Distinguish a document’s author from the institution hosting or distributing it. This follows [CFA’s conflict-of-interest guidance](https://www.cfainstitute.org/standards/professionals/code-ethics-standards/standards-of-practice-vi-a).
- **Behavioral scope:** Avoid assigning psychological traits or person-dependent behavioral biases to readers or authors. Address observable framing under steering. [CFA’s behavioral-bias framework](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/the-behavioral-biases-of-individuals) supplies background, not a diagnostic capability.

Label each qualifying finding **supported finding** when the document supplies a demonstrable basis, or **potential concern** when the interpretation remains ambiguous. Explain the uncertainty. Unsupported claims can be supported findings of missing substantiation without being findings of falsity.

## Overall score

Use one overall score: 100 means least detected bias; 0 means most. No document-length adjustment applies. Rate each distinct qualifying issue on three equally weighted factors:

| Factor | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| Problematic language | No obscuring wording | Slight ambiguity | Meaning substantially obscured | Essential meaning concealed or distorted |
| Steering interpretation | No directional framing | Mild emphasis | Substantial selective framing | Strongly misleading framing |
| Financial importance | No meaningful financial effect | Minor context | Important to understanding | Central to performance, condition, costs, obligations, or risk |

Financial importance concerns the issue’s effect on understanding, not the importance of its topic alone. An explanation-only technical term or relationship disclosure is not a qualifying issue. Issues with importance 0 receive no penalty.

For each qualifying issue:

```text
base penalty = 60 × (language + steering + importance) / 9
issue penalty = base penalty × evidence multiplier × repetition multiplier

total penalty = min(15, sum of minor issue penalties)
                + sum of other issue penalties
overall score = round(max(0, 100 − total penalty))
```

- Evidence multiplier: 1 for supported findings; 0.5 for potential concerns.
- Repetition multiplier: 1 normally; 1.25 when repetition materially increases prominence. Explain why the increase applies.
- Minor issues have financial importance 1. Other scored issues have importance 2 or 3.
- Group duplicates and related manifestations of one underlying problem into one finding, with multiple passage references. Do not apply several full penalties to the same problem.
- Keep intermediate values unrounded; round only the final score, with halves rounded upward.
- Potential concerns have no separate combined cap: several may reduce the score to 0. Make their uncertainty visible beside the score.

| Calibration example | Score |
| --- | --- |
| Complete review with no qualifying findings | 100 |
| Only minor issues, after their combined cap is reached | 85 |
| One supported issue rated 3 on all factors | 40 |
| The same issue with materially prominent repetition | 25 |
| One potential concern rated 3 on all factors | 70 |

Withhold the score for summary-only reviews and incomplete full-document reviews, including missing pages, unreadable scans, or uninterpretable tables. Still summarize available material and flag supported problems and potential concerns within it. State the coverage limits; do not treat missing analysis as evidence of neutrality.

## Reading flow and future collection

1. Provide a plain-English summary: what happened, important figures or claims, why it matters, and risks or uncertainties stated in the source. Preserve qualifications and distinguish attributed claims from established facts.
2. Show the overall score when eligible, the review’s limits, and what readers should look out for. Explain each finding and its contribution to the score.
3. Preserve the original document’s layout, tables, and page references. Highlight exact sections and connect them to side-panel explanations. Distinguish supported findings from potential concerns using explicit labels, not color alone.

Keep original text in its source language. Summaries and explanations follow the selected website language. Cover both English and German source documents.

The existing [collector](../src/rss.js) has eight feeds from SEC, BaFin, and ECB and currently stores feed metadata and excerpts. Once retrieval and the model are built, analyze new content on hourly pulls and publish results automatically. Retrieve full linked documents when available; otherwise use available summaries with the no-score rule above. The hourly process applies this definition; it does not automatically rewrite the definition or refresh its research basis. No model, retrieval, scoring, or annotated viewer is implemented by this document.
