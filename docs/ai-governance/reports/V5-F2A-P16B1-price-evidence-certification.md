# V5-F2A / P16-B1 Price Evidence Certification

## 1. Executive Result

PASS. `P16_B_RESUME_READY=YES`; no Answer Composer or answer evaluation was implemented or run. Start commit `27863176d4127e21f45336e86f667efc3aeb7fcc`, branch `master`, worktree initially dirty. User-owned edits were preserved and excluded from this stage's commit.

One formal read/evidence certification recorded all 15 frozen paths: Tool selection, validated binding, actual execution and result equivalence each 15/15; required evidence present/valid 18/18; task verification PASS 15/15. Price extraction, validity, field verification and runtime handoff each 3/3.

## 2. P16-B Blocker

The prior price comparator MATCH did not establish price evidence. Default inventory evidence covered quantity only. The new explicit field requirement closes that gap without replacing the 15 frozen contracts, invoking models or adding the other deferred capability requirements.

## 3. Price Authority

Capability `inventory.read`; Tool `search_parts`; exact result field `parts[].price`. Authority chain: query Executor → `internalApiClient` → `GET /api/parts` → `partQueries.listParts` → `db.partRow` → stored `parts.price`. The formal Tool retains this field without calculating it. The unchanged evaluation comparator compares canonical identity/model/stock/price against a separate formal API response.

Meaning: current catalog unit price, not a derived cost. Existing `aiClaimGroundingV4` maps catalog-current monetary claims to `price.current` with CNY. `costEngine.createPartPriceGetter` retrieves catalog price and packing calculation uses `unitPrice × qty`. Unit is therefore **CNY per catalog quantity unit**; no claim about kilograms/metres, tax or new conversion is made. These are code-defined contract semantics, not a new model interpretation. The formal part DTO has no row-specific currency/unit fields.

## 4. Field-Level Evidence Contract

Existing Evidence Ledger V1 is reused unchanged. `evidenceRequirements.cjs` adds the explicit `price.current` requirement for `inventory.read`; empty field scope retains the original quantity-only contract. Unknown/duplicate fields or a mismatched capability are rejected before execution.

The trusted software caller must declare required fields. No frozen case ID or business keyword appears in production scope selection. Existing Interpreter, Tool, binder, comparator, resolver, registry, policy and state machine remain unchanged. Internal readback and handoff contracts are documented in the existing `parts.list` API authority row and the field-evidence document; no HTTP/Tool schema changed.

## 5. Price Extraction

`fieldReadEvidence.cjs` extracts exactly one canonical row from the successful formal Tool result. It creates a DIRECT_FACT ledger item before reference verification. Field identity, source Tool/execution, task, canonical entity receipt, numeric type and current-row-version metadata are explicit. The actual price and row-version value stay in a private WeakMap; serializable metadata contains no business values.

## 6. Price Verification

The existing read-execution boundary performs an independent governed GET reference read, with zero retry and the existing bounded timeout. No new direct database or raw HTTP path was added to V5.

Verification checks exact field/fact identity, source Tool/capability/execution, same task/entity/receipt, finite number, valid formal evidence, unique canonical reference, equal row `updatedAt`, and exact price equality. Missing evidence, wrong value/type/entity/snapshot or reference failure rejects verification and handoff. Generic verification requires the private verified field receipt; comparator MATCH or copied/forged metadata cannot substitute for it.

## 7. Verified Runtime Handoff

An opaque, non-serializable-by-value handle is issued only after formal task verification has produced its registered VERIFIED result for the same ledger and the field receipt has passed. `getVerifiedEvidenceValue` requires the same task, entity/receipt, source execution and fact key. Cross-task access is rejected. Runtime values are non-enumerable in handoff results and are never attached to the normal shadow output.

Formal handoff availability: 3/3 applicable paths. Other paths remain outside this price-specific runtime-value interface; this stage does not claim a general Answer Composer handoff for every future fact type.

## 8. Numeric / Unit Safety

JavaScript finite number only; no numeric-string coercion, rounding, aggregate, fallback or unit conversion. Zero remains valid. Missing/null/object/string/NaN/positive or negative infinity fail closed. Currency/unit contract metadata cannot be changed independently of the field receipt. Snapshot means the same current record version across immediate Tool read and reference readback, not a new global transaction snapshot or a guarantee that catalog data can never change afterward.

## 9. Quantity Non-Regression

