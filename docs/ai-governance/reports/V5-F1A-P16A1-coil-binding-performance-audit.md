# V5-F1A / P16-A1 Coil Binding + Performance Audit

## 1. Executive Result

Status: PARTIAL; P16_A2_READY=NO. Coil binding attribution is complete: the earliest missing fact is a server-attested, Tool-bindable business identity reference. Recommend Option B, not guessing which identity field owns a source mention.

The historical parallel metric did not execute the real execution boundary and did not measure an HTTP response commit. Its primary evidentiary defect is PARALLEL_REGRESSION_HARNESS_CONTAMINATION. Repeated clean synthetic tests pass the specified thresholds, including matched background-load controls. Nevertheless exact historical contention cannot be reconstructed from aggregate timing alone, and production execution architecture acceptance remains INCONCLUSIVE. A performance-harness correction and representative overlapping-request evidence are needed before claiming no architecture change is required. No fix is implemented.

## 2. Frozen P16-A Evidence

Start commit: d25abca8f58159a7a2de83236f84d7d47b9d13cf; master; dirty main preserved. Isolated detached worktree uses that exact commit, existing Node v24.16.0 and existing dependencies via NODE_PATH; no installation or environment-file change.

Read the frozen report, full evaluation JSON, execution document, registry/binder/runtime/state/policy, Tool schema/query executor/client, coil routes/queries, lookup service/resolver, independent shadow and scheduler. The full frozen result remains 15 selected Tools, 12 supported bindings, 3 unsupported coil bindings, 12 executions/successes/equivalences/evidence/verification passes. No frozen result was rerun or rewritten.

Three coil records: P06-COIL-001-LEGACY, P06-COIL-001-V4I, P06-COIL-001-V4R3. All have UNIQUE selection, capability/tool match, ARGUMENT_BINDING_UNSUPPORTED and NOT_RUN execution.

## 3. search_coils Contract

Authority: api/routes/ai/tools.cjs, aiToolInputValidatorV2.cjs, executors/queryExecutors.cjs, internalApiClient.cjs, routes/coils.cjs, services/coilQueries.cjs.

**There are no schema-required arguments.** An empty object is a valid list-all request, not a safe binding for this already-resolved single-entity task. Do not report spec or schemeCode as schema-required. V5 needs an authoritative discriminated filter for the intended entity.

| Argument | Type | Required | Semantic role / accepted identity form | Authoritative source at binder |
|---|---|---|---|---|
| spec | string | NO | stator specification or documented compound shorthand | MISSING |
| sheets | integer | NO | lamination sheet count | MISSING |
| material | string | NO | material category | MISSING |
| slotType | string | NO | slot category | MISSING |
| schemeCode | string | NO | stable scheme business code | MISSING |
| schemeStatus | string | NO | official/testing/disabled | MISSING |
| isDefault | boolean | NO | default scheme filter | MISSING |
| ratedVoltageV | integer | NO | rated voltage positive integer | MISSING |
| ratedFrequencyHz | integer | NO | rated frequency positive integer | MISSING |
| market | string | NO | market category | MISSING |
| schemeFamilyCode | string | NO | electrical scheme family | MISSING |

schemeStatus is an enum; rated voltage/frequency have minimum 1. No canonical id, coilId, generic query or keyword argument exists. Unknown fields are rejected by the validator. String whitespace normalization is present in the existing validator; the V5 binder independently requires unchanged validated arguments.

Executor converts the supplied structured filters, supports the documented specification/sheet shorthand, builds GET /api/coils query parameters and returns formal query rows/receipt. It does not reinterpret canonical entity ID as a scheme code. API getAllCoils filters the formal list by spec/sheets/material/slot/status/code etc.; schemeCode uses the existing uppercase business-code policy. These existing transformations are not modified.

## 4. V5 Authoritative Coil State

All three completed interpretations have source-exact raw identity, canonical entity ID, entity type, selected capability and a request-local resolution receipt. Source mention is string; canonical ID is string-backed; resolved type is coil. No values are persisted here.

