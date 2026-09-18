# V5 Production Shadow Mirroring V1

## 1. Purpose

V5 Production Shadow Mirroring copies a bounded set of safe structural facts after the authoritative V4 runtime has completed and evaluates them asynchronously with V5 controls. V4 remains the only runtime that calls the model, selects and executes Tools, accesses Business APIs, writes data, verifies results, streams SSE, and answers the user.

The shadow is read-only, non-blocking, fail-open, and has no user-visible output.

## 2. Feature flags

| Variable | Default | Valid enabled value | Invalid fallback |
| --- | ---: | --- | --- |
| `AI_V5_SHADOW_ENABLED` | `false` | exact string `true` | disabled |
| `AI_V5_SHADOW_SAMPLE_RATE` | `0` | finite number from `0.0` through `1.0` | `0` |

When disabled, the production hook returns before fact capture. Enabled with sample rate zero creates no shadow tasks. These flags do not change V4 configuration or routing.

For trace isolation, P13 diagnostics use `AI_OBSERVABILITY_PROJECT=pump-ai-v5e2-shadow`. Shadow enablement must not be used to change the locked V4 baseline project.

## 3. Eligibility

V1 mirrors only V4 results whose observed Tool set maps uniquely to V5 L1/L2 read capabilities. It excludes:

- write-mode or `allowWrite` requests;
- pending confirmation outcomes;
- any Tool mapped to a write capability;
- critical or unknown risk;
- missing or ambiguously mapped Tool metadata.

Excluded requests return `SKIPPED_POLICY`. They are never replayed or re-executed.

## 4. Sampling

Sampling happens after eligibility. A rate of `1` mirrors every eligible read; a rate of `0` mirrors none. Sampling does not inspect prompt, customer, entity, Tool argument, Tool result, or business values.

## 5. Safe projection contract

The dispatcher copies only:

- existing safe request correlation or a stable hash;
- current active source Trace ID when available;
- runtime path;
- safe V4 terminal/status label;
- read/write mode and `allowWrite` boolean;
- Tool name, success boolean, and safe error code.

The projection explicitly does not copy prompt, system prompt, response, raw or normalized entity, Tool arguments/results, business IDs/numbers, customer/order data, or documents. Missing entity, argument-validation, intended-capability and verification facts remain `UNKNOWN`, `NOT_AVAILABLE`, or `PARTIAL`; no fact is fabricated.

Each eligible request receives a fresh `shadowTaskId` independent of `sourceRequestId` and `sourceTraceId`.

## 6. Comparison model

The only comparison statuses are:

- `AGREE`
- `V5_BLOCKS_V4_FAILURE`
- `V5_FALSE_BLOCK`
- `V5_INSUFFICIENT_DATA`
- `NOT_COMPARABLE`
- `SHADOW_ERROR`

Comparison covers available structural entity, capability/Tool compatibility, state, policy, evidence and verification assessments. A successful V4 control explicitly blocked by a complete V5 projection is `V5_FALSE_BLOCK`. Missing production-safe facts are `V5_INSUFFICIENT_DATA`, never a pass.

## 7. Async and fail-open isolation

The production hook runs only after V4 returns its result. It synchronously copies the small safe fact envelope and schedules shadow work for the next event-loop turn. V4 never awaits shadow completion. Synchronous scheduling errors, projection errors, comparison errors, telemetry failures and timeouts are contained and cannot alter the V4 result or exception semantics.

The scheduler attaches rejection handlers to every promise. No shadow promise is returned through API or SSE contracts.

## 8. Capacity and timeout

- Maximum concurrent shadows: `4`
- Independent shadow timeout: `100ms`
- Queue: none

At capacity, work returns `SHADOW_SKIPPED_CAPACITY`; it is not queued and V4 is not blocked. Timeout returns `SHADOW_TIMEOUT`. Timeout timers are unreferenced so they cannot keep the process alive. A bounded `waitForIdle` exists only for tests and diagnostics.

## 9. No-model / no-Tool invariant

The P13 mirror has no model provider, Tool executor, internal API, Business API, database, or write import. Its counters are fixed to and tested as:

```text
v5ModelCalls=0
v5ToolCalls=0
v5BusinessApiCalls=0
v5Writes=0
```

Observed V4 Tool results are represented only by name/status structure. They are not passed to a V5 Tool or copied as payload.

## 10. Observability and correlation

When existing observability is enabled, shadow emits:

```text
pump.ai.v5.shadow
├── pump.ai.v5.shadow.project
└── pump.ai.v5.shadow.compare
```

The shadow root is deliberately detached from the active V4 Agent span and starts an independent Trace. It carries safe source request/Trace correlation plus the independent shadow task ID. This prevents a shadow child span from ending after its V4 parent. All attributes pass through the existing central trace sanitizer.

## 11. Privacy

Shadow Trace content is metadata-only in P13 for every `AI_TRACE_CONTENT` mode. Forbidden content includes credentials, PII, prompts/responses, entity values, Tool argument/result values, and business/customer/order data. Sanitizer or telemetry failure drops shadow telemetry and never affects V4.

## 12. Storage

P13 creates no business table and no shadow database. Runtime evidence is exported to the dedicated Phoenix project or observed by bounded test callbacks. There is no durable in-process queue or business persistence.

## 13. Non-goals

P13 does not route production traffic to V5, call a second model, call a second Tool, compose an answer, override a V4 verdict, perform a write, retire legacy code, or authorize cutover. V4 remains authoritative after P13 regardless of shadow results.
