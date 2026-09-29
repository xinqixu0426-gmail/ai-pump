# Old AI Retirement and Shared-Function Extraction Plan

## Classification rule

“Old” here means Semantic/Task/Goal/Controller orchestration for ordinary reads. It does not mean the business APIs, `costEngine`, formal identity authority, authentication, internal API boundary, or protected write safety currently used by that orchestration.

## KEEP_CORE (18 groups)

| Modules / group | Why retained |
| --- | --- |
| `api/db.cjs`, SQLite schema/migrations, domain services, `api/services/costEngine.cjs` | Deterministic business truth, safe writes, cost authority |
| Business routes and formal services for recipes, coils, parts, orders, quotations, inventory, market, templates | Current formal APIs that tools call |
| `api/capabilities/registry.cjs`, `monetaryPresentationContract.cjs` | Capability/business authority and money provenance; retain while simplifying AI-facing metadata |
| `api/routes/ai/executor.cjs`, `api/routes/ai/executors/*` | Safe Tool executor and API-only execution boundary |
| `api/routes/ai/internalApiClient.cjs`, `api/services/internalWriteAuthorization.cjs` | Internal formal API client and independent machine-write credential boundary |
| `api/services/aiToolInputValidatorV2.cjs` | Tool argument validation; rename/generalize only if required |
| `api/services/aiExecutionEvidence.cjs` | Formal API read/write evidence verification |
| `api/services/aiToolConfirmation.cjs`, `aiToolConfirmationRevision.cjs`, `aiConfirmedToolExecution.cjs` | Frozen confirmation, subject binding, execution, replay protection and receipts |
| `api/services/aiPartExecution.cjs`, `aiCoilStockExecution.cjs` | Formal write preflights and target verification |
| `api/services/internalWriteAuthorization.cjs`, command audit/operation services | Write credential, operation and audit boundary |
| `api/services/aiConversations.cjs` (normal conversation CRUD/history) | Owner-bound ordinary conversation persistence; discard Task V2 continuation interpretation |
| `api/services/aiProviderRegistry.cjs`, minimal DeepSeek provider transport in `aiProvider.cjs` | Provider configuration/transport; simplify to DeepSeek MVP only |
| `api/services/aiRuntimeTelemetry.cjs`, `observability.cjs`, `requestObservability.cjs` | Useful request/tool observability, after removing Task V2 labels |
| `api/services/ownerAuthentication*.cjs`, `api/authMiddleware.cjs` | Owner and authentication boundary |
| `api/ontology/**`, resolver contracts and canonical relation/entity services | Formal identity and fact authority |
| `api/services/recipeTechnicalProfile*.cjs` canonical authority | Canonical recipe technical facts |
| `api/services/recipeScenarioComparison.cjs`, `profitabilityPreview.cjs`, `virtualReadinessPreview.cjs`, `orderPlanning.cjs` | Deterministic preview/read services |
| `api/routes/ai/chat.cjs` transport/SSE/auth shell | Retain route shell; replace its dispatcher invocation and remove rollout/task-specific state |

## KEEP_AND_SIMPLIFY (7 groups)

| Modules / group | Required simplification |
| --- | --- |
| `api/capabilities/registry.cjs` + `api/routes/ai/tools.cjs` + `aiNativeToolDefinitionsV2.cjs` | Preserve formal access metadata; create one concise READ/PREVIEW Agent definition surface, remove old/native split and Task V2 prompt assumptions |
| `api/services/aiProvider.cjs` | Keep isolated DeepSeek calls; remove local/Kimi routing from Judge/Main MVP path |
| `api/services/aiConversations.cjs` | Keep bounded recent normal conversation; remove `loadAiConversationContinuation` clarification/receipt recovery semantics and `loadAiRecentPartWrite` routing reliance |
| `api/services/aiRuntimeTelemetry.cjs` / `observability.cjs` | Keep tracing but rename stages to Judge/Main Agent/Tool and stop treating Task V2 state as product outcome |
| `api/services/aiNativeRolloutPolicy.cjs` | Replace owner/native terminology and old modes with new-MVP enablement; never use it to select an old runtime fallback |
| `api/services/aiTurnStateV3.cjs` | Replace client-provided entity carryover with bounded server-owned normal conversation/context, or remove if no demonstrated need |
| `api/services/aiResourceResolutionV3.cjs` / `entityLookupService.cjs` | Keep formal resolution support but let Agent choose safe reads; no mandatory pre-router/admission gate |

## EXTRACT_SHARED_THEN_DELETE_OLD (6 groups)

| Old location / trapped function | Current importers and reachability | Neutral extraction and replacement | Deletion stage |
| --- | --- | --- | --- |
| `aiTaskWriteBridgeV2.cjs`: frozen W1 proposal facts, proposal hash/version checks, idempotency context, reconciled target verification | `/api/ai/tasks`, `aiNativeWriteChatBridgeV2`; current write endpoint reachable if rollout allows | Extract `protectedWriteProposal` service that accepts a declared capability and formal preflight result; retain only W1 `adjust_part_stock` scope | Before deleting Task V2 routes, after new protected path passes write tests |
| `aiNativeWriteChatBridgeV2.cjs`: chat-to-proposal orchestration | `aiDispatcherV3`; read/write chat route currently reachable | New Main Agent mutation adapter invokes extracted protected proposal service; no Task envelope | MVP write integration stage |
| `aiTaskControllerV2.cjs:createEnvelope` only as used by native write bridge | `aiNativeWriteChatBridgeV2` plus old controller/tests/tasks | Extract a minimal owner/message/proposal correlation record if required; do not preserve Task/Goal envelope | Before controller deletion |
| `aiTaskOperationReadbackV2.cjs` formal operation lookup | `/api/ai/tasks` write reconcile | Extract neutral `protectedOperationReadback` used by the protected write executor | Before task route deletion |
| `aiTaskCapabilityAdapterV2.cjs`: `readJsonPointer`/pointer helper | controller, facts, structured reads | Move only a generic JSON-pointer utility if independently needed; do not retain Task capability adapter | During Task V2 removal |
| `aiTaskDocumentsV2.cjs`: bounded source-document normalization helpers, if still needed by knowledge/file tools | controller, answer, validation | Extract only generic source citation/Unicode truncation helpers after a concrete Main Agent need is proven | Conditional; otherwise delete with Task V2 |

