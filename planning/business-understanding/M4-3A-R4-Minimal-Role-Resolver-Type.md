# M4-3A-R4 — Early Reference Stop + Minimal Role + Resolver-Derived Type

## R3 root cause and responsibilities removed

R3 required the Role Classifier to decide request class, grounding need, five roles, and an entity type. In the first frozen smoke it emitted the literal example union `RECIPE/COIL/TEMPLATE/PART`, which the safe parser could not admit to the resolver.

R4 removes those responsibilities from the model:

- no Entity Type output;
- no Request Class output;
- no Grounding Need output;
- no `QUERY_ONLY` output;
- no Role call at all when a detected reference remains unresolved.

Business and Policy Agents remain frozen. Intent and Utterance are absent from this chain.

## Architecture

```text
Raw Owner Input ─┬─ Business Agent ─┐
                 ├─ Policy Agent ───┼─ Minimal Role Classifier ─ Gate ─ Resolver fan-out
                 └─ Reference Detection / Resolution ──────────┘
```

When deterministic Reference Detection finds a surface, the Reference Resolver receives only current and bounded recent raw Owner wording. `UNRESOLVED` returns `STOP_UNRESOLVED_REFERENCE` immediately: Role calls and resolver calls are both zero.

The Minimal Role Classifier can produce only:

```text
ROLE: <language span> | FORMAL_ENTITY_CANDIDATE
ROLE: <language span> | CONFIG_VALUE
ROLE: <language span> | CONCEPT_ONLY
```

The deterministic Gate stops concept-only output at `STOP_CONCEPT_ONLY`, config-only output at `STOP_NO_FORMAL_TARGET`, and calls the resolver only for formal candidates.

## Resolver fan-out and formal evidence

For every formal language candidate, the unchanged read-only `api/ontology/agentResolver.cjs` is invoked once for each authoritative prototype-supported type: `recipe`, `coil`, `template`, and `part`.

The prototype then derives entity type and status from those real resolver results:

- one type with candidates → that resolver-derived type, `EXACT` or `MULTIPLE`;
- no type with candidates → `UNRESOLVED`;
- more than one type with candidates → `MULTIPLE_TYPE`, with no silent type choice.

The isolated fixture uses the existing entity lookup service and preserves two formal `12-120` coils, two bare `V750` recipes, exact named templates, and style-qualified recipe aliases. It does not access production data, cost, inventory, BOM facts, or write APIs.

## Frozen upstream proof

| Source | SHA-256 before | SHA-256 after |
| --- | --- | --- |
| `businessAgent.cjs` | `d8a1cec5f921b975156d4226c7f068453480d44480a16c895a1dae590cf525ba` | `d8a1cec5f921b975156d4226c7f068453480d44480a16c895a1dae590cf525ba` |
| `policyAgent.cjs` | `36255ce44de279cd1be34f6ad18f423ba447c4c009cf9b8a1bc34c64b1545038` | `36255ce44de279cd1be34f6ad18f423ba447c4c009cf9b8a1bc34c64b1545038` |

## Evaluator contract changes

The R4 evaluator deliberately changes only these acceptance-contract aspects:

1. `QUERY_ONLY` is no longer required.
2. Entity type is evaluated from resolver evidence, not Role output.
3. Request class and LLM Grounding Need are removed.
4. Unresolved reference stops before Role, so it has no Role expectation.
5. Role spans use supported semantic containment: `换木箱` satisfies a `木箱` configuration expectation, but an unsupported addition such as `纸箱换木箱` fails if `纸箱` was not in Owner wording.

## Structural tests

`node --test tests/groundingLayerPrototype.test.cjs tests/businessPolicyIntentPrototype.test.cjs` passed **22/22**. The checks cover early reference stop, zero Role/resolver calls after unresolved reference, no-reference zero Reference LLM calls, minimal Role protocol, config/concept exclusion, formal-only fan-out, resolver-derived coil type, cross-type ambiguity, multi-target qualifier preservation, semantic-span evidence checks, frozen upstream hashes, zero Intent calls, and no production imports.

## First frozen DeepSeek targeted smoke

The first targeted execution used `DeepSeek / deepseek-chat`, the permitted network path, unchanged 10 R4 prompts, and the formal fixture. Full raw Memos, Reference/Role protocol output, resolver evidence, call counts, and timings are retained in [M4-3A-R4-Targeted-Smoke.json](M4-3A-R4-Targeted-Smoke.json).

