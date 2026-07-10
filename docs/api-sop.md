# API 开发 SOP

本 SOP 是本项目后续新增、修改 API 的强制流程。所有 API 变更都要先按本文自查，再提交代码。

当前业务说明见 [README.md](./README.md)，完整接口地图和真实调用语义见 [api-reference.md](./api-reference.md)。当前 API 已完成主契约收口；新增 API 不得复刻历史兼容写法。

## 1. 路由命名

- 资源型接口使用复数名词：`/api/parts`、`/api/recipes`、`/api/orders`。
- 单条资源操作必须带路径 id：
  - `GET /api/resources/:id`
  - `PATCH /api/resources/:id`
  - `DELETE /api/resources/:id`
- 批量操作必须显式命名，不要伪装成普通 CRUD：
  - `POST /api/parts/batch-stock`
  - `POST /api/resources/batch-delete`
- 业务动作使用清晰动词或业务名词：
  - `POST /api/cost/parts`
  - `POST /api/recipes/model-variant-draft`
  - `GET /api/recipes/:id/cost`
  - `POST /api/recipes/:id/cost-preview`
  - `POST /api/cost/full-estimate`
- 表单草稿类接口必须放在所属资源下，并明确是否写库；例如 `POST /api/recipes/model-variant-draft` 只生成配方草稿，不创建配方。
- 新接口不要使用含糊命名或旧命名风格，如 `calculate`、`dynamic-config`、`full-calculate`。
- 已删除的旧入口不得恢复，包括 `/api/cost/calculate`、`/api/cost/recipe/:id`、`/api/cost/dynamic-calculate`、`/api/cost/dynamic-config`、`/api/cost/full-calculate`。

## 2. 响应格式

所有 JSON API 必须统一响应结构。

成功：

```json
{ "success": true, "data": {} }
```

失败：

```json
{ "success": false, "error": "错误信息" }
```

规则：

- 列表也必须包在 `data` 中：`{ success: true, data: [] }`。
- 创建成功返回完整新记录或 `{ success: true, data: { id } }`，不得返回顶层 `id`。
- 不允许同一模块里混用裸数组、顶层 `id`、顶层 `unitCost` 或 `{ status, message }`。
- 前端 `proxyRequest()` 负责透传服务端 `error`，后端错误信息要可读。

## 3. 字段命名

- 数据库列名保持 `snake_case`。
- 后端 Row Adapter 对外标准输出必须是 `camelCase`。
- 前后端 API 契约必须使用 `camelCase`。
- 前端类型定义不得新增 `snake_case` 字段。
- 新增字段不得使用 `Id/CreatedAt/UpdatedAt` 或 snake_case。
- 现有核心资源的 `Id/CreatedAt/UpdatedAt` 只是历史响应字段；新增页面必须通过 `src/utils/entityFields.ts` 读取 ID/时间。
- 旧字段迁移时允许短期双字段输出，但必须标注为 legacy、限定清理条件，并在 API client 做 normalize。

示例：

```js
function recipeRow(r) {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    partsJson: r.parts_json,
    savedTotalCost: r.saved_total_cost,
    templateId: r.template_id,
  };
}
```

## 4. 写库安全

- 正式业务资源新增必须使用 `safeInsert(table, values)`。
- 所有动态 UPDATE 必须使用 `safeUpdate(table, id, updates)`。
- 删除业务数据优先使用 `softDelete(table, id)`，除非该表明确是临时表或日志表。
- `safeInsert` / `safeUpdate` 表名必须在 `SAFE_TABLES` 白名单内，字段名必须是 snake_case 数据库列名。
- `safeInsert` 会过滤 `undefined` 字段，写入后自动记录 `INSERT` 审计日志。
- 禁止在业务路由、AI executor 中直接拼写资源表 `INSERT INTO parts/orders/recipes/...`：

```js
// 禁止
db.prepare('INSERT INTO parts (...) VALUES (...)').run(...values);
```

```js
// 必须
safeInsert('parts', {
  model,
  category,
  price,
  created_at: now,
  updated_at: now,
});
```

- 禁止拼接动态 SET：

