# V5 Explicit Read Authority Canary V1

## Registration and independent gates

This is a request-scoped final-response variant of existing `POST /api/ai/chat`, not a new business capability, Tool, public mode or rollout framework. Internal callers only; existing `x-internal-secret` authentication is required. Access remains read-only AI orchestration with the frozen L1/L2 read registry and formal Business APIs as source of truth. No command/confirmation/transaction/audit-write/idempotent-write semantics are added.

All three switches must be explicit: `AI_V5_READ_CANARY_ENABLED=true`, `AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED=true`, and request header `x-pump-v5-use: true`. Both environment flags default OFF. A valid internal identity and a compatible approved `x-pump-v5-fact` are independently required. Missing/invalid identity, either flag alone, or request marker alone cannot activate authority. No request/session/user/cookie assignment or random/percentage selection exists.

P16-C `x-pump-v5-preview:true` remains supplementary only and cannot grant authority. Its HTTP adapter, gates and body channel remain unchanged. When both request markers appear on an authorized P16-D request, the authority path runs once; the optional P16-C adapter is not called again. A failed authority attempt never triggers another preview/model call.

## Final response selection

`readAuthorityMux.cjs` owns only response selection. For an authenticated authority request, the existing dispatcher runs once with request-local buffered SSE events. This preserves a complete legacy fallback and its existing risk classification without redesigning the frozen read pipeline. Ordinary and P16-C requests continue to emit immediately through the existing path.

After legacy completion, the mux passes its safe risk summary and the original request into frozen `runReadCanary`. The same Interpreter, deterministic identity/routing, Tool binding, read execution, verified facts, Composer and validators run unchanged. The P16-D adapter uses the approved internal validated-body sink only after the independent authority gate; it does not change or fabricate public preview headers. No raw model output is available to the mux.

The validated body stays in a request-local variable until the frozen chain returns successful validation and delivery metadata. Only then does the mux discard buffered legacy events and emit ordinary `provider`, `content` and `done` events containing that body. Legacy turn state is not reused for a different final answer. The standard content payload remains `{ content: string }`; no new final-answer body field is introduced.

On any failure/exception, no partial V5 content is emitted and the original legacy event sequence becomes final. No second model call, relaxed validation, broader investigation or mutation occurs. A cancelled/disconnected request suppresses delivery. Buffered events and body references are cleared on completion, failure or close. No body registry, cache or retrieval API exists. Authorized responses use `Cache-Control: no-store`.

## Safety, lifetime and telemetry

Approved facts stay exactly price.current, inventory.quantity, coil.inventory and recipe.cost.preview. Legacy mutation classification or unsupported final routing blocks V5 execution; the frozen executor still requires allowWrite=false. No authority or preview production flag/configuration is enabled by this code.

Authority observability records only requested/attempted/eligible/validated/fallback booleans, bounded failure class and final source class (`legacy/current` or `v5-authoritative-canary`). Each metadata span has an Agent root. Raw/validated body, user request, business facts and entity values are excluded from all new logs/traces/datasets. No new persistence is introduced; the existing response transport is the only body output.

Legacy runs before V5, so successful authority latency includes legacy completion plus the bounded V5 chain. On failure the already available legacy events are released immediately after detection. Existing request, Interpreter, lookup, read and Answer Model deadlines remain unchanged; no retry budget is added. This makes rollback a request-level opt-out or disabling either global gate; no data migration is required.

## Certification scope

Tests use the actual chat handler and deterministic legacy dispatcher events to verify final selection, all gate combinations, P16-C separation, invalid authentication, failure fallback, writes, non-sticky scope and distinct concurrent bodies. Real frozen-corpus certification executes the unchanged V5 Interpreter, governed reads and Answer Model over a query-only isolated fixture. It does not reevaluate real production V4 answer quality or deploy anything.

Gate-OFF performance compares the current handler to the P16-C start-commit handler using the existing external A3C fixed-slot client and identical synthetic legacy workload. Authoritative latency is measured from handler invocation through final done, after independent Oracle preparation. These are controlled integration measurements, not production workload capacity estimates.
