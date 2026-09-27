# PumpShell Semantic / Technical-Debt Audit — R1 Authority Alignment

> 状态：只读语义审计。基线 `73238c117fca80fcb56439e4011243b4af1b4e34`。未读取、写入或迁移业务数据库。本文把 Owner 的**当前业务权威**与源码仍为旧记录保留的**现行兼容读取**分开；“仍被读取”绝不等同于“仍是正式权威”。

## CURRENT BUSINESS AUTHORITY

Owner 已确认的当前模型是：

```text
PumpShell Part (parts.id, category=泵壳)
  ├── 识别壳体与配置类型：isStainless
  └── formal relation → Template
                         └── 基础物料 / 正常配置骨架
                              └── Recipe
                                   ├── 最终 BOM
                                   ├── 客户差异
                                   ├── 最终技术参数
                                   └── Rotor Drawing authoritative input
```

因此：

- `parts.id` 是 PumpShell 的唯一 canonical identity。
- `isStainless` 是当前 PumpShell Fact，同时是决定 Recipe 配置规则的 `POLICY_DISCRIMINATOR`。
- Recipe 是最终 rotor/drawing 技术权威；Template 不是最终 rotor authority。
- 历史 `PumpShell.default*`、`PumpShell.openOffset` 与 `Template.rotor_params_json` 即使仍被现行代码读取，也只能先归为 `LEGACY`、`TRANSITIONAL`、`PREFILL` 或 `COMPATIBILITY`，不能提升为当前正式技术权威。
- 当前实现尚未完整落地该模型：Recipe 有 `custom_barrel_length` 和 rotor technical JSON，但没有正式 Recipe `openOffset` 字段；现行服务端会从 PumpShell remark 取 offset。

## HISTORICAL BUSINESS MODEL

PumpShell V1 曾直接保存完整技术/转子默认组：轴承、油封、开档、叶轮、螺纹、定位与不锈钢相关参数。该设计解释了 `parts.remark` 的老字段和 `rotorTemplateDraft` 的历史 fallback。

当前业务已经重构为“PumpShell 定壳体/类型，Template 定骨架，Recipe 定最终技术”。历史字段的存在和读取是迁移/兼容事实，不是重新定义 Owner 当前业务模型的证据。

## Evidence index

- Part schema/DTO：`api/database/schema.cjs:121-135`、`api/db.cjs:95-103`
- Recipe persistence：`api/database/schema.cjs:137-197`、`api/services/recipeCommands.cjs:83-115,245-385,525-603`
- Recipe technical UI：`apps/web-next/components/technical-data-editor.tsx:35-57,284-382`、`apps/web-next/lib/technical-data.ts:1-195`
- PumpShell form parse/write and visible controls：`apps/web-next/lib/part-form-rules.ts:21-35,143-160,247-264`、`apps/web-next/components/parts-view.tsx:182-214,539-557,1150,1274-1302`
- Current draft precedence：`api/services/rotorTemplateDraft.cjs:37-49,80-128,130-227`
- Recipe UI stainless behaviour：`apps/web-next/components/recipes-view.tsx:319-322,668-674,1100-1131,1262-1280,1969-1990`
- Technical references (current compatibility display)：`apps/web-next/lib/technical-references.ts:1-181`
- Formal Template→Shell binding：`api/database/catalogSchema.cjs:52-58`、`api/services/templateCommands.cjs:423-457`、`api/services/catalogLiveReferences.cjs:112-115`
- BOM/cost remains separate：`api/services/recipeBomEngine.cjs:190-310`、`api/services/costEngine.cjs:268-324`

## Owner-readable authority table

