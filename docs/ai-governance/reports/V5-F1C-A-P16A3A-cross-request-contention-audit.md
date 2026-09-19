# V5-F1C-A / P16-A3A Cross-Request Shadow Contention Attribution Audit

## 1. Executive Result

Audit status PARTIAL. The prescribed controlled comparison completed, but the historical performance failure's primary root cause remains UNKNOWN. P16_A3_B_READY=NO; P16_B_READY=NO. Recommended production fix class: BLOCKED, not foreground-aware admission or lower concurrency.

Natural execution overlapped other foreground responses 288 times; test-only coordination eliminated all such overlap. Nevertheless, it did not consistently improve foreground latency. All nine natural p95 comparisons passed 10%; the historical two failing p95 sets were not reproduced. At load 8, the no-overlap control failed the 5% median gate in all three sets. This is evidence against treating overlap removal alone as a demonstrated remedy, not proof that cross-request contention never matters.

## 2. Frozen P16-A2/A3 Evidence

Frozen code: b98b5b81dca1d9fa3f482930a2aff9d95e10fa2c. Main branch master was dirty; user-owned changes were not edited, stashed, reset or cleaned. Execution modules were loaded from a detached clean worktree at that exact commit, using the existing installed dependencies via NODE_PATH. Node v24.16.0. No dependency changes.

P16-A2 established functional 15/15 and concurrent p95 overhead 10.5699%, 8.1557%, 10.5794%. Its 825 real executions had zero observed starts before their own response finish. Those results remain unchanged and valid for that historical measurement. P16-A3 stopped at the precondition and produced no new certification artifact; its supervisor return is the audit evidence, not an invented report file.

This audit is not a rerun of the frozen semantic corpus or a replacement performance certification. A2 used equal foreground timers; this audit predeclares 20 + 2 * burst-position ms to exercise overlapping foreground lifetimes. Results cannot establish the original failure's cause merely by comparison across stages.

## 3. Request / Shadow Timeline

Production static path: chat SSE headers/payload writes → dispatcher awaits V4 runtime → safe shadow facts and setImmediate scheduling → dispatcher returns → synchronous telemetry/cleanup → res.end(). Headers sent and end called are not the finish event. Existing mirroring begins projection/comparison/interpretation, then independentShadow invokes readExecutionShadow. There is no global foreground admission mechanism.

The harness records requestStart, v4ResponseCommit at HTTP finish, v5ShadowSchedule, v5ExecutionStart at the actual readExecutionShadow entry, and v5ExecutionEnd. All times are process-local performance.now durations, with generated request IDs only. It does not substitute shadow completion for response latency. Own-response early-start count remains zero.

Test-only wrapping delegates to the original readExecutionShadow with no injected Executor/fetch. In C only, that wrapper waits until the harness foreground set is empty. No production files, setImmediate behavior, queue, concurrency, binder, comparator or execution semantics are changed. This test coordination is not shipped as a production admission fix.

## 4. Cross-Request Overlap

Measured executions with at least one other foreground overlap: load 2 = 0/600; load 4 = 84/600; load 8 = 204/300, natural B only. All C overlap counts are zero. Pairwise overlap counts are 0, 96, 656; summed pairwise duration is 0, 140.0044 ms, 1303.0778 ms. Pairwise durations can double-count wall-clock time when several foreground requests coexist; they are not unique CPU-busy durations.

Foreground intervals are requestStart → finish. Only positive interval intersection counts; own-request intervals are excluded. These calculations have deterministic interval/nearest-rank self-tests.

## 5. Performance Methodology

Three rotated independent sets × loads 2/4/8 × modes A/B/C/D = 36 mode records, in one Node process and one immutable test snapshot. Each A/B/C cell contains 24 warmup and 200 measured foreground responses. Each D cell contains 24 warmup and 200 measured executions with no foreground request. All valid sets are retained; no threshold or percentile change, implementation tuning, or second audit run.

A: same synthetic interpreter path, execution OFF. B: natural production scheduler, actual execution ON. C: same real execution plus harness-only no-overlap coordination. D: same part-read Tool workload without foreground HTTP, resource baseline only. D uses the same simultaneous Tool burst width (2 or 4), not an eight-Tool overload.

Requests arrive in simultaneous bursts, with fixed foreground timers 20 + 2 * burst position ms. All shadow completion waits occur outside the response metric and before the next burst. B and C execute the identical enrolled workload. To prevent capacity skips from confounding the intervention, only the first min(load,4) foreground positions are enrolled in every A/B/C burst. Thus load 8 has eight foreground responses but four eligible shadows; it is not a certification of eight simultaneous shadow admissions or sustained saturation. No new queue/retry is used. This limitation is predeclared in the harness and dataset.

