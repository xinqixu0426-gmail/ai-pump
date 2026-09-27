# O4-F — Decision Record

## Selected architecture

The selected final physical architecture is a typed one-to-one `recipe_functional_technical_profiles` table plus one-to-one JSON `recipe_technical_knowledge` table.  This is not a recommendation among alternatives: it is the O4-F design decision for future implementation.

The typed profile contains final functional dimensions, stainless inputs, explicit non-stainless span, concrete bearing Part IDs, version/state fields, and lightweight JSON provenance/evidence.  The knowledge table contains arbitrary non-functional entries.  `recipes` retains aggregate identity, lifecycle, Template/Coil FKs, `coil_sheets`, BOM configuration, and cost snapshots.

## Frozen storage choices

- `open_offset` is a nullable, Recipe-owned, typed millimetre input.  Legacy PumpShell offset is a review candidate only.
- `bearing_span_explicit` names non-stainless-only input.  Stainless span is computed from canonical inputs and is never an independent writable field.
- `upper_bearing_part_id` and `lower_bearing_part_id` are concrete `parts.id` FKs.  No new bearing-ID namespace is created.
- `impeller_thickness` becomes one typed canonical profile Fact.  JSON/column conflicts block automatic migration.
- Generic Technical Knowledge uses `items_json`, not rows per arbitrary key and not `knowledge_entries` as canonical storage.
- Per-Fact/relation provenance is held in profile `provenance_json`; non-authoritative historical comparison data stays in `legacy_evidence_json`.

## State model

Migration state answers how storage arrived: `ALREADY_CANONICAL`, `AUTO_MIGRATED`, `MIGRATED_WITH_COMPATIBILITY_PROVENANCE`, `NEEDS_OWNER_REVIEW`, or `BLOCKED_UNRESOLVED`.

Completeness state answers whether canonical Rotor input can be safely used: `COMPLETE`, `INCOMPLETE`, `NEEDS_REVIEW`, or `LEGACY_COMPATIBILITY`.  These are deliberately separate from Recipe lifecycle.  `NOT_APPLICABLE` and `UNKNOWN_OR_UNRESOLVED` are Fact/policy outcomes, not aliases for a false boolean.

## Read/write decision

Canonical read precedence is: canonical profile -> canonical derivation -> explicit legacy adapter for marked legacy records -> unresolved.  Canonical data is never overwritten by a fallback.

Canonical write is one command transaction over Functional Profile, Technical Knowledge, bearing relations, audit/business-change receipt, and optional one-way legacy projection.  There is no two-way synchronization.  New Recipes after cutover do not use legacy PumpShell/Template defaults or bearing codes as final authority; incomplete is preferable to fabricated authority.

## Cutover and rollback decision

The only permitted rollout sequence is ADD, DRY RUN, BACKFILL, VERIFY, SHADOW READ, CANONICAL WRITE, CANONICAL READ, LEGACY FREEZE, then later LEGACY RETIRE.  Rotor read cutover requires complete profile, resolved canonical relations, migration/audit evidence, and parity or approved expected differences.  Rollback switches readers to the explicit legacy adapter and preserves additive canonical data; it never deletes or reverse-migrates.

## Future API decision

Prefer aggregate endpoints:

```text
GET /api/recipes/:id/technical-profile
PUT /api/recipes/:id/technical-profile
```

The PUT request carries `{ functional, technicalKnowledge, expectedUpdatedAt }` and saves atomically through existing command/audit/idempotency/confirmation conventions.  This ticket creates neither endpoint nor a write allowlist entry.

## Implementation sequence

1. O4-F-A: schema migration and isolated schema/command tests.
2. O4-F-B: canonical profile/knowledge command-query DTO and transactional audit integration.
3. O4-F-C: deterministic dry-run/report plus owner review queue.
4. O4-F-D: backfill with fingerprints, provenance, and no automatic ambiguous resolution.
5. O4-F-E: canonical/legacy read adapter and Rotor shadow parity suite.
6. O4-F-F: canonical write/read cutover with one-way temporary projections.
7. O4-F-G: legacy freeze and separately approved cleanup/retirement.

No phase silently enables Ontology runtime or makes Ontology a business data store.
