# V5-F1C-B / P16-A3B Paired Performance Methodology Certification

## 1. Executive Result

Status PARTIAL. Thirty paired trials completed; all are VALID under the predeclared infrastructure-only invalidation rule. Performance Gate=FAIL: 23/30 pass, 7/30 fail. Median gate fails 1/30; p95 gate fails 6/30. No normal high-latency trial was discarded, replaced or rerun.

P16_B_READY=NO. Production architecture requires change=INCONCLUSIVE. Primary root cause=UNKNOWN. The experiment does not support certifying “no change required,” but neither does it uniquely establish a production scheduler defect. No production change is recommended pending a discriminating measurement decision.

## 2. Why Prior Benchmarks Were Inconclusive

Frozen code is b2c263d3370d69f5636ef0806d02779b30f571bc, carrying the unchanged b98b5b8 functional implementation. The A2 functional 15/15 remains historical evidence, not a new semantic evaluation. A2 failed two p95 sets. A3A measured real cross-request overlap, but eliminating it did not consistently improve latency. Those artifacts are not overwritten or reinterpreted as passing.

Prior block-level rotation in one long-lived process could not adequately separate mode order, accumulated runtime state and execution cost. This stage creates a fresh process for every paired trial, balances order, uses an identical nominal schedule per pair, and records actual delivery lag and connection reuse. It does not introduce a production foreground barrier.

## 3. Paired Methodology

Clean detached worktree at the frozen commit:
C:/Users/Dan/AppData/Local/Temp/pump-p16a3b-70f3b9276c254c31b27e1d1bdb360779.
Main worktree master was dirty; all user-owned changes remain untouched. Installed dependencies are reused through NODE_PATH; no dependency installation or configuration change. Node v24.16.0.

10 paired trials per nominal load 2/4/8. Every pair has one fresh Node process and one isolated query-only DB snapshot; OFF and ON share that process, fixture server, source resource, foreground server and keep-alive agent. Each mode has 24 warmup and 200 measured foreground responses. Total measured foreground=12,000; warmup=1,440. Fresh process cost was acceptable, so no long-lived multi-trial process was used.

Both modes use AI_V5_SHADOW_ENABLED=true, sample rate=1, the same 2-ms fixture interpretation, the same production scheduler and concurrency=4. The only configured intervention is AI_V5_EXECUTION_SHADOW_ENABLED. Actual execution is independentShadow → readExecutionShadow → controlledRuntime → existing Executor → internalApiClient → official part read API. Instrumentation calls the original execution function without a fake Executor, fetch replacement, barrier, queue or retry.

All foreground requests offer a shadow. Unlike A3A's deliberately limited four enrollments at nominal load8, production capacity determines actual admission here. Skips remain observable outcomes, not invalid trials. The test certifies neither every shadow executing nor all possible Tool workload mixtures; its execution resource is the same part-read fixture used in the earlier performance work.

The user metric is HTTP request arrival → server response finish, not client receive or shadow settlement. Actual execution completion is separately retained. The A2 nearest-rank ceil(n*p) median and p95 are unchanged. Even the large load4-trial6 p95 is retained as VALID/FAIL.

## 4. Order Balancing

A deterministic seeded shuffle generates exactly five OFF→ON and five ON→OFF trials for each load. Paired trials run serially; no parallel regression or background benchmark was launched by this audit.

| Load | OFF→ON passing/failing | ON→OFF passing/failing | OFF→ON median paired p95 overhead | ON→OFF median paired p95 overhead |
|---|---|---|---:|---:|
| 2 | 5 / 0 | 5 / 0 | -0.2996% | -0.4274% |
| 4 | 3 / 2 | 2 / 3 | +2.5108% | +11.8890% |
| 8 | 4 / 1 | 4 / 1 | +1.2352% | +2.8854% |

There is a load4 order association, but failures exist in both orders and order is not a sufficient explanation. The data cannot isolate JIT/cache warm state from GC or event-loop variation. Warmup is equal, not a claim that every hidden runtime state was perfectly reset between two blocks in a pair.

## 5. Request Schedule Equivalence

Both modes replay the same hashed plan: bursts at 80-ms offsets, each burst containing the nominal load's requests; position i has 20+2*i ms foreground work. Schedule hashes match within all30 pairs. Requests use identical body/status checks, client configuration and mix. No shadow-completion wait controls the next burst's intended arrival; final settlement occurs outside user latency.

