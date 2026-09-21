# V5-F1 / P16-A Read-Only Execution Shadow

## 1. Executive Result

Status: PARTIAL. P16_B_READY=NO. The first formal V5 governed read executions succeeded: 12/12 executed paths verified and matched the formal API comparator. All 15 paths retained correct capability/Tool selection, but three coil paths were blocked by a predeclared argument-authority gap. They remain in the applicable denominator, not removed to claim success. Performance evidence is PARTIAL, not a production-latency certification.

One formal evaluation, 15 recorded paths, 24 interpreter calls, 33 entity-lookup API calls, 12 Tool executions and 15 Tool-originated GET calls. No model Tool selection, write, user-visible V5 answer or production routing. Preflight separately executed 13 fixture Tool calls (three registry checks plus ten concurrent part reads), producing 14 GET calls and no model calls. Thus 25 real governed Executor invocations across formal plus fixture checks; 62 V5-related business reads including entity lookup. Twelve additional evaluator-only comparator GETs are not V5 executions.

## 2. Frozen V5-E4 Baseline

Start commit: `1d7205d90ccd2b21583fec9fb1b239dce4b57fda`; branch master; worktree clean at start: NO. User-owned V4/runtime/resolver/evaluation/document changes and untracked work were preserved. No stash/reset/clean was used.

Architecture V3, Top2, bounded nested refinement, prompts, model settings, source identity, lookup API, resolver, capability registry/router/exposure, contracts, policy and evidence definitions remain frozen. Only isolated read-execution modules, the independent shadow connection, scheduler accounting/capacity retention, tests, harness and documents were changed. No V4 implementation or Business API contract was changed.

## 3. Execution Capability Audit

All 15 frozen paths are applicable L1 / READ business requests; not applicable=0.

| Capability | Paths | Existing exposure | P16-A approved adapter | Predeclared status |
|---|---:|---|---|---|
| coil.read | 3 | get_coil_specs, search_coils | search_coils | ARGUMENT_BINDING_UNSUPPORTED |
| inventory.read | 9 | search_parts | search_parts | EXECUTABLE_READ_CAPABILITY |
| recipe.cost.preview | 3 | build_recipe_bom_draft, preview_recipe_cost, preview_pump_shell_cost, compare_recipes | preview_recipe_cost | EXECUTABLE_READ_CAPABILITY |

Unregistered exposed Tools do not become executable. Spec-catalog retrieval, BOM construction, parameterized shell preview and multi-recipe comparison have different input needs; they are not inferred from the current single-entity task.

## 4. Read Execution Registry

`api/services/ai-v5/readExecutionRegistry.cjs`, version 1, registers three existing read-only Tools and zero write Tools. Existing formal metadata reports access=read, no confirmation, no audit mutation, inherent idempotency. The reviewed branches reach canonical formal GET endpoints. Bound recipe preview has no overrides and therefore uses only the list/current-cost GET branch. No reviewed branch calls workflow-run recording or a command executor.

The fixture preflight called each registered existing Tool once through the actual governed Executor, then tested ten controlled concurrent part reads. The isolated DB was query_only; source DB and fixture hash/mtime/size stayed unchanged. Production V5 has no SQLite import or connection.

## 5. Tool Selection

Capability exposure intersected with the approved registry yielded exactly one Tool for each frozen path: 15/15 correct. The selector rejects zero/multiple matches. A second independent lock rechecks the formal Tool access and V5 risk/membership, so a write entry cannot gain authority through registry metadata alone. All WRITE_TOOLS are excluded by deterministic test.

## 6. Typed Argument Binding

`api/services/ai-v5/readArgumentBinder.cjs` binds only canonical recipeId or anchored part keyword, then uses the existing Tool schema validator. Any normalization change is rejected. It invents no optional filters, default strings, stock limits, overrides, or business facts.

Supported: 12/15. Unsupported: 3/15 coil paths. `search_coils` does not accept canonical ID; its spec and schemeCode parameters have distinct semantics. The minimal authoritative candidate contains type/ID/match kind, not matched field category. The binder cannot prove which field owns the source mention, so it refuses to guess. No fixture identity/frozen case mapping was embedded in the production adapter. A future authority-compatible solution requires a separate Supervisor decision.

