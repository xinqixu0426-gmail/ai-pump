# P03A Agent / LLM / Tool Trace Skeleton

## 1. Executive Result

P03A completed the minimal AGENT → LLM / TOOL trace skeleton without changing AI decisions, payloads, retry behavior, SSE output, tool execution semantics, or business data. A deterministic Phoenix integration trace proves one root Agent span, two LLM children, one Tool child, and the required execution order.

`P03B_READY=YES`. Entity, normalization, resolver, verifier, evidence, request correlation, and content capture remain intentionally unimplemented.

## 2. Frozen Baseline

- P02 commit / P03A start commit: `7c9ea18505ad8ea42b25fdc645d4e3e17666536f`
- P02 status: `PASS`
- Phoenix at start: `HEALTHY`
- Observability default: `false`
- Trace content default: `metadata`
- Frozen regression: `1740/1741`
- Known failure: missing `.guardian/config.yaml`
- Worktree clean at start: `NO`

All pre-existing uncommitted V4/AI changes were preserved and excluded from P03A.

## 3. Instrumentation Boundaries

| Boundary | Existing code | P03A hook |
| --- | --- | --- |
| Complete assistant execution | `api/services/aiDispatcherV3.cjs:runAiDispatcherV3` | `withAgentSpan()` wraps the awaited runtime call. |
| Logical provider call | Dispatcher-supplied provider used by planners, runtime loops, V4 driver, and synthesis | `traceModelProvider()` wraps each provider invocation and updates metadata from the existing `onProvider` callback. |
| Actual tool executor call | `api/routes/ai/executor.cjs:executeToolCall` | `withToolSpan()` wraps the unchanged implementation after the caller has selected/prepared the tool. |

Phoenix-specific imports remain confined to `api/services/observability.cjs`. No HTTP, Express, provider, database, Entity, or Verifier auto-instrumentation was added.

## 4. Agent Root Span

- Name: `invoke_agent pump_factory_assistant`
- OpenInference kind: `AGENT`
- Safe metadata: operation name, fixed runtime identifier, streaming boolean, fixed runtime route
- Lifetime: begins immediately before `runAiAgentRuntimeV3` and ends only after its returned promise settles
- Errors: status is set to error with sanitized `error.type`; the original exception object is rethrown

Because `handleAiChat()` awaits `runAiDispatcherV3()`, the root covers planning, model/tool loops, final generation, and runtime SSE emissions rather than only synchronous route setup.

## 5. LLM Span

- Name: `chat <actual_model>`
- OpenInference kind: `LLM`
- Safe metadata: provider, actual model, operation `chat`, streaming boolean, tool-definition count
- Actual provider/model are obtained from the already-existing `onProvider` event; messages, prompt, output, and tool argument values are never inspected for attributes
- Each logical provider invocation receives one child span. Existing internal HTTP retries/tool-choice fallback remain inside that invocation and are not changed or used for retry decisions.
- Errors retain their original exception identity and behavior.

P03A intentionally does not parse response bodies to obtain finish reason or usage; doing so at this stage would couple tracing to streaming/response semantics.

## 6. Tool Span

- Name: `execute_tool <actual_tool_name>`
- OpenInference kind: `TOOL`
- Safe metadata: tool name, registered executor key, read/write class, argument-key count, non-sensitive argument field names, execution status, result JavaScript type
- Argument values and result payload are never passed to tracing
- Returned `{ success: false }` results mark the span as error but are returned unchanged
- Thrown errors mark the span as error and are rethrown unchanged
- Write confirmation and `allowWrite` behavior stay inside the untouched implementation.

## 7. Async / SSE Context Propagation

The installed Node tracer provider uses AsyncLocalStorage context. `startActiveSpan()` wraps the awaited dispatcher runtime. The deterministic harness performs asynchronous model/tool/model operations, and Phoenix parent IDs prove all three remain children of the still-open Agent root.

The existing SSE route, heartbeat, abort controller, disconnect handling, event ordering, response body, and buffering are unchanged. Existing SSE regression tests passed in the full suite. Cancellation/runtime errors pass through the same dispatcher promise and therefore close the root span without changing the route error path.

## 8. Privacy Verification

P03A records the same metadata-only attributes for `off`, `metadata`, and `diagnostic`; the content flag still authorizes no business content. Tests deliberately used sentinel argument/result/error strings and verified they were absent from span metadata, including with `AI_TRACE_CONTENT=diagnostic`.

Phoenix inspection found no:

- prompt, system prompt, conversation history, response text
- tool argument value or tool result payload
- customer, order, inventory, cost, BOM, entity mention, or database value
- credential, authorization value, cookie, or token