| 业务概念 | 当前实现来源 | 当前实现是否仍消费 | 当前 Owner 权威层 | 类型 | 后续建议 |
|---|---|---:|---|---|---|
| PumpShell identity | `parts.id`; binding `shell_part_id` | 是 | Part Base | `AUTHORITATIVE_FACT` / relation identity | 保持资源 ID，不把 name/remark 当 identity |
| `isStainless` | `parts.remark.isStainless`; Part UI | 是，UI/BOM/rotor draft | PumpShell Extension | `AUTHORITATIVE_FACT` + `POLICY_DISCRIMINATOR` | 保留在 PumpShell，驱动 Recipe 规则 |
| `openOffset` | `parts.remark.openOffset`; legacy `openFactor` | 是，UI/server draft/reference | Recipe | 当前 `LEGACY_FALLBACK` / `TRANSITIONAL` | 未来应为 Recipe Technical Fact；不得继续当 PumpShell final authority |
| barrelLength | `recipes.custom_barrel_length`; Variant `barrel_length`; legacy remark | 是 | Recipe | `AUTHORITATIVE_FACT`（目标）；Variant/template 为 prefill，remark 为 legacy | 将当前 Recipe dedicated column 视为实际可持久入口 |
| bearingSpan | Recipe `technical_data_json`; current derivation; old default | 是 | Recipe | 非不锈钢 `AUTHORITATIVE_FACT`；不锈钢 `DERIVED_FACT` | 以 Recipe final value 驱动 Rotor Drawing |
| upper/lower bearing | Recipe `technical_data_json`; Template parts/params; Shell defaults | 是 | Recipe | `AUTHORITATIVE_FACT`；其他均 `PREFILL`/legacy | Recipe UI 已有独立 selector |
| piece count / rotor diameter | Recipe `technical_data_json`; coil sheets UI link; Template params | 是 | Recipe | `AUTHORITATIVE_FACT` | Recipe final value；coil/template 只是来源/预填 |
| oil seal diameter | Recipe `technical_data_json`; Template parts/params; Shell default | 是 | Recipe | `AUTHORITATIVE_FACT` | 保留 Template/Shell 为兼容 prefill |
| impeller bore/span/depth | Recipe technical JSON；depth/diameter columns；Template/Shell | 是 | Recipe | `AUTHORITATIVE_FACT` | 统一未来权威 representation，当前为重复 |
| thread length/diameter, stack offset | Recipe `technical_data_json`; Template params; Shell defaults | 是 | Recipe | `AUTHORITATIVE_FACT` | Recipe final value优先 |
| `rotor_params_json` | `pump_shell_templates.rotor_params_json` | 是 | Template（仅骨架）→ Recipe | `TRANSITIONAL_PREFILL` / `COMPATIBILITY` | 不是 final technical authority |
| `PumpShell.default*` | `parts.remark` | 是 | Recipe | `LEGACY_PUMPSHELL_TECHNICAL_DEFAULT` / `TRANSITIONAL_PREFILL` | 不进入未来 PumpShell authoritative fact set |

## Recipe technical authority — field inventory

`recipes.technical_data_json` 的固定键由 `TECHNICAL_DATA_KEYS` 定义并由 `TechnicalDataEditor` 可见编辑：`upperBearing`、`lowerBearing`、`pieceCount`、`rotorDiameter`、`bearingSpan`、`stackOffset`、`oilSealDiameter`、`impellerBoreDiameter`、`impellerSpan`、`impellerDepth`、`threadLength`、`threadDiameter`，以及其他电机/测试字段。`impellerModel`、`impellerThickness`、`impellerDiameter`、`impellerBladeCount` 另有 Recipe dedicated columns；其中 rotor draft 目前只把 `impeller_thickness` 作为 JSON 缺值时的 fallback。

| 参数 | Recipe UI / persistence | Template representation | historical PumpShell representation | Rotor Drawing current consumption | Owner target authority |
|---|---|---|---|---|---|
| upper/lower bearing | visible selector → `technical_data_json` | parts heuristic / `rotor_params_json` | `default*Bearing` + IDs | Recipe JSON overwrites all earlier patch | Recipe Technical Fact |
| piece count | visible → technical JSON；UI links coilSheets | `rotor_params_json` | none | Recipe JSON | Recipe Technical Fact |
| rotor diameter | visible → technical JSON | `rotor_params_json` | none | Recipe JSON | Recipe Technical Fact |
| bearing span | visible but stainless-linked read-only → technical JSON | `rotor_params_json` | `defaultBearingSpan` | Recipe JSON overwrites derived/default | Recipe: fixed fact (non-stainless), derived fact (stainless) |
| stack/oil seal | visible → technical JSON | `rotor_params_json` / part heuristic | `defaultStackOffset` / `defaultOilSealDia` | Recipe JSON highest | Recipe Technical Fact |
| impeller bore/span/depth | visible → technical JSON; thickness also dedicated column | `rotor_params_json` | `defaultImpeller*` | JSON highest; depth gets dedicated fallback | Recipe Technical Fact |
| thread length/diameter | visible → technical JSON | `rotor_params_json` | `defaultThread*` | Recipe JSON highest | Recipe Technical Fact |
| barrel length | stainless Recipe input → `custom_barrel_length` | Variant can prefill | `remark.barrelLength` historical display only | Recipe custom length derives current patch | Recipe Technical Fact |
| open offset | **no formal Recipe input or fixed technical JSON key** | none | `remark.openOffset` / `openFactor` | server/UI read Shell meta | Recipe Technical Fact required by target, currently missing representation |

### Recipe technical data versus current implementation

The target authority is a business decision, not a claim that every current reader already complies. `buildRotorRecipeDraft()` first imports Template/Shell values, then derives using `recipe.custom_barrel_length` plus **Shell** offset, then overlays `technical_data_json`. This makes Recipe final technical JSON highest for supported fields, but does not yet let Recipe own `openOffset`. The editor also auto-writes derived stainless `technicalData.bearingSpan`, which duplicates a derivable final value.