## 7. Policy / State Gates

PASS in deterministic checks. Existing controlledRuntime routes and validates entity receipts, ToolRequest, exposure and policy before any Executor invocation. The actual routed task transitions EXECUTING → COLLECTING_EVIDENCE → VERIFYING and then legal terminal states. No fabricated state is introduced. Write-risk classes and formal write metadata are rejected independently. All invocations explicitly set allowWrite:false; enabling-write calls and business mutations=0.

The V3 finalization receipt is a request-local reference to completed authoritative resolution, not an invented canonical ID or business receipt. Missing, incomplete or unresolved interpretation cannot enter execution.

## 8. Real Tool Execution

Formal: search_parts=9, preview_recipe_cost=3, search_coils=0. Success=12, errors=0, timeouts=0. Max one Tool per execution plan, retry=0, at most 10-second timeout with AbortSignal through existing Executor/internalApiClient. Three coil plans stop before the Tool boundary.

Both flags must literally equal true. Default execution OFF; ordinary shadow alone executes zero Tools. Existing bounded async scheduler is retained; expired observer completion does not release capacity while underlying work is still running. No production flag/configuration was enabled.

## 9. Evidence / Verification

Twelve in-memory EvidenceLedger entries are VALID; verification PASS=12, FAIL=0, deferred=0, NOT_RUN=3. Existing three grounded requirement definitions were reused unchanged; the remaining deferred requirement catalog was not populated.

Evidence validation requires the actual formal query receipt and GET-only calls. Part results must be complete, contain exactly one row matching the authoritative canonical ID and have finite stock. Recipe results must match the canonical ID and provide finite current total without explicit pricing incompleteness. This establishes only the narrow existing inventory/current-cost claim. It is not a generic answer correctness guarantee or independent cost-engine recomputation. The COMPLETED state emits no composed answer.

## 10. Frozen Evaluation

One formal run; no real canary, prompt tuning, binder revision or repeat after seeing results. All 15 frozen path IDs, five source groups and original expectations retained. The harness recovers source fixtures only in memory and calls unchanged V3 interpretation followed by the production-connected execution boundary.

Actual existing HTTP routes run against an isolated snapshot using the project's test DB convention; background backup/copper schedulers are stopped before serving reads and query_only is enabled. There is no route-handler stub or direct Tool implementation call. Source business DB is never initialized or mutated by this harness. The diagnostic snapshot is retained, not deleted to pass a safety test.

All recorded pre/post freeze hashes match. Key frozen execution hashes:

| Component | SHA-256 |
|---|---|
| Read registry | acadca63cdd5eef372292823f68bceea4700aeef5ebbe9994f0c073bc4913577 |
| Typed binder | a462e665a4d0af8c374b157938004276f21752d356df0d1e75c83d4e5b2205b4 |
| Read execution | d7b877494d44f9164cb54946c00f0a1dbd378a000733662716783491bf9a58ca |

The safe dataset retains the full component/corpus/expectation hash manifests. No implementation changed after formal evaluation began.

## 11. Successful Controls

Seven frozen V4-success controls: four part paths completed and matched; three coil-success controls were safely blocked for unsupported binding. Thus end-to-end successful-control coverage is 4/7, not 100%. The former interpreter 15/15 baseline does not prove argument execution readiness.

## 12. Prior Failure Paths

Eight frozen V4-failure paths obtained independently correct capability, Tool, bound args, successful execution, verification and matching formal comparison. Classify these as V5_EXECUTION_BLOCKS_OR_AVOIDS_V4_FAILURE in shadow only. No production V4 failure was fixed. All three historical R02 wrong Tools remain excluded by the selected execution plan.

## 13. Tool Accuracy

Correct selection=15/15; unique=15; ambiguous=0; unsupported selection=0. Runtime executions=12/15 applicable. Coil's blocker is parameter authority, not routing or Tool-selection ambiguity.

## 14. Argument Accuracy

Validated binding=12/15 applicable; unsupported=3; invalid executed args=0. A01 deterministic tests reject missing canonical identity/receipt, wrong type and invalid source identity before execution. Recipe canonical IDs, rather than model-rewritten names, preserve Exact Entity identity through the governed call.

