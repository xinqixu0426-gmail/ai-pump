# M4-1A — Company Business Model V1

**Status:** Owner-review candidate; not a runtime, Ontology, Domain Policy, or Business API authority.
**Audited scope:** core product domain only.
**Repository baseline:** `e51f67e3ee1fb1a184984091eff8e5c1a04473c2` on `ai-native/m3-optimization-v1`.
**No product behavior was changed by this audit.**

## 1. Scope and authority

This is the minimum product-domain model a new manufacturing engineer needs in order to interpret the factory's current code safely. It covers only COIL, STATOR, COIL_SCHEME, TEMPLATE, RECIPE, BOM, PART, and FINISHED_PUMP. Customer, quotation, order, procurement, file, knowledge, and workflow semantics remain deliberately out of scope.

When sources disagree, this document follows this order:

1. Current formal Business Code and Business API behavior.
2. Current database schema and migrations.
3. Current active Ontology contract.
4. Current Domain Policy.
5. Current active domain documentation.

`company-business-model-v1.candidate.json` is the machine-readable companion. It records only evidence-backed statements; its `UNRESOLVED` entries are questions, not formal facts.

## 2. Golden concept: `12-120`

`12-120` is a **common coil designation**, constructed as `coils.spec + '-' + coils.sheets`; it is not the canonical identity of a coil scheme.

| Question | Evidence-backed answer |
| --- | --- |
| What is `12`? | The stored/common specification designation. Current formal normalization maps `spec === '12'` to a 120 mm standard stator diameter. |
| What is `120`? | `coils.sheets`: the positive sheet count of the winding scheme. |
| Relation to 120 mm | They are different facts. `12` is the common name mapped to `diameterMm = 120`; `120` after the hyphen is sheet count. |
| Is `120` power? | No. Formal fields for electrical ratings are `rated_voltage_v` and `rated_frequency_hz`; `sheets` is explicitly a sheet-count field. |
| Is `120` inventory? | No. Coil on-hand inventory is `coils.stock`, represented as `coilRow.stock`. |
| Is `12-120` unique? | No. The active Ontology marks the designation non-unique and allows collisions. |
| Why can it name several official schemes? | Different formal schemes can share a stator variant and sheet count while differing in electrical, market, winding, or cost attributes. The schema permits multiple official schemes and at most one default in the relevant scope. |
| What resolves a scheme? | `coils.id` is canonical DB identity; `scheme_code` is the stable scheme code. Explicit scheme attributes/selection can also constrain a candidate set. |

**Primary evidence:**

- `api/services/coilCost.cjs` — `normalizeCoilSpec`, `normalizeCoilDimensions`, `calculateCoilCost`.
- `api/database/schema.cjs` — `stator_variants.diameter_mm`; `coils.sheets`, `stock`, `scheme_code`, lifecycle and electrical fields.
- `api/ontology/v2/entities/coil.cjs` — `coil.commonDesignation`, canonical identity, selection policy.
- `docs/coil-domain.md` — sections **定子组合**, **绕组方案**, and **成本匹配**.

## 3. Core glossary

### STATOR / 定子组合

**Definition.** A physical stator variant uniquely determined by `diameterMm + material + slotType`. In storage this is `stator_variants` with a uniqueness constraint over `diameter_mm`, `material`, and `slot_type`.

**Not a stator:** a winding scheme, a coil inventory item, a part catalogue item, or a finished pump.

**Identity and attributes.**

- **Identity:** `stator_variants.id`; physical selection tuple `diameter_mm`, `material`, `slot_type`.
- **Display/alias:** `common_name` (the current docs explicitly say it does not participate in physical-specification judgement).
- **Design attributes:** standard diameter, material (`钢带` / `冷轧`), slot type (`小眼` / `国标眼`).

**Evidence:** `api/database/schema.cjs` (`stator_variants`); `docs/coil-domain.md` §1 定子组合; `api/services/coilCommands.cjs` (`normalizeSchemeInput`).

