# API 变更 SOP

> 更新于 2026-08-03。

本文只规定 API 从设计到发布的强制流程。所有能力必须先遵守 [API 统一契约](./api-contract.md)；当前 Method、Path、请求和响应统一维护在 [API 接口总表](./api-reference.md)。

本 SOP 是项目默认工作流。只要改动涉及 HTTP 路由、AI tool、内部 maintenance、API client、请求/响应字段、兼容或废弃入口，就自动适用，无须需求方再次声明“按 API SOP 执行”。

文档职责：

- `api-contract.md`：永久规则，回答“API 必须怎样工作”。
- `api-sop.md`：本流程，回答“API 变更必须怎样完成”。
- `api-reference.md`：当前事实，回答“现在有哪些 API、怎样调用”。
- `technical-debt.md`：当前行动清单，回答“还有哪些债务、先改什么”。

当前核心 API 已完成统一契约收口。新增或修改能力不得绕过能力登记和自动化契约；发现历史兼容偏离时，按小批次保持原路径兼容并在技术债清单登记风险和移除条件。

## 0. 系统性解决问题原则

当一个问题可能出现在多个业务对象、多个自然语言表达或多个调用入口时，必须先按“问题类别”处理，禁止只针对当前例句、单个关键词或单一路由追加补丁。

1. 先定位共同根因和完整影响面，包括同类业务对象、等价表达、组合条件、否定/疑问词、空条件和边界值。
2. 明确唯一权威入口：解析、校验、计算或写入规则只能有一个正式实现；其他入口必须调用该实现，不得复制规则。
3. 使用类型化契约和白名单字段表达业务条件。不得把删除若干停用词后剩余的任意文本直接当作查询关键词。
4. 在生成执行计划前完成规范化和校验；只有通过校验的参数才能显示为“将执行”并进入正式 API。
5. 同类调用方必须一次迁移，并删除或收口重复逻辑。临时兼容层必须有测试、废弃说明和明确移除条件。
6. 回归测试必须覆盖“原始问题 + 同类问题矩阵”，至少包含：无条件列出、单条件、组合条件、疑问句、否定/缺货表达、未知词、边界值和零结果。
7. 零结果必须携带已应用的结构化条件，能区分“确实为零”“条件被误解析”和“API/网络失败”。
8. 只有当前例句恢复不算完成；统一机制、同类迁移、重复逻辑清理、观测信息和回归矩阵缺一不可。

### AI 业务查询的执行链

本地新版统一使用：`当前会话与个人记忆 → 模型选择 → 工具 schema/参数来源 → 正式 API → 结果 → 模型继续查询或回答`。生产切换状态另见发布记录，不以本地改动代替生产事实。

- 业务读取不按域、类型或对象范围授权，不强制两阶段计划，不为“恢复”单独建立运行模式。新增已登记 Query/Preview 自动进入读取目录，跨业务组合不需要修改 dispatcher。
- 保留唯一正式 executor、参数校验和执行证据；AI 不复制过滤或成本公式。列表使用正式分页与筛选，正式回执和页面 detail 保留完整业务字段。模型上下文可使用显式列表摘要，必须保留身份、过滤/分页回执，标注省略字段与已有详情工具；不得把未展示的明细说成不存在。详情 JSON 只做无损解码，历史摘要超预算时明确要求重查。
- 部分接口失败可继续独立读取，保留成功证据并明确不能核实的部分。零结果不是技术失败；比较必须取得其所需数据。
- 会话候选绑定现有主体和 conversationId，过期后重查；客户端历史仅帮助理解，不构成执行授权。
- 个人记忆入口和业务修改分开。明确自然语言记忆指令通过正式 memory API 保存，含版本、幂等、审计、撤销；不得把普通纠正自动提升为长期规则。
- 普通助理循环不直接执行业务写操作；后续开放变更草稿仍复用本人确认协议，不扩大 MCP 或内部服务写权限。
- 变更测试至少包括跨类型与跨业务组合、多读、零结果、部分失败、非法参数、写调用拒绝、会话隔离、取消和预算；记忆变更另测回滚、重放与版本冲突。
- 所有工具参与的正文先缓冲；真实 token 用量只取供应商 usage。预算与超时用于可靠运行，不是业务权限门。
- 保留用户未提交的历史调度和实验文件，当前入口不得导入或回退到旧调度。只有明确独立删除任务才继续清理这些文件。

## 1. 变更前：确认真实范围

开始设计前必须检查：

