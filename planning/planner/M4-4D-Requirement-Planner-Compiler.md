# M4-4D — Requirement Planner + Deterministic Plan Compiler

## Status

`REWORK`. The upstream contracts remain frozen and the deterministic compiler is
correct for the structured Requirement Memos it receives. The same 26-case
corpus has 16 final passes and 10 Requirement Planner semantic failures; no
further prompt or retry changes were made.

## Why the single Planner was split

M4-4C required one LLM to infer the owner goal, formal facts, ambiguity use,
scenario changes, capability availability, step graph, and closed plan status.
This mixed semantic interpretation with catalog binding. M4-4D keeps one LLM,
but narrows it to a Requirement Memo. The deterministic compiler owns typed
capability selection, status derivation, missing-capability structure, and step
construction.

```
Frozen upstream → Requirement Planner LLM → Requirement Memo
                → deterministic Plan Compiler → Plan Contract Validator
```

The Requirement Planner has no capability catalog, endpoint, Tool, API, DB, or
executor context. It is called once per case; the compiler has zero model calls.

## M4-4C evaluator corrections

1. **Bug A fixed:** missing capability is now a structured compiler result
   (`FACT_CLASS | TARGET_TYPE | SCENARIO_CLASS | REQUIRED_SEMANTICS`), rather
   than an evaluator check for an English substring. This accepts the real
   `BLOCKED_CAPABILITY` result for an unsupported stainless-shaft override.
2. **Bug B fixed:** `canCapabilitySatisfyStep()` validates the entire step.
   `cost.recipe_difference` can authoritatively produce two recipe current-cost
   details and their cost difference as a `recipe_pair` step. It is no longer
   rejected by isolated per-fact `recipe` checks.

The audited scenario preview projection also records its returned delta as
`COST_DIFFERENCE`, alongside current cost, scenario cost, and scenario
comparison.

## Requirement Memo contract

The LLM may output only:

```text
REQUIREMENT_STATUS: READY | NO_FORMAL_FACT_REQUIRED | UNRESOLVED_GROUNDING
OWNER_GOAL: ...
TARGET: <frozen grounded mention or canonical name>
GOAL_FACT: FORMAL_DETAIL | CURRENT_COST | RELATION | CANDIDATE_SET |
           SCENARIO_COST | SCENARIO_COMPARISON | COST_DIFFERENCE | OTHER
SELECTION_REQUIREMENT: NONE | SINGLE_TARGET_REQUIRED | WHOLE_SET
SCENARIO_OVERRIDE: <owner wording> | <scenario class>
WRITE_REQUIRED: YES | NO
```

Targets are validated against frozen Grounding. Scenario expressions must occur
in the owner wording; only their small business class is supplied to the
compiler. `NONE`, `无`, and `没有` are parser sentinels, not phantom scenario
overrides. In `NO_FORMAL_FACT_REQUIRED` and `UNRESOLVED_GROUNDING`, a lone
`OTHER` is normalized as no formal fact.

## Deterministic compiler

The compiler consumes Requirement Memo, frozen Grounding, candidate-set
completeness, stage policy, and the M4-4C typed capability projection. It does
not read raw Chinese owner text or invoke a model.

- unresolved grounding → `BLOCKED_GROUNDING`
- `SINGLE_TARGET_REQUIRED` + formal multiple → `BLOCKED_AMBIGUITY`
- `WHOLE_SET` + complete frozen candidate set → `NO_TOOL_REQUIRED`
- direct typed capability matching chooses the shortest authoritative path
- unsupported scenario class → structured `BLOCKED_CAPABILITY`
- explicit write with the write-disabled stage → `BLOCKED_POLICY`; any safe
  preview subplan is included only if its typed overrides are supported

One step may produce multiple facts. Pair and set cardinality are validated at
the step level rather than by a lossy individual-fact approximation.

## Scenario capability binding and real gaps

The authoritative M4-4C audit remains the source for scenario semantics:

