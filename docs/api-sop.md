# API 变更 SOP

> 更新于 2026-08-03。

本文只规定 API 从设计到发布的强制流程。所有能力必须先遵守 [API 统一契约](./api-contract.md)；当前 Method、Path、请求和响应统一维护在 [API 接口总表](./api-reference.md)。

本 SOP 是项目默认工作流。只要改动涉及 HTTP 路由、AI tool、内部 maintenance、API client、请求/响应字段、兼容或废弃入口，就自动适用，无须需求方再次声明“按 API SOP 执行”。

文档职责：

- `api-contract.md`：永久规则，回答“API 必须怎样工作”。
- `api-sop.md`：本流程，回答“API 变更必须怎样完成”。
- `api-reference.md`：当前事实，回答“现在有哪些 API、怎样调用”。
- `api-architecture-audit.md`：阶段性审核，回答“现状有哪些债务、先改什么”。

当前核心 API 已完成统一契约收口。新增或修改能力不得绕过能力登记和自动化契约；发现历史兼容偏离时，按小批次保持原路径兼容并在审核报告登记风险和移除条件。

## 1. 变更前：确认真实范围

开始设计前必须检查：

1. `git status --short --branch`，确认分支和未提交改动。
2. 搜索真实调用方：
   - `apps/web-next/`
   - `api/routes/ai/` 和 executors
   - `wechat-miniprogram/`
   - Siri、内部服务、脚本和测试
3. 阅读相关 route、service、数据库表、迁移、测试和文档。
4. 确认是否已有相同或可复用能力，禁止为了调用方便复制业务逻辑。
5. 成本相关先确认能否复用 `costEngine`；库存、订单、报价和配方必须确认正式 sourceOfTruth。

不允许仅凭路由文件名判断“没有调用方”或“可以删除”。

## 2. 设计前：填写能力契约

每个新增或修改能力必须先写清：

```text
capabilityId:
displayName:（AI tool 或面向用户的计划/确认能力必填）
executorKey:（AI tool 必填：cost | query | order | recipe | business）
resultProvenance:（AI tool 需要声明实时正式事实时填写；否则 null）
domain:
method/path 或 INTERNAL trigger:
access: query | command | preview | maintenance
callers:
sourceOfTruth:
inputSchema/outputSchema:
riskLevel:
requiresConfirmation:
supportsPreview:
idempotency:
concurrencyControl:
transactionality:
audit:
timeoutMs:
deprecated:
```

能力注册表已经上线于 `api/capabilities/registry.cjs`：AI tools 和已迁移正式 command 必须先修改注册表，再由测试核对 route、service、AI tool 和文档。AI tool 的 `displayName`、唯一 `executorKey` 和结果 `resultProvenance` 同样只在注册表维护，计划、确认卡片、总 executor 和其他调用方必须读取对应字段。领域 executor 不得再导出或维护工具名单。尚未迁移的历史接口在本次改造前至少把完整属性写入 `api-reference.md`；一旦抽成正式 service/command，必须同时进入代码注册表，不能继续只登记在文档。

无公开 HTTP 路径的受控定时任务使用 `INTERNAL <稳定触发器名称>` 作为 `inputSchema`，并登记 internal caller；不得为通过契约校验而虚构路由。若 maintenance 改变正式业务事实，持久化幂等、强审计和 operation 回执要求与 HTTP command 相同。

设计检查：

- Query 是否真正无副作用。
- Command 是否需要 preview、confirmationToken、idempotencyKey、expectedVersion、事务和强审计。
- AI tool 是否登记唯一 executorKey；其正式结果若是实时业务事实，是否登记正确 resultProvenance，且没有第二份分发或 provenance 名单。
- 是否由领域 service 实现，而不是继续增加胖 route。
- 是否保持现有路径、请求和响应兼容。
- AI、Web、微信和 Siri 是否都能复用同一正式能力。

## 3. 实现顺序

按以下顺序实施：

1. 增加或调整 input/output schema 与 validation。
2. 实现或调整 query/command/preview service。
3. 为跨表写入建立 `db.transaction()`。
4. 使用 `safeInsert()`、`safeUpdate()`、`softDelete()` 或 `hardDelete()`。
5. 为 high/critical 命令实现幂等、版本检查、确认和标准回执。
6. route 只接入鉴权、兼容适配、校验、service 和响应。
7. AI executor 通过 internal API client 调正式 API。
8. Web client 通过 `proxyRequest()`、`proxyFetch()` 或 `proxyStreamFetch()`。
9. 写操作成功后，页面重新读取正式资源。

禁止：

- AI executor 直接访问 DB helper 或生成 SQL。
- 页面、route 和 executor 各自实现成本、库存或状态机。
- Query 中写回“修正后数据”、审计、缓存或知识同步队列。
- 动态拼接 SQL 表名、列名、SET 或 WHERE。
- 使用 `Number(value) || default` 吞掉非法数字。

## 4. 路由和字段规则

