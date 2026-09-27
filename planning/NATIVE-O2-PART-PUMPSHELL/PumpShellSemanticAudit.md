# PumpShell Semantic / Technical-Debt Audit

> 状态：只读审计，基线 `900b81ec0140b4b1724f1f6a81a2997bcfb9c18a`。未读取或写入业务数据库；结论来自当前源码和 schema。Owner 规则说明业务应有含义，源码说明当前实际行为；两者冲突处明确列为技术债或待决项。

## 结论先行

PumpShell 的 canonical entity 仍是 `parts.id`，不是模板名、`shell_model`、备注 JSON 或 rotor 参数。它确实是产品结构的核心锚点，但当前实现将三种不同语义混在多层：

```text
PumpShell Part (parts.id, category=泵壳, remark JSON)
  ├── formal binding: catalog_template_shell_bindings.template_id -> shell_part_id
  ├── Template: fixed parts / shell components / rotor_params_json / cost mode
  └── Recipe: template_id / BOM snapshot / custom_barrel_length / technical_data_json
        ├── BOM preview: recipeBomEngine
        ├── full cost: costEngine
        └── rotor draft: rotorTemplateDraft
```

这条链在“已绑定模板 + 由模板建立配方”的路径上成立，但不是所有记录的强制不变量：`recipes.template_id` 可空，components 模式模板可无 `shellPartId`，旧记录仍可用名称解析。

## 证据索引

- Part schema/DTO：`api/database/schema.cjs:121-135`、`api/db.cjs:95-103`
- Template/Recipe/Variant schema：`api/database/schema.cjs:92-119,137-197,493-519`
- 正式 Template → Shell binding：`api/database/catalogSchema.cjs:52-58`、`api/services/templateCommands.cjs:423-457`、`api/services/catalogLiveReferences.cjs:112-115`
- Shell 名称解析：`api/services/pumpShellPartResolver.cjs:1-53`
- Rotor precedence：`api/services/rotorTemplateDraft.cjs:80-227`
- BOM/cost shell path：`api/services/recipeBomEngine.cjs:190-310`、`api/services/costEngine.cjs:268-324`
- 物理规格 hash：`api/services/catalogPhysicalIdentity.cjs:2-26`
- 当前 PumpShell UI writer：`apps/web-next/lib/part-form-rules.ts:143-160,247-264`、`apps/web-next/components/parts-view.tsx:1150,1285-1295`

## Owner-readable semantic matrix

