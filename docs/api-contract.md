# API 统一契约

> 生效日期：2026-08-02
>
> 规范等级：强制（Normative）
>
> 适用范围：所有 `/api/*`、AI tool 对应能力和内部服务调用。

本文定义水泵工厂管理系统所有 API 必须遵守的稳定契约。它约束的是“能力应该怎样工作”，不是当前接口清单，也不是开发步骤。

- 当前 Method、Path、请求和响应见 [api-reference.md](./api-reference.md)。
- 新增、修改、兼容和废弃流程见 [api-sop.md](./api-sop.md)。
- 当前不符合项和优化顺序见 [technical-debt.md](./technical-debt.md)。

文中：

- **必须 / 禁止**：没有例外审批不得违反。
- **应该**：只有记录明确理由和替代保护后才能偏离。
- **可以**：按业务需要选择。

现有接口不因本文生效而自动改变。审核报告已登记的不符合项属于待整改债务，不能成为新增接口继续复制的先例。

## 1. 总体架构边界

1. 保持 SQLite + `better-sqlite3` 的模块化单体，不为接口形式引入微服务、消息队列或分布式事务。
2. HTTP route 只负责鉴权、兼容适配、参数校验、调用 service 和转换响应。
3. 业务计算、状态机、跨表编排和事务必须位于领域 service；禁止在多个 route、AI executor 或页面重复实现。
4. `api/services/costEngine.cjs` 是正式成本计算的唯一权威。
5. AI 和内部自动化必须调用正式 API，不得直接生成 SQL、调用数据库 helper 或绕过状态机。
6. 知识库和 RAG 只能提供背景、经验和检索候选，不能作为实时库存、价格、成本、报价金额或订单状态的最终来源。
7. Web 前端 API 请求必须通过 `proxyRequest()`、`proxyFetch()` 或 `proxyStreamFetch()`。
8. API 对外字段使用 camelCase；SQLite 列名保持 snake_case。

## 2. 每项能力的强制登记

每个新增或修改的业务能力必须先登记以下属性。代码注册表位于 `api/capabilities/registry.cjs`：AI tools 和已迁移正式 command 以该文件为机器可读来源，文档与测试负责校验；尚未迁移的历史接口至少登记在 `docs/api-reference.md`，进入重构批次时必须同步迁入代码注册表。

```js
{
  capabilityId,          // 稳定、唯一，不随路径重命名而变化
  displayName,           // AI tool 或会出现在确认/计划 UI 的能力必须提供稳定中文名称
  executorKey,           // AI tool 必填；唯一领域 executor：cost/query/order/recipe/business
  resultProvenance,      // AI tool 结果的正式事实来源标记；无特殊标记时为 null
  domain,                // orders / inventory / recipes / cost 等
  http: { method, path }, // 无 HTTP 入口的内部维护可省略，改登记 trigger
  trigger,                // scheduler / startup / internal event；普通 HTTP 能力可省略
  inputSchema,
  outputSchema,
  access,                // query / command / preview / maintenance
  sourceOfTruth,
  riskLevel,             // low / medium / high / critical
  requiresConfirmation,
  supportsPreview,
  idempotency,
  concurrencyControl,
  transactionality,
  audit,
  timeoutMs,
  callers,               // web / ai / internal
  deprecated
}
```

强制规则：

