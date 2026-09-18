# V5 Read Answer Shadow V1

## Scope and activation

Composer version 1, Prompt version 1. `readAnswerComposer.composeReadAnswer` is a controlled shadow-only entry point. All three environment flags must equal `true`: `AI_V5_SHADOW_ENABLED`, `AI_V5_EXECUTION_SHADOW_ENABLED`, `AI_V5_ANSWER_SHADOW_ENABLED`. Missing/false answer flag disables generation. No production default, dispatcher, user response, scheduler, Interpreter, execution or evidence semantics are changed.

The caller supplies a completed task's execution result, final exact entity context, original request, and explicit required fact keys. The Composer requires successful execution, valid evidence, PASS verification and all requested runtime handles. It uses only `getVerifiedEvidenceValue`, never a raw Tool DTO or comparator value. Missing access produces ANSWER_NOT_GENERATED before any model call.

## Approved facts and authority

Only price.current, inventory.quantity, coil.inventory and recipe.cost.preview are available. Required scope is software-owned and frozen from the Oracle before evaluation, not inferred from V4 answers. Price is current catalog unit price in CNY per catalog quantity unit. Quantity retains catalog units, coil stock uses sets, and recipe currentTotalCost remains a current cost preview per recipe unit, never settlement/final cost. No derived computation, rounding, conversion or additional facts are allowed.

Runtime evidence aliases are newly generated opaque references, each backed by a successful same-task/entity/execution/fact handoff. They are not database IDs or persisted ledger credentials. Model-facing facts omit task ID, canonical IDs and binding values. Non-coil entity labels come from final exact source identity; coil uses “该线圈方案” and a task-local entity reference, avoiding repetition of its scheme binding identifier. The original request is transient data, not an instruction authority.

## Model and contract

DeepSeek deepseek-v4-flash, temperature 0, JSON mode, 512 output tokens, one request, retry zero, Tools absent. The existing configured client is reused unchanged. Failures/timeouts become safe metadata. No agent loop, resolver, API read, write or second opinion is available.

Draft keys: version, answerStatus, answerText, claims. FACT claims require claimId, claimType, factKey, evidenceRefs, entityRef, numericValue. Values must be JSON numbers. LIMITATION permits only a fixed non-business limitation with null fact/entity/value and empty refs; it cannot replace required facts. Unknown/extra fields, reasoning and write/tool requests reject the draft.

## Grounding and deterministic realization

V1 uses bounded business sentences, not unrestricted prose. Input supplies approved fact realizations and requires newline concatenation. The validator independently reconstructs these from private verified values. Extra text, changed entity punctuation, semantic overstatement, missing facts and invented numbers reject the answer. This is a constrained expression test, not evidence that unrestricted language hallucinations can be reliably detected.

The numeric validator checks finite exact equality without coercion. The entity validator checks task-local entity and fact ownership. The main validator checks strict schema, authorized required fact keys, evidence ownership/validity, one claim per fact, full coverage, numeric/entity correctness and exact text realization. Internal refs/binding values in answerText reject the draft. Failure yields ANSWER_SHADOW_REJECTED without retry or user response.

## Runtime privacy and observability

Request, input/output, entity labels and values remain transient. The default `composeReadAnswer` return remains verdict/counts/duration/safe digest only. P16-C adds `composeReadAnswerForCanary` as an internal, synchronous post-validation body sink: the existing complete validator must accept before only `answerText` is delivered to the request-local controlled preview consumer. No raw draft, claims, evidence objects or reusable content handle are returned. Global canary enablement, explicit opt-in, internal authorization and an open request are required. Invalid/exceptional validation delivers nothing. The sink is not stored and no answer is retained after completion. This is delivery contract version 1; Composer/prompt versions and all answer semantics remain unchanged. See [controlled preview contract](v5-read-canary-v1.md).

`pump.ai.v5.read-answer` and `pump.ai.v5.answer-validation` spans contain only correlation/count/model metadata under the active root. No prompt, answer or evidence values enter Phoenix/logs. The approved body sink is a transport operation, never an observability callback.

## Controlled evaluation and performance

Formal evaluation establishes 15 read tasks once in the existing isolated query-only snapshot, compares reads independently to formal APIs, consumes certified runtime handoff, then calls the answer model once per eligible path. Frozen task/Oracle preparation is not an Interpreter rerun. Historical datasets are not overwritten. No post-evaluation tuning/regeneration is permitted.

Performance uses the A3C external fixed-slot keep-alive client, warmup 24/measured 200, response `finish` timestamps and 2/4/8 loads. Both sides run the real governed read chain under the unchanged mirror; only the answer flag differs. Performance uses a controlled fake model with the real Composer/Validator, not extra formal answer calls. Answer completion is separate. Transport validity is independent of overhead; bounded invalid-pair replacements do not discard valid slow pairs.

## Boundaries

P16-B2A resolved the prior handoff blocker. No Evidence/Verification semantics are changed; historical datasets cannot supply runtime values. Ordinary shadow callers remain metadata-only. P16-C delivers supplementary preview only. P16-D reuses the same validated-body sink behind additional independent authority gates to select an explicit internal request's normal final response; see [authority contract](v5-read-authority-v1.md). Preview headers never grant authority. Historical P16-B2R certification remains frozen; each delivery stage has its own report and tests. No global production replacement is enabled.