The original quantity requirement remains unchanged. All 9 `inventory.read` paths retain valid `inventory.quantity`; the 3 price paths add one field each. The 3 coil inventory and 3 recipe preview facts also remain verified. Total required fields: 9 quantity + 3 coil + 3 recipe + 3 price = 18. No other deferred evidence requirements were added.

## 10. Deterministic Tests

Price suite: 27/27 PASS. Coverage includes missing/null/wrong/non-finite types, wrong fact/field/entity/task/execution, invalid/stale/version-mismatched evidence, independent reference mismatch, forged verification/receipt, unverified handoff, verified handoff, quantity preservation, reference error/timeout, ten concurrent tasks and safe serialization/trace/log projection.

The import-boundary test was narrowly updated for the approved explicit field GET readback and metadata-only verification span. Direct DB, raw fetch and write methods remain forbidden. Combined V5: 322/322 PASS.

## 11. Frozen Certification

Formal runs=1, frozen paths=15, predeclared price-applicable paths=3. Frozen task/entity contracts prepare controlled read tasks; this is a real read/evidence certification, **not** a fresh Interpreter or Answer model evaluation. Model calls=0. All real Tools and APIs ran against the existing business routes in an isolated query-only snapshot.

| Metric | Result |
|---|---|
| Correct Tool / validated arguments | 15/15 / 15/15 |
| Real read execution / result equivalence | 15/15 / 15/15 |
| Required evidence present / valid | 18/18 / 18/18 |
| Required-field task verification | 15/15 PASS |
| Price extracted / valid | 3/3 / 3/3 |
| Price verification / runtime handoff | 3/3 / 3/3 |
| Real read Tool calls | 15 |
| Execution-owned Business API reads | 21, including 3 price reference reads |
| Total fixture API calls | 51, including 15 entity lookups and 15 evaluation reference reads |

The complete pre/post hashes are in `data/v5-f2a-price-evidence-certification.json`. All 22 pinned surfaces matched byte-for-byte. No implementation changes followed the formal run, and no second run was performed.

## 12. Privacy

PASS in the tested boundary. Dataset uses strict structural fields only; runtime price, canonical ID and raw source text are absent. The actual verification wrapper was exercised through an in-memory Phoenix-compatible metadata sink: 3 field verification spans, no values. Normal logs were captured transiently and checked; raw inputs/log content were not persisted. Synthetic sentinel tests cover price, identity and result leakage, safe thrown errors and cross-task access.

Price/business value/Tool result/raw entity/canonical ID/PII/secret leakage=0 observed in retained metadata and exercised trace/log paths. No remote Phoenix content export or Answer model was needed or run. This is not a claim about arbitrary future callers that deliberately serialize runtime-only values.

## 13. Database Safety

Main business DB before/after: SHA-256 `09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e`, mtimeMs `1788424936315.8767`, size `35323904`. Backup file count remained 209. Formal isolated snapshot also matched in hash/mtime/size. Unexpected backup created=NO; no delete-to-pass operation.

V5 writes=0, allowWrite enabling=0, business mutation calls=0, production routing=0. Baseline tests use their existing isolated test databases; no test writes target the main business DB.

## 14. Regression

Shadow OFF full deterministic regression in an isolated worktree: 2084/2085 PASS; the sole remaining failure is the unchanged missing `.guardian/config.yaml` business terminology check. Initial worktree attempts had missing test dependency links/DB/backup directory and CRLF-vs-frozen-byte hash differences; these were environment setup defects, corrected without changing frozen source semantics or expected hashes. The final run has no additional failures.

API contract suite 26/26 PASS; Next production build PASS. The full Deep API smoke command includes write Tool/API scenarios and was not rerun under this stage's no-write boundary. Its historical race attribution is retained, not claimed newly reproduced. The 15-path actual read/API certification supplies focused read-boundary integration coverage. This is an explicit scope exception to the general full deep-API push workflow: no HTTP/Tool/Business API behavior changed; broader write-path smoke requires separate authorization. New P16-B1 deterministic regression=NO.

## 15. P16-B Resume Preconditions

`P16_B_RESUME_READY=YES`: all approved price evidence gates and all existing required read evidence passed, frozen run is immutable, DB/privacy protections passed, and no new deterministic regression was found.

Supervisor may now authorize resuming P16-B. No Answer Composer, Answer Prompt, answer evaluation, production response/routing, write execution or P16-C work occurred. Future answer work must consume verified runtime field values, preserve field applicability and snapshot semantics, and establish its own complete grounding/answer gates.

STOP — WAIT FOR SUPERVISOR REVIEW
