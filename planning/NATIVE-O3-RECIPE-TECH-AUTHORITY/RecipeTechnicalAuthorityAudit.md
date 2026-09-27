# Recipe Technical Authority / Rotor Drawing Source-of-Truth Audit

> Status: audit/design only. R1 bearing-relation correction reviewed from baseline `eeb5a8868b0613ed30425f95a4cec10344aa543a`. No business DB was read or written. Owner decisions define target business truth; code below documents current storage and compatibility behaviour.

## Current storage inventory

`recipes` currently mixes several domains in one row (`api/database/schema.cjs:137-197`; `api/db.cjs:105-147`):

| Domain | Current storage | Classification |
|---|---|---|
| identity / lifecycle | `id`, naming, `name`, `spec`, timestamps, `deleted_at` | Recipe identity / metadata |
| formal relations | `template_id`, `coil_id`, `model_variant_id` | Relation |
| Coil configuration snapshot | `coil_spec`, `coil_sheets`, `coil_material`, `coil_slot_type`, `coil_wire_weight` | Recipe configuration; coil relation plus persisted compatibility/snapshot dimensions |
| final BOM / cost | `parts_json`, `extra_parts_json`, `packing_parts_json`, saved-cost fields, labour/management fields | BOM / cost, not rotor technical authority |
| dynamic configuration | float/cable fields, `custom_barrel_length`, `long_screw_extra_length`, `configuration_policy_json` | Recipe configuration; barrel length also technical/cost input |
| dedicated impeller fields | `impeller_model`, `impeller_thickness`, `impeller_diameter`, `impeller_blade_count` | mixed storage: thickness is functional compatibility data; model/outside diameter/blades are Technical Knowledge |
| technical profile | `technical_data_json` | mixed current storage for functional fields, compatibility values, and Technical Knowledge; it is not a single future canonical authority |

`technical_data_json` must not be treated as permanently canonical merely because it exists today. It is a current adapter/storage source to map to future Recipe facts.

## technical_data_json inventory

The current UI parser/editor has **21 fixed keys** (`apps/web-next/lib/technical-data.ts:1-217`); UI custom fields may hold additional non-fixed text. The server rotor map consumes only the 12 marked **Rotor=Yes** (`api/services/rotorTemplateDraft.cjs:170-211`).

| Key | Current writer / visible UI | Current reader | Rotor | Manual / derived | Duplicate | Current source status | Target authority |
|---|---|---|---:|---|---|---|---|
| `upperBearing` | selector | Rotor map | Yes | manual text selection | PumpShell/Template strings | Recipe JSON highest current layer | Recipe relation-backed Fact |
| `lowerBearing` | selector | Rotor map | Yes | manual text selection | PumpShell/Template strings | Recipe JSON highest current layer | Recipe relation-backed Fact |
| `pieceCount` | auto-synced from `coilSheets` | Rotor map | Yes | auto-derived in UI | `coil_sheets` | materialized duplicate | Derived from Recipe Coil configuration |
| `rotorDiameter` | numeric input | Rotor map | Yes | manual | Template params | Recipe JSON | Recipe Technical Fact |
| `bearingSpan` | numeric/read-only linked input | Rotor map | Yes | explicit non-stainless; auto-derived stainless | Shell/Template/Variant plus formula | JSON overrides chain | explicit Fact non-stainless; Derived stainless |
| `stackOffset` | numeric input | Rotor map | Yes | manual | Shell/Template | Recipe JSON | Recipe Technical Fact |
| `oilSealDiameter` | numeric input | Rotor map | Yes | manual | Shell/Template heuristic | Recipe JSON | Recipe Technical Fact |
| `impellerBoreDiameter` | numeric input | Rotor map | Yes | manual | Shell/Template | Recipe JSON | Recipe Technical Fact |
| `impellerSpan` | numeric input | Rotor map | Yes | manual | Shell/Template | Recipe JSON | Recipe Technical Fact |
| `impellerDepth` | numeric input | Rotor map | Yes | manual | `impeller_thickness`, Shell/Template | JSON then column fallback | one Recipe thickness Fact; JSON current source is duplicate |
| `threadLength` | numeric input | Rotor map | Yes | manual | Shell/Template | Recipe JSON | Recipe Technical Fact |
| `threadDiameter` | numeric input | Rotor map | Yes | manual | Shell/Template | Recipe JSON | Recipe Technical Fact |
| `rotorLength` | numeric input | UI/detail only found | No | manual | none found | technical metadata | `TECHNICAL_KNOWLEDGE` |
| `shaftDiameter` | numeric input | UI/detail only found | No | manual | none found | technical metadata | `TECHNICAL_KNOWLEDGE` |
| `power`, `voltage`, `current`, `frequency` | inputs | UI/detail/knowledge | No | manual | Coil/config fields may be related, no direct map | technical metadata | `TECHNICAL_KNOWLEDGE` |
| `testReportNo`, `testDate`, `testSummary` | inputs/files | UI/detail/knowledge | No | manual | test-file resource | provenance/test metadata | `TECHNICAL_KNOWLEDGE` plus supporting-evidence relation |

