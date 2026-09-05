# V5 Field-Level Read Evidence V1

Scope: optional software-declared required fact `price.current` for `inventory.read` / `search_parts`, plus runtime-only handoff of the three already-defined read facts below. Evidence applicability and verification rules are unchanged.
No Answer Composer, model call, routing change, Tool argument change, write authority or additional deferred capability requirements.

## Authority and units

`search_parts` → `internalApiClient` → `GET /api/parts` → `partQueries.listParts` → `db.partRow` → stored `parts.price`.
The extractor reads exactly the successful Tool result's `parts[].price`, selecting one row by the already resolved canonical ID; it never scans arbitrary numbers or takes the first result.
This is the **current catalog unit price**, `DIRECT_FACT`, a finite JavaScript number; not a cost formula, quote, saved recipe price, aggregate, or conversion.

The existing server monetary claim contract (`aiClaimGroundingV4.cjs`, `catalog_current` / `price.current`) uses CNY. `costEngine.createPartPriceGetter` reads the stored catalog price and `calculatePackingEstimate` multiplies unit price by catalog quantity. Accordingly the field contract is CNY per `CATALOG_QUANTITY_UNIT`; it does not assert a physical kilogram/metre unit, tax treatment or additional rounding. The part DTO has no row-specific currency/unit override. Those semantics are fixed contract metadata, not guessed from a request or inferred from numeric values. No new business formula is introduced.

## Internal contract and registration

`evidenceRequirements.listFieldEvidenceRequirements(capabilityId, requiredFactKeys)` registers only `price.current` for `inventory.read`. The trusted software caller declares the field scope before execution; no keyword selection or case ID occurs in production code. Empty scope preserves the existing `inventory.quantity` requirement. The 38 deferred capability requirements are untouched.

Internal caller: controlled read-execution shadow. Access: read-only, low risk, no confirmation, no writes, no idempotency side effects. Source of truth: successful governed Tool result plus independent formal API readback. Reference read timeout: bounded by the existing execution timeout (maximum 10 seconds), retry zero. HTTP/Tool schemas and external Contract V1 are unchanged.

## Extraction, verification and snapshot

`fieldReadEvidence.extractPriceEvidence` creates a normal existing-ledger item: task, entity, capability, source Tool, software-owned source execution reference, `claimType=price.current`, `DIRECT_FACT`, presence/type, validity and snapshot-kind metadata. `runtimeValue` and the row version live only in a private WeakMap associated with an opaque receipt.

The sequence is Tool result → extracted evidence → independent `GET /api/parts` reference → `verifyPriceEvidence` → existing `verifyV5Task`. Comparator labels are never accepted as evidence. A candidate may be validly extracted but is not verified until reference equality succeeds.

Verification checks the exact fact/field, task, entity and resolution receipt, source execution, Tool/capability, formal source, finite numeric type, ledger validity/freshness, one canonical reference row, equal `updatedAt` row version and exact numeric equality. Missing/null/non-number/NaN/infinity, duplicate or wrong entity, version drift, reference failure or timeout fail closed. Numeric strings are not coerced. Zero is not treated as missing.

Snapshot semantics are **same row version across the Tool read and immediate formal readback**, not an invented global MVCC timestamp. An old `updatedAt` may still describe the current unchanged catalog record. Historical-price queries and physical-unit conversion are not covered. Certification additionally uses an immutable query-only database snapshot. The extra read is only for an explicitly required price field; quantity-only paths retain their existing behavior.

## Verified runtime handoff

`fieldReadEvidence.APPROVED_RUNTIME_FACTS` is a frozen allowlist, not an expansion of Evidence Requirements:

