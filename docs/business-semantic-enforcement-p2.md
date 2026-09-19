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
pre-evidence frame
→ BusinessEvidencePlanV1
→ bounded existing formal reads
→ post-evidence frame
→ model synthesis
→ deterministic semantic answer boundary
```

`OUT_OF_SCOPE` keeps legacy behavior. The supported kinds are `COST_QUERY`, `INVENTORY_QUERY`,
`CONFIGURATION_OVERRIDE`, `HYPOTHETICAL_COST_QUERY`, and `CATALOG_LOOKUP`.

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

Focused coverage is in `tests/businessSemanticEnforcement.test.cjs`, including eight fail-safe mutations.
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
