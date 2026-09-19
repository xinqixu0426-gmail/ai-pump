# V5-E2 Production Shadow Mirroring

## 1. Executive Result

P13 adds one fail-open dispatcher hook that copies safe V4 structural facts into a bounded asynchronous V5 shadow mirror. V4 remains authoritative and never awaits the shadow. Deterministic, SSE, concurrency, performance, real-AI and Phoenix privacy checks pass. V5 model, Tool, Business API and write calls are all zero.

## 2. Frozen Baseline

- P12 commit: `961b90b9ec01efbe04e132ee883c8db001d620d2`
- Regression baseline: 1888/1889
- Known failure: missing `.guardian/config.yaml`
- Worktree clean at start: NO
- Existing user V4/AI modifications were preserved and excluded from P13.
- Start business DB: SHA-256 `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`, size 35,323,904 bytes, mtime UTC `2026-09-03T08:42:16.3158766Z`, backup files 209.

## 3. Shadow Architecture

The authoritative path remains `runAiDispatcherV3 → runAiAgentRuntimeV3 → V4 result`. After the result exists, the dispatcher copies a small safe fact envelope and schedules `shadowMirror` without awaiting it. Projection and comparison have no model/executor/API/DB dependency and return no user content.

The production import surface is one file: `api/services/aiDispatcherV3.cjs`. No V4 runtime loop, Prompt, route, resolver, Tool, executor, verifier or SSE file changed.

## 4. Feature Flags

- `AI_V5_SHADOW_ENABLED=false` by default; only exact `true` enables the hook.
- `AI_V5_SHADOW_SAMPLE_RATE=0` by default; valid range is 0 through 1, otherwise 0.
- Disabled mode exits before safe-fact capture and creates zero tasks/spans.

## 5. Eligibility / Sampling

Only uniquely mapped L1/L2 read Tool paths are eligible. Write, confirmation, critical, unknown and ambiguous Tool/risk paths are `SKIPPED_POLICY`. Sampling occurs only after eligibility. Tests prove rate 0 mirrors zero and rate 1 mirrors 100% of eligible reads.

## 6. V4 → V5 Projection

The production projection copies request/Trace correlation, runtime/status labels, read/write booleans, and Tool name/success/error-code structure. It never copies prompt/response, raw/normalized entity, Tool values, business values or customer/order data.

The current V4 return contract lacks safe intended-capability, validated-argument, entity-identity and verification facts. Production projections therefore remain `PARTIAL` with explicit reason codes. P13 does not expand V4 payloads or fabricate those fields.

## 7. Comparison Model

Statuses are `AGREE`, `V5_BLOCKS_V4_FAILURE`, `V5_FALSE_BLOCK`, `V5_INSUFFICIENT_DATA`, `NOT_COMPARABLE`, and `SHADOW_ERROR`. The deterministic harness produced:

- `V5_FALSE_BLOCK`: 0
- `V5_BLOCKS_V4_FAILURE`: 3
- `V5_INSUFFICIENT_DATA`: 1
- `SHADOW_ERROR`: 1 intentional error fixture

The P06 adapter additionally preserved C02 3/3, R02 3/3, and A01 2/2 structural blocks, with 0 false blocks across seven success controls.

## 8. Fail-Open / Async Isolation

V4 never awaits the shadow completion promise. All scheduling, projection, comparison and telemetry errors are contained. An intentional synchronous hook failure preserved the exact V4 object and original V4 exception semantics. Every asynchronous promise has a rejection handler.

## 9. Capacity / Timeout

- Max concurrent shadows: 4
- Queue: none
- Capacity outcome: `SHADOW_SKIPPED_CAPACITY`
- Shadow timeout: 100ms
- Timeout outcome: `SHADOW_TIMEOUT`

Capacity and timeout tests pass; timeout timers are unreferenced and diagnostic shutdown reaches idle without a process hang.

## 10. Privacy

Phoenix project `pump-ai-v5e2-shadow` contains an independent shadow root plus project/compare children. Eight sentinel categories have zero occurrences: secret, PII, business value, Tool argument, Tool result, raw entity, prompt, and response. All shadow attributes pass through the P04 sanitizer.

