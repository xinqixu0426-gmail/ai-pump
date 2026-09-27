# Recipe Technical Authority Design — Future Source of Truth

> Design only. This document does not authorize schema, DTO, API, UI, runtime, Ontology, cost-engine, or migration changes.

## Design decision

The recommended future model is a **two-domain Recipe technical design**: a one-to-one structured **Recipe Functional Technical Profile** for typed facts, relation IDs, applicability and derived declarations; and a separate flexible **Recipe Technical Knowledge** collection for memo/evidence information.

It is preferred over keeping `technical_data_json` canonical because Rotor Drawing values have stable engineering meaning, need validation/provenance/relations, and currently overlap dedicated Recipe columns. It is preferred over adding more columns to `recipes` because technical fields will evolve independently from BOM/cost/lifecycle fields and need a coherent identity/provenance boundary.

`recipes` remains the aggregate/product record. Existing dedicated fields and `technical_data_json` become migration/compatibility sources or projections until retired; they are not parallel authorities. Flexible knowledge must not be forced into the rigid functional profile merely because it currently shares a JSON object or a dedicated Recipe column.

## Target Recipe semantic structure

```text
Recipe (recipe.id)
  ├── uses_template → Template
  ├── uses_coil → Coil
  ├── uses_model_variant_preset → ModelVariant (optional provenance)
  ├── has_functional_technical_profile → RecipeFunctionalTechnicalProfile
        ├── independent Functional Technical Facts
        ├── relation-backed Facts
        ├── Derived Technical Facts
        ├── applicability rules
        └── provenance / compatibility status
  └── has_technical_knowledge → RecipeTechnicalKnowledge
        ├── flexible key/value technical memos
        ├── test/performance metadata
        ├── engineering/customer notes
        └── evidence/file relations and searchable projection
```

### Identity and relations

| Target element | Semantic role | Current mapping |
|---|---|---|
| `recipe.id` | canonical identity | `recipes.id` |
| `uses_template` | normal material/configuration structure | `recipes.template_id` |
| `uses_coil` | formal Coil relation | `recipes.coil_id` |
| `preset_origin` | optional initialization provenance, not authority | `recipes.model_variant_id` |
| `uses_upper_bearing` / `uses_lower_bearing` | formal technical Part relations; concrete supplier/catalog selection | migrate current string JSON only after identity resolution |
| test reports | supporting evidence relation | existing Recipe technical-file relation, not a technical Fact |

Upper/lower bearing are frozen as formal Recipe-to-Part relations: `Recipe --uses_upper_bearing--> Part(category=轴承)` and `Recipe --uses_lower_bearing--> Part(category=轴承)`. The Part's `id` is canonical; `轴承-202` is a designation/display projection. This is not conditional on whether a current record happens to contain a formal Part ID—legacy records need an adapter or explicit repair, rather than redefining their strings as canonical identity. Oil-seal diameter remains a dimension Fact unless a separate formal oil-seal selection is intentionally introduced. `impellerModel` is frozen as `TECHNICAL_KNOWLEDGE`, never a Part relation or functional Fact.

## Bearing relation correction — target adapter and geometry model

The current Rotor strings (`6201`, `6202`, `6203`, `6204`, `6205`, `6303`, `6304`) are `LEGACY_ROTOR_BEARING_CODE` values. `6202` is not a second bearing identity beside catalog Part `轴承-202`; it is a compatibility projection used by the present Rotor implementation. Any conversion between the designation's three-digit catalog code and a 62xx/63xx Rotor code is an adapter concern only.

```text
CURRENT
Recipe upperBearing = "6202"
        ↓ normalizeBearing()
BEARING_DB["6202"]
        ↓
Rotor dimensions

TARGET
Recipe
        ↓ uses_upper_bearing / uses_lower_bearing
Part #X (for example, designation 轴承-202)
        ↓ formal bearing technical projection
shared bearing specification / reference engineering data
        ↓
Rotor dimensions
```

The recommended semantic owner of geometry is a **bearing specification profile / reference engineering catalog shared by compatible Parts**, rather than a Part-ID-specific copy. A Recipe still selects one concrete Part ID, so two suppliers' `轴承-202` records remain distinct material relations while projecting the same shared geometry when appropriate. The specification layer is engineering reference data, not a replacement canonical business entity and not a reason to make `6202` canonical.

