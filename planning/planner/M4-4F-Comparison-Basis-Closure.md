# M4-4F — Comparison Basis Closure

## Status

STATUS: REWORK

START_HEAD: `27d04d7ae8b0db3ab2ea9c140e41f8297334e9d8`

The deterministic Plan Compiler was not changed. Frozen Business Understanding, Domain Policy, and Grounding V1 were not changed. No production component was connected or deployed.

## M4-4E single remaining failure

M4-4E exposed a first-pass Requirement memo for P-12 that requested `COST_DIFFERENCE` for one grounded Recipe while dropping the owner scenario override entirely. That created no comparison basis for the compiler to consume.

## Comparison-basis contract

`COST_DIFFERENCE` and `SCENARIO_COMPARISON` require either:

- two explicit final grounded targets (including a qualified set), or
- at least one owner-language scenario override.

`SCENARIO_COST` and `CURRENT_COST` do not by themselves require a comparison basis. The detector uses only Requirement facts, frozen final-target cardinality, and parsed Requirement overrides; it does not parse raw owner wording or infer a scenario itself.

## Detector and retry behavior

`COMPARISON_BASIS_MISSING` is now a third structural contradiction next to `SCENARIO_GOAL_MISSING` and `SCENARIO_CLASS_UNDERCLASSIFIED`. All detected reasons are merged into one retry addendum; the pipeline makes no more than two Requirement calls. A second pass that remains incomplete records the unresolved contradiction in `requirementRetry.exhaustedReasons`; the evaluator rejects the final Requirement as `COMPARISON_BASIS_REQUIRED`.

The addendum asks the model to preserve a second target or an owner-provided scenario change without naming an entity, scenario, class, or capability. The deterministic compiler still cannot recover a missing override from raw wording.

## Deterministic evidence

The existing M4-4E reliability suite plus CB-01 through CB-11 passed **26/26**. It covers:

- one-target comparison without an override;
- scenario comparison without a basis;
- scenario, explicit-pair, and qualified-set bases;
- non-comparison goals;
- one bounded retry, successful recovery, exhausted retry, and no retry for a two-target comparison.

Evidence: `planning/planner/M4-4F-Comparison-Basis-Tests.json`.

## P-12 ten-run reliability

P-12 (`V750通用款做不锈钢接轴成本差多少？`) final result: **10/10 PASS**. All ten first attempts retained a valid scenario override in this sample, so the new comparison-basis path did not need to fire during those ten runs. The deterministic CB suite covers the missing-basis recovery path directly.

The audited capability gap remains unchanged: `ROTOR_PROCESS` is not supported by the scenario-preview capability. The correct deterministic final plan remains `BLOCKED_CAPABILITY`, never a fabricated preview or a write.

Evidence: `planning/planner/M4-4F-P12-Reliability-Smoke.json`.

## Regression reliability

| Case | Final result |
| --- | --- |
| P-10 FLOAT | 3/3 PASS |
| P-11 ELECTROPHORESIS | 2/3 PASS |
| P-13 MULTI_OVERRIDE | 3/3 PASS |
| N-06 TWO_RECIPE_DIFFERENCE | 3/3 PASS |

P-11 run 3 was correctly rejected by the existing provenance contract: the owner wording was `做电泳成本增加多少？`, while the Requirement memo emitted `SCENARIO_OVERRIDE: 增加电泳 | SURFACE_TREATMENT`. It preserved the business class but failed to retain an owner-language span, producing `REQUIREMENT_OVERRIDE_NOT_IN_OWNER_WORDING`.

This is not a comparison-basis failure, so the approved M4-4F detector did not retry it. No rerun was used to mask the failure.

Evidence: `planning/planner/M4-4F-Regression-Reliability-Smoke.json`.

## Full corpus

The required reliability prerequisite was not met because P-11 was 2/3. Therefore the fresh full 26-case corpus was intentionally not run. `M4-4F-Full-Smoke.json` records `NOT_RUN` rather than presenting fabricated or stale full-smoke evidence.

## Safety and compiler stability

Across the M4-4F runs:

- Requirement Planner model calls were bounded to two attempts; maximum observed was two.
- Plan Compiler model calls were zero.
- No re-grounding, invented formal IDs, invented capabilities, unsupported override execution, silent multiple selection, write steps, tools, Business API calls, DB access, or upstream changes occurred.
- The Compiler was not changed. Its established 26/26 M4-4D/M4-4E deterministic baseline remains the compiler baseline; no compiler semantic regression was observed in M4-4F’s executed cases.

## Repository gates

All gates passed on the final M4-4F worktree:

- `npm test` — 2201 passed
- `npm run verify:api-contract` — 29 passed
- `npm run test:deep-api` — 486 passed
- `npm run lint` — passed
- `npm run build` — passed
- `npm run test:ai-architecture` — 9 passed
- `npm run verify:ai-assistant-release` — passed

## Recommendation

The generic comparison-basis completeness guard is correct and safely bounded, but Planner V1 cannot freeze. The remaining failure is a different Requirement reliability class: semantically equivalent scenario wording is rejected by the frozen owner-span provenance rule, and it does not satisfy an approved M4-4F retry trigger. Preserve this evidence and return for Supervisor architecture review; do not introduce an unapproved synonym/fuzzy span rule or broader retry automatically.
