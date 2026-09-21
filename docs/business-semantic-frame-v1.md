# Business Semantic Frame V1

## Status and boundary

`BusinessSemanticFrameV1` is a deterministic, read-only semantic projection over the current AI turn. It states which business question is being asked, which formal facts that question requires, which facts verified execution evidence supplied, whether the requested answer is complete, and which disclosures or prohibitions apply.

It is enabled only by `AI_BUSINESS_SEMANTIC_SHADOW_ENABLED=true`; the default is off. The observer runs after the authoritative answer has completed and cannot change prompts, tool selection, tool arguments, provider calls, answer text, writes, routing, cost calculation, or Ontology canaries. It performs no provider calls and no business writes. Observation and sink failures are fail-open.

The frame is not a source of business values. Prices, stock, configurations, identities, and business records remain authoritative in the existing APIs, services, cost engine, and SQLite data. The frame contains only states, canonical IDs, bounded fact projections, and verified receipt provenance.

## Two-stage construction

- `PRE_EVIDENCE` derives question semantics, requested subject type, required business facts, and preliminary obligations from the current user text. It never marks a fact verified.
- `POST_EVIDENCE` accepts only tool results carrying `executionEvidence.verified === true`, resolves canonical projections, classifies every required fact, and derives completeness and answer obligations.

Canonical identity is never manufactured from a keyword. Language parsing can describe the requested type or unresolved token; `canonicalType`, `canonicalId`, and `UNIQUE` require formal evidence.

## Contract vocabulary

Question kinds are limited to `COST_QUERY`, `INVENTORY_QUERY`, `CONFIGURATION_OVERRIDE`, `HYPOTHETICAL_COST_QUERY`, `CATALOG_LOOKUP`, and `OUT_OF_SCOPE`.

Question classification is preceded by `SemanticEligibilityBoundaryV1`. A non-empty sentence is no longer
implicitly a catalog lookup: `CATALOG_LOOKUP` requires a positive, deterministic supported-catalog signal.
Requests without such a signal remain `OUT_OF_SCOPE`; they do not start semantic evidence planning and the
existing Legacy path remains authoritative. Eligibility allows investigation only and never creates a
canonical identity or verified business fact.

Cost basis is explicit: `MACHINE_CURRENT_FULL_COST`, `RECIPE_SAVED_COST`, `PART_CATALOG_UNIT_COST`, `COIL_SCHEME_COST`, or `UNKNOWN_COST_BASIS`. Price context is separate: `CURRENT_FORMAL_PRICE`, `USER_HYPOTHETICAL_PRICE`, `HISTORICAL_PRICE`, or `UNKNOWN`. Thus an unsupported copper-price request can retain a verified current machine cost without pretending the current amount was calculated using the hypothetical price.

Overrides are classified as `NO_OVERRIDE`, `SUPPORTED_OVERRIDE`, `AMBIGUOUS_OVERRIDE`, `UNSUPPORTED_OVERRIDE`, or `MISSING_BASE`. A recipe override retains a canonical base entity and `PRESERVE_UNMENTIONED_BASE_CONFIGURATION`; an ambiguous coil family never receives a selected canonical ID.

The existing `RECIPE_CURRENT_FULL_COST` fact distinguishes a formal current-cost receipt from a saved snapshot.
For a configuration override, the same fact is verified only when the authoritative preview is bound to the
canonical base recipe and its returned configuration proves the selected canonical override was applied. Ordinary
current full-cost questions do not acquire `CURRENT_COPPER_PRICE_BASIS` merely because copper contributes inside
the cost engine. Copper basis is separately required when the user explicitly asks for it or proposes a copper-price
hypothesis.

Completeness is derived from required fact states, ambiguity, and support—not model confidence. The states are `COMPLETE`, `NEEDS_EVIDENCE`, `NEEDS_CLARIFICATION`, `UNSUPPORTED_REQUEST`, `PARTIAL_VERIFIED`, and `NOT_FOUND_VERIFIED`. A negative catalog answer is verified only when recipe, template, and part catalogs each provide an authoritative, untruncated result; execution-call paths alone do not prove an empty result.

## Business Rulebook → Semantic Frame