- 未登记的能力不得暴露给 AI。
- 未声明 `access` 的能力按写操作处理，默认拒绝执行。
- AI tool 的 `displayName` 必须由能力注册表统一提供；执行计划、确认卡片和审计展示不得各自维护第二份名称映射。
- AI tool 必须且只能声明一个有效 `executorKey`；总 executor 必须按注册表直接分发，领域 executor 不得另存工具集合或由总 executor 依次试探。
- `resultProvenance` 只描述正式 executor 回执的证据属性，不得由 AI 根据答案文字猜测。库存、成本、订单状态、报价和价格等实时正式事实必须登记为 `live_business`；知识快照、派生建议和普通执行回执不得冒充实时事实。
- AI tool 的成功状态必须经过统一执行证据门。Query/Preview 返回正向业务事实时，至少取得一条本轮正式 API 成功且非空的结果；返回负事实时，必须取得 `success_empty/resource_not_found` 对应的 `verified_negative`，技术失败不能替代。普通 Command 必须取得与该 AI capability 的 `formalCapabilityIds` 匹配的正式回执，且回执同时具备 `operationId`、`status=completed`（兼容响应可使用 `operationStatus=completed`）和非空 `auditId/auditIds`。只有能力注册表显式声明 `completionMode=accepted_async` 的外部命令，才可把 `accepted/processing` 作为“正式任务已受理”的证据；此时 operation 与强审计必须已持久化，结果必须保留异步状态并提供正式回读入口，AI 不得宣称外部副作用已经完成。
- 模型文字、executor 自行构造的 `success:true`、确认卡片和客户端传入的操作号都不是执行证据。证据缺失、能力不匹配或审计缺失时，统一执行器必须把结果降级为失败；`/api/ai/confirm-tool` 不得完成确认状态，最终回复不得补写业务数据。
- AI 调查记录必须区分三层：`BehaviorEvent` 只记录模型/runtime 行为，`Observation` 只记录实际尝试正式 capability/API 后的结果，`EvidenceRecord` 只由具有业务证明力的 Observation 晋升。计划外工具、schema 拒绝、重复调用、计划漂移、重试和预算事件永远不得进入 Evidence Ledger，也不得作为业务失败或“未找到”的依据。
- Evidence Ledger 必须采用只追加语义。后续模型错误、计划漂移或被拒绝调用不得删除、覆盖或使已经取得的正式 Evidence 失效；只有同一 Fact、同一正式来源的更高业务版本或更新权威时态 Evidence 才能显式 supersede 旧记录。`success_empty/resource_not_found/ambiguous/timeout/transport_failure/protocol_failure/cancelled` 必须保持结构化可区分，技术失败不得转换成已验证负证据。
- R2 只读调查的 Fact 身份由 `entityType/entityId + predicate + temporalScope + scenario + qualifiers` 构成，capability 名称不是 Fact 身份。未完成正式解析时 `entityId` 必须为空，不能用客户端 `turnState` 或模型生成的 ID 补造；不同实体、当前成本与保存成本快照等不同时态/场景不得互相满足或 supersede。
- 自然语言中的名称、型号、编号和简称只能作为待解析候选，不能直接成为 high/critical 写操作确认卡中的正式目标。签发 AI confirmation token 前必须通过正式 Query/Preview 唯一解析为标准资源标识和标准名称，并以正式 Preview 返回的当前值、预计值、资源版本和业务确认凭证生成确认内容；零匹配、多匹配或 Preview 不完整时不得签发确认。正式 Preview 的服务端上下文必须与 AI confirmation token 绑定且不得下发客户端，确认执行时只能消费该已绑定上下文，不能重新信任模型参数。
- AI 确认卡只能来自 executor 的结构化 `requiresConfirmation + confirmationToken + argsHash + rows` 回执，模型 Markdown、标题、表格或“请确认”文字永远不能作为确认卡或可执行状态。写意图轮次没有结构化确认、正式失败或缺参追问时，服务端必须丢弃模型正文并返回安全说明；“是/确认/执行”等自然语言只能延续待确认语义，不能替代服务端 token。
- 库存等可回读写操作取得正式 operation/audit 回执后，还必须核对回执中的资源、数量和前后值与 Preview 一致，并通过正式 Query 回读最终状态。回执数量、增量或回读任一不一致时不得声明成功；应明确操作可能已提交但验收失败，交由幂等重查处理，不能盲目重写。
- 业务 Query 调用失败必须保留明确错误，不得用历史消息、知识快照或推测数字代替该项结果；允许继续读取其他独立事实，回答必须说明缺失项。
- 正式 Query API 已成功返回零匹配，或以结构化 JSON 明确返回 `404` 资源不存在时，只能作为一次“已验证的负观察”；查询/分析模式必须在限定预算内完成与原目标相关的跨域只读调查，并确认相关正式对象均未找到后，才能如实回答“未找到”。其他 HTTP 错误、协议失败、超时或未完成全部正式 API 调用属于“未验证失败”，不得与零结果混淆；命令模式的前置查询未找到时必须安全停止，不能进入恢复链或开放后续写能力。
- 有业务工具参与的流式回复必须先缓冲模型正文，完成全部执行证据校验后才能向客户端发送最终结论；工具调用前的模型草稿不得进入正式回复。
- `deprecated=true` 必须同时声明替代能力、兼容截止条件和已知调用方。
- 一个 capability 可以保留多个兼容路径，但只能有一个正式实现和一个 sourceOfTruth。
- 没有公开 HTTP 路径的内部维护能力也必须登记；`inputSchema` 使用 `INTERNAL <稳定触发器名称>`，并明确 `callers=internal`，不得伪造一个实际不存在的 `/api/*` 路径。

