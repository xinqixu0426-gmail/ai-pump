# Business Semantic Enforcement P2

BUS-P2 adds a default-off, read-only software control around the accepted `BusinessSemanticFrameV1`.
It does not change the cost engine, AI tool schemas, Business APIs, or the database schema.

## Gate and runtime order

The independent gate is:

```text
AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED=false
```

The existing `AI_BUSINESS_SEMANTIC_SHADOW_ENABLED` remains observation-only. When enforcement is on,
supported turns follow this order:

```text
SemanticEligibilityBoundaryV1
→ eligible supported business request
→ pre-evidence frame
→ BusinessEvidencePlanV1
→ bounded existing formal reads
→ post-evidence frame
→ model synthesis
→ deterministic semantic answer boundary
```

`OUT_OF_SCOPE` keeps legacy behavior. The supported kinds are `COST_QUERY`, `INVENTORY_QUERY`,
`CONFIGURATION_OVERRIDE`, `HYPOTHETICAL_COST_QUERY`, and `CATALOG_LOOKUP`.

A recipe material-readiness question is an `INVENTORY_QUERY`, not a catalog lookup and not a cost question;
`api/business-semantics/readinessSemantics.cjs` is the shared authority for that classification (see
[Business Semantic Frame V1](./business-semantic-frame-v1.md#material-readiness-齐料--缺料-is-its-own-read-class)).
Keeping that domain is part of this boundary: when no formal readiness receipt exists, the boundary asks for the
missing quantity or states that no verified readiness conclusion was obtained, and it never emits the
current-cost amount template for a question that never asked about money.

`SemanticEligibilityBoundaryV1` is deterministic admission control, not another intent planner. Cost,
inventory, override and catalog semantics enter only when the request also carries a positive supported
business signal such as a recognised recipe/coil/catalog identifier or an explicit lookup over a supported
resource. `CATALOG_LOOKUP` is never the generic non-empty fallback. Generic conversation, writing,
arithmetic, general knowledge, unsupported domains and protected write commands retain Legacy authority and
produce zero semantic planned reads. A trusted page context can contribute only after server-side
normalisation and only for an already-supported semantic resource type.

## Evidence planning

`api/business-semantics/factCapabilityRegistry.cjs` is the only Fact Type → existing capability mapping.
The planner does not query SQL or call business services directly. Every generated call records field-level
argument provenance from the approved set:

- `CANONICAL_SUBJECT_ID`
- `VERIFIED_PRIOR_FACT`
- `USER_EXPLICIT_VALUE`
- `TRUSTED_PAGE_CONTEXT`
- `FORMAL_VARIANT_CANDIDATE`

The hard bound is `MAX_SEMANTIC_EVIDENCE_CALLS = 3`, derived from the largest core paths:

- recipe resolution + current cost + current copper basis;
- recipe resolution + coil resolution + base-recipe override preview;
- recipe + template + part catalogue absence verification.

Software-only capabilities are added to the runtime allowlist, never automatically to the model-visible tool
surface. A dependent cost or override read is planned only after its canonical recipe or coil evidence exists.
Read failures and incomplete receipts remain missing evidence and can never become verified absence.

### Current-cost evidence reconciliation

An ordinary current full recipe-cost request does not require a separate copper-price read. A configuration
override such as `如果改成 12-120 正式线圈` is classified as `CONFIGURATION_OVERRIDE`, not as a generic
hypothetical copper-price calculation. It is complete only when the existing formal preview proves all of the
following in one execution chain:

- the cost authority is `costEngine` and the result is a current full-cost or override-preview basis;
- the receipt belongs to the same canonical recipe;
- the formal result is not marked pricing-incomplete;
- for a requested coil override, the returned configuration snapshot contains the selected canonical coil.

A saved recipe amount, a coil-only amount, a receipt for another recipe, a result without an authoritative cost
basis, or a preview that does not prove the requested override remains missing `RECIPE_CURRENT_FULL_COST`.
The semantic layer never duplicates cost arithmetic.

`CURRENT_COPPER_PRICE_BASIS` remains required for explicit current/system copper-basis questions, explicit
copper-basis disclosure requested together with recipe or coil cost, and hypothetical copper-price questions.
The planner uses the existing `get_copper_price` capability for explicit current-basis reads; an unrelated recipe
total cannot satisfy that fact.

## Completeness and answer boundary

The post-evidence `BusinessSemanticFrameV1` is the sole completeness input. The explicit policy covers:

- `COMPLETE`
- `NOT_FOUND_VERIFIED`
- `NEEDS_CLARIFICATION`
- `UNSUPPORTED_REQUEST`
- `NEEDS_EVIDENCE`
- `PARTIAL_VERIFIED`

The answer boundary emits one deterministic paragraph for supported semantic turns. Replacement, rather than
paragraph appending, prevents overlap with the existing Money Guard and legacy postprocessors. In particular:

- an unsupported hypothetical copper price is never presented as a formal machine-cost calculation;
- a multiple-variant coil override stops before cost preview and lists the formal candidate set;
- verified absence requires complete receipts from recipe, template, and part catalogues;
- the historical-alias case remains `ALIAS_UNRESOLVED` and asks for clarification without claiming absence.

## Verification

Focused coverage is in `tests/businessSemanticEnforcement.test.cjs` and
`tests/semanticCostEvidenceReconciliation.test.cjs`, including the original fail-safe mutations plus current-cost
receipt, wrong-recipe, saved-snapshot, coil-only, unapplied-override, and copper-basis counterexamples.
Real-provider OFF/ON/OFF comparison is run with:

```bash
node scripts/run-business-semantic-enforcement-acceptance.cjs
```

The runner keeps the frozen BUS-P0 cases, fixture, and oracle, records provider-call delta, planned-read
attribution, writes, median/P95 wall latency, rollback equivalence, scale sentinel, and maximum serialized plan
and post-evidence frame sizes. It intentionally reports a failing acceptance status rather than redefining a
frozen expectation.

The current acceptance boundary is intentionally explicit: a supplier-kit-price coil capability reports that a
wire-weight input was not applied, so `COIL_OVERRIDE_APPLIED` remains unsupported; and BUS-P2 deliberately keeps
historical aliases unresolved because no formal alias authority exists. These states are safe `PARTIAL_VERIFIED`
and `NEEDS_CLARIFICATION` outcomes, not fabricated PASS results.
