# API 接口总表

> 更新于 2026-07-21。本文按当前代码整理，覆盖 Express 路由。开发规范见 [api-sop.md](./api-sop.md)，业务口径见 [README.md](./README.md)。

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
| `GET` | `/api/parts` | 无 | 零件列表，Row Adapter 输出 camelCase，并临时保留 `Id/CreatedAt/UpdatedAt` |
| `POST` | `/api/parts` | `model, category, price, supplier, stock, remark/notes` | 新增零件，返回新零件 |
| `PATCH` | `/api/parts/:id` | 可更新字段 | 更新入口；动态更新必须走 `safeUpdate('parts', id, updates)` |
| `DELETE` | `/api/parts/:id` | 无 | 软删除并返回 `{ deleted: 1 }` |
| `PATCH` | `/api/parts/prices` | `{ updates: [{ partId, price }] }` | 批量更新零件价格；`partId` 必须为正整数，`price` 必须为非负有效数字 |
| `POST` | `/api/parts/batch-stock` | `{ operations: [{ partId, delta }] }` | 批量库存增减，库存最低为 0；`partId` 必须为正整数，`delta` 必须为有效数字 |

## 5. 线圈 Coils

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/coils` | 无 | 线圈列表 |
| `POST` | `/api/coils` | `spec, sheets, material?, unitPrice?, wireWeight?, copperBase?, coilFee?, rotorFee?, defaultWireGauge?, defaultCapacitor?` | 新增线圈并计算 `cost` |
| `PATCH` | `/api/coils/:id` | 线圈 camelCase 字段 | 更新后自动重算 `cost` |
| `DELETE` | `/api/coils/:id` | 无 | 硬删除并审计 |
| `GET` | `/api/coils/materials` | 无 | `{ defaultMaterial, materials, materialPrices }` |
| `PUT` | `/api/coils/materials` | `{ materialPrices }` | 保存材质单价到 `system_settings.coil_material_prices` |
| `POST` | `/api/coils/spec-draft` | `{ spec, material? }` | 新增线圈时生成同规格带入草稿；优先同规格同材质，否则同规格辅助字段 + 材质默认单价；不写库 |
| `PATCH` | `/api/coils/spec/:spec` | `{ unitPrice, material? }` | 按规格批量更新单价，可按材质过滤 |
| `POST` | `/api/coils/calculate` | `{ spec, sheets, material?, wireWeight?, copperPrice? }` | 线圈成本计算，支持精确匹配、插值和外推 |
| `GET` | `/api/coils/specs` | 无 | 可用规格、材质和片数列表 |

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
| `POST` | `/api/recipes/save-payload-draft` | `{ form, costDraft, packingParts?, optionalParts?, technicalData? }` | 基于表单草稿和成本草稿生成最终保存 payload；统一序列化 JSON、ID、数字和表面处理字段；逐项检查 `costDraft.parts[].snapshotPrice`，缺失、无效或小于等于 0 时返回 400 并列出未定价 BOM 项目；`form.coilWireWeight` 会保存为客户指定线重，`form.longScrewExtraLength` 会作为非负数进入正式配方保存；不写库 |
| `GET` | `/api/recipes/:id/inventory-status` | 无 | 按配方 BOM 返回配件、当前库存和状态；只读，不执行生产或扣减库存 |
| `POST` | `/api/recipes` | 配方字段，优先 camelCase | 新增配方并保存成本/技术快照；`partsJson` 中任一 BOM 项目的 `snapshotPrice` 缺失、无效或小于等于 0 时返回 400；若含已计价但零件库缺失的长螺丝型号，会自动补齐螺丝零件并返回 `createdLongScrewParts` |
| `PATCH` | `/api/recipes/:id` | 配方字段 | 更新入口；提交 `partsJson` 时执行相同的 BOM 单价检查，同样可能返回 `createdLongScrewParts` |
| `DELETE` | `/api/recipes/:id` | 无 | 软删除 |
| `GET` | `/api/recipes/:id/technical-files` | 无 | 列出配方性能测试报告附件及解析摘要，不返回文件二进制和完整解析文本 |
| `POST` | `/api/recipes/:id/technical-files` | `multipart/form-data`，字段 `file`，支持 `.xls/.xlsx`，最大 10MB | 保存原始 Excel 到 SQLite，并解析水泵性能报告的型号、测试号、日期和测试点明细；模板中的规定点、实测点和偏差不进入 API 摘要或知识检索文本 |
| `GET` | `/api/recipes/:id/technical-files/:fileId/download` | 无 | 下载原始测试报告 |
| `DELETE` | `/api/recipes/:id/technical-files/:fileId` | 无 | 软删除测试报告 |
| `GET` | `/api/recipes/:id/cost` | 无 | 当前配件重算参考，不是保存成本，也不是完整总成本 |
| `GET` | `/api/recipes/current-costs` | 无 | 批量返回所有配方的当日完整成本；普通零件按当前零件库价格、线圈按当前铜价和线圈参数重算，并叠加人工、表面处理与管理费；同时返回相对保存成本的差额 |
| `POST` | `/api/recipes/:id/cost-preview` | `{ overrides }` | 报价/试算用，以配方快照为基线重算覆盖项 |
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
| `POST` | `/api/recipes/:id/cost-preview` | `{ overrides }` | 同第 8 节；报价覆盖试算 |
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
| `POST` | `/api/copper-price/update` | 无 | 手动同步铜价，并更新所有线圈铜价基数 |
| `GET` | `/api/market-indicators` | 无 | 铜价、铝价、美元兑人民币汇率的实时值与数据库值 |
| `POST` | `/api/market-indicators/update` | 无 | 同步铜价、铝线价格基数、美元汇率 |

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
| `POST` | `/api/quotations/save-payload-draft` | `{ customerId, status?, items, remark? }` | 基于报价表单草稿生成标准保存 payload；统一明细、总成本和总报价；不写库 |
| `POST` | `/api/quotations` | `{ customerId, status?, itemsJson?, totalCost?, totalPrice?, remark? }` | 新增报价；标准返回 `{ data: quotation }` |
| `POST` | `/api/quotations/:id/order-draft` | 无 | 基于报价、客户、配方快照生成订单草稿、采购清单和待办；不创建订单，不改报价状态 |
| `PATCH` | `/api/quotations/:id` | 报价字段 | 更新报价；返回 `{ data: quotation }` |
| `DELETE` | `/api/quotations/:id` | 无 | 软删除 |

## 11. 订单 Orders

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/orders` | 无 | 订单列表，标准字段含 `id/createdAt/updatedAt` |
| `GET` | `/api/orders/:id` | 无 | 单个订单，标准字段含 `id/createdAt/updatedAt` |
| `GET` | `/api/orders/history-price/:recipeName` | 路径参数 `recipeName` | 查该配方最近历史售价和利润率 |
| `POST` | `/api/orders/purchase-plan` | `{ items: [{ partsJson, qty }] }` | 按订单明细生成采购清单和供应商待办；不写库 |
| `POST` | `/api/orders/save-payload-draft` | `{ customerName, contractNo?, remark?, status?, items, purchaseList?, todos? }` | 基于订单表单草稿生成标准保存 payload；未传采购清单/待办时自动生成；不写库 |
| `POST` | `/api/orders/purchase-items/batch` | `{ model, supplier?, purchased }` | 采购中心按供应商和型号批量设置未完成订单的采购项状态；不入库 |
| `POST` | `/api/orders/:id/status` | `{ status }` | 更新订单状态；`status` 只能是 `待采购/采购中/已完成` |
| `POST` | `/api/orders/:id/purchase-items/toggle` | `{ model, supplier?, purchased? }` | 切换或设置指定采购项的已采状态 |
| `POST` | `/api/orders/:id/todos/toggle` | `{ todoId, done? }` | 切换或设置指定采购待办完成状态 |
| `POST` | `/api/orders/:id/complete-purchase` | 无 | 确认采购完成并入库；在同一事务内更新零件库存和订单状态 |
| `POST` | `/api/orders` | `{ customerName, contractNo?, remark?, status?, itemsJson?, purchaseListJson?, todosJson? }` | 新增订单 |
| `PATCH` | `/api/orders/:id` | 订单字段 | 更新入口 |
| `DELETE` | `/api/orders/:id` | 无 | 软删除 |

