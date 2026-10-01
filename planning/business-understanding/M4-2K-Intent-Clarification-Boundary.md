# M4-2K — Intent Clarification Boundary + Evaluator R7

## Scope and boundary

- Start commit: `aa5932531b36767b6f9d1d57aca028906b1c50d9`
- Branch: `ai-native/m3-optimization-v1`
- Prototype only: `scripts/ai-experiments/business-policy-intent/`
- Production Runtime, Judge, Main Agent, capability broker, ontology, business
  APIs, cost engine, schema, published policy, and deployment were unchanged.

The architecture remains fully isolated and parallel:

```text
User wording ──┬──> Business Agent ──> Business Memo
               ├──> Intent Agent ────> Intent Memo
               └──> Policy Agent ────> Policy Memo
```

Intent receives only current User wording and bounded recent User wording. It
does not receive either Memo, the Business Model, Domain Policy, ontology, a
database, tools, APIs, or formal identities.

## Root cause and frozen boundary

The prior failure mixed two different questions: whether the Owner's language
is complete and whether a later system can ground or execute the request. The
Intent Clerk is now instructed that unknown formal identity, current state,
configuration, baseline, candidate count, template ID, formal Part, or future
system capability is never a language gap.

Only these language gaps may request clarification:

1. A deictic referent has no recoverable antecedent in current or bounded
   recent User wording.
2. A requested change omits what must change or what it changes to.

The 20-case oracle is frozen in `run-smoke.cjs` rather than inferred by the
evaluator: 17 cases are `NO_CLARIFICATION`; only CASE-16
(`CHANGE_DETAILS_MISSING`), CASE-19 (`TARGET_REFERENT_MISSING`), and CASE-20
(`DEICTIC_REFERENT_MISSING`) require clarification.

## Evaluator R7

R7 evaluates the frozen oracle, not current capability. It accepts equivalent
natural-language expressions such as “无需澄清”, “没有语言缺口”, and “用户表达
已经完整”. It rejects clarification caused by formal identity, candidates,
current configuration, float details, or a comparison baseline. It also
accepts the required missing-target and missing-referent explanations.

The initial R7 pass exposed eight evaluator false positives caused by Markdown
markers and negative clarification wording. R7 was repaired and applied only
to the already frozen raw memos; no case, prompt, or provider run was changed
or repeated. The final R7 deterministic tests pass. There are no remaining
R7 same-input/same-memo inconsistent outcomes.

## Formal DeepSeek smoke (frozen)

- Provider/model: DeepSeek / `deepseek-chat`
- Policy source: `BOOTSTRAP_PLUS_CANDIDATE`
- 20 base cases plus 11 required repeats: 31 runs
- 93 independent model calls; tools, database, and ontology: 0
- Raw evidence: `M4-2K-Smoke-Results-2026-10-01.json`
- Median timing: Business 2725.5 ms; Intent 1296.5 ms; Policy 1920.2 ms;
  parallel total 2725.5 ms.

| Population | PASS | PARTIAL | FAIL |
| --- | ---: | ---: | ---: |
| Base 20 | 16 | 0 | 4 |
| All 31 | 24 | 0 | 7 |

Business and Policy each passed 31/31. Intent passed 24/31. Confirmed Intent
failures were four clarification-boundary breaches, three grounding-language
leaks, and one information omission (the last occurs in the same CASE-15
repeat as a clarification breach).

| Case/run | Result | Confirmed finding |
| --- | --- | --- |
| CASE-01 / 1 | FAIL | Treated explicit `12-120` as an unresolved deictic referent. |
| CASE-02 / 1 | FAIL | Mentioned “正式身份” while correctly recording no language gap. |
| CASE-06 / 1 | FAIL | Treated the explicit `木箱` configuration as incomplete. |
| CASE-15 / 1 | FAIL | Rejected recoverable recent wording `12-120` as an antecedent. |
| CASE-02 / 2 | FAIL | Repeated formal-identity wording. |
| CASE-05 / 2 | FAIL | Repeated formal-identity wording despite a complete request. |
| CASE-15 / 2 | FAIL | Repeated the missing-reference error and omitted the cost request. |

The two required-clarification cases CASE-19 and CASE-20 passed in both runs.
CASE-16 passed. The base run also passed the frozen no-clarification examples
for CASE-02, CASE-05, CASE-09, CASE-12, CASE-13, and CASE-17 except where a
separate grounding-language leak is listed above.

## Stability

| Case | Result |
| --- | --- |
| CASE-02 | STABLE — both runs leaked formal-identity language. |
| CASE-03 | STABLE — passed twice. |
| CASE-05 | VARIANT — pass then grounding-language leak. |
| CASE-06 | VARIANT — boundary failure then pass. |
| CASE-09 | STABLE — passed twice. |
| CASE-12 | STABLE — passed twice. |
| CASE-13 | STABLE — passed twice. |
| CASE-15 | VARIANT — both failed; repeat also omitted requested information. |
| CASE-17 | STABLE — passed twice. |
| CASE-19 | STABLE — passed twice. |
| CASE-20 | STABLE — passed twice. |

## Decision

Evaluator inconsistency is closed, and the isolation invariant remains sound.
The prompt-level clarification repair is not sufficient: the first frozen
provider run still over-clarifies explicit terms and sometimes emits prohibited
grounding language. This is an `INTENT_MODEL_BEHAVIOR_LIMIT`, not a reason to
connect the prototype to production. Do not add another prompt patch or retry
the smoke under this ticket; wait for Supervisor direction on a different
extraction approach, model, or removal of Intent-level clarification judgment.