## Stainless Recipe policy

### Target Owner policy

When `PumpShell.isStainless=true`:

1. Recipe must carry `barrelLength` and `openOffset` as its configuration context.
2. `bearingSpan = barrelLength - openOffset` is a Recipe Derived Technical Fact.
3. When Recipe is configured, Rotor Drawing can consume the final Recipe technical configuration without relying on PumpShell technical defaults.

### Current implementation compatibility

- The Recipe drawer detects stainless through bound PumpShell metadata in bundle mode, or `stainlessStretchBarrel` component in components mode (`recipes-view.tsx:319-322`).
- It visibly accepts `customBarrelLength` only for the stainless path and persists it in `recipes.custom_barrel_length` (`recipes-view.tsx:1969-1974`; schema above).
- It gets offset from `formShellMeta.openOffset`; no Recipe `openOffset` control/key exists. The reference panel shows it as a PumpShell reference.
- The UI computes and auto-persists `technicalData.bearingSpan` only when stainless plus Shell offset exist (`:668-671,1117-1127`).
- Server `buildRotorRecipeDraft()` uses the same formula, but only checks `barrelLengthValue && draft.openOffset != null`; it does **not** require `meta.isStainless` before calculating (`rotorTemplateDraft.cjs:198-203`).

Result: current implementation is **PARTIAL** against Owner policy. It has the formula and Recipe length, but offset remains a compatibility source and the backend guard is too broad.

## Non-stainless Recipe policy

### Target Owner policy

When `PumpShell.isStainless=false`, Recipe directly records/determines the fixed final `bearingSpan`. It does not require stainless barrel length or offset derivation. Rotor Drawing consumes that Recipe value.

### Current implementation compatibility

Recipe `technical_data_json.bearingSpan` can represent and override the final fixed value. But when absent, `rotorTemplateDraft` can fall through to Template rotor params, Shell `defaultBearingSpan`, Variant-derived span, or custom-length-derived span. Thus historical Shell `defaultBearingSpan` is only a **legacy/transitional prefill** in target semantics, not an intrinsic current PumpShell authority.

## Exact PumpShell Part UI editability matrix

| Field | Current UI classification | Evidence / save behaviour | Current semantic status |
|---|---|---|---|
| `isStainless` | `VISIBLE_EDITABLE` | checkbox `parts-view.tsx:1282-1289` → `buildPartRemark` | current PumpShell Fact |
| `openOffset` | `VISIBLE_EDITABLE` | number input `:1291-1302` → `buildPartRemark` | old/transition source; not target final authority |
| `defaultUpperBearing`, `defaultUpperBearingPartId` | `VISIBLE_EDITABLE` | selector `:1150` → `buildPartRemark` | visible legacy/transitional prefill |
| `defaultLowerBearing`, `defaultLowerBearingPartId` | `VISIBLE_EDITABLE` | selector `:1150` → `buildPartRemark` | visible legacy/transitional prefill |
| `defaultOilSealDia`, `defaultBearingSpan`, `defaultImpellerDia`, `defaultImpellerSpan`, `defaultImpellerDepth`, `defaultThreadLength`, `defaultThreadDia`, `defaultStackOffset` | `HIDDEN_ROUND_TRIPPED` | parsed from remark into form state (`:182-214`), passed to `buildPartRemark` (`:539-557`), but no visible PumpShell input | legacy technical defaults retained by edit/save path; not current UI editing semantics |
| `openFactor`, `barrelLength`, `barrelLengthPresets` | `READ_ONLY_COMPATIBILITY` / `NOT_CURRENT_UI` | no current form state/control; still read by compatibility code where applicable | legacy only; normal PumpShell save may not preserve unknown old keys |

The currently visible bearing selectors are not evidence that bearings belong to PumpShell's current final authority: Recipe independently exposes upper/lower bearing selectors, Template can infer them from components, and rotor draft still reads Shell display names only as fallback.

## Template rotor parameter status

`pump_shell_templates.rotor_params_json` is still consumed by `applyTemplateRotorParams()` after component heuristics and before Shell metadata defaults (`rotorTemplateDraft.cjs:80-128`). It is therefore a real current implementation input, but under Owner semantics it is `TRANSITIONAL_PREFILL` / `COMPATIBILITY`, not the final rotor authority. Template remains the normal materials/configuration skeleton, and Recipe may override every supported rotor parameter.

## Rotor drawing authority: current versus target

### A. Current implementation precedence (low → high)