### COIL_SCHEME / 绕组方案（正式线圈方案）

**Definition.** A formal winding/rotor scheme belonging to a stator variant. It carries sheet count, lifecycle, technical record, pricing mode, current stock, and selection metadata. The source table is `coils`.

**Not a coil scheme:** merely `12-120`; an ordinary `parts` record; or a stator by itself.

**Identity classification.**

- **Canonical identity:** `coils.id`.
- **Stable business scheme identity:** `coils.scheme_code` (migration 70 gives it a unique index).
- **Common designation:** `spec-sheets`, non-unique by active Ontology contract.
- **Selection attributes:** `scheme_status`, `is_default`, `scheme_family_code`; explicit `schemeCode`, material, slot type, voltage and frequency may narrow a formal candidate set.

**Attribute classification.**

| Classification | Fields |
| --- | --- |
| Design | `sheets`, material, slot type, `scheme_family_code` for family-based calculated matching |
| Technical | `rated_voltage_v`, `rated_frequency_hz`, `market`, main/auxiliary wire gauge and data |
| Cost | `pricing_mode`, `kit_price`, `unit_price`, `wire_weight`, `copper_base`, `coil_fee`, `rotor_fee`, calculated/current cost |
| Selection | `scheme_status`, `is_default`, `scheme_code`, `scheme_family_code` |
| Display/alias | `spec`, `scheme_name`, common designation |

**Evidence:** `api/database/schema.cjs` (`coils`); `api/services/coilCost.cjs` (`calculateStoredCoilCost`, `calculateCoilCost`); `api/ontology/v2/entities/coil.cjs` (`facts`, `coil.commonDesignation`, `selectionPolicy`); `docs/coil-domain.md` §§1–2.

### COIL / 线圈转子

In current business code, **COIL** is the business-facing inventory and costing object represented by a formal `COIL_SCHEME` record. `buildRecipeBomDraft` emits this as a `线圈转子` BOM row, with `inventoryType: 'coil'` only when a concrete `coilId` was formally selected. It has distinct stock (`coils.stock`) and is expressly not part of ordinary Part inventory.

**Evidence:** `api/services/recipeBomEngine.cjs` (`buildRecipeBomDraft`); `api/db.cjs` (`coilRow`); `docs/business-flow.md` §7.1.

### TEMPLATE / 泵壳模板

**Definition.** A reusable pump-shell structure/configuration in `pump_shell_templates`. It describes `shellModel`, fixed parts, shell components, rotor parameters, configuration policy, and cost settings.

**Why it is not a Recipe.** A template supplies reusable shell/fixed structure. It does not bind the full product-specific coil/configuration set and is not itself a saved complete product BOM. A Recipe uses a Template, then adds/selects product-level configuration and expands a final BOM.

**Contents and costs.**

- `parts_json`: template fixed parts.
- `shell_components_json`: reusable shell-component rows; command validation limits included rows to the `泵壳搭配` Part category in component mode.
- `cost_mode='components'`: component rows are costed from their catalogue/manual values.
- `cost_mode='bundle'`: a bound pump-shell Part and `bundle_cost` represent the shell bundle.
- A template can bind at most one shell Part in `catalog_template_shell_bindings`; an existing template may have no binding.

**Cardinality.** `recipes.template_id` is a nullable FK, so multiple recipes can reference one template at schema level. This is confirmed as a data-model relationship, not a claim about how the Owner names templates in daily work.

**Evidence:** `api/database/schema.cjs` (`pump_shell_templates`, `recipes.template_id`); `api/services/templateQueries.cjs` (`buildTemplateCostParts`); `api/services/templateCommands.cjs` (`validateShellComponents`, `validateTemplatePartReferences`); `api/ontology/v2_1/entities/template.cjs`.

### RECIPE / 配方

