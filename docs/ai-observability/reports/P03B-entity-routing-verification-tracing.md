# P03B Entity / Routing / Verification Tracing

## 1. Executive Result

P03B completed with metadata-only, fail-open tracing at the current V4 entity-normalization, entity-resolution, routing, and verification boundaries. Phoenix stored the expected spans under `pump-ai-p03b-trace-test`, parentage and observed execution order were correct, and all three privacy sentinels had zero occurrences in stored attributes/events.

`pump.ai.entity.extract` was not added: the current runtime extracts the target mention inline inside `resolveAiToolTargetV3`, so there is no independent extraction stage to instrument without inventing a business boundary.

`P04_READY=YES`.

## 2. Frozen Baseline

- Start commit: `084c661e187bdda137b62a29108855d213772951`
- Branch: `master`
- Worktree clean at start: `NO`
- P03A: `PASS`
- P03A deterministic baseline: `1747/1748`
- Known failure: missing `.guardian/config.yaml`
- Existing user V4/AI changes were preserved and excluded from the P03B index/commit.

## 3. Existing Stage Inventory

| Stage | Exists | Current boundary | P03B result |
| --- | --- | --- | --- |
| Entity extraction | NO | Target mention is selected by an inline expression in `resolveAiToolTargetV3`; no independent function/stage exists | `NOT_APPLICABLE` |
| Entity normalization | YES | `aiEntityResolverV3.cjs:buildSearchProbes` | `pump.ai.entity.normalize` |
| Entity resolution | YES | `aiEntityResolverV3.cjs:resolveAiToolTargetV3` | `pump.ai.entity.resolve` |
| Independent routing | YES for V4; NO for legacy V3 | `aiCapabilityBrokerV4.cjs:selectNextCapability`; legacy V3 obtains the actual tool choice from the model | `pump.ai.route` on the V4 broker only |
| Verification | YES | Runtime evidence predicate plus V4 controller `failUnverified` transition | `pump.ai.verify` |

No new business stage, router, resolver, evidence model, or verifier was created.

## 4. Entity Extraction Tracing

The original mention enters `resolveAiToolTargetV3` through model-generated tool arguments. The resolver selects the first non-empty configured input field inline. Because this is not an independent stage, P03B emits no `pump.ai.entity.extract` span.

`Entity Extraction Stage Exists=NO`; `Entity Extraction Trace=NOT_APPLICABLE`.

## 5. Entity Normalization Tracing

`buildSearchProbes` is the real independent normalization/probe boundary. It is wrapped synchronously so callers retain the same return type and thrown-error behavior. The span records only:

- entity type;
- input/output character lengths;
- input/output punctuation counts;
- length and punctuation deltas;
- whether normalization changed the structural representation.

The input, normalized output, aliases, and probes are never attached to the span. Normalization rules and return values are unchanged. In the resolver, this span is correctly nested beneath `pump.ai.entity.resolve` because normalization genuinely occurs inside resolution.

## 6. Entity Resolution Tracing

`resolveAiToolTargetV3` is wrapped without changing its inputs, discovery calls, candidate scoring, exact/fuzzy decision, output arguments, or errors. Safe result metadata includes candidate count, match type, exact/resolved/ambiguous flags, resolver path, and fallback-used flag.

When a stable internal ID is present, only the first 24 hexadecimal characters of a SHA-256 digest are exported as `entity.resolved_id_hash`; the original ID is not exported.

## 7. Routing Tracing

The real V4 broker boundary `selectNextCapability` emits `pump.ai.route`. It records the available-profile count, selected capability name, read classification, existing operation/domain metadata, source `v4_capability_broker`, and decision status.

Legacy V3 model tool choice is not relabeled as an independent router. Tool argument values and prompt-derived text are not recorded.

## 8. Verification Tracing

The existing runtime evidence predicate is wrapped at each genuine evaluation. V4 `failUnverified` is additionally wrapped at the exact state transition so technical failure paths cannot bypass observation.

The span records decision/status, required/observed/missing counts when currently available, early-exit state, and tool execution count before verification. Evidence payloads and business values are not recorded. Neither wrapper participates in the decision or changes the returned value/error.

## 9. Premature Verification Signal

`verification.before_any_tool_execution` is derived only from the already-existing execution count:

```text
tool_execution_count_before_verify == 0
→ verification.before_any_tool_execution = true
```

The deterministic helper simulation returned the original `false` decision, while the real V4 `controller.failUnverified(...)` transition produced `failed_unverified` and the same `true` signal with zero prior executions. No production verifier behavior was changed.

## 10. Trace Execution Order

Phoenix timestamps for normal Case A prove this actual order:

```text
12:17:02.895000  AGENT start
12:17:02.897000  entity.normalize (fixture entry)
12:17:02.899000  LLM #1
12:17:02.923000  V4 route
12:17:02.923000  entity.resolve start
12:17:02.924000  entity.normalize inside resolver
12:17:02.925000  TOOL
12:17:02.932000  LLM #2
12:17:02.948000  verify
12:17:02.962631  AGENT end
```

The instrumentation reports the code's real order; it does not rearrange execution to match a conceptual diagram.

## 11. Privacy Verification

