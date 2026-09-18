# V5-E4R-E-B2-A Stage1 Invocation Failure Audit

## 1. Executive Result

Audit PASS; P15R_E_B2_B_READY=NO; P16_READY=NO. Two authorized non-business synthetic invocation attempts reproduce HTTP 400 invalid_request_error. The provider identifies a JSON-mode message-format precondition: the prompt must contain the JSON word. Current Stage 1 instructions and synthetic messages do not contain it; historical Protocol V2 instructions explicitly do. Bypassing callStage and directly using the historical requestConfiguredInterpreterModel with identical Stage 1 messages still fails. Primary classification: JSON_MODE_COMPATIBILITY; related MODEL_REQUEST_PARAMETER_BUG, ERROR_WRAPPING_LOST_CAUSE and EVALUATION_HARNESS_BUG.

The historical provider error itself is irrecoverable. This is strong same-stack reproduction and static attribution, not recovery of the original response. No evidence supports network transient, bad credentials, wrong model, or semantic classification failure.

There is a governance conflict: resolving the observed rejection while retaining JSON mode requires an effective message-format instruction change. Calling that change an adapter fix does not make the effective prompt byte-identical. This audit does not authorize it and does not alter prompts/settings. Supervisor must approve a strictly format-only exception before B2-B implementation/resume. No semantic tuning is recommended.

## 2. Frozen B2 State

Start aeb0072d75fc44b7cc20005dacf5d2c772539524, master, user-owned dirty worktree. Architecture 3 / external Contract 1. Original run attempted one path, P06-COIL-001-LEGACY; Stage1 ERROR, no valid output, no entity lookup or Stage2. Fourteen paths never executed. Original dataset and results remain untouched.

All 36 entries in the existing freeze manifest were recomputed by the frozen freezeHashes helper before and after both canaries and matched B2. This covers both prompts/protocols, candidate/local/finalization layers, authority API/client/resolver, source span/anchor, class/semantics, router/exposure, settings, evaluator, corpus and expected results. Existing model client/provider files have no audit changes. Only this analysis script, safe dataset and report are deliverables.

## 3. Failed Invocation Call Chain

run-ai-v5e4r-two-stage-evaluation.main → interpretCandidateSetTask → withV5InterpreterStage(span-selection) → selectSourceSpan → callStage → requestConfiguredInterpreterModel → fetchProviderWithRetry → DeepSeek /chat/completions.

The canary reaches the provider and receives HTTP 400. The first locally constructed exception is providerHttpError called by requestConfiguredInterpreterModel after response.ok=false. It preserves generic local code/status, but embeds a bounded provider body excerpt in Error.message rather than extracting an allowlisted provider reason. callStage.catch is the first layer that discards the complete local error: it returns only ERROR/TIMEOUT and duration. selectSourceSpan returns this result; interpretCandidateSetTask supplies SPAN_SELECTION_ERROR. No parser, anchor, lookup or capability step causes the invocation rejection.

Original Phoenix trace was inspected read-only: four spans, Stage1 ERROR, zero events, no error-code/status/cause attributes. Parent AGENT status remains OK because no exception escapes. The trace cannot recover the original provider error.

## 4. Request Shape Comparison

| Field | Historical V5 request | Current Stage1 |
|---|---|---|
| Provider/model | DeepSeek/deepseek-v4-flash | Same |
| Endpoint/client | requestConfiguredInterpreterModel → /chat/completions | Same function and endpoint |
| temperature/top_p | 0 / omitted | Same |
| response_format/max_tokens | json_object / 512 | Same |
| thinking | disabled | Same |
| roles/content | system + user, string content | Same types |
| messages content | Protocol V2 instruction, classes/context/spans/source | Stage1 instruction + JSON-serialized request/spans |
| Explicit JSON word in system instruction | Present | Absent |
| Tools/stream | Tools omitted / false | Same |
| timeout/signal | 20 seconds / AbortController | Same nominal deadline; wrapper timeout implementation differs |
| env | passed selected configuration | request-local copy pins the same provider/model |
| observation | streaming:false metadata | streaming metadata omitted; not part of wire body |

