# O4-E Recipe Functional + Technical Knowledge Profile

## Scope and no-runtime boundary

O4-E adds only immutable V2.1 contract declarations in `api/ontology/v2_1/entities/recipe.cjs`.  It adds no database migration, query, relation resolver, derivation evaluator, Rotor Drawing reader, API route, UI behavior, AI behavior, or write capability.  Every profile, relation, and Technical Knowledge collection remains `runtimeEnabled: false`; all sources state `storesValueInOntology: false`.

The contract captures current-safe Recipe semantics.  A target fact whose formal Recipe-owned storage does not yet exist is recorded as a gap rather than being populated from PumpShell, Template, Variant, name heuristics, or Rotor compatibility code.

## Identity, designation, and lifecycle

| Concept | Declaration | Current source | Boundary |
|---|---|---|---|
| Canonical identity | Recipe resource identity | `recipes.id -> recipeRow.id` | positive-integer primary key; no designation or relation replaces it |
| Name | `recipe.name`, `recipe.nameDesignation` | `recipes.name -> recipeRow.name` | searchable, non-unique designation; `collisionPolicy=REPORT`; non-canonical |
| Spec | `recipe.spec` | `recipes.spec -> recipeRow.spec` | minimal descriptive/candidate evidence, not identity |
| Lifecycle | `recipe.deletedAt` | raw `recipes.deleted_at` | lifecycle Fact; `recipeRow` does not currently project `deletedAt` |
| Provenance | `recipe.createdAt`, `recipe.updatedAt` | corresponding `recipes` columns through `recipeRow` | provenance only |

The Recipe profile uses `selectionPolicy=NONE`, `eligibilityPolicy=NONE`, and has no cost policy.  This preserves the current boundaries: `recipeBomEngine` constructs BOM and `costEngine` calculates cost.

## Formal current relations

```text
Recipe #recipes.id
  --recipe.uses_template--> Template #pump_shell_templates.id
  --recipe.uses_coil------> Coil #coils.id
```

| Relation | Current formal source | Endpoint | Cardinality | Why |
|---|---|---|---|---|
| `recipe.uses_template` | `recipes.template_id -> pump_shell_templates.id` | canonical Template ID | `ZERO_OR_ONE` | FK is nullable |
| `recipe.uses_coil` | `recipes.coil_id -> coils.id` | canonical Coil ID | `ZERO_OR_ONE` | FK is nullable |

No Coil relation is inferred from `coil_spec`/`coil_sheets` strings, and `model_variant_id` is not modeled as a relation because no ModelVariant entity profile exists in O4-E.  It remains future preset/provenance design work.

## Current-safe functional and configuration Facts

`recipe.technical_data_projection` is scoped narrowly to explicit saved `recipes.technical_data_json` values.  Its source declaration explicitly excludes PumpShell defaults/open offset, Template `rotor_params_json`, ModelVariant preset values, and name heuristics.

| Semantic Fact | Current source | Role | Current-safe authority |
|---|---|---|---|
| `recipe.coilSheets` | `recipes.coil_sheets -> recipeRow.coilSheets` | `BOM_INPUT`, `INTERNAL_CALCULATION` | persisted Recipe configuration snapshot; not live Coil drift |
| `recipe.pieceCount` | `COPY(recipe.coilSheets)` | derived functional / technical | derived, `COMPUTE_ON_READ`; JSON `pieceCount` is duplicate materialization only |
| `recipe.rotorDiameter` | `technical_data_json.rotorDiameter` | `FUNCTIONAL_TECHNICAL` | explicit saved Recipe value |
| `recipe.stackOffset` | `technical_data_json.stackOffset` | `FUNCTIONAL_TECHNICAL` | explicit saved Recipe value |
| `recipe.oilSealDiameter` | `technical_data_json.oilSealDiameter` | `FUNCTIONAL_TECHNICAL` | dimension Fact, not an invented Part relation |
| `recipe.impellerBoreDiameter` | `technical_data_json.impellerBoreDiameter` | `FUNCTIONAL_TECHNICAL` | distinct from outside diameter |
| `recipe.impellerSpan` | `technical_data_json.impellerSpan` | `FUNCTIONAL_TECHNICAL` | explicit saved Recipe value |
| `recipe.threadLength` | `technical_data_json.threadLength` | `FUNCTIONAL_TECHNICAL` | explicit saved Recipe value |
| `recipe.threadDiameter` | `technical_data_json.threadDiameter` | `FUNCTIONAL_TECHNICAL` | explicit saved Recipe value |
| `recipe.barrelLength` | `recipes.custom_barrel_length -> recipeRow.customBarrelLength` | `FUNCTIONAL_TECHNICAL`, `BOM_INPUT` | current Recipe column; semantic name deliberately does not copy historical column naming |
| `recipe.bearingSpan` | `technical_data_json.bearingSpan` | `FUNCTIONAL_TECHNICAL` | direct explicit Fact only for non-stainless configuration |
| `recipe.impellerThickness` | `technical_data_json.impellerDepth`, then `recipes.impeller_thickness` if JSON patch is absent | `FUNCTIONAL_TECHNICAL` | current deterministic Rotor projection; duplicate storage remains explicit migration gap |

