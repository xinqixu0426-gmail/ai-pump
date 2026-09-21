# V5 Shadow Facts V1

## Purpose

`V5ShadowFacts` is a request-scoped, read-only structural observation contract. It records facts already produced by the authoritative V4 execution and supplies them to the V5 shadow after V4 completes. It never calls a model, Tool, Business API, database, or write path and never affects V4 output.

## Source ownership

| Fact group | Authoritative source | Mirrored structure |
| --- | --- | --- |
| Correlation | existing Dispatcher/OTel context | request ID or hash, source Trace ID, independent shadow task ID |
| Entity normalization | existing normalization wrapper | type, lengths, punctuation/length deltas, changed flag |
| Entity resolution | existing resolver wrapper | resolved, match type, candidate count, ambiguity, canonical ID hash |
| Routing | existing V4 broker wrapper | selected Tool, decision, available count, read/write class, route source |
| Arguments | existing Tool schema-validation boundary | validation status/code, sorted keys/count, top-level type signature |
| Tool execution | existing Tool wrapper | Tool/capability identifiers, read/write class, status, argument shape |
| Verification | existing verifier wrapper | decision/status, before-any-Tool, required/observed/missing counts |
| Runtime | existing V4 result | final structural status |

Missing source facts remain `UNKNOWN`, `NOT_AVAILABLE`, `null`, or an explicit availability flag. A successful Tool call is not used to infer that argument validation occurred.

## Identity hash rule

A canonical entity identity is hashed only when the existing resolver receipt contains an actual stable ID or selected ID. SHA-256 is truncated to 24 hexadecimal characters. The raw ID, display name, raw mention, and normalized mention are not retained. The hash is stable in the same environment, one-way, and diagnostic-only; it is never an execution input.

## Argument structural facts

Only safe field names, field count, and top-level types (`string`, `number`, `boolean`, `array`, `object`, `null`, `buffer`, or `unsupported`) are recorded. Values are never serialized. At most 32 safe keys and 24 fact records per category are retained.

`VALIDATED` is emitted only by the existing `prepareAiToolCalls` schema-validation boundary. `REJECTED` retains only the safe validation code and structure. No execution outcome upgrades an unknown validation state.

## Verification facts

The existing verification wrapper supplies decision/status and evidence counts. `beforeAnyTool` is derived only from the existing Tool-execution count. V5 does not rerun V4 verification and does not fabricate Evidence Requirements.

## Request isolation and lifecycle

Facts live in Node `AsyncLocalStorage` for one Dispatcher execution. A bounded immutable snapshot is created after V4 returns. The snapshot is then projected asynchronously by the existing bounded shadow scheduler. Observation failures are swallowed locally and never alter V4 result or exception semantics.

## Never mirror

The contract forbids raw prompt, system prompt, assistant response, conversation history, raw/normalized entity mention, canonical business ID, Tool argument/result values, inventory, price, cost, quantity, BOM, customer/order/supplier content, credentials, PII, and document text.

## Layered comparison

Entity, capability, Tool exposure, argument, state, policy, and verification are compared independently using `AGREE`, `V5_BLOCKS_V4_FAILURE`, `V5_FALSE_BLOCK`, `INSUFFICIENT_DATA`, or `NOT_APPLICABLE`. Overall comparison additionally supports version-1 status `AGREE_WITH_DEFERRED_VERIFICATION` when a successful V4 path agrees on every required upstream layer and only verification requirements are deferred.

Priority is deterministic: false block, explicit V5 block, complete agreement, verification-only deferred agreement, then insufficient data. Layer disagreements are retained even when an earlier layer already determines the overall result.

## Non-goals

V1 does not change Prompt, routing, entity behavior, Tool arguments, execution, verification, SSE, retry, write confirmation, or API contracts. It is not a production cutover mechanism.
