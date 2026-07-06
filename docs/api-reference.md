# API 接口总表

> 更新于 2026-06-24。本文按当前代码整理，覆盖已记录和未单独记录的 Express 路由。开发规范见 [api-sop.md](./api-sop.md)，业务口径见 [README.md](./README.md)。

## 1. 通用约定

- 后端服务端口：`3002`。
- 常规 API 前缀：`/api`。
- Web 前端必须通过 `src/utils/api.ts` 的 `proxyRequest()`、`proxyFetch()` 或 `proxyFormRequest()` 调用。
- 请求/响应业务字段默认使用 camelCase；数据库字段保持 snake_case。
- 标准成功响应：`{ "success": true, "data": ... }`。
- 标准失败响应：`{ "success": false, "error": "错误信息" }`。
- 历史兼容接口可能额外返回顶层字段，或使用 `{ status, message }` 格式；新接口不得继续扩散这些格式。

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
| `GET` | `/api/parts` | 无 | 零件列表，Row Adapter 输出 camelCase |
| `POST` | `/api/parts` | `model, category, price, supplier, stock, remark/notes` | 新增零件，返回新零件 |
| `PATCH` | `/api/parts` | `id/Id` 加可更新字段 | 动态更新必须走 `safeUpdate('parts', id, updates)` |
| `DELETE` | `/api/parts` | 单个对象或数组，含 `id/Id` | 软删除；返回 `{ deleted }` |
| `POST` | `/api/parts/batch-stock` | `{ operations: [{ partId/id/Id, delta }] }` | 批量库存增减，库存最低为 0 |

## 5. 线圈 Coils

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/coils` | 无 | 线圈列表 |
| `POST` | `/api/coils` | `spec, sheets, material?, unitPrice?, wireWeight?, copperBase?, coilFee?, rotorFee?, defaultWireGauge?, defaultCapacitor?` | 新增线圈并计算 `cost` |
| `PATCH` | `/api/coils/:id` | 线圈 camelCase 字段 | 更新后自动重算 `cost` |
| `DELETE` | `/api/coils/:id` | 无 | 硬删除并审计 |
| `GET` | `/api/coils/materials` | 无 | `{ defaultMaterial, materials, materialPrices }` |
| `PUT` | `/api/coils/materials` | `{ materialPrices }` | 保存材质单价到 `system_settings.coil_material_prices` |
| `PATCH` | `/api/coils/spec/:spec` | `{ unitPrice, material? }` | 按规格批量更新单价，可按材质过滤 |
| `POST` | `/api/coils/calculate` | `{ spec, sheets, material?, wireWeight?, copperPrice? }` | 线圈成本计算，支持精确匹配、插值和外推 |
| `GET` | `/api/coils/specs` | 无 | 可用规格、材质和片数列表 |

## 6. 模板 Templates

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/templates` | 无 | 泵壳模板列表 |
| `GET` | `/api/templates/:id` | 无 | 单个模板 |
| `GET` | `/api/templates/:id/cost` | 无 | 模板固定配件/壳体组件成本 |
| `GET` | `/api/templates/:id/default-recipe` | 无 | 基于模板生成配方草稿、配件、转子参数和成本 |
| `POST` | `/api/templates/:id/apply` | `{ recipe? }` | 把模板默认项应用到传入配方草稿 |
| `GET` | `/api/templates/:id/recipes` | 无 | 引用该模板的配方列表 |
| `POST` | `/api/templates` | `shellModel/shell_model` 等模板字段 | 新增模板；支持 components/bundle 成本模式 |
| `PATCH` | `/api/templates/:id` | 模板字段 | 使用 `safeUpdate` 更新 |
| `DELETE` | `/api/templates/:id` | 无 | 无配方引用时硬删除 |

## 7. 型号变体 Model Variants

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/model-variants` | 无 | 型号变体列表 |
| `POST` | `/api/model-variants` | `modelName, templateId` 必填；可带线圈、机筒、长螺丝、叶轮字段和 `customFieldsJson` | 新增变体；`customFieldsJson` 为 `[{ label, value }]` JSON 字符串；若模板含长螺丝且变体有机筒长度，会按参数化螺丝公式自动补齐对应长度的螺丝零件，响应附带 `createdLongScrewParts` |
| `PATCH` | `/api/model-variants/:id` | 同新增字段 | 更新变体；同样可能返回 `createdLongScrewParts` |
| `DELETE` | `/api/model-variants/:id` | 无 | 软删除 |

## 8. 配方 Recipes

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/recipes` | 无 | 配方列表 |
| `GET` | `/api/recipes/:id` | 无 | 单个配方 |
| `POST` | `/api/recipes/bom-draft` | `{ templateId?, modelVariantId?, customBarrelLength?, coilSpec?, coilSheets?, coilMaterial?, hasFloat?, hasCable?, packingParts?, optionalParts? }` | 基于配方草稿生成标准化 BOM；不写库 |
| `POST` | `/api/recipes/cost-draft` | `{ parts, assemblyWage?, packingWage?, surfaceTreatmentMode?, surfaceTreatmentCost?, managementFee?, coilMaterial?, customBarrelLength?, longScrewExtraLength? }` | 基于配方草稿生成保存用成本快照；不写库 |
| `POST` | `/api/recipes` | 配方字段，优先 camelCase | 新增配方并保存成本/技术快照；若 `partsJson` 中含已计价但零件库缺失的长螺丝型号，会自动补齐螺丝零件并返回 `createdLongScrewParts` |
| `PATCH` | `/api/recipes` | `id/Id` 加配方字段 | 兼容旧入口，更新配方 |
| `PATCH` | `/api/recipes/:id` | 配方字段 | 推荐更新入口；同样可能返回 `createdLongScrewParts` |
| `DELETE` | `/api/recipes` | 单个对象或数组，含 `id/Id` | 兼容批量软删除 |
| `DELETE` | `/api/recipes/:id` | 无 | 推荐删除入口，软删除 |
| `GET` | `/api/recipes/:id/cost` | 无 | 当前配件重算参考，不是保存成本，也不是完整总成本 |
| `POST` | `/api/recipes/:id/cost-preview` | `{ overrides }` | 报价/试算用，以配方快照为基线重算覆盖项 |

