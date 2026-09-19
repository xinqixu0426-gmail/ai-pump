# V5-F1C-C / P16-A3C Transport-Controlled Paired Performance Certification

## 1. Executive Result

Status=PASS. Performance Gate=PASS. All30 VALID paired trials pass the frozen median≤5% and p95≤10% gates: 10/10 at each load2/4/8. Invalid trials=0; replacements=0. Every trial is retained. P16_B_READY=YES under the Supervisor's certification gate; no P16-B implementation or routing is performed.

Production Execution Shadow Architecture Requires Change=NO within the tested controlled read workload. Historical A3B tail-failure primary root cause remains UNKNOWN: successful certification is not proof that one particular historical transport or runtime factor caused those failures.

## 2. Why A3B Was Inconclusive

Frozen start commit: 0da12765b351cf8bfb43013224c9ab3579793491. A3B recorded7/30 gate failures while OFF reused6000/6000 and ON5974/6000 connections; achieved send timing and foreground windows differed. Its shared load-generator/server process and same-process paired blocks could not isolate transport, pacing and accumulated runtime state.

This certification changes test orchestration only: a fresh equivalent server/execution process per mode block, a separate client process, preconditioned per-slot keep-alive connections, and preregistered parity rules. Historical artifacts are unchanged. The frozen functional15/15 is prior evidence, not rerun here.

Clean detached worktree: C:/Users/Dan/AppData/Local/Temp/pump-p16a3c-aa18806e1e904d0a97591bf461782c56.
Main master remains dirty with the original user-owned files untouched. Dependencies are reused through NODE_PATH; Node v24.16.0; no install or production environment edits.

## 3. Transport Control

Primary policy=FIXED_KEEP_ALIVE_PER_SLOT. Each load has exactly2/4/8 Node HTTP agents respectively, one agent per deterministic request position. Each uses keepAlive=true, maxSockets=1, maxFreeSockets=1, FIFO scheduling. All sockets are opened via test-only precondition requests before24 warmup requests; measured phase contains200 responses per mode. Foreground test server keepAliveTimeout=60000 ms in both modes. Internal Business API fetch/pooling is untouched.

Independent clients submit the same synthetic HTTP request/header sequence and validate the same constant response. No client executes the business Tool or simulates its result. Real execution remains independentShadow → readExecutionShadow → controlledRuntime → governed Executor → internalApiClient → existing read Business API on an isolated query-only snapshot.

Both modes enable Interpreter Shadow with identical fixture interpretation and sample=1. Only AI_V5_EXECUTION_SHADOW_ENABLED differs. No model calls. No override of scheduler4, admission, launch timing, Tool execution or retry. All requests offer a shadow; unchanged capacity skips are legitimate outputs.

## 4. Schedule Parity

Schedule seed=0x163c+load; seeded LCG generates0..2 ms jitter on80-ms burst offsets. Each burst has the load's request slots, foreground wait20+2*slot ms. All224 requests are predetermined before execution; there is no wait for shadow completion before the next planned burst. Schedule ID/hash and every measured planned/actual send time/deviation are retained.

Actual send time is captured in the external client's socket-assignment callback immediately before request.end(), so connection queue delay is not hidden as an on-time enqueue. Times are offsets in the client clock, not raw business data. Final settlement is outside the response-commit metric.

Frozen paired tolerance: absolute-send-deviation median difference≤2 ms; p95 difference≤5 ms. Prior shared-process loopback p95 lags14–22 ms justify treating timer granularity separately from parity; the new rule is stricter on paired differences and does not promise zero absolute Windows timer lag. Observed maxima: median difference 1.8957 ms; p95 difference 2.0069 ms. No rule was adjusted after formal launch.

## 5. Trial Validity Rules

Connection reuse must be200/200 and new measured connections0 in each mode, exact paired equality. Schedule hashes must match and deviation-difference tolerances must pass. Actual foreground arrival-event occupancy histograms must have total-variation distance≤0.05 (counts normalized by200). Full time windows and duration histograms are recorded separately.

