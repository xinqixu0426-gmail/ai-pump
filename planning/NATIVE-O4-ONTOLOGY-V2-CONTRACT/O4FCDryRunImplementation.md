# O4-F-C — Deterministic Recipe Technical Migration Dry Run

## Scope and hard boundary

O4-F-C adds a read-only assessment for active Recipes.  It answers what a
future O4-F-D backfill would propose; it does not create canonical profile or
knowledge rows, mutate legacy Recipe data, create an audit/business-change/
operation receipt, or persist a review queue.  Migration head remains 89.

The implementation is `api/services/recipeTechnicalMigrationDryRun.cjs` and
uses fixed `SELECT` statements plus in-memory deterministic evaluation.  The
derived Owner Review Queue is a filtered report, not a database resource.

## Read capabilities and routes

- `recipes.technical_profile.migration_dry_run`
  - `GET /api/recipes/:id/technical-profile/migration-dry-run`
  - `GET /api/recipes/technical-profile/migration-dry-run?limit=1..100&offset>=0`
- `recipes.technical_profile.migration_review_queue`
  - `GET /api/recipes/technical-profile/migration-review-queue?limit=1..100&offset>=0`

Both are `query`, low risk, web/internal only, no confirmation and no audit.
They are deliberately absent from AI tools, MCP write exposure, and write
allowlists.  The collection is restricted to `recipes.deleted_at IS NULL`, is
ordered by `recipes.id ASC`, and never auto-creates a canonical child row.

## Candidate and fingerprint model

Every assessment returns its algorithm version, canonical-state summary,
formal stainless policy, direct/conditional/bearing/knowledge candidates,
reason codes, target classification, and a SHA-256 fingerprint.  The
fingerprint hashes canonical JSON for the migration-relevant snapshot:
Recipe legacy fields, raw technical JSON, canonical row summary, Template/Shell
relation and stainless evidence, bearing candidates, and thickness sources.
Identical input snapshots produce identical fingerprints.

The five mutually exclusive classifications are evaluated in this order:

1. `ALREADY_CANONICAL` — both supported child resources exist; legacy values
   are informational and never proposed as overwrites.
2. `NEEDS_OWNER_REVIEW` — partial canonical state, openOffset confirmation,
   bearing ambiguity, thickness conflict, invalid candidate, or knowledge
   conflict needs a human decision.
3. `BLOCKED_UNRESOLVED` — a required formal policy/bearing identity cannot be
   resolved deterministically.
4. `MIGRATABLE_WITH_COMPATIBILITY_PROVENANCE` — a safe candidate retains two
   agreeing historical sources.
5. `AUTO_MIGRATABLE` — no authority conflict, review requirement, or blocked
   relation remains.

The review queue contains exactly the `NEEDS_OWNER_REVIEW` and
`BLOCKED_UNRESOLVED` assessments. It scans the active cohort in fixed
`recipes.id ASC` order but retains only one bounded result page in memory, so
queue pagination is over review items rather than over unrelated recipes.

## Frozen migration safety rules implemented

- Functional JSON candidates use the existing deterministic historical Rotor
  numeric grammar and retain raw evidence.  This compatibility parser is only
  for stored legacy data; the O4-F-B canonical PUT remains actual-JSON-number
  only.
- `custom_barrel_length` is the sole barrel-length column candidate.  Shell,
  Template, ModelVariant and name fallbacks are never used.
- Stainless resolution uses only the formal Recipe → Template → binding →
  active PumpShell Part path and requires an actual JSON boolean.  `1`, `0`,
  strings, missing data and malformed JSON are `UNKNOWN_OR_UNRESOLVED`.
- PumpShell `openOffset`/`openFactor` is exposed only as compatibility review
  evidence.  A stainless Recipe without an owner-confirmed canonical offset is
  `NEEDS_OWNER_REVIEW`; no candidate is auto-proposed.
- Bearings normalize legacy codes through `normalizeBearing`, enumerate active
  `category='轴承'` Parts, and compare normalized engineering codes exactly.
  One candidate is `EXACT_UNIQUE`; zero is blocked; multiple is owner review.
  Geometry availability never changes the selected Part identity.
- `impellerDepth` JSON and `impeller_thickness` column implement the frozen
  four-case matrix.  Equal dual sources retain compatibility provenance;
  differing sources produce no thickness candidate and require review.
- A non-stainless legacy `bearingSpan` may propose
  `bearingSpanExplicit`.  Stainless span is comparison evidence only and is
  never a stored migration input.  Unknown policy cannot enter the
  non-stainless branch.
- `pieceCount` is reported only as derived `COPY(recipes.coil_sheets)` and is
  never a stored candidate.
- known non-functional and unknown JSON-safe non-control keys become generic
  Technical Knowledge candidates. Functional/control keys are excluded, so
  neither identity, policy, BOM, cost nor Rotor authority can leak into the
  knowledge collection.

## Deferred to O4-F-D and later

O4-F-D owns actual backfill, canonical writes, migration-state transitions,
provenance/evidence persistence, review resolution, and audit/operation
receipts. O4-F-E owns the legacy read adapter and Rotor parity. No O4-F-C API
changes existing Recipe GET/POST/PATCH, canonical technical PUT, Rotor, BOM,
cost, Ontology runtime, UI, or AI write admission.

## Test evidence

`tests/recipeTechnicalMigrationDryRun.test.cjs` proves zero writes, candidate
extraction, strict policy, bearing ambiguity, thickness matrix, canonical
precedence, deterministic pagination/fingerprint, and AI isolation.
`tests/recipeTechnicalMigrationDryRunRouteHttpIntegration.test.cjs` proves the
three HTTP reports are read-only, bounded, and reject deleted/malformed targets
without side effects.
