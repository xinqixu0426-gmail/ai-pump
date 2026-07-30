# API 接口总表

> 更新于 2026-07-29。本文按当前代码整理，覆盖 Express 路由。开发规范见 [api-sop.md](./api-sop.md)，业务口径见 [README.md](./README.md)。

## 1. 通用约定

- 后端服务端口：`3002`。
- 常规 API 前缀：`/api`。
- Web 前端必须通过 `apps/web-next/lib/api.ts` 的 `proxyRequest()`、`proxyFetch()` 或 `proxyStreamFetch()` 调用。
- Web 新增或调整调用必须使用当前标准入口；历史字段兼容必须封装在 `apps/web-next/lib/*` 的 normalize/rowToX helper 内，不得扩散到页面组件。
- Web 页面层读取核心资源 ID/时间必须使用各业务 lib 输出的标准 `id/createdAt/updatedAt`，禁止直接依赖 `Id/CreatedAt/UpdatedAt`。
- 请求/响应业务字段默认使用 camelCase；数据库字段保持 snake_case。
- 核心资源 Row Adapter 标准输出 `id`、`createdAt`、`updatedAt`；历史 `Id`、`CreatedAt`、`UpdatedAt` 仅作为兼容字段，新调用方不得依赖。
- 标准成功响应：`{ "success": true, "data": ... }`。
- 标准失败响应：`{ "success": false, "error": "错误信息" }`。
- 健康检查等非业务监控入口可能保留 `{ status, message }`；业务 API 不得新增纯 `{ status, message }` 响应。
- 路由 `:id` 参数统一通过 `api/services/validation.cjs` 的 `parsePositiveId()` 解析；新增路由不得自定义 `parseId()`。
- 正式业务资源新增统一使用 `api/db.cjs` 的 `safeInsert(table, values)`，自动校验表名/列名并记录 `INSERT` 审计日志。
- 动态更新统一使用 `safeUpdate(table, id, updates)`；业务路由和 AI executor 不得直接拼写核心资源表 `INSERT INTO ...` 或动态 `UPDATE ... SET`。
- 成本基础资料写入，以及订单/报价/配方保存草稿的金额、数量、单价、利润率字段，统一使用 `parseFiniteNumber()` / `parseNonNegativeNumber()` / `parsePositiveNumber()` 校验数字。
- JSON 字段写库前使用 `stringifyJsonArray()` / `stringifyJsonObject()` 校验并序列化。

## 2. 鉴权边界

| 范围 | 鉴权方式 | 说明 |
|---|---|---|
| `POST /api/auth/login` | 公开，登录限流 | 每 IP 每分钟最多 5 次 |
| `GET /api/auth/check` | 公开读取 Cookie | 无 Cookie 时返回 401 |
| `GET /api/health` | 公开 | 监控用 |
| 常规 `/api/*` | JWT Cookie | `app.use('/api', authMiddleware)` 后保护 |
| 内部服务 | `x-internal-secret` | 与 `INTERNAL_SECRET` 匹配时绕过 JWT |
| AI / 语音 / System Prompt | JWT Cookie 或 `x-internal-secret` | 路由内部单独校验 |
| Siri | `x-siri-token` | 配置 `SIRI_API_TOKEN` 后强制校验 |

## 3. 认证

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/auth/login` | `{ password }` | 签发 HttpOnly JWT Cookie；生产环境 `secure + sameSite=strict` |
| `POST` | `/api/auth/logout` | 无 | 清除 `token` Cookie |
| `GET` | `/api/auth/check` | 无 | `{ success, authenticated, role? }` |
| `GET` | `/api/health` | 无 | `{ status: "ok", message, timestamp }`，非标准成功格式 |

## 4. 零件 Parts

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/parts` | 无 | 零件列表，Row Adapter 输出 camelCase；包装零件额外返回 `subcategory`，并临时保留 `Id/CreatedAt/UpdatedAt` |
| `POST` | `/api/parts` | `model, category, subcategory?, price, supplier, stock, remark/notes` | 新增零件；`category=包装` 时二级分类为 `外包装/内衬/固定包材`，未传时按型号和备注推断 |
| `PATCH` | `/api/parts/:id` | 可更新字段 | 更新入口；动态更新必须走 `safeUpdate('parts', id, updates)` |
| `DELETE` | `/api/parts/:id` | 无 | 软删除并返回 `{ deleted: 1 }` |
| `PATCH` | `/api/parts/prices` | `{ updates: [{ partId, price }] }` | 批量更新零件价格；`partId` 必须为正整数，`price` 必须为非负有效数字 |
| `POST` | `/api/parts/batch-stock` | `{ operations: [{ partId, delta }] }` | 批量库存增减，库存最低为 0；`partId` 必须为正整数，`delta` 必须为有效数字 |

包装零件的一级分类统一为 `包装`。二级分类只表达用途：牛皮纸箱、彩印箱和木箱归入 `外包装`；泡沫和珍珠棉归入 `内衬`；说明书、贴纸等归入 `固定包材`。具体材质和规格继续由型号及 `packagingMaterial` 表达。

## 5. 线圈 Coils

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/coils` | 无 | 绕组方案列表，返回 `diameterMm/commonName/material/slotType/schemeName/schemeStatus/stock`；`stock` 单位为套 |
| `GET` | `/api/coils/variants` | 无 | 定子组合列表；组合键为标准直径、材质和槽眼 |
| `POST` | `/api/coils` | `spec, diameterMm, material, slotType, sheets, schemeName?, schemeStatus?, unitPrice, wireWeight?, copperBase?, coilFee?, rotorFee?, defaultWireGauge?, defaultCapacitor?, mainWireGauge?, mainWireData?, auxWireGauge?, auxWireData?` | 新增绕组方案并计算 `cost`；材质仅支持钢带/冷轧，槽眼仅支持小眼/国标眼；正式方案会替换同组合同片数的原正式方案 |
| `PATCH` | `/api/coils/:id` | 线圈 camelCase 字段 | 修改定子组合或绕组方案；成本字段变化时自动重算 `cost` |
| `DELETE` | `/api/coils/:id` | 无 | 仅允许删除库存为 0 且从未产生库存流水的线圈方案；已有库存或流水时返回 `409`，避免破坏库存追溯 |
| `POST` | `/api/coils/spec-draft` | `{ spec, diameterMm?, material?, slotType? }` | 按定子组合生成录入草稿；精确组合可带入单片价，其他组合只带辅助字段；不写库 |
| `PATCH` | `/api/coils/spec/:spec` | `{ unitPrice, material?, slotType? }` | 按标准直径批量更新定子单片价，可按材质和槽眼过滤 |
| `POST` | `/api/coils/calculate` | `{ spec, sheets, material?, slotType?, wireWeight?, copperPrice? }` | `sheets` 必须为正整数，线重和铜价必须为非负数字；只使用正式方案，在同标准直径、材质和槽眼内精确匹配、插值或外推 |
| `GET` | `/api/coils/specs` | 无 | 正式方案可用的规格、标准直径、材质、槽眼和片数列表；`variants[]` 按材质+槽眼返回各自可用片数，供配方联动选择 |
| `GET` | `/api/coils/:id/stock-movements` | 查询参数 `limit?` | 返回指定线圈方案最近库存流水，字段为 `changeQty/balanceAfter/movementType/referenceType/referenceId/note/createdAt` |
| `POST` | `/api/coils/:id/stock-adjustment` | `{ changeQty, note? }` | 手工调整线圈成品库存；`changeQty` 必须是非零整数，负数出库时不得超过当前库存 |

## 6. 模板 Templates

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/templates` | 无 | 泵壳模板列表，标准字段含 `id/createdAt/updatedAt` |
| `GET` | `/api/templates/:id` | 无 | 单个模板 |
| `GET` | `/api/templates/:id/cost` | 无 | 模板固定配件/壳体组件成本 |
| `GET` | `/api/templates/:id/default-recipe` | 无 | 基于模板生成配方草稿、配件、转子参数和成本；`recipeDraft.templateId` 使用标准 `id` |
| `POST` | `/api/templates/:id/apply` | `{ recipe? }` | 把模板默认项应用到传入配方草稿 |
| `GET` | `/api/templates/:id/recipes` | 无 | 引用该模板的配方列表 |
| `POST` | `/api/templates` | `shellModel/shell_model` 等模板字段；`bundleNote` 为泵壳套件备注；`shellComponentsJson` 在 `components` 模式下保存自由组合组件，组件字段可含 `name/model/supplier/qty/unitCost/pricingMode/included/componentType/note`；每个计入的组件 `model` 必须存在于零件库“泵壳搭配”分类，否则返回 400；机筒名称为 `铝机筒/不锈钢拉伸筒/铁机筒`，不锈钢拉伸筒使用 `componentType=stainlessStretchBarrel`，其他组件使用 `standard`；`surfaceTreatmentMode` 支持 `none/painting/electrophoresis/electrophoresis_powder_coating/powder_coating`，`surfaceTreatmentCost` 为非负费用 | 新增模板；支持 components/bundle 成本模式和表面处理预设。`bundle` 模式的 `shellModel` 应引用零件库泵壳整套型号；`components` 模式的 `shellModel` 可手输组合名称，也可选择零件库泵壳型号；历史 `isStainlessStretchBarrel=true` 及“不锈钢拉伸机筒”名称继续兼容读取 |
| `PATCH` | `/api/templates/:id` | 同新增模板字段 | 使用 `safeUpdate` 更新 |
| `DELETE` | `/api/templates/:id` | 无 | 无配方引用时硬删除 |

