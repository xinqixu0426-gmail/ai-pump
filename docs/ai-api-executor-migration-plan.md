# AI 调用 API 改造计划

> 当前状态：Next 主前端已经通过统一 API client 调用 Express API；AI 成本类工具已经调用标准成本 API。AI 写操作 executor 仍有部分直接使用数据库 helper 的实现，下一阶段目标是让 AI 与网页、Siri、微信小程序共享同一套业务 API。

## 1. 改造目标

- AI 不直接拼装核心业务写库逻辑。
- AI 写操作统一走现有标准 API 或新增明确业务动作 API。
- AI、网页前端、外部自动化共用同一套草稿生成、校验、保存和动作接口。
- 写操作仍保留 `WRITE_TOOLS` 白名单和二次确认。
- 内部调用使用 `x-internal-secret`，不绕过后端校验、审计和业务动作边界。

## 2. 当前状态

已经 API 化：

- `full_calculate` -> `POST /api/cost/full-estimate`
- `calculate_coil_cost` -> `POST /api/coils/calculate`
- `dynamic_config_cost` -> `POST /api/cost/dynamic`
- `query_recipe_cost_by_id` -> `GET /api/recipes/:id/cost`
- 出图相关工具 -> `/api/rotor/*`
- `create_part`、`update_part`、`delete_part` -> `/api/parts`
- `delete_recipe` -> `DELETE /api/recipes/:id`
- `delete_order` -> `DELETE /api/orders/:id`
- `create_recipe`、`update_recipe` -> `/api/recipes/cost-draft` + `/api/recipes/save-payload-draft` + `/api/recipes`

仍需收口：

- `batch_update_prices`
- `create_order`、`update_order_status`、`update_order_item`
- 订单追加/移除配方、生成采购清单等订单动作

这些工具当前有的仍直接调用 `safeInsert/safeUpdate` 或读取数据库 helper。它们安全性比裸 SQL 高，但还没有完全复用标准 API 的入参校验、草稿生成和响应契约。

## 3. 改造顺序

### P0：保持现状可用

- 不修改工具名，避免破坏现有提示词、确认卡片和前端展示。
- 工具内部逐步从 db/helper 调用迁移到 `internalFetch()` 标准 API 调用。
- 迁移期间保持返回结构兼容现有 `StructuredResult`。

### P1：低风险资源 CRUD（已完成）

优先迁移：

- `create_part` -> `POST /api/parts`
- `update_part` -> `PATCH /api/parts/:id`
- `delete_part` -> `DELETE /api/parts/:id`
- `delete_recipe` -> `DELETE /api/recipes/:id`
- `delete_order` -> `DELETE /api/orders/:id`

后续保留：

- `batch_update_prices` 当前没有标准批量价格 API，暂保留 `safeUpdate` 实现；如需要继续收口，应先补 `PATCH /api/parts/prices` 或等价业务动作接口。

验收：

- AI executor 不再直接写这些已迁移资源表。
- 写入仍进入 `safeInsert/safeUpdate/softDelete` 和 audit log。
- 工具返回保持 `{ success, data/error }` 或现有兼容字段。

### P2：配方写操作（已完成）

迁移：

- `create_recipe`
- `update_recipe`

目标流程：

```text
/api/recipes/bom-draft
  -> /api/recipes/cost-draft
  -> /api/recipes/save-payload-draft
  -> POST/PATCH /api/recipes
```

验收：

- AI 创建/修改配方与网页保存配方使用相同成本快照和保存 payload。
- 客户指定线重、长螺丝、电容、包装、人工管理费和表面处理都由后端草稿接口处理。
- 不允许 AI 自行组装正式 `partsJson/savedCostDetails`。

说明：

- AI 工具仍接收原来的简化参数，内部负责把零件意图转换为 BOM 草稿输入。
- `update_recipe` 会保留原配方的模板、线圈、浮球电缆、包装、人工管理费、技术档案等上下文，只修改用户指定字段。

### P3：订单写操作

迁移：

- `create_order`
- `update_order_status`
- `update_order_item`
- `add_recipe_to_order`
- `remove_recipe_from_order`
- `generate_purchase_list`

目标流程：

```text
/api/orders/purchase-plan
  -> /api/orders/save-payload-draft
  -> POST/PATCH /api/orders
```

订单动作：

- 状态：`POST /api/orders/:id/status`
- 采购项：`POST /api/orders/:id/purchase-items/toggle`
- 待办：`POST /api/orders/:id/todos/toggle`
- 入库：`POST /api/orders/:id/complete-purchase`

验收：

- AI 新建订单优先使用配方 `savedTotalCost` 锁价。
- 没有保存成本时才调用后端参考成本兜底。
- 采购清单和待办由后端动作生成。

### P4：补自动化专用动作 API

仅当现有 API 不能表达业务动作时再新增接口。新增接口必须遵守 `docs/api-sop.md`，同步更新 `docs/api-reference.md`。

候选：

- `POST /api/orders/:id/items/add-draft`
- `POST /api/orders/:id/items/update-draft`
- `POST /api/ai/tools/preview` 或继续使用现有确认卡片，不新增公共 API

新增前必须先确认网页、AI、微信小程序是否能共用该动作。

## 4. 验收清单

- `npm test`
- `npm run build`
- 搜索 `api/routes/ai/executors`，确认核心写操作不再直接调用 `safeInsert/safeUpdate/softDelete`，除非该工具没有对应标准 API 且文档明确说明。
- 搜索 AI executor 中的旧成本入口，禁止出现 `/api/cost/calculate`、`/api/cost/full-calculate`、`/api/cost/dynamic-config`。
- AI 写操作仍必须触发确认卡片，不允许未确认直接写库。
- 内部调用必须带 `x-internal-secret`。
- 新增或调整 API 后更新 `docs/api-reference.md` 和 `docs/README.md`。

## 5. 巡检建议

开始网站功能巡检时，优先记录每个页面对应的后端业务动作：

- 配方：模板/常用配置带入、BOM 草稿、成本草稿、保存、生产扣库存。
- 订单：新增产品、采购计划、保存、状态流转、采购项、待办、入库。
- 报价：覆盖试算、保存草稿、转订单草稿。
- 零件/线圈/模板/变体：CRUD、默认值带入、批量动作。
- 转子：模板草稿、保存、出图、状态、历史、关联、打印。

巡检发现的缺口优先补标准 API，再让 AI executor 复用，不把新业务逻辑直接塞回 AI 工具。
