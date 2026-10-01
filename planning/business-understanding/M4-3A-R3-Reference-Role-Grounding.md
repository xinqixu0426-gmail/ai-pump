# M4-3A-R3 — Reference-First + Role Classification + Deterministic Grounding Gate

## Previous root cause

M4-3A-R2 exposed two independent faults for `这个换木箱多少钱？`:

1. The former Grounding Memo did not preserve `这个` as an unresolved language reference and instead promoted `木箱` to a recipe target.
2. The former pipeline treated natural-language Memo targets as executable resolver input even when the Memo said grounding was not required.

This R3 prototype replaces that direct Memo-to-resolver path. It does not alter production Runtime, Ontology contracts, the formal resolver, Business Agent, Policy Agent, their source documents, or their context construction.

## Architecture and contracts

```text
Raw Owner Input ─┬─ Business Agent ─┐
                 ├─ Policy Agent ───┼─ Role Classification ─ Deterministic Gate ─ Formal Resolver
                 └─ Reference Detection / Resolution ──────┘
```

- **Reference Detection** is deterministic and only identifies a reference surface. It does not infer an antecedent. No surface means no Reference LLM call.
- **Reference Resolver** receives only current and bounded recent raw Owner wording. It can return only `RESOLVED` language text or `UNRESOLVED`; it cannot return an entity type, ID, candidate, or resolver decision.
- **Role Classifier** receives Raw Owner Input, Business Memo, Policy Memo, and the language-only reference result. It can label expressions only as `FORMAL_ENTITY_CANDIDATE`, `CONFIG_VALUE`, `REFERENCE`, `CONCEPT_ONLY`, or `QUERY_ONLY`.
- **Gate** is deterministic: `CONCEPT_ONLY → STOP_NOT_REQUIRED`; unresolved reference → `STOP_UNRESOLVED_REFERENCE`; no formal role → `STOP_NO_FORMAL_TARGET`; otherwise `RUN`.
- **Resolver** sees only `FORMAL_ENTITY_CANDIDATE` entries. It keeps existing exact/approved-alias behavior and returns `EXACT`, `MULTIPLE`, or `UNRESOLVED`. It is never asked for final cost, stock, BOM, or a write.

The gate is fail-closed: an unresolved reference causes zero resolver calls even if a Role Memo contains other text. Configuration, reference, concept, and query roles are structurally excluded from resolver inputs.

## Frozen upstream proof

| Source | SHA-256 before | SHA-256 after |
| --- | --- | --- |
| `businessAgent.cjs` | `d8a1cec5f921b975156d4226c7f068453480d44480a16c895a1dae590cf525ba` | `d8a1cec5f921b975156d4226c7f068453480d44480a16c895a1dae590cf525ba` |
| `policyAgent.cjs` | `36255ce44de279cd1be34f6ad18f423ba447c4c009cf9b8a1bc34c64b1545038` | `36255ce44de279cd1be34f6ad18f423ba447c4c009cf9b8a1bc34c64b1545038` |

Business and Policy were independently run in the smoke. Intent and Utterance Extractor calls were both zero. The R3 pipeline contains no Intent or Utterance import.

## Ontology and resolver audit

The unchanged authoritative read-only path is:

- `api/ontology/contract.cjs` (`OntologyVersion = 1`)
- `api/ontology/agentResolver.cjs`
- `api/services/entityLookupService.cjs`

The experiment uses the existing resolver plus the existing entity lookup service over an isolated in-memory formal-identity fixture. The fixture contains two `12-120` coils, two bare `V750` recipes, approved style-qualified aliases, and named templates. It supports read-only identity verification only. No production database, final facts, or writes are involved.

## Structural invariant tests

`node --test tests/groundingLayerPrototype.test.cjs tests/businessPolicyIntentPrototype.test.cjs` passed **21/21**. The tests verify reference detection, zero Reference LLM calls where no surface exists, fail-closed unresolved reference behavior, language-only resolved references, all three stop gates, formal-target-only resolver input, multi-target and qualifier preservation, `MULTIPLE` without first-result binding, no fixture writes, frozen upstream files, and no production Runtime import.

## First frozen DeepSeek targeted smoke

The first R3 DeepSeek run used `DeepSeek / deepseek-chat`, the existing permitted network execution path, the eight frozen targeted prompts, and no provider fallback. Machine-readable raw outputs, Business/Policy Memos, Role Memos, resolver evidence, model-call counts, and timings are in [M4-3A-R3-Targeted-Smoke.json](M4-3A-R3-Targeted-Smoke.json).