| factKey | Capability / Tool | Exact runtime field | Type / unit | Snapshot / meaning |
|---|---|---|---|---|
| price.current | inventory.read / search_parts | parts[].price | finite number; CNY / catalog quantity unit | Existing same-row-version price verification, unchanged |
| inventory.quantity | inventory.read / search_parts | parts[].stock | finite number; catalog stock quantity unit | Same successful Tool execution; current catalog stock, no physical-unit conversion |
| coil.inventory | coil.read / search_coils | data[].stock | finite number; coil sets | Same successful Tool execution; selected formal coil scheme stock |
| recipe.cost.preview | recipe.cost.preview / preview_recipe_cost | data.currentTotalCost | finite number; CNY per recipe unit | Same execution of current-cost read; currentFullCost, not a settlement or saved/final cost |

The three existing requirements are `DIRECT_FACT` in `evidenceRequirements.cjs`. Recipe cost is calculated by the Business API but is a direct formal Tool fact in this existing V5 contract; no V5 derivation or formula is added. `businessExecutors`, `aiRecipeResolution.selectCurrentRecipeCost`, and `costQueries.getCurrentRecipeCosts` establish its current-cost basis. Part authority is `partQueries` / `partRow`; coil authority is `coilQueries` / `coilRow`, with stock measured in sets by the existing procurement inventory contract. Quantity has no new inferred physical unit.

`captureReadFactValue` associates the exact approved scalar with an already-existing ledger item in a private WeakMap during collection, before verification. It neither adds a parallel evidence item nor replaces the existing verifier. It selects only the unique canonical row, never arbitrary numeric fields or comparator output. Null/missing/non-number/non-finite values cannot be captured; zero remains valid. The immutable scalar snapshot is independent of later mutation of the transient Tool DTO.

`createVerifiedValueHandoff` requires the actual registered task verification result `VERIFIED`, unchanged matching ledger items and opaque runtime receipts. Price additionally retains its existing independent verified receipt requirement. It accepts a single receipt (backward compatible) or explicit receipts for the same task. `getVerifiedEvidenceValue(handle, {taskId, entity, sourceExecutionId, factKey})` performs exact task/entity/resolution-receipt/execution/fact checks and rejects unavailable scope with `VERIFIED_EVIDENCE_ACCESS_DENIED`. This is the existing safe error code for unavailable verified values.

For existing read facts, `sourceExecutionId` is the existing ledger `sourceRef`, `${taskId}:tool`; for price it remains the execution output's existing `sourceExecutionId`. No reference or entity ID is given to a model. A task handle can contain several explicitly approved verified facts, but there is no bulk getter, enumeration of values, wildcard key, or automatic exposure of additional ledger fields. A fact absent from that handle cannot be read with another fact's authorization.

The handle is non-enumerable on the execution result. Returned `runtimeValue` is non-enumerable; ordinary JSON serialization omits it. Values are not recovered from serialized ledgers, historical certification artifacts, or comparator results. Capture and access have no Tool/API/DB dependency.

Future Answer Composer integration must explicitly retain the runtime handle and request the verified field in the same task. It is not implemented here. Raw Tool results and evaluation comparator values are not a fallback handoff.

## Privacy and failure behavior

Logs, traces, datasets and reports may contain field keys, presence/type, validity/verification, counts and safe reason codes only. Price, raw entity, canonical ID and record version stay in runtime memory. Errors are fixed safe codes. No new Phoenix content fields are introduced; existing verification observability receives status only. A failed field prevents task verification and normal answer handoff, regardless of comparator MATCH.

## Validation

Synthetic tests cover extraction, missing/null/type/non-finite values, wrong fact/entity/task/execution, reference mismatch, stale/wrong snapshot, invalid evidence, quantity non-regression, no unverified handoff, serialization privacy and ten concurrent task-isolation checks. Runtime handoff certification establishes each frozen task once in the existing isolated query-only fixture, then accesses each field without Tool/API re-execution. Answer-required applicability is price 3, quantity 6, coil 3, recipe 3. The price tasks also retain their underlying quantity requirement: total existing ledger facts remain 18, all of which are checked for access. This is not an Interpreter or Answer model evaluation.