The JSON serializer producing braces is not equivalent to including the literal JSON word inside a message. The response_format property is outside messages. No successful modified request was attempted. Local Intent instructions share this absence and therefore have the same static compatibility risk; no Stage2 canary was authorized or run.

## 5. Model / Provider Routing

Live wire metadata confirms api.deepseek.com/chat/completions, deepseek-v4-flash, temp0, omitted top_p, JSON object, 512, thinking disabled, stream false and no tools. Request-local env pins provider/model without changing V4 globals. resolveAiProviderConfig returns that config; no alternate-model alias conversion occurs. Historical V5 uses the same request function. Production DispatcherV3 delegates fetchAiProvider through traceModelProvider into the V4 runtime; that general path supports additional routing/Tools/streaming and is not an equivalent JSON canary. No V4 call was made.

## 6. JSON Mode / Parameters

The provider adapter serializes the frozen response_format correctly. The compatibility defect is the messages precondition, not unsupported JSON mode or an invalid model identifier. Canary B's privacy-safe reason features identify JSON, prompt, contain, word and requirement terms; normalized reason: JSON_MODE_REQUIRES_JSON_TOKEN_IN_MESSAGES. No response text is retained.

Canary A's first narrow reason classifier expected the term messages and therefore recorded UNCLASSIFIED_PROVIDER_REJECTION; that record is retained. Canary B inspected the same rejection through a broader safe classifier that also recognizes prompt. This changes only audit classification, never a model input or parameter.

## 7. Error Preservation

| Item | Before callStage.catch | Original persisted result |
|---|---|---|
| Error class | AiProviderHttpError | Lost |
| Local code | AI_PROVIDER_REQUEST_ERROR | Lost |
| HTTP status | 400 | Lost |
| retryable | false | Lost |
| Provider error type | raw response has invalid_request_error; not structurally extracted by client | Lost |
| Safe provider reason | not structurally extracted | Lost |
| Cause chain | HTTP wrapper does not attach original response as cause; network wrapper does preserve cause | Lost at stage wrapper |

Future safe fields: allowlisted error class, local/provider code, numeric HTTP status, retryable, timeout/requestRejected flags and normalized allowlisted reason. Never persist Error.message wholesale, raw body, request headers/body, keys, source text or arbitrary cause/stack objects. HTTP response excerpts in current Error.message must not be copied into Phoenix. Error preservation must retain safe metadata without exposing provider free text.

## 8. Synthetic Canary Evidence

Two calls total; no frozen input, no real entity, no altered instruction/settings, no retries. Synthetic lexical source is generated inside the audit script and its text is not stored in this report/dataset.

A: unchanged selectSourceSpan → callStage → original request function; a pass-through observer captures safe exception fields then rethrows the exact exception. Result FAIL/ERROR, HTTP400, AiProviderHttpError, AI_PROVIDER_REQUEST_ERROR, invalid_request_error. One network attempt.

B: exact same Stage1 messages, same model/settings, direct historical requestConfiguredInterpreterModel, bypassing only callStage. FAIL with the same local class/code/status, explicit normalized JSON-message requirement. One network attempt. This exonerates wrapper invocation wiring as the source of HTTP rejection, while independently proving its diagnostic information loss. Canary B is not a successful historical Protocol V2 semantic rerun; historical instruction content was not substituted.

Budget exhausted. No call to test a fix was made.

## 9. Stage1 Root Cause

Primary JSON_MODE_COMPATIBILITY: frozen Stage1 request construction omits an explicit JSON-mode message marker required by the provider. Secondary MODEL_REQUEST_PARAMETER_BUG describes the body/messages compatibility defect; ERROR_WRAPPING_LOST_CAUSE explains why B2 only recorded ERROR. Original provider response/code are unavailable; reproduction supports attribution strongly but cannot exclude an additional coincident historical failure. Do not relabel it a transient.

