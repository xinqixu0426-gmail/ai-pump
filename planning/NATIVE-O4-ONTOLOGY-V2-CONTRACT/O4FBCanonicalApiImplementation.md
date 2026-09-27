# O4-F-B Canonical Recipe Technical API Implementation

## Boundary

This stage adds the first explicit Business API for canonical Recipe technical storage:

- `GET /api/recipes/:id/technical-profile` (`recipes.technical_profile.get`)
- `PUT /api/recipes/:id/technical-profile` (`recipes.technical_profile.update`)

It is independent of legacy `GET /api/recipes/:id`, `POST /api/recipes`, and
`PATCH /api/recipes/:id`. It does not backfill, project into legacy columns,
read legacy `technical_data_json` as a fallback, change Rotor/BOM/cost readers,
or expose a new AI/MCP capability.

## Persistence and audit

`api/services/recipeTechnicalProfileStore.cjs` uses fixed parameterized SQL for
the two one-to-one resources. Their primary key is `recipe_id`, so the generic
`safeInsert`/`safeUpdate` helpers (which correctly assume `id`) are not used.
The service compares old and desired rows before writing. Every changed child
table receives a separate `audit_log` entry with `record_id=recipeId`; a real
aggregate change also creates one Recipe-domain `business_change_event` through
`executePersistentCommand`. The functional row, knowledge row, audits, event,
and persistent idempotency receipt are one SQLite transaction. No-op PUTs keep
timestamps and create neither child audit nor business event.

## DTO and aggregate version

PUT accepts only `functional`, `technicalKnowledge.items`, and
`expectedUpdatedAt` (plus the transport idempotency key). Client input cannot
set completeness, migration metadata, provenance, or legacy evidence.

The aggregate version is the latest non-null `updated_at` from the two child
rows. First creation requires a null/absent version. Once either row exists,
PUT requires an exact aggregate version. A command assigns one timestamp to all
changed child rows and advances it monotonically beyond an existing aggregate
timestamp when a fixed or low-resolution clock would otherwise repeat it.

GET is read-only. It reports absent and partial child resources honestly and
never auto-creates rows.

## Current policy and derived projection

The stainless policy resolver follows only the formal path:

`recipes.template_id -> pump_shell_templates -> catalog_template_shell_bindings -> parts.id(category=泵壳) -> parts.remark.isStainless`.

It does not use `shellModel`, suffix/name matching, Template rotor parameters,
or the legacy PumpShell resolver. Boolean `false` is non-stainless; absent,
malformed, or non-explicit metadata is `UNKNOWN_OR_UNRESOLVED`, never false.

- Stainless accepts `barrelLength` and `openOffset`, rejects
  `bearingSpanExplicit`, and projects read-only `bearingSpan` as
  `round(barrelLength - openOffset, 1)` when valid.
- Non-stainless accepts `bearingSpanExplicit`, rejects the two stainless-only
  inputs.
- Unknown accepts none of those three inputs and can never be complete.

The derived span is not stored as a column.

## Bearings and completeness

Provided bearings must be exact, active `parts.id` rows in category `轴承`.
No model lookup, 6202 string input, supplier guess, or fuzzy match occurs. The
temporary engineering read context remains `Part -> bearingCodeOf ->
normalizeBearing -> BEARING_DB`; missing geometry never replaces the selected
Part ID, but it leaves the profile `INCOMPLETE` with a geometry reason.

The server alone computes `COMPLETE` or `INCOMPLETE` from required dimensions,
mode inputs, bearing IDs, and geometry availability. Migration-only states and
legacy evidence remain unavailable to this command.

## Technical Knowledge

Knowledge is a generic JSON-safe item collection. An item requires `key`,
`label`, and `value`; optional `unit`, `valueType`, and validated
`recipeTechnicalFileIds` evidence remain metadata. Keys are unique within the
Recipe and do not infer functional meaning. Functional-control metadata,
callbacks, and non-JSON-safe values are rejected. The service writes only
`recipe_technical_knowledge.items_json`, never `knowledge_entries`, FTS, or
vectors. Server-owned item provenance uses `OWNER_CANONICAL_WRITE`.

## Deferred work

- O4-F-C/D: deterministic legacy dry run, bearing/openOffset/thickness migration,
  owner review queue, and migration provenance transitions.
- O4-F-E: explicit legacy compatibility read adapter and shadow parity.
- Later: Rotor/BOM/cost canonical read cutover, one-way legacy projection,
  derived knowledge indexing, UI integration, and separately governed AI write
  admission.