Current `BEARING_DB` is the hard-coded geometry lookup in `api/services/rotorParameters.cjs`; it is not a business identity authority. Future work must establish the formal mapping from a bearing Part to its engineering specification. Until then, compatibility adapters may normalize legacy text/code only to resolve a **unique** selected Part. Ambiguous text/model matches must require an explicit Part selection; they must not silently choose a supplier or catalog record.

### Independent authoritative Recipe Technical Facts

| Fact | Applicability | Notes |
|---|---|---|
| `barrelLength` | stainless only | final Recipe value; also consumed by BOM/cost |
| `openOffset` | stainless only | final Recipe value; no longer sourced from PumpShell |
| `bearingSpan` | non-stainless only | explicit final Recipe value |
| `rotorDiameter` | when rotor drawing applies | independent dimension |
| `stackOffset` | when rotor drawing applies | independent dimension |
| `oilSealDiameter` | when rotor drawing applies | independent dimension |
| `impellerBoreDiameter` | when rotor drawing applies | independent dimension |
| `impellerSpan` | when rotor drawing applies | independent dimension |
| `impellerThickness` | when rotor drawing applies | one fact; replaces competing JSON/column authority |
| `threadLength`, `threadDiameter` | when rotor drawing applies | independent dimensions |

### Derived Technical Facts

| Derived fact | Rule | Storage recommendation |
|---|---|---|
| stainless `bearingSpan` | `barrelLength - openOffset` | calculate/project at read/use time; do **not** store as independent authoritative value |
| `pieceCount` | final Recipe Coil configuration’s sheets | projection/derived fact; do **not** maintain a competing editable value |
| FC bearing depths/core length/total length | Rotor Drawing parameter construction from selected bearing + final dimensions | Rotor Drawing projection, not independent Recipe facts |

Materializing a derived value for performance is permissible only when marked `DERIVED`, includes input/version provenance, is invalidated when inputs change, and is never used as an independent override.

## Technical Knowledge — flexible, readable, non-functional

Recipe Technical Knowledge is an intentionally extensible collection rather than a fixed functional field inventory. Its current confirmed content includes `rotorLength`, `shaftDiameter`, `impellerModel`, `impellerDiameter` (outside diameter), `impellerBladeCount`, `power`, `voltage`, `current`, `frequency`, `testReportNo`, `testDate`, `testSummary`, and arbitrary custom technical fields. It may be displayed, searched, indexed, summarized by AI, associated with files, and changed as engineering documentation evolves.

It must not automatically drive Rotor Drawing, BOM, cost, Part selection, identity, requiredness, policy execution, or writes. `impellerDiameter` remains distinct from functional `impellerBoreDiameter`; current source audit found no functional consumer for the former. `impellerThickness` is not Knowledge: it is the single functional Rotor thickness Fact, despite its current duplicate storage as `recipes.impeller_thickness` and `technical_data_json.impellerDepth`.

The default rule for future technical fields is `TECHNICAL_KNOWLEDGE`. Adding, removing, renaming, or assigning a unit to such a field must be data-driven and require no Ontology validator, dispatcher, task-controller, semantic-router, or entity-parser change. A knowledge item becomes functional only after an explicit business decision declares its functional role, source, validation, and compatibility/migration path; neither AI inference nor a field name can promote it.

## Stainless / non-stainless conditional policy

```text
PumpShell.isStainless = true
  → Recipe.barrelLength required
  → Recipe.openOffset required
  → Recipe.bearingSpan derived
  → explicit bearingSpan input prohibited or ignored as an authority

PumpShell.isStainless = false
  → barrelLength/openOffset stainless context not required
  → Recipe.bearingSpan required as an explicit final Fact
```

`isStainless` stays a PumpShell Fact and cross-entity policy discriminator. The Recipe technical profile owns its final technical facts and all target source-of-truth decisions.

## Current-to-target authority matrix