Identical nominal schedule does not mean identical achieved wall-clock delivery. The generator and tested server share the process. Observed burst-lag p95 reaches 14.6799 ms OFF and 22.3511 ms ON. Measured peak foreground concurrency is OFF/ON: nominal2 = 2/4; nominal4 = 4/8; nominal8 = 8/8. Some ON stalls carry responses across burst boundaries. These are retained measured outcomes, but they prevent claiming perfectly matched realized active windows or an independently clocked load generator.

Foreground keep-alive configuration is identical, with maxSockets=8 and the same agent throughout each pair. Observed measured socket reuse: OFF6000/6000, ON5974/6000. Thus actual connection reuse is not byte-for-byte identical, despite identical settings and warmup. No reconnection was forced in either mode. Internal fetch/pooling is unchanged; OFF naturally has no execution-originated internal reads. This is a limitation to causal attribution, not grounds to delete trials.

## 6. 2-Request Results

Latencies/deltas are milliseconds.
| Trial | Order | OFF median | ON median | Delta ms | Median overhead % | OFF p95 | ON p95 | Delta p95 ms | p95 overhead % | Gate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| load-2-trial-1 | OFF → ON | 31.2094 | 31.3682 | 0.1588 | 0.5088 | 32.5133 | 32.4159 | -0.0974 | -0.2996 | PASS |
| load-2-trial-2 | ON → OFF | 31.5504 | 31.3488 | -0.2016 | -0.6390 | 35.9008 | 32.3682 | -3.5326 | -9.8399 | PASS |
| load-2-trial-3 | OFF → ON | 30.9323 | 30.8994 | -0.0329 | -0.1064 | 35.7087 | 35.9225 | 0.2138 | 0.5987 | PASS |
| load-2-trial-4 | ON → OFF | 31.4115 | 31.1336 | -0.2779 | -0.8847 | 32.1568 | 32.4610 | 0.3042 | 0.9460 | PASS |
| load-2-trial-5 | OFF → ON | 31.3695 | 31.2893 | -0.0802 | -0.2557 | 33.2463 | 32.5706 | -0.6757 | -2.0324 | PASS |
| load-2-trial-6 | ON → OFF | 31.2437 | 31.2310 | -0.0127 | -0.0406 | 32.2166 | 32.0789 | -0.1377 | -0.4274 | PASS |
| load-2-trial-7 | ON → OFF | 30.9151 | 31.0554 | 0.1403 | 0.4538 | 32.9043 | 32.6652 | -0.2391 | -0.7267 | PASS |
| load-2-trial-8 | OFF → ON | 31.2281 | 31.2008 | -0.0273 | -0.0874 | 32.6289 | 32.1644 | -0.4645 | -1.4236 | PASS |
| load-2-trial-9 | OFF → ON | 31.2549 | 31.2962 | 0.0413 | 0.1321 | 32.3542 | 32.5175 | 0.1633 | 0.5047 | PASS |
| load-2-trial-10 | ON → OFF | 31.2133 | 31.3164 | 0.1031 | 0.3303 | 32.4109 | 33.1672 | 0.7563 | 2.3335 | PASS |

## 7. 4-Request Results

| Trial | Order | OFF median | ON median | Delta ms | Median overhead % | OFF p95 | ON p95 | Delta p95 ms | p95 overhead % | Gate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| load-4-trial-1 | OFF → ON | 31.2641 | 31.4232 | 0.1591 | 0.5089 | 32.9711 | 32.4941 | -0.4770 | -1.4467 | PASS |
| load-4-trial-2 | OFF → ON | 31.3900 | 31.1551 | -0.2349 | -0.7483 | 35.8780 | 34.9261 | -0.9519 | -2.6532 | PASS |
| load-4-trial-3 | ON → OFF | 31.4274 | 31.2130 | -0.2144 | -0.6822 | 33.7942 | 37.8120 | 4.0178 | 11.8890 | FAIL |
| load-4-trial-4 | ON → OFF | 31.2723 | 31.1013 | -0.1710 | -0.5468 | 32.5123 | 37.2184 | 4.7061 | 14.4748 | FAIL |
| load-4-trial-5 | ON → OFF | 31.4747 | 31.1043 | -0.3704 | -1.1768 | 34.7636 | 32.2328 | -2.5308 | -7.2800 | PASS |
| load-4-trial-6 | OFF → ON | 30.9181 | 31.2103 | 0.2922 | 0.9451 | 34.0434 | 55.6580 | 21.6146 | 63.4913 | FAIL |
| load-4-trial-7 | ON → OFF | 30.8347 | 31.0101 | 0.1754 | 0.5688 | 32.7399 | 39.1956 | 6.4557 | 19.7181 | FAIL |
| load-4-trial-8 | OFF → ON | 31.6213 | 31.3109 | -0.3104 | -0.9816 | 33.6031 | 34.4468 | 0.8437 | 2.5108 | PASS |
| load-4-trial-9 | OFF → ON | 31.0326 | 31.1270 | 0.0944 | 0.3042 | 32.4693 | 35.9045 | 3.4352 | 10.5798 | FAIL |
| load-4-trial-10 | ON → OFF | 31.3941 | 31.2100 | -0.1841 | -0.5864 | 33.9128 | 32.5198 | -1.3930 | -4.1076 | PASS |

