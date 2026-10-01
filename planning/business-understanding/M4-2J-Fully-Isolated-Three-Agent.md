# M4-2J — Fully Isolated Business / Intent / Policy Agents

## Scope

- Start commit: `180d41123614a29010ec40318e1054e5a3c1aadd`
- Branch: `ai-native/m3-optimization-v1`
- Prototype only: `scripts/ai-experiments/business-policy-intent/`
- No production Runtime import, ontology, business tool, database, business API,
  cost-engine, schema, or deployment change.

## Architecture and context matrix

```text
                    ┌──> Business Agent ──> Business Memo
User wording ───────┼──> Intent Agent ────> Intent Memo
                    └──> Policy Agent ────> Policy Memo
```

All three calls begin with `Promise.all`. No memo is passed to another Agent.

| Agent | Input | Excluded |
| --- | --- | --- |
| Business | Current wording, bounded recent user wording, Company Business Model V1 | Domain Policy, all Memos, ontology, formal facts, tools, database, IDs |
| Intent | Current wording and bounded recent user wording only | Business Model, Domain Policy, all Memos, ontology, formal facts, tools, database, IDs |
| Policy | Current wording, bounded recent user wording, bootstrap policy plus candidate | Business Model, all Memos, ontology, formal facts, tools, database, IDs |

The policy source was `BOOTSTRAP_PLUS_CANDIDATE`; no published-policy store was
read by this experiment.

## Evaluator R6

R6 remains natural-language tolerant. It separately scores Business knowledge,
literal Intent recording, and Policy interpretation. It uses deterministic
checks for unsupported source values, IDs, implementation language, grounding
discussion, persistence reversal, and missing explicit information. Natural
wording that cannot safely be classified remains `REVIEW_REQUIRED`.

The first provider run is frozen in `M4-2J-Smoke-Results-2026-10-01.json`.
R6 was then corrected only for generic evaluator defects (scope exclusions are
not implementation use; a clarification section and its continuation are read
together). The correction was applied to the frozen raw memos; no prompt or
case changed and no second provider run occurred.

## Formal DeepSeek smoke

- Provider/model: DeepSeek / `deepseek-chat`
- 20 base cases + 11 required repeats = 31 runs
- 93 independent model calls
- Tools exposed: 0; database accessed: no
- Ontology LLM/resolver calls: 0 / 0
- Median timing: Business 3095 ms; Intent 1485 ms; Policy 2012 ms;
  parallel total 3095 ms.

| Population | PASS | PARTIAL | FAIL |
| --- | ---: | ---: | ---: |
| Base 20 | 13 | 1 | 6 |
| All 31 | 18 | 2 | 11 |

Business Agent passed 31/31 and Policy Agent passed 31/31. Intent had 11
confirmed clarification-boundary failures across all runs. There was no
Business-to-Intent or Policy-to-Intent leakage by code path or output, no
Intent grounding leak, no unsupported source-value inference, and no formal
fact or API/Tool leakage.

### Base cases

| Case | Business | Intent | Policy | Overall | Finding |
| --- | --- | --- | --- | --- | --- |
| 01 | PASS | PARTIAL | PASS | PARTIAL | Pure explanation memo was semantically correct; persistence phrasing needed review. |
| 02 | PASS | FAIL | PASS | FAIL | Intent still requested identity clarification. |
| 03 | PASS | PASS | PASS | PASS | Full packaging change and cost request retained. |
| 04 | PASS | PASS | PASS | PASS | No invented paper-box source. |
| 05 | PASS | FAIL | PASS | FAIL | Intent asked for an unnecessary comparison baseline. |
| 06 | PASS | PASS | PASS | PASS | Multi-change and explicit do-not-save retained. |
| 07 | PASS | PASS | PASS | PASS | Explicit save retained without execution. |
| 08 | PASS | PASS | PASS | PASS | Literal electrophoresis request retained. |
| 09 | PASS | FAIL | PASS | FAIL | Intent introduced an unnecessary clarification. |
| 10 | PASS | PASS | PASS | PASS | Coil-sheet change and price question retained. |
| 11 | PASS | PASS | PASS | PASS | Barrel-length delta retained. |
| 12 | PASS | PASS | PASS | PASS | Concept comparison retained. |
| 13 | PASS | FAIL | PASS | FAIL | Intent unnecessarily asked to identify the named template. |
| 14 | PASS | PASS | PASS | PASS | Both cost and configured-coil goals retained. |
| 15 | PASS | PASS | PASS | PASS | Recent wording recovered only as language reference. |
| 16 | PASS | PASS | PASS | PASS | Correctly identified missing change details. |
| 17 | PASS | FAIL | PASS | FAIL | Asked for clarification on a complete scheme-count question. |
| 18 | PASS | PASS | PASS | PASS | Fixed-product question retained. |
| 19 | PASS | FAIL | PASS | FAIL | Did not reliably request the missing referent. |
| 20 | PASS | PASS | PASS | PASS | Unknown referent retained without a guessed object. |

### Repeated-case stability

| Case | Result |
| --- | --- |
| CASE-02 | VARIANT — fail then pass |
| CASE-03 | STABLE — pass twice |
| CASE-04 | STABLE — pass twice |
| CASE-05 | STABLE — inappropriate clarification twice |
| CASE-06 | VARIANT — pass then fail |
| CASE-07 | STABLE — pass twice |
| CASE-12 | VARIANT — pass then fail |
| CASE-13 | STABLE — inappropriate clarification twice |
| CASE-14 | VARIANT — pass then review-required |
| CASE-15 | VARIANT — pass then fail |
| CASE-20 | STABLE — pass twice |

## Decision

Full input isolation solved the architectural contamination problem: Intent no
longer receives Business or Policy material, and the previously observed
grounding/policy leakage is absent. It did **not** satisfy the reliability
criterion. The remaining failure family is intrinsic to the current literal
Intent prompt: it sometimes treats business completeness or a missing formal
baseline as a missing linguistic element. This prototype must not be connected
to Native Runtime until that boundary is redesigned under Supervisor direction.