**Definition.** A named, persisted, production-facing product configuration. It can bind a template and a concrete coil scheme, carries product-level configuration and technical fields, and stores formal saved BOM and cost snapshots after the authoritative save-draft path rebuilds them.

**Five distinct aspects—do not merge them.**

| Aspect | Current authority |
| --- | --- |
| Recipe identity | `recipes.id`; `recipes.name` is a non-unique designation in Ontology |
| Recipe configuration | template, coil selection, float, cable, packing, optional parts, barrel/impeller and applicable settings in `recipes` |
| Recipe technical profile | `technical_data_json` plus explicitly modeled technical fields; formal technical profile remains the authority |
| Recipe BOM | authoritative expansion persisted as `recipes.parts_json` on formal save |
| Cost | `saved_total_cost`/details are save-time snapshots; current rebuild is a different formal calculation |

**Inheritance and preservation.** `applyRecipeBaseline` starts from a stored recipe baseline and applies only explicit overrides. It deletes inherited coil identity/family/weight where a changed coil makes them unsafe to retain. This is why changing one configuration input must not discard unmentioned product configuration.

**Preview vs persisted mutation.** A temporary configuration preview recalculates a scenario through formal preview paths and does not change stored Recipe data. A persisted recipe change goes through a formal save payload/preflight and protected confirmation. The Domain Policy describes this behavior; `recipeCommands` implements the authoritative rebuilt save payload.

**Evidence:** `api/database/schema.cjs` (`recipes`); `api/services/recipeCommands.cjs` (`buildRecipeSavePayloadDraft`); `api/services/recipeConfigurationBaseline.cjs` (`applyRecipeBaseline`); `api/ontology/v2_1/entities/recipe.cjs`; `api/services/ai-assistant/domain-policy.md` RULE-01.

### BOM / 正式物料与配置组成

**Definition.** A configuration-expanded composition used for formal costing and production-related flows. It is produced by `buildRecipeBomDraft`; formal recipe save stores the generated rows in `recipes.parts_json`.

**BOM is neither Template nor Recipe.** A **Template** is a reusable source of structure. A **Recipe** is a named saved configuration and owner of a current BOM snapshot. A **BOM** is the expanded, configuration-specific material/process composition derived from them plus formal choices.

| BOM source/category | Role and source | Dependencies / inventory / cost semantics |
| --- | --- | --- |
| Template shell components | `template.shellComponentsJson` | Component or bundle rows; `stainlessStretchBarrel` can vary with `customBarrelLength`; Part-backed where formally bound. |
| Template fixed parts | `template.partsJson` | Fixed rows; long-screw rule can adjust a derived part/quantity. |
| Coil/rotor | formal `calculateCoilSnapshot` | One `线圈转子` row; inventory is coil only with a concrete `coilId`; formal scheme cost snapshot. |
| Capacitor | `resolveCapacitorModel` from selected scheme/default or explicit model | Part catalogue lookup; ambiguous capacity fails closed. |
| Cable | `calculateCompleteCableCost` | A `cableAssembly` business row; length/accessory affect cost and may bind a Part. |
| Float | formal selected float part/configuration | Depends on float selection and accessory type. |
| Packing | `packingParts` | Configuration-dependent packing rows; role controls replacement/retention. |
| Optional parts | `optionalParts` | Part-backed when stable identity is required; explicit manual price is a distinct path. |
| Long screw | template/recipe rule | Derived by barrel length; may be a generated inventory Part when formally saved. |
| Stainless barrel / rotor process | shell metadata and configured rules | These can be dynamic or non-inventory process/cost semantics; not every row maps to a normal Part. |

`bomRoles.cjs` identifies roles including fixed, shell, barrelLength, stainlessShellBundle, longScrew, capacitor, coil, float, cable, packing, and rotorProcess and declares their configuration dependencies.

