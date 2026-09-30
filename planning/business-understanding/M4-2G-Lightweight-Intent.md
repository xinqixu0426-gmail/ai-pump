# M4-2G — Lightweight Intent Memo + Policy Boundary + Evaluator R3

## Scope and decision

This is an isolated experiment, not a Native Runtime integration.  It retains the independently scoped Business Model Agent and Domain Policy Agent, starts them in parallel, and invokes the Intent Agent only after both memos are available.

```text
Raw user wording + recent user wording
       ├── Business Model Agent (Company Business Model V1 only)
       └── Domain Policy Agent (bootstrap policy + cost-driver candidate only)
                              ↓
              Business Memo + Policy Memo + raw wording
                              ↓
                  Lightweight Intent Agent
                              ↓
                  Natural-language Intent Memo
```

The Intent Agent has no JSON schema, decoder, enum, ontology access, database access, tools, planner, or production import.  It writes only a short natural-language memo about the mentioned object, explicit change, requested information, explicit persistence signal, and language-level clarification need.

## Context boundaries

| Agent | May read | Must not read |
| --- | --- | --- |
| Business Model | raw wording, recent wording, Company Business Model V1 | policy, ontology, database, tools, current facts |
| Domain Policy | raw wording, recent wording, policy source | business model, ontology, database, tools, current facts |
| Intent | raw wording, recent wording, the two memos | either raw source document, ontology, database, tools, formal facts |

The smoke source was `BOOTSTRAP_PLUS_CANDIDATE`: the bootstrap domain policy plus the reviewed configurable-cost-driver candidate.  It was not a published-policy mutation.

## Policy boundary

The Policy Agent prompt expressly forbids implementation wording in its memo, including routes, HTTP methods, API/tool names, executor, database, SQL, and `internalApiClient`.  R3 tests that boundary as a safety property rather than making it a formatting convention.

## Evaluator R3

R3 deliberately does not parse Intent JSON or require headings, order, enums, or exact wording.  It has two layers:

1. Deterministic safety checks: implementation/ID leakage, invented source values or referents, omitted explicit changes/information, and reversed explicit save/no-save signals.
2. Tolerant semantic review: prose whose semantic equivalence cannot be established mechanically is `REVIEW_REQUIRED`, not an automatic model failure.

The raw, first-run evidence is frozen at [M4-2G-Smoke-Results-2026-10-01.json](M4-2G-Smoke-Results-2026-10-01.json).  It contains all three raw memos and timing for every call.  The original embedded evaluation was generated before the final R3 evaluator correction; the evidence has not been rewritten or the model rerun.  The following final R3 reassessment re-evaluated those same raw memos only.

## First-run smoke evidence

- Provider/model: DeepSeek / `deepseek-chat`
- Core cases: BP-01 through BP-16 (16)
- Adversarial cases: ADV-01 through ADV-04 (4)
- Stability repeats: BP-02, BP-03, BP-04, BP-05, BP-06, BP-07, BP-14, BP-15, ADV-04 (9)
- End-to-end runs: 29
- Model calls: 87 (three per run)
- Ontology used: no; ontology LLM calls: 0
- Database accessed: no; tools exposed: 0
- Production imports from prototype: 0

Timing medians (milliseconds): Business 3015.45; Policy 2091.21; parallel Business/Policy context 3017.89; Intent 2131.31; total 5244.40.

### Final R3 reassessment of the frozen memo set

| Outcome | Runs | Meaning |
| --- | ---: | --- |
| PASS | 11 | all deterministic requirements met without a semantic review flag |
| PARTIAL / REVIEW_REQUIRED | 14 | no deterministic breach, but prose needs Supervisor semantic review |
| FAIL | 4 | deterministic unsupported inference |

There were zero Business Agent failures, zero Policy Agent implementation-language/ID leaks, zero JSON-format failures, and zero context leaks.

The four deterministic failing runs are two repeatable failure families:

1. **BP-07, twice:** for `V750包装改木箱。`, Intent invented a source packaging value (`纸箱`).  The Owner did not specify a source value.
2. **ADV-04, twice:** for `这个换木箱多少钱？` without a referent, Intent invented a specific business object and/or source packaging.  It should retain the wood-box cost request and request the missing referent.

The 14 `REVIEW_REQUIRED` records contain no automatic failure.  They commonly add future identity/candidate discussion or request implementation-stage clarification where the task requires the Intent layer to preserve a clear language request without deciding grounding.  This is evidence for Supervisor review, not a prompt-repair trigger in this stage.

### Stability

| Case | Result |
| --- | --- |
| BP-02 | VARIANT (both require review) |
| BP-03 | STABLE (PASS/PASS) |
| BP-04 | VARIANT (both require review) |
| BP-05 | VARIANT (PASS/review) |
| BP-06 | VARIANT (PASS/review) |
| BP-07 | STABLE (deterministic unsupported-source failure both times) |
| BP-14 | VARIANT (review/PASS) |
| BP-15 | VARIANT (both require review) |
| ADV-04 | STABLE (deterministic unsupported-referent failure both times) |

## Runtime integration decision

Do **not** integrate this prototype.  Lightweight natural-language memos eliminate the M4-2F JSON decode failure, but the first formal smoke still shows deterministic invented context in BP-07 and ADV-04, plus a meaningful set of grounding-boundary review cases.  Per the experiment rule, no prompt adjustment or model rerun was made after observing these results.
