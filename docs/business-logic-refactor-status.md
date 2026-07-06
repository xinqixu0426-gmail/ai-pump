# 业务逻辑整理进度与后续任务

> 更新日期：2026-06-29。本文记录本轮前端业务规则整理、成本规则收口和长螺丝模块改造进度，作为继续开发的任务清单。

## 1. 当前目标

本轮工作的核心目标是减少业务规则散落在前端页面中的情况，让关键计算逻辑有明确位置，后续能逐步迁移到后端统一成本引擎。

当前优先级：

1. 先把规则“找得到、讲得清”。
2. 再把高风险成本规则从页面移动到服务层。
3. 最后统一 Web、后端 API、AI/自动化、小程序可能复用的业务口径。

## 2. 已完成整理

### 2.1 业务规则地图

已新增 `docs/cost-rules.md`，记录当前成本相关规则：

- 总成本结构。
- 零件价格匹配。
- 泵壳模板计价。
- 不锈钢机筒。
- 长螺丝长度规则。
- 长螺丝参数化计价。
- 线圈、浮球、电缆、包装、工资、表面处理、管理费。

### 2.2 前端公共业务规则

已新增 `src/utils/businessRules.ts`，集中存放前端可复用的小规则：

- 默认包装材料。
- 默认线圈材质。
- 默认利润率。
- 默认浮球新界式加价。
- 默认喷漆成本。
- 包装材料推断。
- 零件型号/供应商取价。
- 线径型号拼接。
- 电容值解析。
- 长螺丝长度规则。
- 长螺丝参数化计价规则。

### 2.3 后端成本服务

已新增 `api/services/costEngine.cjs`，开始承接后端成本规则：

- 金额四舍五入。
- 非负数字校验。
- 零件价格取价辅助。
- 按机筒长度计价辅助。
- 包装估算。
- 人工、表面处理、管理费估算。
- 配方保存成本快照生成。
- 长螺丝长度规则。
- 长螺丝参数化计价。

### 2.4 配方保存成本快照后端化

已新增接口：

```text
POST /api/recipes/cost-draft
```

用途：

- 标准化配方 parts。
- 生成 `savedTotalCost`。
- 生成 `savedCostDetails`。
- 应用长螺丝长度和参数化计价规则。
- 不写数据库，只返回草稿计算结果。

前端 `RecipeFormPage.tsx` 保存配方时已改为调用该接口。

### 2.5 长螺丝长度规则

当前规则：

```text
不锈钢机筒长度 = 配方 customBarrelLength 优先，否则使用型号变体 barrelLength
长螺丝与不锈钢机筒绑定，长度 = 不锈钢机筒长度 + 型号变体/配方中的 longScrewExtraLength
默认 longScrewExtraLength = 0mm，未设置时不改模板长螺丝型号
```

示例：

```text
170mm + 25mm = 195mm
172mm + 25mm = 197mm -> 向上取整为 200mm
```

### 2.6 长螺丝参数化计价模块

已支持在零件库只维护一个基础螺丝零件，例如：

```text
类别：螺丝
型号：φ6 不锈钢长螺丝
单价：170mm 基准单价
```

在零件录入表单中开启“按长度自动计价”，配置：

```text
螺丝直径：6
```

计价公式：

```text
单价 ≈ 0.00424 × 螺丝长度 - 0.198
最终单价 = max(0, 上述结果)，并按金额保留 2 位小数
```

已覆盖链路：

- 配方录入实时预览。
- 配方保存成本快照。
- 配方详情/通用成本重算。
- 报价覆盖试算。
- 订单采购清单。
- AI/自动化采购清单。

### 2.7 文档同步

已更新：

- `docs/cost-rules.md`
- `docs/api-reference.md`
- `docs/README.md`

## 3. 当前业务逻辑边界

### 3.1 配方 BOM 组装已收口

配方 BOM 组装已拆分为前端预览 helper 和后端草稿接口：

```text
src/utils/recipeBomBuilder.ts
src/utils/recipeBomDraftPayload.ts
api/services/recipeBomEngine.cjs
POST /api/recipes/bom-draft
```

`RecipeFormPage.tsx` 现在主要保留表单状态、effect、子组件连接和 UI 结构。正式保存前优先使用后端 BOM draft / cost draft，前端 builder 作为预览与回退。

### 3.2 前端预览与后端权威成本边界