The model never produced a class/span choice in the original run; this is not evidence against the candidate-set architecture's semantic ability. It also is not evidence that semantic gates would pass after repair.

## 10. Evaluator Fatal Exit Semantics

After storing the case, the evaluator throws FORMAL_EVALUATION_INFRASTRUCTURE_FATAL on ERROR/TIMEOUT. Its inner catch only assigns dataset.fatalReason. finally writes hashes/metrics, flushes tracing and closes resources; execution then reaches console.log and fulfills main. The terminal main().catch sets process.exitCode=1 only on a rejected main promise, so it never executes for this swallowed fatal. Exit defaults to zero.

An isolated child process executed the exact catch clause extracted from the frozen runner with a synthetic throw: fatal recorded=true, exit=0. No evaluator main, model, DB or business path was invoked by this control-flow reproduction.

Future contract: completed successful evaluation exits0; completed semantic misses use a documented gate-failure outcome (separate from infrastructure fatal); infrastructure ERROR before valid interpretation must persist evidence and then exit nonzero. Cleanup/report-writing errors also must not hide fatal failure. No production runner was changed.

## 11. Resume Integrity

Original semantic evaluation integrity=PRESERVED_BUT_NOT_STARTED: one attempted invocation produced no valid interpreter result, and remaining14 were never executed. Original attempt, error and false-block record must remain immutable and attributable to the failed infrastructure run.

B2_RESUME_ALLOWED=NO under the currently frozen effective-message constraint. Conditional future scope after explicit Supervisor format-only approval: re-evaluate failed first path (NOT_VALIDLY_EVALUATED) plus the14 unexecuted paths, without treating the original attempt as a successful semantic sample. FAILED_FIRST_PATH_MUST_BE_RERUN=YES for any eventual complete semantic evaluation, not authorization to run now. No resumption is performed here.

## 12. Required Fix Scope

Recommended classes: REQUEST_PARAMETER_FIX, ERROR_PRESERVATION_FIX, EVALUATOR_FATAL_EXIT_FIX. Stage1 invocation wiring itself is not implicated; no model, retry, fallback, task-class, entity or architecture change is recommended.

Maximum currently uncontroversial next scope: safe allowlisted error projection and evaluator fatal exit handling plus deterministic tests. Invocation compatibility is BLOCKED pending Supervisor approval for a format-only effective-message marker shared consistently by both stages. Do not conceal this as an invisible adapter change: effective request bytes and corresponding hashes would change and must be refrozen. Do not add business instructions, examples or semantic tuning; do not change response_format/temp/model. No patch is implemented in this audit.

## 13. Database / Privacy Safety

Before/after two canaries: hash, mtime, size unchanged; backups209 unchanged; database size35,323,904. Snapshot uses filesystem bytes/stat only, no SQL connection. No business API, Tool, resolver or frozen model calls. Synthetic provider calls2. Production/interpreter/dependency changes0. Captured wire metadata excludes headers and text; provider reasons are category/boolean only. Original Phoenix inspection showed no cause or input/output; it was not modified.

Deep API failure remains PRE_EXISTING per frozen B2 evidence; not rerun or repaired in this audit. The script has a persisted one-shot marker for A and a STARTED marker for B; both quotas are now consumed. No audit path can legitimately be used as a corpus rerunner.

## 14. P15R-E-B2-B Preconditions

P15R_E_B2_B_READY=NO. Failure and exit-control-flow causes are sufficiently isolated, but a prompt/effective-message freeze exception is required for the minimal JSON compatibility repair. Supervisor must decide that boundary and authorize subsequent infrastructure changes before a new freeze and evaluation. P16 remains blocked. Current production files and original B2 artifacts remain unchanged; only analysis script, safe audit dataset and this report are committed.
