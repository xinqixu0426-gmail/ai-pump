# API 开发 SOP

本 SOP 是本项目后续新增、修改 API 的强制流程。所有 API 变更都要先按本文自查，再提交代码。

当前业务、接口地图和真实调用语义见 [README.md](./README.md)。已存在的不规范兼容层不构成新代码的先例。

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
  - `GET /api/recipes/:id/cost`
  - `POST /api/recipes/:id/cost-preview`
  - `POST /api/cost/full-estimate`
- 新接口不要继续使用含糊命名，如 `calculate`、`dynamic-config`、`full-calculate`。旧接口只能作为兼容层保留。

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
- 创建成功返回：`{ success: true, data: { id } }` 或完整新记录。
- 不允许同一模块里混用裸数组、`id` 顶层字段、`unitCost` 顶层字段。
- 前端 `proxyRequest()` 负责透传服务端 `error`，后端错误信息要可读。

## 3. 字段命名

- 数据库列名保持 `snake_case`。
- 后端 Row Adapter 对外输出必须是 `camelCase`。
- 前后端 API 契约必须使用 `camelCase`。
- 前端类型定义不得新增 `snake_case` 字段。
- 旧字段迁移时允许短期双字段输出，但必须标注为 legacy，并在 API client 做 normalize。

示例：

```js
function recipeRow(r) {
  return {
    Id: r.id,
    partsJson: r.parts_json,
    savedTotalCost: r.saved_total_cost,
    templateId: r.template_id,
  };
}
```

## 4. 写库安全

- 所有动态 UPDATE 必须使用 `safeUpdate(table, id, updates)`。
- 删除业务数据优先使用 `softDelete(table, id)`，除非该表明确是临时表或日志表。
- 禁止拼接动态 SET：

```js
// 禁止
db.prepare(`UPDATE parts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
```

```js
// 必须
safeUpdate('parts', id, updates);
```

- `safeUpdate` 表名必须在 `SAFE_TABLES` 白名单内。
- 写操作不需要手写 audit log，`safeUpdate` / `softDelete` 会处理。

## 5. 入参校验

每个写接口必须校验：

- `:id` 是正整数。
- 金额、数量、单价、库存变更是有效数字。
- 不能为负的字段必须拒绝负数。
- `settings` 类接口必须走 key 白名单。
- JSON 字符串字段必须能被解析，或在写入前由后端统一序列化。

常用 helper：

```js
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
```

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
- 前端 `costCalculator.ts` 只用于批量或离线场景。
- 修改 `api/db.cjs:calculateRecipeCost` 时必须同步检查前端成本逻辑。
- 成本返回必须包含可追溯明细，不只返回总价。

## 9. 兼容迁移

修改已有 API 时按以下顺序：

1. 新增规范接口。
2. 保留旧接口作为兼容层，复用同一个 handler。
3. 前端 API client 切到新接口。
4. 文档标记旧接口 deprecated。
5. 确认无调用后再删除旧接口。

不要直接删除旧接口，除非明确确认没有前端、AI 工具、微信小程序或外部自动化在调用。

## 10. 验收清单

每次 API 变更必须完成：

- `node --check` 检查修改过的 `.cjs` 文件。
- `npm run build` 检查前端类型和构建。
- 搜索确认没有裸 `fetch()`。
- 搜索确认没有新增动态 `UPDATE ... SET ${...}`。
- 写接口确认使用 `safeUpdate` / `softDelete`。
- 新增/修改接口确认响应格式为 `{ success, data/error }`。
- 前端调用确认走 `proxyRequest()`。

## 11. 文档要求

新增模块或重要接口时，同时更新接口文档：

- API 路径和方法。
- 是否需要鉴权。
- 请求体字段。
- 成功响应示例。
- 失败响应示例。
- 是否有旧接口兼容层。

接口没有文档，不视为完成。