## 7. 型号变体 Model Variants

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/model-variants` | 无 | 型号变体列表，标准字段含 `id/createdAt/updatedAt` |
| `POST` | `/api/model-variants` | `modelName, templateId` 必填；可带线圈、机筒、长螺丝、叶轮字段和 `customFieldsJson` | 新增变体；`customFieldsJson` 为 `[{ label, value }]` JSON 字符串；若模板含长螺丝且变体有机筒长度，会按参数化螺丝公式自动补齐对应长度的螺丝零件，响应附带 `createdLongScrewParts` |
| `PATCH` | `/api/model-variants/:id` | 同新增字段 | 更新变体；同样可能返回 `createdLongScrewParts` |
| `DELETE` | `/api/model-variants/:id` | 无 | 软删除 |

## 8. 配方 Recipes

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/recipes` | 无 | 配方列表，标准字段含 `id/createdAt/updatedAt/customBarrelLength/longScrewExtraLength` |
| `GET` | `/api/recipes/:id` | 无 | 单个配方，标准字段含 `id/createdAt/updatedAt/customBarrelLength/longScrewExtraLength` |
| `POST` | `/api/recipes/model-variant-draft` | `{ modelVariantId }` | 根据常用配置和其关联泵壳模板生成配方表单草稿；返回 `recipeDraft, variant, template`；不写库 |
| `POST` | `/api/recipes/bom-draft` | `{ templateId?, modelVariantId?, customBarrelLength?, coilSpec?, coilSheets?, coilMaterial?, coilWireWeight?, hasFloat?, hasCable?, packingParts?, optionalParts? }` | 基于配方草稿生成标准化 BOM；不写库。`coilWireWeight` 为客户指定线重，会重算线圈成本。不锈钢机筒泵壳使用套件整体价时，`customBarrelLength` 会按 150mm 基准、每增加 10mm 加 1 元修正泵壳套件快照价，加价直接反映在“泵壳套件”这一行的 `snapshotPrice` 和 `shellPrice` 上。自由组合模板中只有 `componentType=stainlessStretchBarrel` 的“不锈钢拉伸筒”组件会用 `customBarrelLength/modelVariant.barrelLength` 换算 cm 数量，并触发长螺丝长度联动；铝机筒、铁机筒按普通固定组件处理。历史 `isStainlessStretchBarrel=true` 数据继续兼容。自由组合组件取价只读取“泵壳搭配”分类。`coilSnapshot` 返回 `wireGauge/defaultCapacitor` 供浮球、电缆和电容自动匹配；返回的 `parts[]` 必须包含当前成本价 `snapshotPrice`，计算项或手动价需带 `formula/costSource/source` |
| `POST` | `/api/recipes/cost-draft` | `{ parts, assemblyWage?, packingWage?, surfaceTreatmentMode?, surfaceTreatmentCost?, managementFee?, coilMaterial?, customBarrelLength?, longScrewExtraLength?, enableLongScrewByBarrelLength? }` | 基于配方草稿生成保存用成本快照；不写库。`enableLongScrewByBarrelLength=false` 时不会把普通固定长螺丝按机筒长度重写。配方正式保存时 `customBarrelLength` 和 `longScrewExtraLength` 都会持久化，重新编辑可恢复原值 |
| `POST` | `/api/recipes/save-payload-draft` | `{ form, costDraft, packingParts?, optionalParts?, technicalData? }` | 基于表单草稿和成本草稿生成最终保存 payload；统一序列化 JSON、ID、数字和表面处理字段；`technicalData` 支持 `upperBearing/lowerBearing/pieceCount/rotorDiameter/bearingSpan/stackOffset/oilSealDiameter/impellerBoreDiameter/impellerSpan/impellerDepth/threadLength/threadDiameter` 转子出图参数；逐项检查 `costDraft.parts[].snapshotPrice`，缺失、无效或小于等于 0 时返回 400 并列出未定价 BOM 项目；`form.coilWireWeight` 会保存为客户指定线重，`form.longScrewExtraLength` 会作为非负数进入正式配方保存；不写库 |
| `GET` | `/api/recipes/:id/inventory-status` | 无 | 按配方 BOM 返回库存状态；普通配件读取零件库，线圈转子按规格、片数、材质和槽眼读取正式线圈方案库存；只读，不执行生产或扣减库存 |
| `POST` | `/api/recipes` | 配方字段，优先 camelCase | 新增配方并保存成本/技术快照；`partsJson` 中任一 BOM 项目的 `snapshotPrice` 缺失、无效或小于等于 0 时返回 400；若含已计价但零件库缺失的长螺丝型号，会自动补齐螺丝零件并返回 `createdLongScrewParts` |
| `PATCH` | `/api/recipes/:id` | 配方字段 | 更新入口；提交 `partsJson` 时执行相同的 BOM 单价检查，同样可能返回 `createdLongScrewParts` |
| `DELETE` | `/api/recipes/:id` | 无 | 软删除 |
| `GET` | `/api/recipes/:id/technical-files` | 无 | 列出配方性能测试报告附件及解析摘要，不返回文件二进制和完整解析文本 |
| `POST` | `/api/recipes/:id/technical-files` | `multipart/form-data`，字段 `file`，支持 `.xls/.xlsx`，最大 10MB | 保存原始 Excel 到 SQLite，并解析水泵性能报告的型号、测试号、日期和测试点明细；模板中的规定点、实测点和偏差不进入 API 摘要或知识检索文本 |
| `GET` | `/api/recipes/:id/technical-files/:fileId/download` | 无 | 下载原始测试报告 |
| `DELETE` | `/api/recipes/:id/technical-files/:fileId` | 无 | 软删除测试报告 |
| `GET` | `/api/recipes/:id/cost` | 无 | 当前配件重算参考，不是保存成本，也不是完整总成本 |
| `GET` | `/api/recipes/current-costs` | 无 | 批量返回所有配方的当日完整成本；普通零件按当前零件库价格、线圈按当前铜价和线圈参数重算，并叠加人工、表面处理与管理费；同时返回相对保存成本的差额 |
| `POST` | `/api/recipes/:id/cost-preview` | `{ overrides: { coilSpec?, coilSheets?, coilMaterial?, hasFloat?, floatWire?, floatAccessoryType?, hasCable?, cableLength?, cableWire?, cableAccessoryType?, packingPartsJson?, boxType?, surfaceTreatmentMode?, surfaceTreatmentCost? } }` | 报价/试算用，以配方保存成本为基线替换被覆盖的动态项；返回 `unitCost/parts/costSnapshot`，其中 `parts` 是应用覆盖后的可采购 BOM 快照。包材按完整有效清单重算，表面处理替换原工艺成本 |
| `POST` | `/api/cost/recipe-difference` | `{ leftRecipeId?/leftRecipeName?, rightRecipeId?/rightRecipeName?, limit? }` | 比较两个配方的当前成本，返回总差额和主要差异驱动项；不写库 |

## 9. 成本 Cost

### 9.1 成本入口

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/cost/parts` | `{ parts: [{ model, supplier?, qty?, snapshotPrice? }] }` | 按配件数组计算成本、缺失项和明细；不自动叠加配方工资/管理费 |
| `POST` | `/api/recipes/model-variant-draft` | `{ modelVariantId }` | 应用常用配置时生成配方草稿，统一带入模板工资、表面处理、线圈、机筒和叶轮字段；不写库 |
| `POST` | `/api/recipes/cost-draft` | `{ parts, assemblyWage?, packingWage?, surfaceTreatmentMode?, surfaceTreatmentCost?, managementFee?, coilMaterial?, customBarrelLength?, longScrewExtraLength? }` | 配方保存前生成 `savedTotalCost`、`savedCostDetails` 和标准化 `parts`，并应用长螺丝长度与参数化计价规则；旧式“电缆线 + 电缆配件费”会合并为一条成品电缆 |
| `POST` | `/api/recipes/save-payload-draft` | `{ form, costDraft, packingParts?, optionalParts?, technicalData? }` | 配方保存前检查完整 BOM 不含零价格项目并生成标准保存 payload；未定价时返回具体项目且不写库 |
| `GET` | `/api/recipes/current-costs` | 无 | 配方列表批量重算当日完整成本并返回 `currentTotalCost/savedTotalCost/difference/partsCost/laborCost` |
| `GET` | `/api/recipes/:id/cost` | 无 | 同第 8 节；只重算配件当前参考价 |
| `POST` | `/api/recipes/:id/cost-preview` | `{ overrides }` | 同第 8 节；报价页只提交浮球开关、电缆米数和组合包材覆盖，线圈、线径、铜套类型与表面处理沿用配方快照 |
| `POST` | `/api/cost/full-estimate` | `{ pumphousing_model?, stator?, statorMaterial?/material?, cableLength?, hasFloat?, floatWire?, cableWire?, floatAccessoryType?, cableAccessoryType?, boxType? }` | AI/N8N 一站式估算，组合配方、线圈和动态配置 |
| `POST` | `/api/cost/recipe-difference` | `{ leftRecipeId?/leftRecipeName?, rightRecipeId?/rightRecipeName?, limit? }` | 成本差异解释器，按金额差异输出主要驱动项 |

### 9.2 拆分估算入口

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/cost/coil` | 同 `/api/coils/calculate` | 线圈成本兼容入口 |
| `POST` | `/api/cost/float` | `floatWire?, floatAccessoryType?` 等 | 单独估算浮球成本 |
| `POST` | `/api/cost/cable` | `cableLength, cableWire?, cableAccessoryType?` 等 | 单独估算完整成品电缆；总成本包含按米计算的线材及插头/规格费用 |
| `POST` | `/api/cost/packing` | `packingParts?/packingPartsJson?/boxType?` 等 | 单独估算包装材料成本 |
| `POST` | `/api/cost/overhead` | `{ assemblyWage?, packingWage?, surfaceTreatmentCost?, managementFee? }` | 人工工资、表面处理和管理费合计 |
| `POST` | `/api/cost/dynamic` | `{ stator?/statorSpec?/statorSheets?, hasFloat?, floatWire?, hasCable?, cableWire?, cableLength?, boxType?, ...AccessoryType }` | 动态配置成本：浮球、成品电缆、包材；电缆明细不拆分线材和插头/规格费 |

### 9.3 查询和市场指标

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/cost/recipe/by-name?name=xxx` | `name` 查询参数 | 按名称包含关系查配方并计算配件成本 |
| `GET` | `/api/copper-price` | 无 | 实时铜价和数据库铜价基数 |
| `POST` | `/api/copper-price/update` | 无 | 手动同步铜价；只更新铜价基数或成本发生变化的线圈，返回 `updatedCount/skippedCount/unchanged` |
| `GET` | `/api/market-indicators` | 无 | 铜价、铝价、美元兑人民币汇率的实时值与数据库值 |
| `POST` | `/api/market-indicators/update` | 无 | 同步铜价、铝线价格基数、美元汇率；铜价未变化时跳过线圈写入 |

## 10. 客户与报价

### Customers

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/customers` | 无 | 客户列表 |
| `POST` | `/api/customers` | `{ name, contactInfo?, defaultMargin?, remark? }` | 新增客户；标准返回 `{ data: customer }` |
| `PATCH` | `/api/customers/:id` | 客户字段 | 更新客户；返回 `{ data: customer }` |
| `DELETE` | `/api/customers/:id` | 无 | 软删除 |

