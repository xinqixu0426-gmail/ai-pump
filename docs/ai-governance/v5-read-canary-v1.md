# V5 Controlled Read Preview Contract V1

## Registration and authority

This is the optional internal preview variant of existing `POST /api/ai/chat`, not a new business capability, Tool or V5 routing mode. Existing capability registry, source-of-truth, read policy and bounded Tool exposure remain authoritative. Caller: authenticated internal service only. Access: read-only AI orchestration; no command preview or confirmation. Risk: bounded L1/L2 reads enforced by the existing registry. Source: the same formal Business APIs, verified runtime evidence and constrained P16-B2R Composer.

Input: existing chat body plus exact headers `x-pump-v5-preview: true` and `x-pump-v5-fact` naming one of `price.current`, `inventory.quantity`, `coil.inventory`, `recipe.cost.preview`. Existing `x-internal-secret` identity is mandatory even for an otherwise authenticated user. No identity or Tool argument can be supplied through these headers. This explicit fact selection is only preview scope; it does not change the raw request, Interpreter, capability choice or authoritative entity. Incompatible fact/capability combinations fail closed. No natural-language fact classifier is introduced.

Global gate: `AI_V5_READ_CANARY_ENABLED`, exact string `true`, missing/false defaults OFF. Neither gate alone executes V5 preview. Existing independent shadow switches/sampling remain unchanged. The explicit preview creates a request-local environment enabling the existing read/answer shadow functions; no process-global flags are written. Disabling the global gate independently removes future previews.

## Transport and lifetime

The existing dispatcher completes and sends authoritative legacy `content`, state and `done` events first. An internal opt-in consumer may continue reading the same connection after legacy `done` for one supplementary event:

`{ type: 'v5_preview', preview: true, authoritative: false, answerText: string }`

It must never replace/save this event as the production answer. Gate-OFF requests retain existing headers/events. Authorized opt-in responses use `Cache-Control: no-store`. No new endpoint, global preference, automatic fallback, UI feature, persistence or traffic percentage exists. A preview failure emits no body or error into the legacy stream; EOF ends the optional channel. Existing clients stopping at legacy `done` need no changes.

The Composer owns raw model content and all validators. Its internal canary function invokes a synchronous request-local body sink only after every existing validation gate passes. Claims/evidence/raw JSON are never delivered. The consumer writes the validated body immediately and returns a boolean transport receipt; no body store, content registry, global mutable state or answer handle exists. Request abort suppresses delivery before/after asynchronous stages. Nothing remains available for retrieval after completion. Internal consumers must not log, cache, persist or reuse the body.

Timeouts: existing bounded Interpreter stage/lookup and read/answer timeouts, plus the existing chat request deadline. Model settings/prompt remain frozen; one Answer Model call, no retry or second investigation. Idempotency, concurrency version, transaction and audit writes: not applicable to this read-only supplementary operation. Each invocation has a fresh task identity and private evidence; no cross-request evidence or body reuse.

## Safety and observability

The legacy risk summary must pass the existing shadow eligibility classifier before interpretation. The final deterministic route must match the requested fact's approved capability and pass `selectReadExecution`; the existing executor always receives `allowWrite:false`. Mutation/unknown/ambiguous/unsupported paths do not broaden investigation. The complete execution/evidence/answer validation chain remains unchanged apart from the approved delivery sink.

Only boolean gate/attempt/eligibility/validation/exposure status and a bounded failure class enter new metadata spans. No body, prompt, entity name, canonical ID, fact value or Tool value enters telemetry, logs, errors, datasets or reports. Canary and answer spans are nested in an invocation-specific Agent root. Observer and preview failures cannot alter the completed authoritative response.

## Verification and limitations

`tests/aiV5ReadCanary.test.cjs` covers delivery gates, validators, failures, request isolation, write exclusion and the actual chat handler. `scripts/run-ai-v5-p16c-certification.cjs` uses the frozen 15-path corpus, real Interpreter, governed reads and real Answer Model in a query-only isolated fixture. Legacy content/done are deterministic dispatcher-seam events, so this proves handler preservation, not newly sampled V4 answer quality. No production deployment or live V4 defect repair is claimed.

`scripts/certify-p16c-gate-performance.cjs` compares the start-commit chat handler with current gate-OFF handler using the existing external A3C client, paired fixed slots, 24 warmups and 200 measured requests, synthetic legacy duration, response-finish timing and independent transport-validity criteria. Preview latency is measured separately from authoritative response completion.
