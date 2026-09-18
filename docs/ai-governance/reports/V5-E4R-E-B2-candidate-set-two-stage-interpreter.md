# V5-E4R-E-B2 Candidate-Set Two-Stage Interpreter

## 1. Executive Result

PARTIAL; P16_READY=NO. Architecture V3 is implemented; 240/240 V5 deterministic tests pass. The only formal run stopped at its first path with Stage 1 ERROR (approximately 242 ms). One path recorded, 14 NOT_RUN, no lookup or Stage 2 calls. No retry or post-eval implementation changes. The underlying error cause is UNKNOWN: the wrapper discards its safe error code/status.

## 2. Frozen Evidence / Root Cause

Previous audits motivate candidate-set local selection. This run produced no valid model output and cannot confirm real semantic accuracy. Frozen 15 paths, five groups, four input fingerprints and their expected values were preserved.

## 3. Architecture V3

independentShadow now defaults to candidateSetTwoStageInterpreter. Stage 1 selects a source reference; governed lookup supplies candidates; software derives local classes; a singleton is selected deterministically, otherwise Stage 2 selects a class; software finalizes identity. Historical Protocol V2 remains unchanged and its historical fixtures inject that implementation explicitly.

## 4. Stage 1 Span Selector

Prompt/contract version 1. Only version, spanRef and needsClarification are allowed. Unknown references and extra fields fail closed. No Task Classes, V4 results or canonical IDs are supplied. Numeric-like and punctuation-preserving source tests pass.

## 5. Governed Entity Candidate Set

The existing resolver's dependency hook captures and copies the same validated batch response. Complete, non-empty RESOLVED or AMBIGUOUS responses may continue. There is one batch call, no additional lookup, and no change to the API or resolver. Candidate IDs remain transient.

## 6. Candidate-Set Ambiguity

Cross-type ambiguity may enter local intent selection. Same-type ambiguity remains fail-closed after class filtering. No first-result, keyword, fuzzy or expected-value entity choice is implemented.

## 7. Local Task Class Derivation

Candidate types intersect frozen class entity-type sets. Primary meanings and class order remain unchanged. Alternative references are filtered to the local set to avoid exposing unrelated classes. Deterministic tests cover zero, one, two and four classes; real local catalog evaluation did not run.

## 8. Singleton Deterministic Selection

One local class requires no Stage 2 call; zero fails closed; multiple classes permit one call. Fake-model coverage passes. Formal singleton count is zero because lookup was never reached, not because the corpus lacks singleton cases.

## 9. Stage 2 Local Intent

Prompt/contract version 1 permits only version and localTaskClassRef. Unknown or global-but-not-local references and entity/Tool/canonical-ID fields are rejected. No real Stage 2 call occurred.

## 10. Entity Finalization

Selected-class types filter authoritative candidates: one resolves, zero mismatches, multiple remain ambiguous. Synthetic tests pass. The model never selects a canonical identity. Canonical identity only enters the existing transient routing-task reference and is excluded from safe outcomes.

## 11. Contract V1 Projection

Contract V1 remains unchanged. Software derives domain/operation/type from class and authority; source offsets supply the mention. Existing exact anchoring runs without modification.

## 12. Capability / Tool Exposure

Existing router and bounded exposure are unchanged. No Tool execution or write is introduced. Real routing was not reached; its trace records a fail-closed outcome.

## 13. Deterministic Tests

New B2 coverage: 23/23 (21 interpreter tests and two evaluator tests). Combined V5: 240/240. Historical Protocol V2 fixtures remain unchanged in meaning and use explicit legacy injection. Import-boundary checks permit only the approved candidate read wrapper and observability importer.

## 14. Pre-Eval Freeze

The following manifest was written before the first real call. The evaluator's pre/post manifests and a later read-only recomputation all match. No implementation changes followed evaluation.