前端仍保留实时预览所需的展示级计算，但正式成本口径以后端服务/API 为准：

```text
api/services/costEngine.cjs
api/services/recipeBomEngine.cjs
api/services/dynamicCostPreview.cjs
api/services/orderPlanning.cjs
```

`src/utils/costCalculator.ts` 已删除，避免形成第二套正式成本口径。

### 3.3 报价页面规则已收口

报价项金额联动、客户默认利润率、包装摘要、报价转订单对象生成已移入：

```text
src/utils/quotationRules.ts
src/utils/quotationOrderBom.ts
src/utils/quotationOrderConversion.ts
```

`QuotationsPage.tsx` 主要保留状态、筛选、弹窗、保存调用和 UI 展示。

### 3.4 订单采购展开已收口到后端

订单采购清单生成已经迁移到：

```text
api/services/orderPlanning.cjs
POST /api/orders/purchase-plan
```

Web 订单页面和 AI/自动化订单工具均复用该后端服务。`src/utils/orderStore.ts` 中旧的本地采购清单生成逻辑已删除。

采购中心页面中的采购任务聚合、采购状态判断、统计摘要和批量更新订单规则已经移入：

```text
src/utils/purchaseCenterRules.ts
```

`PurchaseCenterPage.tsx` 现在主要保留筛选状态、弹窗确认、保存调用和表格展示。

### 3.5 成本计算体系当前状态

当前存在多个服务入口，但边界已经明确：

- `api/services/costEngine.cjs`
- `api/services/dynamicCostPreview.cjs`
- `api/services/dynamicConfigCost.cjs`
- `api/services/fullCostEstimate.cjs`
- `api/db.cjs:calculateRecipeCost` 兼容导出

配方保存成本草稿、报价覆盖成本试算、订单采购计划已经迁到后端服务。旧的通用 `calculateRecipeCost` 与前端展示预览的边界已经明确：后端服务为权威，前端不再保留独立成本计算口径。
当前通用 `calculateRecipeCost` 的纯计算本体已经迁入 `api/services/costEngine.cjs`，`api/db.cjs` 仅保留兼容导出并注入 `getSetting`。

## 4. 后续任务列表

### P0：补自动测试

- [x] 为 `api/services/costEngine.cjs` 增加长螺丝规则测试。
- [x] 测试 `170 + 25 => 195`。
- [x] 测试 `172 + 25 => 200`。
- [x] 测试无机筒长度时不改长螺丝。
- [x] 测试参数化计价：按 `0.00424 × 长度 - 0.198`，195mm 得到 0.63。
- [x] 测试报价覆盖 `customBarrelLength` 后会重算长螺丝。
- [x] 测试采购清单能从参数化基础螺丝找到供应商。

补充记录：新增 `npm test`，使用 Node 内置 `node:test`，当前测试文件为 `tests/costEngine.test.cjs`。测试过程中发现并修复了“无机筒长度时错误生成 `6*25`”的问题。

### P1：抽离配方 BOM 组装逻辑

- [x] 新增 `src/utils/recipeBomBuilder.ts`。
- [x] 从 `RecipeFormPage.tsx` 移出模板配件组装逻辑。
- [x] 移出泵壳组件按 cm 计价逻辑。
- [x] 移出线圈、电容、浮球、电缆、包装、选配件组装逻辑。
- [ ] 页面只负责表单状态和调用 builder/API。
- [x] 抽离后重新跑 `npm run build`。

补充处理：新增 `src/utils/technicalReferences.ts`，将 `RecipeFormPage.tsx` 中泵壳 notes 和模板转子参数生成技术参考字段的长逻辑移出页面，并补测试覆盖。

补充处理：新增 `src/utils/recipePayload.ts`，将 `RecipeFormPage.tsx` 中保存配方时组装 `Omit<Recipe, 'Id'>` 的逻辑移出页面；页面只负责调用成本草稿接口和提交保存。已补测试覆盖包装、选配件、数值字段和表面处理字段序列化。

补充处理：新增 `src/utils/recipeCostSummary.ts`，将 `RecipeFormPage.tsx` 底部浮动成本面板的分项金额汇总移出页面；页面只使用 `costSummary` 展示模板、线圈、选配+电容、动态配置、包装、人工和总成本。已补测试覆盖分项金额和总成本。

