# O4-F — Canonical Recipe Storage Schema Proposal

## Decision

Adopt two one-to-one Recipe-owned resources.  `recipes` remains the aggregate that owns identity, lifecycle, Template/Coil relations, BOM configuration, and cost snapshots.  It does **not** remain the final mixed technical store.

1. `recipe_functional_technical_profiles` is the typed canonical authority for final functional technical inputs and canonical bearing Part relations.
2. `recipe_technical_knowledge` is the flexible canonical collection for non-functional engineering documentation.

`knowledge_entries`, FTS, embeddings, `technical_data_json`, PumpShell metadata, Template `rotor_params_json`, and Rotor bearing codes are never canonical storage for the new profile.

## Current storage evidence

- `api/database/schema.cjs` defines `recipes.template_id`, `coil_id`, `coil_sheets`, `custom_barrel_length`, dedicated impeller columns, and `technical_data_json`.
- `api/services/recipeCommands.cjs:normalizeRecipePayload()` currently writes all of those mixed fields in one Recipe command.
- `api/db.cjs:recipeRow()` exposes those fields but not `recipes.deleted_at`.
- `api/services/rotorTemplateDraft.cjs:buildRotorRecipeDraft()` first creates legacy Template/PumpShell/Variant draft data, then overlays Recipe JSON; it only uses `impeller_thickness` if the JSON depth patch remains empty.
- `api/services/knowledge.cjs` converts Recipe JSON and `recipe_technical_files` into derived `knowledge_entries`; the FTS/vector system is therefore retrieval infrastructure, not operational source of truth.

## Proposed conceptual SQL — design only

```sql
CREATE TABLE recipe_functional_technical_profiles (
  recipe_id INTEGER PRIMARY KEY
    REFERENCES recipes(id),

  rotor_diameter REAL,
  stack_offset REAL,
  oil_seal_diameter REAL,
  impeller_bore_diameter REAL,
  impeller_span REAL,
  impeller_thickness REAL,
  thread_length REAL,
  thread_diameter REAL,

  -- Stainless-only inputs.  These are Recipe-owned, never PumpShell fields.
  barrel_length REAL,
  open_offset REAL,

  -- Only for non-stainless.  A stainless span is derived, never stored here.
  bearing_span_explicit REAL,

  upper_bearing_part_id INTEGER REFERENCES parts(id),
  lower_bearing_part_id INTEGER REFERENCES parts(id),

  schema_version INTEGER NOT NULL,
  completeness_state TEXT NOT NULL,
  migration_state TEXT NOT NULL,
  migration_version TEXT,
  migration_fingerprint TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  legacy_evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  CHECK (schema_version >= 1),
  CHECK (completeness_state IN ('COMPLETE','INCOMPLETE','NEEDS_REVIEW','LEGACY_COMPATIBILITY')),
  CHECK (migration_state IN ('ALREADY_CANONICAL','AUTO_MIGRATED',
    'MIGRATED_WITH_COMPATIBILITY_PROVENANCE','NEEDS_OWNER_REVIEW','BLOCKED_UNRESOLVED')),
  CHECK (rotor_diameter IS NULL OR rotor_diameter > 0),
  CHECK (stack_offset IS NULL OR stack_offset >= 0),
  CHECK (oil_seal_diameter IS NULL OR oil_seal_diameter > 0),
  CHECK (impeller_bore_diameter IS NULL OR impeller_bore_diameter > 0),
  CHECK (impeller_span IS NULL OR impeller_span > 0),
  CHECK (impeller_thickness IS NULL OR impeller_thickness > 0),
  CHECK (thread_length IS NULL OR thread_length > 0),
  CHECK (thread_diameter IS NULL OR thread_diameter > 0),
  CHECK (barrel_length IS NULL OR barrel_length > 0),
  CHECK (open_offset IS NULL OR open_offset >= 0),
  CHECK (bearing_span_explicit IS NULL OR bearing_span_explicit > 0),
  CHECK (json_valid(provenance_json)),
  CHECK (json_valid(legacy_evidence_json))
);

CREATE INDEX idx_recipe_functional_profile_migration
  ON recipe_functional_technical_profiles(migration_state, completeness_state);
CREATE INDEX idx_recipe_functional_profile_upper_bearing
  ON recipe_functional_technical_profiles(upper_bearing_part_id);
CREATE INDEX idx_recipe_functional_profile_lower_bearing
  ON recipe_functional_technical_profiles(lower_bearing_part_id);

CREATE TABLE recipe_technical_knowledge (
  recipe_id INTEGER PRIMARY KEY
    REFERENCES recipes(id),
  schema_version INTEGER NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (schema_version >= 1),
  CHECK (json_valid(items_json)),
  CHECK (json_type(items_json) = 'array')
);
```