```json
{
  "spanSelectorPrompt": "94ff1c090956b2578b5c11145413b183e4e6ea4fef9e6b7374290d559b95d807",
  "localIntentPrompt": "814351f9cef02e5d529df9034f648ad9b406e955af960c64e8164cb91b474836",
  "modelSettings": "2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398",
  "api/services/ai-v5/twoStageModel.cjs": "6735343765e6152f77be6bcd107507799f68507e1d4afd00498237a6554d982f",
  "api/services/ai-v5/sourceSpanSelector.cjs": "5f8dab23f5450625bdaa2a298e16d9701743288b6a9a94ab355b0e0008f39495",
  "api/services/ai-v5/sourceSpanSelectionContract.cjs": "8365cf403bae571ab7ecbeec26e96c7aad39d152e7188350cd733d06badf831d",
  "api/services/ai-v5/candidateSet.cjs": "8b2827b00959c4a8b0a6759a6470509c989c7f69869a35ee7449cf020ba077dc",
  "api/services/ai-v5/localTaskClassCatalog.cjs": "7ac106cda7b4e96ed4d4782dd5eace1283934f2f2ba89131d7651b7f5819c6bb",
  "api/services/ai-v5/localIntentSelector.cjs": "c3395e47a05cfffa6ba0d15c84e03ec7da970387afc85005f1f06a984a26074c",
  "api/services/ai-v5/localIntentContract.cjs": "caa65be298ef02a0df2ad3f53b7b093fba7a8c5c82176e70128a59b1b5968fe1",
  "api/services/ai-v5/entityFinalization.cjs": "bad2f68112c9d9bb4609efb047161f4413961579d726c894ba008fe33f7a93b5",
  "api/services/ai-v5/candidateSetTwoStageInterpreter.cjs": "f03ce7b2f5a77867ee811bb7bce2ab201bd74ee458feb051014265c2a8ed5e5d",
  "api/services/ai-v5/independentShadow.cjs": "eb72f51499aad58b38912dbd4d96774d9834887535435d6f304f704c07ab95ea",
  "api/services/ai-v5/shadowMirror.cjs": "344f43a3676acce471aabbb52d27def4dbf365c6a0b9d1a2bac423b8d2092e7b",
  "api/services/ai-v5/typeIndependentEntityResolver.cjs": "5b12ae3f759cd22af03ba8e1588f24032f2ce6ff4fe0da12d5d7e711d795c694",
  "api/services/ai-v5/sourceSpanCatalog.cjs": "00b1331e6e8c3ffc8985fb268b861dcbb066d3e409aeda43f1ceef43f3821fd8",
  "api/services/ai-v5/sourceAnchoredEntity.cjs": "f31564536b806fd3f3261f4d19d7fd3623726a967204379fc5e633154107a339",
  "api/services/ai-v5/taskClassCatalog.cjs": "641b3b128f3c41b8234fafe24e51634c83a273024b23ca1304b80e9aa11df8af",
  "api/services/ai-v5/taskClassSemantics.cjs": "ded104cc27a09eb81221a6f2f651b8fd4a26ee99d3e40569e018444bcc6b73dc",
  "api/services/ai-v5/capabilityRegistry.cjs": "c2e9c428c348866d4417a5934d7ec9d36b2d8b85cf147d95e299da8b80b8fc40",
  "api/services/ai-v5/capabilityRouter.cjs": "9a13f47414a306a11e62015865162f82098c434a85c1cd17aaa2e026ee7fce55",
  "api/services/ai-v5/toolExposure.cjs": "d4f4ce7caa7c12172b42375350d66843f4337e86b9484f360dc9c42e5850e2e4",
  "api/services/ai-v5/taskInterpreterInput.cjs": "a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded",
  "api/services/ai-v5/taskInterpretationContract.cjs": "847373f86c3f1b09573c8abf3efe194e6687b0978aa82f37fcdec15939bcbfd9",
  "api/services/ai-v5/contracts.cjs": "c1321632367e8f0ace9c065c65d5d6216b0f5a515eaf6f1fc735195e16ce3449",
  "api/services/ai-v5/taskState.cjs": "93d52aa61ffa11d013e6ec1b0f002bdc034c29e97f51863edc514d92d877e601",
  "api/services/ai-v5/controlledRuntime.cjs": "2c475ff9fc4a07fa7e63291251b5a007f29f0648838e45d6b8e94c44fb7a37ca",
  "api/services/ai-v5/policy.cjs": "9aff3bdb382bd7fc35d1205304aa5acb255ab41681a3103e13156d7175ab3186",
  "api/services/ai-v5/evidenceLedger.cjs": "999aa3f2a2d7e5f3e19a57316122eaec06759d66b6cd77aac8a92c60179244db",
  "api/services/entityLookupService.cjs": "7e5450eec4057f86835b67c9aeefc4e60d6bd88eefb3d12b0614c5740cae9084",
  "api/routes/entityLookup.cjs": "8afa5f1cc33cb1aeb685e26505f0a90ffb0c7f3316d751168d0aa519813e32fe",
  "api/routes/ai/internalApiClient.cjs": "ee415eb3aa964d1e677e924a95d768acb1d4afaea4bc3df70830f1073a21a105",
  "api/services/observability.cjs": "fc72d0b6b8c5d2fa2ffe0ea08a3375e41e911cc19ac4cb0efcedcff7a1827034",
  "scripts/run-ai-v5e4r-two-stage-evaluation.cjs": "9667e85c5c2fc180c3039408680d63c9710b15dc2b29143d583e63bb07998209",
  "frozenCorpus": "315a21d96fdd84f0ecb253772ae942b2cbbfd56842c2a8858e378693f444d4df",
  "frozenExpected": "185423ccc78878f57c4c58e09b9292bb4fbc0a857c86f376113c6586b3626527"
}
```

## 15. Frozen One-Shot 15-Path Evaluation

Formal runs=1. Planned=15; attempted/recorded=1, P06-COIL-001-LEGACY. Stage 1 ERROR caused the required fatal stop; remaining 14 NOT_RUN. Provider-successful completions observed=0; billing/usage UNKNOWN. V4 comparison uses frozen P06 trajectories, without a V4 model rerun.