补充处理：新增 `src/utils/recipePrefill.ts`，将 `RecipeFormPage.tsx` 编辑/复制时解析 `packingPartsJson`、旧 `boxType`、`extraPartsJson` 和旧 `partsJson` 的预填逻辑移出页面。已补测试覆盖新结构包装、旧包装字段、选配件和旧配方 parts 回填。

补充处理：新增 `src/utils/recipeTemplateContext.ts`，将 `RecipeFormPage.tsx` 中模板配件 JSON、泵壳组件 JSON、泵壳 notes、有效机筒长度、长螺丝长度和模板配件长螺丝调整的上下文推导移出页面。已补测试覆盖坏 JSON 兼容、自定义机筒长度优先和长螺丝长度调整。

补充处理：新增 `src/utils/recipeCoilForm.ts`，将 `RecipeFormPage.tsx` 中线圈计算请求体生成、线圈结果联动浮球/电缆线径、电容型号匹配逻辑移出页面。已补测试覆盖默认材质、自定义线重、线径联动和电容型号兼容匹配。

补充处理：新增 `src/utils/recipeFormActions.ts`，将 `RecipeFormPage.tsx` 中型号变体应用、叶轮字段重置、选配件增删改这些表单动作规则移出页面。已补测试覆盖型号变体字段映射、叶轮清空和选配件型号变化时清空供应商。

补充处理：新增 `src/utils/recipeBomDraftPayload.ts`，将 `RecipeFormPage.tsx` 中 `/api/recipes/bom-draft` 请求参数组装、空选配过滤、包装材料推断和线圈默认材质处理移出页面。已补测试覆盖是否需要请求 BOM draft、选配件过滤、包装材料推断和线圈默认材质。

补充处理：新增 `src/utils/recipeSubmitFlow.ts`，将 `RecipeFormPage.tsx` 中保存前成本草稿请求、后端草稿 parts 回填、最终 `Recipe` payload 组装移出页面。页面保留表单校验、保存状态、创建/更新和跳转控制。已补测试覆盖成本草稿 payload 和使用后端重算 parts 保存。

当前判断：`RecipeFormPage.tsx` 剩余主要是状态、effect、子组件连接和 UI 结构；继续强行拆分收益下降。后续优先把报价页和订单页中仍偏业务规则的逻辑继续收口。

### P1：定义后端 BOM Builder 目标接口

- [x] 设计后端接口草案：`POST /api/recipes/bom-draft`。
- [x] 输入表单草稿，返回标准化 BOM。
- [x] 暂不急着替换前端，先让接口和前端 builder 输出保持一致。
- [x] 同步更新 `docs/api-reference.md` 和 `docs/README.md`。

当前处理：新增 `api/services/recipeBomEngine.cjs` 和 `POST /api/recipes/bom-draft`。接口可基于模板、型号变体、机筒长度、线圈、电容、浮球、电缆、包装和选配件生成标准化 BOM；Web 配方页已优先使用后端 BOM 草稿结果，本地 `recipeBomBuilder.ts` 仅作为预览回退。

### P2：收口订单采购清单逻辑

- [x] 新增后端采购清单生成服务。
- [x] Web 订单页面调用后端生成采购清单。
- [x] AI/自动化订单工具复用同一个后端服务。
- [x] 明确参数化基础螺丝是否参与库存扣减。

当前处理：新增 `api/services/orderPlanning.cjs` 和 `POST /api/orders/purchase-plan`。采购清单按 BOM × 订单数量汇总并扣库存；参数化长螺丝会借用基础螺丝供应商，但不会扣基础螺丝库存，也不会把基础螺丝 `partId` 写到目标长度采购项上。

### P2：收口报价转订单逻辑

- [x] 检查 `QuotationsPage.tsx` 中报价转订单的 `partsJson` 保存方式。
- [x] 明确报价覆盖项转订单时，应保存“覆盖参数”还是“展开后的 BOM 快照”。
- [x] 避免订单采购清单拿到的只是 overrides 而不是完整 BOM。

当前处理：报价转订单时会保存完整 BOM 快照。基础配方 parts 会先按报价覆盖项重新展开浮球、电缆、电缆配件费和包装，再通过 `POST /api/recipes/cost-draft` 重新应用定制机筒对应的长螺丝长度和参数化计价。

