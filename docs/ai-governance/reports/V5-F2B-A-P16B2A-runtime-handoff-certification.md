# V5-F2B-A / P16-B2A Verified Runtime Fact Handoff Completion

## 1. Executive Result

PASS. P16_B2_RESUME_READY=YES; P16_C_READY=NO. One frozen handoff certification completed: 15/15 paths have all required runtime facts available. Answer facts: price 3/3, quantity 6/6, coil 3/3, recipe 3/3. All existing ledger facts, including quantity on the price paths, are readable: 18/18.

Start commit: `e58ae5e52b57f021f3822de641f5d75bda242a87`, branch `master`, worktree dirty at start. Unrelated user-owned edits were not changed or staged. No Answer Composer, Prompt, model call, production routing or write was introduced.

## 2. P16-B2 Blocker

The previous certified getter accepted only price receipts. Other tasks already had VALID ledger items and registered VERIFIED task results, but no runtime value receipt. This change closes value retention/access, not fact semantics or verification. Historical datasets cannot recreate an opaque runtime receipt; each certification task is established once in the existing isolated read-only fixture.

## 3. Verified Fact Authority

| Fact | Capability / Tool | Tool field | Type / unit | Snapshot |
|---|---|---|---|---|
| inventory.quantity | inventory.read / search_parts | parts[].stock | finite number; catalog quantity unit | Same successful governed read execution |
| coil.inventory | coil.read / search_coils | data[].stock | finite number; coil sets | Same successful governed read execution |
| recipe.cost.preview | recipe.cost.preview / preview_recipe_cost | data.currentTotalCost | finite number; CNY per recipe unit | Current-cost response of the same execution |
| price.current | inventory.read / search_parts | parts[].price | finite number; CNY per catalog quantity unit | Existing same-row-version reference verification |

Authority chain: query/business Executors → internalApiClient → formal parts/coils/current-costs API → existing read-result inspection → existing Evidence Ledger → existing Verification. `partQueries`/`partRow` own part stock; `coilQueries`/`coilRow` own scheme stock. Existing procurement semantics measure coil stock in sets. `aiRecipeResolution.selectCurrentRecipeCost` preserves the current-cost API's source/basis/asOf and labels the no-override result currentFullCost. No value comes from a model, comparator, expected result or new calculation.

The three existing requirements are DIRECT_FACT, including the cost result returned by the Business API. That is the existing Evidence classification, not a claim that no calculation occurs inside Business API. Evidence kind, requirements and verifier files are unchanged.

## 4. Runtime Handoff Contract

`api/services/ai-v5/fieldReadEvidence.cjs` retains exact approved scalars in a private WeakMap associated with the original ledger item. `readExecutionShadow.cjs` captures during collection and releases a handle only after its unchanged verification gate passes. No parallel ledger or bulk Tool DTO is created.

`createVerifiedValueHandoff` accepts the existing single-receipt form or explicit same-task receipts. It requires the real registered verification result, exact ledger-item equality, valid runtime receipt and finite value. Price additionally requires its original independent verification receipt. `getVerifiedEvidenceValue(handle, context)` checks explicit factKey/task/entity/resolution receipt/source execution. Unavailable access throws the existing fixed safe code `VERIFIED_EVIDENCE_ACCESS_DENIED`.

## 5. Approved Fact Keys

Frozen `APPROVED_RUNTIME_FACTS` allows only price.current, inventory.quantity, coil.inventory and recipe.cost.preview. It is a runtime access allowlist, not a new Evidence Requirement registry. No wildcard or dump-all getter exists. Each getter invocation names one fact. A task handle containing multiple separately verified facts does not authorize a fact absent from that handle.

## 6. Task / Entity Isolation

Cross-task, wrong canonical entity, wrong resolution receipt, wrong execution and absent/unknown fact keys are rejected. Forged VERIFIED objects, invalid/unverified ledger evidence and FAIL/deferred verification cannot mint a handle. Scalars are captured before verification and are unaffected by later mutation of the original result object. The caller must preserve the runtime handle; serialized ledgers are not credentials.

## 7. Price Non-Regression

Price extraction, independent formal reference equality, snapshot checks, currency/unit and numeric rules remain unchanged. Existing price tests pass; formal price handoff remains 3/3. Its original execution reference and getter shape remain supported.

