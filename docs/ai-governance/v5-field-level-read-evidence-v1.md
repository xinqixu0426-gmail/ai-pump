# V5 Field-Level Read Evidence V1

Scope: `inventory.read` / `search_parts`, optional software-declared required fact `price.current`.
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

`createVerifiedValueHandoff` requires formal task verification `VERIFIED` plus the private field receipt. `getVerifiedEvidenceValue(handle, {taskId, entity, sourceExecutionId, factKey})` rejects unknown/unverified handles and cross-task/entity/execution/field access. The handle is non-enumerable on the execution result. Returned `runtimeValue` is non-enumerable; ordinary JSON serialization omits it. Values are not recovered from serialized ledgers.

Future Answer Composer integration must explicitly retain the runtime handle and request the verified field in the same task. It is not implemented here. Raw Tool results and evaluation comparator values are not a fallback handoff.

## Privacy and failure behavior

Logs, traces, datasets and reports may contain field keys, presence/type, validity/verification, counts and safe reason codes only. Price, raw entity, canonical ID and record version stay in runtime memory. Errors are fixed safe codes. No new Phoenix content fields are introduced; existing verification observability receives status only. A failed field prevents task verification and normal answer handoff, regardless of comparator MATCH.

## Validation

Synthetic tests cover extraction, missing/null/type/non-finite values, wrong fact/entity/task/execution, reference mismatch, stale/wrong snapshot, invalid evidence, quantity non-regression, no unverified handoff, serialization privacy and ten concurrent task-isolation checks. The separate certification is one frozen 15-path **read/evidence** run, not an Interpreter or Answer model evaluation.