| Parameter group | Current server precedence |
|---|---|
| bearings / oil seal | Template component/model heuristic → Template `rotor_params_json` → PumpShell `default*` only if empty → Recipe `technical_data_json` |
| bearing span | Template rotor params → Shell `defaultBearingSpan` only if empty → Variant `barrel_length - Shell offset` → Recipe `custom_barrel_length - Shell offset` → Recipe `technical_data_json.bearingSpan` |
| impeller bore/span | Template params → Shell defaults only if empty → Recipe technical JSON |
| impeller depth | Template params → Shell default → Recipe technical JSON → dedicated `impeller_thickness` only if patch empty |
| thread / stack | Template params → Shell defaults only if empty → Recipe technical JSON |
| piece count / rotor diameter | Template params → Recipe technical JSON; Web additionally links coil sheets to piece count |

### B. Target business authority

```text
Recipe final technical configuration
  ├── non-stainless: explicit final bearingSpan
  ├── stainless: barrelLength + openOffset → derived bearingSpan
  └── all final rotor values
        ↓
Rotor Drawing authoritative input
```

Template parameters, Template component heuristics, PumpShell `default*`, `openFactor`, and old remark data are prefill/legacy compatibility only. They must never be represented by future Ontology as the final Rotor Drawing authority.

## Formal relation and cost boundary

`catalog_template_shell_bindings(template_id UNIQUE, shell_part_id)` is the authoritative current **identity relation when present**. Bundle Template creation requires active PumpShell `shellPartId`; components mode can remain unbound. Name/model and suffix resolution is only compatibility when no binding exists.

Technical authority and cost authority are separate:

- Bundle mode prices `template.bundle_cost`; the bound Part supplies identity/model/supplier, not necessarily the price.
- Components mode prices `shell_components_json` catalog items; PumpShell Part itself need not be a priced BOM row.
- `recipeBomEngine` builds the BOM and `costEngine` remains the full-cost boundary.

Moving technical authority to Recipe does **not** make `parts.price` the cost authority.

## Revised PUMPSHELL TECHNICAL DEBT

### PS-TD-01 — structured historical engineering data in generic `parts.remark`

Current source: PumpShell remark JSON and generic Part parse/write. Risk: no authority/provenance boundary. Action: consolidate only after approved migration design.

### PS-TD-02 — old PumpShell rotor defaults remain stored and consumed after authority moved to Recipe

Current source: `default*` remark keys; `applyShellMetaDefaults()`. Risk: runtime fallback can be mistaken for current business authority. Action: classify as legacy/transitional and eventually retire through explicit migration.

### PS-TD-03 — server stainless derivation does not guard on `isStainless`

Current source: `rotorTemplateDraft.cjs:198-203`. Risk: a non-stainless record with length/offset can derive a span. Action: future runtime correction after Owner-approved semantics.

### PS-TD-04 — same rotor parameter exists in PumpShell, Template, Recipe JSON and some Recipe columns

Risk: procedural precedence shadows a supposed final value. Action: future source-of-truth consolidation per parameter.

### PS-TD-05 — bearing ID and display-name consumers diverge

Current source: PumpShell stores both; physical identity/audit uses IDs while rotor fallback reads labels. Action: use Recipe final bearing values; later migrate compatibility consumers safely.

### PS-TD-06 — legacy `openFactor`, `barrelLength`, `barrelLengthPresets` remain readable

Risk: historical values may affect a new workflow without a declared authority. Action: deprecate only with data plan.

### PS-TD-07 — Template→PumpShell formal binding is optional

Risk: unbound components templates can remain name-dependent. Action: technical policy decision/cleanup later; no change in this ticket.

### PS-TD-08 — PumpShell price is not the universal cost authority

Risk: commercial price and Template bundle/components cost are confused. Action: retain current cost boundary and document it.

### PS-TD-09 — UI and server stainless behaviour differ

UI guards span linkage with stainless; server does not. Action: reconcile only in a future runtime ticket.

### PS-TD-10 — hidden old defaults silently round-trip through Part edit/save

`parsePumpShellMeta()` fills hidden form state and `buildPartRemark()` writes it back. Risk: obsolete data persists invisibly and appears “maintained”. Action: do not remove during audit; future deprecation plan.

### PS-TD-11 — target Recipe openOffset has no formal current representation

Recipe has `custom_barrel_length`, but no dedicated field or fixed technical-data key for `openOffset`; current derivation reads PumpShell. Risk: target Recipe authority cannot yet be represented faithfully. Action: future Recipe technical-authority design, not a PumpShell change.

## Audit decisions

- **Part Base:** remains lightweight: `parts.id`, model, category/subcategory, supplier, price, stock, lifecycle and optional metadata.
- **PumpShell Extension:** should be smaller than V1: `isStainless`, Template relation, and Recipe configuration-policy applicability—not the full rotor profile.
- **Recipe:** needs future Technical Facts plus Derived Facts, including a formal stainless configuration context and final rotor values.
- **Generic design:** a future generic Part category-extension composition remains needed; a cross-entity configuration-policy mechanism is additionally needed to express `PumpShell.isStainless → Recipe required/derived facts` without PumpShell-specific validator code.