| 业务概念 | 当前字段/位置 | 谁写 | 谁读 | 当前作用 | Owner 语义 | 建议归属 | 是否重复 | 是否技术债 | 是否需要 Owner 决策 |
|---|---|---|---|---|---|---|---|---|---|
| PumpShell canonical identity | `parts.id` | Part command / catalog creation | binding、BOM identity、resolver | 正式资源身份 | 具体泵壳 Part | Part Base | 否 | 否 | 否 |
| PumpShell display/model | `parts.model`、`naming_json` | Part form/rename | UI、legacy resolver | 展示与历史查找 | designation，不是 identity | Part Base | 与 `template.shell_model` 重叠 | 是 | 否 |
| category | `parts.category='泵壳'` | Part command/UI | resolver、template validation | 启用 extension 行为 | PumpShell 分类门槛 | Part Base + Extension discriminator | 否 | 否 | 否 |
| stainless flag | `remark.isStainless` | PumpShell form → `buildPartRemark` | UI、BOM、rotor draft | 启用部分长度相关行为 | intrinsic engineering fact | PumpShell Extension | 组件 `stainlessStretchBarrel` 也表达相关概念 | 是 | 否 |
| open offset | `remark.openOffset`; legacy `openFactor` | UI 写 `openOffset`；旧数据可能有 alias | UI、`rotorTemplateDraft.openOffsetFromMeta` | 开档计算输入 | intrinsic engineering fact | PumpShell Extension | alias | 是 | 否 |
| fixed non-stainless bearing span | `remark.defaultBearingSpan` | UI | rotor draft fallback/UI reference | 默认填入 `bearing_span` | 应是固定物理工程值 | PumpShell Extension | Template/Recipe 也能覆盖 | **是：当前标为 default 而非 intrinsic** | 是 |
| stainless bearing span | `barrelLength - openOffset`，不持久化为 PumpShell field | UI/rotor draft recipe path | UI、`buildRotorTemplateDraft`、`buildRotorRecipeDraft` | derived drawing value | derived engineering fact | Derived | Recipe `technicalData.bearingSpan` 可覆盖 | 是 | 否 |
| barrel length | Recipe `custom_barrel_length`; Variant `barrel_length`; legacy meta `barrelLength` | Recipe/Variant commands; legacy metadata | BOM、rotor/UI | product configuration、长度计价 | current configuration fact | Recipe / Variant configuration | 3 layers | 是 | 是（是否保留 meta fallback） |
| upper/lower bearing defaults | `remark.default*Bearing` + `default*BearingPartId` | UI selects active bearing IDs | rotor uses display names; audit/hash uses IDs | rotor draft default | likely recommended configuration, not shell identity by name | PumpShell Extension defaults + Relation | ID/name pair | 是 | 否 |
| rotor dimensions | `remark.defaultOilSealDia/...defaultStackOffset` | UI | rotor draft/UI refs | lowest-priority draft defaults | defaults unless Owner declares intrinsic | PumpShell Extension defaults | template + recipe overlays | 是 | 是（哪些本体固有） |
| template rotor values | `pump_shell_templates.rotor_params_json` | Template command/editor | rotor draft | overwrites component extraction and shell defaults | template configuration | Template | duplicates most defaults | 是 | 否 |
| recipe technical values | `recipes.technical_data_json` | Recipe editor/command | recipe rotor draft | final explicit rotor override | recipe configuration | Recipe | duplicates all rotor dimensions | 是 | 否 |
| recipe dedicated impeller columns | `impeller_thickness/diameter/...` | Recipe command/editor | only thickness fallback in rotor draft | partial compatibility path | recipe configuration | Recipe | overlaps technical JSON | **是** | Yes: desired source-of-truth policy |
| shell cost | Template `bundle_cost` or `shell_components_json` | Template command/editor | BOM/cost | shell BOM rows and price | Template cost configuration | Template / BOM | PumpShell Part price is not consistently used | 是 | 否 |
| Template→Shell relation | `catalog_template_shell_bindings` | Template create / rename workflow | hydration, resolver, audit | formal exact identity when present | Template uses Shell Part | Relation | legacy model matching remains | 是 | 否 |

## PumpShell field inventory and reader/writer trace

All fields below are stored inside `parts.remark` as JSON unless stated otherwise. Current UI persists the listed modern keys through `buildPartRemark()`; generic Part persistence then writes `parts.remark`. “Runtime” means server-side production code reads the value, not merely that a document mentions it.

