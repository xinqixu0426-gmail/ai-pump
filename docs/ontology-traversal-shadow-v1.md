# Bounded 2-Hop Ontology Traversal V1 — ONT-P5

## Scope and P0 evidence

Ontology V1 remains seven entities, six relation families and twelve directional A/B relations. P5 adds only deterministic explicit path binding and bounded composition of the existing ONT-P2 Canonical Relation Resolver. Current AI remains authoritative. There is no graph search, autonomous planning, third hop, model call, prompt modification or new tool/API/dependency/schema.

The original user-owned `docs/ontology-preimplementation-audit.md` was read in the original workspace and left unchanged. It records a 2-hop category and examples part → recipe → order, coil → recipe → order, customer → quotation → recipe, but not seven individual questions/expected IDs. The last example has no quotation → recipe edge in the actual V1 registry and is excluded. The new **P5_RECONSTRUCTED_2HOP_CORPUS** explicitly reconstructs meaningful questions from current business semantics and P0 classifications; it is not recovered historical corpus.

## Policy and centralized intent

`TraversalPolicyV1` in `traversalPolicy.cjs` is a small explicit whitelist, not all connectable relation permutations. Each path includes rationale and two anchored intent expressions. Root/type metadata, canonical receipt verification and exact mention matching reuse P4. Expressions establish the requested investigation only; they never establish a business relation fact.

| Path ID | R1 | R2 | Business investigation |
| --- | --- | --- | --- |
| part_recipe_order | part.contained_in_recipe | recipe.contained_in_order | A formal part's recipes and saved orders |
| coil_recipe_order | coil.used_by_recipe | recipe.contained_in_order | A formal coil's recipes and saved orders |
| template_recipe_order | template.used_by_recipe | recipe.contained_in_order | A shell template's recipes and saved orders |
| customer_order_recipe | customer.has_order | order.contains_recipe | Products saved in a customer's orders |
| order_recipe_part | order.contains_recipe | recipe.contains_part | Current formal BOM of recipes saved in an order |
| order_recipe_coil | order.contains_recipe | recipe.uses_coil | Current coils of recipes saved in an order |
| order_recipe_template | order.contains_recipe | recipe.uses_template | Current shell templates of recipes saved in an order |
| quotation_customer_order | quotation.belongs_to_customer | customer.has_order | Other saved orders of a quotation's formal customer |

Eight paths cover all six existing families. Order recipe membership uses saved canonical IDs; recipe BOM/coil/template are current definitions. This does not reconstruct order-time physical part consumption or historic recipe configuration. Provenance retains both distinct source receipts and their path direction.

`OntologyTraversalBindingV1` has BOUND_2HOP, PATH_NOT_BOUND, AMBIGUOUS_PATH, ROOT_NOT_CANONICAL, RELATION_NOT_SUPPORTED and INSUFFICIENT_CONTEXT. Binding requires a unique canonical root and an approved unique directional path. Root provenance follows P4 precedence: canonical exact receipt, verified formal result, existing exact resolver receipt; pronouns require trusted server-owned same-user/same-session context within the existing TTL. No resolver discovery is added. Duplicate names, fuzzy candidates, partial name collections, unsupported edges, hypothetical/negative/write/semantic/history questions reject.

Multiple investigation clauses reject **before** considering which roots current tools found. Resolving only one of two requested roots must never admit a single path. More complex language outside the grammar rejects conservatively. No path-specific branching enters assistant routing or shortlist.

## Contracts and structural validation

`OntologyTraversalRequestV1` version 1 accepts exactly ontologyVersion, root={entityType, canonicalId}, relationPath=[R1,R2]. IDs are positive safe decimal strings. Length must be exactly two; unknown fields, unknown edges, C/D/E candidates, wrong root type, non-adjacent types, direct inverses, any A → B → A type loop and structurally valid paths absent from policy reject before any resolver call. Frozen policy entries are validated at load.

`OntologyTraversalResultV1` version 1 contains status, root, relationPath, pathId, intermediateEntityType, targetEntityType, intermediateCount, targetCount, targets, complete, warnings, failedIntermediateIds, provenance, budget and timing.durationMs. Canonical targets include type/ID only. Validation checks fixed fields, identity types, canonical dedupe, matching source/path provenance, limits and exact UTF-8 serialized result bytes. No display names or business payloads are stored.

| Status | Meaning |
| --- | --- |
| COMPLETE | All membership reads complete, including verified empty |
| PARTIAL | Some intermediates fail; successful intermediate reads remain explicit partial data |
| UNAVAILABLE | First hop unavailable, or every second-hop read failed |
| ROOT_NOT_FOUND | Formal first-hop root absent |
| PATH_INVALID | Rejected before resolver execution |
| BUDGET_EXHAUSTED | Pagination, target, call or byte bound prevents completeness |

Only COMPLETE has complete=true. A successful resolver page with hasMore=true is not complete membership. Failed/incomplete/truncated intermediate IDs are retained. Technical failures and legacy ambiguity are warnings, never verified negatives. Known targets can remain in partial results with provenance; no partial result is admitted as a complete comparison.

## Execution, budgets and provenance