Duration occupancy is descriptive rather than an invalidation criterion: longer response duration is the performance outcome itself. Rejecting a trial just for longer active duration would censor the effect being measured. This predeclared structural profile criterion checks achieved overlapping arrivals without discarding high latency.

Only transport orchestration parity failures permit a replacement, with the same order slot and at most10 additional attempts per load. Fixture/server/harness failures stop the session. Ordinary high latency remains VALID/FAIL. No invalid/replacement occurred, so no censoring or replacement-order issue arose.

Each mode gets a fresh equivalent process, fresh snapshot of the same source, pre-session sanity, pool preconditioning,24 warmup and200 measured requests, then post-session sanity.60 independent mode blocks. Orders are seeded, exactly5 OFF→ON and5 ON→OFF at every load. No parallel regression workload was launched.

Frozen harness SHA-256: 10b9e7b02d41d43b80361860a158ccedfb750419b673788ff07e6b0a14d73cae.
Pre/post clean tracked-file aggregate SHA-256: 629289f3fddd5d06885f1c0b09db1fa4589e58e297c9b58645278a6939c8c0d8.
Both unchanged. Pure ordering/schedule/quantile/interval and parity-rejection tests PASS before formal execution; final structural integrity/schema checks PASS.

## 6. 2-Request Certification

10 VALID pairs,10 PASS,0 FAIL,0 INVALID. Median overhead -0.1471–0.5623%; p95 overhead -0.7423–1.0483%.

All latency and delta values below are milliseconds; overhead values are percentages.

| Trial | Order | OFF median | ON median | Delta | Median % | OFF p95 | ON p95 | Delta p95 | p95 % | Gate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| load-2-slot-1-attempt-1 | OFF → ON | 31.2793 | 31.2789 | -0.0004 | -0.0013 | 32.3177 | 32.0778 | -0.2399 | -0.7423 | PASS |
| load-2-slot-2-attempt-2 | ON → OFF | 31.2204 | 31.2693 | 0.0489 | 0.1566 | 32.1686 | 32.2234 | 0.0548 | 0.1704 | PASS |
| load-2-slot-3-attempt-3 | OFF → ON | 31.2517 | 31.2076 | -0.0441 | -0.1411 | 32.2263 | 32.1627 | -0.0636 | -0.1974 | PASS |
| load-2-slot-4-attempt-4 | ON → OFF | 31.2415 | 31.3317 | 0.0902 | 0.2887 | 32.1676 | 32.2992 | 0.1316 | 0.4091 | PASS |
| load-2-slot-5-attempt-5 | OFF → ON | 31.2751 | 31.2291 | -0.0460 | -0.1471 | 32.2050 | 32.5426 | 0.3376 | 1.0483 | PASS |
| load-2-slot-6-attempt-6 | ON → OFF | 31.1390 | 31.3141 | 0.1751 | 0.5623 | 32.2768 | 32.2880 | 0.0112 | 0.0347 | PASS |
| load-2-slot-7-attempt-7 | ON → OFF | 31.2476 | 31.3256 | 0.0780 | 0.2496 | 32.0856 | 32.2574 | 0.1718 | 0.5354 | PASS |
| load-2-slot-8-attempt-8 | OFF → ON | 31.1772 | 31.2694 | 0.0922 | 0.2957 | 32.1319 | 32.2134 | 0.0815 | 0.2536 | PASS |
| load-2-slot-9-attempt-9 | OFF → ON | 31.2668 | 31.3428 | 0.0760 | 0.2431 | 32.1950 | 32.1659 | -0.0291 | -0.0904 | PASS |
| load-2-slot-10-attempt-10 | ON → OFF | 31.1899 | 31.3367 | 0.1468 | 0.4707 | 32.3217 | 32.1644 | -0.1573 | -0.4867 | PASS |

## 7. 4-Request Certification

10 VALID pairs,10 PASS,0 FAIL,0 INVALID. Median overhead -1.1953–0.1785%; p95 overhead -2.0996–4.1103%.

All latency and delta values below are milliseconds; overhead values are percentages.