补充处理：新增 `src/utils/quotationRules.ts`，将 `QuotationsPage.tsx` 中 JSON 数组安全解析、包装快照解析、线圈快照读取、报价项成本/加价/手输单价联动、客户默认加价率应用、基础配方默认 overrides、报价合计和包装摘要移出页面。已补测试覆盖包装快照、线圈快照、报价项金额联动、默认 overrides、合计金额和包装摘要。

补充处理：新增 `src/utils/quotationOrderConversion.ts`，将 `QuotationsPage.tsx` 中报价转订单的 orderItems 生成、报价覆盖 BOM 展开、成本草稿回填和订单对象组装移出页面。页面仅保留确认弹窗、保存订单、更新报价状态和刷新数据。已补测试覆盖成本草稿回填 BOM 和订单客户/备注生成。

当前判断：`QuotationsPage.tsx` 剩余内容主要是状态、筛选、弹窗、保存调用和 UI 展示；报价项金额联动、客户利润率、包装摘要、报价转订单对象生成已经有独立 helper 和测试覆盖。

### P2：收口采购中心页面规则

- [x] 新增 `src/utils/purchaseCenterRules.ts`。
- [x] 移出采购任务按供应商/型号聚合逻辑。
- [x] 移出采购项状态判断、状态文字和状态颜色逻辑。
- [x] 移出采购中心统计摘要逻辑。
- [x] 移出批量标记已采购/取消已采购时的订单更新逻辑。
- [x] 补测试覆盖聚合、状态、统计和订单更新边界。

当前处理：`PurchaseCenterPage.tsx` 不再直接承载采购任务聚合和订单更新规则，只负责筛选、确认弹窗、调用 `saveOrder` 和刷新数据。

### P2：收口订单表单页面规则

- [x] 新增 `src/utils/orderFormRules.ts`。
- [x] 移出配方 parts JSON 安全解析和无保存成本时的成本回退计算。
- [x] 移出“选择配方加入订单”时的订单明细生成和历史价格缓存规则。
- [x] 移出订单明细数量、利润率、手输出厂价联动规则。
- [x] 移出提交订单前的 `Order` 对象组装。
- [x] 移出步骤校验规则。
- [x] 补测试覆盖保存成本优先、成本计算回退、历史价格缓存、价格联动、提交对象组装和步骤校验。

当前处理：`OrderFormPage.tsx` 继续负责数据加载、React 状态、采购计划预览、保存调用和跳转；订单明细生成与价格联动规则已经有独立 helper 和测试覆盖。

### P2：收口订单列表与详情生命周期规则

- [x] 新增 `src/utils/orderLifecycleRules.ts`。
- [x] 移出订单状态颜色映射。
- [x] 移出订单 KPI 汇总规则。
- [x] 移出订单筛选、排序和采购进度统计规则。
- [x] 移出订单状态更新对象生成规则。
- [x] 移出采购项已采购勾选和采购 To-Do 勾选规则。
- [x] 移出确认采购完成时的库存入库增量和订单完成状态生成规则。
- [x] 补测试覆盖 KPI、筛选排序、采购进度、采购/todo 勾选、确认入库和订单状态更新。

当前处理：`OrdersPage.tsx` 主要保留筛选控件、分页、表格和状态保存调用；`OrderDetailModal.tsx` 主要保留弹窗状态、入库 API 调用、保存调用和 UI 展示。订单生命周期规则已经集中到 helper。

### P2：收口客户页面规则

- [x] 新增 `src/utils/customerRules.ts`。
- [x] 移出客户表单默认值和编辑回填规则。
- [x] 移出默认加价率输入解析规则，避免空输入生成 `NaN`。
- [x] 移出客户关联报价筛选、报价数量统计、报价总额和最近报价日期规则。
- [x] 移出报价状态颜色映射。
- [x] 补测试覆盖客户表单、报价统计、客户报价数量和报价状态颜色。

当前处理：`CustomersPage.tsx` 主要保留客户/报价 CRUD 调用、选中状态、弹窗和表格展示。客户默认加价和报价统计规则已经集中到 helper。

### P2：收口零件表单规则

- [x] 新增 `src/utils/partFormRules.ts`。
- [x] 移出线径类别、 电容类别、默认机筒长度预设和电缆配件默认名称。
- [x] 移出泵壳 `notes` 元数据解析，兼容旧 `openFactor` 字段。
- [x] 移出电缆配件 `notes` 解析，兼容旧 `cableAccessoryFee` 字段。
- [x] 移出参数化螺丝 `notes` 解析。
- [x] 移出线径/电容结构化型号回填和最终型号拼接规则。
- [x] 移出零件表单校验规则，包含电缆配件费、新界式浮球加价和螺丝参数化配置。
- [x] 移出泵壳、电缆线、螺丝三类 `notes` JSON 组装规则。
- [x] 移出电缆配件全局设置 payload 组装和浮球加价解析规则。
- [x] 补测试覆盖 notes 解析、旧字段兼容、结构化型号、校验、notes 组装和全局设置 payload。