## 8. 8-Request Results

| Trial | Order | OFF median | ON median | Delta ms | Median overhead % | OFF p95 | ON p95 | Delta p95 ms | p95 overhead % | Gate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| load-8-trial-1 | ON → OFF | 32.0993 | 31.6064 | -0.4929 | -1.5355 | 37.2592 | 45.6735 | 8.4143 | 22.5831 | FAIL |
| load-8-trial-2 | OFF → ON | 31.4079 | 33.2627 | 1.8548 | 5.9055 | 45.7013 | 41.2602 | -4.4411 | -9.7177 | FAIL |
| load-8-trial-3 | OFF → ON | 31.4774 | 31.5939 | 0.1165 | 0.3701 | 45.2228 | 46.9146 | 1.6918 | 3.7410 | PASS |
| load-8-trial-4 | OFF → ON | 31.4363 | 31.7057 | 0.2694 | 0.8570 | 45.9748 | 46.5610 | 0.5862 | 1.2750 | PASS |
| load-8-trial-5 | ON → OFF | 31.4600 | 31.4570 | -0.0030 | -0.0095 | 46.3239 | 45.8608 | -0.4631 | -0.9997 | PASS |
| load-8-trial-6 | ON → OFF | 31.6333 | 31.7733 | 0.1400 | 0.4426 | 45.8247 | 47.4878 | 1.6631 | 3.6293 | PASS |
| load-8-trial-7 | OFF → ON | 31.5859 | 31.3478 | -0.2381 | -0.7538 | 46.2241 | 46.3673 | 0.1432 | 0.3098 | PASS |
| load-8-trial-8 | OFF → ON | 31.2943 | 31.3885 | 0.0942 | 0.3010 | 45.7748 | 46.3402 | 0.5654 | 1.2352 | PASS |
| load-8-trial-9 | ON → OFF | 31.6267 | 31.5365 | -0.0902 | -0.2852 | 44.8227 | 46.1160 | 1.2933 | 2.8854 | PASS |
| load-8-trial-10 | ON → OFF | 31.6086 | 31.4921 | -0.1165 | -0.3686 | 46.2278 | 46.2893 | 0.0615 | 0.1330 | PASS |

## 9. Absolute Latency

Across all30 pairs, OFF median30.8347–32.0993 ms, ON median30.8994–33.2627 ms; OFF p95 32.1568–46.3239 ms, ON p95 32.0789–55.6580 ms. These overall ranges mix load levels and must not alone be labeled baseline instability. The per-load/per-pair tables above are the authoritative comparisons.

The largest failed p95 increment is load4-trial6: 34.0434→55.6580 ms, +21.6146 ms / +63.4913%. The sole median failure is load8-trial2: 31.4079→33.2627 ms, +1.8548 ms / +5.9055%. Neither is rounded away.

## 10. Paired Overhead

Each percentage uses its own paired OFF denominator; no pooled OFF/ON latency ratio is used. Distribution medians also use the stated nearest-rank convention.

| Load | Median overhead min / median / max | p95 overhead min / median / max | Pass | Fail |
|---|---|---|---:|---:|
| 2 | -0.8847 / -0.0874 / +0.5088% | -9.8399 / -0.4274 / +2.3335% | 10 | 0 |
| 4 | -1.1768 / -0.5864 / +0.9451% | -7.2800 / +2.5108 / +63.4913% | 5 | 5 |
| 8 | -1.5355 / -0.0095 / +5.9055% | -9.7177 / +1.2352 / +22.5831% | 8 | 2 |

All valid median trials≤5%: NO. All valid p95 trials≤10%: NO. Hard certification FAIL regardless of favorable medians of the distributions. There were zero infrastructure-invalid trials and zero replacements.

## 11. Event Loop / GC Evidence

Node built-in PerformanceObserver records GC occurrence/start/duration/kind, and monitorEventLoopDelay records delay; no monitoring dependency added. Exporter is OFF consistently. Measurement statistics cover each measured block through settlement, whereas user latency is per-response finish.

