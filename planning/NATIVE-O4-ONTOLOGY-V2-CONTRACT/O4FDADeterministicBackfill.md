# O4-F-D-A — Deterministic Canonical Backfill

O4-F-D-A adds a narrowly scoped, single-Recipe execution path for an O4-F-C
assessment already marked `target.writeEligible=true`. It is not a data
migration batch, runtime cutover, compatibility adapter, or Owner-review
workflow.

## Admission and confirmation

Only `AUTO_MIGRATABLE` and `MIGRATABLE_WITH_COMPATIBILITY_PROVENANCE` may
receive a Preview. Both canonical child rows must be absent. The confirmation
payload binds the Recipe ID, migration version and fingerprint, classification,
null first-create aggregate version, target migration/completeness states, and
exact Functional and Technical Knowledge payloads.

Apply requires that token and an explicit persistent idempotency key. Inside
the `executePersistentCommand` transaction it re-runs the pure O4-F-C
assessment and requires the bound decision to match exactly. If sources drift,
canonical state appears, or the classification is no longer eligible, it rolls
back without an operation receipt, audit, event, or canonical row.

## Storage and evidence

The command uses fixed SQL keyed by `recipe_id`; it never uses the generic
`safeInsert`/`safeUpdate` helpers. It writes both canonical child rows with the
same timestamp, exactly two child-table audits with `record_id=recipeId`, and
one normal Recipe business-change event atomically.

`provenance_json` records per-field migration sources. Direct JSON fields use
`MIGRATED_RECIPE_TECHNICAL_JSON`, dedicated columns use
`MIGRATED_RECIPE_COLUMN`, exact bearing matches use
`MIGRATED_LEGACY_BEARING_CODE`, and agreeing duplicate thickness evidence is
kept as `MIGRATED_WITH_COMPATIBILITY_PROVENANCE`. No D-A value is marked
`OWNER_SELECTED` or `OWNER_CANONICAL_WRITE`.

`legacy_evidence_json` contains only bounded historical evidence: piece-count
derivation context, exact bearing candidate evidence, thickness inputs, span
assessment, limited PumpShell compatibility offset evidence, and Technical
Knowledge migration sources. It does not dump a PumpShell remark/defaults or
turn compatibility evidence into canonical authority.

## Verification and boundary

The command reads the committed canonical state through the O4-F-B read model,
checks it against the target, then runs O4-F-C again. It commits only if that
post-write result is `ALREADY_CANONICAL` with the original fingerprint.

Legacy Recipe fields, knowledge indexes/FTS/vectors, Rotor, BOM, cost, Ontology,
existing Recipe routes, AI/MCP exposure, and migration schema remain unchanged.
Records requiring an Owner decision, partial canonical storage, or any blocked
source remain for O4-F-D-B; D-A never fills them partially or attempts repair.
