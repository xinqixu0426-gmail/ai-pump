# M4-2H — Evidence-First Lightweight Intent Clerk

## Scope

This is an isolated experiment.  It does not import or alter the production runtime, Ontology, database, tools, business APIs, cost engine, or published policy.

```text
Raw user wording + recent user wording
       ├── Business Model Agent (Company Business Model V1 only)
       └── Domain Policy Agent (policy source only)
                              ↓
              Business Memo + Policy Memo + raw wording
                              ↓
                 Evidence-First Intent Clerk
                              ↓
                  Natural-language Intent Memo
```

Business and Policy calls run in parallel.  The Intent Clerk runs only after both have completed.  Ontology is not used, has zero LLM calls, and no production entrypoint imports this prototype.

## Evidence-first boundary

The Clerk is instructed to treat current user wording and explicitly supplied recent user wording as the only evidence for recorded Owner facts.  Business and Policy memos may help interpret a term silently, but cannot supply a source value, object, persistence signal, formal fact, candidate, or future action.

The Memo remains natural language.  There is no JSON contract, `JSON.parse`, schema decoder, enum validator, or fixed heading/order requirement.  The prompt asks for a short quoted source excerpt for each recorded item.

## Evaluator R4

R4 validates the natural-language memo without requiring a fixed phrase or format:

1. Deterministic checks reject implementation/ID leaks, marked evidence not present in the user context, invented source values/referents, omitted explicit changes or requested information, persistence reversals, grounding discussion, and wrong language-level clarification.
2. Natural-language cases that cannot be safely determined are `REVIEW_REQUIRED`, not an automatic failure.

The grounding detector covers explicit architecture leakage terms only: for example formal identity, canonical/candidate, identity/entity resolution, binding, grounding, or a concrete formal-scheme discussion.  It is not a generic keyword router.

## Frozen first smoke

The first and only formal run is preserved at [M4-2H-Smoke-Results-2026-10-01.json](M4-2H-Smoke-Results-2026-10-01.json).

- Provider/model: DeepSeek / `deepseek-chat`
- Cases: BP-01 to BP-16 plus ADV-01 to ADV-04
- Stability repeats: BP-02, BP-03, BP-04, BP-05, BP-06, BP-07, BP-14, BP-15, ADV-04
- Runs: 29
- Model calls: 87
- Database/tool access: none
- Ontology use/LLM calls: no / 0

The original JSON preserves raw Business Memos, Policy Memos, Intent Memos, timestamps, and initial automatic scores.  After the run, two R4 static-detector false positives were corrected (negative Chinese clarification wording and persistence wording adjacent to an unrelated omitted source).  No Agent prompt changed and no model call was repeated.  Re-evaluating the same raw Memos gives the final result below.

| Result | Runs |
| --- | ---: |
| PASS | 15 |
| PARTIAL / REVIEW_REQUIRED | 0 |
| FAIL | 14 |

Business Agent failures: 0.  Policy Agent failures: 0.  Intent JSON/format failures: 0.  Context leaks: 0.

## Confirmed Intent failures

The Evidence-First prompt substantially improved source-value handling in the initial BP-07 and ADV-04 runs, but the Clerk is not reliably compliant:

- **BP-01:** adds formal-identity/clarification discussion to a concept question.
- **BP-06:** asks for identity/packing clarification despite an explicit save request whose language meaning is complete.
- **BP-07:** first run asks persistence clarification; repeat explicitly mentions the unspoken paper-box source even while saying not to infer it.
- **BP-08, BP-12, BP-13, ADV-01, ADV-02:** turns clear business-language questions into unnecessary clarification.
- **BP-14:** one run includes a grounding-boundary statement.
- **BP-15:** fails to respect the provided recent-user reference and instead asks for future identity clarification.
- **ADV-04:** first run correctly preserves unknown `这个`; repeated run still invents a current/source packaging state.

Detected counts: `GROUNDING_LEAK=2`; unsupported source/referent inference=2; clarification-boundary breaches=11.

## Stability

| Case | Result |
| --- | --- |
| BP-02 | STABLE (PASS/PASS) |
| BP-03 | STABLE (PASS/PASS) |
| BP-04 | STABLE (PASS/PASS) |
| BP-05 | STABLE (PASS/PASS) |
| BP-06 | STABLE (FAIL/FAIL) |
| BP-07 | VARIANT (both fail; second invents source value) |
| BP-14 | VARIANT (grounding leak/PASS) |
| BP-15 | VARIANT (both fail; reference handling differs) |
| ADV-04 | VARIANT (PASS/unsupported referent inference) |

Timing medians (milliseconds): Business 2866.80; Policy 1778.07; parallel context 2866.80; Intent 1362.09; total 4335.73.

## Integration decision

Do not integrate the Prototype into production runtime.  The exact evidence record eliminates the JSON-format failure from M4-2F/G, but misses the required zero-failure standard: BP-07 and ADV-04 do not pass both stability runs, and Intent still crosses the clarification/grounding boundary in other cases.  Per the experiment rule, no post-smoke prompt adjustment or model rerun occurred.