OFF GC135 events /94.0748 ms total; ON GC499 /357.7736 ms. Execution allocates more and consumes more CPU, but those totals do not prove GC caused each threshold failure. OFF event-loop p95 range15.9334–17.5473 ms, ON15.8925–18.6450 ms; maximum delay OFF60.1620 ms, ON138.5431 ms. One-core-normalized CPU ranges OFF0.8063–19.6103%, ON6.3810–45.9414%; these are process metrics, not whole-machine saturation.

For example, load4-trial6 has ON loop p95 18.6450 ms and arrival-lag p95 21.1757 ms, along with its high response p95. But load4-trial8 has the largest loop maximum138.5431 ms and still passes the p95 gate. GC duration is greater in ON even in passing trials. Aggregate association is insufficient for a unique GC/event-loop root cause.

## 12. Internal HTTP Evidence

Built-in undici lifecycle events, correlated by AsyncLocalStorage, retain only intervals. Request URLs, headers, payloads, canonical identities and business values are not captured. Every measured execution has one completed internal HTTP interval. Maximum concurrent internal reads=4.

Measured cross-request execution overlap count=305; own-response early starts=0. Production scheduler capacity remains4. Total capacity skips including warmup are OFF1010 and ON1144. Most occur at load8; occasional delayed load4 bursts also exhaust capacity. These are real unchanged scheduler outcomes, not a new harness admission limit. Therefore eight foreground requests must not be presented as eight simultaneous executed Tools.

Total real controlled read Tools=5636 (5576 performance,60 before/after sanity); Business API reads=5666 including30 comparator reference reads. The measured performance execution count is4975; remaining performance executions are warmup. No Tool retry, write Tool, model call or production request was executed.

## 13. Root Cause

Performance Primary Root Cause=UNKNOWN.

The experiment establishes valid per-pair failures under the specified hard rule, but does not uniquely attribute them to TRUE_EXECUTION_SHADOW_OVERHEAD versus baseline/order/warm-state/GC/event-loop/load-generator effects. Mode order alone does not explain failures. GC and CPU cost increase with execution, while most pairs pass. Realized arrival windows and connection reuse are not identical; their contribution is not isolated from execution's effect on the shared process.

The observed incremental tail is a risk that remains uncertified, not dismissed as normal noise. Conversely, a failed all-trials gate is not itself proof that a particular production scheduler change is necessary. MIXED is not used as a substitute for unestablished causal components.

## 14. Production Architecture Decision

Production Execution Shadow Architecture Requires Change=INCONCLUSIVE.
Recommended Production Fix Class=BLOCKED_PENDING_MEASUREMENT_ATTRIBUTION.
No scheduler, concurrency, foreground barrier, HTTP bound, timer or other production optimization is recommended from these data.

The paired experiment and order balance are implemented and all trials retained. Full baseline-comparability certification is not claimed because achieved arrivals/reuse differ and stable threshold-exceeding causality is unresolved. A future supervisor decision could consider independently paced load delivery and a prespecified warm/connection methodology; that follow-up is not implemented or run here. Historical failures and this stage's seven failed trials remain intact.

## 15. Database / Privacy

Main source DB unchanged before/after; all30 query-only fixtures unchanged. Source SHA-25609b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e, mtimeMs1788424936315.8767, size35323904; backup count209 unchanged. Unexpected backup=NO. Temporary worktree/fixtures retained; no delete-to-pass.

All tracked files in the clean worktree have identical pre/post aggregate hashes, and the audit harness itself is unchanged through execution. User dirty files are not modified. No production code or dependency changes.

Functional sanity before/after every pair uses real read execution and the frozen A2 part comparator fields (ID, model, stock, price) against a formal API reference on the same snapshot. All60 sanity executions verify PASS and compare MATCH. Comparator positive/negative checks pass. All admitted performance read executions also require verification PASS and comparison MATCH. Business mutation/write/model calls=0.

Dataset contains timings, generated request IDs, count/status fields and configuration descriptions only. Source-mention leakage assertions passed; no args/results/binding values/raw entities are serialized. This is scoped dataset/harness validation, not a Phoenix trace re-certification. Pure schedule/order/quantile/interval checks and syntax validation pass. No paid frozen15 evaluation or production regression was rerun; production files are unchanged.

## 16. P16-B Preconditions

P16_B_READY=NO. The hard performance criterion fails7/30 valid pairs; production requires-no-change cannot be certified. Observed comparability limitations and causal uncertainty are explicit. Safety, actual read execution, fixture comparison, paired nominal schedule, order balance and immutable-code checks pass. Stop for Supervisor review; no P16-B implementation or production routing.