当前处理：`PartFormPanel.tsx` 继续负责输入控件、state、全局设置 API 调用和保存调用；零件元数据规则已经集中到 helper。

### P2：收口运营看板与顶部角标规则

- [x] 新增 `src/utils/dashboardRules.ts`。
- [x] 移出订单按状态分组规则。
- [x] 移出顶部采购待办数和缺货零件数统计规则。
- [x] 移出看板 KPI fallback 统计规则。
- [x] 移出营收/利润趋势数据生成规则。
- [x] 移出今日工作台 fallback 数据生成规则，包含待采购、可确认入库、缺货零件、今日新增订单和供应商关注列表。
- [x] 后端 `BusinessSummary` 存在时仍优先使用后端汇总，前端 helper 只做展示适配和离线 fallback。
- [x] 补测试覆盖状态分组、顶部角标、KPI、趋势、工作台 fallback、今日日期判断和后端汇总优先。

当前处理：`DashboardPage.tsx` 主要保留图标/颜色展示映射、页面布局和 API 加载；`TopBar.tsx` 复用同一套统计 helper 生成角标。

### P2：收口配方列表与生产库存预检规则

- [x] 新增 `src/utils/recipeListRules.ts`。
- [x] 移出配方 `partsJson` 安全解析和有效配件过滤。
- [x] 移出配方列表配件概览生成规则。
- [x] 移出配方人工/管理费兜底计算，兼容旧 `savedCostDetails` 文本快照。
- [x] 移出保存总成本优先、实时成本加人工兜底和计算失败兜底逻辑。
- [x] 新增 `src/utils/recipeProductionRules.ts`。
- [x] 移出生产库存预检规则，按 `model + supplier` 精确匹配并回退到同型号。
- [x] 移出库存不足、零件缺失错误文案生成。
- [x] 移出生产扣库存 payload 生成。
- [x] 补测试覆盖配方列表成本兜底、旧人工快照、库存预检、库存不足/零件缺失和扣库存 payload。

当前处理：`RecipesPage.tsx` 主要保留数据加载、弹窗状态和表格展示；`RecipeDetailModal.tsx` 主要保留详情展示、生产确认状态和扣库存 API 调用。库存预检和扣减数据规则已经集中到 helper。

补充处理：`RecipeFormPage.tsx` 底部成本明细分组和缺失项统计已迁入 `src/utils/recipeCostSummary.ts`；页面只负责打开明细弹窗和渲染分组。同步修复包装材料浮动汇总未乘数量的问题，并补测试覆盖包装数量和缺失包材标记。

### P3：继续清理重复成本逻辑

- [x] 评估并迁移 `api/db.cjs:calculateRecipeCost` 到 `api/services/costEngine.cjs`。
- [x] 评估 `src/utils/costCalculator.ts` 是否只保留展示级预览。
- [x] 删除无运行时引用的 `src/utils/costCalculator.ts`，避免形成第二套成本口径。
- [x] 拆分 `api/routes/cost.cjs` 中的报价覆盖动态试算到服务函数。
- [x] 拆分 `api/routes/cost.cjs` 中旧动态配置成本到服务函数。
- [x] 拆分 `api/routes/cost.cjs` 中 `/cost/full-estimate` 的线圈估算和结果组装到服务函数。
- [x] 合并后端服务中重复的电缆配件名称/费用解析逻辑。

当前处理：新增 `api/services/dynamicCostPreview.cjs`，`POST /api/recipes/:id/cost-preview` 和 legacy `/api/cost/dynamic-calculate` 只负责取数、调用服务和返回响应。已补测试覆盖 `customBarrelLength` 覆盖后长螺丝长度与参数化单价重算。

补充处理：`calculateRecipeCost` 已从 `api/db.cjs` 迁入 `api/services/costEngine.cjs`；`db.cjs` 继续导出同名函数以兼容现有路由和 AI executor。已补测试覆盖浮球新界式加价、电缆配件全局配置、参数化长螺丝。