| Business rule | Semantic-frame concept | Future enforcement point |
|---|---|---|
| `BR-COST-BASIS` | `cost.requestedBasis`, `cost.actualBasis`, `DISCLOSE_COST_BASIS` | Reject or disclose a basis mismatch before answer finalization |
| `BR-COST-LEVELS` | Separate machine, saved recipe, part-unit, and coil-scheme bases | Require the level requested by the user |
| `BR-COST-REBUILD` | `RECIPE_BASE_CONFIGURATION`, `RECIPE_CURRENT_FULL_COST` | Plan formal preview evidence without duplicating arithmetic |
| `BR-COST-COIL-VARIANTS` | `COIL_OFFICIAL_VARIANT_SET`, `MULTIPLE_OFFICIAL_VARIANTS` | Require all official variants and their matching facts |
| `BR-HYPOTHETICAL-PRICE` | requested vs actual price context and `UNSUPPORTED_REQUEST` | Prevent current formal price from being labeled hypothetical |
| `BR-COPPER-OVERRIDE` | explicit `copperPrice` override and `UNSUPPORTED_OVERRIDE` | Refuse unsupported machine-level copper overrides deterministically |
| `BR-UNKNOWN-PARAM` | missing fact states and `MUST_NOT_GUESS_PARAMETER` | Block synthesis that fills an unverified business parameter |
| `BR-CROSS-CATALOG` | requested/canonical type split, `CROSS_CATALOG_CANDIDATES` | Continue formal evidence planning in the discovered catalog |
| `BR-MATERIAL-SLOTTYPE` | variant ambiguity dimensions and canonical coil IDs | Require user selection when the target family is not unique |
| `BR-NO-GUESS-DEFAULT` | `AMBIGUOUS_OVERRIDE`, `MUST_NOT_SELECT_VARIANT` | Block automatic default selection unless formal policy permits it |
| `BR-CONFIG-INCOMPLETE` | required facts, missing facts, and completeness blockers | Prevent a complete-cost claim before configuration evidence is complete |

Existing rulebook enforcement remains where it is. This mapping describes where each rule belongs semantically; BUS-P1 does not move or delete enforcement.

## Structural Ontology → Semantic Frame

| Structural Ontology fact | Semantic-frame use |
|---|---|
| Canonical `recipe` identity | `RECIPE_CANONICAL_IDENTITY`, override base entity |
| `recipe.uses_coil` | `RECIPE_BASE_CONFIGURATION`, comparison with requested coil override |
| `recipe.contains_part` | Evidence that unmentioned parts belong to inherited base configuration |
| Canonical `coil` identity | `COIL_CANONICAL_IDENTITY`; never inferred from a shorthand alone |
| Official coil variant records | `COIL_OFFICIAL_VARIANT_SET`, ambiguity dimensions and candidate count |
| Canonical `part` identity | `PART_CATALOG_IDENTITY` and cross-catalog subject correction |
| Canonical `template` identity | Catalog-scope evidence and future base-configuration requirements |

Ontology remains responsible for what canonical entities are connected. The semantic frame is responsible for why a connection or fact matters to this question. BUS-P1 adds no Ontology relation family and changes no Ontology runtime behavior.

## Validation and limits

The validator rejects unknown enum values, invalid canonical IDs, duplicate or unclassified required facts, oversized candidate/source arrays, payloads above 32 KiB, `COMPLETE` frames with unverified required evidence, verified-negative frames without full catalog evidence, and ambiguous overrides that contain a selected canonical ID.

The frame retains at most 24 facts, 24 receipt sources, and 12 canonical candidates per fact. Raw business collections and answer text are not copied into the frame. The scale sentinel continues to compare the rejected full aggregate with the existing bounded read and separately measures maximum semantic-frame payload size.

## Phase handoff

BUS-P1 observes obligations but does not rewrite answers. A later BUS-P2 can use the stable required-fact and completeness contract for deterministic Evidence Planning and Completeness Enforcement: schedule missing formal reads, prevent unsupported or incomplete claims, and require clarification for ambiguous overrides while leaving all cost arithmetic in `costEngine.cjs`.