**Evidence:** `api/services/recipeBomEngine.cjs` (`buildRecipeBomDraft`, `calculateCoilSnapshot`, `resolveCapacitorModel`); `api/services/bomRoles.cjs` (`CONFIGURATION_DEPENDENCIES`, `inferLegacyBomCostRole`); `api/services/recipeCommands.cjs` (`buildRecipeSavePayloadDraft`); `docs/business-flow.md` §4 and §7.1.

### PART / 零件目录项

**Definition.** A catalogue entry in `parts` for a physical part, with current price and on-hand stock plus model/category/supplier classification.

**Identity.** `parts.id` is canonical. `part.model` is a searchable, non-unique designation; if a stable ID is unavailable, code permits only an exact unique `model + supplier` match (or only a unique model in the stated compatibility case). It never treats a fuzzy first result as identity.

**Pump shell and BOM.** Pump shell is a Part category. A Template can bind a canonical pump-shell Part. Part-backed BOM rows use `partId`; nevertheless a BOM may also contain coil inventory rows, cable assemblies, rotor process rows, or other non-ordinary-Part semantics.

**Coil boundary.** Coil schemes are not ordinary Part inventory: their inventory is held by `coils`, and formal BOM coil rows use `coilId` and `inventoryType: 'coil'`.

**Evidence:** `api/database/schema.cjs` (`parts`); `api/services/bomPartIdentity.cjs` (`resolveCatalogPartIdentity`); `api/services/templateCommands.cjs` (shell category/binding validation); `api/ontology/v2_1/entities/part.cjs`; `docs/business-flow.md` §7.1.

### FINISHED_PUMP / 成品泵

**Current status: MODEL_GAP.** There is no dedicated `finished_pump` table or active Ontology profile in the audited core sources. Operationally, a Recipe's named, saved configuration is used as a **can-produce finished-product configuration**, and cost query code searches recipe records for finished-model wording. `pump_model_variants` exists as a configuration preset tied to a template and coil selection, not as a proven separate Finished Product authority.

Therefore, the following are deliberately **not** asserted as formal knowledge:

- that every `V550`/`V750`/`V110` name is a market product model rather than a recipe designation or revision;
- that a Recipe and Finished Pump are always one-to-one;
- that `pump_model_variants` is the Owner's product master.

**Evidence:** `api/database/schema.cjs` (`recipes`, `pump_model_variants`); `api/db.cjs` (`recipeRow`, `modelVariantRow`); `api/services/costQueries.cjs` (finished-product selector); `api/services/recipeCommands.cjs` (`buildRecipeSavePayloadDraft`).

## 4. Relationship map

| Source | Relation | Target | Cardinality | Authority/evidence | Ontology now | Runtime enabled | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| COIL_SCHEME | belongs to | STATOR | many → zero/one | `coils.stator_variant_id` → `stator_variants.id` | No first-class STATOR entity | No | Model STATOR explicitly in later Ontology work |
| RECIPE | uses | TEMPLATE | many → zero/one | `recipes.template_id`; `recipe.uses_template` | Yes | No | Runtime relation reader still not approved |
| RECIPE | uses | COIL_SCHEME | many → zero/one | `recipes.coil_id`; `recipe.uses_coil` | Yes (as coil) | No | Explain scheme versus coil terminology |
| RECIPE | expands to | BOM | one → current snapshot | `buildRecipeSavePayloadDraft` stores authoritative BOM | No | No | Missing BOM concept/relation |
| BOM row | references | PART | many → zero/one per row | `partId` after `resolveCatalogPartIdentity` | No | No | Missing BOM row semantics |
| TEMPLATE | uses | Pump Shell PART | one → zero/one | binding table / `template.uses_shell_part` | Yes | No | Keep optionality explicit |
| TEMPLATE | contributes | fixed Part rows | one → many | `template.partsJson` in `buildRecipeBomDraft` | No | No | Missing composition relation |
| TEMPLATE | contributes | shell component rows | one → many | `template.shellComponentsJson` in `buildRecipeBomDraft` | No | No | Missing composition relation |
| RECIPE | has | technical profile | one → zero/one | `technical_data_json` and formal profile | Facts only | No | Profile is not a separate entity/relation |
| RECIPE | realizes | FINISHED_PUMP | unresolved | current code operationally uses recipes; no finished-pump entity | No | No | MODEL_GAP |

