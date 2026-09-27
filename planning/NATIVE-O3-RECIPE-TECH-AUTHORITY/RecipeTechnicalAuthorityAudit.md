# Recipe Technical Authority / Rotor Drawing Source-of-Truth Audit

> Status: audit/design only. Baseline `99546c0142ac1a2f76769b63d125efe62028075e`. No business DB was read or written. Owner decisions define target business truth; code below documents current storage and compatibility behaviour.

## Current storage inventory

`recipes` currently mixes several domains in one row (`api/database/schema.cjs:137-197`; `api/db.cjs:105-147`):

| Domain | Current storage | Classification |
|---|---|---|
| identity / lifecycle | `id`, naming, `name`, `spec`, timestamps, `deleted_at` | Recipe identity / metadata |
| formal relations | `template_id`, `coil_id`, `model_variant_id` | Relation |
| Coil configuration snapshot | `coil_spec`, `coil_sheets`, `coil_material`, `coil_slot_type`, `coil_wire_weight` | Recipe configuration; coil relation plus persisted compatibility/snapshot dimensions |
| final BOM / cost | `parts_json`, `extra_parts_json`, `packing_parts_json`, saved-cost fields, labour/management fields | BOM / cost, not rotor technical authority |
| dynamic configuration | float/cable fields, `custom_barrel_length`, `long_screw_extra_length`, `configuration_policy_json` | Recipe configuration; barrel length also technical/cost input |
| dedicated impeller fields | `impeller_model`, `impeller_thickness`, `impeller_diameter`, `impeller_blade_count` | Recipe technical fields, with one current overlap |
| technical profile | `technical_data_json` | mixed technical payload; final authority only after future normalization |

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
| `rotorLength` | numeric input | UI/detail only found | No | manual | none found | technical metadata | not a current Rotor contract input; retain only if business needs it |
| `shaftDiameter` | numeric input | UI/detail only found | No | manual | none found | technical metadata | Recipe Technical Fact if retained |
| `power`, `voltage`, `current`, `frequency` | inputs | UI/detail/knowledge | No | manual | Coil/config fields may be related, no direct map | technical metadata | Recipe performance/electrical facts, not rotor facts |
| `testReportNo`, `testDate`, `testSummary` | inputs/files | UI/detail/knowledge | No | manual | test-file resource | provenance/test metadata | separate test evidence domain |

The UI converts unknown JSON keys into custom fields for display (`technical-data.ts:187-195`); that is compatibility display, not an approved canonical technical schema.

## Dedicated technical columns versus JSON

| Business concept | Representation A | Representation B | Current readers / precedence | Target one authority |
|---|---|---|---|---|
| barrel length | `recipes.custom_barrel_length` | Variant `barrel_length`; historical Shell metadata | BOM: Recipe request/value → Variant; Rotor: Recipe value + Shell offset | Recipe `barrelLength` Fact; Variant only explicit preset |
| impeller depth / thickness | `recipes.impeller_thickness` | `technical_data_json.impellerDepth` | Rotor uses JSON first, dedicated column only if patch empty | one `impellerThickness` Recipe Fact; current column is best migration anchor, JSON is compatibility duplicate |
| impeller model | `recipes.impeller_model` | no fixed JSON key | UI/progress; not current Rotor map | Recipe Technical Fact/designation; relation remains unproven |
| impeller outside diameter | `recipes.impeller_diameter` | no fixed JSON key | UI/progress; not current Rotor map | Recipe Technical Fact if distinct from bore |
| impeller blade count | `recipes.impeller_blade_count` | no fixed JSON key | UI/progress; not current Rotor map | Recipe Technical Fact |
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
| impeller model | dedicated text string | no catalog identity is persisted; no Rotor map currently consumes it | keep Technical Fact/designation until evidence proves a formal Part relation; do not invent ID mapping |
| coil | `coil_id` plus snapshot dimensions | formal relation exists; dimensions can drift as snapshots | `Recipe --uses_coil--> Coil` plus explicitly labelled configured/snapshot facts |
| Template / Variant | IDs | formal relations exist | Template is structure relation; ModelVariant is preset provenance, not final authority |

## Derived fact audit

| Derived concept | Current behaviour | Target classification |
|---|---|---|
| stainless `bearingSpan` | UI computes `customBarrelLength - Shell openOffset` and writes JSON; server repeats formula then JSON may override | `DERIVED_FACT` from Recipe barrelLength/openOffset. Current JSON value is materialized compatibility/cache, not a second authority |
| non-stainless `bearingSpan` | current fallback chain may supply it | explicit Recipe Technical Fact; no length/offset derivation |
| `pieceCount` | recipe drawer copies `coilSheets` into JSON every open cycle | `DERIVED_FROM_RELATION` / Recipe Coil configuration; JSON copy is projection/cache |
| Rotor FC values | `buildFcParams()` derives bearing depths from fixed bearing catalogue, core length from piece count, total length from components | Rotor Drawing projection/derived output, not separate Recipe Facts unless a business decision says otherwise |

Evidence: `recipes-view.tsx:1100-1131`; `rotorTemplateDraft.cjs:194-217`; `rotorParameters.cjs:181-271`.

## Recipe UI inventory

| Field group | UI status | persistence / source |
|---|---|---|
| fixed technical fields and Rotor parameters | `VISIBLE_EDITABLE` in `TechnicalDataEditor` | `technical_data_json` |
| upper/lower bearing | `VISIBLE_EDITABLE` selector | string JSON, no Part ID |
| `pieceCount` | `AUTO_DERIVED_VISIBLE`, read-only as “跟随线圈片数” | UI materializes JSON from `coilSheets` |
| stainless `bearingSpan` | `AUTO_DERIVED_VISIBLE`, read-only when Shell offset exists | UI materializes JSON formula result |
| non-stainless `bearingSpan` | `VISIBLE_EDITABLE` | JSON |
| custom barrel length | visible only on stainless Recipe path | `custom_barrel_length` |
| impeller model/thickness/diameter/blade count | `VISIBLE_EDITABLE` | dedicated Recipe columns |
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
| impeller technical fields | Recipe technical authority | no verified current BOM/cost formula consumer in inspected services |

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