| Trial | Order | OFF median | ON median | Delta | Median % | OFF p95 | ON p95 | Delta p95 | p95 % | Gate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| load-4-slot-1-attempt-1 | OFF → ON | 31.4173 | 31.3705 | -0.0468 | -0.1490 | 32.3350 | 32.6282 | 0.2932 | 0.9068 | PASS |
| load-4-slot-2-attempt-2 | OFF → ON | 31.3916 | 31.2137 | -0.1779 | -0.5667 | 32.4753 | 32.3419 | -0.1334 | -0.4108 | PASS |
| load-4-slot-3-attempt-3 | ON → OFF | 31.4840 | 31.3531 | -0.1309 | -0.4158 | 32.3899 | 32.2111 | -0.1788 | -0.5520 | PASS |
| load-4-slot-4-attempt-4 | ON → OFF | 31.4541 | 31.4852 | 0.0311 | 0.0989 | 32.2621 | 32.5295 | 0.2674 | 0.8288 | PASS |
| load-4-slot-5-attempt-5 | ON → OFF | 31.4079 | 31.2991 | -0.1088 | -0.3464 | 32.7735 | 32.1520 | -0.6215 | -1.8963 | PASS |
| load-4-slot-6-attempt-6 | OFF → ON | 31.5770 | 31.2751 | -0.3019 | -0.9561 | 32.5822 | 32.2058 | -0.3764 | -1.1552 | PASS |
| load-4-slot-7-attempt-7 | ON → OFF | 31.2570 | 31.3128 | 0.0558 | 0.1785 | 32.5778 | 32.2732 | -0.3046 | -0.9350 | PASS |
| load-4-slot-8-attempt-8 | OFF → ON | 31.4596 | 31.4318 | -0.0278 | -0.0884 | 32.5209 | 33.8576 | 1.3367 | 4.1103 | PASS |
| load-4-slot-9-attempt-9 | OFF → ON | 31.5273 | 31.3993 | -0.1280 | -0.4060 | 32.6673 | 32.3647 | -0.3026 | -0.9263 | PASS |
| load-4-slot-10-attempt-10 | ON → OFF | 31.5748 | 31.1974 | -0.3774 | -1.1953 | 32.8484 | 32.1587 | -0.6897 | -2.0996 | PASS |

## 8. 8-Request Certification

10 VALID pairs,10 PASS,0 FAIL,0 INVALID. Median overhead -0.9124–0.5433%; p95 overhead 1.0247–2.6611%.

All latency and delta values below are milliseconds; overhead values are percentages.

| Trial | Order | OFF median | ON median | Delta | Median % | OFF p95 | ON p95 | Delta p95 | p95 % | Gate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| load-8-slot-1-attempt-1 | ON → OFF | 31.9635 | 31.7617 | -0.2018 | -0.6313 | 46.0790 | 47.0854 | 1.0064 | 2.1841 | PASS |
| load-8-slot-2-attempt-2 | OFF → ON | 32.0036 | 31.7116 | -0.2920 | -0.9124 | 46.3733 | 47.0614 | 0.6881 | 1.4838 | PASS |
| load-8-slot-3-attempt-3 | OFF → ON | 31.8292 | 31.8226 | -0.0066 | -0.0207 | 46.7835 | 47.2876 | 0.5041 | 1.0775 | PASS |
| load-8-slot-4-attempt-4 | OFF → ON | 31.7767 | 31.6681 | -0.1086 | -0.3418 | 46.3770 | 46.9005 | 0.5235 | 1.1288 | PASS |
| load-8-slot-5-attempt-5 | ON → OFF | 31.5662 | 31.7377 | 0.1715 | 0.5433 | 46.4819 | 46.9582 | 0.4763 | 1.0247 | PASS |
| load-8-slot-6-attempt-6 | ON → OFF | 31.8492 | 31.8560 | 0.0068 | 0.0214 | 46.3879 | 47.2963 | 0.9084 | 1.9583 | PASS |
| load-8-slot-7-attempt-7 | OFF → ON | 31.5782 | 31.4936 | -0.0846 | -0.2679 | 46.2637 | 47.2784 | 1.0147 | 2.1933 | PASS |
| load-8-slot-8-attempt-8 | OFF → ON | 31.8375 | 31.8330 | -0.0045 | -0.0141 | 46.4221 | 46.9759 | 0.5538 | 1.1930 | PASS |
| load-8-slot-9-attempt-9 | ON → OFF | 32.0183 | 31.8753 | -0.1430 | -0.4466 | 45.9729 | 47.1963 | 1.2234 | 2.6611 | PASS |
| load-8-slot-10-attempt-10 | ON → OFF | 31.6112 | 31.7513 | 0.1401 | 0.4432 | 46.5753 | 47.3607 | 0.7854 | 1.6863 | PASS |