Acquisition candidates carry matchKind, but the execution entity reference does not retain it. More importantly, neither layer carries canonical schemeCode or a matched-field discriminator. canonicalIdentity in the type-independent resolver means canonical database ID, not a scheme business code/name. Finalization selects exactly one authoritative candidate; it cannot reconstruct discarded binding metadata. Pre-routing structural page context is unavailable for these frozen requests; no downstream V4 inference is permitted.

## 5. Argument Binding Gap

Pipeline: exact lookup over scheme_code / scheme_name / spec / spec-sheet expression → SELECT id → minimal candidate {entityType, canonicalId, matchKind} → final entity → execution reference → binder.

The earliest loss is acquisition's minimal candidate projection: different formal identity fields yield the same undifferentiated ID/match-kind shape. rawMention exists but assigning it to spec or schemeCode is NOT_AUTHORITATIVE without a field attestation. canonicalEntityId is AVAILABLE for entity verification but SEMANTIC_MISMATCH for schemeCode. Every optional filter in the table is MISSING as an authoritative binding fact, not an obligation to invent all optional filters.

Primary: ENTITY_LOOKUP_CONTRACT_MISSING_BINDABLE_FIELD.
Secondary: TOOL_SCHEMA_NOT_CANONICAL_ID_ADDRESSABLE.
The explicit unsupported registry entry/binder branch is the safe stop, not the root cause.

Additional downstream readiness gap: readExecutionShadow.inspectReadResult currently implements only search_parts and preview_recipe_cost, returning false for search_coils. Merely unlocking the binder would not make coil evidence/verification pass. This is a separate future adapter/evidence acceptance concern, not the first argument-binding divergence.

## 6. A01 Safety

Preserved by the recommended design: software-owned canonical reference from the existing authority source, explicit reference kind, unchanged source mention kept separately, strict schema validation, receipt/type checks, canonical-ID result correspondence and ambiguity rejection. No model-generated args, guessed defaults, first candidate, free-text fallback or fuzzy resolution.

Focused clean tests: 3/3 existing binder/A01/source-identity tests pass. They make no model/API/Tool execution calls.

## 7. Coil Fix Options

| Option | Assessment |
|---|---|
| A — bind existing canonical ID directly | Not supported by the current Tool schema or coil query filter. |
| B — minimal lookup bindable reference | Recommended: a server-owned canonical scheme-code reference linked to the selected canonical ID, propagated without reinterpretation. |
| C — existing governed read enriches ID | GET /api/coils contains id and schemeCode, so enrichment is technically available by list then exact ID filter. No dedicated ID-read/filter exists; list acquisition is unbounded and overfetches. Reject as the preferred execution path. |
| D — canonical ID Tool/API support | Authoritative alternative, but broader Tool and query contract change than B. |
| E — replace search_coils | No evidence of capability/Tool mismatch. It is the existing formal coil read capability. |

Existing read path availability=YES, with the explicit unbounded-list limitation. GET /api/coils/:id/stock-movements is not a canonical identity enrichment endpoint.

## 8. Recommended Coil Fix

Option B. Future minimal lookup result may carry a discriminated business reference sourced from the already-matched row's scheme_code, rather than just the matched input field. This works even when the initial match was a formal name/spec field, without using raw input as a code. Existing Tool describes schemeCode as stable; migration creates unique index idx_coils_scheme_code; coilCommands normalizes scheme codes on creation. Validate nonempty uniqueness/business collation correspondence; missing/invalid references must remain unsupported.

Requires explicit entity-lookup candidate contract and strict consumer/provenance adaptation plus binder adapter; no Tool schema change or model argument generation. Current candidate validator enforces exact three-field keys, so adding an API field alone is insufficient. Future Supervisor scope must also address the separately unimplemented coil result inspector. No patch, schema migration, alias repair or API call performed here.

## 9. V4 / V5 Execution Timeline

runAiDispatcherV3 creates/fingerprints the input envelope before awaiting V4. Shadow-fact collection wraps V4. After V4 returns, safe-fact capture/hash/projection preparation and mirror eligibility/capacity bookkeeping run synchronously. mirror schedules setImmediate and returns without awaiting completion.