## 9. 成本 Cost

### 9.1 推荐入口

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/cost/parts` | `{ parts: [{ model, supplier?, qty?, snapshotPrice? }] }` | 按配件数组计算成本、缺失项和明细；不自动叠加配方工资/管理费 |
| `POST` | `/api/recipes/cost-draft` | `{ parts, assemblyWage?, packingWage?, surfaceTreatmentMode?, surfaceTreatmentCost?, managementFee?, coilMaterial?, customBarrelLength?, longScrewExtraLength? }` | 配方保存前生成 `savedTotalCost`、`savedCostDetails` 和标准化 `parts`，并应用长螺丝长度与参数化计价规则 |
| `GET` | `/api/recipes/:id/cost` | 无 | 同第 8 节；只重算配件当前参考价 |
| `POST` | `/api/recipes/:id/cost-preview` | `{ overrides }` | 同第 8 节；报价覆盖试算 |
| `POST` | `/api/cost/full-estimate` | `{ pumphousing_model?, stator?, statorMaterial?/material?, cableLength?, hasFloat?, floatWire?, cableWire?, floatAccessoryType?, cableAccessoryType?, boxType? }` | AI/N8N 一站式估算，组合配方、线圈和动态配置 |

### 9.2 拆分估算入口

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/cost/coil` | 同 `/api/coils/calculate` | 线圈成本兼容入口 |
| `POST` | `/api/cost/float` | `floatWire?, floatAccessoryType?` 等 | 单独估算浮球成本 |
| `POST` | `/api/cost/cable` | `cableLength, cableWire?, cableAccessoryType?` 等 | 单独估算电缆和铜套成本 |
| `POST` | `/api/cost/packing` | `packingParts?/packingPartsJson?/boxType?` 等 | 单独估算包装材料成本 |
| `POST` | `/api/cost/overhead` | `{ assemblyWage?, packingWage?, surfaceTreatmentCost?, managementFee? }` | 人工工资、表面处理和管理费合计 |
| `POST` | `/api/cost/dynamic` | `{ stator?/statorSpec?/statorSheets?, hasFloat?, floatWire?, hasCable?, cableWire?, cableLength?, boxType?, ...AccessoryType }` | 动态配置成本：浮球、电缆、包材 |

### 9.3 查询和市场指标

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/cost/recipe/by-name?name=xxx` | `name` 查询参数 | 按名称包含关系查配方并计算配件成本 |
| `GET` | `/api/copper-price` | 无 | 实时铜价和数据库铜价基数 |
| `POST` | `/api/copper-price/update` | 无 | 手动同步铜价，并更新所有线圈铜价基数 |
| `GET` | `/api/market-indicators` | 无 | 铜价、铝价、美元兑人民币汇率的实时值与数据库值 |
| `POST` | `/api/market-indicators/update` | 无 | 同步铜价、铝线价格基数、美元汇率 |

### 9.4 成本兼容入口

| 当前推荐入口 | 兼容入口 | 说明 |
|---|---|---|
| `POST /api/cost/parts` | `POST /api/cost/calculate` | 前端历史配件计算入口 |
| `GET /api/recipes/:id/cost` | `GET /api/cost/recipe/:id` | 按配方 ID 计算配件成本 |
| `POST /api/recipes/:id/cost-preview` | `POST /api/cost/dynamic-calculate` | legacy 响应会额外返回顶层 `unitCost` |
| `POST /api/cost/dynamic` | `POST /api/cost/dynamic-config` | 动态配置成本旧名 |
| `POST /api/cost/full-estimate` | `POST /api/cost/full-calculate` | 一站式估算旧名 |
| `POST /api/coils/calculate` | `POST /api/cost/coil` | 线圈成本旧/AI 入口 |

## 10. 客户与报价

### Customers

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/customers` | 无 | 客户列表 |
| `POST` | `/api/customers` | `{ name, contactInfo?, defaultMargin?, remark? }` | 新增客户；返回 `{ data: { id }, id }` 兼容格式 |
| `PATCH` | `/api/customers/:id` | 客户字段 | 更新客户 |
| `DELETE` | `/api/customers/:id` | 无 | 软删除 |