| Case | Result | Evidence |
| --- | --- | --- |
| T-01 — unresolved `这个` + wood box | PASS | Reference `UNRESOLVED`; Role calls 0; resolver calls 0; `STOP_UNRESOLVED_REFERENCE`. |
| T-02 — unresolved `这个` + price | PASS | Reference `UNRESOLVED`; Role calls 0; resolver calls 0; `STOP_UNRESOLVED_REFERENCE`. |
| T-03 — V750 + wood box | PASS | V750 formal candidate; configuration did not enter fan-out; recipe result `MULTIPLE`. |
| T-04 — V750 + float | PASS | V750 formal candidate; float did not enter fan-out; recipe result `MULTIPLE`. |
| T-05 — V750 + electrophoresis | PASS | V750 formal candidate; electrophoresis did not enter fan-out; recipe result `MULTIPLE`. |
| T-06 — V750 + stainless shaft | PASS | V750 formal candidate; shaft process did not enter fan-out; recipe result `MULTIPLE`. |
| T-07 — 12-120 price | FAIL | Role output: `12-120 | CONCEPT_ONLY`; Gate stopped at `STOP_CONCEPT_ONLY`, so no formal coil evidence was retrieved. |
| T-08 — 12-120 scheme count | FAIL | Role output: `12-120 | CONCEPT_ONLY`; Gate stopped at `STOP_CONCEPT_ONLY`, so user-supplied “two” was not independently verified. |
| T-09 — Template vs Recipe | PASS | Both concept-only; zero resolver calls. |
| T-10 — resolved 12-120 reference | FAIL | Reference Resolver returned `UNRESOLVED / NONE` despite recent Owner wording `我先看看12-120。`; early stop correctly suppressed Role and resolver. |

The targeted total is **7 PASS / 3 FAIL**. Per the frozen prerequisite rule, the full M4-3A smoke and stability repeats were not run; `M4-3A-R4-Full-Smoke.json` was not created.

## Raw-output evidence and failure classification

The relevant raw model output excerpts are:

```text
T-07
ROLE: 12-120 | CONCEPT_ONLY
ROLE: 多少钱 | CONCEPT_ONLY

T-08
ROLE: 12-120 | CONCEPT_ONLY
ROLE: 两个方案 | CONCEPT_ONLY

T-10
REFERENCE_STATUS: UNRESOLVED
REFERENCE_SURFACE: 刚才那个线圈
RESOLVED_LANGUAGE_REFERENCE: NONE
```

No model-generated formal IDs, candidate IDs, final costs, planner/tool instructions, or writes were observed. The early-stop and resolver fan-out code followed their contracts in every targeted case.

| Classification | Count | Finding |
| --- | ---: | --- |
| Business Agent failure | 0 | Frozen Business output produced no confirmed failure. |
| Policy Agent failure | 0 | Frozen Policy output produced no confirmed failure. |
| Gate failure | 0 | All early-stop and formal-only gates behaved deterministically. |
| Resolver fan-out failure | 0 | T-03–T-06 retrieved type only from formal evidence. |
| Role Classifier model limit | 2 | It classified two formal-fact `12-120` questions as concept-only. |
| Reference Resolver model limit | 1 | It did not recover a unique explicit recent `12-120` antecedent. |
| Config promoted to entity | 0 | None. |
| Silent type/result selection | 0 | None. |
| Formal fact hallucination / planner leak / write | 0 | None. |

## Performance and regression gates

Targeted median timings: Business **2974.12 ms**, Policy **1818.59 ms**, Reference **0 ms** median, Role **954.57 ms**, resolver fan-out **0 ms** median, total **3262.41 ms**. The raw evidence includes per-case timings and the 30 actual model calls.

- Focused tests: PASS, 22/22.
- `npm test`: PASS, 2134/2134.
- `npm run verify:api-contract`: PASS, 29/29.
- `npm run test:deep-api`: PASS, 486/486.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `npm run test:ai-architecture`: PASS, 9/9.
- `npm run verify:ai-assistant-release`: PASS.

## Recommendation

R4 successfully removes entity type, request-class, grounding-need, and query extraction from the LLM, and it proves the unresolved-reference early stop and resolver-derived type boundaries. It does not meet the frozen 10/10 targeted acceptance criterion. Do not run full smoke, add word-specific routing, modify Business/Policy, or integrate with Planner/production Runtime in this phase. Return `REWORK`: the remaining failures are a Role Classifier concept-vs-formal-fact boundary and a Reference Resolver recovery failure.