```js
// 禁止
db.prepare(`UPDATE parts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
```

```js
// 必须
safeUpdate('parts', id, updates);
```

- 写操作不需要手写 audit log，`safeInsert` / `safeUpdate` / `softDelete` / `hardDelete` 会处理。
- 系统初始化、`system_settings` / `config` 的 UPSERT 属于基础设施边界；新增业务资源表不得以此为例绕过 `safeInsert`。

## 5. 入参校验

每个写接口必须校验：

- `:id` 是正整数。
- 金额、数量、单价、库存变更是有效数字。
- 不能为负的字段必须拒绝负数。
- `settings` 类接口必须走 key 白名单。
- JSON 字符串字段必须能被解析，或在写入前由后端统一序列化。
- 批量接口入参也必须使用标准 camelCase 字段，例如库存接口只接受 `partId`，不得兜底 `id/Id`。
- 成本基础资料写接口不得使用裸 `parseFloat()` / `parseInt()` 吞掉坏输入；必须使用 `parseFiniteNumber()` 或 `parseNonNegativeNumber()`。
- 订单、报价、配方保存草稿中的金额、数量、单价、利润率也必须使用统一数字 helper；不得使用 `Number(value) || 默认值` 吞掉坏输入。
- JSON 字段写库前必须使用 `stringifyJsonArray()` / `stringifyJsonObject()`，不得直接信任前端传入的 JSON 字符串。

常用 helper：

```js
const {
  parsePositiveId,
  requirePositiveId,
  parseFiniteNumber,
  parseNonNegativeNumber,
  parsePositiveNumber,
  parseNonNegativeInteger,
  parseJsonArray,
  stringifyJsonArray,
  stringifyJsonObject,
} = require('../services/validation.cjs');
```

核心路由不得再自定义 `parseId()`，也不得直接对 `req.params.id` 使用 `parseInt()` 或 `Number()`。

## 6. 鉴权

- `/api/auth/login`、`/api/auth/check`、`/api/health` 可以公开。
- 其他 `/api/*` 默认必须走 JWT Cookie 鉴权。
- AI、Siri、语音类接口如果公开，必须有独立 token 或内部 secret。
- 修改 AI system prompt、配置项、写库工具等高风险接口必须鉴权。
- 内部调用使用 `x-internal-secret`，不得依赖来源 IP 判断权限。

## 7. 前端请求

- 前端禁止裸 `fetch()`，统一使用 `proxyRequest()` / `proxyFetch()`。
- 常规 JSON 使用 `proxyRequest()`。
- SSE、流式响应、文件响应可用 `proxyFetch()`。
- 表单上传使用 `proxyFormRequest()`。
- Zustand Store 执行增删改后必须调用 `fetchXxx(true)` 硬刷新。

## 8. 成本接口

成本接口以业务语义命名：

- `POST /api/cost/parts`：按配件数组计算。
- `GET /api/recipes/:id/cost`：按配方计算。
- `POST /api/recipes/:id/cost-preview`：基于配方和 overrides 试算。
- `POST /api/cost/full-estimate`：一站式估算，供 AI/N8N/外部自动化使用。

成本逻辑要求：

- 后端是单次成本计算权威来源。
- `api/services/costEngine.cjs` 是通用成本规则服务层，`api/db.cjs:calculateRecipeCost` 仅保留兼容导出。
- 前端不得新增独立正式成本计算口径；保存、报价、订单必须以后端 API 结果为准。
- 成本返回必须包含可追溯明细，不只返回总价。

## 9. 修改现有 API

修改已有 API 时按以下顺序：

1. 新增规范接口。
2. 前端 API client 切到新接口。
3. 文档标记旧接口 deprecated，并给出删除条件。
4. 确认无前端、AI、微信小程序或外部自动化调用后删除旧接口。
5. 增加静态契约测试，禁止旧入口或旧响应格式回流。

当前已经删除的旧入口不得重新作为兼容层恢复；如外部调用方需要迁移，应在调用方适配标准入口。

## 10. 死代码清理

API 变更完成后必须同步清理：

- 被删除路由对应的前端调用、AI internalFetch、文档兼容表和测试兜底。
- API client 中不再需要的裸数组响应兼容、顶层 `id` 兼容、旧成本入口常量。
- 路由中不再需要的 `id/Id` 兜底读取。
- 与删除接口只相关的注释、TODO 和状态文档。

## 11. 验收清单

每次 API 变更必须完成：

- `node --check` 检查修改过的 `.cjs` 文件。
- `npm run build` 检查前端类型和构建。
- 搜索确认没有裸 `fetch()`。
- 搜索确认没有新增动态 `UPDATE ... SET ${...}`。
- 写接口确认新增使用 `safeInsert`，更新使用 `safeUpdate`，删除使用 `softDelete` / `hardDelete`。
- 新增/修改接口确认响应格式为 `{ success, data/error }`。
- 前端调用确认走 `proxyRequest()`。
- 若移除旧接口，确认 `tests/apiStaticContract.test.cjs` 有防回退断言。
- 新增、修改、废弃或调整兼容层后，必须同步更新 `docs/api-reference.md`。
- 如果 API 变更影响业务流程、核心接口概览或已知边界，必须同步更新 `docs/README.md`。

## 12. 文档要求

新增、修改、废弃 API 或调整旧接口兼容层时，必须同时更新接口文档：

- API 路径和方法。
- 是否需要鉴权。
- 请求体字段。
- 成功响应示例。
- 失败响应示例。
- 是否替换或删除了旧接口。

接口文档统一维护在 `docs/api-reference.md`；业务/API 概览维护在 `docs/README.md`。接口没有文档，或文档没有跟随代码更新，不视为完成。