| 业务概念 | 当前存储 | 当前输入来源 | 当前 Rotor 使用方式 | 目标权威 | 类型 | 是否重复 | 后续动作 |
|---|---|---|---|---|---|---:|---|
| upper/lower bearing | technical JSON strings | static Rotor-code selector; Template/Shell fallback | Recipe JSON highest | Recipe→concrete Part relation | `RELATION_BACKED_FACT` | Yes | resolve/migrate safe IDs; retain code only as compatibility projection |
| piece count | coil sheets + technical JSON | UI auto-copy | Rotor reads JSON | Recipe Coil configuration | `DERIVED_FUNCTIONAL_FACT` | Yes | remove independent authority |
| rotor diameter | technical JSON | user/legacy Template | Rotor JSON map | Functional Technical Profile | `FUNCTIONAL_AUTHORITATIVE_FACT` | No direct column | migrate value |
| bearing span | JSON plus formula/fallbacks | user or Shell offset formula | JSON overrides | explicit non-stainless Fact; stainless derived Fact | `FUNCTIONAL_AUTHORITATIVE_FACT` / `DERIVED_FUNCTIONAL_FACT` | Yes | split conditional policy |
| stack / oil-seal / bore / span / thread | technical JSON plus legacy sources | user/compatibility | JSON map | Functional Technical Profile | `FUNCTIONAL_AUTHORITATIVE_FACT` | Yes across legacy | migrate source provenance |
| impeller thickness | column + JSON | user/Variant | JSON then column fallback | Functional Profile `impellerThickness` | `FUNCTIONAL_AUTHORITATIVE_FACT` | Yes | consolidate one fact |
| impeller model/outside diameter/blades | dedicated columns | user/Variant | not in current Rotor/BOM/cost map | Recipe Technical Knowledge | `TECHNICAL_KNOWLEDGE` | No JSON fixed key | preserve as flexible knowledge, not profile facts |
| barrel length | Recipe column + Variant | user/Variant | formula and BOM/cost | Functional Profile | `FUNCTIONAL_AUTHORITATIVE_FACT` plus BOM configuration use | Yes across preset | migrate column value |
| open offset | Shell remark | Shell UI/legacy | formula source | Functional Profile | `FUNCTIONAL_AUTHORITATIVE_FACT` | Yes legacy alias | add only in future migration |

## Recommended storage architecture

### Functional-profile versus knowledge split

| Domain | Canonical semantic storage recommendation | Search/index role |
|---|---|---|
| Functional Technical Profile | one Recipe-owned structured child resource with typed functional facts, canonical relation IDs, applicability, derivations, and provenance | may be projected to Knowledge, but the profile remains the only functional source of truth |
| Technical Knowledge | Recipe-owned extensible structured metadata collection plus formal technical-file/evidence relations | project to `knowledge_entries` / FTS / vector retrieval for AI-readable search and summaries |

The existing knowledge system already builds Recipe entries from `technicalDataJson` and `recipe_technical_files` and rebuilds FTS from `knowledge_entries`. It is suited to a derived search projection. It cannot be the canonical operational store: search indexes are not complete, strongly typed, transactionally aligned functional configuration, and must never be used to drive a drawing or cost decision.

### Options evaluated

| Option | Assessment |
|---|---|
| 1. Keep canonical `technical_data_json` | lowest migration cost, but weak typing, ambiguous keys/custom fields, no formal relation/provenance boundary, and already overlaps columns |
| 2. Add dedicated columns to `recipes` | good SQL typing for a stable small set, but couples evolving technical profile to BOM/cost aggregate and encourages another partial column/JSON split |
| 3. Dedicated structured functional-profile child resource | **recommended for functional data**: coherent validation, typed facts, relation IDs, provenance, derived declarations, extensibility and a single Rotor input boundary |
| 4. Hybrid strict ownership | recommended only as the two-domain model: functional child profile is canonical; flexible Recipe Technical Knowledge has its own non-functional ownership; existing columns/JSON are temporary projections. Otherwise it preserves duplicate authority |

The selected two-domain model may physically use typed functional child fields plus a controlled extensible knowledge collection, but its semantic rule is strict: each functional business concept has one profile-owned authority. Any duplicated aggregate column is a projection/cache with explicit provenance only; technical memo fields do not become profile facts simply because they are stored nearby.

### `openOffset` future representation

- **Current source:** `parts.remark.openOffset` or legacy `openFactor`.
- **Target source:** `RecipeTechnicalProfile.openOffset`, typed numeric Fact, required only if the bound PumpShell says `isStainless=true`.
- **Validation:** finite non-negative value; Recipe must have valid barrelLength; non-stainless profile must not use it to derive authoritative span.
- **Compatibility:** old saved Recipes retain source label `LEGACY_PUMPSHELL_COMPATIBILITY`; no new Recipe imports it as prefill under Option A.

### `bearingSpan` future representation

- **Non-stainless:** one explicit `RecipeTechnicalProfile.bearingSpan` Fact.
- **Stainless:** a computed `bearingSpan` projection from profile `barrelLength` and `openOffset`; do not persist an editable second value.
- **Current materialized JSON:** compatibility/cache only. If retained temporarily it must carry `DERIVED` provenance and cannot win over source facts.