## 3. Command / Query / Preview 分类

### 3.1 Query

Query 只读取正式事实并返回结果，必须满足：

- 不修改业务表、审计表、缓存表、知识索引、同步队列或文件。
- 不触发“顺便修正”“自动过期”“自动重算并写回”等行为。
- 不启动 CAD、打印、外部同步或其他物理副作用。
- 可以执行内存计算和数据库只读聚合。
- HTTP 通常使用 `GET`；复杂筛选可使用明确标注为 query/preview 的 `POST`，但仍必须无副作用。

读取时发现数据需要修复，应返回 `warnings` 或维护建议，由显式 command/maintenance 能力处理。

### 3.2 Command

下列任一行为都属于 Command：

- INSERT、UPDATE、DELETE、软删除或状态迁移。
- 库存增减、采购入库、建单、转单、报价状态变化。
- 文件创建、移动、删除或归档。
- 知识同步、规则启停、配置更新。
- CAD 出图、打印、外部系统写入或其他不可逆副作用。

Command 必须通过正式领域 service 执行，并按风险应用第 8 节安全协议。

### 3.3 Preview

Preview 用于在写入前生成确定性草稿、成本、BOM、变更明细和警告：

- 必须复用正式 Command 将使用的相同校验和业务 service。
- 不得写业务表、审计表或同步队列。
- 必须返回 `preview: true`、规范化输入、`changes` 和 `warnings`。
- Preview 成功不代表之后一定能执行；Command 必须重新检查实时版本和业务状态。

### 3.4 Maintenance

自动过期、派生数据刷新、索引同步、数据修复和清理属于 Maintenance：

- 必须使用显式命名的命令或受控定时任务。
- 必须记录运行 ID、开始/结束时间、变更数量和失败原因。
- 禁止藏在普通 GET 或页面加载过程中。
- 改变报价、订单、库存等正式业务事实时，必须使用持久化幂等、强审计及“业务变更 + operation 回执”原子事务；启动补跑和定时触发要使用稳定且互不冲突的幂等窗口。
- 只维护可重建索引、向量、缓存或派生看板时，可以使用专用运行历史而不暴露写 API，但必须明确其非正式事实、失败可重建且不反向驱动业务重试。

## 4. 路由与 service 职责

HTTP route 必须只包含：

1. 鉴权和调用主体解析。
2. Path、query、body 和文件边界校验。
3. 历史字段兼容适配。
4. 调用一个明确的 query/command/preview service。
5. 把 service 结果转换为标准 HTTP 响应。

以下逻辑必须抽到 service：

- BOM、成本、库存可用量和采购计划。
- 状态迁移及前置条件。
- 跨表或跨资源写入。
- 事务和幂等处理。
- 文件、CAD、打印或外部 API 编排。
- AI 调查聚合和业务规则配置。

同一业务动作不得在 Web route、AI executor 和定时任务中各写一套实现。

## 5. 数据事实来源

每项能力必须声明 `sourceOfTruth`：

| 事实 | 唯一权威 |
|---|---|
| 零件和线圈库存 | 正式库存表与 inventory service |
| BOM | recipe/BOM service 生成的正式草稿或快照 |
| 成本 | `costEngine` |
| 报价金额与状态 | quotations 表及 quotation service |
| 订单、采购和入库状态 | orders/采购记录及 order/purchasing service |
| 客户、模板、配方 | 对应正式资源表及 service |
| 跨业务修改时间、数量、原因和关联对象 | `business_change_events` 与 `business_change_event_entities`；详细订单修改继续以 `order_revisions` 为权威 |
| 历史经验、术语、资料语义 | 知识库；仅作背景和候选证据 |

聚合接口必须保留事实来源，不得由 AI 自行重新计算正式成本或库存。涉及易变事实的响应应该返回：

