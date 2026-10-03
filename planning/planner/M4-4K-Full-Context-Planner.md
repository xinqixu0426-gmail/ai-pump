# M4-4K — Full-Context Planner Prototype

STATUS: REWORK. This is a side-by-side prototype, not a replacement for frozen Grounding or the Demand Slots path. No production runtime, formal business data, or write path was changed.

## 1. Why Planner Context Was Reopened

M4-4J Demand Slots scored 23/26 but still drifted on result shape, implicit preview, and scenario classes. This experiment gave one DeepSeek `deepseek-chat` Planner the raw Owner wording, complete Business and Policy memos, and a read-only catalog projection. It did not run a Grounding LLM, use retry, or execute tools.

## 2. Business / Policy / Grounding Handoff Audit

Twelve critical cases (`P-07` through `P-17` as applicable, `N-04`, `N-06`) received fresh Business and Policy Agent calls. Full memo text is in [upstream audit](M4-4K-Upstream-Handoff-Audit.json). The Business Agent used the full company model; Policy used the current formal policy documents. Frozen Grounding code and files were untouched. The catalog identity fixture was projected from existing frozen Grounding fixture output; it is **not** a current formal catalog.

## 3. Real Business Memo Evidence

P-12's actual Business memo explicitly identified 不锈钢接轴 as a Rotor process configuration. The Planner received that full text. P-13's actual Policy memo explicitly identified temporary configuration preview and the Owner's 不保存 instruction. No shortened one-line memo was substituted. Each audit row records whether the needed handoff fact was present; every row flags the unmatched current catalog as a fidelity gap.

## 4. Read-Only Catalog Snapshot

The official read routes are `GET /api/recipes`, `/api/coils`, `/api/templates`, and `/api/parts`; the prototype builder accepts authenticated read-only GET JSON for those endpoints. Local GET returned HTTP 401, and a single login attempt with an existing local credential also returned 401. No credential was stored in evidence. A separate `readonly=true`, `query_only=ON` diagnostic found 2 Recipes, 14 Coils, 1 Template, and 89 Parts, but their identities do not match the frozen 26-case corpus. That diagnostic was never the Planner catalog source and made no durable writes.

For comparable smoke only, the catalog was explicitly labeled `FROZEN_GROUNDING_FIXTURE`: 3 Recipes, 3 Coils, 1 Template, 0 Parts, 1,135 serialized record characters (about 284 tokens). Its source, snapshot time, record IDs, and names are retained. It does not validate the product hypothesis that a **real current** small catalog improves planning. See [catalog audit](M4-4K-Catalog-Audit.json).

## 5. Grounding Role Reduction Prototype

The Planner selected references from the catalog view. A deterministic identity validator checked entity type, ID existence, canonical name, query membership, duplicate IDs, and exact Owner-wording identity evidence. It distinguished `VALID`, `AMBIGUOUS`, `NOT_FOUND`, and `MISMATCH`; multiple candidates were not silently reduced to the first. Frozen Grounding remains intact for the existing architecture. No Grounding LLM was called in this experiment.

## 6. Full-Context Planner Contract

The full input includes raw Owner input (unchanged), full Business memo, full Policy memo, optional recent conversation, and the complete visible read-only catalog. The Planner emits a concise `PLANNING_BRIEF` plus `REQUEST_MODE`, `REQUESTED_RESULT`, `METRIC`, `REFERENCE_QUERY`, `SELECTED_REFERENCE`, `RELATION_REQUEST`, `SCENARIO_CHANGE`, and `WRITE_REQUIRED`. The brief is an auditable summary, not chain-of-thought. The Planner sees no capability catalog, endpoint schema, SQL, or database handle.

The adapter maps validated references and the Planner's business request into the existing deterministic typed Plan Compiler and Plan Validator. It does not execute a capability. The write-only adapter returns a policy block without a write step. A general admission-guard bug was fixed: a negated phrase in the Policy memo (“而非临时试算”) no longer masquerades as an explicit Owner no-save instruction. The existing Plan Compiler's semantic core was not changed.

## 7–14. Case Analysis