The UI converts unknown JSON keys into custom fields for display (`technical-data.ts:187-195`); that is compatibility display, not an approved canonical technical schema.

## Dedicated technical columns versus JSON

| Business concept | Representation A | Representation B | Current readers / precedence | Target one authority |
|---|---|---|---|---|
| barrel length | `recipes.custom_barrel_length` | Variant `barrel_length`; historical Shell metadata | BOM: Recipe request/value → Variant; Rotor: Recipe value + Shell offset | Recipe `barrelLength` Fact; Variant only explicit preset |
| impeller depth / thickness | `recipes.impeller_thickness` | `technical_data_json.impellerDepth` | Rotor uses JSON first, dedicated column only if patch empty | one `impellerThickness` Recipe Fact; current column is best migration anchor, JSON is compatibility duplicate |
| impeller model | `recipes.impeller_model` | no fixed JSON key | UI/progress; not current Rotor map | `TECHNICAL_KNOWLEDGE`; never a Part relation or functional input |
| impeller outside diameter | `recipes.impeller_diameter` | no fixed JSON key | UI/progress; no inspected Rotor/BOM/cost consumer | `TECHNICAL_KNOWLEDGE`, distinct from functional bore diameter |
| impeller blade count | `recipes.impeller_blade_count` | no fixed JSON key | UI/progress; no inspected Rotor/BOM/cost consumer | `TECHNICAL_KNOWLEDGE` |
| impeller bore diameter | no dedicated column | `technical_data_json.impellerBoreDiameter` | Rotor map | Recipe Technical Fact |
| piece count | `recipes.coil_sheets` | `technical_data_json.pieceCount` | UI copies coil sheets; Rotor reads JSON | derive from final Recipe Coil configuration; remove independent authority |
| stainless span | `custom_barrel_length` + current Shell offset | materialized `technical_data_json.bearingSpan` | formula then JSON overlay | derive from Recipe `barrelLength + openOffset`; no independent authoritative stored span |

`impellerDiameter` and `impellerBoreDiameter` are currently distinct labels (outside diameter versus hole diameter) and are not treated as a duplicate by this audit. Their names must remain distinct in future API/design.

## Relation-backed field audit

| Concept | Current representation | Identity risk | Target recommendation |
|---|---|---|---|
| upper bearing | `technical_data_json.upperBearing` string; UI uses static bearing options | no Part ID; normalizer strips model suffixes; duplicate catalog models cannot be represented safely | `Recipe --uses_upper_bearing--> Part` plus display projection; retain legacy string only for compatibility |
| lower bearing | same | same | `Recipe --uses_lower_bearing--> Part` |
| oil seal | numeric hole diameter, Template model heuristic | not an actual selected Part relation today | retain dimension Fact unless a later Recipe BOM relation is explicitly selected |
| impeller model | dedicated text string | no catalog identity is persisted; no Rotor map currently consumes it | `TECHNICAL_KNOWLEDGE`; never invent a Part relation or functional Fact |
| coil | `coil_id` plus snapshot dimensions | formal relation exists; dimensions can drift as snapshots | `Recipe --uses_coil--> Coil` plus explicitly labelled configured/snapshot facts |
| Template / Variant | IDs | formal relations exist | Template is structure relation; ModelVariant is preset provenance, not final authority |