```json
{
  "sourceOfTruth": "inventory",
  "asOf": "2026-08-02T12:00:00.000Z",
  "version": 7
}
```

## 6. 请求契约

### 6.1 命名与 schema

- 请求字段必须使用 camelCase。
- `:id` 必须使用 `parsePositiveId()` / `requirePositiveId()`。
- 金额、数量、库存和比例必须使用统一 validation helper，禁止用 `Number(value) || default` 吞掉坏输入。
- JSON 字段写库前必须由后端规范化，不能直接信任客户端 JSON 字符串。
- 未声明字段默认拒绝或明确忽略；高风险命令必须拒绝未知字段。
- 可选字符串的空字符串默认按“未提供”处理。只有业务确有“清空已有值”语义时，字段 schema 才能显式声明 `minLength: 0` 以保留 `""`；面向可能省略空值的 Agent/MCP 客户端时，还必须提供独立、类型化的 `clear<Field>: true` 意图，不能要求客户端用空格等占位值绕过校验。
- 批量接口必须设置最大条数和单次负载限制。
- 文件接口必须限制大小、类型、签名、解析页数和执行超时。

### 6.2 Path 和动作命名

- 资源使用复数名词：`/api/orders`。
- 单资源使用 `/:id`。
- 业务动作必须显式命名：`/:id/convert`、`/:id/complete-purchase`。
- 草稿和预览必须使用 `draft` 或 `preview`，并在文档明确不写库。
- 禁止新增含糊入口，如 `calculate`、`do-action`、`process`、`execute` 而不说明业务语义。

## 7. 响应与错误契约

### 7.1 成功

```json
{
  "success": true,
  "data": {}
}
```

- 列表也必须放在 `data`。
- 创建返回完整资源或至少 `{ id, version }`。
- 核心资源标准字段为 `id`、`createdAt`、`updatedAt`。
- 纯计算应返回计算明细、sourceOfTruth 和 warnings，不能只返回总数。
- 临时成品配置必须先绑定正式模板和正式零件，形成标准 BOM 后再由 `costEngine` 计价；不能把模板名降级成配方名，也不能由 AI 自行加总。
- 保存配方的临时覆盖必须按 `costRole` 替换线圈、电容、浮球、电缆和包装等受管角色，每个角色只计一次；禁止“保存 BOM 总价 + 临时动态项”无条件相加。
- 配置零件简称只有在正式目录唯一命中，或同模板现有配方形成唯一一致选择时才可落地；多候选返回结构化 `409`，零候选返回 `404`。

### 7.2 失败

当前兼容格式：

```json
{
  "success": false,
  "error": "可读错误信息"
}
```

新增或重构能力应同时提供稳定错误码和请求 ID：

```json
{
  "success": false,
  "error": "订单已被其他操作修改",
  "code": "VERSION_CONFLICT",
  "requestId": "req-...",
  "details": {}
}
```

HTTP 状态至少遵守：

- `400` 输入不合法。
- `401` 未认证。
- `403` 无权限。
- `404` 资源不存在。
- `409` 版本、状态或幂等冲突。
- `413` 文件或请求过大。
- `422` 输入合法但不满足业务规则。
- `429` 频率限制。
- `500` 未预期服务端错误。
- `502/503/504` 外部依赖、未就绪或超时。

禁止把可预期校验错误统一返回 `500`。

## 8. 写操作安全协议

### 8.1 风险等级

| 等级 | 示例 | 最低保护 |
|---|---|---|
| low | 普通备注草稿 | 校验、审计 |
| medium | 主数据 CRUD、设置更新 | 审计、版本检查 |
| high | 建单、改价、知识同步、文件归档 | preview、确认、幂等、版本、事务 |
| critical | 库存增减、采购入库、报价转单、打印、外部写入 | high 全部要求 + 强审计和标准回执 |

### 8.2 幂等

可能被用户、AI、网络或任务重试的 Command 必须支持 `idempotencyKey`：

- 同一主体、capabilityId、idempotencyKey 和规范化参数只能执行一次。
- 相同 key、相同参数重试返回第一次回执，并标记 `idempotentReplay: true`。
- 相同 key、不同参数返回 `409 IDEMPOTENCY_CONFLICT`。
- 幂等记录必须与业务写入处于同一 SQLite 事务。
- 业务状态防重只能作为第二层保护，不能代替协议级幂等。