| Case | Result | Evidence |
| --- | --- | --- |
| T-01 — `这个换木箱多少钱？` | FAIL | Reference correctly `UNRESOLVED`; Gate correctly stopped resolver at zero. Role classified `换木箱` as `CONFIG_VALUE`, semantically retaining the value, while the frozen evaluator expected the narrower surface `木箱`. |
| T-02 — `这个多少钱？` | FAIL | Reference correctly `UNRESOLVED`; Role Memo set `REQUEST_CLASS: CONCEPT_ONLY`, so Rule 1 won before the unresolved-reference safety rule. The expected request class was formal-fact/action. |
| T-03 — V750 + wood box | FAIL | Role Memo marked `V750` a formal candidate but emitted literal `RECIPE/COIL/TEMPLATE/PART` from the protocol example, which is not one allowed entity type. The parser safely rejected it; resolver was not called. |
| T-04 — V750 + float | PASS | `V750` was the sole recipe target; `浮球` was `CONFIG_VALUE`; formal resolver returned `MULTIPLE` without binding an ID. |
| T-05 — V750 + electrophoresis | FAIL | Same literal union-type output for `V750`; `做电泳` remained `CONFIG_VALUE`; parser safely withheld resolver input. |
| T-06 — 12-120 cost | FAIL | Same literal union-type output for `12-120`; parser safely withheld resolver input. |
| T-07 — Template vs Recipe | FAIL | Correct `CONCEPT_ONLY` class and zero resolver call. The model omitted the optional query-role line `区别` required by the frozen evaluator. |
| T-08 — 12-120 scheme count | FAIL | Same literal union-type output for `12-120`; no resolver input was admitted. |

The decisive safety goal for the prior R2 failure was achieved in T-01: no `木箱 → recipe` promotion and zero resolver calls for the unresolved reference. However, the frozen targeted acceptance criterion is **8/8 PASS**, and the first run is formally **1/8 PASS, 7/8 FAIL**.

## Raw Role-output excerpts

The raw evidence file is authoritative. The failure pattern was explicit rather than inferred:

```text
T-03
ROLE: V750 | FORMAL_ENTITY_CANDIDATE | RECIPE/COIL/TEMPLATE/PART
ROLE: 木箱 | CONFIG_VALUE | NONE

T-06
ROLE: 12-120 | FORMAL_ENTITY_CANDIDATE | RECIPE/COIL/TEMPLATE/PART

T-01
ROLE: 这个 | REFERENCE | NONE
ROLE: 换木箱 | CONFIG_VALUE | NONE
ROLE: 多少钱 | QUERY_ONLY | NONE
```

No raw Role or Reference Memo contained a model-invented formal ID, final business fact, tool plan, or write attempt.

## Full smoke, stability, and classification

Per the frozen R3 rule, the full M4-3A set and repeats were **not run** because the targeted prerequisite did not reach 8/8. Accordingly, `M4-3A-R3-Full-Smoke.json` was not created.

The targeted-run medians were: Business Agent **2887.60 ms**, Policy Agent **1839.22 ms**, Reference Resolver **0 ms** median (only two reference cases invoked it), Role Classifier **924.30 ms**, formal resolver **0 ms** median, and full pipeline **3740.49 ms**. The raw evidence retains per-case values.

| Classification | Count | Meaning |
| --- | ---: | --- |
| Business Agent failure | 0 | Frozen upstream Business output did not cause a confirmed failure. |
| Policy Agent failure | 0 | Frozen upstream Policy output did not cause a confirmed failure. |
| Reference failure | 0 | T-01/T-02 preserved unresolved reference and zero resolver calls. |
| Deterministic Gate failure | 0 | Stop gates and formal-target admission worked as implemented. |
| Role/output-contract failures | 6 | Four literal union entity-type outputs, one incorrect request class, and one missing required query-role line. |
| Config value promoted to entity | 0 | `木箱` / `浮球` / `电泳` did not reach resolver. |
| Silent first-result binding | 0 | T-04 preserved two V750 candidates. |
| Model-invented formal IDs | 0 | None observed. |
| Final fact, planner, or write leak | 0 | None observed. |

## Recommendation

R3 proves the deterministic Gate fixes the R2 pipeline bug: a Role Memo can no longer directly cause a resolver call, and unresolved references stop before formal resolution. It does **not** pass the frozen Role-classification acceptance smoke. Do not run full smoke, integrate the prototype, add keyword-specific routing, alter the frozen Business/Policy sources, or change the frozen case oracle in this phase. Return this evidence to the Supervisor as `REWORK`; the remaining issue is Role Classifier / output-contract reliability, not Resolver behavior or an Ontology mutation.

## Regression gates

- Focused prototype tests: PASS, 21/21.
- `npm test`: PASS, 2133/2133 under the permitted local-listener environment. The initial sandbox-only attempt could not bind its HTTP fixtures (`EPERM`) and was rerun unchanged with the permitted execution environment.
- `npm run verify:api-contract`: PASS, 29/29.
- `npm run test:deep-api`: PASS, 486/486.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `npm run test:ai-architecture`: PASS, 9/9.
- `npm run verify:ai-assistant-release`: PASS.