The chat handler then records telemetry and calls res.end in finally; streaming has already emitted V4 chunks during generation. The normal continuation is microtask work before setImmediate. The mirror has no explicit response-finish barrier, so this is scheduling behavior, not a guaranteed response-commit contract.

Synthetic HTTP probe follows that ordering with real envelope, safe-fact capture and scheduler; 495 shadow-enabled requests start independent shadow after res.end and server finish (0 before either). It does not invoke the production chat handler. Client receive latency is separately recorded and may overlap shadow work. Other active requests' shadows can compete with a later V4 response.

Answer: V5 execution before V4 commit is not observed in this probe; production guarantee PARTIAL. PRE_RESPONSE_SYNC_WORK=YES. Argument binding, controlled state/evidence/verification run inside the deferred execution chain, not before scheduling the same request.

## 10. Shadow Scheduler

Default concurrency=4; active-set capacity, no waiting queue; excess requests skip. Default launch is setImmediate followed by Promise microtasks. Projection/comparison precede independent interpretation; Tool execution follows resolved interpretation. Observer timeout does not release the slot until actual work settles. No production concurrency/timing setting changed. No evidence here justifies lowering concurrency.

## 11. Performance Harness Audit

Original test: five warmups plus 30 measurements, entire OFF block then entire ON block; 20-ms synthetic V4 timer; mirror() call; end timing immediately; await completion outside measurement. runIndependent is a 20-ms stub that returns counters. No real binder/Executor/Business API work runs in that benchmark. No HTTP response is committed.

Therefore the +19.0683% p95 is a real observation of that parallel timer/scheduler test, but is not evidence that actual read execution causes 19% V4 overhead. Parallel process scheduling/event-loop/timer wakeup and unpaired block timing are confounded. The later unchanged full-regression observation had p95 +0.2169%, reinforcing nonstationarity. There are no raw OS/load traces to distinguish historical CPU contention from timer noise precisely.

Audit harness: scripts/audit-v5-f1a-performance.cjs; three independent rotated-block sets; each mode 5 warmups + 50 measured. A=both OFF; B=fake interpreter ON, execution OFF; C=fake interpreter plus real controlled execution boundary with injected synthetic read result; D=C plus controlled same-loop CPU background (4 ms each 10 ms); A_LOAD=matched OFF background control. No real provider, Executor, business HTTP or DB. 750 measured +75 warmup requests; 330 synthetic execute injections, all verified.

Main metric: server response finish, with client receive and shadow completion separate. Same request waits for its shadow outside measured interval before next request. Consequently this is not a production overlapping-request throughput test. Observability exporter disabled consistently. Do not certify production latency from it.

## 12. Isolated Benchmarks

All values milliseconds; overhead compares the same set's A. Negative overhead is not a claimed optimization.

| Set | Mode | Commit median | Commit p95 | Median vs A | p95 vs A | Shadow completion median |
|---|---|---:|---:|---:|---:|---:|
| 1 | A | 30.1336 | 31.0922 | 0.0000% | 0.0000% | N/A |
| 1 | B | 31.1812 | 32.2256 | 3.4765% | 3.6453% | 45.9851 |
| 1 | C | 29.6073 | 31.1700 | -1.7466% | 0.2502% | 61.7714 |
| 1 | A_LOAD | 26.7432 | 27.7237 | -11.2512% | -10.8339% | N/A |
| 1 | D | 26.2108 | 29.4695 | -13.0180% | -5.2190% | 46.3586 |
| 2 | B | 31.0877 | 31.8538 | 2.7000% | 1.5905% | 46.0151 |
| 2 | C | 29.7368 | 30.9098 | -1.7628% | -1.4202% | 61.6772 |
| 2 | D | 26.4316 | 29.6303 | -12.6817% | -5.5009% | 46.0989 |
| 2 | A | 30.2704 | 31.3551 | 0.0000% | 0.0000% | N/A |
| 2 | A_LOAD | 26.4669 | 27.3788 | -12.5651% | -12.6815% | N/A |
| 3 | D | 26.0290 | 29.4022 | -13.9810% | -6.7310% | 46.4031 |
| 3 | A_LOAD | 26.7437 | 27.7134 | -11.6191% | -12.0882% | N/A |
| 3 | A | 30.2596 | 31.5241 | 0.0000% | 0.0000% | N/A |
| 3 | C | 29.6309 | 31.2180 | -2.0777% | -0.9710% | 61.7958 |
| 3 | B | 31.2547 | 32.2955 | 3.2885% | 2.4470% | 46.2539 |