`createOntologyTraversal({resolver}).traverse(request)` invokes P2 for R1, then P2 R2 for each returned canonical intermediate, once per intermediate. It contains no SQL or per-relation query logic. Every successful resolver receipt is checked by P2's existing result validator before composition. No automatic pagination occurs.

Limits: max hop 2; one path/request; first-hop page/intermediates 20; second-hop resolver calls 20; each second-hop page 50; unique final targets 50; UTF-8 result bytes <=262143 (<262144). Byte expansion from provenance is bounded independently of target dedupe, with room reserved for warning/failure/budget metadata. More restrictive P2 scan/nested/payload limits remain in force.

Targets dedupe by entityType+canonicalId. Each target has one provenance record with all observed intermediate paths, up to 20. A path includes canonical root, [R1,R2], canonical intermediate and two low-sensitive receipts (relationId, registered sourceId, queryId, asOf). Target is the parent provenance identity. It proves root → R1 → intermediate → R2 → target without natural language inference.

The runtime worker opens SQLite physically readonly with query_only=ON and a 100ms lock timeout. An outer readonly transaction gives both hops one snapshot. Total_changes is checked. At most two workers run concurrently; each has a 2500ms deadline. Worker cleanup releases its slot before completion is returned, including timeout. Unavailable/budget/timeout observation fails open; no business DB helper is imported by the worker.

## Shadow integration and comparison

`AI_ONTOLOGY_2HOP_SHADOW_ENABLED=false` is default OFF and requires both parent `AI_ONTOLOGY_RELATION_SHADOW_ENABLED` and child `AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED` ON. It does not require a successful one-hop intent: two-hop intent has its own unique path binder.

The existing observer completes and records P3/P4 first, then starts the independent P5 layer without awaiting or changing the one-hop record. OFF or missing parent/binding gate executes zero traversals. The sole assistant change is passing the child flag in its existing post-answer async observer callback. No routing, tools, arguments, prompts, model context, TaskEnvelope, Presenter, EvidenceBundle, final answer or writes change.

Current-path comparison composes only existing verified canonical tool results through the P4 current-fact projection. All current first-hop membership and every second-hop target set must be canonical and complete; inverse membership needs a full unfiltered source collection. Missing details, filtered lists, ID-less saved references and prose-only conclusions are CURRENT_PATH_NOT_COMPARABLE. No extra current API query or LLM Judge is used. Only a complete traversal and complete current set produce MATCH/MISMATCH, comparing canonical identities. Bound intent, executed traversal, completeness, current comparability and independent oracle correctness are separate metrics.

## Observability and isolation

Span `ontology_traversal_shadow` exports `pump.ai.ontology.traversal.{hops,path_id,root_entity_type,intermediate_count,target_count,status,complete,duration_ms}`. No root IDs, target IDs, complete text, payload, names, prices or credentials are exported. Structured synthetic IDs remain local to controlled acceptance sinks. Exporter/sink/worker failures are fail-open.

ON/OFF tests execute the actual assistant with an approved, bound, COMPLETE traversal. They compare final content, provider messages/tool catalog, tool order/arguments, model call count and verified evidence, and assert writes remain disabled. Separate cases cover missing parent/binding flags and resolver/exporter failure. Worker tests prove physical DB bytes unchanged, timeout cleanup, partial failure semantics, canonical dedupe/provenance and byte budget under many duplicate target paths.

## Corpus and independent oracle

The separate clean fixture has recipes 301 and 305 sharing part601/coil501/template401; saved orders 101/103/104 overlap through those recipes; customer1 has orders101/102/103; quotation701 belongs to customer1. Expected target sets are fixture constants independent of traversal output. Sixteen positive cases cover two formulations of each of eight paths; twenty negative questions cover missing/noncanonical roots, absent intent, hypothetical/write/history/semantic queries, unsupported edges, multiple paths and untrusted pronouns. Structural and execution tests separately cover C/D/E, adjacency/inverses, one/three hops, pagination, fan-out, incomplete/ambiguous legacy, unavailable intermediates and forged resolver IDs.

The real corpus has 21 questions (16 positives plus trusted pronoun, missing root, hypothesis, unsupported path and ambiguous multiple paths), two runs. A pronoun case first executes an ordinary formal customer query in the same server session; seed requests and their model calls are separately reported, not ontology classifier calls. Current configured Provider/prompt/executor are reused unchanged. Controlled fixtures mount existing GET business routes only; unsupported knowledge endpoints can fail, and those cases remain in the corpus.

The runner reports canonical-root opportunities independently of BOUND, exact path/root oracle errors, target oracle mismatches, complete/partial/unavailable, current MATCH/not comparable and paired same-results P3/P4 equality. Runtime canonical root availability is not a guarantee of name uniqueness or supported grammar; recall is not a PASS gate. See `scripts/run-ontology-traversal-corpus.cjs` and local `logs/ont-p5-real-results.json`.

## Known gaps and next-stage boundary