Real chain: independentShadow → readExecutionShadow → controlledRuntime → existing Executor → internalApiClient → official read-only part Business API. The existing A2 query-only snapshot harness is reused. Interpreter is a fixture result; model calls=0. Data source/Tool are the same in B/C/D; no business values are recorded. The fixture represents part reads, not all possible coil/recipe latency profiles.

Statistics use the A2 nearest-rank ceil(n*p) median/p95. Gate is median ≤5%, p95 ≤10%. B/A and C/A use controls from the same set and load. CPU and event-loop observations cover the measured mode including out-of-response shadow settling, not just foreground CPU time.

## 6. 2-Request Load

All values below are milliseconds; overheads are percentages against A in the same set.

| Set | A median / p95 | B median / p95 | C median / p95 | B overhead median / p95 | C overhead median / p95 | B overlapped executions |
|---|---|---|---|---|---|---:|
| 1 | 31.4040 / 35.7980 | 27.4520 / 32.1989 | 27.2327 / 34.9896 | -12.5844 / -10.0539 | -13.2827 / -2.2582 | 0 |
| 2 | 30.8700 / 34.6937 | 27.1872 / 34.3032 | 27.3574 / 32.6510 | -11.9300 / -1.1256 | -11.3787 / -5.8878 | 0 |
| 3 | 30.9194 / 35.2679 | 28.0520 / 34.4806 | 27.3890 / 33.8499 | -9.2738 / -2.2323 | -11.4181 / -4.0207 | 0 |

No natural execution/foreground overlap here, so this load cannot isolate the proposed mechanism. Negative overhead is a timer/workload observation, not negative execution cost.

## 7. 4-Request Load

| Set | A median / p95 | B median / p95 | C median / p95 | B overhead median / p95 | C overhead median / p95 | B overlapped executions |
|---|---|---|---|---|---|---:|
| 1 | 31.4031 / 37.6736 | 27.0466 / 39.3135 | 27.5020 / 40.6423 | -13.8728 / 4.3529 | -12.4227 / 7.8801 | 35 |
| 2 | 32.0583 / 37.8023 | 26.5145 / 39.5001 | 27.6804 / 38.8630 | -17.2929 / 4.4913 | -13.6561 / 2.8059 | 22 |
| 3 | 31.9673 / 37.3679 | 27.6641 / 40.3923 | 26.9461 / 39.8816 | -13.4613 / 8.0936 | -15.7073 / 6.7269 | 27 |

Both B and C pass all median/p95 gates. C's p95 is worse in set 1 and better in sets 2/3. No consistent pass/fail separation.

## 8. 8-Request Load

| Set | A median / p95 | B median / p95 | C median / p95 | B overhead median / p95 | C overhead median / p95 | B overlapped executions |
|---|---|---|---|---|---|---:|
| 1 | 33.3642 / 45.5886 | 36.5319 / 44.9455 | 37.0515 / 43.2937 | 9.4943 / -1.4107 | 11.0517 / -5.0339 | 73 |
| 2 | 31.8306 / 45.5814 | 32.4519 / 45.2266 | 35.7407 / 45.3564 | 1.9519 / -0.7784 | 12.2841 / -0.4936 | 70 |
| 3 | 33.3498 / 43.8819 | 34.0292 / 44.2850 | 38.0734 / 44.5496 | 2.0372 / 0.9186 | 14.1638 / 1.5216 | 61 |

B median fails set 1. C median fails all three despite zero execution/foreground overlap. All p95 comparisons pass. Foreground timer completion and remaining interpreter/projection scheduling still run on the same event loop; C isolates read execution, not every source of asynchronous workload.

## 9. Natural vs No-Overlap Control

Natural all median sets ≤5%: NO (8-request set 1). Natural all p95 ≤10%: YES. No-overlap all median ≤5%: NO (all 8-request sets). No-overlap all p95 ≤10%: YES.

The strong-evidence criterion “B consistently fails p95; C consistently passes” is not met. No-overlap does not consistently dominate B. Removing a measured overlap is not proof that the original +10.57% p95 failure has been repaired. No promotion or scheduling implementation is authorized by these data.

## 10. Internal HTTP Contention

Built-in undici diagnostics record request-create to response-body trailers/error under the execution's AsyncLocalStorage context. No URLs, headers, arguments, payloads or response values are copied. Each measured execution has exactly one completed HTTP interval; this is asserted.