### Quotations

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/quotations` | 无 | 报价列表；读取时自动把超过 1 个月的“报价中”标为“已过时” |
| `POST` | `/api/quotations/save-payload-draft` | `{ customerId, status?, items, remark? }` | 后端按每个有效 `baseRecipeId` 重新试算，生成覆盖配置、完整 `bomSnapshot`、`costSnapshot`、总成本和总报价；不信任前端单位成本，不写库 |

`POST /api/quotations` 和带明细的 `PATCH /api/quotations/:id` 会再次解析 `itemsJson` 并重新汇总总成本和总报价，不信任调用方提交的合计金额。新报价只能是“草稿”或“报价中”，只有这两个状态允许修改核心明细。
| `POST` | `/api/quotations` | `{ customerId, status?, itemsJson?, totalCost?, totalPrice?, remark? }` | 新增报价；状态只能是“草稿”或“报价中”；标准返回 `{ data: quotation }` |
| `POST` | `/api/quotations/:id/order-draft` | 无 | 从报价明细的 BOM 快照生成订单预览、采购清单和待办；旧报价缺少快照时临时回退配方 BOM 并标记 `legacy_recipe_fallback`；不写库 |
| `POST` | `/api/quotations/:id/convert` | 无 | 只有“已接受”报价可转单；在同一事务内创建订单、保存 `convertedOrderId/convertedAt` 并标记“已转订单”；重复或越级转单返回 409 |
| `POST` | `/api/quotations/:id/status` | `{ status }` | 按 `草稿 → 报价中 → 已接受 → 已转订单` 状态机流转；报价中也可进入已拒绝/已过时，终态不能恢复 |
| `PATCH` | `/api/quotations/:id` | 报价字段 | 只有“草稿”或“报价中”允许更新核心明细 |
| `DELETE` | `/api/quotations/:id` | 无 | 只有草稿、已拒绝或已过时报价允许软删除 |

## 11. 订单 Orders

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/orders` | 无 | 订单列表；按创建顺序平衡全部活动订单的库存占用并刷新采购缺口，同一库存不会被多个订单重复使用 |
| `GET` | `/api/orders/lookup` | `query=订单ID/客户名称/合同号` | 只读查找订单候选，不刷新采购计划；AI 按客户或合同解析订单时使用 |
| `GET` | `/api/orders/readiness-overview` | 无 | 一次计算全部活动订单的库存平衡和生产准备结论；返回分类汇总、主要问题、缺料和第一个未阻塞处理步骤，只读不写库 |
| `GET` | `/api/orders/:id` | 无 | 单个订单，标准字段含 `id/createdAt/updatedAt` |
| `GET` | `/api/orders/:id/requirements` | 无 | 读取客户要求草稿、最后确认版本、知识状态和当前订单附件；只读 |
| `PUT` | `/api/orders/:id/requirements/draft` | `{ summaryText, sourceFileIds? }` | 保存可编辑草稿；来源文件必须已有效关联当前订单，不进入知识库 |
| `POST` | `/api/orders/:id/requirements/confirm` | `{ summaryText?, sourceFileIds? }` | 原子保存并人工确认当前版本；确认内容自动合并到该订单知识条目，不修改订单明细、配方、采购或库存 |
| `POST` | `/api/orders/:id/requirements/revoke` | 无 | 撤销知识确认并保留草稿与原文件；订单知识自动移除已确认客户要求 |
| `GET` | `/api/orders/:id/readiness` | 无 | 只读生产准备检查；按订单状态、配方与BOM、零件库存、线圈库存、采购进度、成本与价格六步返回 `ready/waiting_materials/needs_review/blocked/not_applicable`，不写订单和库存 |
| `GET` | `/api/orders/:id/readiness-plan` | 无 | 基于实时生产准备结果生成处理步骤；返回 `sequence/dependsOn/mode/status/owner/path/toolCall`，只生成方案不执行 |
| `POST` | `/api/orders/:id/readiness-actions/:actionId` | 路径动作仅支持 `confirm_order/generate_purchase_plan` | 执行前重新生成实时检查和方案；仅执行仍为 `confirmable + available` 的步骤，过期、已完成或受前置步骤阻塞时返回 `409`；成功返回动作、更新后的订单和 `nextPlan` |
| `GET` | `/api/orders/history-price/:recipeName` | 路径参数 `recipeName` | 查该配方最近历史售价和利润率 |
| `POST` | `/api/orders/purchase-plan` | `{ items: [{ partsJson, qty }] }` | 按订单明细生成采购清单和供应商待办；“外包装估算”等成本占位项不进入正式采购；不写库 |
| `POST` | `/api/orders/save-payload-draft` | `{ customerName, contractNo?, remark?, status?, items, purchaseList?, todos? }` | 基于订单表单草稿生成标准保存 payload；未传采购清单/待办时自动生成；不写库 |
| `POST` | `/api/orders/purchase-items/batch` | `{ identityKey?, model, supplier?, purchased }` | 兼容的整项下单动作；优先按采购规格身份匹配，把采购项的 `orderedQty` 设置为计划数量，不入库 |
| `POST` | `/api/orders/:id/status` | `{ status, reason? }` | 人工动作只允许确认订单、关闭订单或取消订单；取消必须填写原因，采购中/采购完成由数量自动推导 |
| `POST` | `/api/orders/:id/purchase-items/progress` | `{ identityKey?, model, supplier?, orderedQty, receivedQty, stockedQty, purchasePrice?, actualSupplier?, allowOverPurchase? }` | 保存单项采购进度；强制 `入库 ≤ 到货 ≤ 下单`，超采必须明确确认；`stockedQty` 增量按 `inventoryType` 在同一事务内加入零件或线圈库存并记录批次 |
| `POST` | `/api/orders/:id/purchase-items/toggle` | `{ model, supplier?, purchased? }` | 旧客户端兼容动作；映射为整项下单/取消下单，已有到货或入库时不能取消 |
| `POST` | `/api/orders/:id/todos/toggle` | `{ todoId, done? }` | 切换或设置指定采购待办完成状态 |
| `POST` | `/api/orders/:id/complete-purchase` | 无 | 一次性把全部剩余计划登记为已下单、已到货和已入库；普通零件与正式线圈分别增加库存，非库存计算项只推进采购进度；返回带 `inventoryType/partId/coilId` 的 `additions`，订单进入“采购完成”而不是关闭；重复入库返回 409 |
| `POST` | `/api/orders` | `{ customerName, contractNo?, remark?, itemsJson?, purchaseListJson?, todosJson? }` | 新增订单，固定进入“待确认” |
| `PATCH` | `/api/orders/:id` | 订单字段 | 只有“待确认”订单允许修改核心明细 |
| `DELETE` | `/api/orders/:id` | 无 | 只有待确认或已取消订单允许软删除 |

采购项快照字段包括 `plannedQty/orderedQty/receivedQty/stockedQty/purchasePrice/actualSupplier/orderedAt/receivedAt/stockedAt/stockInHistory/inventoryType`。普通零件使用 `inventoryType=part + partId`；精确匹配正式线圈方案的线圈转子使用 `inventoryType=coil + coilId`，按套占用和增加 `coils.stock`；插值或外推产生、没有正式方案的计算型线圈使用 `inventoryType=none`，可完成采购进度但不写库存。`purchaseUnit/stockQtyPerUnit/specification` 区分采购展示单位和底层库存单位。成品电缆按“根”计划，入库时按 `stockQtyPerUnit` 折算为线材米数；历史按米保存的活动订单会在采购计划重算时转换为根数。旧 `needToBuy/purchased` 字段继续兼容读取。旧“已完成”订单启动迁移后映射为“已关闭”。

生产准备检查以本轮实时库存为准：`totalQty - currentStock` 才是当前缺口，不能因采购项已经下单或到货就判定可生产。`inventoryType=none` 的计算型线圈、仍含“外包装估算”的订单BOM、没有 `partId` 的普通采购项、缺少BOM快照或未确认订单会形成数据阻塞；库存满足但成本为 0、售价低于成本或来源配方不可追溯时返回待复核。AI 工具 `check_order_readiness` 通过该接口读取结论，匹配多个客户订单时必须要求明确订单ID或合同号。

订单准备总览只读取未关闭且未取消的活动订单，并且每次请求只运行一次 `buildBalancedOrderPlans`，避免逐单重复平衡库存。总览按 `blocked → waiting_materials → needs_review → ready` 排序，`attentionRequired` 是前三类之和。AI 工具 `get_order_readiness_overview` 和管理看板“订单准备”页签使用同一接口，均不属于生产执行或库存写入。

处理方案状态为 `complete/ready_for_confirmation/action_required/needs_resolution/waiting/not_applicable`。步骤模式 `confirmable` 表示存在可映射的标准写工具，但仍需后续用户确认；`manual` 表示需要人员在业务页面处理，`needs_input` 表示缺少价格等业务决定，`monitor` 表示等待到货等外部状态。存在缺BOM或库存映射等前置问题时，后续确认和采购步骤通过 `dependsOn` 标记为阻塞。AI 工具 `plan_order_readiness_actions` 只读取该接口，不属于 `WRITE_TOOLS`；`execute_order_readiness_action` 属于 `WRITE_TOOLS`，确认后调用动作接口，并以服务端重验结果为准。

订单动作接口不接受客户端提交的状态、采购数量或采购清单，只接受动作 ID 并在服务端映射到现有订单状态和采购计划逻辑。`confirm_order` 使订单离开待确认，并按实时采购数量进度进入待采购、采购中或采购完成；`generate_purchase_plan` 保存本轮实时生成的采购清单，并仅在原待办为空时补充待办。两者都通过安全写入和审计日志，不提供生产确认或自动扣库存能力。

