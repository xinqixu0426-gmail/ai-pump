# P05 Observability Baseline Lock + Trace Integrity

## 1. Executive Result

P05 locked the current V4 observability contract without adding a new business span type or changing AI/business behavior. Trace Schema V1 is attached to every Agent root, a deterministic validator checks exported Phoenix spans, concurrent context isolation passed at 2 and 10 requests, OFF/ON normal and error outcomes were identical, SSE output was identical, privacy leakage remained zero, and all harnesses left the business database and startup-backup directory unchanged.

Final Phoenix evidence contains 57 P05 traces and 385 spans. The validator reports one root per trace, zero orphans, duplicate span IDs, invalid parents, cross-request/operation contamination, or spans outside the root lifecycle. The 30-run benchmark showed 0.62% median and 0.95% p95 overhead with local batch export outside the timed interval.

```text
V4_OBSERVABILITY_BASELINE_LOCKED=YES
TRACE_SCHEMA_VERSION=1
P06_REAL_AI_REPLAY_ALLOWED=YES
P06_READY=YES
```

## 2. Frozen Baseline

```text
P04_COMMIT=aab4f5dc46aae3827a9a41ba059eb2c2d60a2e55
BRANCH=master
WORKTREE_CLEAN_AT_START=NO
P04_REGRESSION_BASELINE=1767/1768
KNOWN_FAILURE=missing .guardian/config.yaml
PHOENIX_INITIAL_STATUS=HEALTHY
P05_PROJECT_INITIAL_TRACE_COUNT=0
```

All pre-existing user-owned V4/AI/document changes were preserved and excluded from the P05 change set.

## 3. Trace Schema V1

`PUMP_AI_TRACE_SCHEMA_VERSION=1` is defined in `api/services/observability.cjs` and exported on the Agent root as:

```text
pump.ai.trace.schema_version=1
```

It is telemetry-only and is not written to business data or returned through API/SSE output. The allowed V1 structure is:

```text
invoke_agent pump_factory_assistant [AGENT]
├── chat <model>                     [LLM]
├── execute_tool <tool>              [TOOL]
├── pump.ai.entity.normalize         [CHAIN]
├── pump.ai.entity.resolve           [CHAIN]
├── pump.ai.route                    [CHAIN]
└── pump.ai.verify                   [CHAIN]
```

`pump.ai.entity.extract=NOT_APPLICABLE`: no independent extraction stage exists. No fake stage was created.

## 4. Trace Integrity Validator

`scripts/observability-trace-integrity.cjs` accepts Phoenix/exported span objects and validates:

- root count and required root presence;
- orphan and duplicate span IDs;
- parent existence and same-trace membership;
- child/root lifecycle bounds;
- allowed V1 span names;
- trace ID consistency;
- root schema version;
- canonical complete-path order;
- expected request/operation isolation.

Its CLI fetches all Phoenix span pages rather than relying on UI inspection or the first result page.

Final output:

```text
trace_count=57
root_count=57
orphan_count=0
duplicate_span_id_count=0
invalid_parent_count=0
span_after_root_end_count=0
invalid_name_count=0
required_root_present=true
trace_id_consistency=PASS
schema_version=1
schema_version_valid=true
canonical_order_trace_count=53
canonical_order_failure_count=0
execution_order=PASS
```

## 5. Parent / Child Integrity

Every non-root span references an existing span ID in the same trace, every root has no parent, and all 57 roots are unique. No LLM, Tool, Entity, Route, or Verify span crossed into another trace.

Phoenix timestamps expose sub-millisecond clock conversion differences: a small number of sync child end values can appear less than 1 ms beyond the recorded root end even though the causal parent context is correct and production code ends the child before returning to the root. The validator therefore applies a documented `TIMESTAMP_TOLERANCE_MS=1`; beyond that precision bound, the count is zero. It still fails fixtures with genuine lifecycle/order violations.

## 6. Execution Order

For complete normal traces, the validator uses end-to-next-start relationships and the same 1 ms SDK timestamp tolerance:

```text
LLM #1 end
→ route
→ TOOL
→ LLM #2
→ verify
```

Entity normalization occurs between LLM #1 and route in the P05 harness, reflecting actual invocation order without being fabricated into the required sequence. All 53 complete traces passed; four model/tool error traces were correctly treated as incomplete paths rather than forced to contain later stages.

