# O4-F — Recipe Technical Storage Migration Plan

## Principles

- Migration is deterministic, idempotent, transactional, and auditable; no LLM chooses a supplier, shell, offset, or conflicting dimension.
- Existing storage is preserved through the first cutover.  There is no deletion or reverse backfill.
- Missing, ambiguous, or contradictory data remains unresolved.  It is never completed from PumpShell defaults, Template rotor params, name heuristics, cheapest Part, newest Part, or first match.
- `recipes.template_id` and `recipes.coil_id` remain where they are.  `recipes.coil_sheets` remains Recipe configuration input for derived `pieceCount`.

## Current-path audit boundary

| Concern | Current path observed | Design consequence |
|---|---|---|
| Write | `apps/web-next/components/recipes-view.tsx` builds the save payload; `apps/web-next/lib/recipes.ts` calls `POST/PATCH /api/recipes`; `api/routes/recipes.cjs` delegates to `api/services/recipeCommands.cjs:normalizeRecipePayload()` | One current command writes dedicated Recipe columns and `technical_data_json`; the replacement must be one aggregate technical command/transaction, not independent writers. |
| Read | `api/services/recipeQueries.cjs` reads Recipe rows; `api/db.cjs:recipeRow()` projects camelCase mixed storage and does not currently expose `deleted_at` | New profile readers need an explicit DTO/adapter and must not imply an existing raw-lifecycle projection. |
| Rotor | `api/services/rotorQueries.cjs` calls `api/services/rotorTemplateDraft.cjs:buildRotorRecipeDraft()`; that starts with Template/PumpShell/Variant values, then overlays Recipe JSON and falls back to `recipes.impeller_thickness` only when JSON depth is absent | This is a legacy reconstruction chain for the compatibility adapter, never the migration authority for missing canonical values. |
| BOM/cost | `api/services/recipeBomEngine.cjs` and `api/services/costEngine.cjs` remain their respective authoritative engines; `custom_barrel_length` is presently passed through Recipe command/configuration paths | Migration centralizes the one barrel-length Fact before later adapters switch both consumers; it does not move formulas into the profile. |
| Knowledge index | `api/services/knowledge.cjs` and `api/services/knowledgeAutoSync.cjs` turn Recipe JSON and `recipe_technical_files` into `knowledge_entries`/FTS/vector projections | Canonical Technical Knowledge must be Recipe-owned storage; search is a post-write derived index only. |

## Phases

1. **ADD** — later migration adds the two tables and indexes only; production reads remain legacy.
2. **DRY RUN** — read-only report per Recipe and aggregate counts; no profile rows are written.
3. **BACKFILL** — write canonical candidates only when rules below pass; record provenance, fingerprint, and audit/business-change events in the same transaction.
4. **VERIFY** — validate profile structure, relation targets, requiredness state, and field-level migration evidence.
5. **SHADOW READ** — produce old Rotor input and canonical Rotor input side by side without changing output.
6. **CANONICAL WRITE** — new technical command owns new tables; optional one-way legacy projection supports old consumers temporarily.
7. **CANONICAL READ** — migrated complete profiles drive Rotor DTO; legacy adapter is restricted to explicitly marked legacy records.
8. **LEGACY FREEZE / RETIRE** — stop legacy writes, remove fallback readers only after parity and repair gates pass.  Dropping old fields is a separate later change.

## Dry-run output

For every non-deleted Recipe, emit `recipeId`, profile existence/schema version, Template/Coil relation status, PumpShell policy state, each functional candidate, missing set, open-offset candidate, stainless/non-stainless span assessment, bearing candidates, thickness matrix result, proposed knowledge items, target state, fingerprint, and zero writes.  Aggregate counts group outcomes by `AUTO_MIGRATABLE`, `MIGRATABLE_WITH_COMPATIBILITY_PROVENANCE`, `NEEDS_OWNER_REVIEW`, `BLOCKED_UNRESOLVED`, and `ALREADY_CANONICAL`.

The review report is an API/report design artifact, not an AI decision engine.  It must identify Part candidates by `parts.id`, model, supplier, lifecycle, and evidence—not silently select one.

## Direct functional migration

The following explicit JSON keys migrate directly into typed profile columns only when numeric validation succeeds: `rotorDiameter`, `stackOffset`, `oilSealDiameter`, `impellerBoreDiameter`, `impellerSpan`, `threadLength`, and `threadDiameter`.  Provenance is `MIGRATED_RECIPE_TECHNICAL_JSON` with raw key/value retained.  Missing or invalid remains missing; no legacy default fills it.

`recipes.custom_barrel_length` migrates to `barrel_length` with `MIGRATED_RECIPE_COLUMN` provenance.  It remains available to current BOM/cost during transition, but it must not become a separate long-term authority.  `coil_sheets` stays on `recipes`; `pieceCount` is recomputed rather than migrated from JSON.

