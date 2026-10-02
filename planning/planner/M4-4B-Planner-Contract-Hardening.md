# M4-4B — Planner Contract Hardening + Evaluator Correction

## Status

STATUS: REWORK

Start baseline: `cd7a1c32523fe0a20d61dc9ea071d5ee407ff3a6` on `ai-native/m3-optimization-v1`.

This round hardened the Planner prototype contract and re-ran the unchanged M4-4A 26-case corpus. It did not change Business Understanding, Domain Policy, Grounding V1, production runtime, Executor, Business API, database, cost engine, ontology, or write allowlist.

## M4-4A failure reclassification

M4-4A's 16/26 result contained evaluator-contract errors in addition to model failures:

- `cost.recipe_difference` is an authoritative direct READ capability for two formally grounded Recipes and is now accepted.
- `COMPUTE` is a Planner-intrinsic deterministic primitive, not a catalog capability; it uses `CAPABILITY: NONE` and is never looked up in the registry.
- Raw status fields could previously be paired with unsafe steps. A deterministic validator now gates every parsed plan before any future Executor could consume it.

These corrections do not turn a semantic error into a successful plan. They only remove false rejections and block invalid raw plans deterministically.

## Capability catalog

The sole source remains `api/capabilities/registry.cjs` through `listBusinessCapabilities`.

- Total: 147 (query 41, preview 5, command 78, maintenance 23)
- Planner visible: 6 (READ 5, PREVIEW 1, ANALYSIS 0)
- Write capabilities visible: 0

The derived snapshot now contains business-level input/output semantics only; it exposes no endpoint, HTTP method, tool schema, executor, table, or SQL information.

## Contract additions

`planContractValidator.cjs` receives the parsed raw memo and returns a separate validation result plus validated plan. It does not plan, add capabilities, infer targets, or modify upstream evidence.

- Closed statuses: `READY`, `NO_TOOL_REQUIRED`, `BLOCKED_GROUNDING`, `BLOCKED_AMBIGUITY`, `BLOCKED_CAPABILITY`, `BLOCKED_POLICY`.
- `NO_TOOL_REQUIRED`, grounding/ambiguity/capability blocks require zero steps.
- `BLOCKED_POLICY` permits only a read/preview/compute subplan when `PREVIEW_PLAN_AVAILABLE: YES`; any write step is rejected.
- Stage write is disabled. Raw `READY` plus `WRITE_REQUIRED: YES` is retained as evidence but validates as `SAFE_BLOCKED` with effective `BLOCKED_POLICY`.
- Required facts, producers, dependencies, cycles, compute inputs, and compute sources are checked deterministically.
- `AMBIGUITY_USAGE` explicitly distinguishes `SELECTION_REQUIRED` from `SET_CONSUMABLE`.
- `REQUIRED_FACT: NONE`, `MISSING_CAPABILITY: NONE`, and `UPSTREAM_CONTRACT_GAP: NONE` parse to empty collections.

## Direct capability and COMPUTE principles

Two exact Recipe current-cost comparison accepts either:

1. `READ cost.recipe_difference`, or
2. two authoritative current-cost reads plus deterministic `COMPUTE`.

The direct route was accepted in both P-14 and N-06. `COMPUTE_CAPABILITY_LOOKUP_ATTEMPTS` is zero.

For previews, the evaluator checks internal fact closure rather than forcing a fixed preliminary read. `recipes.scenario_compare_preview` may supply the current rebuilt and scenario costs when its formal contract says it can do so.

## Deterministic contract tests

`tests/plannerV1ContractValidator.test.cjs` covers PC-01 through PC-22. All 22 pass, including status discipline, write safety, valid/invalid COMPUTE, direct capability paths, MULTIPLE consumption labels, and parser sentinels.

Machine-readable evidence: `M4-4B-Plan-Contract-Tests.json`.

## Targeted re-run

The original ten targeted questions were re-run once each against DeepSeek, with no Planner retry.

| Result | Cases |
| --- | --- |
| PASS | P-01, P-03, P-05, P-08, P-13, P-16 |
| FAIL | P-06, P-07, P-09, P-17 |

The failures preserve their raw model memo and validator output in the evidence. They were not patched case-by-case.

## Full unchanged 26-case re-run

| Group | Pass | Fail |
| --- | ---: | ---: |
| Base | 11 / 18 | 7 |
| Negative | 5 / 8 | 3 |
| Total | 16 / 26 | 10 |

Key corrected cases:

- P-14 two-Recipe comparison: PASS through the direct authoritative `cost.recipe_difference` route.
- N-06 direct Recipe difference: PASS; no forced `recipes.current_costs` or catalog COMPUTE capability.
- P-06 remains a model/contract issue only when the raw blocked plan illegally includes steps; the validator rejects that plan rather than misclassifying it as silent candidate selection.
- P-07 remains a model semantic issue when `12-120` scheme counting is marked `BLOCKED_AMBIGUITY` rather than `SET_CONSUMABLE`.

Remaining failures are evidence for Supervisor review, not a justification for an R4C patch in this round. Representative classes include ambiguity-consumption reasoning, preview planning omissions, wrong policy/grounding routing, and raw fact-source/closure violations.

## Raw versus validated outcomes

- Raw semantic pass: 16
- Raw semantic fail: 10
- Validated `VALID`: 21
- Validated `INVALID`: 5
- Contract violations: 8
- Blocked-plan-step violations: 1
- COMPUTE validation failures: 3
- Direct capability accepted: 2 (P-14, N-06)
- Direct capability wrongly rejected: 0

The validator is a gate, not a repair agent: a validated safe block does not make a raw semantic failure pass.

## Safety and isolation

- Planner re-grounding attempts: 0
- Invented formal IDs: 0
- Write steps / tool calls / Business API calls / DB access: 0
- Planner-visible write capabilities: 0
- Frozen upstream files changed: 0
- Planner retry: disabled

Raw model outputs, parsed plans, validation results, and validated plans are retained in the smoke evidence.

## Performance

Planner median: 1493.79 ms. One P-09 case used the authorized real frozen upstream chain; no tool/API/DB operation was executed by Planner.

## Recommendation

The Planner architecture and hardened execution boundary are sound, but the corrected baseline still has genuine Planner semantic failures. Do not automatically add a per-case prompt patch or retry. Supervisor should decide the next semantic-control approach from this clean failure matrix.