## R2 final semantic split — functional configuration versus technical knowledge

Owner has closed the semantic boundary: a technical field is not functional merely because it is displayed in `TechnicalDataEditor`, has a dedicated column, or was historically read by a fallback. It is functional only when it drives Rotor Drawing or another explicit business function. All other technical/archive information defaults to `TECHNICAL_KNOWLEDGE`.

| Domain | Final concepts | Current evidence / target rule |
|---|---|---|
| `FUNCTIONAL_AUTHORITATIVE_FACT` | `rotorDiameter`, non-stainless `bearingSpan`, `stackOffset`, `oilSealDiameter`, `impellerBoreDiameter`, `impellerSpan`, `impellerThickness`, `threadLength`, `threadDiameter`, stainless `barrelLength`, stainless `openOffset` | current `recipeTechnicalRotorMap` maps every listed Rotor dimension except `barrelLength`; `barrelLength` also participates in BOM/cost and stainless span. `openOffset` is target Recipe authority but is currently read only from legacy Shell compatibility metadata. |
| `RELATION_BACKED_FACT` | `uses_upper_bearing`, `uses_lower_bearing`, `uses_coil`, `uses_template` | bearings must bind concrete `parts.id`; Coil drives configured sheets/piece count and BOM; Template provides structure, never final Rotor authority. |
| `DERIVED_FUNCTIONAL_FACT` | stainless `bearingSpan`; `pieceCount`; Rotor FC projections | span is `barrelLength - openOffset`; piece count derives from final Recipe Coil configuration; neither is independent editable authority. |
| `BOM_CONFIGURATION_FACT` | configured Coil snapshot/selection, `longScrewExtraLength`, float/cable/packing configuration, BOM part selections; `barrelLength` where length pricing applies | these remain separate from the Rotor profile even when a fact (notably `barrelLength` or Coil sheets) has both a technical and cost consumer. |
| `TECHNICAL_KNOWLEDGE` | `rotorLength`, `shaftDiameter`, `impellerModel`, `impellerDiameter`, `impellerBladeCount`, `power`, `voltage`, `current`, `frequency`, `testReportNo`, `testDate`, `testSummary`, custom fields and future non-functional technical fields | readable/searchable technical information with no automatic Drawing, BOM, cost, identity, selection, policy, requiredness, or write side effect. |

### Exact current Rotor functional inputs

`api/services/rotorTemplateDraft.cjs:170-217` is the current server-side Recipe contract. The direct Recipe JSON inputs are `upperBearing`, `lowerBearing`, `pieceCount`, `rotorDiameter`, `bearingSpan`, `stackOffset`, `oilSealDiameter`, `impellerBoreDiameter`, `impellerSpan`, `impellerDepth`, `threadLength`, and `threadDiameter`. The current implementation treats both bearing values as legacy code strings, not relations; R1 freezes their target replacement as concrete Part relations.

`recipes.impeller_thickness` is a compatibility fallback only when JSON `impellerDepth` is absent. These two storage values describe the same functional Rotor thickness concept; the target has exactly one Fact named `impellerThickness`. `impellerDiameter` (outside diameter) and `impellerBladeCount` are only persisted, initialized from a Variant, and shown in UI/progress in the inspected code. No Rotor, `recipeBomEngine`, or `costEngine` reader was found, so both are `TECHNICAL_KNOWLEDGE`; they are not merged with `impellerBoreDiameter`.

### Technical Knowledge default and promotion rule

Technical Knowledge is a flexible Recipe-owned documentation/evidence collection. A field may carry a stable key/id, label, value, unit, source/provenance, and update/version metadata, but it has **no functional authority by default**. Normal additions, removals, label changes, temporary measurements, engineering comments, customer requirements, and test annotations are data-definition changes—not validator, router, parser, or entity-code changes.

```text
TECHNICAL_KNOWLEDGE
        │ explicit later business decision + explicit mapping/migration
        ▼
FUNCTIONAL_AUTHORITATIVE_FACT / RELATION_BACKED_FACT /
DERIVED_FUNCTIONAL_FACT / POLICY_INPUT
```