### 8.3 并发版本

会覆盖现有资源的 Command 必须接受：

```json
{
  "expectedVersion": 7
}
```

在现有表未引入 version 前，可兼容使用 `expectedUpdatedAt`。不匹配时返回 `409 VERSION_CONFLICT`，不得静默覆盖。

### 8.4 事务

- 一个业务命令影响的所有数据库写入、库存流水、幂等记录和强审计必须在同一 `db.transaction()` 中。
- 禁止在事务开始前先做永久写入。
- 事务内任何一步失败必须整体回滚。
- 外部副作用不能由 SQLite 回滚时，必须采用“先验证和确认、记录 operation、执行副作用、保存结果”的显式状态机，并提供可核对或补偿动作。

### 8.5 Preview 与确认

High/Critical 命令必须先 Preview，再由服务端签发 `confirmationToken`：

- token 绑定 capabilityId、规范化参数哈希、主体、资源版本和过期时间。
- token 单次使用，不能由客户端自行构造。
- 执行时参数、版本或主体发生变化必须拒绝，并要求重新预览。
- `/api/ai/confirm-tool` 之类入口不得只信任客户端重新提交的 `toolName + args`。

### 8.6 标准执行回执

高风险命令成功后必须返回：

```json
{
  "success": true,
  "data": {
    "operationId": "uuid",
    "status": "completed",
    "resource": { "type": "order", "id": 123, "version": 8 },
    "changes": [],
    "warnings": [],
    "auditId": 456,
    "idempotentReplay": false,
    "completedAt": "2026-08-02T12:00:00.000Z"
  }
}
```

显式登记为 `completionMode=accepted_async` 的外部命令可以先返回 `status=accepted`，但必须同时返回持久化 `operationId`、非空审计 ID 和状态回读标识；完成、失败及重放仍由同一 operation 状态机追踪。确认层操作号不得冒充正式业务 `operationId`，跨层回执应另行返回 `confirmationOperationId`。

确认后的业务执行失败必须保留正式业务错误码；执行器没有稳定 code 时统一返回 `ai_write_execution_failed`。`ai_write_evidence_missing` 只表示业务结果自称成功但缺少匹配的正式 operation/audit 证据，不得用它掩盖“资源不存在、版本冲突或业务校验失败”。

## 9. 数据库和审计

- 正式业务新增必须使用 `safeInsert()`。
- 所有动态更新必须使用 `safeUpdate()`。
- 删除使用 `softDelete()`；明确没有软删除字段时才使用 `hardDelete()`。
- 禁止动态拼接表名、列名、SET 或 WHERE。
- 跨资源操作必须由 service 持有事务，route 和 AI executor 不得自行拼装多次写入。
- 审计必须包含 actor、capabilityId、operationId、requestId、资源、前后版本和时间。
- 正式命令需要进入跨业务历史时，命令必须显式声明 `businessChange` 语义；`executePersistentCommand` 在业务写入、强审计和 operation 的同一事务内追加一条事件。禁止在 `safeInsert/safeUpdate` 层根据表名或字段隐式猜测业务事件。
- `audit_log` 是可按策略清理的技术写审计，`business_change_events` 是每个完成 operation 一条的追加型业务历史；二者可以用 ID 关联，但不能互相替代或从审计反推业务语义。
- 业务变更中心覆盖会改变正式业务事实、业务配置或业务资料的命令，包括订单、报价、采购、零件、配方、模板、线圈、客户、常用配置预设、质量规则、转子档案、业务设置、文件、知识文档和工作流记录。AI 对话/反馈/评测、派生知识重建、行情同步、文件解析进度以及打印/生成过程属于技术过程或各自权威记录，不写入业务长期记忆。新增正式业务命令默认必须声明业务变更语义；只有明确登记为技术过程的能力才能退出。
- 技术运行记录若用 namespace 隔离手动、诊断或内部发布作用域，创建、后续写入、完成和读取必须复用同一个服务层主体访问判定；route、命令层和脚本不得分别拼接或精确比较持久化 owner key。
- High/Critical 命令的审计写入失败必须使命令失败并回滚；其他命令是否允许尽力审计必须在能力登记中明确。
- 系统初始化和基础设施 UPSERT 是有限例外，不能作为业务表绕过 helper 的先例。

