# M4-4C Capability Semantics Audit

## Authoritative source

The Planner-facing projection is derived from `api/capabilities/registry.cjs` and the cited read-only implementation paths in the generated snapshot. It is not a second capability registry.

## `recipes.scenario_compare_preview`

Registry evidence: `api/capabilities/registry.cjs` declares a read-only preview with current-rebuilt costs, per-scenario configuration, applied overrides, and configuration changes.

Implementation evidence: `api/services/recipeScenarioComparison.cjs`.

- Target: exactly one formally grounded Recipe.
- Input: current-rebuilt baseline plus at most three named scenarios.
- Output: base and candidate `currentTotalCost`, complete/partial cost information, normalized configuration, requested/applied/not-applied overrides, `comparisons[].delta`, and formal field-level `changes[]`.
- Therefore it can produce `CURRENT_COST`, `SCENARIO_COST`, and `SCENARIO_COMPARISON`; a separate COMPUTE is optional when the comparison delta itself is the required fact.

Supported override categories from `ALLOWED_OVERRIDES` are float, cable, formal coil selection, barrel length, formal packaging-part selection, and surface treatment. Surface treatment accepts `electrophoresis` as a supported mode, subject to the Recipe configuration policy supplying an allowed mode/cost or to a formal cost input.

The route does **not** accept an unbound packaging material name such as `木箱`: it requires formal `packingParts` identities (part id, model, supplier, role, quantity). `木箱` from frozen Grounding remains a configuration expression, not a formal packaging part binding. This is a real Planner-visible capability gap for the current corpus, not an evaluator relaxation.

The route does **not** include stainless shaft joint overrides in `ALLOWED_OVERRIDES`; that is likewise a real scenario-preview capability gap. It must be `BLOCKED_CAPABILITY`, never `BLOCKED_AMBIGUITY` when the Recipe is exact.

## `coils.list`

Registry evidence: `api/capabilities/registry.cjs:coils.list`. Runtime projection evidence: `api/routes/coils.cjs` and `api/db.cjs:coilRow`.

The returned formal Coil profile includes formal scheme identity and `cost`; it is compatible with one or more formally grounded Coil schemes for current coil-cost/detail facts. It is not Recipe-current-cost capability.

## Other visible capabilities

- `templates.detail`: one Template; formal detail and fixed-part relations.
- `recipes.current_costs`: one or a set of Recipes; current Recipe cost only.
- `relations.read`: one formal relation root; formal relation facts.
- `cost.recipe_difference`: exactly two Recipes; direct current-cost difference plus current-cost details.

No endpoint, SQL, database table, executor, or tool schema is supplied to the Planner prompt.