P0's exact seven original questions were not saved. The policy excludes quotation → recipe and supplier/purchase entirely. Current AI may fail to collect complete canonical intermediates/final sets; P5 does not repair routing or discover missing entities. Binding grammar intentionally has limited recall, including rejecting multi-clause queries. Current recipe configuration and saved order IDs are different temporal scopes, explicitly retained in source provenance. Public SSE/authenticated UI/production transport are not exercised by the controlled assistant fixture. Both child flags remain default OFF and production configuration is untouched.

Two defects found during validation are retained in exploratory evidence: worker cleanup-slot release raced the next read; a multi-path question could bind the only resolved root. Both received public-layer boundary fixes and regression tests; the final corpus repeats all questions, including the failed ambiguous sample. No prompt changes or sample removal were used.

P5 does not authorize any 3-hop, graph planner, model tool, routing migration or user-visible traversal. Supervisor review remains required before the next phase. Rollback disables the independent 2-hop child flag; P3/P4 remain enabled/disabled by their existing switches.

## Final acceptance

Final local acceptance on 2026-09-18: **PASS**, subject to supervisor review. Start commit `4b2e8de48dddfcf4fcf77b6d871df9df8d89df95`; branch `codex/ont-p1-thin-contract`; worktree `C:\Users\Dan\Documents\pump-ont-p1`.

Deterministic corpus: 36 questions (16 positive opportunities/16 structurally bindable/16 correctly bound, 20 negatives with zero false positives). All 16 positive traversals COMPLETE; independent expected canonical target mismatches 0. The other structural/execution/isolation/telemetry tests exercise partial/unavailable/budget paths separately; P5 total 63 tests. All eight policy paths/six families are covered.

Final real Provider: **DeepSeek / deepseek-v4-flash**, unchanged runtime/prompt. 21 reconstructed questions run twice, 42 actual corpus executions; two ordinary same-session customer seed requests are separately recorded, each using two model calls. First corpus round: 12 bound/complete, 3 MATCH; second: 11 bound/complete, 3 MATCH.

| Real metric | Count |
| --- | ---: |
| Supported-path canonical-root opportunities | 23 |
| BOUND_2HOP | 23 |
| Traversal dispatched and completed | 23 |
| COMPLETE | 23 |
| PARTIAL / UNAVAILABLE / BUDGET_EXHAUSTED | 0 / 0 / 0 |
| Comparable | 6 |
| MATCH / MISMATCH | 6 / 0 |
| Traversal executed but current not comparable | 17 |
| Not bound (retained in corpus) | 19 |
| Wrong root/path or negative false positive | 0 |
| Complete traversal independent target oracle mismatch | 0 |
| Paired same-formal-results one-hop regressions | 0 |
| Shadow technical failures | 0 |

All eight allowed paths occur among real COMPLETE traversals. Binding statuses are BOUND_2HOP23, INSUFFICIENT_CONTEXT6, ROOT_NOT_CANONICAL1, RELATION_NOT_SUPPORTED6, PATH_NOT_BOUND4 and AMBIGUOUS_PATH2. Root opportunity means a known supported corpus path with its canonical fixture root present in existing verified current formal results, or the verified same-session seed for the pronoun; it does not invent an identity from user text. Not Comparable counts the 17 executed traversals lacking a complete current canonical composition; the 19 unbound cases are reported separately, not silently dropped.

The failed exploratory 42-execution run is retained in `logs/ont-p5-real-exploratory-results.json` and `logs/ont-p5-real.log`: two ambiguous multiple-path questions incorrectly bound one resolved root. Both exact questions remained in the final 42-execution corpus and reject as AMBIGUOUS_PATH. Final evidence is `logs/ont-p5-real-results.json` / `logs/ont-p5-real-final.log`. The final run used the fixed multi-clause admission and worker cleanup. A subsequent dedicated trace assertion verifies failed dispatch reports TECHNICAL_FAILURE rather than BOUND; successful real-corpus metadata is unchanged.

Regression: P1/P2/P3/P4/P5, relationRead, entity identity, actual assistant/evidence and observability focused **426/426**; full `npm test` **2424/2424**, no failures/skips; API contract **26/26**; isolated deep API **491/491**; Web build PASS; changed CJS ESLint and whitespace/UTF-8 checks PASS. Existing P4 24/24 deterministic positives and 0/25 negative false positives remain unchanged. One-hop MATCH semantics and target sets are equal with P5 OFF/ON on all 42 actual formal contexts; no correctness regression.

OFF/ON actual-assistant tests, including successful complete traversal and worker/exporter failure, prove equal answers, provider messages/tool catalog, tool sequence/arguments, model calls and verified evidence; writes remain disabled. Runtime workers and controlled corpus fixture leave database bytes and total_changes unchanged. No business DB/schema, public API/tool, package/lockfile/dependency, formal executor, routing/prompt, EvidenceBundle/TaskEnvelope/Presenter or production configuration change.

Original master remains `24106a1b41baa11a7a3e64e0fc78efa28121b271`; the sole user-owned untracked P0 audit is unchanged (SHA-256 `8930a71e60b28fb9238c34d31b0c813e56ef5b89ec1d72f6ccc05b8fbbb2151b`). All three switches remain default false. Delivery is local only: no new branch, merge, push or deployment.
