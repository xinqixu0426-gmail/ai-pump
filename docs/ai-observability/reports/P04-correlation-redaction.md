# P04 Trace Correlation + Redaction Guardrails

## 1. Executive Result

P04 completed the two authorized changes only: existing request/operation/audit identifiers can now be read into the existing Agent/Tool spans, and every attribute emitted by the local Agent/LLM/Tool/Entity/Route/Verify helpers passes through one fail-open trace-safe policy. No prompt, response, entity value, tool value, customer data, or business numeric value was enabled in any content mode.

Phoenix stored a deterministic correlation trace under `pump-ai-p04-correlation-test`. The safe synthetic request and operation IDs were present, the Tool remained a child of the Agent, and all seven sensitive/privacy/business sentinels had zero occurrences. The Phoenix-down run returned the identical harness business result and exited normally; Phoenix was restored to `healthy` with `/healthz=OK`.

With observability disabled, the full deterministic suite reported `1767/1768`: the 11 new P04 tests passed and the only failure remained the frozen missing `.guardian/config.yaml` contract fixture. `P05_READY=YES`.

## 2. Frozen Baseline

```text
P03B_COMMIT=aa22fd0a7b2b923f6d9ccc8e38791ad48b411780
P03B=PASS
BRANCH=master
WORKTREE_CLEAN_AT_START=NO
P03B_REGRESSION_BASELINE=1756/1757
KNOWN_FAILURE=missing .guardian/config.yaml
```

The pre-existing user-owned V4/AI/document changes were preserved. P04 neither reset, stashed, cleaned, staged, nor committed them. P04 changed only the files listed in section 18.

## 3. Existing Correlation Inventory

| Identifier | Existing creation/source | Existing propagation before P04 | P04 observation point |
| --- | --- | --- | --- |
| `requestId` | `requestObservability.cjs:normalizeRequestId`; accepts `[A-Za-z0-9._-]{8,128}` or creates UUID | `req.requestId` → AI chat route → dispatcher/runtime input and existing logs | Agent root attribute |
| `operationId` | Write-confirmation UUID, caller-supplied executor option, business command receipt, and child-operation UUID | Executor → `internalApiClient` `x-operation-id` → business command/receipt/evidence | Tool start/result metadata |
| `auditId` / `auditIds` | Existing business command receipts | Returned receipt and structured execution evidence | Tool result metadata |
| `capabilityId` | Existing AI/formal capability registries | Executor context and `x-capability-id` | Tool metadata |
| actor/subject | Existing authenticated request and confirmation subject | Request/confirmation scope only | Not exported; no non-invasive, privacy-safe Tool hook |
| resource/version | Existing tool args, confirmation snapshot, and business receipts | Payload/receipt dependent | Not exported; values remain business content |
| trace/span ID | OTel runtime | Trace context only | Phoenix; not written to DB/API/SSE/log contract |

No identifier lifecycle or business identity model was changed.

## 4. Request ID Correlation

`api/services/requestObservability.cjs` remains the sole HTTP request-ID authority. Its strict normalized value is passed unchanged by the AI chat route and dispatcher. P04 adds a one-way read at `runAiDispatcherV3` → `withAgentSpan`, producing `pump.request.id` on the Agent root.

Storage policy is `RAW_SAFE`: only values matching the same bounded safe character/length policy are retained. A malformed/nonconforming value supplied directly to the helper is not retained; a 24-hex SHA-256 prefix is emitted as `pump.request.id_hash` instead. Raw and hash are never emitted together. No trace ID is returned to the caller or written back into request/business state.

## 5. Operation ID Correlation

`executeToolCall` passes its already-existing `options.operationId` and registry `capabilityId` to the Tool trace helper without changing executor arguments. The helper additionally inspects only known result/receipt/evidence fields after execution: `operationId`, `formalOperationId`, `auditId`, `auditIds`, and structured evidence calls/receipts.

One safe operation ID uses `pump.operation.id`. Multiple existing IDs use bounded `pump.operation.ids` plus `pump.operation.id_count`; they are deduplicated and never overwrite one another. Audit IDs use the corresponding `pump.audit.*` fields. Nonconforming IDs are hashed rather than recorded raw. Result objects and business payloads are never serialized to discover IDs.

## 6. Correlation Gaps

