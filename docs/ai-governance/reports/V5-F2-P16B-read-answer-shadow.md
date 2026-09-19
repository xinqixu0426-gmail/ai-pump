# V5-F2 / P16-B Evidence-Grounded Read Answer Shadow

## 1. Executive Result

Status=BLOCKED at pre-implementation authority review. P16_C_READY=NO. No Composer, Prompt, flag, validator or runtime hook was implemented. Formal answer evaluation runs=0; all15 paths remain applicable and NOT_RUN. The one-shot evaluation has not been consumed.

Primary blocker: REQUIRED_PRICE_OUTSIDE_VERIFIED_CLAIM_SCOPE. Three frozen price paths require a fact not covered by the frozen inventory.quantity evidence/verification requirement. A secondary implementation gap is the missing transient handoff of actual ledger, verification and values from execution to composition.

This result does not invalidate the frozen15/15 read-execution or30/30 performance baselines. It distinguishes correctly reading a field from certifying that field as an answer claim.

## 2. Frozen P16-A Baseline

Start commit=a4aa53c36862ebd38882b47af6cad9ae2b53fe85, branch master, initial worktree dirty. User-owned tracked and untracked changes were not modified. Current sources were read directly; prior task history is not substituted for a fresh implementation check.

Relevant authoritative sources:

- api/services/ai-v5/readExecutionShadow.cjs: inspectReadResult, local ledger creation, verification, safe return and optional comparator.
- api/services/ai-v5/evidenceRequirements.cjs: inventory.read requires inventory.quantity; coil.read requires coil.inventory; recipe.cost.preview requires recipe.cost.preview.
- api/services/ai-v5/evidenceLedger.cjs: toolResultToCandidateEvidence records a typed formal claim and result status, not the Tool DTO's values.
- api/services/ai-v5/verification.cjs: structurallyMatches requires the exact claimType; verification certifies the supplied requirement set.
- docs/ai-governance/v5-read-only-execution-shadow-v1.md: explicitly limits inventory evidence to current stock, separates evaluation-only comparison from verification, and rejects arbitrary answer-correctness claims.
- docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json and docs/ai-observability/data/p06-failure-cases.json: the unchanged15 paths, groups, capabilities and Tools.
- scripts/run-ai-v5f1b-read-certification.cjs: frozen source reconstruction and formal evaluation comparator scope.

No frozen file, Oracle expectation, semantic mapping, Tool, registry, ledger or verifier was changed.

## 3. Answer Composer

NOT_IMPLEMENTED. The requested single-call DeepSeek composer would only consume verified facts with no Tool definitions or further investigation. No model configuration was loaded or changed and no model request was issued.

## 4. Answer Contract

NOT_IMPLEMENTED. Intended version1 with answerText, claims and answerStatus is not registered as runtime functionality. All actual answer metrics are null/NOT_RUN in the safe dataset, not fabricated zeros or passing ratios.

## 5. Evidence-Only Grounding

The gap is field authority, not missing data in the formal API. search_parts can return price, and the evaluation-only comparator can compare it. However, the actual ledger item is inventory.quantity and the read verifier checks finite stock. The price field is outside that verified claim scope.

Neither referencing that inventory entry from a price claim nor copying a successful comparator label creates a verified price evidence entry. A future answer layer must not treat the whole Tool DTO as verified merely because one narrow claim passed.

## 6. Claim Validation

The existing ledger/verifier was exercised directly using synthetic, in-memory results only. No Executor, HTTP, API, model or SQLite was invoked.

| Synthetic probe | Current read inspection | Current verification | Ledger claim | Price evidence |
|---|---|---|---|---|
| Price absent | accepted | VERIFIED | inventory.quantity | absent |
| Price nonnumeric | accepted | VERIFIED | inventory.quantity | absent |
| Price numeric | accepted | VERIFIED | inventory.quantity | absent |

This behavior is correct for inventory verification. It proves that VERIFIED is not a certificate for price. The preflight checks also confirm metadata only contains resultStatus and the execution ToolResult data is null.

## 7. Numeric Validation

No answer numeric validator was implemented. A correct future numeric validator must compare claims against field-level verified values, not just arbitrary finite numeric fields from an otherwise successful Tool result. Rounding, coercion and invented totals remain prohibited.

A missing-price LIMITATION could be safe, but cannot satisfy the required price-fact coverage gate. Excluding those cases or counting inventory facts as answering price would change the evaluation rather than solve grounding.

## 8. Entity Identity Validation

No answer identity validator was implemented or evaluated. Existing exact identity and entity-resolution rules are unchanged. The future handoff must preserve the final entity's provenance without exposing canonical IDs or binding values to answer text or persisted outcomes.

## 9. Deterministic Tests