| Field | Stored at | Writers | Readers | UI editable | Runtime / cost / drawing / Template / Recipe | Authority and Owner classification | Physical identity relevance | Tech debt |
|---|---|---|---|---|---|---|---|---|
| `isStainless` | `parts.remark.isStainless` | `part-form-rules.buildPartRemark`; Part UI | `recipeBomEngine`, `rotorTemplateDraft`, UI | Yes | Runtime Yes; Cost Yes; Drawing Yes; Template indirect; Recipe indirect | Current persisted PumpShell engineering fact; `PUMPSHELL_ENGINEERING_FACT` | CURRENT_CODE_ONLY: included in remark hash | overlaps component type `stainlessStretchBarrel`; server drawing does not always gate on it |
| `openOffset` | `parts.remark.openOffset` | same | `openOffsetFromMeta` server/UI | Yes | Runtime Yes; Cost No direct; Drawing Yes | Current persisted engineering input; `PUMPSHELL_ENGINEERING_FACT` | CURRENT_CODE_ONLY | alias `openFactor` still read |
| `openFactor` | historical remark JSON | no current UI writer | server/UI `openOffsetFromMeta` | No | Drawing Yes | `COMPATIBILITY_ALIAS` / `LEGACY_FALLBACK` | included if present | alias obscures one canonical key |
| `barrelLength` | historical remark JSON | no current PumpShell form writer | `rotorTemplateDraft` only uses it for drawing text | No | Drawing partial; no BOM priority | `LEGACY_FALLBACK`; not a current config source | included if present | conflicts with Recipe/Variant lengths |
| `barrelLengthPresets` | historical remark JSON | no current writer found | UI known-key filter only | No | no verified business runtime reader | `INTERNAL_METADATA` / unresolved historical data | included if present | retained opaque JSON |
| `defaultUpperBearing` | remark | UI selection stores display model | shell defaults, rotor draft | Yes | Drawing Yes; no cost; Template/Recipe only as fallback | `PUMPSHELL_DEFAULT` | removed from identity hash when paired Part ID exists | duplicate display beside formal Part ID |
| `defaultUpperBearingPartId` | remark | UI selection | catalog reference audit, physical hash | Yes | Drawing No direct; relation/audit Yes | `RELATION` for recommended bearing | Yes, replaces display label in hash | rotor draft ignores ID and uses label |
| `defaultLowerBearing` / `PartId` | remark | same | same | Yes | same as upper | `PUMPSHELL_DEFAULT` + `RELATION` | same | same |
| `defaultOilSealDia` | remark | UI | shell-default rotor fallback/UI refs | Yes | Drawing Yes | `PUMPSHELL_DEFAULT` | CURRENT_CODE_ONLY | Template/Recipe duplicate |
| `defaultBearingSpan` | remark | UI | shell-default rotor fallback/UI refs | Yes | Drawing Yes | Current code `PUMPSHELL_DEFAULT`; Owner says non-stainless should be intrinsic fixed fact | CURRENT_CODE_ONLY | semantic mismatch and multi-layer overrides |
| `defaultImpellerDia` | remark | UI | shell-default rotor fallback/UI refs | Yes | Drawing Yes | `PUMPSHELL_DEFAULT` | CURRENT_CODE_ONLY | conflicts with Recipe technical and dedicated diameter |
| `defaultImpellerSpan` | remark | UI | shell-default rotor fallback/UI refs | Yes | Drawing Yes | `PUMPSHELL_DEFAULT` | CURRENT_CODE_ONLY | Template/Recipe duplicate |
| `defaultImpellerDepth` | remark | UI | shell-default rotor fallback/UI refs | Yes | Drawing Yes | `PUMPSHELL_DEFAULT` | CURRENT_CODE_ONLY | Recipe dedicated `impeller_thickness` fallback duplicates it |
| `defaultThreadLength` | remark | UI | shell-default rotor fallback/UI refs | Yes | Drawing Yes | `PUMPSHELL_DEFAULT` | CURRENT_CODE_ONLY | Template/Recipe duplicate |
| `defaultThreadDia` | remark | UI | shell-default rotor fallback/UI refs | Yes | Drawing Yes | `PUMPSHELL_DEFAULT` | CURRENT_CODE_ONLY | Template/Recipe duplicate |
| `defaultStackOffset` | remark | UI | shell-default rotor fallback/UI refs | Yes | Drawing Yes | `PUMPSHELL_DEFAULT` | CURRENT_CODE_ONLY | Template/Recipe duplicate |
| `parts.remark` / DTO `notes` | table JSON / `partRow.notes` | generic Part command | UI, resolver consumers | raw JSON not directly edited | broad | `INTERNAL_METADATA` container, not one Fact | all non-omitted keys enter hash | opaque schema permits accidental semantic expansion |
| `template.shellPartId` | projected from binding table, not template column | template create / rename binding | resolver/BOM/rotor | editor selection on create | Runtime Yes; Cost identity only; Drawing Yes | `RELATION` | n/a | update API has no normal rebinding field |

### Field-level source details required for review

- **Current UI editable**: all modern PumpShell meta fields except `barrelLength`, `barrelLengthPresets`, and `openFactor` are exposed in `parts-view`; bearing fields use a dropdown whose empty option explicitly calls old name-only data “历史配置，需核对具体零件” (`parts-view.tsx:1150`).
- **Template**: no PumpShell remark field is copied into template storage. `rotor_params_json` and `shell_components_json` are independent template fields (`templateCommands.cjs:272-312`).
- **Recipe**: no PumpShell remark field is copied into recipe storage automatically at server level. The Web editor auto-writes stainless `technicalData.bearingSpan` while the drawer is open (`recipes-view.tsx:1100-1131`), which is a configuration value, not a PumpShell fact.
- **Cost**: only `isStainless` directly participates in the shell bundle long-length rule; default rotor dimensions do not affect cost in inspected services.

## Actual rotor/drawing precedence

The table is the execution order in `rotorTemplateDraft.cjs`, later rows override earlier values unless marked “only if empty.” It is not a proposed model.