### Quotations

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/quotations` | 无 | 报价列表；读取时自动把超过 1 个月的“报价中”标为“已过时” |
| `POST` | `/api/quotations` | `{ customerId, status?, itemsJson?, totalCost?, totalPrice?, remark? }` | 新增报价；返回 `{ data: { id }, id }` 兼容格式 |
| `PATCH` | `/api/quotations/:id` | 报价字段 | 更新报价 |
| `DELETE` | `/api/quotations/:id` | 无 | 软删除 |

## 11. 订单 Orders

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/orders` | 无 | 订单列表 |
| `GET` | `/api/orders/:id` | 无 | 单个订单 |
| `GET` | `/api/orders/history-price/:recipeName` | 路径参数 `recipeName` | 查该配方最近历史售价和利润率 |
| `POST` | `/api/orders/purchase-plan` | `{ items: [{ partsJson, qty }] }` | 按订单明细生成采购清单和供应商待办；不写库 |
| `POST` | `/api/orders` | `{ customerName, contractNo?, remark?, status?, itemsJson?, purchaseListJson?, todosJson? }` | 新增订单 |
| `PATCH` | `/api/orders` | `id/Id` 加订单字段 | 兼容旧更新入口 |
| `PATCH` | `/api/orders/:id` | 订单字段 | 推荐更新入口 |
| `DELETE` | `/api/orders` | 单个对象或数组，含 `id/Id` | 兼容批量软删除 |
| `DELETE` | `/api/orders/:id` | 无 | 推荐删除入口，软删除 |

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
| `POST` | `/api/rotor/draw` | 结构化出图参数；可带 `drawingName/drawing_name`、`drawingText/drawing_text` | 启动异步 FreeCAD 出图任务；返回 `{ status, message, jobId, drawingName, params }` |
| `POST` | `/api/rotor/save` | 结构化转子参数；可带 `drawingName/drawing_name`、`drawingText/drawing_text` | 保存暂定参数到历史，不启动 FreeCAD；记录状态为 `saved`，返回 `{ success, data, jobId, drawingName, params }` |
| `POST` | `/api/rotor/chat` | `{ message, force?, supplements?, baseParams?, drawingName?, drawingText? }` | 自然语言出图；可能返回 `need_params` 或 `warning` |
| `GET` | `/api/rotor/status/:jobId` | 无 | 查询任务状态；返回 `{ success, data, ...job }` 兼容格式 |
| `GET` | `/api/rotor/history` | 无 | 最近 100 条出图/保存历史；当前仍直接返回数据库 snake_case 字段，`status=saved` 表示仅保存参数 |
| `PATCH` | `/api/rotor/history/:id/name` | `{ drawingName/drawing_name }` | 重命名图纸 |
| `PATCH` | `/api/rotor/history/:id/link` | `{ linkedPumpModel/linked_pump_model }` | 关联订单型号、型号变体或配方；当前保存为 `linked_pump_model` 文本 |
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
| `PUT` | `/api/ai/system-prompt` | `{ prompt }` | 更新内存和 SQLite `config.ai-system-prompt` |

AI 写操作由 `api/routes/ai/tools.cjs` 的 `WRITE_TOOLS` 白名单和确认流程控制。

### Voice

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/voice/asr` | `multipart/form-data`，文件字段 `audio`，可带 `format`、`sampleRate` | 调阿里云一句话识别；成功返回 `{ success: true, text }` |

### Siri

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/siri/chat` | `{ text, project?, context? }` | Siri 快捷指令入口；`project=cad` 时转发到 `CAD_API_URL` |
| `GET` | `/api/siri/result/:id` | 无 | 读取 5 分钟内缓存的 Siri 结构化结果 |
| `GET` | `/siri-result?id=xxx` | 查询参数 `id` | 返回 `public/siri-result.html` 页面 |
| `GET` | `/public/*` | 静态路径 | AI 路由内挂载的 `public` 静态文件兼容入口 |

## 16. 当前兼容/待收口项

- `PATCH /api/parts`、`PATCH /api/recipes`、`PATCH /api/orders`、`DELETE /api/recipes`、`DELETE /api/orders` 是旧式 body 带 ID 入口；新代码优先使用路径 ID。
- `POST /api/cost/calculate`、`POST /api/cost/dynamic-config`、`POST /api/cost/full-calculate`、`POST /api/cost/dynamic-calculate` 是旧命名兼容层。
- `GET /api/rotor/history` 仍输出 snake_case 数据库字段。
- `POST /api/rotor/draw`、`POST /api/rotor/chat` 使用 `{ status, message }` 格式，不完全符合标准 `{ success, data/error }`。
- 客户和报价新增接口保留顶层 `id`，用于兼容旧前端。
- 部分 INSERT/UPSERT 不写审计日志；动态 UPDATE 和删除必须继续走 `safeUpdate`、`softDelete` 或 `hardDelete`。