## 12. 工作台 Workbench

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/workbench/summary` | 无 | 经营、库存、采购和待办汇总 |
| `GET` | `/api/workbench/action-center` | 无 | 聚合订单准备、经营风险、数据质量、规则学习和知识库健康检查，返回完整待办、今日执行队列、生命周期和最近 24 小时处理进展 |
| `GET` | `/api/workbench/action-history` | 查询参数 `status?=active/resolved`, `limit?` | 只读查询管理事项生命周期历史和汇总，默认最近 20 条、最多 100 条 |
| `POST` | `/api/workbench/execution-plan` | `{ workflowType, goal?, orderId?, quotationId?, actionId? }` | V8 只读生成统一工厂执行计划；`workflowType` 支持 `order_readiness/quotation_to_order/management_action` |
| `GET` | `/api/workbench/execution-runs` | 查询参数 `workflowType?`, `subjectId?`, `actionId?`, `status?=completed/failed`, `limit?` | V8.4 只读查询执行历史及成功/失败统计 |
| `POST` | `/api/workbench/execution-runs` | `{ workflowType, subjectType, subjectId, actionId, toolName, status, plan, result?, recheck?, outcomeSummary?, error?, startedAt? }` | V8.4 由受保护 AI 执行器记录一次确认尝试，不执行订单、报价或库存业务写入 |

管理待办中心复用各业务域的实时检查结果，不复制成本、库存或知识同步规则。优先级为 `critical/high/medium/low`，类别为 `order_readiness/business_risk/data_quality/rule_learning/knowledge_health`；同一订单的采购提醒由订单准备结论统一呈现，避免与经营风险重复计数。返回项包含来源、数量、建议动作和可执行页面路径，但不包含写工具或自动执行动作。当前按单人管理助理设计，界面和 AI 不要求分配负责人。AI 工具 `get_management_action_center` 和管理看板“今日待办”页签使用同一接口。

V7.1 使用后台监控把稳定待办键与 `management_action_lifecycles` 对齐，只在首次出现、实质内容变化、消失或再次出现时写入；普通 `GET` 查看保持只读。`management_action_events` 追加保存 `appeared/resolved/reopened` 三类不可覆盖事件。生命周期不会替代实时检查，也不会把“检查不再出现”解释为人工已处理；看板只说明当前规则已不再检出该事项。

V7.2 在返回结果中增加 `executionQueue`。队列最多突出 3 项，业务优先级是不可跨越的第一排序条件，同级事项再按持续时间、累计出现次数和影响数量评分。每项返回 `rank/queueLabel/score/scoreBreakdown/reasons`，便于看板和 AI 解释为什么先处理；`remainingCount` 表示仍保留在完整待办中的其余事项。该排序是纯计算，不新增任务、状态或查看写入。

V7.3 为每条待办增加 `resolution`：`mode` 为 `navigate/confirmable/needs_input/monitor`，并返回最短动作、说明、完成标准和业务页面路径。只有订单处理方案中仍为 `available + confirmable` 的步骤才返回 `canAiConfirm=true` 及受保护的 `execute_order_readiness_action` 参数；看板跳转 AI 后仍需刷新订单方案并显示确认卡片，普通页面跳转、业务判断和等待事项不会生成写动作。

V7.4 在成功的核心业务 `POST/PUT/PATCH/DELETE` 响应结束后，请求一次 500ms 防抖的生命周期复查；连续操作合并执行，失败响应、GET、草稿/试算类 POST 和 AI 对话本身不触发。复查仍以五类实时检查为准，不再出现的稳定事项键自动写为 `resolved` 并追加事件。`GET /api/workbench/action-center` 保持只读，新增 `progress`：`resolvedCount/unresolvedCount/blockedCount/recurringCount` 以及最近已解决、暂时受阻和反复出现明细，窗口默认最近 24 小时。看板和 AI 只消费该统一结果，不需要人工维护完成状态。

V8.1 的执行计划统一返回 `status/subject/metrics/steps/safeguards`。步骤模式为 `automatic/confirmable/manual/needs_input/monitor`，并通过 `dependsOn` 表示前置关系；`canExecute=true + confirmation` 才代表已经接入现有受保护执行器。当前订单确认和采购清单生成可继续使用 `execute_order_readiness_action`，服务端执行前重新检查；报价转订单在 V8.1 仅生成计划并指向报价页面，不能因为步骤模式为 `confirmable` 就宣称 AI 已经能够直接转单。该 POST 只用于承载结构化入参，不写业务数据，也不属于 `WRITE_TOOLS`。

V8.2 增加 AI 写工具 `execute_factory_workflow_step`，当前只接受 `workflowType=quotation_to_order + actionId=convert_quotation + quotationId`。工具属于 `WRITE_TOOLS`，未确认时只返回确认卡片；确认后先重新调用 `/api/workbench/execution-plan`，仅当步骤仍为 `available + confirmable + canExecute` 且服务端确认参数完全一致时继续。执行链依次调用只读 `/api/quotations/:id/order-draft` 预检、事务 `/api/quotations/:id/convert` 转单、只读 `/api/orders/:id/readiness-plan` 检查新订单，最后再次刷新原报价计划。计划过期、报价未接受、已转单、预检失败或并发状态变化都会停止，不能绕过报价状态机和防重复事务。

V8.3 不新增写 API。AI 执行计划界面直接使用 `subject.path` 和步骤 `path` 进入带业务 ID、页签或处理参数的最短页面；`/quotations?quotationId=:id` 会在报价数据加载后自动打开对应详情。只有 `available + confirmable + canExecute` 且确认器为现有 `execute_order_readiness_action` 或 `execute_factory_workflow_step` 的步骤才提供“发起确认”。该按钮只生成一条明确的 AI 执行请求，服务端仍重新调用本节标准接口校验并返回原确认卡片；历史计划只保留查看入口，前端不会直接调用确认接口或业务写接口。

V8.4 使用 `factory_workflow_runs` 保存每次已确认尝试的计划指纹、动作、工具、尝试次数、成功或失败、结果摘要、错误和最新复查快照，默认保留最近 500 次。`POST /api/workbench/execution-plan` 仍只读，但会附加 `executionHistory.latestAttempt/latestRecheck/recovery`：失败记录只有在当前实时步骤仍为 `available + canExecute` 时返回 `retry_available`；计划变化或受阻时返回 `blocked`；最近写操作完成后仅继续新的未完成步骤。同一计划指纹下已有成功记录的动作会清除确认参数并标记完成，AI 执行器仍在业务写入前调用标准实时计划和业务接口，历史表不能替代事务或业务状态机。

## 13. 设置 Settings

允许的设置 key：

- `management_fee`
- `cable_accessories`
- `float_accessory_delta`
- `aluminum_wire_price_per_kg`
- `usd_cny_rate`

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/settings` | 无 | 所有系统设置，返回 key-value 对象 |
| `GET` | `/api/settings/:key` | 白名单 key | 单个设置值 |
| `PUT` | `/api/settings/:key` | `{ value }` | 更新设置；数值类必须非负，`cable_accessories` 必须含 `standard/xinjie` 的 `name` 和 `fee` |
| `GET` | `/api/settings/runtime` | 无 | 读取系统初始化页运行配置、密钥配置状态、待重启项和只读部署环境状态；永不返回 API Key 原文或密文 |
| `PUT` | `/api/settings/runtime` | camelCase 运行设置对象 | 保存白名单内的 AI 与知识检索设置；空密钥表示保留原值，API Key 使用 `JWT_SECRET` 派生密钥进行 AES-256-GCM 加密 |
| `POST` | `/api/settings/runtime/test-ai` | AI 提供商、模型、地址及可选新 API Key | 不保存配置，使用当前或本次输入的凭证执行最小连接测试，返回提供商、模型和耗时 |

`/setup` 系统初始化页只开放业务运行参数。AI 提供商、模型、API Key 和图片输入设置保存后供 AI 工作台即时读取；混合检索和向量批量大小即时读取。知识自动同步、向量开关、向量自动生成、Embedding 模型/维度/精度、缓存目录和离线模式涉及已初始化的后台控制器或模型实例，保存后会返回 `restartRequired=true`，重启 API 服务后生效。管理密码、JWT、内部接口密钥、CORS、端口和生产模式只显示配置状态，仍必须由部署环境提供，不能在网页中读取或修改。

Kimi 业务助手使用 Kimi 开放平台 `https://api.moonshot.cn/v1` 与开放平台 API Key；Kimi Coding 会员订阅凭证属于独立产品，接口会拒绝将 `sk-kimi-*` Coding 凭证保存到开放平台字段。当前开放平台预设模型为 `kimi-k2.7-code`。