Promotion is never inferred from text, AI interpretation, UI placement, or the existence of a column. It requires a later business decision, declared functional behavior, and an explicit compatibility/migration plan.

## Bearing relation correction — business identity versus legacy Rotor code

Owner has corrected the earlier ambiguity: a bearing selected by a Recipe is a **concrete Part catalog record**, not a Rotor code. `parts.id` is its canonical identity. `轴承-202` is a catalog designation/display value; `6202` is only the legacy Rotor representation used by the current drawing path.

### Verified current conversion chain

```text
CURRENT
Recipe technical_data_json.upperBearing = "6202"
        ↓ normalizeBearing()
legacy Rotor code "6202"
        ↓ BEARING_DB["6202"]
hard-coded diameter/depth projection for Rotor Drawing

Catalog Part #X, model "轴承-202"
        ↓ bearingCodeOf()
catalog code "202"
        ↓ (legacy Rotor adapter: three digits gain leading "6")
legacy Rotor code "6202"
```

Evidence: `apps/web-next/lib/rotor.ts:95` supplies the current code-only selector; `apps/web-next/components/technical-data-editor.tsx:355-362` persists that selection into Recipe technical JSON; `api/services/rotorParameters.cjs:1-9,70-81,190-210` normalizes and looks up the geometry. `api/services/catalogSpec.cjs:15-19` reads `naming.spec.code` for bearing catalog Parts and strips a leading `6` from legacy four-digit codes. `api/services/catalogNamingCandidates.cjs:8-14` proposes `轴承-<three-digit-code>` for historical numeric bearing names.

The currently supported `BEARING_DB` keys are `6201`, `6202`, `6203`, `6204`, `6205`, `6303`, and `6304`. Under the verified catalog convention they project respectively to designations `轴承-201`, `轴承-202`, `轴承-203`, `轴承-204`, `轴承-205`, `轴承-303`, and `轴承-304`. This is a naming/adapter convention—not proof that a Rotor code is a separate business entity or that a matching catalog Part exists for every code.

### Current versus target bearing model

| Concern | Current implementation | Target business authority |
|---|---|---|
| Recipe upper/lower bearing storage | `technical_data_json.upperBearing/lowerBearing` strings from a static 62xx/63xx selector | `Recipe --uses_upper_bearing--> Part` and `Recipe --uses_lower_bearing--> Part` |
| Canonical identity | absent from the Recipe bearing strings | concrete `parts.id` |
| Business designation | may be normalized from text such as `轴承-202` | Part model/naming projection, never canonical ID |
| Rotor code | `normalizeBearing()` returns a 62xx/63xx string | `LEGACY_ROTOR_BEARING_CODE` compatibility projection only |
| Geometry source | hard-coded `BEARING_DB` diameter/depth constants | a shared bearing-specification/reference-engineering projection resolved from the selected Part |

`BEARING_DB` is therefore current **engineering reference data**, not a business identity authority. The inspected Part schema, catalog naming profile, and Recipe JSON do not provide a formal Part-owned bearing geometry source to the Rotor path today. No assertion is made that the constants are the only occurrence of those dimensions elsewhere; the conclusion is limited to the current Rotor conversion path.

### Concrete supplier Part versus shared engineering specification

A Recipe must bind the concrete selected catalog Part ID even when two active Parts share `轴承-202` but have different suppliers. Supplier/material selection is a business relation and cannot safely be recovered from `202` or `6202`. Their common engineering dimensions should instead be owned by a shared bearing specification profile or reference engineering catalog, which the selected Part can project to. That shared specification is not a second business canonical identity and must not reclassify `6202` as one.

`partCatalogReferences.cjs:4-21` already demonstrates the distinction for historical PumpShell defaults: an explicit `default*BearingPartId` is checked as one active bearing Part; a text-only value is resolved by catalog code only if exactly one candidate exists. The Rotor fallback still reads the display string and normalizes it, so both PumpShell defaults and Template part-name heuristics remain compatibility/transitional sources—not Recipe authority.

## Derived fact audit