The Phoenix REST representation of every Case A span, including attributes and events, was searched for:

- `P03B_SECRET_ENTITY_SENTINEL`
- `P03B_SECRET_TOOL_ARG_SENTINEL`
- `P03B_SECRET_RESULT_SENTINEL`
- prompt/response fields and raw/normalized entity content

Sentinel leakage count: `0`.

The test suite repeats metadata serialization checks under `off`, `metadata`, and `diagnostic`. P03B does not activate diagnostic business-content capture.

## 12. Deterministic Tests

Nine P03B tests cover:

- disabled synchronous no-op and result/error identity;
- real normalization structural deltas and punctuation delta;
- real resolver candidate/match/resolution metadata and hashed ID;
- real V4 broker decision metadata without arguments;
- normal verification counts and post-tool signal;
- premature verification helper signal;
- real V4 `failed_unverified` transition before any tool execution;
- resolver error identity and sanitized error metadata;
- zero content leakage in all three content modes.

Targeted P03B/P03A/entity/V4-driver snapshot: `48/48 PASS` against a clean P03A commit snapshot plus only the staged P03B patch.

## 13. Phoenix Trace Evidence

- Project: `pump-ai-p03b-trace-test`
- Normal Case A trace ID: `a3427aa4cb1085d8dfbc896fb2c2614c`
- Root span ID: `751d65a38427adef`
- Entity normalization span ID: `f31ddb3cca886b16`
- Entity resolution span ID: `86c4c2d204b0be29`
- Nested resolver normalization span ID: `9815ea34643685f1`
- Route span ID: `795df1ea96dd5bba`
- Verify span ID: `233f0b8b93e6420b`

All listed spans belong to one trace. Route, top-level normalization, resolution, Tool, LLM, and verification spans have the Agent root as parent; resolver normalization has the resolver span as parent. No business-baseline project was used.

## 14. Fail-Open Verification

Phoenix was stopped with `docker compose stop phoenix`; its volume was not deleted. The same enabled P03B harness returned exactly the healthy-run business results:

```text
normal: p03b-normal-success / route=true / resolved=true / tool=true / verified=true
premature: p03b-premature-observed / verified=false
process exit: 0
flush: false (contained warning)
shutdown: true
```

There was no crash or unbounded wait. Phoenix was restarted and finished `healthy`; `/healthz` returned `OK`.

## 15. Regression Comparison

With `AI_OBSERVABILITY_ENABLED=false`, `npm test` reported:

- Current: `1756 passed / 1757 total`
- P03A baseline: `1747 passed / 1748 total`
- Delta: exactly 9 new passing P03B tests
- Same known failure: `YES` — `businessTerminologyContract.test.cjs` cannot read missing `.guardian/config.yaml`
- New regression introduced: `NO`

No Real AI, R4-B Real AI, Real AI Shadow, or Repeat Stability run was performed.

## 16. Files Changed

- `api/services/observability.cjs`
- `api/services/aiEntityResolverV3.cjs` — instrumentation wrapper only
- `api/services/aiCapabilityBrokerV4.cjs` — instrumentation wrapper only
- `api/services/aiReadInvestigationRuntimeV4.cjs` — instrumentation wrapper only
- `api/services/aiAgentRuntimeV3.cjs` — instrumentation wrapper only
- `scripts/run-observability-p03b-trace-harness.cjs`
- `tests/observabilityEntityRoutingVerification.test.cjs`
- `docs/ai-observability/reports/P03B-entity-routing-verification-tracing.md`

No dependency, prompt, tool argument, executor, internal API, business API, schema, database, Docker, Oracle, Shadow, Guardian, SSE, retry, or fallback change was made.

## 17. Known Limitations

- Entity mention extraction remains inline and therefore intentionally untraced as a standalone stage.
- V3's model-selected tool call has no independent router span; `pump.ai.route` represents only the real V4 deterministic broker.
- The integration harness uses the real dispatcher, model wrapper, V4 broker, resolver, normalization, and tracing wrappers with fake model/tool I/O. It does not run a paid model or business API.
- Normal Case A uses the verification wrapper at the real runtime boundary shape; the production V4 premature transition is separately exercised in a deterministic test because constructing that failure inside the full runtime would require changing/injecting production behavior.
- A direct ad-hoc invocation of `aiReadInvestigationV4.test.cjs` without its required isolated database environment rejected itself by design. The official test runner supplied the correct isolation and the complete regression passed except for the frozen Guardian-file failure.
- Targeted lint is affected by the pre-existing uncommitted resolver change leaving `normalizeResourceText` unused; P03B did not alter or clean up that user-owned change.

## 18. P04 Preconditions

- Real entity stages traced where independently present: `PASS`
- No fake extraction stage: `PASS`
- Real V4 routing stage: `PASS`
- Real verification and `failed_unverified` transition: `PASS`
- Premature verification observable: `PASS`
- Parent/child and execution order: `PASS`
- Metadata-only privacy and sentinel leakage zero: `PASS`
- Phoenix-down fail-open and restored health: `PASS`
- Same known regression failure only: `PASS`
- Business/AI behavior and database unchanged: `PASS`

`P04_READY=YES`

STOP — WAIT FOR SUPERVISOR REVIEW.