## 15. Result Equivalence

Comparator: live formal API on the same query-only snapshot. Part comparisons cover canonical ID, model, stock and price across the returned rows. Recipe comparison covers canonical recipe ID and current total. Time-dependent asOf and narrative summaries are not compared. MATCH=12/12 comparator-applicable executions, MISMATCH=0, NOT_COMPARABLE=3 blocked coil paths. No false success is inferred from success:true alone. These are bounded field-equivalence checks, not complete DTO or free-text answer equivalence.

## 16. Write Safety

V5 writes=0; write Tools executed=0; proposal/confirmation execution=0; enabling allowWrite=true calls=0; business mutation calls=0. No extra Tool schemas/model selection calls, no V5 user-visible responses, no production requests routed to V5. Fixture HTTP guard permits GET and the already-governed entity lookup POST only; SQLite query_only provides an independent test barrier.

## 17. Trace / Privacy

Phoenix project `pump-ai-v5-f1-read-execution`: 96 spans, 15 AGENT roots, 24 LLM spans, 45 CHAIN spans and 12 real TOOL spans. Every TOOL ancestry resolves to the matching V5 root; orphan=0, cross-trace parent=0, wrong Tool root=0. Existing Tool metadata records names, argument keys, result type and operation correlation only.

Scoped revalidation of exported attributes, evaluation records and observed runner logs found zero prompt/response, Tool argument/result values, raw entity, canonical ID, business values, PII or secrets. Fixture raw source/mention checks are transient. No business DTO was persisted. Evidence and verification are represented by safe outcome/state metadata, not newly added dedicated Phoenix spans; the trace does not claim more instrumentation than was observed.

## 18. Performance / Concurrency

Ten real controlled fixture reads passed; ten distinct synthetic fake-result tasks separately verified no argument/result/entity/evidence/state crossing. Contamination=0. Scheduler tests confirm immediate V4 response independence, existing capacity enforcement and capacity retention after observer timeout. V4 source behavior was not edited or model-reexecuted.

Formal read execution median=4.1405 ms, p95=113.4298 ms, measured on the local snapshot server, not production latency.

Synthetic scheduler benchmark (30 OFF + 30 ON; five warmups each): dedicated OFF median=30.861 ms, ON=31.3876 ms (+1.7064%); OFF p95=35.2524 ms, ON=35.0772 ms (-0.4970%). Parallel full-regression observation exceeded thresholds (+7.6711%, +19.0683%); a later full-regression confirmation measured -2.6448%, +0.2169%. All observations are retained; no best-sample-only claim. Performance Gate=PARTIAL because load-sensitive synthetic timings do not establish the requested invariant under production conditions.

## 19. Database Safety

Source and formal fixture remained byte-identical: SHA-256 `09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e`; mtimeMs=1788424936315.8767; size=35323904. Source backup file count remained 209. Hash, mtime, size and backup count unchanged; unexpected backup=NO. Separate fixture creation is a documented test snapshot, not a production backup or business write.

## 20. Regression

P16-A focused=13/13; combined V5=292/292. The old import-boundary test was updated only for the newly Supervisor-approved governed Executor import; frozen evaluation expectations were untouched. Full shadow-OFF confirmation=2078/2079, only known missing `.guardian/config.yaml` failure.

An earlier parallel full run had one additional MCP identity-catalog assertion failure. It passed before that run, in a focused unchanged test, and in the subsequent unchanged full confirmation. No MCP implementation/test was repaired; the observation remains a non-reproduced test-run instability, not a proven new execution regression. No reproducible new P16-A regression was found.

Deep API copperBase snapshot race remains the documented pre-existing B1-C attribution; it was not rerun or repaired in this stage. This report does not claim a new clean Deep API result.

## 21. P16-B Preconditions

P16_B_READY=NO. Blocking issues: three applicable coil paths lack safe typed binding; latency evidence remains PARTIAL. Broader source-field authority and any production performance certification require Supervisor review. Do not tune/re-evaluate this frozen implementation, modify Business API contracts, enable writes, add proposal execution, switch production routing or begin P16-B.