- Ordinary read tools usually have no business `operationId`; P04 does not fabricate one.
- Child operation IDs created inside `internalApiClient.createChildOperationFetch` are visible only when an existing structured receipt/evidence exposes them. P04 does not alter internal API return contracts.
- Actor/subject, resource identity, and resource version are not uniformly available at the Tool tracing boundary without reading sensitive args or changing contracts, so they remain uncorrelated.
- Agent correlation is implemented on the current traced V3/V4 dispatcher path. Legacy paths without the Agent helper remain outside this correlation.
- Trace IDs remain Phoenix/OTel data only. Existing application logs, API responses, SSE frames, and database rows are unchanged.

## 7. Trace Content Modes

| Mode | P04 behavior |
| --- | --- |
| `off` | Span name, OpenInference kind, timing, and status only. Custom/GenAI attributes, correlation, and error-type metadata are suppressed. |
| `metadata` | Approved OpenTelemetry GenAI fields plus `pump.*` / `pump.ai.*` structural metadata and safe correlation. Business/content values are suppressed. |
| `diagnostic` | Currently the same allow boundary as metadata, allowing bounded structural type/count/length/delta/status/hash data only. Business-content capture remains disabled. |

`diagnostic` still does not capture prompt, response, message history, raw entity/normalized entity, arguments, results, documents, or business values.

## 8. Sensitive Key Policy

The central, case-insensitive normalized-key deny policy covers the required authorization, cookie, password, secret, API-key, token, session, database credential, and private-key names. It also covers current repository conventions: `ACCESS_PASSWORD`, `JWT_SECRET`, `INTERNAL_SECRET`, `MCP_TOKEN`, `MCP_SERVICE_TOKENS`, `DEEPSEEK_API_KEY`, `KIMI_API_KEY`, and `MOONSHOT_API_KEY`.

Denied attributes are omitted, not replaced, so neither the key/value pair nor a redaction marker expands telemetry. Tool argument field-name metadata separately removes sensitive and PII field names.

## 9. PII Policy

The key policy omits case/separator variants of email, phone, mobile, WhatsApp, address, contact, customer name/email/phone, and consignee fields. Values are never content-scanned or serialized because this phase permits no arbitrary business values at all. The strategy is `omit`.

## 10. Business Content Policy

Metadata keys representing cost, price, inventory, quantity, BOM, recipe/order/supplier/customer content, tool argument/result values, raw/normalized entity values, documents, prompts, responses, messages, or payloads are denied in every mode.

Bounded tool argument field names may be retained when they are neither secret nor PII (for example `recipeName` and `model`); their values are never attached. This preserves structural diagnostics without exposing model names, warehouse values, quantities, costs, or result payloads.

## 11. Size Guards

```text
MAX_TRACE_STRING_LENGTH=256
MAX_TRACE_ARRAY_ITEMS=20
MAX_TRACE_OBJECT_KEYS=30
```

Strings are truncated, primitive arrays are bounded, nested array objects are omitted, and objects are summarized as a bounded key count rather than serialized. Buffers become length-only summaries. These limits apply only to telemetry copies and never mutate business values.

## 12. Fail-Open Sanitization

`sanitizeTraceValue`, `sanitizeTraceAttributes`, correlation normalization, argument-key inspection, span updates, result-status extraction, flush, and shutdown are guarded so telemetry failures cannot escape into the business call. Circular/hostile objects, `Error`, `Buffer`, large values, `undefined`, `null`, functions, symbols, and throwing proxies were tested.

If sanitization cannot safely produce telemetry, the attribute/update is dropped. The original operation result and error identity remain unchanged.

## 13. Deterministic Tests

Eleven P04 tests cover:

- case-insensitive secret and repository-specific secret keys;
- PII omission;
- business, prompt/response, tool-argument and tool-result suppression;
- off/metadata/diagnostic enforcement and reserved namespace rejection;
- string/array/object bounds;
- circular, hostile, Error, Buffer, nullish and function fail-open behavior;
- helper-path failure containment;
- real dispatcher request correlation and Tool correlation;
- unsafe-ID hashing;
- multiple operation IDs without overwrite;
- disabled no-op result/error preservation.

Targeted P03A/P03B/P04 observability snapshot: `27/27 PASS`. Full deterministic snapshot: `1767/1768` with the one frozen Guardian-file failure.

## 14. Phoenix Correlation Evidence

```text
PROJECT=pump-ai-p04-correlation-test
TRACE_ID=c606645b2e625d7019fe39e39bc6bd58
AGENT_SPAN_ID=bbd99857502bd538
TOOL_SPAN_ID=cc2b449cbf8879d0
AGENT_PARENT=null
TOOL_PARENT=bbd99857502bd538
pump.request.id=p04-request-001
pump.operation.id=p04-operation-001
pump.audit.id=p04-audit-001
```