## 12. 工作台 Workbench

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/workbench/summary` | 无 | 经营、库存、采购和待办汇总 |

## 13. 设置 Settings

允许的设置 key：

- `management_fee`
- `coil_material_prices`
- `cable_accessories`
- `float_accessory_delta`
- `aluminum_wire_price_per_kg`
- `usd_cny_rate`

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/settings` | 无 | 所有系统设置，返回 key-value 对象 |
| `GET` | `/api/settings/:key` | 白名单 key | 单个设置值 |
| `PUT` | `/api/settings/:key` | `{ value }` | 更新设置；数值类必须非负，`cable_accessories` 必须含 `standard/xinjie` 的 `name` 和 `fee` |

## 14. 转子 Rotor

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/rotor/draw` | 结构化出图参数；可带 `drawingName/drawing_name`、`drawingText/drawing_text` | 启动异步 FreeCAD 出图任务；标准返回 `{ success, data: { status, message, jobId, drawingName, params } }` |
| `POST` | `/api/rotor/save` | 结构化转子参数；可带 `drawingName/drawing_name`、`drawingText/drawing_text` | 保存暂定参数到历史，不启动 FreeCAD；记录状态为 `saved`，返回 `{ success, data, jobId, drawingName, params }` |
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
| `POST` | `/api/ai/chat` | `{ messages }` | SSE 流式对话；事件数据形如 `data: { type, ...payload }` |
| `POST` | `/api/ai/confirm-tool` | `{ toolName, args? }` | 用户确认后执行写工具；调用 `executeToolCall(..., { allowWrite: true })` |
| `GET` | `/api/ai/system-prompt` | 无 | 读取当前 System Prompt |
| `PUT` | `/api/ai/system-prompt` | `{ prompt }` | 更新内存和 SQLite `config.ai-system-prompt`；不能为空，最大 50000 字符 |

AI 对话请求只保留最近 10 条有效的 `user/assistant` 消息作为上下文；前端与后端都会执行该限制，当前消息包含在这 10 条内。

价格、成本、库存、订单状态、报价金额和铜价等易变业务数据查询会在首轮强制调用至少一个只读工具，避免模型从会话上下文复述已过期数值。明确查询知识库时使用知识库结果；若知识条目与实时业务 API 冲突，以实时业务值为准并提示同步知识库。

### AI 会话历史

AI 工作台会把会话和消息保存到 SQLite。所有接口均需登录，并按当前登录身份隔离；历史消息中的待确认工具只读，不能从历史记录重复执行。

| 方法 | 路径 | 请求 | 说明 |
|---|---|---|---|
| `GET` | `/api/ai/conversations?limit=50` | 无 | 获取最近会话，默认 50 条，最大 100 条 |
| `POST` | `/api/ai/conversations` | `{ title }` | 创建会话，标题最大 80 字符 |
| `GET` | `/api/ai/conversations/:id` | 无 | 获取会话及按时间排序的全部消息 |
| `POST` | `/api/ai/conversations/:id/messages` | `{ role, content, metadata? }` | 追加 `user/assistant` 消息及工具展示数据 |
| `PATCH` | `/api/ai/conversations/:id/messages/:messageId` | `{ metadata }` | 更新已保存消息的工具执行结果 |
| `DELETE` | `/api/ai/conversations/:id` | 无 | 软删除会话；历史消息保留在数据库中但不再展示 |

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
- `search_factory_knowledge`：调用 `/api/knowledge` 搜索工厂知识库。
- `get_factory_knowledge_detail`：调用 `/api/knowledge/:id` 读取知识条目详情。
- `sync_factory_knowledge`：调用 `/api/knowledge/sync` 增量更新知识条目并刷新 FTS；该工具写入派生索引，位于写工具白名单，需确认后执行。

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

数据质量报告返回 `score/totals/issues/topIssues`，用于 `/dashboard` 的“数据质量”视图和 AI 质量检查工具；旧 `/quality` 页面仅保留兼容跳转。常见检查包括零件价格/供应商/库存、配方 BOM 和保存成本、模板泵壳引用、线圈默认电容/线径、客户默认利润率和历史报价金额异常。

经营异常报告返回 `totals/alerts/topAlerts`，用于报价页、订单页和 AI 经营风险检查工具。它不改变报价或订单状态，只提示需要人工跟进的业务风险。

## 17. 工厂知识库 Knowledge

Knowledge Base V1 使用本地 SQLite `knowledge_entries` 表保存派生知识条目，并在 SQLite 支持 FTS5 时启用 `knowledge_entries_fts`；如果当前 SQLite 构建不支持 FTS5，搜索自动回退到 `LIKE`。

同步来源覆盖：零件、泵壳模板、配方、线圈、客户、报价、订单、数据质量问题和业务规则。配方知识条目会合并其性能测试报告解析文本，因此 AI 可检索报告型号、测试结论和每个性能点；上传或删除报告后需再次同步知识库。配方条目的 `metadata.testReports` 以 `{ id, kind: "pump_performance_test", label: "性能测试报告", fileName }` 明确标识附件类型，测试报告不得作为图纸展示。知识条目字段统一为 camelCase 响应，核心字段包括 `id/entryType/sourceTable/sourceId/title/summary/content/tags/metadata/syncedAt/updatedAt`。

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/knowledge` | 查询参数 `query?`, `entryType?`, `sourceTable?`, `limit?` | 搜索知识条目；`entryType` 支持 `part/template/recipe/coil/customer/quotation/order/quality_issue/business_rule`；默认最多 10 条，最大 50 条 |
| `GET` | `/api/knowledge/:id` | 无 | 读取单条知识详情，包含完整 `content/tags/metadata` |
| `POST` | `/api/knowledge/sync` | 无 | 按来源增量新增、更新和移除 `knowledge_entries`，保留既有条目 ID，并在同一事务中刷新可选 FTS；不修改原业务资源 |

