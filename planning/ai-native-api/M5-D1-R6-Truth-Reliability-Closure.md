# AI-Native D1-R6 — Truth Correction & Genuine Reliability Closure

R6 preserves the historical Final V2-R2 artifacts. Its reported 6/10, 10/21, 11 accepted invented IDs, and seven wrong-basis results are not overwritten. This phase adds a corrected evaluator, product fixes, and fresh targeted evidence; it is not a replacement Final Acceptance run.

## Evaluator truth corrections

Scenario evaluation now ignores a caller-local `scenarioKey` mismatch and evaluates formal business equivalence: required override keys, `APPLIED`, `COMPARABLE`, matched entity, candidate amount, and delta. A missing display name in a formal child fact is recorded as anonymous provenance quality, not as an invented formal identity. Money-basis telemetry no longer classifies a multi-amount sentence by the union of all cited roles; the shared Answer Validator remains authoritative after it and the business oracle both pass. Recipe-detail and complete-record-set coil queries have matching formal evidence paths. Directional recipe comparisons also support a formally equivalent reversed query.

The Supervisor diagnostic estimate for the old repetition is approximately 19/21, but is explicitly non-authoritative. The historical score remains intact until the next full acceptance run.

## Genuine fixes

The finalization prompt and repair prompt now require one monetary role per factual sentence/claim. This is generic: it contains no recipe, surface treatment, packing, or rotor-process special case. It prevents a current amount, candidate amount, and delta from being combined under one citation role. A finalizer failure is still visible; it is not relabelled as a business failure.

Packing preview now uses a canonical formal `partId` as the required identity. `qty` and `packingRole` remain required. `model` and `supplier` are optional display echoes: if supplied, they are checked fail-closed against the formal part. On mismatch, the formal error returns a sanitized canonical binding receipt to support a safe retry. The preview API, not the model, canonicalizes the display fields. No ordinary part fuzzy matching was introduced.

For verified `get_recipe_detail`, the candidate ledger now projects complete `currentCost.currentTotalCost` as `CURRENT_FORMAL`. The projection copies the formal amount and formal basis only; it performs no cost arithmetic. It can hydrate the display name only from the same exact formal recipe record after canonical-ID equality is verified. Real recipe comparison delivery is covered by the atomic-claim repair and directional comparison evaluator.

## Targeted fresh verification

- D1-07 Rotor Process: **5/5 COMPLETED**. Each run produced formal `APPLIED` and `COMPARABLE` output with `rotorProcessMode`; observed agent-local keys varied, which confirms no key-string coupling. Fixture costs were 224 → 230, delta 6.
- D1-08 Cable plus Packing: **5/5 COMPLETED**. All formal previews applied both cable and packing changes, 224 → 272, delta 48. No retained run terminated with `PACKING_IDENTITY_MISMATCH`.
- D1-05 Float: **2/2 COMPLETED**, 224 → 242, delta 18.
- D1-06 Electrophoresis: **2/2 COMPLETED**, 224 → 249, delta 25.
- REAL-04 current cost: **2/2 PASS** for V750大脚板-2寸-经典款, 288.98 `CURRENT_FORMAL` / `currentFullCost`.
- REAL-05 recipe difference: **2/2 PASS** for V750大脚板-2寸-经典款 and V550大脚板-2寸-经典款, using a formally directional difference.

The controlled fixture and local real-business DB snapshot hashes were unchanged around their respective targeted runs. All retained post-fix runs are read/preview only.

## Scope and next step

R6 intentionally did not run the full Final Acceptance matrix. It establishes corrected scoring and closes the identified delivery/projection/packing paths. A new frozen full acceptance is still required before D1 can be marked complete or D2 can begin.

## Deterministic and repository gates

The R6 focused regression set passed 57/57 tests; API-contract governance passed 29/29. Full repository gates passed: `npm test` 2307/2307, `verify:api-contract`, deep API 486/486, lint, build, `test:ai-architecture` 9/9, and `verify:ai-assistant-release`. No deployment was performed.

Evidence: `M5-D1-R6-Evaluator-Truth.json`, `M5-D1-R6-Packing-Identity-Audit.json`, `M5-D1-R6-Current-Cost-Projection-Audit.json`, `M5-D1-R6-Targeted-Controlled.json`, `M5-D1-R6-Targeted-Real.json`, and `M5-D1-R6-Safety.json`.