## Open-offset migration

There are exactly two safe cases:

1. A canonical profile already contains an Owner-confirmed `open_offset`: preserve it; canonical wins.
2. A legacy Recipe has no Recipe-owned value: inspect historical PumpShell `openOffset`/`openFactor` only as a `COMPATIBILITY_MIGRATION_CANDIDATE` in `legacy_evidence_json`.

Case 2 never writes `open_offset`.  It creates `NEEDS_OWNER_REVIEW` until a confirmed technical write explicitly supplies the Recipe Fact.  Historical PumpShell data is evidence, not implicit consent or authority.

## Bearing migration

For each legacy `technical_data_json.upperBearing`/`lowerBearing` value:

1. Preserve raw value.
2. Use the existing deterministic normalizer to obtain a legacy Rotor code (for example `202` -> `6202`).
3. Search active `parts` where `category='轴承'`; project each Part’s declared/naming bearing code through existing `bearingCodeOf()` and the same normalizer.
4. Compare normalized codes exactly.
5. Exactly one active candidate -> write the concrete Part ID with resolution mode `EXACT_UNIQUE`.
6. Zero candidates -> no relation; state `BLOCKED_UNRESOLVED`.
7. More than one candidate -> no relation; state `NEEDS_OWNER_REVIEW` / `AMBIGUOUS`.

Migration never chooses by supplier, price, creation time, row order, or fuzzy model text.  Owner repair writes the selected `parts.id` with `OWNER_SELECTED` provenance.  Each relation provenance records raw value, normalized code, candidate count, selected ID if any, timestamp, migration version, and resolution mode.

## Thickness conflict matrix

| JSON `impellerDepth` | `recipes.impeller_thickness` | Result |
|---|---|---|
| absent | absent | missing |
| present | absent | migrate JSON value |
| absent | present | migrate dedicated-column value |
| equal after agreed numeric normalization | present | migrate one canonical value; retain both source paths/evidence |
| differ | present | `NEEDS_OWNER_REVIEW`; preserve both values; write no canonical thickness |

The migration intentionally does not copy the current Rotor runtime’s JSON-first fallback into conflict resolution.  Runtime precedence is compatibility behavior, not a conflict policy.  Numeric comparison should retain raw text and compare canonical parsed millimetres; use exact normalized value where possible, otherwise Owner review.

## Span migration

For a confidently resolved `isStainless=false` path, valid legacy `technical_data_json.bearingSpan` may populate `bearing_span_explicit` with `MIGRATED_RECIPE_TECHNICAL_JSON` provenance.  If Template binding, Shell Part binding, PumpShell extension applicability, or `isStainless` is unknown, span mode is `UNKNOWN_OR_UNRESOLVED` and the migration remains pending.

For `isStainless=true`, old JSON span is never written as canonical input.  Once canonical `barrel_length` and Owner-confirmed `open_offset` exist, compute new span and compare it with legacy span as evidence.  A difference greater than 0.1 mm (current code rounds derived span to one decimal place) is `NEEDS_OWNER_REVIEW`; do not change inputs merely to reproduce historical output.

## Technical Knowledge migration

Move confirmed non-functional fields to `recipe_technical_knowledge.items_json`: `rotorLength`, `shaftDiameter`, `impellerModel`, `impellerDiameter`, `impellerBladeCount`, `power`, `voltage`, `current`, `frequency`, `testReportNo`, `testDate`, `testSummary`, `customFields`, and unknown custom JSON keys by default.  Dedicated values (`impeller_model`, `impeller_diameter`, `impeller_blade_count`) use `MIGRATED_RECIPE_COLUMN` provenance.  Fixed/unknown JSON values carry their original key/label and `MIGRATED_RECIPE_TECHNICAL_JSON` provenance.  Technical files remain references, not copied content.

## Idempotency, audit, and repair

Each backfill computes a fingerprint from the Recipe ID, schema/migration version, relevant legacy inputs, resolved relation candidates, and canonical result.  Re-running with the same fingerprint is a no-op.  Existing Owner-confirmed canonical values are never overwritten.  A changed source or new deterministic candidate produces a report/review event, not automatic replacement.

Every profile/knowledge/relation write, Owner repair, and compatibility-to-canonical promotion must use the existing command transaction, audit log, business-change event, idempotency receipt, and `expectedUpdatedAt` boundary.  One Recipe migration transaction writes profile, knowledge collection, migration provenance, and any temporary legacy projection together or rolls back all of them.

## Rollback safety

Rollback changes the reader selection to the legacy adapter while preserving all additive canonical rows, migration evidence, and audit events.  It never deletes profiles or reverses owner repairs.  A rollback marker records reason, revision, and affected scope; recovery resumes shadow comparison before re-enabling canonical reads.