The thickness projection is not a declaration that both storage locations are independent authorities.  `api/services/rotorTemplateDraft.cjs` maps JSON `impellerDepth` first and only uses dedicated `impeller_thickness` when the patch remains empty.  O4-F must converge this into one canonical physical representation.

## Stainless policy and bearing-span boundary

The V2.1 conditional path is formal and canonical-ID based:

```text
Recipe
  -> recipe.uses_template
  -> Template
  -> template.uses_shell_part
  -> Part
  -> targetExtensionId=part.pump_shell
  -> part.isStainless
```

Executable contract `FactRef`:

```js
{
  scope: 'RELATED',
  relationPath: ['recipe.uses_template', 'template.uses_shell_part'],
  factId: 'part.isStainless',
  targetExtensionId: 'part.pump_shell',
}
```

`recipe.barrelLength` is applicable and required when that Fact equals `true`.  `recipe.bearingSpan` is applicable and required when it equals `false`.  This is static contract validation only: a runtime evaluator must later distinguish an absent/non-applicable Extension Fact from `UNKNOWN_OR_UNRESOLVED`; O4-E never treats unresolved as false.

### Explicit target semantic gaps

| Gap ID | Why it remains a gap | O4-E safety result |
|---|---|---|
| `RECIPE_OPEN_OFFSET_STORAGE_MISSING` | no formal Recipe-owned persisted `openOffset`; current runtime reads historical PumpShell metadata | no `recipe.openOffset` Fact |
| `STAINLESS_BEARING_SPAN_DERIVATION_BLOCKED_BY_OPEN_OFFSET_STORAGE` | target formula needs Recipe `barrelLength - openOffset`; second input lacks formal Recipe storage | no resolved stainless `SUBTRACT` derivation |
| `RECIPE_UPPER_BEARING_PART_ID_STORAGE_MISSING` | JSON stores legacy `upperBearing` text/code, not a concrete Part ID | no formal `recipe.uses_upper_bearing` Relation |
| `RECIPE_LOWER_BEARING_PART_ID_STORAGE_MISSING` | JSON stores legacy `lowerBearing` text/code, not a concrete Part ID | no formal `recipe.uses_lower_bearing` Relation |
| `IMPELLER_THICKNESS_DUPLICATE_STORAGE` | JSON `impellerDepth` and dedicated `impeller_thickness` overlap | current projection is documented; storage remains unnormalized |

`6202` and related Rotor codes remain compatibility representations, not business bearing identity.  No bearing string Fact is promoted as a substitute for the missing canonical Part relation.  Likewise, no historical PumpShell `defaultXXX`, `openOffset`/`openFactor`, Template rotor parameters, Variant fallback, or shell-name heuristic becomes a Recipe functional source.

## Technical Knowledge boundary

The Recipe owns generic collection `recipe.technical_knowledge`:

- `allowsArbitraryKeys=true`, `searchable=true`, `aiReadable=true`;
- generic entry schema: `key`, `label`, `value`, with optional unit/type/provenance/version/evidence references;
- default classification `TECHNICAL_KNOWLEDGE` and no functional-policy fields.

The following are intentionally absent from Recipe Functional Facts and belong to this flexible Technical Knowledge domain: `rotorLength`, `shaftDiameter`, `impellerModel`, `impellerDiameter`, `impellerBladeCount`, `power`, `voltage`, `current`, `frequency`, `testReportNo`, `testDate`, `testSummary`, and arbitrary `customFields`.

Current physical storage remains mixed across `technical_data_json`, dedicated Recipe columns, and `recipe_technical_files`.  The collection declares semantic ownership only; it does not pretend that a dedicated knowledge resource exists.  `knowledge_entries`, FTS, vectors, and `knowledgeAutoSync` are derived searchable projections.  They are not functional or operational authority.  Technical files are supporting evidence, not Functional Facts.

## O4-F storage and migration requirements

O4-F must design, but not silently assume:

1. a formal Recipe-owned `openOffset` storage representation and migration/provenance plan;
2. stainless `bearingSpan = barrelLength - openOffset` as a derived/non-competing value;
3. canonical concrete Part-ID storage for upper and lower bearing relations, plus legacy 62xx/63xx adapter retirement;
4. one canonical storage representation for `impellerThickness` and compatibility comparison/retirement;
5. a physical split between typed Functional Technical Profile data and flexible Recipe Technical Knowledge, including evidence/file links;
6. runtime adapter and validation semantics for `NOT_APPLICABLE` versus `UNKNOWN_OR_UNRESOLVED` without reintroducing name or legacy fallback authority.
