# O4-F-D-B1 Owner Review Resolution

## Scope

`recipes.technical_profile.migration_review_resolve` is a high-risk, web/internal-only command for a single initial canonicalization. It begins with the current deterministic O4-F-C assessment and creates both canonical Recipe technical child rows only when both rows are absent. It is not a canonical-profile editor and it never repairs, patches, promotes, or overwrites existing canonical state; those cases remain D-B2 work.

The paired endpoints are `POST /api/recipes/:id/technical-profile/migration-review-preview` and `POST /api/recipes/:id/technical-profile/migration-review-resolve`. Preview is read-only and returns a confirmation token. Resolve accepts only that token and a persistent idempotency key.

## Bounded decisions

The only supported current review issue families are:

- `OPEN_OFFSET_OWNER_CONFIRMATION_REQUIRED`: stainless mode only; Owner provides an actual finite JSON number greater than or equal to zero. PumpShell `parts.remark.openOffset` and `openFactor` remain non-authoritative comparison evidence.
- `UPPER_BEARING_PART_AMBIGUOUS` and `LOWER_BEARING_PART_AMBIGUOUS`: Owner chooses an exact active `parts.id` from the current position-specific ambiguous candidate set. No model, code, supplier, price, stock, or first-match selection is accepted.
- `IMPELLER_THICKNESS_CONFLICT`: Owner selects exactly one current conflicting source path; no arbitrary number is accepted.
- `TECHNICAL_KNOWLEDGE_DUPLICATE_CONFLICT`: Owner selects exactly one current evidence source path for each conflicting knowledge key.

Every current supported issue must be resolved together, and no extra decision is accepted. `BLOCKED` reasons and unsupported review reasons reject preview; they require source-data repair or a later explicitly designed authority path. Formal Template/Shell/stainless policy cannot be overridden.

## Authority and persistence

The resolved target starts with O4-F-C deterministic candidates and applies only validated Owner choices. Completeness is recalculated with the O4-F-B canonical helper. Both `COMPLETE` and `INCOMPLETE` are valid results.

The two rows are inserted atomically through the fixed `recipe_id` store. The final state is `ALREADY_CANONICAL`, with `migration_version` and `migration_fingerprint` null. The source migration version/fingerprint remains only in server-owned provenance and legacy evidence. Deterministically migrated fields retain their migration provenance; `openOffset` is `OWNER_CONFIRMED`, while selected bearings, thickness, and knowledge conflicts are `OWNER_SELECTED`.

Resolve reassesses inside the persistent command transaction and rebuilds the decision from current evidence. Any fingerprint, candidate, policy, reason, lifecycle/category, canonical-absence, or confirmation mismatch fails closed. Success creates exactly two child-table audits keyed by `recipeId`, one Recipe business-change event, a persistent receipt, canonical readback, and an `ALREADY_CANONICAL` post-write dry-run. No knowledge index, legacy Recipe field, Rotor, BOM, cost, Ontology, AI, or MCP surface changes.

## Deferred work

D-B1 has no batch mode and no existing-canonical repair. D-B2, if needed, must separately define the concurrency and authority model for partial or existing canonical state.