## 14. 转子 Rotor

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/rotor/draw` | 结构化出图参数；可带 `drawingName/drawing_name`、`drawingText/drawing_text` | 启动异步 FreeCAD 出图任务；标准返回 `{ success, data: { status, message, jobId, drawingName, params } }` |
| `POST` | `/api/rotor/save` | 结构化转子参数；可带 `drawingName/drawing_name`、`drawingText/drawing_text` | 保存暂定参数到历史，不启动 FreeCAD；记录状态为 `saved`，返回 `{ success, data, jobId, drawingName, params }` |
| `POST` | `/api/rotor/recipe-draft` | `{ recipeId }` | 根据配方技术档案生成出图表单草稿；配方录入的转子出图参数优先于泵壳模板历史默认值，并带入配方名称、机筒长度和不锈钢机筒开档；不写库 |
| `POST` | `/api/rotor/template-draft` | `{ templateId, variantId? }` | 根据泵壳模板和可选型号变体生成出图表单草稿，带入轴承、油封、泵壳 notes 默认参数、不锈钢机筒开档和图纸备注；不写库 |
| `POST` | `/api/rotor/chat` | `{ message, force?, supplements?, baseParams?, drawingName?, drawingText? }` | 自然语言出图；标准返回 `{ success, data }`，`data.status` 可能为 `success/need_params/warning` |
| `GET` | `/api/rotor/status/:jobId` | 无 | 查询任务状态；返回 `{ success, data }` |
| `GET` | `/api/rotor/history` | 无 | 最近 100 条出图/保存历史；标准字段为 `jobId, drawingName, nlInput, paramsJson, fcParamsJson, fileUrl, linkedPumpModel, createdAt, updatedAt`；`status=saved` 表示仅保存参数 |
| `PATCH` | `/api/rotor/history/:id/name` | `{ drawingName/drawing_name }` | 重命名图纸 |
| `PATCH` | `/api/rotor/history/:id/link` | `{ linkedPumpModel/linked_pump_model }` | 关联订单型号、型号变体或配方；响应标准字段为 `data.linkedPumpModel` |
| `DELETE` | `/api/rotor/history/:id` | 无 | 删除历史记录并尝试删除对应 PDF |
| `POST` | `/api/rotor/print/:jobId` | 无 | 打印已成功生成的 PDF |
| `GET` | `/api/rotor/order-pump-models` | 无 | 从订单明细中提取可关联的水泵型号 |
| `GET` | `/api/rotor/link-targets` | 无 | 出图历史可关联对象，合并订单型号、型号变体和配方，返回 `{ type, id, label, value, secondary }[]` |

静态下载路径：`/drawings/*` 映射到 `public/drawings/`，用于下载生成的 PDF。

## 15. AI、语音与 Siri

### AI

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/ai/capabilities` | 无 | 返回当前 `provider/model`、是否支持图片输入、允许的附件类型及数量/大小限制 |
| `POST` | `/api/ai/chat` | `{ messages, pageContext? }` | SSE 流式对话；消息可带 `attachments: [{ id }]`；`pageContext` 当前仅接受白名单化的订单 `resourceType/resourceId/view` |
| `POST` | `/api/ai/confirm-tool` | `{ toolName, args? }` | 用户确认后执行写工具；调用 `executeToolCall(..., { allowWrite: true })` |
| `GET` | `/api/ai/system-prompt` | 无 | 读取当前 System Prompt |
| `PUT` | `/api/ai/system-prompt` | `{ prompt }` | 更新内存和 SQLite `config.ai-system-prompt`；不能为空，最大 50000 字符 |

AI 对话请求只保留最近 10 条有效的 `user/assistant` 消息作为上下文；前端与后端都会执行该限制，当前消息包含在这 10 条内。每条用户消息最多关联 4 个已经通过 `/api/files` 校验的附件。文本、PDF/Excel 解析文字和图片/扫描 PDF OCR 文字合计最多内联 100KB。DeepSeek 不接收图片二进制，但可以使用本地 OCR 文字；系统初始化页选择 Kimi 开放平台且模型支持视觉输入时，图片还会按 OpenAI 兼容的 `image_url` 数据格式传入。

业务页右侧 AI 可额外发送 `pageContext: { resourceType: "order", resourceId, path: "/orders", view }`。后端只保留合法订单 ID，并将 `view` 限制为 `requirements/readiness/items/purchase/todos`；客户端标签、指令或业务数值都会被丢弃。页面上下文只用于解析“这个订单”“下一步怎么处理”等指代，不写入会话消息，也不替代实时业务工具查询；明确指定其他订单或询问全部订单时，以用户文字为准。

价格、成本、库存、订单状态、报价金额和铜价等易变业务数据查询会在首轮强制调用至少一个只读工具，避免模型从会话上下文复述已过期数值。明确查询知识库时使用知识库结果；若知识条目与实时业务 API 冲突，以实时业务值为准并提示同步知识库。

### AI 会话历史

AI 工作台会把会话和消息保存到 SQLite。所有接口均需登录，并按当前登录身份隔离；历史消息中的待确认工具只读，不能从历史记录重复执行。

| 方法 | 路径 | 请求 | 说明 |
|---|---|---|---|
| `GET` | `/api/ai/conversations?limit=50` | 无 | 获取最近会话，默认 50 条，最大 100 条 |
| `POST` | `/api/ai/conversations` | `{ title }` | 创建会话，标题最大 80 字符 |
| `GET` | `/api/ai/conversations/:id` | 无 | 获取会话及按时间排序的全部消息 |
| `POST` | `/api/ai/conversations/:id/messages` | `{ role, content, metadata? }` | 追加消息；用户附件放在 `metadata.attachments: [{ id }]`，服务端重新读取文件名、类型、大小和下载路径后保存 |
| `PATCH` | `/api/ai/conversations/:id/messages/:messageId` | `{ metadata }` | 更新已保存消息的工具执行结果 |
| `DELETE` | `/api/ai/conversations/:id` | 无 | 软删除会话；历史消息保留在数据库中但不再展示 |

### AI 回答反馈

用户可对已经保存的 AI 回复标记“准确”，或报告“内容错误、来源过期、资料不足”。反馈绑定 assistant 消息，并保存当时的用户问题、AI 回答和知识来源快照。问题反馈进入知识库管理中心待处理队列，但不会自动修改知识条目、业务数据或规则。

| 方法 | 路径 | 请求 | 说明 |
|---|---|---|---|
| `GET` | `/api/ai/feedback?conversationId=&status=&rating=&limit=50` | 无 | 按当前登录身份查询反馈和汇总；`status` 为 `open/resolved`，最大 100 条 |
| `POST` | `/api/ai/feedback` | `{ messageId, rating, note? }` | 新增或改判指定 AI 回复；`rating` 为 `helpful/incorrect/outdated/missing_source` |
| `POST` | `/api/ai/feedback/:id/diagnose` | 无 | 只读对照当前知识概况，识别知识待同步、缺少引用、知识缺口或需业务复核，并保存诊断快照 |
| `POST` | `/api/ai/feedback/:id/retest` | `{ answerText, toolResults }` | 保存使用原问题重新查询所得的新回答和来源，供人工对比；不自动归档 |
| `PATCH` | `/api/ai/feedback/:id` | `{ status, resolutionNote? }` | 将问题标记为待处理或已处理；处理说明最大 500 字符 |

同一 `messageId` 只保留一条最新判断；`helpful` 自动设为 `resolved`，其余三类问题设为 `open`。反馈和处理写入均通过 `safeInsert/safeUpdate` 并进入审计日志。

诊断依据是反馈保存时的 `sourceTable + sourceId` 来源快照和 `/api/knowledge/overview` 当前内容哈希状态。无来源时会从原问题中的型号、编号或引号内容检索候选知识。管理界面的“重新验证”重新调用标准 AI 对话流并保存新回答，用户必须比较新旧内容后手工确认归档；系统不会根据模型自评自动判定正确。

### 知识库回归检查

回归检查使用项目内置用例重新调用标准 AI 对话流，再由确定性规则核对当前业务值、实际工具、来源类型、必需词和禁用词。AI 不参与给自己打分。首批用例覆盖零件当前价格、`12-220` 全部正式线圈方案、Excel 性能测试报告类型、测试模板无效字段、客户报价展示顺序和成品电缆语义。

| 方法 | 路径 | 请求 | 说明 |
|---|---|---|---|
| `GET` | `/api/ai/evaluations/overview` | 无 | 返回启用用例、当前登录身份最近一次运行和逐项结果 |
| `POST` | `/api/ai/evaluations/runs` | 无 | 创建一次检查运行并返回待执行用例；未完成旧运行会标为失败 |
| `POST` | `/api/ai/evaluations/runs/:id/results` | `{ caseId, answerText?, toolResults?, errorText? }` | 保存单项 AI 回答并执行后端确定性判定 |
| `POST` | `/api/ai/evaluations/runs/:id/complete` | 无 | 汇总通过、需修复和需确认数量并结束运行 |

运行记录按登录身份隔离。`part_price` 规则直接读取当前 `parts.price`，不会把历史固定价格写入用例；客户报价规则读取当前有效报价数量，并检查回答是否把 `#3/#5` 这类数据库 ID 当成业务展示顺序。检查过程只读取业务数据，写入仅限 `ai_evaluation_runs/results` 审计记录。

`search_customer_history` 会按创建时间为报价生成连续的 `displaySequence`，并从 AI 工具结果中移除内部报价 ID；面向用户统一展示为“第 1 份、第 2 份”。测试报告规则允许“不是工程图纸”这类正确否定说明，只禁止把附件直接标成“参考图纸”。成品电缆用例要求引用正式业务规则，并明确线材、长度、插头和规格属于一个整体业务项。

AI 写操作由 `api/routes/ai/tools.cjs` 的 `WRITE_TOOLS` 白名单和确认流程控制。`/api/ai/chat` 中普通工具结果会继续回流给模型用于多步编排；只有返回 `requiresConfirmation` 的写操作会暂停并等待 `/api/ai/confirm-tool`。

`/api/ai/chat` SSE 事件包括 `status/content/tool_plan/tool_call/tool_result/detail/done/error`。`tool_plan` 会在工具执行前说明步骤、只读/写入模式和参数摘要；写操作仍必须通过确认流程执行。

AI 调度器 V1 新增草稿/编排工具，均不直接写库：

- `build_recipe_bom_draft`：调用 `/api/recipes/bom-draft` 生成联动 BOM 草稿。
- `preview_recipe_cost`：调用 `/api/recipes/:id/cost-preview` 做报价覆盖试算。
- `preview_pump_shell_cost`：调用 `/api/recipes/bom-draft` 试算指定泵壳模板在某个机筒长度下的泵壳本体成本；适用于不锈钢机筒整体泵壳随长度加价。
- `build_quotation_draft`：调用 `/api/quotations/save-payload-draft` 生成报价保存草稿。
- `build_order_draft`：调用 `/api/orders/save-payload-draft` 生成订单保存草稿、采购清单和待办。
- `search_customer_history`：组合查询客户、报价和订单历史，供报价前参考。
- `explain_cost_change`：调用 `/api/cost/recipe-difference` 解释两个配方的成本差异。
- `get_data_quality_summary`：调用 `/api/quality/summary` 汇总基础资料健康度。
- `analyze_recipe_configuration`：调用 `/api/quality/recipe-analysis`，只读分析相似配方、配置矛盾、同类高频项和固定件价格异常。
- `set_recipe_analysis_feedback`：保存“确认问题/忽略/特殊情况/恢复复核”判断；必须使用智能检查返回的精确提醒键，并在用户确认后写入。
- `get_factory_learning_health`：只读扫描全部同类高频项学习反馈，包含尚未形成候选规则的证据，返回仍有效、内容过期、模板漂移、配方已归档及待重新检查配方。
- `get_factory_rule_candidates`：只读查询待审核、已批准、已驳回或已失效的候选业务规则。
- `get_factory_rule_impact`：只读分析某条规则对当前同模板配方的影响，区分已符合、需要复核、特殊情况和已忽略。
- `get_factory_rule_compliance`：只读汇总全部已批准规则的执行情况和受影响配方。
- `get_factory_rule_history`：只读查询规则候选生成、证据变化、审核、失效和重新激活的生命周期记录。
- `restore_factory_rule_event`：从真实历史事件恢复规则审核状态；保留当前学习证据，必须确认后写入。
- `refresh_factory_rule_candidates`：从已确认的同类高频项中重新归纳候选规则；必须确认，不会自动批准。
- `review_factory_rule_candidate`：批准、驳回或恢复候选规则；必须确认，审核状态与对应规则知识在同一事务内自动更新。
- `search_factory_knowledge`：调用 `/api/knowledge` 搜索工厂知识库，并读取 `/api/knowledge/overview` 标记每条来源的新鲜度。
- `get_factory_knowledge_detail`：调用 `/api/knowledge/:id` 读取知识条目详情，并返回可追溯的原业务来源。
- `get_factory_knowledge_health`：调用 `/api/knowledge/health` 实时读取自动同步健康级别、异常原因、待同步数量和最近运行记录；只读，不执行同步。
- `sync_factory_knowledge`：调用 `/api/knowledge/sync` 增量更新知识条目并刷新 FTS；该工具写入派生索引，位于写工具白名单，需确认后执行。
- `save_order_requirement_draft`：把已经展示并经用户明确要求保存的订单客户要求归纳结果写入可编辑草稿；必须使用真实订单 ID 和已关联附件的精确文件 ID，需确认后执行。该工具不能确认知识，也不能修改订单明细、配方、采购或库存。

知识查询工具结果包含 `provenance` 和 `sources`。`provenance.kind=knowledge_snapshot` 表示最近一次知识同步快照；每个 source 包含 `knowledgeEntryId/title/sourceTable/sourceId/syncedAt/sourceUpdatedAt/freshness/knowledgePath/sourcePath`。`freshness` 支持 `fresh/pending_insert/pending_update/pending_delete`。价格、库存、订单状态等实时业务查询使用 `provenance.kind=live_business`；实时结果与知识快照冲突时以实时业务结果为准。

Next iPhone PWA `/ai` 复用本节接口：

- 文字指令通过 `apps/web-next/lib/ai.ts:streamAiChat()` 调用 `POST /api/ai/chat`。
- 写操作确认通过 `apps/web-next/lib/ai.ts:confirmAiTool()` 调用 `POST /api/ai/confirm-tool`。
- 移动端不得绕过 AI executor 自由拼接业务 API；新增助手能力应先扩展 `tools.cjs` 和对应 executor。
- PWA 使用 JWT Cookie 鉴权，未登录时由 `proxyFetch()` 跳转 `/login`。
- `/voice` 页面已弃用并跳转到 `/ai`，当前工作台不再提供语音输入。

### Voice

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/voice/asr` | `multipart/form-data`，文件字段 `audio`，可带 `format`、`sampleRate` | 调阿里云一句话识别；成功返回 `{ success: true, text }` |

该接口仅为旧客户端兼容保留，当前 `/ai` 工作台不调用；阿里云密钥只保留在后端环境变量中，不暴露到前端。

### Siri

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/siri/chat` | `{ text, project?, context? }` | Siri 快捷指令统一入口；Siri 只传自然语言，内部仍由 AI tools 调度标准业务 API；`project=cad` 时转发到 `CAD_API_URL` |
| `POST` | `/api/siri/confirm` | `{ confirmationId, confirm: true }` | Siri 写操作二次确认入口；确认后调用 `executeToolCall(..., { allowWrite: true })` |
| `GET` | `/api/siri/result/:id` | 无 | 读取 5 分钟内缓存的 Siri 结构化结果 |
| `GET` | `/siri-result?id=xxx` | 查询参数 `id` | 返回 `public/siri-result.html` 页面 |
| `GET` | `/public/*` | 静态路径 | AI 路由内挂载的 `public` 静态文件兼容入口 |

`POST /api/siri/chat` 兼容旧字段 `success/speech/content/toolResults/resultUrl`，并新增 `status`：

- `success`：查询或执行完成。
- `failed`：AI、权限或业务工具执行失败。
- `processing`：后台任务已提交，例如转子出图，返回 `task.id/statusUrl`。
- `confirmation_required`：写操作等待确认，返回 `confirmationId` 和 `confirmation`。

Siri 回复要求简短，`speech` 用于快捷指令朗读，结构化明细应通过 `resultUrl` 或 PWA 查看。写操作不得由第一次自然语言请求直接落库。

## 16. 数据质量

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/quality/summary` | 无 | 汇总零件、配方、模板、型号变体、线圈、客户和报价的数据质量问题；只读不写库 |
| `GET` | `/api/quality/business-alerts` | 无 | 汇总报价和订单经营异常提醒，如长期未跟进、低于成本、成本为 0、待采购卡住和可完成订单；只读不写库 |
| `POST` | `/api/quality/recipe-analysis` | `{ recipeId?, recipeName?, limit?, draft? }` | Knowledge V3 配方智能检查；可分析已保存配方，也可在 `draft.parts` 中提交当前未保存 BOM 草稿。返回相似配方、确定性配置矛盾、同类配方高频项、已批准规则的学习置信度和固定件价格异常；反馈后配方已修改时返回 `feedback.outdated=true`，旧“忽略/特殊情况”不再抑制当前提醒；只读不写库 |
| `POST` | `/api/quality/recipes/:recipeId/feedback` | `{ findingKey, findingType, decision, note?, findingSnapshot? }` | 保存当前配方某条智能检查提醒的人工判断。服务端会覆盖并写入 `findingSnapshot.evidenceContext`，固化反馈时的配方、泵壳模板和时间，客户端不能指定证据归属。`decision` 支持 `confirmed/ignored/special_case/review`；`peer_pattern` 反馈会在同一事务中自动刷新候选规则并返回 `ruleLearning` 摘要，失败时反馈与归纳整体回滚 |
| `POST` | `/api/quality/recipe-feedback/:id/resolve` | `{ note? }` | 处理重新智能检查后已不再出现的待复核学习反馈。仅允许当前确实处于内容过期或模板漂移状态的 `peer_pattern` 反馈；保留原始证据快照，把判断恢复为 `review`，并在同一事务内刷新候选规则。当前仍有效、已处理或归档配方反馈返回 409 |
| `GET` | `/api/quality/rule-compliance` | 无 | 汇总全部已批准规则的当前执行情况，返回规则问题总数、受影响配方去重数量、例外数量以及各规则的实时影响明细；只读不写库 |
| `GET` | `/api/quality/rule-learning-health` | 查询参数 `limit?` | 扫描全部 `confirmed/special_case/ignored` 的 `peer_pattern` 反馈，包括尚未达到候选规则门槛的证据。返回 `active/outdated/drifted/archived` 状态、待重新检查配方和汇总；`limit` 为 1-200、默认 100；只读不写库 |
| `GET` | `/api/quality/rule-candidates` | 查询参数 `status?` | 读取候选业务规则及学习证据；状态支持 `candidate/approved/rejected/stale`。返回 `supportCount/specialCaseCount/ignoredCount/driftedCount/outdatedCount/confidenceScore/confidenceLevel/learningEvidence/needsReview/approvalEligible/approvalBlockers/approvalRequirements`；`learningEvidence.drifted/outdated` 仅追溯历史，不计入支持数 |
| `GET` | `/api/quality/rule-events` | 查询参数 `candidateId?`、`limit?` | 读取规则生命周期记录，按时间倒序返回 `eventType/previousStatus/newStatus/actor/note/snapshot/createdAt`；`candidateId` 可限定单条规则，`limit` 为 1-100、默认 30；只读不写库 |
| `POST` | `/api/quality/rule-events/:id/restore` | `{ restoreNote? }` | 恢复该历史事件记录的 `candidate/approved/rejected` 审核状态，但保留规则当前内容、证据和置信度；批准会按当前证据重新校验并同步规则知识 |
| `POST` | `/api/quality/rule-candidates/refresh` | 无 | 从同一泵壳模板的 `peer_pattern` 反馈中归纳候选规则；反馈按生成时的模板和配方版本归属，后来更换模板标记为范围漂移，修改配方标记为内容过期并排除。至少 2 个不同配方确认才会进入候选；已批准规则失去最低支持时转为 `stale`，置信度跌破 65% 时撤回为 `candidate`。返回 `minimumEvidence/minimumConfidence` 及含 `suspended/driftedEvidence/outdatedEvidence` 的统计，不会自动批准新规则 |
| `GET` | `/api/quality/rule-candidates/:id/impact` | 无 | 只读计算规则对当前同模板配方的影响；按实时 BOM 和有效反馈分为 `compliant/needsReview/specialCases/ignored`。配方在反馈后修改时，旧例外以 `feedbackOutdated=true` 回到 `needsReview`；返回数量、配方清单和待复核占比，不修改配方 |
| `PATCH` | `/api/quality/rule-candidates/:id` | `{ status, reviewNote? }` | 人工审核候选规则；`status` 支持 `candidate/approved/rejected`。批准要求当前至少 2 个不同配方确认且置信度不低于 65%。返回 `knowledgeSync`，批准自动新增或更新对应规则知识，驳回或恢复候选自动移除 |

数据质量报告返回 `score/totals/issues/topIssues`，用于 `/dashboard` 的“数据质量”视图和 AI 质量检查工具；旧 `/quality` 页面仅保留兼容跳转。常见检查包括零件价格/供应商/库存、配方 BOM 和保存成本、模板泵壳引用、线圈默认电容/线径、客户默认利润率和历史报价金额异常。

经营异常报告返回 `totals/alerts/topAlerts`，用于报价页、订单页和 AI 经营风险检查工具。它不改变报价或订单状态，只提示需要人工跟进的业务风险。

配方智能检查当前返回 `version: "knowledge-v3.0"`，核心字段为 `mode/advisoryOnly/recipe/summary/similarRecipes/factoryRuleAlerts/missingItems/priceAlerts/suppressedFindings/guidance`。相似度基于泵壳模板、BOM 角色、具体型号和线圈配置；线圈只有在规格、片数、材质和槽眼全部相同时才标记为完整配置一致，片数不同时仅作为定子规格接近并明确返回双方片数。`configuration_conflict` 是配置字段与 BOM 的高置信度矛盾，`peer_pattern` 只是同类配方高频模式，必须由人工结合客户要求复核。

状态为 `approved` 的候选规则会按 `scopeType=pump_shell_template` 和 `scopeRef=templateId` 参与检查。规则对应的 BOM 角色缺失时返回 `factory_rule` 提醒，附带规则 ID、批准时间、审核说明、证据数量和证据配方；同一规则不再重复生成普通 `peer_pattern` 建议。`summary` 增加 `appliedFactoryRuleCount/factoryRuleAlertCount`，活动规则提醒计入 `highConfidenceAlertCount`，因此 Web 保存前要求用户返回修改或明确继续。已有配方可以把客户定制差异记录为 `special_case`，后续检查会收纳到 `suppressedFindings`。

价格分析只比较普通固定件，会排除动态泵壳、线圈、浮球、成品电缆和公式/手输成本项。所有检查均为只读，任何提醒都不会自动覆盖配方、成本快照或零件价格。

候选规则是“人工反馈的归纳结果”，不是自动成立的业务事实。V3 按泵壳模板和提醒键汇总 `confirmed/special_case/ignored`：确认是支持证据，特殊情况按半权重影响适用置信度，忽略是反向证据；`review` 不参与学习。置信度公式为 `确认数 / (确认数 + 忽略数 + 特殊情况数 × 0.5)`。至少两个不同配方确认才可成为候选；证据变化通过内容指纹识别，已批准规则出现新反例时进入复核队列，重新批准后才视为已复核当前证据。只有 `approved` 状态会生成 `business_rule` 条目。

V3 第二阶段在批准前实时执行影响分析：以规则的泵壳模板和目标 BOM 角色为范围，已包含该角色的配方归为“已符合”，缺少且没有例外反馈的配方归为“需要复核”，`special_case/ignored` 分别保留为特殊情况和已忽略。影响分析不缓存、不写业务库，配方修改后再次查询即可获得最新结果；系统只展示影响，不会批量补件或自动修改成本。

V3 第三阶段把单条影响分析扩展为全局规则执行监控。系统遍历所有 `approved` 规则，区分“规则问题次数”和去重后的“受影响配方数”，并在数据质量看板及 AI 工具中展示；同一配方违反多条规则时只计为一个受影响配方，但保留全部规则关联。该监控不会改变既有数据质量分数，也不会自动修改配方。

V3 第四阶段让同类高频项反馈保存后自动归纳候选规则。反馈写入与规则刷新使用同一个 SQLite 事务，确认、特殊情况、忽略或恢复复核会立即反映到候选状态、置信度和复审队列；手动“重新核对规则”仅作为运维兜底。自动归纳只更新候选及已批准规则的证据状态，不会自动批准规则。

V3 第五阶段增加规则生命周期记录。`factory_rule_events` 以只追加方式保存候选生成、证据变化、批准、驳回、失效、重新激活和升级基线；事件保留变化前后状态、操作者、说明及当时规则快照。相同证据的重复核对不会生成重复事件，历史记录本身不可覆盖或删除。

V3 第六阶段让审核状态与规则知识保持事务一致。规则批准时只新增或更新该条 `factory_rule_candidates` 派生知识；驳回、恢复候选或自动失效时只移除该条知识；已批准规则证据变化时同步刷新内容和置信度。任一步骤失败会回滚规则状态、生命周期事件和规则知识。该增量机制不触碰零件、配方、客户等其他知识，其他业务来源仍按原有方式手动全量同步。

V3 第七阶段增加规则审核状态恢复。管理看板和 AI 可以选择一条包含有效快照的历史事件，将规则恢复为当时的候选、批准或驳回状态；恢复不会回写配方，也不会用旧快照覆盖当前规则内容、证据、置信度或学习指纹。恢复批准时仍按当前数据要求至少两个不同配方确认，并把当前证据标记为已复核。规则更新、新增 `restored` 生命周期事件和知识条目同步处于同一事务，任一步失败会整体回滚；自动失效状态不能从历史强制恢复。

恢复成功返回 `{ success: true, data: { candidate, restoredFromEvent, knowledgeSync } }`。事件不存在或规则不存在返回 `404`，事件不含可恢复审核快照、批准证据不足或 `restoreNote` 超过 500 字返回 `400`，目标状态与当前状态相同返回 `409`。

V3 第八阶段增加规则准入门槛。候选规则只有在当前支持证据不少于 2 个不同配方且置信度达到 65% 时才允许批准或恢复为批准；`approvalEligible` 表示是否满足门槛，`approvalBlockers` 给出具体原因。已批准规则在后续反馈刷新后若置信度跌破 65%，系统会自动把状态撤回为 `candidate`，记录 `approval_suspended` 生命周期事件并移除对应规则知识；置信度恢复后仍需人工重新批准，不会自动恢复正式规则。撤回动作与反馈、候选刷新、事件和知识更新保持同一事务。

V3 第九阶段增加证据来源快照和范围漂移隔离。保存反馈时，服务端从当前配方读取 `recipeId/recipeName/templateId/templateName/recipeUpdatedAt`，连同 `recordedAt` 写入 `finding_snapshot_json.evidenceContext`，并覆盖客户端传入的同名字段。规则归纳以该历史模板为证据归属；如果配方后来更换泵壳模板，旧反馈进入 `learningEvidence.drifted`，不计入确认、特殊情况、忽略、置信度或新模板规则。规则因漂移失去最低支持时自动转为 `stale` 并移除规则知识，看板和 AI 会提示在当前模板下重新智能检查并确认。旧版本未带上下文的反馈继续按当前模板兼容处理，不批量猜测历史归属。

V3 第十阶段增加同模板内的过期证据隔离。规则归纳会比较反馈快照中的 `recipeUpdatedAt` 与配方当前 `updated_at`；模板未变但配方后来被编辑时，旧反馈进入 `learningEvidence.outdated`，不再计入支持、反例或置信度。配方智能检查也会把对应反馈标记为 `outdated`，旧“忽略/特殊情况”不再压住当前提醒；用户按当前配方重新确认后，同一反馈记录会更新为当前版本的新证据。已批准规则因过期证据失去准入条件时自动失效或进入复审，规则知识同步更新。`PATCH /api/recipes/:id` 编辑或 `DELETE /api/recipes/:id` 归档存在规则学习反馈的配方时，会在同一事务内自动刷新候选规则与已批准规则知识条目，无需再手动点击“重新核对规则”。旧反馈保留用于追溯，不自动删除，也不会修改配方。

V3 第十一阶段增加学习证据健康检查。`GET /api/quality/rule-learning-health` 不依赖候选规则是否已经生成，直接扫描全部有效学习决策，因此单个配方反馈或尚未达到两个确认的反馈也不会成为管理盲区。服务按当前配方状态区分仍有效、内容过期、模板漂移和配方已归档；内容过期与模板漂移进入待重新检查队列，归档证据只保留追溯。管理看板和 AI 使用同一只读结果，系统不会自动恢复反馈、修改配方或批准规则。

V3 第十三阶段补齐待复核任务的处理结论。看板直达配方时携带具体反馈 ID；重新智能检查后，仍存在的提醒会被精确高亮并要求按当前配置重新判断。原提醒已不再出现时，`POST /api/quality/recipe-feedback/:id/resolve` 允许用户确认已解决；服务端会重新校验反馈确实处于内容过期或模板漂移状态，并再次执行当前配方智能检查，只有同一提醒确实不再出现时才允许处理。服务保留原始证据快照，将判断恢复为 `review` 并事务化刷新候选规则。当前有效、仍有同一提醒、已处理及归档反馈不能通过该入口清理。

V3 第十四阶段在 Web 端把健康检查返回的待复核反馈按配方聚合。看板使用同一配方的反馈 ID 集合打开一次智能检查，配方页按集合顺序逐条定位并显示处理进度；每次重新判断或确认已解决后，从本地任务队列移除当前项并自动切换下一条。该阶段不改变 API 数据含义，也不提供批量确认。

V3 第十五阶段补齐待复核工作台的操作闭环。反馈保存和已消失提醒确认继续使用原有 API 返回的 `ruleLearning`，Web 端展示候选规则的新生成、重算、失效、撤回批准及剩余隔离证据数量；暂时跳过只调整本地处理顺序，不写数据库。整组完成后清除 `feedbackIds/feedbackId/action` 参数，并通过 `/dashboard?view=quality` 完整导航重新拉取学习证据健康状态。本阶段未新增 API，也不改变反馈或规则的数据语义。

## 17. 统一文件 Files

V9.1 使用 `factory_files` 作为 PDF、Excel、文本和图片的统一原文件对象。上传时以后端检测出的真实内容类型为准，不信任浏览器提交的 MIME；文件最大 10MB，只允许 `.pdf/.xls/.xlsx/.csv/.txt/.md/.png/.jpg/.jpeg/.webp`。扩展名与文件签名不一致、无效 UTF-8 文本、损坏 Excel、危险可执行扩展名或空文件会在写库前拒绝。V9.2 对 PDF 提取文字层、页码、行坐标和连续表格行；V9.3 对 Excel/CSV 提取工作表、行列、单元格、公式和表格块；V9.4 对图片和无文字层 PDF 执行本地中英文 OCR；V9.5 使用 `factory_file_links` 把同一文件可追溯地关联到客户、报价、配方、质量问题或知识资料，不复制原文件。V10.1 增加订单客户要求文件关联。

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/files` | 查询参数 `detectedType?=pdf/spreadsheet/image/text`, `sourceType?`, `limit?` | 列出统一文件元数据，不返回二进制；默认 30 条，最大 100 条 |
| `POST` | `/api/files` | `multipart/form-data`: `file` | 标准上传入口；按 SHA-256 去重，新文件返回 `201`，重复文件复用原对象并返回 `200 + deduplicated=true` |
| `GET` | `/api/files/archive-targets` | 查询参数 `targetType=customer/quotation/order/recipe/recipe_analysis_feedback/ai_answer_feedback`, `query?`, `limit?` | 只读查找真实归档目标；订单可按客户名或合同号查找；返回业务标签和说明，供界面或 AI 消歧，不接受知识资料类型 |
| `GET` | `/api/files/links` | 查询参数 `targetType`, `targetId` | 按业务对象列出有效文件关联及文件元数据 |
| `GET` | `/api/files/:id` | 无 | 读取单个文件对象的类型、大小、哈希、解析状态和来源 |
| `GET` | `/api/files/:id/links` | 无 | 列出该文件当前关联的业务对象 |
| `POST` | `/api/files/:id/archive` | `{ targetType, targetId?, title?, note?, documentType?, tags?, source? }` | 归档文件；客户、报价、订单、配方和质量问题必须传真实 `targetId`；订单默认关系角色为 `customer_requirement`；知识资料使用 `targetType=knowledge_document` 且由系统创建或复用同文件资料；重复关联返回 `deduplicated=true` |
| `DELETE` | `/api/files/:id/links/:linkId` | 无 | 软删除指定文件关联，不删除原文件或目标业务记录 |
| `POST` | `/api/files/:id/parse` | 无 | 重新解析 PDF、Excel、CSV 或图片；成功返回更新后的文件对象，其他类型或解析失败返回 `400` |
| `POST` | `/api/files/:id/quotation-draft` | `{ customerName? }` | 只读把 Excel/CSV 报价文件映射为客户、配方、数量、文件单价和待确认项；只有全部精确匹配时返回 `quotationDraftInput`，不创建客户、配方或报价 |
| `GET` | `/api/files/:id/content` | 无 | 读取完整解析结果；PDF 包含逐页 `lines/tables`，表格包含逐工作表 `rows/cells/tables`，均保留原文定位且不返回原二进制 |
| `GET` | `/api/files/:id/download` | 无 | 下载原文件 |
| `DELETE` | `/api/files/:id` | 无 | 软删除未被业务资料引用的文件；仍被知识资料、配方测试报告、聊天历史或 `factory_file_links` 引用时返回 `409` |

PDF 上传时同步完成解析：有文字层的页面使用 `【第 N 页】`，无文字层页面自动渲染并使用 `【第 N 页 OCR】`；混合 PDF 按页面合并。PDF 文字层最多处理 100 页和 30 万字符，OCR 最多处理 12 个扫描页、单页最多约 700 万渲染像素。图片 OCR 支持 PNG、JPG 和 WebP，原图超过 4000 万像素会拒绝解析。OCR 结果保存逐页/逐行文字框与置信度，并生成只读 `drawingCandidates`；低于 85% 标记 `needsReview`。未识别到文字时为 `metadata_only + ocrApplied=true`，AI 不得猜测原图内容。表格最多处理 20 个工作表、5000 个非空行、100 列、5 万个非空单元格和 30 万字符；保留工作表名、行号、列号、单元格引用、公式与合并区域，超出部分通过 `truncated=true` 明示。

报价映射使用当前未归档客户和配方，只把精确名称/型号命中标记为可继续；客户型号精确命中优先于“规格”字段，避免常见规格同时出现在多个历史配方时把明确型号误判为多候选。近似匹配、同名重复、多个候选、数量无效、金额不一致和未找到记录都进入待确认项。`quotationDraftInput` 只是现有 `/api/quotations/save-payload-draft` 的候选入参，文件单价不等于系统成本，正式报价草稿仍必须由标准报价 API 按当前配方重新试算。该链路不自动新增客户或配方，也不写正式报价。

V9.5/V10.1 归档使用多态目标校验：客户、报价、订单、配方和知识资料必须仍处于有效状态；“质量问题”映射到现有 `recipe_analysis_feedback` 或 `ai_answer_feedback`，不虚构第三套质量表。归档到知识库只允许已经 `parsed/metadata_only` 的文件，系统创建的 `knowledge_documents` 复用 `factory_files.file_id`，并通过现有知识自动同步进入检索。AI 工具 `search_factory_file_archive_targets` 只读查目标，`archive_factory_file` 属于写工具，必须显示确认卡片。聊天附件卡片也提供同一归档入口并显示已有归档。OCR 参数候选即使随文件归档也不升级为已确认事实。

V9 收口后，客户详情、报价详情和质量反馈入口通过 `POST /api/files` 上传，再以 `source=business_page` 调用归档接口；列表统一读取 `GET /api/files/links`，解除关联使用软删除接口。AI 回答反馈也可在知识管理页关联问题截图或原始资料。业务页上传不会自动创建知识资料；需要长期检索时必须另行归档到 `knowledge_document`。

## 18. 工厂知识库 Knowledge

Knowledge Base V1 使用本地 SQLite `knowledge_entries` 表保存派生知识条目，并在 SQLite 支持 FTS5 时启用 `knowledge_entries_fts`；如果当前 SQLite 构建不支持 FTS5，搜索自动回退到 `LIKE`。

同步来源覆盖：零件、泵壳模板、配方、线圈、客户、报价、订单、数据质量问题、业务规则和独立工厂资料。配方知识条目会合并其性能测试报告解析文本，因此 AI 可检索报告型号、测试结论和每个性能点；上传或删除报告后由 V4 自动同步对应派生知识。配方条目的 `metadata.testReports` 以 `{ id, kind: "pump_performance_test", label: "性能测试报告", fileName }` 明确标识附件类型，测试报告不得作为图纸展示。知识条目字段统一为 camelCase 响应，核心字段包括 `id/entryType/sourceTable/sourceId/title/summary/content/tags/metadata/syncedAt/updatedAt`。

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/knowledge/overview` | 无 | 只读生成当前业务知识快照，并用 `sourceTable + sourceId + contentHash` 与已同步条目比较；返回条目总量、分类覆盖、最近同步时间、FTS 状态、待新增/更新/移除清单和 `autoSync` 运行状态，不写数据库 |
| `GET` | `/api/knowledge/sync-runs` | 查询参数 `limit?`, `status?=success/failed` | 读取最近同步运行历史和汇总；返回自动/即时/手动模式、成功或失败、触发来源、尝试次数、耗时、变更统计和错误原因，最多保留最近 200 次 |
| `GET` | `/api/knowledge/health` | 无 | 只读检查自动同步关闭、等待或运行超时、未安排的知识变化和最近失败；返回 `healthy/attention/critical`、问题明细及是否建议人工恢复 |
| `GET` | `/api/knowledge/vector-health` | 无 | 只读返回向量扩展、embedding 模型、缓存目录、后台队列、覆盖率及最近运行；组件可用且混合检索开关开启时 `searchMode=hybrid`，否则为 `fts` |
| `GET` | `/api/knowledge/vector-sync-runs` | 查询参数 `limit?`, `status?=success/failed` | 读取最近向量同步历史和汇总，包含模型、维度、新增、更新、跳过、删除、失败、待处理和耗时，最多保留最近 200 次 |
| `GET` | `/api/knowledge/retrieval-evaluation` | 无 | 只读运行固定中文检索评测，对比 FTS/BM25、纯向量和混合检索的 Top 1/Top 3；返回逐项期望、名次、前三标题及验收结论，不调用外部 AI、不写数据库 |
| `GET` | `/api/knowledge/documents` | 无 | 列出未删除的独立工厂资料元数据，不返回文件二进制和提取全文 |
| `POST` | `/api/knowledge/documents` | `multipart/form-data`: `documentType`, `title`, `description?`, `contentText?`, `tags?`, `file?` | 导入独立工厂资料；必须填写技术内容或上传文件，文件最大 10MB，支持 `.txt/.md/.csv/.xls/.xlsx/.pdf` |
| `GET` | `/api/knowledge/documents/:id/download` | 无 | 下载独立工厂资料原文件 |
| `DELETE` | `/api/knowledge/documents/:id` | 无 | 软删除原始资料，自动移除对应派生知识 |
| `GET` | `/api/knowledge` | 查询参数 `query?`, `entryType?`, `sourceTable?`, `limit?` | 使用 FTS/BM25 + 向量混合搜索知识条目；`entryType` 支持 `part/template/recipe/coil/customer/quotation/order/quality_issue/business_rule/document`；默认最多 10 条，最大 50 条。每项附带 `matchMode/evidenceLevel/exactMatch/keywordRank/vectorDistance/finalScore`；`evidenceLevel=semantic_candidate` 表示纯语义候选，不能单独证明用途、兼容性或专用配件关系。型号、规格、客户名和合同号等精确命中优先。线圈条目以“规格-片数 + 材质 + 槽眼”区分，`defaultWireGauge` 在知识正文中标注为“默认搭配电缆线径” |
| `GET` | `/api/knowledge/:id` | 无 | 读取单条知识详情，包含完整 `content/tags/metadata` |
| `POST` | `/api/knowledge/sync` | 无 | 人工全量核对当前来源，按内容哈希新增、更新和移除 `knowledge_entries`，保留既有条目 ID，并在同一事务中刷新可选 FTS；用于故障恢复，不修改原业务资源 |

同步响应的 `stats` 包含 `total/inserted/updated/unchanged/deleted/byType`。任一业务条目或 FTS 写入失败时，整个同步事务回滚，继续保留上一版完整知识库。

概况响应的 `stats` 包含 `currentTotal/storedTotal/fresh/pendingTotal/pendingInsert/pendingUpdate/pendingDelete`，`byType` 按知识分类返回当前来源数、已同步数、最新数和待同步数。新鲜度以实际生成内容的哈希为准，不仅比较更新时间，因此不会因报告生成时间或质量检查时间变化产生虚假过期提示。

V4 自动同步监听标准写入 helper 中的核心来源变更，300ms 内的连续写入会合并为一次同步。`autoSync` 返回 `enabled/running/pending/pendingSources/lastRequestedAt/lastStartedAt/lastCompletedAt/lastFailedAt/lastError/consecutiveFailures/retryScheduled/lastResult`。失败会保留待同步来源并按 1 秒、5 秒、15 秒自动重试；人工 `/api/knowledge/sync` 成功后会清除失败和等待状态。可通过 `KNOWLEDGE_AUTO_SYNC_ENABLED=false` 临时关闭自动同步，人工同步不受影响。

V4 第二阶段使用 SQLite `knowledge_sync_runs` 保存同步运行历史。每次自动重试是独立记录，`attempt` 表示同一轮同步的尝试次数；人工同步失败也会记录后再返回错误。历史写入失败不会反向破坏已经成功生成的知识索引，系统只保留最近 200 次运行，避免运行日志无限增长。

V4 第三阶段通过 `/api/knowledge/health` 汇总运行态、内容哈希差异和最近历史。待同步超过 60 秒、运行超过 120 秒、存在未安排变化或同步失败时产生告警；自动同步关闭只标记为需要关注。没有业务变化时，即使很久没有产生新同步记录也保持健康，避免时间型假告警。看板恢复动作继续使用受确认保护的人工同步入口。

V5.1 使用 SQLite `knowledge_documents` 保存系统外资料及可选原文件。`technical_note/pump_performance_test/drawing/spreadsheet/other` 是当前资料类型；文本和 Excel 提取正文进入 `document` 知识条目，性能测试报告继续复用水泵测试报告解析器。PDF 原件保存在 SQLite，但 `parserStatus=metadata_only`，当前只检索标题、说明、标签和文件信息；AI 不得据此推断图纸尺寸、材料、结构或其他正文参数。资料新增和软删除均自动触发知识同步。

V6.1 增加本地向量底座，但不改变现有搜索结果。`knowledge_embeddings` 以 `entryId + model` 唯一保存 384 维 Float32 BLOB、内容哈希和更新时间；`sqlite-vec v0.1.9` 负责余弦距离计算，`@huggingface/transformers v4.2.0` 按需加载 `Xenova/multilingual-e5-small`。模型默认缓存到当前用户的 `.cache/pump-knowledge-models`，可用 `KNOWLEDGE_MODEL_CACHE_DIR` 指定目录；生产机联网时先运行 `npm run knowledge:model-prepare` 完成首次缓存和真实 embedding 检查，再设置 `KNOWLEDGE_MODEL_OFFLINE=true` 并重启。`npm run knowledge:vector-check` 只检查扩展与运行时，不下载模型。

V6.2 在每次文字知识成功提交后请求独立后台队列，按 `knowledge_entries.content_hash` 分批生成新增或变化向量。每批成功即提交，模型加载或单批失败不会回滚业务数据、文字知识和其他成功批次；失败任务自动重试，来源删除通过外键立即级联删除向量。模型或维度变化时，新模型可断点生成，全部当前向量新鲜后才清理旧模型，检索链路不会混用模型。`knowledge_vector_sync_runs` 持久化新增、更新、跳过、删除、失败、待处理和耗时；可用 `KNOWLEDGE_VECTOR_AUTO_SYNC_ENABLED=false` 关闭后台生成，`KNOWLEDGE_VECTOR_BATCH_SIZE` 默认 16、最大 64。

V6.3 的搜索先分别取得 FTS/BM25 与当前模型的新鲜向量候选，再使用稳定 RRF 融合。标题、来源标识和型号、规格、客户名、合同号等结构化元数据包含完整查询词时增加确定性优先级，不会被语义近似项挤出；已有精确关键词命中时不追加纯向量近似项，避免把相邻型号或规格混入回答。两条链路共同使用 `entryType/sourceTable` 过滤；查询 embedding、sqlite-vec 或模型加载失败时返回原 FTS/LIKE 结果，并将结果标记为 `keyword/exact` 而非伪造 `vector/hybrid`。`KNOWLEDGE_HYBRID_SEARCH_ENABLED=false` 可临时关闭混合检索，AI 仍使用原 `search_factory_knowledge` 工具入口。

V6.4 使用 11 条固定中文样例验收检索层，覆盖精确泵壳型号、用途口语、错别字、菲律宾配方、线圈材质与槽眼、成品电缆、完整成本、客户报价和测试报告别名。`npm run test:knowledge-retrieval` 复用运行中 API 的本地 embedding 模型执行，不调用外部 AI；混合检索不得降低 FTS 的 Top 1/Top 3，精确样例必须保持 Top 1，且语义样例的 Top 3 必须得到提升。`npm run knowledge:backup-check` 使用 SQLite 在线备份创建临时恢复库，并自动验证完整性、外键、条目/向量数量和实际余弦查询，结束后删除临时文件。

向量结果只负责召回候选，不自动成为业务事实。搜索结果中的 `exact_text/text_match` 表示存在可核对的文本命中，`semantic_candidate` 表示仅语义相近；AI 只有在条目标题、摘要、正文或结构化元数据明确写出用途、兼容性或配件关系时，才能使用“适合、专用、自带、配套”等肯定表述。知识库内置“切割泵壳与配件识别”正式规则，区分 800平刀切割泵壳、SPA 清水泵壳、外六角切边长螺丝和不配刀泵壳；回归检查覆盖这些结论，防止普通螺丝或 SPA 被误称为切割专用，也禁止在来源未写明时声称“全套含刀”。

AI 工具层采用证据优先门控：同一次搜索已有 `exact_text/text_match` 结果时，不把其余纯 `semantic_candidate` 候选交给回答模型；只有完全没有文本证据时才保留语义候选用于继续核对。产品用途、适用型号和专用配件问题会由服务端强制发起本轮知识查询，得到工具结果后移除历史 assistant 结论，仅保留用户上下文和本轮工具链，避免旧会话中的错误回答覆盖新证据。

AI 工具：

- `search_factory_knowledge`：只读搜索知识库。
- `get_factory_knowledge_detail`：只读读取详情。
- `get_factory_knowledge_health`：只读诊断自动同步状态、失败原因和人工恢复建议。
- `get_management_action_center`：只读汇总今天优先处理的订单、经营、质量、规则学习和知识库健康事项。
- `sync_factory_knowledge`：同步知识索引；因为会写 `knowledge_entries`，必须经过 AI 写操作确认。
- `save_order_requirement_draft`：经用户确认后保存订单客户要求草稿；草稿不属于正式知识，确认进入知识库和撤销确认只能在订单页面完成。

## 19. 当前兼容边界

- 核心资源已补齐 `id/createdAt/updatedAt` 标准字段；`Id/CreatedAt/UpdatedAt` 是历史兼容字段，Web 页面必须使用标准字段。
- 零件、配方、订单、客户和报价的更新/删除统一使用 `/:id` 路径入口；旧式 body 带 ID 写入口已移除。
- 成本历史命名入口已移除；当前标准入口为 `/api/cost/parts`、`/api/recipes/:id/cost`、`/api/recipes/:id/cost-preview`、`/api/cost/dynamic` 和 `/api/cost/full-estimate`。
- `GET /api/rotor/history` 已输出 camelCase 标准字段；snake_case 字段仅作为历史兼容字段。
- `POST /api/rotor/draw`、`POST /api/rotor/chat` 标准响应为 `{ success, data/error }`。
- 客户和报价新增接口标准返回完整 `data` 对象，不再返回顶层 `id`。
- 正式业务资源的新增、动态更新和删除已分别收口到 `safeInsert`、`safeUpdate`、`softDelete` / `hardDelete`；系统初始化、`system_settings` / `config` UPSERT 仍属于基础设施边界。
