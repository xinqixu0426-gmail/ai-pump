# L5-P0 — Business Impact & Causality Audit V1

## Decision

Status: PASS

L5-P0 establishes an audited impact-authority taxonomy, temporal/snapshot semantics, a deterministic candidate contract, a frozen 12-case benchmark and a strict-serial real-local baseline. It does not add production routing, persistence, entities, Ontology relations, cost arithmetic, answer postprocessors or writes.

## Frozen artifacts

- Impact contract: `ImpactResultV1-candidate`
- Impact authority matrix: `ImpactAuthorityMatrixV1`
- Matrix SHA-256: `ce37a7917640c0f260da542c36df161efeed1a48a0bf34fd2c8f7b998bbb23a9`
- Benchmark: `BusinessImpactBenchmarkV1`, 12 cases
- Case SHA-256: `4d6f250b556a915c2348521b1f3c4a15b80df1ad65b99d70c537aa6bb64ae832`
- Fixture SHA-256: `07987804cc91edc13a27b17af8086e8890a6cb21e829f2a4e831ab5c2509e243`
- Oracle SHA-256: `27b4f3d26a6dd87e19221d6473557d1413721b68d3c2877832b8c8844c285e36`

The Oracle uses only isolated SQLite facts, canonical relations, saved snapshots and existing formal service boundaries. Model answers never define causal truth.

## Authority model

- `CANONICAL_DIRECT_IMPACT`: follows directly from a formal current reference, such as `recipes.template_id` or a validated configuration override.
- `DETERMINISTIC_DERIVED_IMPACT`: derives from complete formal references and an existing business service, such as current cost recalculation or order readiness.
- `BUSINESS_RULE_IMPACT`: valid only after an owner-reviewed rule establishes the obligation.
- `ENGINEERING_HYPOTHESIS`: plausible general engineering knowledge without factory-specific proof; never an authoritative result.
- `UNSUPPORTED_UNKNOWN`: present data cannot support the claim.

Every candidate also ends as `AUTHORITATIVE_NOW`, `RULE_REQUIRED`, `DATA_MODEL_REQUIRED`, `ENGINEERING_EVIDENCE_REQUIRED`, or `UNSUPPORTED`.

`CHANGED` means the target fact itself changed. `AFFECTED` means review, recalculation or revalidation is warranted and never implies mutation. `RECALCULATE` and `REVALIDATE` remain different obligations.

## Temporal and snapshot audit

### Recipe and cost

Recipes have `updated_at`, current canonical configuration fields, `saved_total_cost` and `saved_cost_details`, but no explicit monotonic recipe revision. `saved_total_cost` is a saved historical value; current cost is a derived fact from current catalog/template/configuration inputs through `costEngine`.

### Orders

New order lines preserve `recipeId`, `partsJson`, `unitCost`, optional `configurationSnapshot`, `costSnapshot`, `snapshotVersion` and `snapshotSource`. Order revisions also persist immutable before/after business snapshots. Therefore a current recipe change does not mutate an existing order. Where snapshot fields exist, the order-at-sale configuration and current recipe can be compared; legacy lines without complete snapshots remain limited.

### Quotations

Quotation lines preserve base recipe ID, BOM snapshot, configuration snapshot, cost snapshot and `snapshotAt`. They do not bind to an explicit source recipe revision or a formal cost-basis revision/timestamp contract. The saved quote is historical, but current source changes alone cannot prove `CURRENT` or `STALE_VERIFIED`. Freshness is `DATA_MODEL_REQUIRED`.

### Technical and test files

`recipe_technical_files` binds a report to `recipe_id`, file hash, report type, parsed summary and timestamps. It does not bind the report to recipe revision, configuration fingerprint, coil identity or motor/hydraulic variant. After a configuration change the system may truthfully say applicability is unproven; it cannot say the report remains valid or is invalid.

### Inventory and purchase

Part/coil inventory is current mutable state. Active-order readiness and purchase plans are derived from current inventory plus the saved order BOM; this supports deterministic present-tense readiness impact. Purchase lists stored on orders are snapshots/workflow state and are not automatically rewritten by a later catalog or recipe change.

### Knowledge and business changes

Knowledge entries retain `source_table`, `source_id`, `source_updated_at` and derived content hashes, so they are searchable projections rather than causal authority. Immutable `business_change_events` record actual completed command changes and affected entities; they prove that a change occurred, but do not by themselves establish every downstream impact.

## Domain findings