- 资源路径使用复数名词，如 `/api/orders`。
- 单资源读取、更新和删除使用 `/:id`。
- 批量和业务动作显式命名，如 `/batch-stock`、`/:id/convert`。
- 草稿和预览明确使用 `draft` 或 `preview`，并写明不写库。
- 新接口禁止含糊命名，如 `do-action`、`process` 或没有业务对象的 `calculate`。
- API 请求与响应使用 camelCase；数据库保持 snake_case。
- 核心资源输出 `id/createdAt/updatedAt`。
- 历史 `Id/CreatedAt/UpdatedAt` 只能停留在兼容 adapter。
- 前端类型和页面不得新增 snake_case、`Id`、`CreatedAt` 或 `UpdatedAt`。
- 历史 `paintingWage`、`boxType` 只用于旧记录兼容；正式字段使用 `surfaceTreatmentMode`、`surfaceTreatmentCost` 和 `packingPartsJson`。

已删除的旧成本 alias 不得恢复，包括：

- `/api/cost/calculate`
- `/api/cost/recipe/:id`
- `/api/cost/dynamic-calculate`
- `/api/cost/dynamic-config`
- `/api/cost/full-calculate`

## 5. 响应与错误

成功：

```json
{ "success": true, "data": {} }
```

失败：

```json
{ "success": false, "error": "错误信息" }
```

新增或重构接口应同时提供稳定 `code` 和 `requestId`。创建必须返回完整资源或 `{ id, version }`；high/critical 命令必须返回 `operationId`、`changes`、`warnings`、`auditId` 和幂等重放状态。

输入错误不能返回 `500`；版本或状态冲突使用 `409`，业务规则不满足使用 `422`。

## 6. 兼容、废弃和删除

修改现有 API 时：

1. 优先在原路径内保持兼容。
2. 必须新增路径时，先增加标准接口。
3. 将 Web、AI、微信、Siri 和内部调用迁移到标准接口。
4. 在 `api-reference.md` 标记旧入口 `deprecated`、替代能力和删除条件。
5. 增加调用遥测或完成全仓库调用方核对。
6. 至少经过一个兼容周期后再删除。
7. 增加防止旧入口回流的静态契约测试。

不得擅自删除 voice、model-variants 等历史能力；必须先证明没有真实调用方和外部兼容依赖。

兼容字段只能位于后端 route adapter 和 `apps/web-next/lib/` normalize 层，禁止扩散到 service 和页面状态。

## 7. 文档同步

每次 API 变更必须同步：

- `docs/api-reference.md`
  - Method 和 Path
  - capabilityId、access、sourceOfTruth、riskLevel；AI tool 同时说明 executorKey 和 resultProvenance
  - 调用方
  - 请求和响应
  - 事务、幂等、版本、确认、审计和超时
  - 兼容或 deprecated 状态
- `docs/README.md`
  - 仅在稳定业务边界或系统入口变化时更新
- `docs/api-contract.md`
  - 仅在全局规则变化时更新
- `docs/api-architecture-audit.md`
  - 仅在整改状态或优先级变化时更新

版本过程说明不得继续堆入 `docs/README.md` 或 `api-reference.md`。

不得为单次版本或阶段新增 `vN-user-guide`、临时迁移说明、状态清单或重复脑图。仍有效的业务规则归入 `business-flow.md`，API 事实归入 `api-reference.md`，架构风险归入 `api-architecture-audit.md`，实施过程由 Git 历史保存。

接口代码、能力登记、文档和测试任一缺失，变更都不算完成。

## 8. 自动化测试

每次 API 变更至少执行：

```text
node --check <修改过的 cjs>
聚焦单元/API/SQLite 测试
npm run verify:api-contract
npm test
```

涉及正式业务 API 或数据库：

```text
npm run test:deep-api
```

涉及 Web 请求或类型：

```text
npm run build
```

发布前：

```text
npm run verify:release
```

强制覆盖：

- 每个 route Method + Path 都出现在 `api-reference.md`。
- Query 前后业务表、审计表和同步队列没有变化。
- Command 校验失败和事务中途失败不留下部分写入。
- idempotencyKey 重放、冲突和并发版本冲突。
- confirmationToken 篡改、过期、换主体和重复使用。
- AI tool 的 read/write/risk/confirmation 与 capability 一致。
- `costEngine` 与所有正式成本入口一致。
- 旧路径和响应兼容。
- 前端没有新增裸 `fetch()`。

## 9. 提交前自查

- [ ] 已检查 Git 分支、工作区和真实调用方。
- [ ] 已自动按本 SOP 执行，无需依赖需求方提醒。
- [ ] 已填写完整能力契约。
- [ ] Query 确认无写副作用。
- [ ] Command 已按风险实现事务、幂等、版本、确认和审计。
- [ ] route 只负责边界工作，业务逻辑在 service。
- [ ] AI/微信/Siri 复用正式 API。
- [ ] 正式成本只由 `costEngine` 计算。
- [ ] 动态写入使用 safe helper。
- [ ] Web 请求使用 proxyRequest 系列。
- [ ] `api-reference.md` 已更新。
- [ ] 聚焦测试、`npm test` 和适用的深度测试/构建通过。
- [ ] 兼容影响、回滚方式和残余风险已记录。

## 10. 例外

不能满足 [API 统一契约](./api-contract.md) 时，必须在同一变更中登记偏离条款、业务原因、风险、替代保护、到期条件和移除计划。

“旧代码也是这样”“当前只有一个用户”“以后再补”不能作为长期例外。