1. `git status --short --branch`，确认分支和未提交改动。
2. 搜索真实调用方：
   - `apps/web-next/`
   - `api/routes/ai/` 和 executors
   - 内部服务、脚本和测试
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
- high/critical AI 写操作中的自然语言目标是否在确认前通过正式 Query/Preview 唯一解析；确认卡是否只展示标准资源和正式预览事实，零匹配、多匹配或预览不完整时是否停止签发 token。
- 确认 UI 是否只消费结构化 `requiresConfirmation/confirmationToken`，模型文字确认是否无条件不可执行；写意图没有结构化结果时是否由服务端安全收口。
- 正式写入回执是否与 Preview 的资源、数量和前后值一致；可回读资源是否通过正式 Query 验收最终状态，而不是只相信模型或 executor 文案。
- 是否由领域 service 实现，而不是继续增加胖 route。
- 是否保持现有路径、请求和响应兼容。
- AI、Web 和内部调用是否都能复用同一正式能力。

## 3. 实现顺序

按以下顺序实施：

1. 增加或调整 input/output schema 与 validation。
2. 实现或调整 query/command/preview service。
3. 为跨表写入建立 `db.transaction()`。
4. 使用 `safeInsert()`、`safeUpdate()`、`softDelete()` 或 `hardDelete()`。
5. 为 high/critical 命令实现幂等、版本检查、确认和标准回执。
6. route 只接入鉴权、兼容适配、校验、service 和响应。
7. AI executor 通过 internal API client 调正式 API；high/critical 写入先以正式 Query/Preview 解析并固化目标，再签发只绑定服务端预览上下文的 AI confirmation token。
8. 确认执行只能消费 token 绑定的规范化参数和服务端预览上下文，不得重新信任客户端或模型重传的目标；AI 总 executor 统一校验本轮查询证据或正式 command 回执，领域 executor 不得自行宣称成功。
9. 对库存、状态和其他可回读写入核对 Command 回执与 Preview 的资源、数量及结果值，再调用正式 Query 验收最终状态；验收不一致时返回失败且不得自动重复写入。
10. Web client 通过 `proxyRequest()`、`proxyFetch()` 或 `proxyStreamFetch()`。
11. 写操作成功后，页面重新读取正式资源。

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
3. 将 Web、AI 和内部调用迁移到标准接口。
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
- `docs/technical-debt.md`
  - 仅记录尚未完成的风险、触发条件、优先级和验收标准

版本过程说明不得继续堆入 `docs/README.md` 或 `api-reference.md`。

不得为单次版本或阶段新增 `vN-user-guide`、临时迁移说明、状态清单或重复脑图。仍有效的业务规则归入 `business-flow.md`，API 事实归入 `api-reference.md`，尚未完成的架构风险归入 `technical-debt.md`，实施过程由 Git 历史保存。

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
- 跨领域回归至少覆盖“先写库存，再查模板/配方/订单/采购”等组合，以及“不要忽略/尚未执行”等否定语境；断言新查询轮次不暴露、不执行写工具，也不生成确认 token。前端流式会话还要覆盖快速连续提交，保证同一工作台同一时刻只有一个在途请求。
- `costEngine` 与所有正式成本入口一致。
- 模板配置成本覆盖“完整模板名绑定、线圈/浮球/电缆、多个包装角色、同模板简称解析、多候选澄清、缺价失败”；保存配方覆盖必须证明受管角色不重复计价。
- 旧路径和响应兼容。
- 前端没有新增裸 `fetch()`。

## 9. 提交前自查

- [ ] 已检查 Git 分支、工作区和真实调用方。
- [ ] 已自动按本 SOP 执行，无需依赖需求方提醒。
- [ ] 已填写完整能力契约。
- [ ] Query 确认无写副作用。
- [ ] Command 已按风险实现事务、幂等、版本、确认和审计。
- [ ] route 只负责边界工作，业务逻辑在 service。
- [ ] AI 和内部调用复用正式 API。
- [ ] 正式成本只由 `costEngine` 计算。
- [ ] 动态写入使用 safe helper。
- [ ] Web 请求使用 proxyRequest 系列。
- [ ] `api-reference.md` 已更新。
- [ ] 聚焦测试、`npm test` 和适用的深度测试/构建通过。
- [ ] 兼容影响、回滚方式和残余风险已记录。

## 10. 例外

不能满足 [API 统一契约](./api-contract.md) 时，必须在同一变更中登记偏离条款、业务原因、风险、替代保护、到期条件和移除计划。

“旧代码也是这样”“当前只有一个用户”“以后再补”不能作为长期例外。