- Recipe/configuration: direct current references and deterministic cost recalculation are supported.
- Coil/motor configuration: canonical coil identity is supported; performance direction and numeric effects are not.
- Part/BOM: canonical recipe↔part membership supports one-hop current-cost impact.
- Pump-shell template: `recipes.template_id` supports a complete affected recipe set.
- Cost: current derived cost and saved historical cost must remain distinct.
- Quotation: historical snapshots exist; verified freshness does not.
- Order: saved snapshots exist for current creation paths; recipe changes do not mutate them.
- Inventory: current state and deterministic active-order readiness are supported.
- Purchase: current derived plans and saved workflow lists exist; automatic downstream change is not implied.
- Technical/test files: recipe-level association exists; configuration applicability does not.
- Knowledge: derived/searchable source projection, not impact authority.
- Business changes: immutable evidence of actual mutations, not an automatically traversable impact graph.

## Candidate business rules requiring owner review

The following remain `BUSINESS_RULE_CANDIDATE`, not enforced truth:

- coil/motor identity change requires temperature-rise or performance revalidation;
- rotor, impeller, shell/hydraulic configuration, voltage/frequency or wire-weight changes define specific retest classes;
- which quotation states require mandatory freshness review after source changes.

## Missing data-model capabilities

Required for correctness before authoritative expansion:

1. Recipe revision/configuration fingerprint.
2. Test-report configuration fingerprint and source recipe revision.
3. Quotation source recipe revision and formal cost-basis timestamp/revision.
4. A stable contract for legacy order-line configuration identity where snapshots are incomplete.
5. Canonical supplier identity if supplier-level impact chains are desired.

Useful but optional:

- explicit impact/revalidation decision records;
- a normalized comparable configuration fingerprint shared by quote/order/test evidence;
- formal current-versus-snapshot comparison service.

Not justified in P0:

- a persisted LLM-created impact graph;
- generic engineering predictions promoted to factory facts;
- a supplier entity created solely to make traversal convenient.

## Product platform and variant gap

The project has pump-shell templates, model variants, coils and recipe configuration, but current data does not provide a reviewed canonical platform relation proving that V550, V750 and V110 share one shell platform. `motor_variant`, `hydraulic_variant` and `pump_variant` are not consistently represented as independent, comparable L5 identities. This is a future L5/L6 modeling gap, not a P0 entity expansion.

Formal supplier identity available: NO. `parts.supplier` remains a string.

## Real-local baseline

Strict serial provider: local Ornith 35B. One request completed before the next began.

- Executions: 24 (12 cases × 2)
- PASS: 11
- PARTIAL: 13
- FAIL: 0
- BLOCKED: 0
- Provider calls: 93
- Cloud fallback: 0
- Maximum tool payload: 14893 bytes
- Production database writes: 0

Dimensions:

- Trigger Understanding: 100%
- Impact Target Accuracy: 83.3%
- Temporal/Snapshot Semantics: 91.7%
- Causal Authority: 83.3%
- Recalculation Semantics: 91.7%
- Revalidation Semantics: 91.7%
- Negative Impact Completeness: 91.7%
- Engineering Non-Hallucination: 100%
- Safety: 100%

All defined critical L5 failures are 0. The repeated partial patterns are: missing cost-recalculation disclosure, missing order-snapshot explanation, incomplete order-readiness projection, treating a full change question as an identity lookup, failing to express report applicability limits, and failing to ask for canonical clarification before impact analysis. These are baseline findings, not P0 runtime fixes.

## Regression gates

- BusinessImpactBenchmarkV1 deterministic tests: 9/9 PASS
- Full repository regression: 2734/2734 PASS
- API contract: 27/27 PASS
- Deep API: 490/490 PASS; temporary database integrity OK; foreign-key violations 0
- Lint: PASS
- Web build: PASS

## Recommended L5-P1 scope

Start with a read-only deterministic Impact Projection for the already-authoritative slice only:

1. canonical configuration change → current recipe changed;
2. configuration/part-price change → current cost recalculation required;
3. current recipe change → saved order snapshot differs, without mutating the order;
4. part inventory change → active-order readiness recomputation;
5. template change → complete current recipe set.

Keep quotation freshness and technical-report validity out of authoritative runtime until revision/fingerprint support or reviewed business rules exist. Keep engineering prediction entirely non-authoritative.

One-sentence conclusion: the project can already prove several deterministic business impacts, but snapshot freshness, evidence applicability and engineering consequences need explicit data or reviewed rules before L5 may speak authoritatively.
