# M4-3A-R8 — High-Precision Concept Question Fast Path

## Result

Status: **REWORK**. The 25-case real focused smoke passed 25/25, and the deterministic concept/reference integration suite passed 17/17. The subsequently required first full frozen smoke did not pass: 17/21 base runs passed and 24/31 runs including repeats passed.

No prompt, case, expected-result, resolver, or ontology change was made after the full smoke. This report preserves the first result.

## R7 Single Remaining Failure

R7's only focused failure was `V750是什么？`: the Role model treated an explicit definition question as a formal candidate and triggered resolver fan-out. R8 moves only high-confidence concept grammar in front of the Role model; it does not alter the Role Prompt.

## Concept vs Formal Fact Boundary

The fast path recognizes direct definitions, naming/meaning questions, two-concept comparisons, explicit business classification, and a narrow definition-confirmation form. It rejects any input containing a formal-fact signal including price, cost, inventory, scheme count, current state, list/which wording, quotation, quantity, formal record, BOM content, or recipe content.

It therefore decides only that no formal identity lookup is needed. Business Agent still provides concept interpretation; the fast path never produces an answer, formal identity, entity type, or business fact.

## Reference Priority

Reference Detection and Reference Fast Path/LLM fallback run first. An unresolved `这个是什么？` stops as unresolved reference without invoking Concept Fast Path. A safely resolved reference is rewritten into the Grounding Working Utterance before concept detection:

`这个是什么意思？` with prior `12-120` becomes `12-120是什么意思？`, then stops as concept-only.

`这个多少钱？` with the same prior wording becomes `12-120多少钱？`, is explicitly not a concept match, and continues to Role/Resolver.

## Concept Fast Path Contract

`detectConceptQuestionFastPath()` is deterministic and returns evidence only:

- `MATCHED_CONCEPT_ONLY` or `NOT_MATCHED`;
- grammar family, matched surface, and reason;
- the working utterance;
- all checked formal-fact signals and any signals found.

A match produces `STOP_CONCEPT_ONLY`, Role calls `0`, resolver calls `0`, and no formal target. The implementation does not hard-code `V750`, `12-120`, Template, or other business identifiers.

## Deterministic Tests

Evidence: [M4-3A-R8-Concept-FastPath-Tests.json](M4-3A-R8-Concept-FastPath-Tests.json)

All 17/17 deterministic cases passed:

- seven positive definition, meaning, comparison, and classification forms;
- seven negative formal-fact forms;
- three reference-priority integrations.

The Prototype structural test suite also passed 25/25, including early reference stop, concept stop before Role/resolver, resolved-reference rewrite before concept detection, Role prompt freeze, Business/Policy freeze, no Intent call, and no production import.

## 25-case Real Focused Smoke

Evidence: [M4-3A-R8-Focused-Smoke.json](M4-3A-R8-Focused-Smoke.json)

| Group | PASS | FAIL |
| --- | ---: | ---: |
| Targeted | 10 | 0 |
| Reference focused | 5 | 0 |
| Role focused | 5 | 0 |
| Working utterance focused | 5 | 0 |
| Total | 25 | 0 |

`R-ROLE-04` now passed deterministically: working utterance `V750是什么？`, pattern `DEFINITION_WHAT_IS`, `STOP_CONCEPT_ONLY`, Role calls `0`, resolver calls `0`.

The focused run recorded three Concept Fast Path hits, 68 total model calls, 72 read-only resolver calls, and five safely filtered role-output warnings.

## Full Frozen Smoke

Evidence: [M4-3A-R8-Full-Smoke.json](M4-3A-R8-Full-Smoke.json)

| Scope | PASS | FAIL |
| --- | ---: | ---: |
| Base `G-01..G-16`, `N-01..N-05` | 17 | 4 |
| Base plus frozen repeats | 24 | 7 |

### Confirmed failures

1. `G-05` `查一下V750成本。`
   - Role retained correct `V750`, but additionally emitted `V750成本` as a formal candidate.
   - Resolver fan-out ran for the extra query-bearing span and produced `UNRESOLVED`.
   - Classification: `ROLE_SEMANTIC_FAILURE` / query-term promotion.

2. `G-06` `查一下V750现在用哪个线圈。` (base and repeat)
   - Role retained `V750` but also promoted `线圈` as an independent formal candidate.
   - Classification: `ROLE_SEMANTIC_FAILURE` / query-term promotion.

3. `G-16` `木箱和纸箱在我们系统里分别算什么？`
   - Concept Fast Path did not match this untested grammatical variant (`在我们系统里`), then Role returned configuration values and stopped without resolver.
   - Classification: `CONCEPT_FAST_PATH_MISS`; execution remained safe, but the required deterministic fast-path contract was not met.

4. `N-05` `通用款和豪贝款的V750成本分别多少？` (base and repeat)
   - Role decomposed the two qualified targets into bare `V750`, `通用款`, and `豪贝款` rather than preserving two qualified V750 spans.
   - Classification: `ROLE_SEMANTIC_FAILURE`, `QUALIFIER_LOSS`, and multi-target preservation failure.

5. `G-07` repeat `通用款模板有哪些固定件？`
   - The repeat additionally promoted `固定件` as a formal candidate.
   - Classification: `ROLE_SEMANTIC_FAILURE` / query-term promotion.

These failures are not Reference Fast Path, rewrite, span-alignment, deterministic gate, or resolver-fan-out failures. The corresponding safety components did not silently bind an identity or issue a write.

## Raw Outputs and Resolver Evidence

Both JSON artifacts retain raw Business/Policy/Reference/Role memos, working utterances, Concept Fast Path evidence, formal target provenance, read-only resolver fan-out results, warnings, and evaluator findings. No final cost, inventory, BOM, or fixed-part fact was retrieved or asserted.

## Warnings and Safety Metrics

Full smoke recorded four Concept Fast Path hits, 86 model calls, 136 read-only resolver calls, and three role-output warnings. Filtered old-reference expressions were `刚才那个线圈` and `它`; zero filtered expressions reached the resolver.

All confirmed safety counters remain zero: reference wrong binding, reference rewrite failure, formal-target provenance failure, span alignment wrong binding, silent first-result binding, model-invented formal ID, formal fact hallucination, planner leak, and write attempt.

## Performance

| Metric | Median ms |
| --- | ---: |
| Business | 2959.367 |
| Policy | 1994.441 |
| Reference fast path | 0.000 |
| Reference LLM | 0.000 |
| Rewrite | 0.007 |
| Concept fast path | 0.018 |
| Role | 875.338 |
| Span alignment | 0.048 |
| Resolver fan-out | 0.379 |
| Total | 3935.657 |

## Recommendation

R8 fixes the original `V750是什么？` failure without a Role Prompt change and demonstrates correct reference priority. The full frozen result still exposes real Role semantic limitations around query terms and qualified multi-target composition, plus one fast-path grammar miss. Do not patch prompts or add case-specific logic in this stage. Return `REWORK` to the Supervisor for the next architectural decision.
