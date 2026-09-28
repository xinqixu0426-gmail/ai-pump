# O4 Landing Completion

Status: development complete; no production deployment or production migration has occurred.

## Delivered authority boundary

- O1 Coil, O2 Part/PumpShell, O3 Recipe technical authority, and O4 V2.1 contracts remain the semantic baseline.
- Recipe canonical identity is `recipes.id`; canonical functional technical storage is the one-to-one `recipe_functional_technical_profiles` resource and flexible technical knowledge is `recipe_technical_knowledge`.
- Migration 89 added the two additive tables. Deterministic dry-run, backfill, Owner review resolution, and Owner promotion provide the migration path without guessing legacy authority.
- Canonical Rotor input, shadow parity, and the real feature-gated Rotor selector are present. A complete, current canonical aggregate is used as one record; no legacy field fills a canonical record.
- Canonical PUT can temporarily project required Functional values one way to legacy compatibility fields. Technical Knowledge is never flattened into legacy JSON.
- When legacy-write freeze is enabled, either canonical child row freezes changed legacy technical fields in the formal legacy Recipe update command. Unmigrated Recipes retain temporary legacy compatibility; nontechnical edits and semantically unchanged full payloads continue to work.
- The live-writer audit found the formal `recipeCommands` update path as the guarded legacy writer and the fixed canonical-to-legacy projection as the sole intentional live exception. Historical migrations are not runtime writers. The Recipe Rotor route reaches `rotorQueries.buildRecipeRotorDraft`, then the runtime selector; `buildLegacyRecipeRotorDraft` remains only for compatibility fallback, shadow comparison, and tests.

## Trial flags

All defaults are `false` in source:

- `RECIPE_TECHNICAL_CANONICAL_READ_ENABLED`
- `RECIPE_TECHNICAL_LEGACY_PROJECTION_ENABLED`
- `RECIPE_TECHNICAL_LEGACY_WRITE_FREEZE_ENABLED`

The initial Owner-trial shape enables all three: canonical-safe Rotor reads, canonical-to-legacy compatibility projection, and freeze of competing legacy technical writes. Rollback is a flag change: disable canonical read to resume the legacy Rotor path, disable projection to stop compatibility writes, or disable freeze to restore legacy update compatibility. No database reversal is required.

## Retained compatibility and deferred work

The following are deliberately retained through deployment and Owner acceptance: legacy Recipe technical columns/JSON, Template `rotor_params_json`, PumpShell historical defaults, legacy Rotor builder, and canonical-absent whole-record legacy fallback.

Deferred post-O4 work: physical legacy-column deletion, removal of the legacy Rotor builder, mandatory migration of every historical Recipe, canonical-first Recipe creation redesign, rare malformed historical-data handling, broader UI redesign, and cosmetic diagnostics. None is required for the safe O4 landing boundary.

Migration head remains 89. Ontology remains a declarative contract and does not own business values. AI/MCP write scope is unchanged.