B median +2.7000% to +3.4765%, p95 +1.5905% to +3.6453%.
C median -2.0777% to -1.7466%, p95 -1.4202% to +0.2502%.
These repeat clean synthetic gates PASS; C's lower timing is not proof of negative CPU cost.

## 13. Parallel Load Benchmarks

D versus matched A_LOAD: median -2.6724% to -0.1334%; p95 +6.0938% to +8.2235%, all within thresholds. D versus unloaded A is also retained in the table, not substituted as the meaningful execution increment.

Under load the same nominal 20-ms V4 timer produced lower commit medians than unloaded A, while client receive remained around 30–32 ms. This illustrates timer phase/wakeup and server-versus-client measurement effects; background CPU does not improve V4 business work. Controlled background is synthetic same-loop contention, not the original parallel test process mix or internal HTTP contention.

Dirty-main benchmark was not run: the imported audited modules are unchanged, but the dirty V4 runtime itself is intentionally not exercised. USER_DIRTY_WORKTREE_PERF_EFFECT=UNKNOWN; no attribution to user code.

## 14. Performance Attribution

Primary historical evidence classification: PARALLEL_REGRESSION_HARNESS_CONTAMINATION.
Supported contributors: MEASUREMENT_CONTENTION / NORMAL_TIMING_NOISE; these are not separable for the historical spike from available aggregates. Current controlled-load probe demonstrates measurable p95 competition without a threshold violation.

Not established: real execution CPU overhead, internal HTTP contention, concurrency-too-high, or launch-before-response-commit as the historical root cause. The old test did not run real execution, excluding its Tool work as the direct producer of that specific number.

Current P16-A performance architecture acceptable without code change: INCONCLUSIVE. Repeated tests narrow the problem to measurement evidence but cannot establish representative concurrent production acceptance or precisely reconstruct the +19.0683% event. No contradictory result is discarded.

## 15. Recommended Performance Fix

PERFORMANCE_HARNESS_FIX only at this decision point. Future evidence should use response finish/client latency, distinguish shadow completion, pair OFF/ON with identical controlled process load, retain per-set samples, and cover overlapping requests with fixture internal HTTP plus observability overhead. No model calls are needed for that attribution.

Do not yet recommend scheduler changes, lower concurrency, deferred execution redesign or moving synchronous prework: this audit does not identify them as necessary. Scope of further measurement must be approved; no performance implementation was changed.

## 16. Database / Privacy Safety

No production files or dependencies modified. No model calls, real Tool executions, Business API calls or business writes. Fixture Tool executions means 330 injected synthetic executor functions, not existing production Executor invocations. No business arguments/results/raw identities are in persisted audit records; synthetic fixture data exists only in audit code/runtime. No Phoenix exporter or business logger is started.

Source DB file checks: SHA-256 09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e, mtimeMs 1788424936315.8767, size 35323904; backup count 209. Post checks are recorded in the safe dataset. No DB connection or new data path used.

Only audit script, safe dataset and this report are committed. Existing dirty V4/runtime/resolver/docs/package/tests and untracked work are left untouched. Full business regression is not rerun for this audit-only change; focused checks and all benchmark assertions passed.

## 17. P16-A2 Preconditions

P16_A2_READY=NO pending closure of the performance evidence gap. Coil root cause and Option B are selected with A01 safeguards. Historical benchmark methodology defect is known, but precise contention attribution/current architecture acceptance is not proven; do not silently promote that to PASS.

Supervisor may approve a bounded binding-reference change and separately specify representative fixture-only overlapping-request performance attribution. Include the coil result-inspection readiness gap in any execution-completion scope. Do not fix binder, Tool/API, scheduler or dirty files in this stage; no frozen evaluation, P16-B or production routing.
