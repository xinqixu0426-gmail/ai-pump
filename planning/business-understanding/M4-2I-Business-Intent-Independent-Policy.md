# M4-2I — Business→Intent + Independent Policy Isolation

## Scope and freeze

- Start commit: `7e26050181f3e4fa95f2e8d47e77e311dee95d14`
- Branch: `ai-native/m3-optimization-v1`
- Runtime integration: none. This is an isolated prototype under
  `scripts/ai-experiments/business-policy-intent/`.
- Ontology, formal tools, database access, business APIs, cost engine, and
  production routes are not used.

The first real-provider smoke execution is frozen in
`M4-2I-Smoke-Results-2026-10-01.json`. No Agent prompt or case was changed
after that execution. Evaluator R5 was corrected and applied again to the
frozen raw memos only; this reassessment made no provider call.

## Data flow

```text
User Input ──┬──> Business Agent ──> Business Memo ──> Intent Agent ──> Intent Memo
             │
             └──> Policy Agent ──────────────────────────────────────> Policy Memo
```

Business and Policy start in parallel. Intent begins as soon as Business Memo
is available and receives neither Policy Memo nor Domain Policy. The prototype
returns the three memos without a Planner or final decision.

| Agent | Allowed input | Explicitly excluded |
| --- | --- | --- |
| Business | Current user wording, bounded recent user wording, Company Business Model V1 | Domain Policy, Policy Memo, ontology, database, tools, formal facts and IDs |
| Intent | Current user wording, bounded recent user wording, Business Memo | Policy Memo, Domain Policy, raw Business Model, ontology, database, tools, formal facts and IDs |
| Policy | Current user wording, bounded recent user wording, bootstrap policy plus approved candidate | Company Business Model, ontology, database, tools, formal facts and IDs |

The policy source was `BOOTSTRAP_PLUS_CANDIDATE`; no published-policy store was
read in the experiment.

## Evaluator R5

R5 evaluates each memo independently. It checks deterministic safety
properties (implementation/ID leakage, unsupported user inference, evidence
provenance, explicit save signal reversal, and grounding/policy leakage) and
uses `REVIEW_REQUIRED` for genuinely indeterminate natural wording.

During review, two evaluator defects were found and fixed without changing any
model output:

1. A statement that the Business Model *does not define database facts* was
   incorrectly treated as a database-access leak. R5 now distinguishes a scope
   exclusion from an instruction to query a database.
2. The clarification detector treated phrases such as “没有表达” inside a
   positive clarification explanation as an answer of “no clarification.” It
   now evaluates the clarification section and its continuation instead.

The focused test suite locks both corrections. The frozen raw JSON preserves
the original provider evidence; the results below are R5 reassessment of that
same evidence.

## Real DeepSeek smoke

- Provider/model: DeepSeek / `deepseek-chat`
- Runs: 20 base cases + 10 specified repeats = 30
- Calls: 90 (Business, Policy, and Intent per run)
- Tools exposed: 0
- Database accessed: no
- Ontology LLM calls: 0
- Ontology resolver calls: 0
- Median timing: Business 2948 ms; Policy 1789 ms; Intent 1424 ms; total 4397 ms.

### Reassessed result totals

| Population | PASS | PARTIAL | FAIL |
| --- | ---: | ---: | ---: |
| 20 base cases | 11 | 0 | 9 |
| All 30 runs | 14 | 2 | 14 |

Business Agent: 30/30 PASS. Policy Agent: 30/30 PASS. Intent has 14 confirmed
clarification-boundary failures and one of those additionally has a grounding
leak. There were no detected Policy-to-Intent leaks, unsupported source-value
inferences, formal-fact hallucinations, or implementation/API/Tool leaks.

### Base-case results

