# 成本规则地图

本文档记录当前系统中已经存在的成本规则，作为后续收口到统一成本引擎和动态规则配置的依据。

## 总成本结构

配方成本由以下部分组成：

- 泵壳模板成本：整套报价或组件明细
- 模板固定配件：轴承、油封、螺丝等
- 线圈转子
- 电容
- 选配配件
- 动态配置：浮球、电缆、电缆接头配件
- 包装材料
- 人工工资：安装、打包
- 表面处理
- 管理费

单次成本计算优先以后端 API 为准，前端仅用于表单输入和预览展示。

当前已收口的后端服务：

- `api/services/costEngine.cjs:calculateRecipeCost`：通用配方零件成本重算，支持电缆配件费、浮球新界式加价和参数化长螺丝。
- `api/services/costEngine.cjs:buildRecipeCostDraft`：配方保存前生成 `partsJson` 标准化结果、`savedTotalCost` 和 `savedCostDetails`。
- `api/services/dynamicCostPreview.cjs:calculateRecipeCostPreview`：报价覆盖试算，以配方快照为基线重算覆盖项。
- `api/services/costEngine.cjs:calculatePackingEstimate`：包装材料估算。
- `api/services/costEngine.cjs:calculateOverheadEstimate`：人工、表面处理和管理费估算。

## 零件价格匹配

当前规则：

1. 优先按 `model + supplier` 精确匹配。
2. 如果没有精确匹配，则按同 `model` 的最低价回退。
3. 如果仍未找到，则计入缺失项或返回 0。

现有位置：

- `src/utils/partHelpers.ts`
- `api/services/costEngine.cjs`
- `api/routes/cost.cjs`
- `src/pages/QuotationsPage.tsx`

后续目标：继续统一到后端成本引擎，前端工具只做库存价格查询和展示辅助。

## 泵壳模板

泵壳模板支持两种成本模式：

- `bundle`：整套泵壳成本，使用 `bundleCost`
- `components`：组件明细，逐项累加

组件明细支持两种计价：

- `fixed`：固定数量乘以单价
- `lengthCm`：按机筒长度换算为厘米计价

当前按长度计价规则：

```text
数量 = effectiveBarrelLength / 10
effectiveBarrelLength 仅来自配方 customBarrelLength 或型号变体 barrelLength；未填写时使用组件自身 qty 作为兜底数量。
```

现有位置：

- `src/pages/RecipeFormPage.tsx`
- `src/components/recipe/StepTemplateSelect.tsx`
- `api/routes/cost.cjs`

## 不锈钢机筒

泵壳零件的 `notes` JSON 中保存不锈钢机筒元数据：

- `isStainless`
- 出图备用参数，含 `openOffset`

零件库不再新增维护默认机筒长度和常用长度预设；历史 `barrelLength` / `barrelLengthPresets` 仅作兼容读取。

当前开档展示规则：

```text
开档 = 机筒长度 - openOffset
```

当前只在前端展示和转子出图预填中使用。

## 长螺丝

当前已有型号变体级规则：

```text
长螺丝长度 = barrelLength + longScrewExtraLength
```

现有位置：

- `src/pages/RecipeFormPage.tsx`
- `src/components/ModelVariantSection.tsx`

问题：

- 旧规则只在前端生效；现已在保存成本快照时由 `api/services/costEngine.cjs:buildRecipeCostDraft` 再次应用。
- 通过名称包含“长螺丝”识别，缺少结构化规则。
- 价格由目标型号中的长度套用按长度计价公式。

当前规则：

```text
不锈钢机筒长度 = 配方 customBarrelLength 优先，否则型号变体 barrelLength。
长螺丝与不锈钢机筒绑定，长度 = 不锈钢机筒长度 + longScrewExtraLength。
默认 longScrewExtraLength = 0mm，未设置时不改模板长螺丝型号。
保存型号长度 = 不锈钢机筒长度 + longScrewExtraLength。
```

保存快照时会在长螺丝配件上记录：

- `dynamicRule: longScrewByBarrelLength`
- `barrelLength`
- `longScrewExtraLength`
- `requestedScrewLength`
- `screwLength`

## 长螺丝参数化计价

零件库中可只维护一个基础螺丝零件，例如：

