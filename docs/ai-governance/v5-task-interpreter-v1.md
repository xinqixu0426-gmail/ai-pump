# V5 Task Interpreter V1

## Scope

Task Interpreter V1 is an asynchronous, shadow-only boundary that converts one raw user request into a validated structural proposal. It may classify `domain`, `operation`, ontology entity types, exact source candidate locations, and clarification status. It cannot select a Tool, choose a business ID, decide policy, verify evidence, execute anything, or answer the user.

Constants:

```text
V5_TASK_INTERPRETER_VERSION=1
V5_TASK_INTERPRETER_PROMPT_VERSION=1
V5_INTERPRETER_RETRY_COUNT=0
DEFAULT_V5_INTERPRETER_TIMEOUT_MS=20000
```

## Structured contract

The only accepted top-level keys are:

```text
version
domain
operation
entityCandidates
needsClarification
reasonCodes
```

Each entity candidate contains exactly `entityType` and transient `candidateText`. Domain/operation pairs are derived from Capability Registry V1 and entity types from Business Ontology V1. Unknown values, unknown versions, extra fields such as `toolName`, malformed JSON, or unsupported reason codes fail closed.

## Prompt and provider

Prompt V1 is one small enum-oriented system instruction plus the current raw user request. It does not copy the V4 system prompt. The interpreter reuses the configured production-compatible provider and model. It sends no Tool definitions, performs one non-streaming request, uses one provider attempt, has no fallback/replanning loop, and never retries.

P15 freezes Prompt V1 before real evaluation. A failed evaluation is evidence for a future separately approved version; it is not tuned repeatedly in P15.

## Source anchoring

`candidateText` is not trusted as `rawMention`. Deterministic code locates it in the original user request and constructs `rawMention` from `sourceRequest.slice(...)` only when there is exactly one valid occurrence. A missing occurrence returns `INVALID_ENTITY_REFERENCE`; multiple occurrences return `AMBIGUOUS_ENTITY_REFERENCE`.

An ASCII/numeric candidate that is only a prefix or infix of a longer entity token is rejected. No fuzzy search, normalization, punctuation removal, translation, numeric coercion, or repair is allowed. Thus `v750-tokoy` cannot anchor to a source containing only `v750-tokoy-`, while `v750-tokoy-`, `V750-A`, `800平刀`, and string `800` remain exact source strings.

All candidates are required in V1. Any candidate anchor failure stops routing; partial guessing is forbidden.

## Validation and routing

The pipeline is:

```text
provider output
→ strict JSON parse
→ exact-key schema validation
→ registry domain/operation validation
→ ontology entity-type validation
→ exact source anchoring
→ V5Task shadow transitions to ROUTING
→ deterministic V5-B Capability Router
→ V5-B bounded Tool exposure
```

Only `SELECTED` produces an allowlist projection. `AMBIGUOUS`, `UNRESOLVED`, `INVALID`, clarification, or anchor failure exposes zero Tools. Exposure remains `executionAllowed=false`.

## Fail-closed and fail-open

Interpreter validation is fail-closed inside V5. Model error and timeout produce `V5_SHADOW_INTERPRETER_ERROR` or `SHADOW_INTERPRETER_TIMEOUT`. The outer Shadow remains fail-open for V4: it is scheduled after V4 execution, bounded by the existing capacity controller, and never affects the V4 result, SSE, Tool path, or business state.

## Privacy

The raw request, raw provider output, `candidateText`, and anchored `rawMention` exist only transiently in memory. They are absent from V5 outcomes, Phoenix attributes/events, datasets, reports, and normal logs. Persisted structure is limited to enums, anchor status/count, capability ID, Tool names, reason codes, correlation, timings, and provider-reported aggregate token counts.

## No-Tool / no-execution invariant

The interpreter request contains no Tool definitions and cannot function-call a Tool. P15 allows V5 interpreter model calls only. V5 Tool calls, Business API calls, writes, user-visible responses, and production routing remain zero.
