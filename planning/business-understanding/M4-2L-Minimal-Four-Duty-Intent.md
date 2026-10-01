# M4-2L — Minimal Four-Duty Intent

## Scope

- Start commit: `3561b3116b0d0f109195262411468bd0b107b8b8`
- Branch: `ai-native/m3-optimization-v1`
- Prototype only: `scripts/ai-experiments/business-policy-intent/`
- Production Runtime, Judge, Main Agent, capability broker, ontology, business
  APIs, cost engine, schema, published policy, and deployment were unchanged.

## Final Intent scope

The three experimental calls remain isolated and parallel:

```text
User wording ──┬──> Business Agent ──> Business Memo
               ├──> Minimal Intent Agent ──> Intent Memo
               └──> Policy Agent ──> Policy Memo
```

Business and Policy retain current wording plus bounded recent User wording and
their respective source documents. Minimal Intent receives **only the current
User message**. It receives no recent wording, Memo, Business Model, Domain
Policy, ontology, formal fact, tool, API, or database context.

Intent now records exactly four things:

1. Mentions in the current message.
2. Explicit changes in the current message.
3. Explicitly requested information.
4. Explicit save or do-not-save wording.

Clarification decisions, language-completeness judgments, and reference
resolution were removed. A literal `刚才那个线圈` remains literal; `贵多少` is
recorded as having no explicit object without recommending a follow-up.

## Evaluator R8

R8 removes clarification and antecedent-recovery scoring. It evaluates mention,
change, information-request, and explicit-persistence preservation, plus
unsupported inference and Intent-scope leakage. Marked evidence must come from
the current User message only. It treats a stated mention as insufficient when
the same memo declares `明确变化：无` for a case with explicit changes.

This final deterministic correction was applied only to frozen raw memos. No
Prompt, case, or model call changed after the 33-run smoke began.

## Formal DeepSeek smoke (frozen)

- Provider/model: DeepSeek / `deepseek-chat`
- Policy source: `BOOTSTRAP_PLUS_CANDIDATE`
- 20 base cases plus 13 required repeats: 33 runs
- 99 independent model calls; tools, database, and ontology: 0
- Raw evidence: `M4-2L-Smoke-Results-2026-10-01.json`
- Median timing: Business 2892.5 ms; Intent 1007.1 ms; Policy 1943.9 ms;
  parallel total 2895.4 ms.

| Population | PASS | PARTIAL | FAIL |
| --- | ---: | ---: | ---: |
| Base 20 | 15 | 0 | 5 |
| All 33 | 26 | 0 | 7 |

Business and Policy passed 33/33. Intent had no scope leak, unsupported source
inference, format failure, or formal-fact/API/Tool leakage. Its seven confirmed
failures are six `EXPLICIT_CHANGE_OMITTED` results and one
`EXPLICIT_MENTION_OMITTED` result.

| Case/run | Finding |
| --- | --- |
| CASE-06 / 1 | Recorded cable and wood box only as mentions; stated `明确变化：无`. |
| CASE-08 / 1 | Recorded electrophoresis only as a mention; stated no explicit change. |
| CASE-09 / 1 | Recorded float only as a mention; stated no explicit change. |
| CASE-19 / 1 | Recorded `贵多少` but did not record that no object was explicitly mentioned. |
| CASE-20 / 1 | Recorded `这个` and wood box but stated no explicit change. |
| CASE-05 / 2 | Recorded stainless shaft only as a mention; stated no explicit change. |
| CASE-06 / 2 | Repeated the missing-change failure. |

## Stability

| Case | Result |
| --- | --- |
| CASE-02 | STABLE — passed twice. |
| CASE-03 | STABLE — passed twice. |
| CASE-04 | STABLE — passed twice. |
| CASE-05 | VARIANT — base pass; repeat omitted explicit change. |
| CASE-06 | STABLE — omitted explicit changes twice. |
| CASE-07 | STABLE — passed twice. |
| CASE-12 | STABLE — passed twice. |
| CASE-13 | STABLE — passed twice. |
| CASE-14 | STABLE — passed twice. |
| CASE-15 | STABLE — literal reference retained twice with no recovery. |
| CASE-16 | STABLE — incomplete change wording retained twice without a clarification decision. |
| CASE-19 | VARIANT — base omitted absent-object mention; repeat passed. |
| CASE-20 | VARIANT — base omitted explicit change; repeat passed. |

## Decision

Removing clarification and reference resolution eliminated the prior failure
family completely. The remaining problem is more fundamental: despite a
four-duty-only prompt and current-message-only context, the model sometimes
fails to assign an explicit user change to the `明确变化` duty. This is an
`INTENT_MODEL_BEHAVIOR_LIMIT`. Do not connect this prototype to production or
continue prompt patching under this ticket. Wait for Supervisor direction on a
different extraction mechanism, model, or further reduction of Intent duties.
