# O4-F-E — Canonical Rotor Read Adapter + Shadow Parity

## Boundary

O4-F-E adds a read-only inspection boundary.  It does not change the live
`buildRecipeRotorDraft()` path, does not backfill storage, and does not make
canonical storage a production Rotor source yet.

`recipeTechnicalRotorAdapter` reads only the canonical Functional Profile,
Technical Knowledge collection as non-functional metadata, `recipes` identity
and formal relations, the Template-to-Shell binding, and exact referenced
Parts.  It never restores a missing canonical value from `technical_data_json`,
Template `rotor_params_json`, PumpShell defaults/offsets, ModelVariant data,
names, or legacy bearing text.

## Canonical input

`pieceCount` is a derived COPY of `recipes.coil_sheets`.  The adapter maps the
canonical Functional Profile to the current Rotor patch names only at its
compatibility output edge.  Stainless `bearingSpan` is derived from canonical
`barrelLength - openOffset`, rounded to 0.1 mm.  Non-stainless span is the
stored canonical `bearingSpanExplicit`.

Upper and lower bearing identity remains the exact canonical `parts.id` stored
by the profile.  Engineering geometry is only a projection:

`exact Part ID → bearingCodeOf → normalizeBearing → BEARING_DB`.

An unavailable geometry code leaves that same Part identity intact and marks
the Rotor input incomplete; it never chooses another Part.

The formal stainless path is unchanged:

`Recipe.template_id → Template → catalog_template_shell_bindings → Shell Part → strict boolean parts.remark.isStainless`.

Missing, malformed, numeric, or string `isStainless` is unresolved, never
non-stainless.

## Canonical state handling

When both child rows are absent the canonical adapter returns
`LEGACY_COMPATIBILITY_REQUIRED`, allowing only the separate shadow wrapper to
show the existing legacy result.  Partial, unsupported, invalid, review, or
blocked canonical storage returns a deterministic unsafe result.  A canonical
but incomplete profile stays canonical and omits unresolved fields; no
field-by-field legacy fill is permitted.

## Shadow report

`GET /api/recipes/:id/technical-profile/rotor-shadow` returns independent
legacy and canonical candidates plus per-field parity:

- `MATCH` for semantically equal normalized values;
- `EXPECTED_SEMANTIC_CHANGE` for a documented legacy fallback or the old
  PumpShell-offset stainless span;
- `CONFLICT` for incompatible concrete values without an approved explanation;
- `UNRESOLVED` when canonical authority cannot safely establish the field.

The overall report is `PARITY`, `EXPECTED_DIFFERENCE`, `ATTENTION_REQUIRED`, or
`INCOMPLETE`.  It executes no write, audit, event, operation, backfill, or
index update.

## Cutover status

The endpoint and the formal query capability are Web/internal only.  They are
not AI/MCP capabilities.  Existing Recipe GET/POST/PATCH, legacy Rotor,
BOM/cost, migration commands, and canonical write API are unchanged.

O4-F-F may use accumulated shadow evidence to define the guarded read cutover;
it must separately decide eligibility, rollout, fallback, and retirement of
the legacy Rotor reader.