| Case | Business | Intent | Policy | Overall | Finding |
| --- | --- | --- | --- | --- | --- |
| CASE-01 | PASS | PASS | PASS | PASS | Meaning of 12-120 retained. |
| CASE-02 | PASS | FAIL | PASS | FAIL | Intent asked for identity clarification although language is sufficient. |
| CASE-03 | PASS | PASS | PASS | PASS | Package change, cost difference, and unspecified save retained. |
| CASE-04 | PASS | PASS | PASS | PASS | No invented paper-box source. |
| CASE-05 | PASS | FAIL | PASS | FAIL | Intent added current-configuration clarification to a complete language request. |
| CASE-06 | PASS | PASS | PASS | PASS | Both changes and explicit do-not-save retained. |
| CASE-07 | PASS | PASS | PASS | PASS | Explicit save retained without execution. |
| CASE-08 | PASS | FAIL | PASS | FAIL | Intent treated a complete surface-treatment question as requiring clarification. |
| CASE-09 | PASS | FAIL | PASS | FAIL | Intent requested float/price detail not missing from the language goal. |
| CASE-10 | PASS | PASS | PASS | PASS | Coil-sheet change and cost request retained. |
| CASE-11 | PASS | FAIL | PASS | FAIL | Intent introduced a configuration-identity clarification. |
| CASE-12 | PASS | FAIL | PASS | FAIL | Intent introduced avoidable clarification for a concept comparison. |
| CASE-13 | PASS | FAIL | PASS | FAIL | Intent over-escalated a named template request. |
| CASE-14 | PASS | PASS | PASS | PASS | Both cost and configured-coil goals retained. |
| CASE-15 | PASS | FAIL | PASS | FAIL | One output discussed formal-scheme identity and requested grounding clarification. |
| CASE-16 | PASS | PASS | PASS | PASS | Correctly requested missing change details. |
| CASE-17 | PASS | FAIL | PASS | FAIL | Intent treated the question about two schemes as semantically incomplete. |
| CASE-18 | PASS | PASS | PASS | PASS | OEM/non-fixed-product question retained. |
| CASE-19 | PASS | PASS | PASS | PASS | Missing referent was retained as a language clarification. |
| CASE-20 | PASS | PASS | PASS | PASS | Unknown “this” was preserved without guessing an object. |

### Stability of repeated cases

| Case | Stability | Evidence |
| --- | --- | --- |
| CASE-02 | STABLE | Both runs incorrectly requested identity clarification. |
| CASE-03 | VARIANT | First pass; repeat added clarification. |
| CASE-04 | STABLE | Both retained only the wood-box target. |
| CASE-05 | STABLE | Both added inappropriate clarification. |
| CASE-06 | VARIANT | First pass; repeat claimed the calculation target was missing. |
| CASE-07 | STABLE | Both retained explicit save correctly. |
| CASE-12 | VARIANT | First added clarification; repeat passed. |
| CASE-14 | VARIANT | First passed; repeat was clarification-review-required. |
| CASE-15 | VARIANT | Both over-clarified; first also leaked grounding language. |
| CASE-20 | VARIANT | First passed; repeat was clarification-review-required. |

## Acceptance assessment

The structural isolation is proven: Intent has no code path or context field
for Policy Memo, and its policy-independent prompt receives only Business Memo
in addition to Owner wording. The experiment also eliminated confirmed
Policy-to-Intent leakage in the frozen run.

However, the requested zero-confirmed-failure Intent criterion is not met.
The residual defect family is not a JSON/formatting failure: it is a semantic
boundary failure in which Intent sometimes turns formal identity or additional
configuration questions into a language clarification. CASE-02, CASE-15, and
the repeat instability make that unsafe to integrate into runtime. The correct
decision is therefore **REWORK**, without changing production code or retrying
the frozen smoke.

## Runtime integration decision

Do not integrate this prototype into the Native Runtime. Retain the frozen
evidence and use the failure matrix for Supervisor-directed follow-up. No
production code, domain policy authority, ontology contract, database schema,
or deployment state changed in M4-2I.