| Case | Observation |
| --- | --- |
| P-07 scheme count | 5/5 repeat; candidate set retained; no first-result binding. |
| P-08 current coil relation | 0/5 repeat; the model repeatedly changed requested result shape or relation span despite full context. |
| P-11 electrophoresis delta | 5/5 repeat; full Business context preserved SURFACE_TREATMENT and DELTA. |
| P-12 stainless shaft | 5/5 repeat; real Business memo contained Rotor process; compilation correctly retained the unsupported override gap and blocked capability. |
| P-13 cable + wood box | 5/5 repeat; real Policy memo said temporary preview and no save; both scenario changes retained; formal packaging binding still missing. |
| P-14 vs P-15 | In full run P-14 was incorrectly marked PREVIEW; P-15 lost a target / selected a reference not supported by Owner wording. Two targets alone did not guarantee reliable comparison-versus-separate-values semantics. |
| P-13 vs P-17 | P-13 preview succeeded repeatedly; P-17 protected write passed 4/5 repeat, with zero write execution. |

## 15. Repeat Reliability

Fresh one-shot Planner calls: P-07 5/5, P-08 0/5, P-11 5/5, P-12 5/5, P-13 5/5, P-15 2/5, P-17 4/5; 26/35 total. No retry. The relation and multi-reference failures moved rather than disappeared. See [repeat evidence](M4-4K-Full-Context-Repeat.json).

## 16. Full 26

Fresh Planner calls on unchanged Owner wording: Base 13/18, Negative 7/8, Overall 20/26. Failures: P-03 relation request, P-08 result shape, P-14 request mode, P-15 target/identity, P-16 result shape and metric, N-06 request mode and unnecessary relation. The deterministic compiler/validator remained safe in all 26 cases, but a safe compiled plan does not make a semantically wrong Planner result pass. See [targeted](M4-4K-Full-Context-Targeted.json) and [full evidence](M4-4K-Full-Context-Full.json).

After smoke, the exact Owner-wording identity guard was added. The preserved raw Planner memos were replayed through deterministic validation only, without new model calls; the evidence records `validationReplay` and the resulting scores. This distinguishes fresh model sampling from post-run validation reclassification.

## 17. M4-4J Benchmark

| Path | Full 26 | Main observation |
| --- | ---: | --- |
| M4-4J Demand Slots | 23/26 | Better observed final score, but scenario/shape drift remained. |
| M4-4K Full Context | 20/26 | P-11/P-12/P-13 improved in repeats; P-08/P-15 regressed. |

The same case wording was used, but M4-4K did **not** have an authenticated, matching current catalog. Consequently the result is a fixture-catalog prototype comparison, not a definitive production-catalog comparison. No architecture replacement is justified.

## 18. Context Size and Performance

Full-run median serialized Planner context was 2,831 characters. The fixture catalog contained 1,135 serialized record characters. Full-run medians: Business 3,136 ms, Policy 2,075 ms, Planner 1,445 ms, deterministic compiler 0.089 ms. Per-case raw, Business, Policy, catalog, and total character counts are in the JSON evidence. Broad context was not token-pruned.

## 19. Safety and Gates

No invented formal IDs, silent first-result bindings, write execution, Business API write, database write, tool execution, or frozen-upstream file change was observed. The Planner received no SQL/DB tool interface. Identity validation requires catalog-backed references; unverified selections cannot be executed. The catalog builder and smoke remain prototype-only. Deterministic FC-01 through FC-11 tests cover identity, context preservation, and write blocking. Full repository gate outcomes are recorded below after execution.

FULL_GATES: `npm test` PASS (2,218/2,218), `npm run verify:api-contract` PASS, `npm run test:deep-api` PASS, `npm run lint` PASS, `npm run build` PASS, `npm run test:ai-architecture` PASS (9/9), `npm run verify:ai-assistant-release` PASS.

## 20. Recommendation

Do **not** retire Demand Slots or reduce Grounding's production role based on this run. The full-context approach is promising for scenario semantics but scored 20/26 versus 23/26 and failed relation and multi-target reliability. A matching authenticated read-only test catalog is required for a fair validation of the open-catalog hypothesis. Supervisor should review the evidence before any further architecture change; Planner V1 is not ready to freeze.