补充处理：`src/utils/costCalculator.ts` 确认没有运行时引用后已删除；正式成本口径以后端 API 和 `api/services/costEngine.cjs` 为准。

补充处理：新增 `api/services/dynamicConfigCost.cjs`，`/api/cost/dynamic-config`、`/api/cost/full-estimate` 中的浮球、电缆、电缆配件费、包装箱动态配置成本已复用同一服务。`/api/cost/float` 和 `/api/cost/cable` 也改为复用该服务的单项估算函数。

补充处理：新增 `api/services/fullCostEstimate.cjs`，`/api/cost/full-estimate` 的 `stator` 解析、线圈成本估算、线径解析和组合结果 `breakdown` 已迁到服务层。

补充处理：新增 `api/services/cableAccessory.cjs`，集中处理电缆配件费、配件名称、全局配置、`partsByModel` 和扁平 `partsCatalog` 两种数据结构的回退规则。`costEngine`、`dynamicConfigCost`、`recipeBomEngine`、`dynamicCostPreview` 已复用该 helper。

补充处理：新增 `api/services/coilCost.cjs`，`/api/coils/calculate` 和 `/api/cost/full-estimate` 已共用同一套线圈材质、精确匹配、插值和外推规则，避免 full-estimate 再保留第二套线圈估算公式。

补充处理：`api/services/recipeBomEngine.cjs` 的线圈快照和 `api/services/dynamicCostPreview.cjs` 的报价覆盖线圈重算也已改为复用 `api/services/coilCost.cjs`。现在 BOM 草稿、报价覆盖试算、full-estimate 和线圈计算接口共用同一套线圈成本口径。已补测试覆盖 BOM draft 和报价覆盖的非精确片数插值。

补充处理：`api/services/costEngine.cjs` 新增 `wireModel` 和 `configuredWireModel`，`recipeBomEngine`、`dynamicConfigCost`、`dynamicCostPreview` 中浮球/电缆线径型号拼接已复用该 helper，减少后端线径命名规则重复。

补充处理：`api/services/costEngine.cjs` 新增 `inferPackingMaterial` 和 `DEFAULT_PACKAGING_MATERIAL`，`recipeBomEngine` 的包装材料推断已复用该 helper，减少后端包装规则重复。

补充处理：`api/services/costEngine.cjs` 新增 `findPartByModelAndSupplierFromCatalog` 和 `getPartPriceFromCatalog`，`recipeBomEngine` 的 catalog 配件取价已复用该 helper。当前规则仍保持：参数化长螺丝优先，否则精确供应商，否则同型号最低价。已补测试覆盖。

补充处理：P3-lite 加固成本口径边界。`api/services/costEngine.cjs`、`dynamicCostPreview.cjs`、`recipeBomEngine.cjs` 已补充保存快照、当前重算、BOM 草稿的边界说明；AI 创建/修改配方改用 `buildRecipeCostDraft` 生成保存快照；AI 创建订单/追加配方通过 `api/services/orderCostLock.cjs` 优先使用配方 `savedTotalCost`，仅在没有保存成本时回退当前重算参考价。已补契约测试覆盖保存快照与当前重算分离、AI 订单锁价优先级。

## 5. 当前建议优先顺序

建议接下来按这个顺序继续：

1. 前端业务规则整理已基本收官；后续主要做回归使用、必要的 API/服务层集成测试补强。
2. 根据实际使用情况补充 API/服务层集成测试。
3. 构建警告已处理：`orderStore.ts` 动态/静态导入混用已改为静态导入；`App.tsx` 已使用页面级 `React.lazy` 分包，`vite.config.ts` 已拆分主要 vendor chunk。

现在长螺丝、报价转订单、订单采购计划、采购中心聚合规则、订单表单价格联动、订单提交组装、订单列表筛选汇总、订单详情状态变更、入库规则、客户报价统计、零件表单参数化配置、运营看板统计、顶部角标、配方列表成本兜底和生产库存预检已经有测试或后端服务兜底。前端散落业务规则整理基本完成。

收尾验证：

- `npm test` 通过，85 个测试全绿。
- `npm run build` 通过，当前无 Vite chunk 警告。
- `fetch(` 扫描只剩 `src/utils/api.ts` 内部实现。
- `UPDATE` 扫描只剩 `safeUpdate`、软删除和启动迁移位置。