```text
类别：螺丝
型号：φ6 不锈钢长螺丝
notes.screwPricing:
  enabled: true
  diameter: 6
```

计价规则：

```text
单价 ≈ 0.00424 × 螺丝长度 - 0.198
最终单价 = max(0, 上述结果)，并按金额保留 2 位小数
```

例如：`195mm` 单价约为 `0.63`，`200mm` 单价约为 `0.65`。

保存型号变体时，如果模板固定配件中包含长螺丝、变体配置了不锈钢机筒长度，且零件库中还没有目标长度型号，会自动新增一个 `螺丝` 类零件：

```text
型号：6*210
类别：螺丝
单价：按参数化基础螺丝公式计算
库存：0
```

保存配方时也会执行同样的兜底：如果 `partsJson` 已经包含按长度算好快照价的长螺丝，但零件库尚无该型号，会用快照单价新增对应螺丝零件。

保存快照时若匹配到参数化基础螺丝，会覆盖长螺丝的 `snapshotPrice`，并记录：

- `costSource: screw_pricing`
- `screwPricingModel`
- `screwPricingSupplier`

通用成本重算也会应用同一计价规则：

- 后端权威：`api/services/costEngine.cjs:calculateRecipeCost`

后续目标：

```text
把螺丝参数化计价扩展为更通用的“参数化零件计价”规则。
```

## 线圈转子

线圈成本以后端为主：

```text
成本 = 单价 × 片数 + 线重 × 铜价基准 + 线圈工费 + 转子费
```

非精确片数支持插值或外推。

现有位置：

- `api/services/coilCost.cjs`
- `/api/coils/calculate`
- `/api/cost/full-estimate`
- `POST /api/recipes/bom-draft`
- `POST /api/recipes/:id/cost-preview`

当前状态：线圈计算接口、full-estimate、BOM 草稿和报价覆盖试算已复用同一套精确匹配、插值、外推和材质单价回退规则。

## 浮球

当前规则：

```text
浮球型号 = 浮球-线径{wire}
新界式价格 = 基础浮球价格 + float_accessory_delta
```

`float_accessory_delta` 存于 `system_settings`。

现有位置：

- `src/pages/RecipeFormPage.tsx`
- `src/components/recipe/StepPartsConfig.tsx`
- `src/components/parts/PartFormPanel.tsx`
- `api/db.cjs`
- `api/routes/cost.cjs`

## 电缆

当前规则：

```text
电缆型号 = 电缆-线径{wire}
电缆成本 = 电缆单价 × 长度
总成本 = 电缆成本 + 电缆接头配件费
```

电缆接头配件费优先读取全局 `cable_accessories` 设置，兼容旧的零件 notes 和 `电缆配件费` 零件。

现有位置：

- `src/utils/partHelpers.ts`
- `src/pages/RecipeFormPage.tsx`
- `src/components/recipe/StepPartsConfig.tsx`
- `src/components/parts/PartFormPanel.tsx`
- `api/db.cjs`
- `api/routes/cost.cjs`

## 包装材料

当前规则：

```text
型号包含“木箱” => 木箱
型号包含“彩” => 彩印纸箱
型号包含“泡沫” => 泡沫
型号包含“商标” => 商标
型号包含“说明书” => 说明书
型号包含“珍珠棉” => 珍珠棉
否则 => 牛皮纸箱
```

现有位置：

- `src/pages/RecipeFormPage.tsx`
- `src/components/recipe/StepPartsConfig.tsx`
- `src/pages/QuotationsPage.tsx`

后续目标：集中为公共业务规则，并在后端成本引擎中生成权威结果。

## 人工、表面处理、管理费

当前规则：

- 安装工资、打包工资绑定泵壳模板，配方可覆盖。
- 管理费默认值存于 `system_settings.management_fee`。
- 表面处理支持 `none`、`painting`、`electrophoresis`、`powder_coating`、`electrophoresis_powder_coating`。
- 喷漆默认 `3` 元目前写在前端。

现有位置：

- `src/components/recipe/StepWageConfirm.tsx`
- `src/pages/RecipeFormPage.tsx` 负责表单预览
- `api/services/costEngine.cjs` 负责配方保存快照
- `api/routes/cost.cjs`

后续目标：表面处理默认值迁移到系统设置或规则配置。