## Rotor Drawing target contract

The target server boundary is conceptually:

```text
Recipe ID
  → load Recipe Final Technical Profile
  → validate conditional completeness
  → resolve formal technical relations
  → compute declared Derived Facts
  → project validated Rotor Drawing parameters
```

It must not scan Template params, ModelVariant values, PumpShell defaults or name heuristics for a completed Recipe. In particular, it must not treat a Recipe text value such as `6202` as the selected bearing's identity. Those sources can exist only before profile finalization or for an explicitly labelled old-record compatibility adapter.

## Provenance model

Every final or projected technical value should declare one of:

- `RECIPE_EXPLICIT`: explicit user/configuration value stored in the final Recipe profile.
- `RELATION_RESOLVED`: value projected from a formal related record, with relation ID/version.
- `DERIVED`: formula result with input fact IDs/versions.
- `PRESET_INITIALIZATION`: ModelVariant copied into unsaved/new Recipe; after save the Recipe value becomes `RECIPE_EXPLICIT` or provenance retains both origin and confirmation.
- `COMPATIBILITY_LEGACY`: read from old Recipe JSON, old Template params or old PumpShell fields.
- `UNRESOLVED`: legacy record lacks enough authoritative source data; Rotor Drawing must not silently promote a fallback.

For bearings, compatibility provenance additionally records the legacy source (`Recipe JSON code`, `PumpShell display default`, or `Template name heuristic`) and the resolution result. A successfully resolved Part relation becomes `RELATION_RESOLVED`; an ambiguous same-designation/supplier set remains `UNRESOLVED` until a concrete `parts.id` is chosen.

For Technical Knowledge, provenance says what document, user entry, legacy field, preset, or file supplied the information, but never upgrades that information into a functional authority. AI-facing wording must distinguish “技术资料记录显示 X” from “正式功能配置为 X”.

## Option A retirement plan — PumpShell technical fields

1. Define the Recipe Technical Profile and final completeness policy; no runtime switch yet.
2. New Recipe creation stops importing all historical PumpShell technical fields; only `isStainless` applies the Recipe policy.
3. Existing Recipes use a labelled compatibility adapter only when final profile facts are absent.
4. Audit legacy records, map safe values to Recipe facts/relations, and record provenance.
5. Compare old Rotor outputs with profile-derived outputs and resolve discrepancies.
6. Disable legacy PumpShell fallback for migrated/complete Recipes, then for all verified records.
7. Retire fields/UI/readers only in a separately approved migration and compatibility-removal release.

## Template rotor_params_json retirement plan

1. Classify every existing Template param as transitional compatibility data, not final authority.
2. New Recipe paths do not copy Template rotor values into final authority; user/approved Variant/Recipe clone supplies final facts.
3. Existing Recipes with missing profile facts can use a labelled Template compatibility adapter during audit.
4. Migrate or explicitly classify each value; compare Rotor results.
5. Stop Template fallback for complete/migrated Recipes.
6. Remove Template rotor consumption/storage only under a dedicated migration and runtime-change ticket.

## Ontology V2 fit and generic gaps

The desired semantics fit V2 concepts—Identity, Facts, Relations, Sources, Derived authority and policies—but current contract needs generic extensions before a Recipe production profile can faithfully declare them:

1. Part Base + Category Extension composition.
2. Conditional applicability/requiredness based on a relation-backed upstream fact.
3. Cross-entity policy: `PumpShell.isStainless → Recipe profile requirements/derivation`.
4. Relation-backed Fact declarations with canonical relation identity and display projection.
5. Derived Fact declaration with input provenance, invalidation and non-authoritative materialization semantics.
6. Compatibility-source policy that cannot silently outrank final facts.
7. Generic Technical Knowledge collection: arbitrary fields with provenance and searchable/readable projection, but no automatic functional authority or field-specific validator changes.

No Recipe-specific validator code should be introduced; these are generic contract capabilities.

## Design-only implementation phases

1. Owner/Supervisor approve final technical concepts, relation semantics and ModelVariant preset role.
2. Design generic Ontology contract extensions and Recipe profile metadata.
3. Design storage/API/DTO migration with source-of-truth and backward-compatibility tests.
4. Implement new Recipe profile and new-Recipe path without legacy Shell/Template prefill.
5. Migrate/audit old data, compare drawings, then retire compatibility in a separate release.
