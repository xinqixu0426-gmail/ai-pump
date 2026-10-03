# M5-D1-R2 — Evidence Semantics & Final Answer Closure

## Status

**REWORK.** The evidence-semantic defects were fixed with deterministic coverage and a post-fix fresh D1-06 run passed, but the required aggregate controlled first-pass result remained **8/10**, so repetition and real-catalog smoke were intentionally not run.

## Scope and boundaries

This change stays in the candidate evidence/finalization boundary plus the shared fail-closed answer validator. It does not change API Index, schema loading, tool selection, Capability Broker, Judge routing, Grounding, Business Understanding, Domain Policy, Ontology, cost formula, formal API semantics, or production routing. The candidate alone opts into the new structured comparison facts.

## Root causes closed

### D1-03 — formal recipe difference was not claimable

`compare_recipes` already returned the authoritative `costDiff`, but the ledger only exposed generic deep fields. The candidate ledger now projects that returned value as `recipe_cost_difference`, with `RECIPE_DIFFERENCE`, both canonical participants, and formal `RIGHT_MINUS_LEFT` direction. It performs no subtraction. A pair mismatch remains rejected.

### D1-05, D1-06, D1-08 — scenario money roles were conflated

Scenario facts now carry an explicit `moneyRole`:

- `CURRENT_BASE` for a formal `BASE` scenario;
- `SCENARIO_CANDIDATE` for an applied candidate;
- `SCENARIO_DIFFERENCE` only for a formal `COMPARABLE` delta;
- `CURRENT_FORMAL` for ordinary current-cost output;
- `RECIPE_DIFFERENCE` for formal recipe comparisons.

Candidate/not-applied scenarios and non-comparable deltas are not claimable. This retains the Rotor Process capability-gap safety: an unsupported no-op cannot become a false zero-cost answer.

### Validator basis semantics

The validator now classifies each monetary assertion from its own local business assertion. In particular it distinguishes base, candidate, and delta values in a single transition sentence, and treats negated wording such as “不是当前正式成本” as a negation rather than a positive current-cost assertion. Difference claims require a formal difference fact; two absolute amounts never authorize a derived difference.

Money-binding failures return sanitized actionable details: claim text, amount, detected role, cited IDs, compatible IDs, and a closed reason such as `WRONG_MONEY_ROLE`, `MISSING_DIFFERENCE_FACT`, or `WRONG_COMPARISON_PARTICIPANTS`.

### Claimable Fact Catalog V2

The model-facing catalog now exposes claim type, money role, scenario label/key/role, comparison participants, direction, canonical entity name, basis, source tool, and value. It excludes internal numeric entity IDs and suppresses generic low-semantic deep-field money duplicates when the matching structured fact exists.

### Finalization envelope reliability

Finalization can accept one whole-message JSON code fence, but not prose containing an embedded envelope. It receives structured validator details on repair. Clarifications without a verified business assertion use `claims: []`; an empty-fact claim now reports `EMPTY_FACT_IDS` instead of a generic failure. Every separate money sentence still requires a claim.

## Controlled fixture evidence

The controlled runtime remains the existing isolated temporary SQLite database through the ordinary Executor and formal Express routes; no business results were mocked and neither local nor production business DB was touched.

The aggregate fresh controlled run reported 8/10 semantic pass. It is kept unchanged as evidence rather than restated as 10/10. Its remaining failures were:

- D1-04: the model did not load the coil-cost preview tool, so no formal cost result was obtained. This is a tool-investigation reliability issue, not an evidence/finalization defect and is outside this narrowly scoped phase.
- D1-06: a multi-amount sentence was rejected before the final local amount-transition classifier and catalog duplicate suppression. A new fresh targeted D1-06 run after those fixes passed end-to-end.

Because the aggregate first-pass gate did not reach 10/10, the required 18-run repetition and real-catalog smoke were not run. This avoids treating extra samples as a substitute for the acceptance gate.

## Deterministic regression

The R2 suite covers pre-fix failure reproductions and the new closure contract: formal `costDiff` promotion without arithmetic; base/candidate/difference roles; current/scenario and entity/pair rejection; negated current language; catalog ID removal; structured safe failure detail; fenced JSON handling; clarification envelope repair; and unsupported Rotor no-op exclusion. Shared candidate and R1 reliability suites also pass.

## Recommendation

The architecture remains recommended: formal execution and evidence semantics now have the necessary structured representation. D1-R2 itself remains **REWORK** because controlled task completion is not yet 10/10. The next supervised reliability work should address generic investigation/tool-selection completion (not reintroduce slots, Judge routing, or case rules), then rerun the controlled gate from a fresh aggregate baseline.