scripts/audit-v5-f2-answer-preconditions.cjs --self-test: PASS.
Three synthetic price-scope probes, exact inventory claim-set assertion,15-path inventory, three affected path mappings, ledger payload check and execution data-null check pass. The artifact-generating run repeated these pure assertions and verified DB/production hash invariants.

These are authority preflight checks, not the requested completed Composer/fake-model/timeout/concurrency suite. Those suites are NOT_RUN because implementation stopped before obtaining expanded authority.

## 10. Frozen 15-Path Evaluation

Answer applicable=15/15. Formal runs=0; paths attempted=0. All15 case IDs are retained as NOT_RUN; no denominator reduction or frozen expectation changes. This dataset is explicitly a blocked preflight artifact, not real answer-evaluation evidence.

## 11. Required Fact Coverage

NOT_EVALUATED. The known claim-scope gap affects:

- P06-FLATBLADE-001-LEGACY
- P06-FLATBLADE-001-V4I
- P06-FLATBLADE-001-V4R3

All three map to inventory.read / search_parts, while the frozen source group is the price inquiry. Other12 paths have corresponding inventory/cost claim categories but are not declared answer-correct without implementation and evaluation.

## 12. Inventory Numeric Facts

Existing current-stock checks remain intact, including zero stock. No new inventory answer accuracy was measured. The historical inventory baseline is not reused as generated-answer evidence.

## 13. Coil

Existing coil inventory evidence and binding behavior unchanged. Answer accuracy NOT_RUN. No schemeCode or binding value was acquired or serialized in this stage.

## 14. 800平刀

The three price paths are the authority blocker. No lookup, ambiguity handling, entity finalization or frozen expected part mapping was altered. The issue is not entity ambiguity; it is the lack of a verified price claim.

## 15. Exact Entity

Source identity, refinement and recipe-cost verification unchanged. Answer accuracy NOT_RUN. No model-selected or reconstructed business mention was persisted.

## 16. Prior V4 Failure Paths

No answers were generated, so no V5_SHADOW_ANSWER_AVOIDS_V4_FAILURE claim is made. Existing V4 failure metadata remains history only.

## 17. Unsupported Claims / Hallucinations

There are no generated drafts to assess. Unsupported/hallucinated claim metrics are NOT_RUN, not a fabricated0/15 success. No unverified price was sent to a model or accepted as grounded evidence.

## 18. V4 Comparison

NOT_RUN. V4 remains the sole user-visible authority; neither production V4 nor user-owned dirty V4 files were changed. V4 text was not used as a substitute Oracle.

## 19. Trace / Privacy

No answer LLM or answer-validation spans were created. Trace integration is NOT_RUN. No prompts, answers, Tool args/results, binding values, raw entities, canonical IDs, PII or secrets were acquired in this preflight. The safe artifact contains statuses, case IDs, claim categories and file/DB hashes only. Synthetic probe values are not included.

Privacy preflight PASS; this is not certification of an unimplemented answer tracing path. Real model calls=0, Business API calls=0, Tool executions=0, business mutations=0, writes=0, user-visible V5 responses=0 and production V5 routing=0.

## 20. Performance / Concurrency

NOT_RUN. No answer layer exists to benchmark. The prior transport-controlled30/30 remains frozen historical evidence and is not reported as answering the new layer's focused performance gate. No scheduler or concurrency modifications.

## 21. Database / Write Safety

Business DB file hash, mtime, size and backup count are identical before/after the deterministic preflight. Source hash09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e; size35323904; mtimeMs1788424936315.8767; backup count209. No database connection was opened; hashing reads file bytes only. Unexpected Backup Created=NO.

Tracked api/shared/package files have identical pre/post aggregate hashes, including unchanged existing dirty contents. No dependencies or production files changed.

## 22. Regression

Full baseline/combined V5/Deep API regression NOT_RUN: no runtime implementation was made. Guardian and Deep API historical classifications are not freshly re-certified. No new production regression is identified by this preflight; full regression status remains UNKNOWN, not an unsupported PASS.

## 23. P16-C Preconditions

P16_C_READY=NO. Request Supervisor approval for a minimal field-level price evidence/validation contract and a transient verified-value handoff before completing P16-B. Preserve generic ledger/verifier algorithms where possible; any new verified-claim scope must be explicit, not a silent reinterpretation of inventory.quantity.

The answer-only data carrier must stay runtime-local. Existing safe execution outcomes must not begin returning business values to traces/datasets. Composer, validators, negative tests, frozen hashes, one-shot15-path evaluation and focused performance remain outstanding after that authority decision.

No corpus change, price-path exclusion, model judge, extra investigation API, comparator promotion or fallback is recommended as a bypass. Stop for review rather than spending the formal evaluation on a known unsupported claim scope.

Delivery contains only this blocked-state report, the status document, safe preflight dataset and deterministic preflight script. The requested commit subject does not imply the feature is implemented; implementation status remains NOT_IMPLEMENTED.

STOP — WAIT FOR SUPERVISOR REVIEW