同步响应的 `stats` 包含 `total/inserted/updated/unchanged/deleted/byType`。任一业务条目或 FTS 写入失败时，整个同步事务回滚，继续保留上一版完整知识库。

AI 工具：

- `search_factory_knowledge`：只读搜索知识库。
- `get_factory_knowledge_detail`：只读读取详情。
- `sync_factory_knowledge`：同步知识索引；因为会写 `knowledge_entries`，必须经过 AI 写操作确认。

## 18. 当前兼容边界

- 核心资源已补齐 `id/createdAt/updatedAt` 标准字段；`Id/CreatedAt/UpdatedAt` 是历史兼容字段，Web 页面必须使用标准字段。
- 零件、配方、订单、客户和报价的更新/删除统一使用 `/:id` 路径入口；旧式 body 带 ID 写入口已移除。
- 成本历史命名入口已移除；当前标准入口为 `/api/cost/parts`、`/api/recipes/:id/cost`、`/api/recipes/:id/cost-preview`、`/api/cost/dynamic` 和 `/api/cost/full-estimate`。
- `GET /api/rotor/history` 已输出 camelCase 标准字段；snake_case 字段仅作为历史兼容字段。
- `POST /api/rotor/draw`、`POST /api/rotor/chat` 标准响应为 `{ success, data/error }`。
- 客户和报价新增接口标准返回完整 `data` 对象，不再返回顶层 `id`。
- 正式业务资源的新增、动态更新和删除已分别收口到 `safeInsert`、`safeUpdate`、`softDelete` / `hardDelete`；系统初始化、`system_settings` / `config` UPSERT 仍属于基础设施边界。