Maximum concurrent V5 internal HTTP during foreground: B load 2=0, load 4=3, load 8=4; C=0. At load 4, windows with HTTP overlap have p95 41.3091/42.6319/41.4891 ms versus no-overlap windows 38.4425/38.8427/38.9914. At load 8, corresponding p95 values are 47.1848/49.1567/45.4762 versus 41.8268/43.7451/40.8076.

This association is confounded by foreground position: longer-lived requests are both more likely to overlap and intentionally have larger timers. It does not isolate network contention or establish an HTTP-specific causal effect. No separate network-only or CPU-only intervention was performed.

Mode D real execution median ranges: width 2, 3.0781–3.3699 ms; width 4, 4.9924–5.7172 ms (including load-8 enrollment shape). D execution p95 spans 5.3394–22.3142 ms. Variation exists without foreground, but this alone cannot classify the historical failure as harmless timing noise.

## 11. Scheduler Concurrency

Concurrency remains 4; no production queue exists. Maximum observed real executions running=4; capacity skips=0 with the predeclared bounded enrollment. At natural load 8, 113 foreground windows intersect three/four simultaneous executions; their p95 is 50.4130/49.2421/51.7173 ms by set. Position confounding applies again. At load 4, only two such windows occur, insufficient to establish a saturation-tail relationship.

monitorEventLoopDelay uses the built-in 1-ms sampling request. A/B/C observed p95 delay spans approximately 16.0–17.8 ms; D approximately 10.8–16.8 ms. This records actual delay, not an assertion of 1-ms timer precision. Mode CPU usage is roughly 4.1–57.7% of one core and does not demonstrate sustained whole-process CPU saturation. GC, timer phase and OS scheduling are not separately isolated. Lower concurrency is not justified by these observations.

## 12. Root Cause

Performance Primary Root Cause=UNKNOWN. Cross-Request Shadow Foreground Contention Confirmed=INCONCLUSIVE **as the cause of the historical performance failure**. Cross-request temporal overlap itself is confirmed.

Cannot confidently choose EVENT_LOOP_CONTENTION, INTERNAL_HTTP_CONTENTION, CPU_CONTENTION, SCHEDULER_CONCURRENCY_CONTENTION, MEASUREMENT_HARNESS_NOISE or NORMAL_TIMING_VARIANCE as primary. Aggregate resource metrics and correlation do not distinguish them causally. “MIXED” would imply identified causal components and is therefore not substituted for UNKNOWN.

## 13. Starvation Risk

If a future global foreground-aware admission policy is considered, STARVATION_RISK=HIGH under a continuous workload whose foreground-active count never reaches zero. New shadows could wait indefinitely. Any future design must bound retained work and drop/skip expired shadows, never block foreground requests. The burst-and-settle test does not measure sustained-load starvation duration.

## 14. Recommended Fix Class

BLOCKED. Foreground-aware admission recommended=NO at this point; concurrency reduction also not recommended. Do not turn the test-only barrier into production code. A supervisor-approved follow-up would need matched positional analysis and a discriminating experiment for timer/event-loop versus internal HTTP effects, retaining the current gates and historical failures. No such tuning or additional run was performed here.

## 15. Safety / Database

Measured actual executions: B=1500, C=1500, D=1800. Including warmup: 5376 real read executions and 5376 read-only Business API calls. Every execution asserts verification PASS, toolCalls=1 and writes=0. Model calls=0. Business mutation calls=0. No production routing or user-visible V5 output. Synthetic foreground status/body invariant was checked for every response.

Source DB and query-only fixture hashes, mtime and size are unchanged; source backup count209 unchanged. SHA-256 09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e, mtimeMs1788424936315.8767, size35323904. Unexpected backup=NO. All clean-worktree tracked-file hashes are identical before/after. Temporary worktree/snapshots are retained; no delete-to-pass.

Dataset contains safe IDs/timings/counts/statuses only; source-mention leakage assertion passed. No Tool args/results/binding values/canonical identity are captured. Observability exporter is disabled consistently; this audit does not claim Phoenix trace re-certification. Five pure metric assertions and syntax check pass. No production code changed, so full business regression/frozen15 were not rerun in this audit.

## 16. P16-A3B Preconditions

Complete: cross-request measurement, B/C matched executed workload, zero-overlap control, 3×24-warmup/200-measured foreground cells per load/mode, resource metrics, starvation assessment, immutable production/snapshot checks, no models/writes.

Unmet: identified primary cause and evidence-supported production fix. Therefore P16_A3_B_READY=NO, audit PARTIAL. Historical A2 performance certification remains failed; do not proceed to P16-B.