| Parameter | Template draft precedence, low → high | Recipe draft additions, low → high | Actual caution |
|---|---|---|---|
| upper bearing | `template.parts_json` name heuristic → `template.rotor_params_json` → `remark.defaultUpperBearing` only-if-empty | `recipe.technical_data_json.upperBearing` | bearing Part ID is not used by draft |
| lower bearing | template parts → template rotor params → shell default only-if-empty | recipe technical JSON | same |
| oil seal diameter | template part model heuristic → template rotor params → shell default only-if-empty | recipe technical JSON | model parsing is a heuristic |
| bearing span | template rotor params → shell `defaultBearingSpan` only-if-empty → Variant `barrel_length - openOffset` | Recipe `custom_barrel_length - openOffset` → recipe technical JSON `bearingSpan` | server derivation has no `isStainless` guard |
| impeller bore diameter | template rotor params → shell default only-if-empty | recipe technical JSON `impellerBoreDiameter` | dedicated `impeller_diameter` is not used by rotor draft |
| impeller span | template rotor params → shell default only-if-empty | recipe technical JSON `impellerSpan` | no dedicated-column fallback |
| impeller depth | template rotor params → shell default only-if-empty | recipe technical JSON `impellerDepth` → dedicated `impeller_thickness` only-if patch still empty | two recipe representations |
| thread length / diameter | template rotor params → shell defaults only-if-empty | recipe technical JSON overrides | no Variant source |
| stack offset | template rotor params → shell default only-if-empty | recipe technical JSON overrides | no Variant source |
| piece count / rotor diameter | template rotor params only | recipe technical JSON; Web additionally mirrors coil sheets to `pieceCount` | not PumpShell metadata |

Evidence: `applyTemplateParts` lines 80-102, `applyTemplateRotorParams` 104-111, `applyShellMetaDefaults` 113-128, Variant override 150-160, Recipe custom length 194-203, technical JSON 205-211, dedicated depth fallback 213-217.

## Stainless versus fixed barrel verification

### Non-stainless

**Current source of fixed span:** `parts.remark.defaultBearingSpan`, entered by the PumpShell form and used only as a lowest-priority rotor-draft fallback. It is not stored in a dedicated physical engineering column and it may be superseded by template `rotor_params_json`, Variant length derivation, Recipe custom length derivation, or Recipe technical data.

**Owner-rule result:** **PARTIAL / semantic mismatch.** Owner says this is an intrinsic fixed physical value when `isStainless=false`; current code labels and uses it as a default. No code change was made.

### Stainless

**Formula evidence:** `calculateBearingSpan()` returns `barrelLength - openOffset` rounded to one decimal (`rotorTemplateDraft.cjs:44-49`). For recipe drafts it uses `recipe.custom_barrel_length` after the Template/Variant draft; for template drafts it uses `variant.barrel_length` (`:150-160,194-203`). The Web form applies the same formula only when `hasStainlessBarrel` is true (`recipes-view.tsx:668-671,1117-1127`).

**Owner-rule result:** **PARTIAL.** The expected formula is present. But backend draft code triggers a Variant or Recipe custom-length derivation whenever both a length and `openOffset` exist; it does not condition that calculation on `meta.isStainless`. Therefore the backend does not faithfully encode the Owner’s stainless-only precondition even though the Web editor does.

### Barrel-length sources and precedence

| Consumer | precedence | notes |
|---|---|---|
| Rotor recipe draft | `recipes.custom_barrel_length` → prior Template draft barrel length | Recipe source derives span; technical JSON can finally override span |
| Rotor template draft | `pump_model_variants.barrel_length` → legacy `remark.barrelLength` only for displayed text | only Variant path derives span |
| BOM draft | request `customBarrelLength` → Variant `barrelLength` → null | `recipeBomEngine.resolveBarrelLength`; ignores legacy PumpShell meta length |
| Web recipe edit | Recipe form custom length with stainless guard | auto-writes technical JSON bearing span |

**Open offset source:** `parts.remark.openOffset`, with `openFactor` only as compatibility reader alias.

## Formal relation and name-based resolution

### `Template --uses_shell_part--> Part(category=泵壳)`

`catalog_template_shell_bindings(template_id UNIQUE, shell_part_id)` is the formal current relation (`catalogSchema.cjs:52-58`). It is written on template create when `shellPartId` is supplied; `bundle` requires it, while `components` may omit it (`templateCommands.cjs:423-457`). `hydrateCatalogRow()` projects it onto `template.shell_part_id` (`catalogLiveReferences.cjs:112-115`). When present, `resolvePumpShellPart()` validates positive ID, category, and non-deleted state before any name lookup (`pumpShellPartResolver.cjs:38-44`).

Consequences:

- A template can exist without a binding in components mode; a Recipe can also have null `template_id`.
- Bundle cost requires concrete shell identity at create time, but the bound Part supplies identity/model/supplier while the amount comes from `template.bundle_cost`, not `parts.price` (`recipeBomEngine.cjs:221-246`).
- Components mode costs `shell_components_json` entries in category `泵壳搭配`; it does not necessarily price the PumpShell Part itself (`recipeBomEngine.cjs:248-310`).
- Current template update normalization has no `shellPartId` rebinding field (`templateCommands.cjs:315-384`). Catalog rename workflows can create missing bindings after exact/safe audit, which is a migration/compatibility path, not ordinary template editing (`catalogRename.cjs:127-132`).

### Name paths

| Path | Classification | behavior |
|---|---|---|
| `shellPartId` | CURRENT_FORMAL_BINDING | exact active PumpShell Part only |
| exact normalized `model == shellModel` | CURRENT_SAFE_LOOKUP only when exactly one active candidate | used if no binding |
| base-name + opposite dimension-suffix matching | LEGACY_COMPATIBILITY | `V750` / `V750-xxmm` compatibility, requires uniqueness |
| multiple candidates | safe failure | 409 `PUMP_SHELL_PART_AMBIGUOUS`; no first-match selection |
| `catalogRename` / rename impact name scans | LEGACY_COMPATIBILITY | preserves/reports historical dependencies, may establish binding after governed workflow |
| direct string model as Ontology identity | UNSAFE_FOR_ONTOLOGY_IDENTITY | never promote; `parts.id` remains canonical |

## Physical identity audit

`physicalSpecification('part', row, naming)` includes all persisted Part fields except the listed commercial/label exclusions, then includes nearly every `remark` JSON key as `fields.engineering` (`catalogPhysicalIdentity.cjs:5-26`). For PumpShell this means `isStainless`, `openOffset`, all default dimensions, and unknown metadata currently participate in the structured physical fingerprint. If `defaultUpperBearingPartId` or lower ID exists, the corresponding display-name key is removed and the ID is fingerprinted instead (`:19-23`).

| Field group | current physical identity relevance |
|---|---|
| `isStainless`, `openOffset` | YES, current code |
| bearing Part IDs | YES, current code |
| bearing display names | only if no corresponding ID |
| `defaultBearingSpan`, impeller/thread/stack defaults | YES, current code |
| unknown PumpShell remark keys | YES, current code unless specifically omitted globally |
| `parts.price`, stock, supplier display/name metadata | price/stock excluded; supplier is not excluded and therefore remains in fields; model is excluded |

This is an implementation fingerprint policy, not proof that every `default*` is intrinsically physical. It conflicts with the Owner distinction between intrinsic properties and recommended configuration, so future modeling needs an Owner-approved split before any migration.

## Duplicate/overlap matrix

| Concept | PumpShell | Template | Recipe / Variant | Current winning reader | classification |
|---|---|---|---|---|---|
| bearing span | `defaultBearingSpan` | `rotor_params_json.bearing_span` | technical JSON; Recipe custom length; Variant barrel length | Recipe technical > Recipe derive > Variant derive > Template > Shell default | default + override + derived duplicate |
| upper/lower bearings | defaults + Part IDs | parts JSON heuristics; rotor params | technical JSON | Recipe technical > Template rotor > components > Shell display default | relation/name duplication |
| oil seal | default diameter | parts model heuristic; rotor params | technical JSON | Recipe technical highest | duplicate |
| impeller bore/span/depth | defaults | rotor params | technical JSON; depth/diameter columns | technical JSON, depth dedicated fallback | duplicate; dedicated columns partial |
| thread/stack | defaults | rotor params | technical JSON | technical JSON highest | duplicate |
| barrel length | legacy meta display | none | Variant/Recipe custom values | Recipe custom then Variant for active flows | legacy/configuration duplicate |
| stainless semantics | `isStainless` | `stainlessStretchBarrel` component / cost mode behavior | custom length | consumer-specific | related but not normalized |
| shell price | `parts.price` | bundle cost or component prices | saved BOM snapshot | Template/BOM value | commercial duplicate / non-equivalence |

## PUMPSHELL TECHNICAL DEBT

### PS-TD-01 — Structured engineering schema is embedded in generic `parts.remark`