The OpenInference processor additionally derived `llm.invocation_parameters` from safe model metadata only; it contained the test model identifier and no request content.

## 9. Deterministic Tests

`node --test tests/observability.test.cjs tests/observabilityTracing.test.cjs`:

- `15/15 PASS` total, including the 8 P02 tests
- P03A adds 7 tests covering disabled no-op, result/error identity, Agent success/error closure, LLM children and error behavior, Tool success/returned failure/thrown failure, parentage, and metadata privacy
- Targeted ESLint: `PASS`
- No paid or real AI call was made.

## 10. Phoenix Trace Evidence

- Project: `pump-ai-p03a-trace-test`
- Trace count: `1`
- Span count: `4`
- Trace ID: `d053eeba5aaf07141dabb52eb62985e2`
- Root span ID: `8d98e16b00e2953e`
- LLM child #1: `b6f7d03a290a6853`
- Tool child: `02e6153a62a95292`
- LLM child #2: `221ee08449fdf212`

The project `pump-ai-v4-baseline` received no P03A span.

## 11. Parent/Child Validation

Phoenix stored both LLM span parent IDs and the Tool span parent ID as `8d98e16b00e2953e`, exactly matching the Agent root. The root has no parent.

Stored timestamps prove:

```text
03:48:01.022000  AGENT start
03:48:01.023000  LLM #1 start
03:48:01.044323  LLM #1 end
03:48:01.046000  TOOL start
03:48:01.047888  TOOL end
03:48:01.048000  LLM #2 start
03:48:01.049904  LLM #2 end
03:48:01.050441  AGENT end
```

Parent/child and execution order: `PASS`.

## 12. Fail-Open Verification

Phoenix was stopped without deleting its volume. The same corrected, isolated harness ran with Observability enabled and `AI_TRACE_CONTENT=diagnostic`:

- business result: `synthetic-success`
- tool result: success
- exporter flush: failed and returned `false`
- process exit: `0`
- crash/indefinite wait: none

Phoenix was restarted and returned `OK` from `/healthz`; the container was healthy. Failed export created no additional stored trace.

## 13. Regression Comparison

With `AI_OBSERVABILITY_ENABLED=false`, `npm test` reported:

- Current: `1747 passed / 1748 total`
- P02 baseline: `1740 passed / 1741 total`
- Delta: exactly 7 new passing P03A tests
- Same known failure: `YES` — `businessTerminologyContract.test.cjs` cannot read missing `.guardian/config.yaml`
- New regression introduced: `NO`

## 14. Files Changed

- `api/services/observability.cjs`
- `api/services/aiDispatcherV3.cjs`
- `api/routes/ai/executor.cjs`
- `scripts/run-observability-trace-harness.cjs`
- `tests/observabilityTracing.test.cjs`
- `docs/ai-observability/reports/P03A-agent-llm-tool-tracing.md`

No dependency, environment, Docker, database schema, business API, prompt, routing, entity, verifier, Oracle, Shadow, Guardian, or SSE file was changed.

## 15. Known Limitations

- The deterministic harness uses the real dispatcher instrumentation boundary and model-provider wrapper, plus a fake runtime/tool operation. It does not execute the full `aiAgentRuntimeV3` because that runtime has no safe fake-tool injection seam; adding one would exceed P03A's minimal boundary.
- Provider-internal network retries and Kimi-to-DeepSeek fallback remain within one logical LLM span. P03A does not add attempt spans.
- Token usage, finish reason, Entity, Verifier, Evidence, request correlation, and all content attributes are not traced.
- During the first harness run, runtime dependencies were loaded before the temporary DB environment was set, causing the existing startup scheduler to create one backup of the unchanged business database. The `.db` and `.meta.json` artifacts were precisely removed, the business database modification time remained unchanged, and the harness was corrected and reverified with an isolated temporary database. No business operation or business database write occurred.
- Existing user V4/AI work remains dirty and uncommitted outside this change.

## 16. P03B Preconditions

- Agent root trace: `PASS`
- LLM children: `PASS`
- Tool child: `PASS`
- Parent/child relationship: `PASS`
- Execution order: `PASS`
- Async context and unchanged SSE behavior: `PASS`
- Metadata-only privacy, including diagnostic mode: `PASS`
- Phoenix-down fail-open: `PASS`
- Phoenix restored healthy: `PASS`
- No Real AI required or run: `PASS`
- No business/AI behavior or database change: `PASS`
- Same known regression failure only: `PASS`

`P03B_READY=YES`

STOP — WAIT FOR SUPERVISOR REVIEW.