| Requirement scenario class | `recipes.scenario_compare_preview` |
| --- | --- |
| FLOAT, CABLE, COIL, BARREL, SURFACE_TREATMENT | supported |
| PACKAGING | requires formal packaging-part binding |
| ROTOR_PROCESS | unsupported |

Thus owner-language `木箱` alone is a real capability/binding gap, not a
grounding ambiguity. `电缆5米 + 木箱` is blocked as a whole, preserving both
changes rather than silently previewing only the cable. `不锈钢接轴` is also a
real gap under the audited visible capability set. Electrophoresis is a
supported surface-treatment mode.

## Deterministic evidence

- Requirement contract tests: **3 / 3** groups pass.
- Compiler tests C-01 through C-20: **20 / 20** pass.
- Existing Planner/contract/typed suites: **42 / 42** tests pass.
- Compiler model calls: **0**.

See [Requirement tests](M4-4D-Requirement-Tests.json) and
[Compiler tests](M4-4D-Compiler-Tests.json).

## Targeted 13-case smoke

One DeepSeek Requirement Planner call was made per case; there was no retry.
After deterministic compiler re-evaluation against the final audited descriptor:

| Result | Count |
| --- | ---: |
| Requirement pass | 9 / 13 |
| Compiler pass | 13 / 13 |
| Final pass | 9 / 13 |

Requirement failures: P-05 incorrectly declared frozen MULTIPLE grounding
unresolved; P-08 requested `FORMAL_DETAIL` instead of `RELATION`; P-12 used
`OTHER` instead of `ROTOR_PROCESS`; P-13 retained both overrides but requested
only `CURRENT_COST` instead of a scenario fact. The compiler safely compiled
each received requirement; no capability, type, step, or safety violation was
observed.

## Full same-26-case run

| Layer | Pass | Fail |
| --- | ---: | ---: |
| Requirement Planner | 16 | 10 |
| Deterministic Compiler | 26 | 0 |
| Final plan | 16 | 10 |

The 10 true Requirement failures are: P-03, P-06, P-08, P-10, P-11, P-12,
N-01, N-03, N-04, and N-08. They cluster around fact-class selection,
scenario-class selection, and incorrectly treating formal MULTIPLE as unresolved.
No remaining failure is an evaluator-string bug, compiler target-type bug, or
capability-admission/contract error.

## M4-4A → M4-4D delta

| Phase | Final score | Principal finding |
| --- | ---: | --- |
| M4-4A | 16 / 26 | baseline single Planner |
| M4-4B | 16 / 26 | contract/evaluator corrections |
| M4-4C | 14 / 26 reported | typed descriptors and admission guard |
| M4-4D | 16 / 26 | Requirement failures isolated; compiler 26 / 26 |

## Safety and performance

All are zero: Planner regrounding, invented formal IDs, compiler-invented
capabilities, wrong target-type acceptance, unsupported override execution,
silent multiple selection, WRITE steps, Tools, Business API calls, DB access,
visible write capabilities, and frozen-upstream modifications.

Full run medians:

- Requirement Planner: 1273.189250 ms
- Deterministic compiler: 0.075333 ms
- Real upstream + Requirement Planner chain: 5925.764042 ms

## Repository gates

All required repository gates passed after the prototype change:

- `npm test` — 2195 / 2195 pass
- `npm run verify:api-contract` — 29 / 29 pass
- `npm run test:deep-api` — 486 / 486 pass
- `npm run lint` — pass
- `npm run build` — pass
- `npm run test:ai-architecture` — 9 / 9 pass
- `npm run verify:ai-assistant-release` — pass

## Recommendation

The deterministic compiler is suitable as the only future plan-construction
path: it needs neither raw owner NLP nor capability awareness from the LLM.
M4-4D remains `REWORK` solely because the one-shot Requirement Planner has ten
semantic misses in the unchanged corpus. Stop here and have the Supervisor
choose the next Requirement-layer strategy; do not add a retry, Executor, or
case-specific compiler rule automatically.