SQLite cannot safely enforce the cross-resource rule “Part category must be 轴承 and active” or the PumpShell-dependent conditional rules with a simple check.  The future Recipe technical command must validate those in the same transaction; the database FKs still enforce concrete `parts.id` existence.

## Functional span model

| PumpShell policy result | Canonical inputs | Span representation |
|---|---|---|
| `isStainless=false` | `bearing_span_explicit` | required explicit Fact; `barrel_length` and `open_offset` are `NOT_APPLICABLE` for stainless derivation |
| `isStainless=true` | `barrel_length`, `open_offset` | `bearingSpan = barrelLength - openOffset`, computed on read/use; `bearing_span_explicit` must be null/not applicable |
| path or `isStainless` unresolved | none assumed | `UNKNOWN_OR_UNRESOLVED`; no fallback to false |

The initial design is `COMPUTE_ON_READ`.  A later cache is permitted only as a non-authoritative calculated projection with input versions, calculation version, and invalidation evidence; it never becomes editable or higher authority than inputs.

## Bearing identity and geometry boundary

`upper_bearing_part_id` and `lower_bearing_part_id` each reference a concrete supplier-specific `parts.id`.  At write time the selected Part must be category `轴承` and active, unless an explicit historical-reference repair policy permits a deleted target for evidence only.  Neither `6202` nor `轴承-202` is a replacement identity.

The current `BEARING_DB` in `api/services/rotorParameters.cjs` remains a temporary engineering geometry adapter.  Target flow is:

```text
Recipe bearing Part ID -> Part designation/specification projection
  -> normalized engineering reference code -> geometry (diameter/depth)
```

The normalized code is an adapter key, not a second business identifier.  A future shared Bearing Specification/reference-engineering catalog may own geometry, but that work is independent of and must not delay concrete Part-ID storage.

## Technical Knowledge model

Choose one one-to-one JSON collection over one-row-per-item.  The factory is Owner-operated, arbitrary keys are expected to evolve, and a single atomic JSON collection avoids an unnecessary child-row lifecycle while retaining a stable Recipe ownership boundary.

`items_json` contains only generic entries, for example:

```json
[
  {
    "key": "testReportNo",
    "label": "测试报告号",
    "value": "TR-001",
    "valueType": "string",
    "source": { "kind": "MIGRATED_RECIPE_TECHNICAL_JSON" },
    "version": 1,
    "evidence": { "recipeTechnicalFileIds": [42] }
  }
]
```

No file body is copied into this JSON.  `recipe_technical_files` remains the formal evidence/file resource.  `knowledge_entries`, FTS, and vectors receive a derived indexing projection after canonical writes.

## Lightweight provenance

`provenance_json` is keyed by semantic Fact/relation, not by arbitrary database column.  It must retain source paths, migration or owner-confirmation mode, migration timestamp/version, and when relevant legacy evidence.  Bearing provenance additionally records raw legacy value, normalized code, candidate count, chosen Part ID, and resolution mode.

`legacy_evidence_json` preserves non-authoritative comparison values such as historical PumpShell open offset, old JSON span, and both impeller-thickness values.  Review candidates are stored there, never in canonical Fact columns until Owner confirmation.
