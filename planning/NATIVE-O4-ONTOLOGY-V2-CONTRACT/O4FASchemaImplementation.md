# O4-F-A — Recipe Technical Schema Implementation

## Scope and migration

Migration 89, `recipe_canonical_technical_storage` with signature
`recipe-functional-profile-technical-knowledge-v1`, appends the O4-F ADD
stage.  It executes only `RECIPE_TECHNICAL_PROFILE_SCHEMA_SQL`: two `CREATE
TABLE` statements and three justified indexes.  It contains no `ALTER TABLE`,
`INSERT`, `UPDATE`, `DELETE`, legacy JSON parsing, bearing resolution, or
backfill.

Historical migrations 1–88 remain untouched.  A fresh database reaches schema
version 89 through the normal migration chain; an upgrade database at version
88 receives the new empty tables only.

## Actual tables

`recipe_functional_technical_profiles` is a strict one-to-one child resource:
`recipe_id INTEGER PRIMARY KEY REFERENCES recipes(id)`.  It contains the typed
functional dimensions, `barrel_length`, `open_offset`,
`bearing_span_explicit`, the two concrete bearing Part FKs, state/version
metadata, provenance/evidence JSON objects, and command-owned timestamps.

`recipe_technical_knowledge` is another one-to-one child resource:
`recipe_id INTEGER PRIMARY KEY REFERENCES recipes(id)`.  Its only evolving
payload is `items_json`, constrained as a JSON array; arbitrary item shape
validation remains a later command/API responsibility.

Both foreign-key declarations intentionally use SQLite's default `NO ACTION`
delete behavior.  This follows the existing Recipe-owned child-table pattern
and the project's soft-delete lifecycle: deleting a parent row is not an
implicit destructive cascade.

`recipe_functional_technical_profiles` has indexes on
`(migration_state, completeness_state)`, `upper_bearing_part_id`, and
`lower_bearing_part_id`.  Both new tables are registered in
`APPLICATION_TABLES` for schema/backup verification.  `CORE_CONSTRAINED_TABLES`
is unchanged.

## Structural constraints

- Numeric dimensions use nullable positive/non-negative checks exactly as
  approved; no cross-entity stainless mode rule is encoded in SQLite.
- `schema_version >= 1`; no default permits an accidental version omission.
- Completeness state is exactly `COMPLETE`, `INCOMPLETE`, `NEEDS_REVIEW`, or
  `LEGACY_COMPATIBILITY`.
- Migration state is exactly `ALREADY_CANONICAL`, `AUTO_MIGRATED`,
  `MIGRATED_WITH_COMPATIBILITY_PROVENANCE`, `NEEDS_OWNER_REVIEW`, or
  `BLOCKED_UNRESOLVED`.
- `provenance_json` and `legacy_evidence_json` must be JSON objects;
  `items_json` must be a JSON array.
- There is no stored derived stainless bearing-span column, trigger, 620x code
  column, old PumpShell default, or Template rotor-parameter column.

The bearing FKs prove concrete `parts.id` existence only.  SQLite does not and
must not claim to enforce `category='轴承'` or active lifecycle status; that is
deferred to O4-F-B's command validation.

## Isolation proof

`tests/recipeTechnicalProfileSchemaMigration.test.cjs` uses only in-memory
SQLite databases.  It proves fresh and pre-89 upgrade behavior, expected
columns/FKs/indexes, no triggers, constraints, zero initial rows, idempotent
second migration run, and preservation of existing Recipe rows.  It also
asserts that existing Recipe command/query/DTO/route source modules do not
reference either new table.

Existing Recipe commands and reads remain legacy-only.  No route, DTO, API,
Ontology module, Rotor path, backfill helper, or runtime consumer was changed.

## Deferred boundary

O4-F-B owns canonical command/query DTOs, command-time bearing category and
lifecycle validation, stainless/non-stainless requiredness, provenance
semantics, timestamps, audit integration, and all reads/writes to these tables.
O4-F-C/D own dry run, review, and backfill.  No production database migration
or deployment occurred in this stage.