## 7. Concurrent Context Isolation

Two concurrent requests:

```text
traces=2
unique request correlations=2
cross-request contamination=0
cross-operation contamination=0
PASS
```

Ten concurrent requests:

```text
traces=10
unique request correlations=10
cross-request contamination=0
cross-operation contamination=0
orphan spans=0
duplicate span IDs=0
PASS
```

The runs used real OTel async context and local Phoenix export with fake model/tool behavior. Each run contained Agent, two LLM calls, Tool, Verify, Route, and normalization spans.

## 8. Disabled / Enabled Equivalence

The same fixed request, operation, fake model/tool, verification, and final response produced this canonical result hash in both states:

```text
OFF=851386807adf3e96e9477617cc1ed826d2c38fd196b7b3a9600e7bfc78b5b28f
ON =851386807adf3e96e9477617cc1ed826d2c38fd196b7b3a9600e7bfc78b5b28f
```

Status, runtime-visible tool result, model results, and final deterministic response matched exactly. Telemetry state was excluded from the canonical business result.

## 9. Error Path Equivalence

OFF and ON canonical hashes matched for all required deterministic failures:

```text
model failure:
fe20392b0265b7d968b8a7040813f68220cd6f96c346cb4d9d3b3b7898536111
status=model_error type=RangeError code=P05_MODEL_FAILURE

tool failure:
123e284be3ba2737fc97c3e09e8d9c323bbb9816f378c6ad567181d2b3e0dffb
status=tool_error type=TypeError code=P05_TOOL_FAILURE

verification failure:
912049b2532f76edd655b6676be2e6e2ed93a7bc3275be7e90518070f6fecf16
status=failed_unverified
```

Tracing did not change error type, code, status, returned runtime outcome, or exception handling.

## 10. SSE Equivalence

A deterministic test executed the existing `handleAiChat` SSE lifecycle with the Agent wrapper disabled and enabled. Headers, serialized event payload, event count/type/order (`provider → content → done`), telemetry totals, response termination, and writable-ended state were deeply equal. No buffering or SSE production code changed.

`SSE_EQUIVALENCE=PASS`.

## 11. Test Database Isolation

Before the first P05 harness:

```text
business DB SHA-256=09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E
size=35323904
mtime UTC=2026-09-03T08:42:16.3158766Z
backup file count=209
```

After every harness, fail-open run, benchmark, targeted suite, and full regression:

```text
business DB SHA-256=09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E
size=35323904
mtime UTC=2026-09-03T08:42:16.3158766Z
backup file count=209
```

Every P05 harness sets `NODE_ENV=test` and `PUMP_TEST_DATABASE_PATH` before loading the dispatcher/business modules, migrates only a temporary database, closes it, and removes the temporary directory. No production/startup backup was created during P05.

## 12. Phoenix Project Isolation

```text
PROJECT=pump-ai-p05-integrity-test
INITIAL_TRACE_COUNT=0
FINAL_TRACE_COUNT=57
FINAL_SPAN_COUNT=385
pump-ai-v4-baseline=NOT_FOUND / 0 traces
```

All enabled P05 integration, mode, error-baseline, concurrency, and benchmark traces were sent only to the P05 project. Disabled and Phoenix-down runs exported no trace.

## 13. Privacy Revalidation

The fully paginated 385-span Phoenix representation was searched after final execution:

```text
secret=0
PII=0
business value=0
tool argument value=0
tool result value=0
raw entity=0
normalized entity=0
prompt=0
response=0
```

The validator and harness output contain only synthetic status/correlation/performance evidence. No real business or customer content was used.

## 14. Content Mode Verification

Actual Phoenix traces confirmed:

- `off`: every child attribute map is empty; the root contains only `pump.ai.trace.schema_version=1`. Span name/kind/timing/status remain in Phoenix's structural fields.
- `metadata`: P03/P04-approved safe structural, correlation, GenAI, and OpenInference metadata remain; raw sentinels are absent.
- `diagnostic`: the same content boundary remains in force; counts, lengths, deltas, types, statuses, and approved hashes are allowed, while raw business content remains absent.

All three modes passed.

## 15. Fail-Open Verification

Healthy and Phoenix-down executions used identical request/operation IDs. Their canonical hashes matched exactly:

```text
normal=1bbb4f674da15e2ceb8d245bcf95ae7ed5a50056a5cb9da21ff38e653391e2f1
model =cede0b718bc766b40dadc25fae5f9d468af29e50f74ff5a2228e284d99f53165
tool  =37fbe721974d8f9ac9733f4e7cee84f5ee4f9dff1f34ec10bb902a4eff7c1cb4
```

With Phoenix stopped, all three processes exited 0 and returned their normal business/runtime outcomes. `forceFlush=false` was contained after a bounded exporter timeout; shutdown succeeded. Phoenix was restarted and verified `healthy` with `/healthz=OK`.

## 16. Trace Overhead Baseline

The same fake-model/no-external-network normal path ran five warmups followed by 30 measured executions in each state. Local batch-export flush/shutdown occurred outside each measured operation.

| Metric | OFF | ON | Overhead |
| --- | ---: | ---: | ---: |
| Median | 35.076 ms | 35.292 ms | 0.62% |
| p95 | 50.921 ms | 51.405 ms | 0.95% |
| Mean | 37.663 ms | 38.213 ms | 1.46% |

ON was nowhere near the abnormal `2x` threshold. `PERFORMANCE_BASELINE=PASS`.

## 17. Regression Comparison

```text
AI_OBSERVABILITY_ENABLED=false
P04_BASELINE=1767/1768
P05_RESULT=1777/1778
P05_NEW_TESTS=10 PASS
SAME_KNOWN_FAILURE=YES
NEW_REGRESSION_INTRODUCED=NO
```

The only failure remains `businessTerminologyContract.test.cjs` reading the absent `.guardian/config.yaml`. The enabled targeted suite covered all observability tests plus safe AI chat/V4 driver/runtime tests: `74/74 PASS`.

No Real AI, Real AI Shadow, R4-B Real AI, or Repeat Stability run occurred.

## 18. Trace Contract Snapshot

The version-controlled contract is `docs/ai-observability/trace-contract-v1.md`. It freezes span names/kinds, parent/lifecycle rules, safe attributes, forbidden content, correlation rules, content modes, and schema version without embedding real trace/business data.

## 19. Files Changed

- `api/services/observability.cjs` — schema-version metadata only
- `scripts/observability-trace-integrity.cjs`
- `scripts/run-observability-p05-integrity-harness.cjs`
- `tests/observabilityTraceIntegrity.test.cjs`
- `tests/observabilitySseEquivalence.test.cjs`
- `tests/observabilityCorrelationRedaction.test.cjs` — off-mode schema expectation only
- `docs/ai-observability/trace-contract-v1.md`
- `docs/ai-observability/reports/P05-observability-baseline-lock.md`

No AI runtime, prompt, router, resolver, normalizer, tool/executor, verifier, internal API, business API, database, SSE, model configuration, retry/fallback, Oracle, Shadow, Guardian, dependency, or Docker code changed.

## 20. Known Limitations

- Phoenix/OTel JS start timestamps are wall-clock millisecond values while end timestamps retain finer derived precision. The validator documents and tests a 1 ms ordering tolerance; it still rejects material boundary/order violations.
- Existing P04 operation-correlation gaps remain: read tools may have no operation ID, and child IDs are visible only when existing structured receipts expose them.
- `OITracer` adds safe OpenInference model/provider/invocation metadata outside the application sanitizer. P02 input/output/message/prompt/tool masking remains enabled, no provider auto-instrumentation exists, and final Phoenix privacy scanning found zero sentinel leakage.
- The micro-benchmark is a local deterministic baseline, not a production load or capacity test.

## 21. P06 Preconditions

- Trace Schema V1 locked: `PASS`
- Trace integrity, parentage, lifecycle and order: `PASS`
- 2/10-request async isolation and zero contamination: `PASS`
- OFF/ON normal/error/SSE equivalence: `PASS`
- Business DB hash/mtime/size and backup isolation: `PASS`
- Phoenix project isolation: `PASS`
- Privacy and all content modes: `PASS`
- Phoenix-down fail-open and restored health: `PASS`
- Performance baseline: `PASS`
- Same frozen regression failure only: `PASS`
- AI/business behavior and database unchanged: `PASS`

```text
V4_OBSERVABILITY_BASELINE_LOCKED=YES
TRACE_SCHEMA_VERSION=1
P06_REAL_AI_REPLAY_ALLOWED=YES
P06_READY=YES
```

STOP — WAIT FOR SUPERVISOR REVIEW.