- **Current source:** `parts.remark`; UI parser/writer `part-form-rules.ts`.
- **Consumers:** UI, rotor draft, BOM shell metadata, physical fingerprint.
- **Risk / business impact:** unknown keys automatically join the physical fingerprint; no typed ownership or provenance boundary.
- **Recommended future action:** consolidate after Owner-approved extension schema; do not migrate during audit.

### PS-TD-02 — `defaultBearingSpan` conflicts with Owner fixed-shell semantics

- **Current source:** remark default; rotor draft fallback.
- **Consumers:** rotor UI/server draft.
- **Risk:** fixed non-stainless engineering fact can be silently overridden.
- **Recommended future action:** needs Owner decision on intrinsic-vs-default split, then consolidate.

### PS-TD-03 — Stainless span derivation lacks server-side stainless guard

- **Current source:** `rotorTemplateDraft.cjs:150-160,198-203`.
- **Consumers:** template/recipe rotor draft API.
- **Risk:** any shell with an offset and barrel length can get a derived span.
- **Recommended future action:** needs future runtime fix after Owner review; do not change now.

### PS-TD-04 — Rotor parameters live in Shell defaults, Template JSON, Recipe JSON and partial columns

- **Current source:** remark, `rotor_params_json`, `technical_data_json`, recipe impeller columns.
- **Consumers:** rotor draft/editor.
- **Risk:** precedence is procedural and hard to audit; one update can be shadowed.
- **Recommended future action:** consolidate only after defining authoritative layer per parameter.

### PS-TD-05 — Bearing default ID and display-name semantics diverge

- **Current source:** paired `default*Bearing` and `default*BearingPartId`.
- **Consumers:** hash/audit use IDs; rotor draft reads labels.
- **Risk:** renamed or duplicate bearing labels can yield inconsistent drawing defaults.
- **Recommended future action:** migrate consumer to ID resolution after Owner approval.

### PS-TD-06 — Legacy `openFactor`, `barrelLength`, and suffix name matching remain readable

- **Current source:** historical remark plus resolver.
- **Consumers:** rotor/UI compatibility and unbound template lookup.
- **Risk:** legacy data can affect current outputs without explicit source labeling.
- **Recommended future action:** deprecate only after reference audit and data migration plan.

### PS-TD-07 — Formal binding is optional for components templates and not a normal update field

- **Current source:** binding table/create command/hydration.
- **Consumers:** resolver, rotor, BOM.
- **Risk:** components templates may remain name-dependent; rebinding lifecycle is incomplete.
- **Recommended future action:** needs Owner decision on whether every technical PumpShell template must bind a Part.

### PS-TD-08 — PumpShell commercial price is not the universal shell cost authority

- **Current source:** `parts.price` versus `bundle_cost`/components.
- **Consumers:** BOM/template cost.
- **Risk:** users may assume shell Part price controls recipe cost when it may only supply identity.
- **Recommended future action:** document and later clarify cost policy; keep current behavior.

### PS-TD-09 — UI and server apply stainless semantics differently

- **Current source:** Web guard in `recipes-view.tsx`; server draft no guard.
- **Consumers:** edit form versus API draft.
- **Risk:** same inputs can produce different draft semantics.
- **Recommended future action:** future behavior reconciliation, preceded by Owner review.

## Audit decision answers

- **Q2:** Yes. Evidence supports PumpShell as `Part(category=泵壳)` with a future category extension, not a separate canonical entity.
- **Q3:** verified intrinsic candidates are `isStainless` and `openOffset`; fixed non-stainless span is Owner-intrinsic but current code stores it as default. Other `default*` fields are currently recommendations/fallbacks, not proven intrinsic facts.
- **Q4:** exact current storage is `parts.remark.defaultBearingSpan`.
- **Q5:** formula exists, but server preconditions are partial as described above.
- **Q6:** precedence is the ordered table above.
- **Q7/Q8:** current formal defaults are all `default*` fields as rotor fallbacks; legacy/fallback keys are `openFactor`, `barrelLength`, `barrelLengthPresets`, unbound name resolution, and bearing name-only records.
- **Q9:** duplicate matrix above.
- **Q10:** authoritative relation is `catalog_template_shell_bindings` when present.
- **Q11:** exact and unique unbound model lookup is safe compatibility; suffix matching and rename-impact scans are legacy compatibility.
- **Q12:** physical identity includes nearly all PumpShell remark engineering keys; see physical audit.
- **Q13:** current cost flow matches the stated chain only conditionally; Template cost configuration/BOM, not Part price alone, is the direct cost source.