## 8. Inventory Quantity

Answer-required applicability is 6 paths, available 6/6. The three price tasks also retain quantity evidence; all nine underlying quantity ledger facts were accessed successfully. Only the unique authoritative row's stock is retained, without coercion or conversion. Existing inventory verification is unchanged.

## 9. Coil Inventory

Applicable 3, available 3/3. The retained scalar is the stock of the already-selected formal coil identity. Scheme/binding values are not handed off with it. No Tool/schema/binder changes or extra coil reads occur during access.

## 10. Recipe Cost Preview

Applicable 3, available 3/3. Retains currentTotalCost exactly, without rounding, recomputation or a new derivation. The fact remains recipe.cost.preview; this read path uses currentFullCost with no overrides. It is not settlement/final accounting cost. Snapshot means the captured same execution, not an invented global database snapshot or a promise of indefinite freshness.

## 11. Deterministic Tests

`node --test tests/aiV5RuntimeHandoff.test.cjs tests/aiV5FieldReadEvidence.test.cjs`: 55/55 PASS (28 new tests plus 27 existing price tests). Coverage includes all three additions, price non-regression, task/entity/fact/execution isolation, forged/failed/deferred verification, invalid evidence, missing/null/wrong types, NaN/infinities, snapshot scalar immutability, fixed safe errors and no bulk access. Existing price concurrency and metadata privacy tests also pass.

Combined `tests/aiV5*.test.cjs`: 350/350 PASS with shadow flags OFF outside tests' explicit fixture options.

## 12. Frozen 15-Path Certification

`scripts/run-ai-v5f2b-runtime-handoff-certification.cjs` ran once. It freezes applicability before execution, refuses an existing output artifact, checks unchanged baseline components, then uses the prior certified query-only fixture/real read chain to establish each task exactly once. No Interpreter or Answer model is invoked. The accessor is exercised against the same task runtime; it never reruns a Tool for value access.

15 task-establishment read executions; accessor Tool calls=0, accessor Business API calls=0. Existing price verification still performs its authorized reference read during task establishment, not during value access. 15/15 VERIFIED tasks, 18/18 existing facts available; answer applicability 3/6/3/3 unchanged. Pre/post certification hashes match, including Evidence Requirements, Ledger, Verification, field handoff implementation/registry, execution integration and certification tests. No implementation changes followed certification.

This certifies runtime handoff, not a new result-equivalence or answer evaluation. B1 result equivalence remains the frozen baseline.

## 13. Privacy

Opaque handles and returned runtimeValue are non-enumerable; all business scalars remain memory-only. No new logging or trace-value code is introduced. Certification exercised the metadata-only Phoenix adapter and captured normal logs transiently: source leaks=0, business-value field leaks=0, 18 metadata spans. Synthetic tests also check serialization and safe errors. Dataset stores only structural results, hashes and safety metadata; no source identity, canonical ID, quantity, price or cost values.

## 14. Database Safety

Main DB hash/mtime/size and backup count unchanged. Isolated query-only fixture hash/mtime/size unchanged. Unexpected backups=NO. V5 writes=0, allowWrite enabling=0, business mutations=0. Fixture and regression environments are retained for inspection; no delete-to-pass cleanup was performed.

## 15. Regression

Full Shadow-OFF deterministic regression ran in a detached worktree at the start commit with only this stage's implementation/test additions. Existing dependencies were linked, a DB copy supplied, and frozen files copied byte-for-byte to preserve historical raw-byte hash checks. User dirty changes were excluded.

Initial environment-only failures were missing fixture/dependency directories and CRLF-vs-LF frozen hashes, not implementation failures. After completing environment setup, the unchanged code passed 2112/2113 tests; the sole remaining failure is missing `.guardian/config.yaml`, the accepted Guardian baseline failure. New P16-B2A regression=NO. No Deep API or real model evaluation was run or repaired.

## 16. P16-B2 Resume Preconditions

P16_B2_RESUME_READY=YES. All four approved facts are available with task/entity/fact isolation, no unverified access, no accessor I/O, no leaks/writes/DB changes, combined tests PASS and no new regression. Future Answer Composer must consume explicit verified fact handles only and must separately implement/validate answer grounding; this certification does not authorize user-visible answers or production routing. Stop for Supervisor review.
