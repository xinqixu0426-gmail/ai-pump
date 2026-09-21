# Business Impact Enforcement V1

## Scope

L5-P2 integrates the frozen `BusinessImpactProjectionV1` result into the existing final answer synthesis and applies a deterministic impact-only answer boundary. It does not add impact families, ontology relations, business entities, cost formulas, database fields, HTTP APIs, provider rounds, or write authority.

The independent authority flag is:

```text
AI_BUSINESS_IMPACT_ENFORCEMENT_CANARY_ENABLED=false
```

With the flag off, the L1–L4 authoritative runtime is unchanged. Shadow remains independently controlled by `AI_BUSINESS_IMPACT_SHADOW_ENABLED`.

## Runtime Contract

An impact turn is authoritative only when all of these conditions hold:

1. Business Semantic V1 admits the request.
2. `ImpactEligibilityV1` positively identifies consequence/change intent.
3. A unique persisted canonical trigger can be constructed, or the request is an explicitly unsupported impact domain.
4. The trigger belongs to one of the five L5-P1 slices.

Ordinary cost, inventory, recipe, catalog, order-readiness, and copper-price questions do not enter the impact path. The negative corpus contains eight such questions and records zero false takeovers.

The supported slices remain exactly:

- IP-01 configuration change → current recipe/configuration impact and cost recalculation requirement
- IP-02 current recipe/order comparison → saved snapshot review or verified comparison
- IP-03 inventory change → active-order readiness recomputation
- IP-04 template change → bounded current affected recipe set
- IP-05 part price change → bounded current recipe cost-recalculation set

## Evidence and Answer Boundary

`ImpactEvidenceBundleV1` is a bounded, target-preserving projection of `ImpactResultV1`. It contains stable display identities, effect, authority, temporal semantics, completeness, obligations, and forbidden claims. Validation rejects target substitution, completeness elevation, unresolved-fact mutation, and payload overflow.

The bundle is inserted into the existing final synthesis opportunity. No second impact planning or summarization call exists. For impact-eligible turns the model-visible tool surface is closed after software-planned formal reads, preventing the local model from inventing additional tool calls while retaining the existing semantic evidence plan.

`ImpactAnswerBoundaryV1` deterministically replaces incomplete or unsafe impact prose. It preserves these boundaries:

- proposed change is not a persisted change;
- affected/recalculation/review/recompute are not flattened into changed;
- current recipe changes do not mutate saved orders;
- an unrecalculated cost is not presented as a new persisted cost;
- capped target sets are explicitly partial;
- quotation freshness and test-report applicability remain unprovable;
- unsupported engineering numbers and directions are not inferred;
- supplier-wide impact chains remain unsupported.

## Acceptance Evidence

Implementation commit: `e80ea6a57bf3643ca75b180fe2f3421f964c1d8c`

Frozen L5-P0/L5-P1 assets remain unchanged:

- case hash: `4d6f250b556a915c2348521b1f3c4a15b80df1ad65b99d70c537aa6bb64ae832`
- fixture hash: `07987804cc91edc13a27b17af8086e8890a6cb21e829f2a4e831ab5c2509e243`
- oracle hash: `27b4f3d26a6dd87e19221d6473557d1413721b68d3c2877832b8c8844c285e36`

Real local provider, strict serial:

- model: `Ornith-1.5-35B-A3B-APEX-i-compact.gguf`
- executions: 12 cases × 2 = 24
- PASS / PARTIAL / FAIL / BLOCKED: `24 / 0 / 0 / 0`
- all nine L5 dimensions: `100%`
- projection stability: `12/12`
- provider calls: `29`
- additional impact provider calls: `0`
- fallback: `0`
- production/business writes: `0`
- maximum tool payload: `8,947 bytes`
- maximum normal projection: `2,364 bytes`
- maximum normal evidence bundle: `2,340 bytes`

All ten L5 critical failure counts are zero.

Scale sentinel:

- physical matching recipes: `62`
- emitted targets: `50`
- read calls: `1` (hard maximum `8`)
- projection bytes: `12,457` (hard maximum `24,576`)
- evidence bundle bytes: `14,052` (hard maximum `16,384`)
- result: `PARTIAL`, `truncated=true`, never false complete

Regression:

- focused/frozen deterministic tests: `53/53 PASS`
- full regression: `2744/2744 PASS`
- API contract: `27/27 PASS`
- Deep API: `490/490 PASS`, integrity OK, foreign-key violations 0
- lint: PASS
- Web build: PASS

`BusinessUnderstandingBenchmarkV2`, `SyntheticBusinessAcceptanceV1`, `ProductionShapeRegressionV1`, and `LegacyWitnessCorpusV1` deterministic/frozen suites pass with the impact flag enabled. The impact gate is reached only for positive impact intent, so non-impact Synthetic turns cannot enter the new path; the accepted 64-run real-model Synthetic baseline is therefore not repeated in L5-P2.

## Rollback and Production

Turning `AI_BUSINESS_IMPACT_ENFORCEMENT_CANARY_ENABLED` off restores the existing L1–L4 authoritative runtime while allowing Shadow to remain independently enabled. No database/schema rollback or data repair is required.

No code was pushed, merged, deployed, or enabled in production in L5-P2.