## 5. Business composition map

```text
STATOR (diameter + material + slot type)
  └─ COIL_SCHEME (sheets, electrical/winding details, pricing, stock)

TEMPLATE (reusable shell structure)
  ├─ optional binding → Pump Shell PART
  ├─ fixed parts
  └─ shell components / bundle cost mode

RECIPE (named product configuration)
  ├─ uses TEMPLATE
  ├─ selects a formal COIL_SCHEME when exact identity is known
  ├─ carries product-level options and technical profile
  └─ expands through formal code → BOM snapshot

BOM (configuration-specific composition)
  ├─ Part-backed rows
  ├─ formal COIL_SCHEME / rotor row
  ├─ capacitor, cable, float, packing and optional rows
  └─ dynamic/process rows where applicable

FINISHED_PUMP
  └─ currently represented operationally by a saved RECIPE configuration;
     a dedicated business entity remains unresolved.
```

## 6. Identity versus designation

| Mention/designation | What it is | What it cannot safely do alone |
| --- | --- | --- |
| `12-120` | non-unique coil common designation | identify a unique scheme or authorize scheme-specific stock/cost/write |
| `12` | stator common specification name that normalizes to 120 mm in current code | itself identify a winding scheme |
| `schemeCode` | stable formal scheme code | replace DB ID where an API requires ID unless that API formally resolves it |
| template `shellModel` | unique Template designation in the schema | identify a full Recipe/BOM |
| recipe `name` | non-unique Recipe designation in Ontology | unconditionally identify a Recipe without formal resolution |
| part `model` | non-unique Part designation | identify a Part without `partId` or exact safe fallback binding |

## 7. Business knowledge versus Domain Policy

**Business knowledge (belongs in the reviewed business model, and later in a controlled business-understanding context):**

- `12` maps to a 120 mm standard stator diameter in current formal normalization.
- `12-120` is common designation = spec plus sheet count; it can be non-unique.
- STATOR, COIL_SCHEME, TEMPLATE, RECIPE, BOM, PART, and a missing FINISHED_PUMP entity have different roles.
- A coil is separate from ordinary Part inventory.
- A Template contributes structure; a Recipe carries configuration; a BOM is the expansion.

**Business policy (belongs in Domain Policy, while code remains enforcement authority):**

- Do not silently select among multiple formal coil schemes.
- Treat a mention as a candidate, not a DB identity.
- Keep money and inventory basis explicit.
- Preview is not a persisted change; a formal write requires protected Owner confirmation.

The current eight rules correctly state several safe behaviors but deliberately do not define the product vocabulary they reference. RULE-03 and RULE-04 use `V550`, `12-120`, coil scheme, and formal identity without supplying a complete business model; that missing definition should not be “solved” by adding technical data or formulas to the Policy.

## 8. Current Ontology coverage and gaps

### Already represented

- `coil` profile: canonical `coils.id`, non-unique common designation, scheme facts and lifecycle/selection contract (`api/ontology/v2/entities/coil.cjs`).
- `part`, `template`, and `recipe` profiles (`api/ontology/v2_1/entities/*.cjs`).
- Relations `recipe.uses_template`, `recipe.uses_coil`, and `template.uses_shell_part` exist declaratively but have `runtimeEnabled: false`.

### Gaps to report only (do not implement in M4-1A)

