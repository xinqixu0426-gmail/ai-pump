# P16-E-R4L-R1 Eligibility Audit

Historical R1 assessment. Current implementation and readiness are documented in [Local Candidate Safety Closure](P16-E-R4L-local-read-only-candidate-runtime.md); this earlier blocker is not the current verdict.

Status: BLOCKED. No eligibility implementation or commit. R4L implementation and both its success and failure evidence remain intact. Production was not accessed.

Start/End HEAD: `6f0c78282050bbe2b1a04bf04f697f85e02d9521`, master. All 24 original user-owned files verified against the R4L ownership manifest; removing only the recorded Stage documentation additions reproduces their original bytes.

## Actual P16-D boundary

1. `readAuthorityMux.cjs:finalize(result)` consumes the completed legacy result.
2. `shadowProjection.cjs:captureSafeV4ShadowFacts` derives requestMode from `result.intent.mode` and toolSteps from actual `result.telemetry.toolSteps`.
3. `readCanary.cjs` calls `shadowMirror.cjs:classifyEligibility` before the frozen V5 Interpreter.
4. That deterministic predicate rejects command/write/confirmation and missing tool history; it accepts only unambiguous registered READ tools with approved risk classes. It does not inspect raw request text.
5. `aiAgentRuntimeV3.cjs` obtains intent through `planAiIntentV3`, an alias for `aiGoalPlannerV3.cjs:planAiGoalV3`. Its existing domain model stage produces the risk envelope; another stage plans capabilities. This is model-based planning, not a deterministic raw-text eligibility primitive.

The P16-D write-risk test holds source text constant and supplies command-mode metadata. Its PASS proves correct handling of that metadata, not a standalone raw-text classifier.

## Why deterministic extraction alone is insufficient

Candidate has neither the legacy risk envelope nor actual legacy tool execution history. Applying the existing predicate unchanged to absent facts rejects all 15 approved reads. Filling in query mode or tool history from the fact header would manufacture eligibility evidence and repeat the original defect. Moving the frozen Interpreter earlier would violate the requested order. A keyword classifier is prohibited.

Reusing the existing V4 domain-model stage without its full response stack is a potential next design, not a new prompt/model proposal. However it requires an explicit Candidate risk-envelope integration and a decision on what trusted pre-execution evidence substitutes for actual legacy tool history. That goes beyond extracting only the deterministic predicate and has not been implemented under this Stage's constraint. No claim is made that a compliant design is technically impossible.

## Verification and final state

P16-D relevant regression: 6/6 PASS in the isolated R4L regression worktree, including authority gates, risk rejection, validated delivery, failure fallback, no writes and request isolation. No models were called. Candidate read/negative corpus and latency were not rerun because no fix exists. R4L's real write-intent failure remains unresolved. No Candidate process was started by R1. No files were staged and no commit was created. P16_E_R4P_READY=NO.