## 10. AI 和自动化契约

1. AI tool 必须映射已登记 capability，不得拥有独立业务实现。
2. executor 只能通过内部 HTTP client 调用正式 API。
3. Query tool 必须调用真正无副作用的 Query API。
4. Command tool 必须默认拒绝；只有 capability 声明允许且完成确认协议后执行。
5. `WRITE_TOOLS` 在能力注册表落地前只是兼容投影，不再作为唯一真相。
6. CAD 出图、打印、文件变更、知识同步等非 SQL 副作用也必须标记为 command/write。
7. AI 不得直接生成 SQL，不得把知识库文本当作实时业务事实。
8. AI 调查接口只能聚合正式 service 输出；AI 可以解释，不能重算成本、库存或状态机。
9. 内部调用必须遵守同一幂等、版本、确认和回执协议，不能另开低安全入口。
10. AI 工具的 executor 归属和结果 provenance 必须从能力注册表读取；禁止在 dispatcher、领域 executor 或 UI 中维护重复名单。
11. 私人助理的默认执行链为 `aiAssistantRuntime`：当前会话和个人记忆 → 同一个模型选择工具 → schema 与参数来源校验 → 正式 API → 结果 → 继续查询或回答。不再强制两个规划阶段，不按预先计划逐项限制工具。
12. 所有已登记、未废弃的 read Query 和无副作用 Preview 默认可用。业务域、实体类型及 single/collection/global 仅表达相关性和查询方式，不是读取权限。跨类型、跨业务、多目标比较使用同一个循环；不以零结果作为扩大只读目录的前提。
13. 模型只能调用实际提供的已登记工具，参数必须通过唯一 schema。正式 API 仍负责过滤、分页、计算和业务规则。AI 不生成 SQL，不复制成本或库存公式，不以知识快照替代实时数据。
14. 查询失败、零结果、歧义和成功结果必须可区分。失败不抹去同轮独立的成功结果；需要多个输入的比较不得在数据缺失时编造结论。成功结果必须具有统一 executor 的正式执行证据。
15. 已明确的用户目标不得被相近名称或别的实体类型自动替换。歧义候选来自正式查询；用户可选一项或多项，选择后继续原问题并重新查实时事实。
16. 会话引用保存在服务端，绑定现有登录主体和 conversationId，15 分钟过期，最多 200 个会话；并发同会话请求拒绝覆盖。客户端 turnState、resolutionContext 和历史回答不能提供写授权或替代正式结果。
17. 个人记忆只存用户表达习惯、别名和处理方法。明确的记忆保存指令即授权该条低风险个人记忆变更，不再要求按钮二次提交；普通纠正不自动持久化。通过正式 memory API 和 service 保存，修改需要 expectedVersion，具备审计、幂等回执和撤销版本。记忆不是业务事实，也不能开放写权限。
18. 本地首批默认不提供业务写工具。后续业务写能力沿用正式预览、本人确认及执行回执链；普通助理循环永远不能设置 allowWrite=true。网站登录继续使用现有机制，不增加 AI 专用身份框架。
19. 模型正文先缓冲，工具错误不得伪装为成功；已取得的有效结果随 detail 返回。金额文案与本轮返回的金额字段核对，内部 ID 不是金额；最多一次金额依据修正提示，保留只读工具以补齐数据，仍不符则展示明确失败或正式成本预览摘要。候选目录不冒充已经完成的成本预览。未取证时不得直接复述历史金额；复述用户本轮输入的拟定价格不要求为此查询业务数据。单轮最多 10 次工具提议、7 次模型轮次，重复成功调用复用结果；允许改变参数继续读取。token 与字节预算不足时明确停止，不静默删除正式结果字段。
20. 旧 V3 两阶段规划和 V4 Fact/Broker/Claim 实验文件保留为历史实现与用户未提交工作，新入口不调用、不 shadow、不自动回退。生产仍运行原已部署版本，只有独立发布验收后才能更新生产状态说明。
21. 模型上下文与正式回执分离：订单、报价、配方列表向模型提供基本字段、省略字段声明及既有详情工具；原始 tool_result/detail 和参数身份依据保持完整。嵌套 JSON 在模型视图中无损解码，token 预算按消息内容估算而非二次转义后的传输 JSON。上轮摘要最多估算 4096 token，超出时明确要求重查，不截断候选 JSON。预算紧张先缩短工具说明，保留所有工具及参数校验结构；若已取得的大明细只容得下正文，则保留结果并结束工具循环，回答已核实部分，明确未完成部分。仍无法容纳时才返回容量不足。