1. **STATOR concept missing:** its physical identity exists in schema/code, but no first-class Ontology entity/profile explains it.
2. **COIL_SCHEME terminology is under-modeled:** the `coil` profile contains scheme fields, but it does not separately express the business distinction between a stator, scheme, and business-facing coil/rotor inventory.
3. **BOM concept and relationships missing:** Recipe-to-BOM, Template-to-BOM contribution, and BOM-row-to-Part/Coil semantics are code-only.
4. **Template profile too thin:** it only exposes `shellModel` and shell-Part relation, not reusable structure/fixed parts/components or cost modes.
5. **Recipe profile omits the persisted BOM/cost-snapshot semantic model.**
6. **FINISHED_PUMP entity missing:** current system uses Recipe operationally; that is not an explicit product master model.
7. **Relations are declared but not runtime enabled.** This is a capability/runtime decision for a later phase, not a defect to patch here.

## 9. Current Domain Policy coverage and gaps

### Covered behavior

- Entity mentions require formal identity (RULE-03).
- Common coil designation ambiguity cannot silently select/merge schemes (RULE-04).
- Money and inventory basis must be stated (RULE-05/06).
- Preview/write and protected confirmation boundaries are explicit (RULE-01/02/08).

### Gaps

1. **No business vocabulary contract.** Policy refers to product concepts but does not define their semantic boundaries.
2. **No explicit STATOR/COIL_SCHEME/COIL separation.** This belongs in Business Understanding, not a behavioral rule.
3. **No Template/Recipe/BOM composition explanation.** This is business knowledge, not a policy instruction.
4. **No Finished Product model.** Whether a Recipe is the business product master is unresolved and requires Owner review.
5. **Policy cannot make a designation a formal identity.** This remains correctly enforced by formal resolver/Business APIs.

## 10. Unresolved Owner review questions

Only questions code and schema cannot decide are listed. They do not change current behavior.

1. In everyday factory language, does **“模板”** mean exactly the reusable pump-shell structure in `pump_shell_templates`, or does it include other reusable product configurations?
2. When the Owner says **V550 / V750 / V110**, is that primarily a market product model, a Recipe designation, a product family, or can one name designate several revisions/configurations?
3. Should the future business model define **Finished Pump** as a first-class product/master entity separate from Recipe, or explicitly make a released Recipe the finished-product authority?
4. Which BOM rows that current code treats as a process/non-inventory cost (for example rotor-process rows) should be described to users as material, process, or both?
5. Is the business meaning of a **coil scheme family** solely cost interpolation/extrapolation continuity, or does it also convey a shop-floor manufacturing family that should be visible to the Owner?
6. Which existing `pump_model_variants` presets, if any, are recognized by the Owner as product identities rather than only reusable configuration presets?

## 11. Proposed Business Understanding V1 boundary

This candidate is a reviewed semantic contract. It may later seed bounded Business Understanding context and benchmarks **only after Owner approval and a separate implementation decision**. It must not become a second runtime fact source and does not change the precedence of formal Business APIs, schema, Ontology, or Domain Policy.

### Audit evidence inventory

Audited formal sources include: `api/services/coilCost.cjs`, `coilQueries.cjs`, `coilCommands.cjs`, `recipeBomEngine.cjs`, `bomRoles.cjs`, `recipeConfigurationBaseline.cjs`, `recipeQueries.cjs`, `recipeCommands.cjs`, `templateQueries.cjs`, `templateCommands.cjs`, `partQueries.cjs`, `partCommands.cjs`; `api/database/schema.cjs`, `migrations.cjs`; `api/ontology/**`; `api/services/ai-assistant/domain-policy.md`; `docs/coil-domain.md`; and `docs/business-flow.md`.

## 12. M4-1A acceptance record

- Core concepts audited: **8** — COIL, STATOR, COIL_SCHEME, TEMPLATE, RECIPE, BOM, PART, FINISHED_PUMP.
- Relationships audited: **10**.
- Ontology gaps: **7**.
- Domain Policy gaps: **5**.
- Owner review questions: **6** (within the 15-question limit).
- Runtime, schema, API, cost engine, Ontology, Domain Policy, production data, and deployment changes: **none**.