The evidence was retrieved from Phoenix REST project trace/span resources after an explicit flush. The safe IDs were present and the Tool parent matched the Agent span ID.

## 15. Sentinel Leakage Verification

The complete stored trace/span JSON for the project was searched after the final harness run:

```text
P04_SECRET_API_KEY_SENTINEL=0
P04_SECRET_PASSWORD_SENTINEL=0
P04_PII_EMAIL_SENTINEL=0
P04_PII_PHONE_SENTINEL=0
P04_BUSINESS_VALUE_SENTINEL=0
P04_TOOL_ARG_SENTINEL=0
P04_TOOL_RESULT_SENTINEL=0
```

Safe request/operation/audit IDs remained present. No prompt, response, raw entity, argument value, result value, credential, customer data, or business numeric payload appeared.

## 16. Phoenix-Down Verification

Only the Phoenix service was stopped; its volume was not deleted. With observability enabled, the same isolated harness returned:

```text
businessResult=p04-correlation-success
operationMatched=true
flush=false
shutdown=true
process_exit=0
```

The exporter failure produced only a sanitized local warning and normal control returned to the caller. There was no crash, retry loop, or indefinite wait. Phoenix was then started and verified `healthy`; `/healthz` returned `OK`.

## 17. Regression Comparison

```text
AI_OBSERVABILITY_ENABLED=false
P03B_BASELINE=1756/1757
P04_RESULT=1767/1768
P04_NEW_TESTS=11 PASS
SAME_KNOWN_FAILURE=YES
NEW_REGRESSION_INTRODUCED=NO
```

The sole failure is still `businessTerminologyContract.test.cjs` reading the absent `.guardian/config.yaml`. No Real AI, R4-B Real AI, Real AI Shadow, or Repeat Stability run was performed.

## 18. Files Changed

- `api/services/observability.cjs`
- `api/services/aiDispatcherV3.cjs` — existing request ID read only
- `api/routes/ai/executor.cjs` — existing capability/operation ID read only
- `tests/observabilityTracing.test.cjs`
- `tests/observabilityEntityRoutingVerification.test.cjs`
- `tests/observabilityCorrelationRedaction.test.cjs`
- `scripts/run-observability-p04-correlation-harness.cjs`
- `docs/ai-observability/reports/P04-correlation-redaction.md`

No dependency, prompt, router/resolver/normalizer, tool selection/argument, executor behavior, internal API behavior, verifier/evidence rule, business API, schema, business data, SSE, retry/fallback, Docker, Oracle, Shadow, or Guardian change was made.

## 19. Known Limitations

- Enforcement is centralized at the local observability helper API boundary, because the installed exporter does not expose a supported universal attribute-sanitizing processor through the current wrapper. No P04 business span bypasses this helper.
- `OITracer` may add its own standard span attributes, but P02 privacy flags still hide inputs, outputs, messages, images, text, embeddings, prompts, and tool definitions; provider auto-instrumentation remains disabled. The final Phoenix inspection showed only expected safe metadata.
- The integration harness uses the real dispatcher and Tool tracing boundaries with a fake business operation. It uses an isolated temporary test database and no paid model or business API.
- The first harness invocation loaded the existing application database module before test isolation, which invoked the existing startup-backup scheduler. It did not perform a business write; the single generated backup file was identified and removed. The harness was corrected before final evidence so all later runs create/migrate/delete only a temporary test database.
- Safe raw correlation IDs are intentionally visible to local Phoenix. Nonconforming IDs use a stable truncated SHA-256 hash; this is correlation minimization, not encryption.

## 20. P05 Preconditions

- Request correlation: `PASS` (`RAW_SAFE`, hash fallback)
- Operation correlation: `PASS` where existing ID/receipt is available; documented gap for ordinary reads
- Central sanitizer and reserved namespace policy: `PASS`
- Secret/PII/business/tool value leakage: `0`
- Content-mode enforcement and size guards: `PASS`
- Sanitizer and Phoenix-down fail-open: `PASS`
- Phoenix restored healthy: `PASS`
- Same frozen regression failure only: `PASS`
- AI/business behavior and database schema/data unchanged: `PASS`

`P05_READY=YES`

STOP — WAIT FOR SUPERVISOR REVIEW.