## 11. 鉴权与权限

- 默认所有 `/api/*` 都需要 JWT Cookie 或明确登记的服务身份。
- 公开入口必须逐项登记，不允许因为挂载顺序意外公开。
- 内部调用使用 `x-internal-secret` 或后续正式服务身份，不依赖来源 IP。
- 认证只证明“是谁”，能力注册与领域权限决定“能做什么”。
- MCP 写能力必须同时通过全局写开关、已认证 `clientId` 和该身份的逐工具 allowlist；缺少映射、空列表、未知身份或未知工具必须在启动校验阶段失败，目录和执行层仍须分别按同一 allowlist 拒绝越权工具。
- 高风险命令必须在 service 再检查目标资源和业务状态，不能只依赖前端隐藏按钮。
- 日志、错误和响应不得泄露密钥、Cookie、完整 token 或敏感文件内容。

## 12. 兼容与废弃

- 现有页面、路径、请求和响应优先兼容。
- 兼容逻辑只能位于 route adapter 或 `apps/web-next/lib/` normalize 层，不得进入领域 service。
- `Id/CreatedAt/UpdatedAt`、snake_case 入参、`paintingWage`、`boxType` 等只允许读取旧数据或服务旧调用方。
- 正式字段使用 `id/createdAt/updatedAt`、camelCase、`surfaceTreatmentMode`、`surfaceTreatmentCost`、`packingPartsJson`。
- 废弃必须登记 `deprecated=true`、替代入口、已知调用方和删除条件。
- 删除前必须检查 Web、AI、内部服务和外部自动化，并至少经过一个兼容周期。
- 不得擅自删除 voice、model-variants 等仍有真实调用方的能力。

## 13. 超时、重试和资源限制

- 每项能力必须声明 `timeoutMs`。
- 只有确定幂等的 Query 可以自动有限重试。
- Command 只有携带有效 idempotencyKey 时才能自动重试。
- 外部 AI、行情、ASR、文件解析、CAD 和打印必须有超时及失败回执。
- API 不得无限返回全表数据；列表必须有筛选、排序和上限，数据量增长后增加分页。
- 批量命令必须设置最大项数，并在执行前完整校验，禁止半批成功。

## 14. 强制测试

每个新增或修改能力至少需要：

1. input/output schema 和错误状态测试。
2. Query 无写副作用测试。
3. Command 成功、校验失败和事务回滚测试。
4. high/critical 的幂等重放、key 冲突、版本冲突、确认篡改/过期测试。
5. AI tool 与 capability access/risk/confirmation 一致性测试。
6. 正式成本接口与 `costEngine` 一致性测试。
7. 旧路径和响应兼容测试。
8. 文档路由覆盖测试，保证每个 Method + Path 出现在 `api-reference.md`。

所有 API 变更必须通过：

- 聚焦单元与数据库测试。
- `npm test`。
- `npm run test:deep-api`（涉及业务 API 或数据库时）。
- `npm run build`（涉及 Web 契约时）。
- 发布前 `npm run verify:release`。

## 15. 完成定义

API 变更只有同时满足以下条件才算完成：

- 能力登记完整。
- route 足够薄，业务逻辑位于 service。
- sourceOfTruth 唯一且明确。
- Query 无副作用。
- Command 的风险、事务、幂等、并发、确认和审计符合本契约。
- AI 和内部自动化只调用正式 API。
- `api-reference.md` 已更新。
- `api-sop.md` 的变更流程已执行。
- 自动化测试和构建通过。
- 兼容影响、回滚方法和残余风险已记录。

缺少文档、测试或安全属性的接口，不得以“后续补充”为理由合并、推送或部署。

## 16. 例外管理

确有业务原因不能满足某条契约时，必须在同一变更中记录：

- 偏离的具体条款。
- 业务原因。
- 风险和影响范围。
- 临时替代保护。
- 负责人、到期条件和移除计划。

例外必须是显式、可测试、可到期的；历史代码、时间紧或“当前只有一个用户”都不是长期例外理由。