## 9. Connection Reuse Evidence

Measured OFF reused6000/6000, new0; ON reused6000/6000, new0. Measured connection attempts0/0. Each mode precreates exactly its pool width; total precreated sockets140 per mode across all loads. Connection reuse parity=PASS30/30. Pool size and fixed assignment are identical within each pair; no alternate transport policy was mixed in.

## 10. Send-Timing Evidence

| Mode | Median absolute deviation range ms | p95 absolute deviation range ms | Maximum absolute deviation ms |
|---|---:|---:|---:|
| OFF | 6.0847–9.1893 | 13.3011–15.4678 | 18.3429 |
| ON | 5.7790–9.4102 | 13.0423–15.4177 | 25.2656 |

Request Schedule Parity=PASS30/30. Absolute lag is not zero; both modes retain timer delay. Paired differences, not a post-hoc claim of exact timestamp equality, meet the frozen2/5-ms rule. Individual records are in each block's transport.records.

## 11. Foreground Profile Parity

Actual arrival-event occupancy histogram hashes match exactly30/30, stronger than the frozen≤0.05 variation requirement. Max foreground concurrency is exactly2,4,8 in both modes at the corresponding load. Planned schedule hashes also match30/30.

Each block retains active foreground count windows and duration histogram. These window durations need not be identical because response completion is an outcome, not an input forced equal by the test. No foreground barrier or response-dependent launch rule was introduced into production.

## 12. Absolute Latency

OFF median 31.1390–32.0183 ms; ON median 31.1974–31.8753 ms.
OFF p95 32.0856–46.7835 ms; ON p95 32.0778–47.3607 ms.

Gate metric=request arrival at the controlled foreground HTTP handler → response finish/commit. It does not wait for shadow completion or include client receiving the response. Foreground work is a synthetic V4-response surrogate with the real mirroring integration, not a live V4 model request. This is controlled certification, not a promise about every production workload or host.

## 13. Paired Overhead

All30 valid median overheads≤5%; all30 valid p95 overheads≤10%. Worst median +0.5623%; worst p95 +4.1103%. No pooled-average substitution.

The dataset additionally matches request sequence slots between modes. Per-pair matched-request delta medians range -0.3983–0.3267 ms; p95 deltas range 0.9282–12.2259 ms. The largest matched p95 delta is12.2259 ms even though distribution-level p95 gates pass: individual slot delays and distribution quantile differences are not the same statistic. This result is retained, not used to redefine the gate.

ON execution-completion block medians 4.3175–7.9153 ms; block p95 6.6140–29.7187 ms. These are separate shadow completion durations, not user-visible latency.

## 14. GC / Event Loop Evidence

OFF GC154, total 126.0207 ms; ON GC500, total 322.2296 ms.
Delta=+346 events and +196.2089 ms. Increased execution-associated GC persists despite every latency trial passing. There are no A3C failed trials against which to estimate a failure association; the increase alone is not proof of a latency-gate cause.

OFF event-loop p95 15.8597–16.0236 ms, maximum 17.4490 ms.
ON event-loop p95 15.9908–17.3343 ms, maximum 35.1273 ms.
One-core CPU ranges OFF 0.7577–31.6494%, ON 6.6735–31.4877%; these are process observations, not whole-host saturation.

GC/event-loop/CPU windows run from first measured arrival through measured settlement. Per-response latency remains strictly arrival→finish. No forced GC, new dependency or runtime tuning.