## 11. Deterministic Shadow Tests

The eight-case harness covers valid read success, C02 invalid state, R02 wrong Tool, A01 invalid arguments, write exclusion, critical/unknown exclusion, incomplete projection, and internal shadow error. P13 unit tests: 21/21 PASS.

## 12. SSE Equivalence

Shadow OFF and ON produce byte-identical deterministic SSE output, including event count, order, payload and termination. Existing route heartbeat, disconnect and timeout tests also pass with Shadow ON.

## 13. Concurrency Isolation

Ten concurrent eligible reads produced ten unique shadow task IDs, ten request IDs and ten Trace IDs. Cross-request contamination count is zero.

## 14. Performance Overhead

Benchmark: 5 warmups plus 30 measured OFF and 30 measured ON runs over the same 20ms synthetic V4 workload.

- OFF median: 20.0480ms
- ON median: 20.1297ms
- Median overhead: 0.41%
- OFF p95: 20.1133ms
- ON p95: 20.2678ms
- p95 overhead: 0.77%

Gate: PASS (<5% median and <10% p95). An initial 5ms microbenchmark amplified approximately 1ms Windows scheduling noise; the reported 20ms run is the stable risk-relevant measurement and remains far shorter than actual model latency.

## 15. Real V4 Success Shadow

One isolated real-provider read used a temporary database snapshot and local read-only Business API. V4 completed with one successful read Tool. V5 comparison was `V5_INSUFFICIENT_DATA`, not `V5_FALSE_BLOCK`, because the safe production projection intentionally lacks entity/argument/verification facts. V5 model/Tool/API/write calls were zero.

## 16. Real V4 Failure Shadow

One isolated Exact Identity failure-family read used V4 Investigation and the real provider. V4 returned `budget_exhausted` after three successful read Tool calls. V5 comparison was `V5_INSUFFICIENT_DATA`; P13 did not add missing facts or claim `V5_BLOCKS_V4_FAILURE`. V5 model/Tool/API/write calls were zero.

## 17. Business DB Safety

Final evidence after regression: SHA-256 `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`, size `35323904`, mtime UTC `2026-09-03T08:42:16.3158766Z`, and backup-file count `209`; all match the frozen start values. During early benchmark development, directly importing the production dispatcher in a plain diagnostic process triggered the repository's existing startup-backup behavior and created one DB plus one metadata file. Both P13-generated artifacts were identified exactly and removed; the script was changed to benchmark the hook without production startup imports. Backup count returned from 211 to the frozen 209 before further validation. The business DB hash, size and mtime never changed.

## 18. Regression Comparison

- Combined V5 A-E2 suite: 132/132 PASS
- Shadow ON safe V5/SSE suite: 136/136 PASS
- Full deterministic regression with Shadow OFF: 1909/1910
- Baseline comparison: 1888/1889 plus 21 passing P13 tests
- Sole failure: missing `.guardian/config.yaml` (same known failure)
- New regression introduced: NO

## 19. Production Isolation

- Production shadow import files: 1 (`aiDispatcherV3.cjs`)
- Production requests mirrored in isolated real test: 2
- Production requests routed to V5: 0
- V5 model calls: 0
- V5 Tool calls: 0
- V5 Business API calls: 0
- V5 writes: 0

Shadow spans are independent roots correlated to the V4 request/Trace; the inspected root had no parent and exactly the project/compare children.

## 20. Known Limitations

- Real production-safe outcomes are currently `V5_INSUFFICIENT_DATA` because V4 does not expose safe entity, argument-validation, intended-capability and verification facts at the dispatcher boundary.
- Sampling state is process-local and intentionally has no durable queue.
- The benchmark measures the bounded production hook around a synthetic workload, not paid-provider latency distribution.
- P13 validates two real read requests only; it does not run Repeat Stability.
- No production traffic was enabled or deployed; flags remain default-off.

## 21. V5-E3 Preconditions

V5-E3 requires Supervisor acceptance of the explicit production correlation gaps and the corrected transient backup side effect. P13 does not authorize V5 production routing, a second model/Tool/API call, writes, cutover, or legacy retirement.