## DELETE_AFTER_MVP_CUTOVER (22 modules/groups)

| Candidate | Current importers / production reachability | New MVP replacement | Deletion stage |
| --- | --- | --- | --- |
| `aiDispatcherV3.cjs` | `routes/ai/chat.cjs`, `processAiChat`; normal chat reachable | New Judge/Main dispatcher | Cutover commit |
| `aiTaskSemanticsV2.cjs` and `api/business-semantics/questionSemantics.cjs`, `readinessSemantics.cjs`, `packagingSemantics.cjs` insofar as they route ordinary reads | `aiTaskControllerV2`, tests; reachable through chat | DeepSeek Judge + Domain Policy, formal tool schemas | Cutover |
| `aiTaskControllerV2.cjs` | dispatcher, tasks route, owner coverage, worker, write bridge; normal read reachable | Main Agent bounded investigation | After write extraction |
| `aiTaskCapabilityAdapterV2.cjs` | controller/facts/structured reads | Direct safe Tool calling | Cutover |
| `aiTaskAnswerV2.cjs` | controller/owner coverage | Main Agent natural answer policy | Cutover |
| `aiTaskFactsV2.cjs`, `aiTaskValidationV2.cjs`, `aiTaskStructuredReadsV2.cjs` | controller/adapter/answer | Formal tool result evidence only; no mandatory Receipt->Fact->Requirement chain | Cutover |
| `aiTaskContractV2.cjs`, `aiTaskStoreV2.cjs`, `aiTaskLifecycleV2.cjs`, `aiTaskPublicV2.cjs` | tasks route, lifecycle, worker/recovery/tests | No ordinary-read task contract/state machine | After extracted write correlation is live |
| `aiTaskWorkerV2.cjs`, `aiTaskRecoveryV2.cjs`, `aiTaskSessionV2.cjs` | worker/controller/tasks | Bounded in-turn Agent only; normal conversation persistence remains | Cutover |
| `api/routes/ai/tasks.cjs` ordinary task endpoints (`POST/GET/resume/cancel/events`) | mounted by `api/routes/ai.cjs`, externally reachable | Remove; protected mutation receives dedicated non-Task endpoint only if needed | After write extraction/cutover |
| `aiNativeOwnerTrialCoverage.cjs` | controller/tests | Acceptance matrix and Agent evals, not GoalKind coverage table | Cutover |
| `aiNativeRolloutPolicy.cjs` old `off/shadow/owner` meanings and `ontologyRelationCanaryEligibility.cjs` canary selection | chat/tasks/tests | New MVP enablement without old fallback/canary-to-old path | Cutover |
| `aiTurnStateV3.cjs` | chat/tests | Bounded normal conversation supplied to Judge/Main Agent | Cutover unless a neutral replacement is demonstrated |
| `aiProtectedCommandRoute.cjs` deterministic natural-language command routing | dispatcher/native write bridge | Judge `PERSIST_MUTATION` plus protected proposal validation | After W1 extraction |
| `aiNativeWriteScope.cjs` as Task V2-specific scope wrapper | dispatcher/write bridge/tests | Neutral protected-write capability allowlist | After extraction |
| `aiTaskDocumentsV2.cjs` task evidence/candidate model | controller/answer/validation | Main Agent file/knowledge tool results; generic helpers only if extracted | Cutover |
| `aiTaskOperationReadbackV2.cjs` | task route/write bridge | Neutral extracted readback | After extraction |
| `aiNativeToolDefinitionsV2.cjs` as a separate native catalogue | Task adapter/registry guard | Unified safe tool definitions | Cutover |
| Task V2-specific test suites and static-contract assertions | test-only | New Judge/Main, tool/evidence and protected-write tests | Same PR series as removal |
| Old Task V2 docs/handoffs/canary reports that state current runtime behavior | docs only | Replace authoritative current docs; archive historical evidence only when it no longer claims current fact | Final documentation cleanup |

## KEEP_TEMPORARILY_FOR_MIGRATION_ONLY (3 groups)

| Group | Why temporary | Removal condition |
| --- | --- | --- |
| Current `aiDispatcherV3` + Task V2 read path | It is the presently reachable assistant and cannot be removed before a working new path is cut over | New chat route passes acceptance matrix and has no old fallback |
| Task V2 W1 write bridge/routes | Current narrow protected stock-write behavior depends on Task lifecycle/proposal records | Neutral protected proposal/execution/readback extraction verified |
| Old rollout/canary configuration | Needed only to keep the existing deployment running before the new switch | New-MVP enablement set and old route reachability tests prove zero |

## No-fallback verification checklist for removal PR

1. `rg` shows no runtime import path from `/api/ai/chat` to any Task V2/Semantics/Controller/Answer module.
2. A deliberate Judge/Main/Tool failure returns a bounded failure; it does not return a Task V2 answer.
3. No environment flag, shadow mode, catch branch, or test-only route restores old answering.
4. Protected W1 write preflight, Owner approval, idempotency, audit, and readback work using extracted neutral code.
5. The retired task routes and worker cannot be reached, and their migrations/data retention have a separately approved deletion plan.

## Resolution

Every relevant current-path module above has a classification. `UNKNOWN: 0`.