## 15. Internal HTTP Evidence

Measured ON internal reads=5000; max concurrent internal HTTP=4. Performance Tools including warmup=5600.120 before/after sanity Tools bring total actual controlled reads to5720 Tool executions. Including60 reference-comparator API reads, total Business API reads=5780.

Measured cross-request execution overlap=269; own-response pre-finish execution starts=0. Cross-request overlap remains present yet certified gates pass. This does not justify a foreground-aware scheduler modification.

Capacity skips including warmup: OFF1046, ON1120. At load8 only the unchanged scheduler's admitted tasks execute; eight foreground requests are not falsely reported as eight simultaneous Tools. Extra ON skips are retained effects of execution duration, not hidden exclusions. Internal HTTP is instrumented with AsyncLocalStorage plus built-in undici lifecycle events; no URL, header or payload is retained.

## 16. Root Cause

Performance Primary Root Cause=UNKNOWN for the historical A3B threshold failures.

A3C provides30/30 passing controlled pairs with exact reuse and structural foreground parity and bounded send deviation differences. It does not reproduce stable threshold failure attributable to actual execution. Execution still has measurable cost (all load8 p95 overheads are positive, GC increases, and cross-request overlap exists), but that cost remains within the approved gates.

The experiment jointly controls several prior confounders: connections, independently paced sending and fresh-process block state. It cannot uniquely apportion A3B's historical7 failures among those factors; labeling them specifically TCP, GC, or genuine scheduler failure would exceed the evidence. Historical failures are preserved, not dismissed or reclassified as invalid.

## 17. Production Architecture Decision

Production Execution Shadow Architecture Requires Change=NO for this certification scope, because30/30 VALID paired trials pass. Recommended Production Fix Class=NONE_REQUIRED_BY_CERTIFICATION. No stable controlled failure exists to justify any of the future production fix classes.

This is a bounded conclusion for the frozen part-read chain, fixed snapshot, Node/host and offered load schedule. Different Tool mixes or sustained production traffic are not benchmarked here. No scheduler change, concurrency tuning, write execution, default model switch or production rollout was made.

## 18. Safety / Privacy / DB

Functional sanity before and after all60 blocks=120/120 PASS. Actual read Tool results compare MATCH against the same query-only snapshot; every admitted execution requires verification PASS. Positive/negative comparator checks run in every block. Real Model Calls=0, writes=0, business mutation calls=0.

All60 fixture before/after safety checks pass; their initial DB hashes are identical (one distinct snapshot hash). Main DB hash/mtime/size/backup count unchanged:
SHA-256 09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e; mtimeMs 1788424936315.8767; size 35323904; backups 209. Unexpected Backup Created=NO. Snapshots/worktree retained, no create-then-delete-to-pass.

Dataset schema validation traversed357869 structural fields; forbidden raw mention, canonical identity, args/results, binding reference, prompt/response and secret field names are absent. Runtime source-mention leakage assertions pass in every block. Captured child stdout/stderr is not persisted as a raw log; only safe structured result markers are retained. Phoenix exporter is disabled consistently. Privacy PASS is scoped to this harness/dataset, not a new production trace-export certification.

Production and dependency files unchanged, verified by clean tracked-file hashes and final main diff. Original user dirty files remain untouched. No real frozen15 model evaluation or full production regression was rerun; the requested actual read/comparator sanity and deterministic harness checks were used.

## 19. P16-B Preconditions

P16_B_READY=YES: transport parity, schedule parity, foreground profile parity,30 valid pairs, all hard gates, functional sanity, read-only safety, DB integrity, privacy and production-code immutability pass.

This is permission readiness reporting only. No P16-B implementation, user-visible V5 answer, routing or cutover is performed. Exact historical A3B causal decomposition remains unknown and does not change the observed A3C certification result.

Delivery scope is limited to scripts/certify-v5-f1c-transport-performance.cjs, the safe certification dataset and this report. Commit/push identifiers are returned in the Supervisor return.

STOP — WAIT FOR SUPERVISOR REVIEW