The evaluator writes fatalReason=FORMAL_EVALUATION_INFRASTRUCTURE_FATAL but exits with shell status 0. This exit-code propagation defect is recorded for a separately authorized revision; it was not fixed after freeze.

## 16. Stage 1 Accuracy

Valid=0/1 attempt; schema-invalid=0; infrastructure error=1; observed protocol noncompliance=0. End-to-end span success=0/1 attempted. Valid-output semantic accuracy is NOT_EVALUABLE. The remaining 14 were not counted as failures.

## 17. Local Intent Accuracy

NOT_RUN; measured Stage 2 applicable denominator=0. No claim is made about the full corpus's Stage 2 requirement.

## 18. Final Entity Accuracy

Unique/correct finalized entity=0/1 attempted. False unique=0. No authoritative lookup was reached. Full-corpus gate remains unproven.

## 19. Coil

One of three coil variants attempted, span success 0/1 after infrastructure ERROR. Local intent/finalization/capability/exposure were not reached. The unchanged comparison records one false block on the frozen success control. Two variants remain NOT_RUN.

## 20. 800平刀

All three NOT_RUN. Prior part+template ambiguity evidence is not substituted for a new V3 result.

## 21. Exact Entity

All three NOT_RUN. Deterministic identity tests pass; no new real exact-entity success is claimed.

## 22. R02 Wrong Tool Exclusion

NOT_RUN; 0 of 3 applicable frozen R02 paths attempted. Empty Tool exposure after an infrastructure failure is not a successful R02 result.

## 23. Same-Input Consistency

Stage 1, Stage 2 and final consistency are NOT_EVALUABLE because no identical input was repeated. Raw aggregator singleton 1/1 consistency is vacuous and must not be reported as observed 100% stability. Group/fingerprint metrics cover only the attempted group.

## 24. False Blocks

The unchanged comparator reports V5_FALSE_BLOCK=1, V5_BLOCKS_V4_FAILURE=0, V5_INSUFFICIENT_DATA=0. This false block is due to an unavailable interpretation, not a wrong valid local class. It is retained and fails the P16 gate.

## 25. Model / API Call Budget

Formal Stage 1 attempts=1; Stage 2=0; total=1; average/max per attempted path=1. Logical resolver/Business API calls=0. Synthetic tests separately prove two-call maximum and one batch lookup per eligible resolution. V5 Tool calls/writes/production routing=0.

## 26. Trace / Privacy

Phoenix project pump-ai-v5-candidate-set-v3 contains one evaluation trace: an AGENT root plus span-selection, capability-route and shadow-comparison children. Four spans; parent references valid; orphan/invalid-parent/cross-request counts=0. Selection span status=ERROR.

Observed exported attributes contain only safe identifiers, names, counts, statuses and architecture metadata. Observed prompt/response/raw entity/span/canonical ID/canonical identity/business value/Tool value/PII/secret leakage=0. Synthetic source/ID sentinels pass. Unexecuted real lookup and Stage 2 paths have no live privacy evidence.

## 27. Performance / Concurrency

Ten concurrent synthetic V3 requests pass with zero identity/candidate/finalization/task crossing; each uses two fake model calls and one fake API call. This is infrastructure evidence, not real evaluation.

Fixed-10-ms synthetic V4 scheduler benchmark, 5 warmups + 30 measured per mode: OFF median 15.5501 ms/P95 15.8842 ms; ON median 15.3998 ms/P95 15.7737 ms. Median overhead -0.9666%; P95 -0.6957%; synthetic gate PASS. This does not measure production user latency. Existing deterministic production Shadow/SSE tests also pass.

Formal completion median/P95=251.3129 ms and Stage 1=241.8536 ms: both describe one failed invocation. Lookup/Stage 2 latency NOT_RUN.

## 28. Database Safety

Database hash/mtime/size match before and after, including after regression. Size=35,323,904 bytes; backups=209 before/after. No new business backup. The evaluator owns a read-only harness connection backing the unchanged Business API route and does not import startup modules. No V5 module opens a DB connection.

## 29. Regression Attribution

Final full deterministic regression=2026/2027, only missing .guardian/config.yaml. Combined V5=240/240. Full Deep API again stops at the identical pre-existing search_coils.copperBase mismatch. Neither known issue was fixed. No new deterministic regression was observed.

The real Stage 1 ERROR is unattributed. Overall New B2 Regression Introduced=UNKNOWN until an authorized diagnosis separates provider/environment failure from a B2 defect. Do not label it an environment failure without evidence.

## 30. P16 Preconditions

P16_READY=NO. Full one-shot evaluation is incomplete; real local-intent/entity/semantic/consistency gates are unproven and one false block is recorded. Any continuation or new diagnostic revision requires Supervisor review under the explicit one-shot rule.

Known limitations: one primary entity/task; unresolved same-type ambiguity; no global/no-entity support; no successful real V3 evaluation; loss of safe low-level error details; evaluator fatal exit code propagation defect; synthetic latency evidence; frozen V4 trajectory comparison rather than resampled V4 behavior. No post-eval tuning or implementation change occurred. User-owned dirty files remain outside the B2 commit.
