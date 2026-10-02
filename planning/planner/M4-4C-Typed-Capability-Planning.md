# M4-4C — Typed Capability Planning

## Status

STATUS: REWORK

This round starts at `5daaedb33d347ac3d511c901893a470053e979f7` and retains the frozen upstream layers unchanged. Planner remains prototype-only: no Executor, tool, Business API, database, write, or deployment was connected.

## M4-4B failure clusters

M4-4B established that the capability registry, direct-capability rule, raw/validated plan separation, and intrinsic COMPUTE rule were sound. The remaining failures showed that prose descriptions were not enough for stable model planning: target type, cardinality, produced facts, scenario boundary, and blocked-status admission all needed deterministic representation.

## Authoritative capability audit

The authoritative source remains `api/capabilities/registry.cjs`. The six Planner-visible read/preview capabilities are projected into a typed Planner-only snapshot with registry and implementation provenance.

The projection includes `targetTypes`, `targetCardinality`, `accepts`, `produces`, `directGoalClasses`, `notFor`, and provenance. It does not create a second registry and does not expose API routes, SQL, tables, tool schemas, executors, or internal client paths to Planner.

## Scenario preview actual contract

`recipes.scenario_compare_preview` is verified against the registry and `api/services/recipeScenarioComparison.cjs`:

- It accepts one formal Recipe and up to three explicit scenarios.
- It returns current-rebuilt base and scenario costs, configurations, requested/applied/not-applied overrides, field changes, and comparison delta.
- It can therefore satisfy `CURRENT_COST`, `SCENARIO_COST`, and `SCENARIO_COMPARISON`; deterministic COMPUTE is optional when the returned comparison delta is the fact needed.
- Supported categories are float, cable, formal coil selection, barrel length, formal packaging-part selection, and surface treatment.
- An unbound material word such as `木箱` is not a valid direct preview override: formal packaging part identity, model, supplier, role, and quantity are required. This is a real capability/binding gap for the current frozen corpus.
- `电泳` is a supported surface-treatment mode subject to the current Recipe policy providing an allowed mode/cost or a formal cost input.
- Stainless shaft joint is absent from the service's allowed overrides. It is a real preview capability gap, not grounding ambiguity.

## Coil cost capability audit

`coils.list` is verified from the registry, `api/routes/coils.cjs`, and `api/db.cjs:coilRow`. A formal Coil profile includes scheme identity and `cost`, so it is compatible with one or a set of grounded Coil schemes for `CURRENT_COST`, `FORMAL_DETAIL`, and candidate-set facts. It cannot be replaced with a Recipe-only capability.

## Typed fact satisfaction and target compatibility

`canCapabilitySatisfyFact()` validates a Required Fact class against a descriptor's declared outputs, target types, and cardinality. This blocks a Coil target from being routed to `recipes.current_costs`, a single Recipe from being sent to a Recipe-pair difference capability, and a step from claiming outputs the capability does not produce.

## Admission guard and blocked V3 contract

The thin admission guard is built before the Planner call from frozen Grounding evidence and is enforced after raw parsing. It rejects—without rewriting—the following contradictions:

- `BLOCKED_GROUNDING` when Grounding is exact or qualified.
- `BLOCKED_AMBIGUITY` when Grounding is exact and contains no unresolved multiple candidate set.
- `READY` when Grounding is unresolved.
- `BLOCKED_POLICY` when explicit no-save/preview evidence applies.

Blocked plans now contain zero Required Facts and zero steps, using `BLOCK_REASON` and `RESUME_REQUIREMENT` instead. `BLOCKED_POLICY` retains its narrowly allowed safe preview subplan exception.

## Scenario override and multi-output contract

Planner Memo V3 supports repeated `SCENARIO_OVERRIDE` lines. A single typed preview step may produce multiple fact IDs. A COMPUTE step must consume those produced facts and remains a local deterministic primitive rather than a capability.

## Deterministic tests

Typed semantics, admission, blocked contracts, multi-output facts, and scenario override preservation were added alongside the existing Planner contract suite. All deterministic checks pass. The machine evidence records 22 covered deterministic conditions.

## Targeted 12-case re-run

| Result | Cases |
| --- | --- |
| PASS | P-05, P-11, P-17, N-02 |
| FAIL | P-06, P-07, P-09, P-12, P-13, P-15, N-05, N-07 |

The targeted run ran exactly one Planner model call per case and did not retry.

## Full unchanged 26-case re-run

| Group | Pass | Fail |
| --- | ---: | ---: |
| Base | 11 / 18 | 7 |
| Negative | 3 / 8 | 5 |
| Total | 14 / 26 | 12 |

M4-4A: 16/26. M4-4B: 16/26. M4-4C: 14/26. The lower score is not an evaluator regression: typed validation now rejects plans that previously looked superficially usable while claiming unsupported capability outputs or contradicting exact Grounding.

## Remaining true Planner failures

- P-07 still treats a candidate-set count as `BLOCKED_AMBIGUITY` and also emits illegal facts/steps in a blocked plan.
- P-08 chooses a fact/capability combination that does not satisfy the typed relation contract.
- P-09, P-13, N-04, N-05, and N-07 do not recognize the audited requirement for formal packaging-part binding before a wood-box scenario preview.
- P-10 contradicts exact Grounding with ambiguity routing.
- P-11 selects a bad COMPUTE source even though the surface-treatment preview route is available.
- P-12 correctly moved toward `BLOCKED_CAPABILITY` in the full run, but did not name the audited missing capability.
- P-15 and N-06 claim capability outputs incompatible with their grounded target types/fact classes.

## Metrics and safety

- Typed descriptors: 6
- Capability output/type mismatches: 5
- Status-grounding contradictions: 2
- Blocked Required Fact violations: 1
- Multi-output steps observed: 9
- Evaluator contract bugs remaining: 0
- Planner re-grounding, invented IDs, write steps, tool/API/DB access: 0
- Planner-visible writes: 0

Planner median latency was 1741.35 ms; the one real frozen-upstream chain had a 6498.23 ms total median. No Planner retry was enabled.

## Recommendation

Typed capability semantics and deterministic admission/compatibility gates are correct and make the remaining model failures explicit. Do not add M4-4D patches automatically. Supervisor should decide whether bounded retry, semantic decomposition, or a Planner architecture change is warranted.