| Derived concept | Current behaviour | Target classification |
|---|---|---|
| stainless `bearingSpan` | UI computes `customBarrelLength - Shell openOffset` and writes JSON; server repeats formula then JSON may override | `DERIVED_FACT` from Recipe barrelLength/openOffset. Current JSON value is materialized compatibility/cache, not a second authority |
| non-stainless `bearingSpan` | current fallback chain may supply it | explicit Recipe Technical Fact; no length/offset derivation |
| `pieceCount` | recipe drawer copies `coilSheets` into JSON every open cycle | `DERIVED_FROM_RELATION` / Recipe Coil configuration; JSON copy is projection/cache |
| Rotor FC values | `buildFcParams()` derives bearing depths from fixed legacy `BEARING_DB`, core length from piece count, total length from components | Rotor Drawing projection/derived output. Future bearing geometry is projected after resolving the selected bearing Part relation, not from a Recipe code string |

Evidence: `recipes-view.tsx:1100-1131`; `rotorTemplateDraft.cjs:194-217`; `rotorParameters.cjs:181-271`.

## Recipe UI inventory

| Field group | UI status | persistence / source |
|---|---|---|
| fixed technical fields and Rotor parameters | `VISIBLE_EDITABLE` in `TechnicalDataEditor` | `technical_data_json` |
| upper/lower bearing | `VISIBLE_EDITABLE` selector | legacy string JSON, no Part ID; target is relation-backed functional configuration |
| `pieceCount` | `AUTO_DERIVED_VISIBLE`, read-only as “跟随线圈片数” | UI materializes JSON from `coilSheets` |
| stainless `bearingSpan` | `AUTO_DERIVED_VISIBLE`, read-only when Shell offset exists | UI materializes JSON formula result |
| non-stainless `bearingSpan` | `VISIBLE_EDITABLE` | JSON |
| custom barrel length | visible only on stainless Recipe path | `custom_barrel_length` |
| impeller model/diameter/blade count | `VISIBLE_EDITABLE` | dedicated Recipe columns but `TECHNICAL_KNOWLEDGE`, not functional authority |
| impeller thickness | `VISIBLE_EDITABLE` | dedicated Recipe column; functional compatibility duplicate of JSON `impellerDepth` |
| `openOffset` | `NOT_CURRENT_UI` as Recipe input; only shown as Shell reference | current reader is PumpShell compatibility metadata |
| custom technical fields | `VISIBLE_EDITABLE` | JSON custom field array; no Rotor mapping |
| old PumpShell default fields | references/fallback, not Recipe inputs | compatibility only |

## Create, edit, clone, Template, Variant flows

| Flow | Current technical initialization | Persisted / override status | Target status |
|---|---|---|---|
| blank Recipe | empty technical JSON and dedicated technical fields | user fills fields | allowed |
| create from Template | template default-recipe response sets Template/cost skeleton; form clears dedicated impeller fields; Rotor Draft still has Template/Shell compatibility fallbacks | user can enter Recipe fields | Template technical values must not become future new-Recipe prefill |
| create from ModelVariant | `getModelVariantDraft()` provides template, coil, barrelLength, long screw, impeller columns | values enter Recipe form and persist on save; user can override | approved explicit preset source, never final authority after save |
| edit existing Recipe | `formFromRecipe()` loads existing JSON and columns | editing preserves existing Recipe facts | allowed |
| clone Recipe | `startClone()` copies all form values/technical JSON and BOM selections, clears name and `variantId` | copied values become the new Recipe candidate | allowed: Recipe-to-Recipe clone, with provenance to source Recipe |
| product creation from new Template | uses same create-from-Template flow | same as Template path | transitional; no Shell technical prefill for future target |

Evidence: `useRecipeDraft.ts:75-289`; `recipes-view.tsx:1205-1280,1730-1736`; `recipeQueries.cjs:429-473`.

## Current Rotor Drawing reader map

`rotorQueries.buildRecipeRotorDraft()` loads the saved Recipe, linked Template, optional ModelVariant and active Parts, then calls `buildRotorRecipeDraft()` (`api/services/rotorQueries.cjs:42-95`). Current low→high source order is:

```text
Template part-name/model heuristic
  → Template rotor_params_json
  → PumpShell defaultXXX / openOffset compatibility
  → ModelVariant barrelLength derived span
  → Recipe customBarrelLength derived span
  → Recipe technical_data_json
  → dedicated Recipe impellerThickness only if patch remains empty
```

This is current compatibility behaviour, not the target contract. `rotorParameters.buildFcParams()` then projects normalized bearing and FC parameters for drawing generation.

## Cost/BOM interaction

| Concept | Technical authority target | Current cost/BOM consumer |
|---|---|---|
| barrelLength | Recipe Technical Fact | `recipeBomEngine` length-priced shell/components and `costEngine` long-screw/length pricing |
| isStainless | PumpShell policy discriminator | selects stainless shell path in BOM engine |
| longScrewExtraLength | Recipe BOM/configuration Fact, not Rotor technical fact | BOM/cost dynamic rule |
| Coil relation / sheets | Recipe configured Coil relation/facts; pieceCount derived | Coil BOM/cost and Rotor pieceCount projection |
| impeller functional dimensions (`impellerBoreDiameter`, `impellerSpan`, `impellerThickness`) | Functional Technical Profile | no verified current BOM/cost formula consumer in inspected services; `impellerModel`/outside diameter/blade count remain Technical Knowledge |

No cost arithmetic belongs in future Ontology; `recipeBomEngine` and `costEngine` retain their runtime boundaries.

## Current versus target authority diagram

```text
CURRENT
PumpShell defaults ─┐
Template params ───┼─> Rotor Draft fallback chain
ModelVariant ──────┤
Recipe JSON ───────┤
Recipe columns ────┘

TARGET
PumpShell.isStainless
        │
        v
Template relation / structure
        │
        v
Recipe Final Technical Profile
  ├── authoritative Facts
  ├── formal Relations
  └── Derived Facts
        │
        v
Rotor Drawing
```

## Legacy status

By Owner Option A, all historical PumpShell technical fields except `isStainless` are **COMPATIBILITY ONLY**. They are not approved prefill for new Recipes. `pump_shell_templates.rotor_params_json` is also transitional/compatibility only. The target new-Recipe path must initialize technical authority from explicit user input, approved ModelVariant preset, or Recipe clone—not old Shell/Template rotor data.

The same rule applies to current Rotor bearing representations: Recipe JSON `upperBearing/lowerBearing`, static `bearingOptions`, `BEARING_DB`, PumpShell display-name defaults, and Template name heuristics are compatibility implementation layers. They must not become future bearing business identity or prefill authority for a newly created Recipe. A legacy record may be adapted only when its bearing text/code resolves safely to one concrete catalog Part; ambiguous cases require explicit selection rather than guessing.

## Knowledge and indexing boundary

The repository already has a useful **derived retrieval** path: `knowledgeAutoSync.cjs:3-17` schedules `recipes` and `recipe_technical_files`; `knowledge.cjs:178-235` creates one Recipe knowledge entry that includes `technicalDataJson` and searchable technical-file text; `knowledge.cjs:718-728,1000-1024` rebuilds and queries `knowledge_entries_fts`. Recipe technical files are formal evidence resources linked by `recipe_technical_files`, and their parsed report information is separately available to the AI read path.

This demonstrates that future Recipe Technical Knowledge can be indexed and answered by AI. It must **not** make the search index canonical: FTS/vector retrieval may be stale, partial, lossy, or ranked. The recommended future arrangement is Recipe-owned structured Technical Knowledge as canonical metadata plus formal file/evidence relations, with `knowledge_entries`/FTS as a derived searchable projection. AI must say “技术资料记录显示 X” for knowledge and reserve “正式功能配置 X” for the Functional Technical Profile.

## O3 Owner review closure

The Owner decisions are now closed: `impellerModel`, `rotorLength`, `shaftDiameter`, performance fields, test metadata, and future non-functional technical fields are `TECHNICAL_KNOWLEDGE`; old Shell/Template technical values remain compatibility only; functional configuration is limited to explicit Rotor/BOM facts, relations, and derivations. No remaining business ambiguity was found in the reviewed sources. O3 is ready to close as PASS and proceed to generic Ontology contract design—not runtime or storage implementation.
