# M4-4J — Owner Demand Slots V1

## Status and scope

**REWORK.** Branch `ai-native/m3-optimization-v1`, source HEAD `62367fddabe31b7746c8994ea74ef4015051e6b2`. This is a prototype and side-by-side measurement, not a Planner freeze or production integration. Frozen Business Understanding, Domain Policy, Grounding V1, typed capability semantics, and the existing Plan Compiler were not modified. No Executor, Tool, Business API, DB, or write action was invoked.

## Why GOAL_KIND and TARGET left the model boundary

M4-4I asked the model to choose `GOAL_KIND` as well as result shape, scenario existence, metric and target cardinality. P-11 repeatedly produced the correct `DELTA + COST + SURFACE_TREATMENT` information while choosing the wrong Goal Kind. `TARGET` also repeated authoritative Frozen Grounding. M4-4J removes both fields, as well as LLM `GOAL_FACT`, status and selection. The model supplies only five demand slots; deterministic code derives targets, internal fact class, status and selection.

## Demand Slots V1 contract and result semantics

The only LLM fields are `RESULT_SHAPE`, `METRIC`, `RELATION_REQUEST`, repeatable `SCENARIO_OVERRIDE`, and `WRITE_REQUIRED`. Shape is `VALUE | LIST | COUNT | DELTA | DETAIL | NONE`; metric is `COST | NONE`; write is `YES | NO`. `VALUE` means one or several individual values, whereas `DELTA` means a difference. `NONE + NONE + WRITE_REQUIRED YES` means a write-only request, not a missing cost fact. The slot parser rejects forbidden LLM fields and malformed output; the validator checks closed sets and basic combinations. No capability catalog or API schema is shown to the slot model.

## Relation and scenario provenance

`RELATION_REQUEST` and every override expression must be an actual continuous owner-language span after only NFKC and whitespace normalization. No fuzzy or synonym repair occurs. Scenario class is model-supplied using the frozen Business Memo and the closed class set. The first targeted run exposed a general prompt-format defect: the model omitted the class after the override expression. A general line-protocol clarification fixed this. A second general formatting defect caused the model to append the literal `|NONE` to relation spans; the final prompt explicitly separates the present and absent forms. Both earlier measurements remain in `M4-4J-Demand-Slots-Targeted-Initial.json` and the `*-Protocol1.json` files. No case-specific answer was added.

## Deterministic semantic compiler

`compileDemandSlots()` maps `VALUE+COST` to `CURRENT_COST`, or `SCENARIO_COST` when an override is present; `DELTA+COST` to `COST_DIFFERENCE`; relation demand to `RELATION`; `COUNT` over a Frozen Grounding candidate set to `CANDIDATE_SET`; and concept `DETAIL` to no formal fact. Selection comes solely from Frozen Grounding cardinality plus the slots. Two explicit targets remain two targets, not ambiguity. For a write-only request, the adapter creates an inert `BLOCKED_POLICY` plan with no facts and no steps; this preserves the existing Plan Compiler semantics, which otherwise requires a goal fact. Invalid slots never enter the Plan Compiler. The existing Plan Compiler file and semantics were not changed. Semantic Compiler and Plan Compiler model calls are both zero.

## Key contrasts

- P-08 current coil: `VALUE + NONE + relation span` becomes `RELATION`. Final full run passed; repeat 5/5.
- P-09/P-10/P-11: packaging cost delta, float scenario value and electrophoresis cost delta are distinguished by shape plus scenario, without Goal Kind. Full run passed for all three. P-11 repeat was 4/5.
- P-12: the model sometimes classifies stainless-shaft processing as `SURFACE_TREATMENT` rather than `ROTOR_PROCESS`. The final full run then produced `READY` instead of the required `BLOCKED_CAPABILITY`. This is a real slot semantic failure, not a Compiler defect; no capability or override support was changed.
- P-13 vs P-17: preview/no-save requires `VALUE+COST+WRITE NO`, while write-only/save requires `NONE+NONE+WRITE YES`. P-17 was 5/5 in repeats; P-13 only 1/5, predominantly from metric drift.
- P-14 vs P-15: two recipes with `DELTA+COST` become a cost difference, while two coils with `VALUE+COST` become separate current costs. Both passed in full; P-15 repeat 5/5. Cardinality alone never selects comparison semantics.

## Targeted, repeat, and full evidence

Final targeted fresh calls: **13/15 final PASS**; slot 13/15, semantic compiler 15/15, Plan Compiler 15/15 safety/validity, zero intrinsic Compiler failure. The initial protocol run was 8/15; the intermediate protocol run was 12/15. Each is independently preserved, not blended into the final score.

Final repeat set (47 fresh calls): P-08 5/5, P-09 5/5, P-11 4/5, P-12 1/5, P-13 1/5, P-15 5/5, P-17 5/5, P-03 3/3, P-07 2/3, P-10 3/3, N-06 3/3; **37/47 final PASS**. No retry was used. Slot semantic pass was 37/47; the deterministic mapping compiled 42/47, while five invalid/incomplete slot results safely did not proceed to the Plan Compiler.

Final same-corpus full run: **Base 16/18, Negative 7/8, Overall 23/26**. Failures: P-07 output `LIST` instead of `COUNT`, with an unnecessary relation request; P-12 classed rotor processing as surface treatment; N-04 output `METRIC NONE` for an explicit scenario cost preview, so slot combination was invalid and no plan compiled. The full run used fresh DeepSeek `deepseek-chat` Demand Slots calls and the unchanged original owner wording. P-09 alone used the real frozen Business/Policy/Grounding chain; other cases used preserved frozen upstream fixtures to isolate model variance.

## Architecture benchmark

The full 26-case final score increased from M4-4D Requirement 16/26 and M4-4I Goal Spec 16/26 to M4-4J Demand Slots 23/26. M4-4H has no comparable full run: its P-11 repeat was 10/10, but P-13 0/3 and P-03 2/3. Demand Slots removed two LLM fields (`GOAL_KIND`, `TARGET`), requires no retry, and its median model time was 995 ms vs Goal Spec 1042 ms and M4-4D Requirement 1273 ms (different sampled runs, not a controlled latency comparison). Repeat variance remains high for scenario class and implicit preview metric; do not infer freeze readiness from one 23/26 full run. See `M4-4J-Benchmark.json`.

## Safety, gates and recommendation

No model-generated Goal Kind, Goal Fact or Target fields were accepted or observed in the final full run. No regrounding, invented formal ID, write step, Tool call, Business API call, DB access or visible write capability occurred. The incorrect P-12 class would produce a wrong *prototype plan* if trusted, so it is a material semantic failure; no plan was executed. Real capability gaps remain: formal wood-box packaging binding and unsupported rotor-process preview. The negative-case catalog omission is only a test fixture.

DS-01–DS-24 deterministic assertions passed (five Node test groups). Full repository gates passed: `npm test` (2214/2214), `verify:api-contract` (29/29), `test:deep-api`, `lint`, `build`, `test:ai-architecture` (9/9), `verify:ai-assistant-release`. Frozen upstream and Plan Compiler source diffs from the start commit are empty.

Recommendation: retain Demand Slots as the more promising prototype, but mark **REWORK** and do not freeze Planner V1 or retire the old prototypes yet. Supervisor review should focus on repeatable scenario class and implicit-cost semantic drift; this stage does not add retry, raw-text routing, or new capability rules.
