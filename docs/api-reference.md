# API 接口总表

> 核对于 2026-09-11。本文只描述当前生效的 HTTP 接口事实。强制规则见 [API 统一契约](./api-contract.md)，变更流程见 [API 变更 SOP](./api-sop.md)，业务口径见 [README.md](./README.md)，未完成风险和优化顺序见 [当前技术债与优化清单](./technical-debt.md)。

文档分工：

- 本文：当前可调用的 Method、Path、请求和响应。
- [API 统一契约](./api-contract.md)：所有能力必须满足的 Command/Query、事实来源、事务、幂等、版本、确认和审计规则。
- [API 变更 SOP](./api-sop.md)：从调用方核对到测试、兼容、文档和发布的操作流程。
- [系统说明](./README.md)：稳定业务边界、鉴权和使用入口。
- [当前技术债](./technical-debt.md)：尚未完成的正确性、测试、维护性和条件触发项。
- Git 历史：保存实施过程，不作为当前接口契约。

当前源码共有 246 个 Express 路由声明。表内出现不代表推荐新调用：标为兼容或观察的入口仅供现有调用方迁移，新增页面、AI 工具和内部服务必须使用标准入口。

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
| `GET /api/health`、`GET /api/health/live`、`GET /api/health/ready` | 公开 | 存活/就绪监控 |
| 常规 `/api/*` | JWT Cookie | `app.use('/api', authMiddleware)` 后保护 |
| 转子图纸 `/drawings/*` | JWT Cookie | 保留历史静态 URL，但发送文件前必须通过 `authMiddleware`；未登录或无效 Cookie 返回 401 |
| 内部服务 | `x-internal-secret` | 与 `INTERNAL_SECRET` 匹配时绕过 JWT |
| AI / 工厂配置 | JWT Cookie 或 `x-internal-secret` | 路由内部单独校验 |
| 通用 MCP `/mcp` | 每个 Agent 独立 Bearer service token | 默认关闭；基础目录为固定只读白名单，写工具还需全局开关、认证身份和逐工具 allowlist；不接受 JWT 或 `INTERNAL_SECRET`，不以客户端自报名称作为授权身份 |

## 3. 认证

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/auth/login` | `{ password }` | 签发 HttpOnly JWT Cookie；生产环境 `secure + sameSite=strict` |
| `POST` | `/api/auth/logout` | 无 | 清除 `token` Cookie |
| `GET` | `/api/auth/check` | 无 | `{ success, authenticated, role?, owner? }`；已部署的独立认证 gateway 增加服务器验签后的 `owner` 布尔值，不返回 subject/token |
| `GET` | `/api/health/live` | 无 | 仅判断 API 进程存活；`{ success: true, data: { status: "alive", timestamp } }` |
| `GET` | `/api/health/ready` | 无 | 检查 SQLite、迁移版本、启动备份；未就绪返回 HTTP 503；`data.runtime` 提供代码/进程诊断，`data.background` 提供后台任务状态 |
| `GET` | `/api/health` | 无 | 兼容监控入口，语义与 `/api/health/ready` 相同；保留顶层 `status/message/timestamp` |

P16-I-R2 认证能力由独立 `127.0.0.1:3104` gateway 接管公网两个精确路径：登录与身份检查；不是新业务 API/AI Tool。现有登录表单不变。共享密码仍转交 Legacy 登录，JWT 仍无 owner `sub`，`role=admin` 不代表 owner。专用密码仅在 `PUMP_OWNER_ACCESS_PASSWORD`（默认 UNSET）、`PUMP_OWNER_SUBJECT`（默认 UNSET）、`AI_V5_OWNER_SUBJECTS`（默认空 JSON 数组）均有效时签发带稳定 `sub` 与 `authn=owner_credential_v1` 的 HS256 JWT；subject 仅服务器控制，初始 allowlist 必须恰含该 subject，精确匹配。密码碰撞、缺失或非法配置禁用 owner，不能使共享用户升级。JWT 使用现有签名配置与 15 天 Cookie 语义；签名/有效期先由正式 JWT 库验证，再校验服务器可信上下文。客户端字段/头不授予身份。登录维持每 IP 每分钟 5 次限制。

gateway 暂作现有登录凭据兼容，不接管注销、业务和 AI 路径；注销仍清除原 `token` Cookie。V5 AI 分流已撤除，owner 标记不再选择 Candidate。配置撤销实时生效于 owner 判断，但已签发 JWT 的普通 admin 有效期与既有认证相同，不承诺全局注销。历史凭据交付与回滚记录见 [owner 认证运行手册](ai-governance/owner-authentication-v1.md)；其中 P16-H AI 路由要求已退役。

所有 HTTP 响应都返回 `X-Request-ID`。调用方可传入 8-128 位字母、数字、
点、下划线或连字符组成的编号；格式无效或未传时服务端生成 UUID。API 访问
日志只记录编号、方法、路径、状态码和耗时，不记录查询参数或请求体。

### 3.1 高风险 Command 通用协议

已经接入统一命令执行器的写接口接受：

- `Idempotency-Key` 请求头，或请求体 `idempotencyKey`；AI 内部调用也可用 `X-Operation-ID` 作为同一幂等键。键长 8-200，只允许字母、数字和 `._:/-`。
- 资源项中的 `expectedUpdatedAt` 必须原样取自最近一次正式 API 响应。资源已变化时返回 HTTP `409` 和 `code=resource_version_conflict`，不产生业务写入、流水、审计或 operation 记录。
- 成功返回标准 operation receipt：`operationId/capabilityId/status/resource/changes/warnings/auditId/auditIds/idempotentReplay/completedAt`，业务结果保留在同一 `data` 中。
- 同一调用主体、`capabilityId` 和幂等键重复提交相同请求时返回已保存回执，并标记 `idempotentReplay=true`；请求内容不同返回 HTTP `409` 和 `code=idempotency_key_conflict`。
- 失败响应为 `{ success: false, code, error, requestId }`。可预期校验错误为 `400`，资源不存在为 `404`，版本、幂等或库存状态冲突为 `409`，未知执行异常为 `500`。

调用主体由 JWT 或内部凭据的 SHA-256 指纹标识，数据库不保存原始 token/secret。旧调用未提供幂等键或 `expectedUpdatedAt` 时仍兼容执行，并在 `warnings` 中明确标记缺失保护；这种调用不能获得跨请求重试或并发覆盖保护，新调用方不得依赖该兼容模式。持久化回执默认保存 90 天。

## 4. 零件 Parts

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/parts` | 可选 query：`keyword`、`category`、`supplier`、`stockStatus=low\|out\|attention\|ok`、`limit`（1–100）、`minPrice/maxPrice/priceBelow/priceAbove/minStock/maxStock/stockBelow/stockAbove`、`sortBy=price\|stock\|model\|updatedAt`、`sortOrder=asc\|desc` | 正式能力 `parts.list`。无 `limit` 时返回全部有效零件；文本字段模糊筛选，`min/max` 为包含边界，`Below/Above` 为严格边界。指定 `sortBy` 时先排序再应用 `limit`，`sortOrder` 默认 `desc`。`stock` 是以“件”为当前领域确定性单位的库存数量，合法 `0` 原样返回；库存筛选状态口径：`low`=1–5、`out`=不大于 0、`attention`=不大于 5、`ok`=大于 5。Row Adapter 输出 camelCase；包装零件额外返回 `subcategory`。零件说明规范字段为 `remark`，兼容期同时返回旧 `notes`；另外临时保留 `Id/CreatedAt/UpdatedAt` |
| `POST` | `/api/parts` | 请求头 `Idempotency-Key`；`model, category, subcategory?, price, supplier, stock, remark, duplicatePolicy?=allow\|reject, businessSettings?[]`；历史调用可继续提交 `notes` | 能力 `parts.create`。新增零件并返回原零件顶层字段和标准 operation receipt；零件说明的规范字段为 `remark`，Row Adapter 在兼容期同时返回旧字段 `notes`，Web 只消费 `remark`。允许设置建档初始库存。`businessSettings` 仅接受当前零件表单负责的 `cable_accessories/float_accessory_delta` 及其版本，并与零件、operation、强审计在同一事务提交。`duplicatePolicy=reject` 时，正式命令在同一事务内按不区分大小写的“型号 + 供应商”重验有效零件，重复身份返回 `409 part_identity_conflict`，不同供应商允许新增；默认 `allow` 保留零件资料页人工确认后重复建档的既有语义。Web 调用方包括零件资料页，以及泵壳自由搭配、整套泵壳、模板固定配件、配方选配件和包装材料的就地建档；就地调用方使用 `reject`，保存前后都重新读取正式目录，同身份已有同类记录直接选中，跨类别冲突拒绝静默改类，成功后以正式 `id/model/supplier/price` 回绑当前草稿；创建或回读失败均保留草稿且不显示为成功。自由搭配固定写入 `category=泵壳搭配, stock=0`；整套泵壳和包装入口分别锁定 `泵壳`、`包装` 分类，其他入口使用当前表单确认的正式分类与当前展示的专用元数据字段；泵壳完整默认参数仍由零件资料页维护。`category=包装` 时二级分类必须为 `外包装/内衬/固定包材` |
| `POST` | `/api/parts/batch-create-preview` | `{ parts: [{ model, category?, subcategory?, price, supplier?, stock?, remark? }] }` | 能力 `parts.batch_create` 的正式只读预览，单次 1-100 项。完整校验每项，按“型号 + 供应商”识别现有建档：同型号不同供应商允许新增，同型号同供应商跳过并返回 warning；返回服务端签发的 `confirmationToken/previewHash/suggestedIdempotencyKey`，不写库。Web 的模板和配方编辑器用此接口集中预览草稿中尚未建档的零件 |
| `POST` | `/api/parts/batch-create` | 请求头 `Idempotency-Key`；`{ confirmationToken, idempotencyKey? }` | 执行预览固化的待新增零件，不接受客户端重传清单。执行时重验“型号 + 供应商”仍不存在；任一冲突、校验或强审计失败时整批回滚。成功返回 `createdCount/parts` 和标准 operation receipt。Web 确认成功后必须重新调用 `GET /api/parts`，以正式目录记录回绑当前草稿；回读失败时保留草稿并禁止提示重复提交 |
| `PATCH` | `/api/parts/:id` | 请求头 `Idempotency-Key`；可更新字段及 `expectedUpdatedAt` | 能力 `parts.update`。资源版本、零件更新、operation 和强审计同一事务；原路径及顶层零件字段保持兼容。修改型号必须提供 `expectedUpdatedAt`；事务内盘点引用，存在已知引用或盘点不完整时返回409，禁止直接覆盖名称。历史请求仍可提交 `stock`，但响应带 `part_stock_patch_compatibility`；Web 完整资料表单必须改用 `/save-preview` → `/save` 提交绝对目标库存，独立出入库和 AI 库存增减必须使用 `/batch-stock-preview` → `/batch-stock` |
| `POST` | `/api/parts/:id/save-preview` | 完整资料、目标库存 `stock`、`expectedUpdatedAt`，以及可选 `businessSettings[{ key, value, expectedUpdatedAt }]` | 能力 `parts.save_profile` 的只读预览；绑定零件版本、绝对目标库存和表单设置版本；涉及改名时还绑定引用源哈希，返回 `confirmationToken/suggestedIdempotencyKey/changes`，不写库 |
| `POST` | `/api/parts/:id/save` | 请求头 `Idempotency-Key`；`{ confirmationToken, idempotencyKey? }` | 执行预览固化的资料、目标库存和适用设置；零件、设置、operation 与强审计同一事务，任一失败整单回滚，同键重放不会重复增加库存 |
| `POST` | `/api/parts/:id/delete-preview` | `{ expectedUpdatedAt }` | 能力 `parts.delete` 的正式只读预览；绑定零件 ID、型号、供应商、资源版本和预览哈希，返回价格、库存、预计软删除变化及影响范围，不写业务表、operation 或审计 |
| `DELETE` | `/api/parts/:id` | 请求头 `Idempotency-Key`；请求体 `{ expectedUpdatedAt, previewHash }`，版本也兼容 query/header | 能力 `parts.delete`。所有调用方都必须提交正式 Preview 返回的版本和哈希，任一缺失或漂移均拒绝且零副作用；软删除并返回标准 operation/audit 回执及兼容业务字段 `{ deleted: 1 }` |
| `POST` | `/api/parts/batch-delete-preview` | `{ parts: [{ partId, expectedUpdatedAt }] }`，单次 1-100 项 | 能力 `parts.batch_delete` 的只读预览；完整校验全部有效零件及版本并签发确认凭证，不写库 |
| `POST` | `/api/parts/batch-delete` | 请求头 `Idempotency-Key`；`{ confirmationToken, idempotencyKey? }` | 只执行 token 固化的清单；执行前再次完整校验，全部软删除、operation 和逐项强审计同一事务，任一失败整批零删除 |
| `POST` | `/api/parts/prices-preview` | `{ updates: [{ partId, price, expectedUpdatedAt? }] }` | 能力 `parts.batch_update_prices` 的只读预览；校验 ID、非负价格和重复项，补齐每项正式资源版本，返回 `changes/previewHash/suggestedIdempotencyKey`，不写库 |
| `PATCH` | `/api/parts/prices` | 请求头 `Idempotency-Key`；`{ updates: [{ partId, price, expectedUpdatedAt }], previewHash }` | 按预览批量调价；全部零件版本、预览哈希、operation 和强审计在同一 SQLite 事务校验/提交，任一冲突整批回滚，相同请求安全重放。旧 `{ partId, price }` 数组仍兼容，但会提示缺少预览或调用方版本保护 |
| `POST` | `/api/parts/batch-stock-preview` | `{ operations: [{ partId, delta }] }` | 能力 `inventory.parts.batch_adjust_stock` 的正式只读预览；最多 100 项，读取当前库存和资源版本，返回逐项 `currentStock/nextStock`、截零 warning、`confirmationToken/operationId/suggestedIdempotencyKey`，不写库 |
| `POST` | `/api/parts/batch-stock` | `{ confirmationToken, idempotencyKey? }`；推荐请求头 `Idempotency-Key`、`X-Operation-ID` | 执行预览中由服务端固化的增量和资源版本，不信任执行请求重传的 `operations`。任一零件版本变化时整批回滚；成功返回零件和 operation receipt |

零件改名当前采用过渡保护：有配方、模板等已知引用（包括未撤销的历史旁路绑定）时返回 `PART_RENAME_REFERENCES_REQUIRE_MIGRATION`；盘点不完整、同供应商名称冲突、PATCH缺少版本分别返回 `PART_RENAME_AUDIT_INCOMPLETE`、`PART_RENAME_NAME_CONFLICT`、`PART_RENAME_VERSION_REQUIRED`，均为409。没有发现引用的旧零件预览附 `renameImpact{partId,previousName,proposedName,complete,referenceCount,references,sourceHash}`；确认保存重查依赖及全部声明来源的哈希，源数据变化返回 `PART_RENAME_SOURCE_CHANGED`。哈希仅用于并发校验，扫描完成不证明全链条可改名。失败不写名称、库存、设置或审计；单独调价等不改型号的保存不受此检查影响。此入口尚不执行别名保存或引用迁移。

AI 工具 `batch_create_parts`、`adjust_part_stock`、`update_part` 和 `batch_update_prices` 的批量建档、型号/类别定位、字段差异说明、元数据 PATCH、库存 Preview/Command 及调价 Preview/Command 调用集中在 `aiPartExecution`；查询 executor 只负责委托。该 AI 编排层不访问数据库，也不得把库存写入普通 PATCH。两条及以上零件使用 `batch_create_parts`，由正式 `/batch-create-preview` → `/batch-create` 生成一次整批确认并原子写入；单条仍使用 `create_part`。一个或多个零件的库存增减统一使用 `adjust_part_stock`：模型把 `+30/-20/加30/减少20/入库30/出库20` 等自然语言归纳为类型化 `items[{model,changeQty}]`，服务端不再维护业务句式编译规则。候选型号先按正式零件列表精确解析；零匹配时返回最多 5 个相似候选供用户明确选择，多匹配时返回真实候选，二者均不生成写确认卡。唯一匹配后，在 AI 确认卡之前调用 `/batch-stock-preview`，确认卡只展示数据库标准型号及正式预览的 `currentStock/nextStock/delta`。确认卡必须来自 executor 的结构化 `requiresConfirmation/confirmationToken/argsHash/rows`，模型 Markdown 不具备确认含义。正式预览凭证作为服务端上下文绑定 AI confirmation token，不下发客户端；确认后直接以该上下文调用 `/batch-stock`，不会重新解析模型参数或重复预览。Command 返回后逐项核对 `resourceId/delta/from/to` 与 Preview，并重新调用正式 `/api/parts` 回读最终库存；数量、值、operation、audit 或回读任一不一致均不得宣称成功。多型号不得拆成模型文字步骤。`batch_update_prices` 保留 `category + percentChange|absoluteChange` 类别批量兼容模式，并支持 `targets[] + percentChange|absoluteChange` 明确目标模式；灰度阶段明确目标限 1–8 项，每个 target 只能使用本轮正式 Query 回读的 `partId`，或完整 `model+supplier`。服务端必须把选择器重新唯一绑定为标准零件，零匹配、多匹配、重复目标或缺少当前价格时整批停止且不签发确认；正式 Preview 若跳过目标、返回 warning 或与 Query 候选价发生漂移，同样停止。确认卡完整展示全部明确目标的正式型号、供应商及 Preview 当前/预计价格。百分比/固定金额只在这里转换为两位小数且不低于 0 的候选价，正式 `/prices-preview` 仍会重新校验具体价格、补齐资源版本并签发预览哈希；Command 后还要核对 operation/audit、无重复的精确逐项 changes 集合并通过正式零件 Query 回读价格。若其他调用方也需要调价策略，应扩展正式策略预览 API，不得复制换算规则。`update_part` 仅接受 `price/supplier/category/subcategory` 等资料字段，旧版 `stock/stockDelta` AI 输入和双模式分支已删除；库存只能通过 `adjust_part_stock` 的正式 Preview/Command、确认和回执链路执行。

历史配方中已标记 `dynamicRule=longScrewByBarrelLength` 但零件库缺少目标长度型号时，运行 `npm run maintenance:backfill-long-screws` 进行受控回填。该命令复用 `parts.batch_create` 的 Preview/Command、持久化幂等、operation 回执和强审计，不直接绕过零件建档契约。

内部只读能力 `catalog.reference_audit` 由 `npm run audit:catalog-references -- [数据库路径]` 调用，默认读取项目 `pump.db`；不挂载 HTTP，不暴露为 AI/MCP 工具。脚本以 SQLite readonly + query_only 打开现有数据库，不加载业务启动模块。输入仅允许 `maxRowsPerTable`（默认 10000，上限 50000）和 `maxReferences`（默认 100000，上限 500000），CLI 使用默认预算。返回 `CatalogReferenceAuditV1`：声明范围内的 `counts/references/sourceHashes/namingCandidates/businessBaseline/baselineSha256/coverage`、`complete/allReferencesResolved/errors`。引用区分明确 ID、旧名称唯一候选、歧义、缺失、停用、ID/名称不一致、非库存描述与非结构化关联；嵌套 JSON、包装白名单及线圈白名单保留定位路径。目录截断后不解析该目录的候选，缺表、非法 JSON 或预算超限使 `complete=false`；完整扫描不代表可以迁移，`coverage.migrationApproved` 始终为 false。退出码 0 表示盘点完成（仍可能存在未解决引用），2 表示不完整，1 表示执行失败。JSON 输出到 stdout；保存业务报告时使用已忽略的 `logs/catalog-naming/`，不要提交业务明细。该能力不回填引用、不改名、不修改历史快照。

`POST /api/ai/chat` 保留最近 10 条有效 user/assistant 消息作为普通语言上下文；实时事实重新调用正式 API。本地模式的业务工具轮只发送当前用户请求、可信服务端候选和正式工具回执，不把旧助手自然语言结论重新作为业务上下文。只要本地工具短名单非空，本轮必须取得正式工具回执；首次跳过会重试一次，连续跳过则返回无可验证结论。线圈/绕组与配方/产品的关系查询同时开放 `search_coils` 和 `get_all_recipes`；问题包含明确 `规格-片数` 时，运行器会确定性补发模型遗漏的一侧只读查询，并以完整配方列表的 `coilId/coilSpec/coilSheets` 字段核对关联。服务端会话引用绑定现有登录主体和 conversationId，内存引用 15 分钟过期；`chat-<ID>` 可从同一所有者的持久会话消息恢复最近带正式执行证据的候选，不信任客户端传入的 turnState、resolutionContext 或候选数据。全部已登记只读能力每轮可组合调用，不按业务域或对象范围限制；明确肯定式业务写命令由服务端切入受保护命令通道，首轮只生成确认卡，不直接写入。Web/PWA 保留流式请求互斥锁。正式缺失目标与完整空查询保留在模型反馈和预算结束回答中，空查询结论仅限回执筛选范围。金额汇总只取有执行证据的正式字段；成本预览总价不能被原材料单价替代，内部 DSML/XML 协议不能展示或当作执行。经营概览的正式看板回执先投影为订单、财务、库存和待处理摘要，不向回答模型发送缺货/采购大明细及嵌套重复财务对象；单一 `get_dashboard_summary` 的概览查询由 Presenter 直接生成去重摘要，`采购完成` 与已完成订单口径分开，不再进入额外模型修复轮。工具提议超出剩余次数时整组不执行，转入最终回答；不必要的重复询问进行至多一次完成性复核，真实候选歧义仍保留选择。本地最终正文会去除完全重复段落，用户未要求完整明细时对异常长输出执行兜底截断。SSE 只读 `metrics` 终态事件中，有供应商原生 `timings` 时返回精确生成速度；无原生计时时仅在输出足够长且有多个 SSE 内容分片时返回 `stream_observed` 估算。短回复、单分片或无可靠生成区间时速度为 `null`，不使用包含 TTFT 的整次请求耗时伪造 tok/s。处理细节见 [私人 AI 助理](ai-assistant.md)。

包装零件的一级分类统一为 `包装`。二级分类只表达用途：牛皮纸箱、彩印箱和木箱归入 `外包装`；泡沫和珍珠棉归入 `内衬`；说明书、贴纸等归入 `固定包材`。具体材质和规格继续由型号及 `packagingMaterial` 表达。


零件命名输入：`POST /api/parts` 和批量新增的每项可传 `naming:{ruleId,spec}`，此时 `model` 可省略；若提供，必须精确等于服务端生成名（忽略首尾空白），分类必须与规则一致。当前开放 `gasket/accessory/packaging/custom-part`（皮垫/配件/包装/其他），由规则的 `supportsPartCreate` 标记。缺项、未知字段、错误分类、手写不同型号及未开放规则返回400；同型号同供应商即使 `duplicatePolicy=allow` 仍返回409。批量预览冻结规范化规格，执行不采用客户端重新提交的规格。单条和批量新建均在既有强审计、operation、事件事务中保存，不增加独立写入口。

零件列表及命令响应增加 `naming:null|{ruleId,ruleVersion,spec}`；既有零件保持 null，命名输入不证明完整实物规格。Web 新建上述四类时要求填写品名/明确规格/可选必要区别，自动预览型号，保存后回读。已有生成名的普通 PATCH 和资料整单保存不允许更换型号、类别或命名规格；价格、库存和备注仍走原正式命令。旧零件提交 naming 返回409，等待后续受保护的规范化流程。未带 naming 的旧调用仍兼容原型号，不代表所有入口已强制命名；其他类别和 AI 自然语言命名录入尚未接入。

### 4.1 目录命名与引用

只读盘点额外输出 `costBaseline`：固定本次事务读取的零件目录价、线圈记录及 `cable_accessories/float_accessory_delta/management_fee` 白名单设置和输入哈希，以正式 `costEngine` 计算 `saved_bom_current_catalog_prices` 场景。该场景只计算保存 BOM 的配件参考成本，不冒充重新展开配置、刷新线圈价格后的完整整泵成本；每个配方保留 calculated/missing_prices/failed/incomplete_inputs 状态，输入不完整或计算失败不输出伪零值。订单基线保留原 `itemsJson/purchaseListJson` 及采购回执，以便对比采购行身份、进度和预留输入。

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/catalog/naming-rules` | 无 | `catalog.naming_rules`。返回 `version/sourceOfTruth/rules`；每条规则包含稳定 `id/entityType/category/version/fields/nameParts/supportsPartCreate`。字段描述与生成器共用服务端注册表，字段类型为 text/number/choice，含中文标签、必填/可选及单位。当前 16 条规则覆盖零件类别、线圈、模板、配方及常用配置 |
| `POST` | `/api/catalog/name-preview` | `{ ruleId, spec }` | `catalog.name_preview`。严格 schema，拒绝未知字段、直接传入 `name/model`、字符串数字、缺项、非有限数、负数/零、错误单位、过长文本。返回 `preview=true/name/normalizedSpec/normalizedInput/ruleId/ruleVersion/entityType/category/namingInputFingerprint/changes/warnings/sourceOfTruth`。不签发写确认，不建档、不改名、不进行重名判定 |
| `POST` | `/api/catalog/references/resolve` | `{ references: [{ entityType, entityId, snapshotName?, specRevision? }] }`；类型为 `part/coil/template/recipe/modelVariant`，最多100项，允许空数组 | `catalog.references_resolve`。同一只读事务按类型批量查询，按请求顺序返回 `items[{entityType,entityId,currentName,snapshotName,referenceStatus,nameRevision,specRevision,namingState}]`。现名来自目录、历史名原样保留；不按旧名称猜 ID，不修改快照。无档案旧记录仍可显示现名，修订为 null；明确要求规格修订但没有结构化档案时返回 `specification_unverified` |
| `POST` | `/api/catalog/reference-bindings-preview` | `{ bindings: [{ sourceType, sourceId, path, sourceHash, targetType, targetId }] }`，1–100项、严格字段 | `catalog.bind_references` 预览。仅接受完整盘点中的唯一明确 ID 或唯一旧名引用；拒绝歧义、失效、非库存、伪造路径及重复位置。返回 `preview=true/entries/previewHash/confirmationToken/operationId/expiresAt/suggestedIdempotencyKey/warnings`；不写数据 |
| `POST` | `/api/catalog/reference-bindings` | `{ confirmationToken, idempotencyKey? }`；必须显式提供 body 幂等键或标准幂等头 | `catalog.bind_references`。确认绑定会话、来源、目标及档案哈希；同一事务重验后建立 legacy 档案和引用绑定，原 JSON、名字、价格、库存与进度不变。返回标准回执，含 `bindingIds/displayOnly/auditIds/changes/businessChangeEvent/idempotentReplay`。不接受重新提交映射 |
| `POST` | `/api/catalog/bound-names` | `{ sourceType, sourceId, afterId?, limit? }`，游标默认0，limit默认100、上限100 | `catalog.bound_names`。按绑定 ID 分页，返回 `sourceType/sourceId/sourceHash/items/nextAfterId/sourceOfTruth`。每项含 `bindingId/path/entityType/entityId/snapshotValue/currentName/referenceStatus/nameRevision/specRevision/displayOnly`；无下一页时游标为 null |

绑定来源类型为 `part/coil/template/recipe/modelVariant/quotation/order/orderRevision/drawing/fileLink`，目标类型为 `part/coil/template/recipe/modelVariant`；ID 为正安全整数。`path` 为盘点输出的 JSON Pointer（含嵌套 JSON 字符串定位），`sourceHash` 为同一行投影的 SHA-256（零件采用完整行，包含命名输入；旧投影生成的 hash 必须重新盘点），`sourceVersion` 存为 `sha256:<sourceHash>`。预览同时冻结目标和档案内容，提交前有任何变化均作废；已绑定同一目标可跳过，全部已绑定返回 `catalog_binding_no_changes`，撤销或冲突绑定不允许覆盖。写入、强审计、业务事件及90天幂等回执原子提交；确认有效期默认5分钟，过期或进程重启需重新预览。正式执行仍需同会话确认凭证，幂等回执不延长确认有效期。

绑定读取保留原标量 `snapshotValue`（数字 ID 不冒充名称），现名只从目标 ID 读取。来源整体内容变化返回 `stale_source`，不把旧数组位置套到新内容；此时原标量和现名均为 null。缺失/停用分别为 `missing/inactive`，规格修订变化为 `specification_changed`；旧档案未核实物理规格时为 `bound_legacy`，结构化档案无冲突时为 `resolved`。全部结果 `displayOnly=true`，不能用于采购入库或规格替换授权，也不代表业务页面已经接入。数据库错误不降级为空列表。参数非法400，来源不存在404，盘点不完整、预览过期或冲突409，意外/强审计失败500。分页遇到来源哈希变化时，调用方必须丢弃旧页重新读取。这两项新增能力仅供 Web/Internal，未开放 AI/MCP 工具。

规则字段为服务端唯一来源。轴承保留实际目录代号（不把 `202` 自行补为 `6202`）；螺丝按头型、直径、长度、材质及必要区别生成；油封必须明确机械密封/骨架油封以及内径、外径、高度或厚度；电容使用 μF；电缆和浮球明确区分直径 mm 与截面积 mm²，禁止把旧“线径”自动认作其中一种。线圈保留定子组合代号、片数、材质、槽眼和方案区别，片数不称为叠长。模板名独立于泵壳物料名；配方内部名含系列、定子代号、片数、机筒长度和配置区别；对外型号独立保存。泵壳、组件、皮垫、配件、包装和非标件采用品名/系列、明确规格和必要区别字段。数值最多四位小数、最大 1000000，片数必须为整数；文本先去首尾空白和 NFC 规范化，代号字段仅统一 ASCII 字母大小写。

命名输入指纹来自规则 ID 与规范化命名规格；它不是完整实物规格的证明。后续保存命令必须结合线圈电压/频率/绕组等正式属性建立完整实物指纹，不能只凭名称字段判定同物。不同供应商的实体 ID 仍须分别保留。当前命名及引用能力用于后续表单和迁移接入，原建档/修改命令尚未强制消费规格对象。`resolved` 只证明读取时该 ID 存在且没有已知规格冲突，不是授权执行库存或规格变更的凭证。其余状态为 `missing/inactive/specification_changed/specification_unverified`；数据库错误返回失败，不能伪装为 missing。错误使用稳定 code、requestId，校验错误为400，未预期错误为500。

配方选配/包装预览保留已选 `partId`；模板固定项/组件展开同样保留明确 ID，取价使用该 ID，零价不会退回手工价。当前成本查询中带 ID 的普通物料使用对应目录记录，错误 ID 拒绝且不回退同名对象；旧名称与 ID 不一致的写入仍受原有校验约束。动态长螺丝生成另一长度时清除原规格 ID，再按目标规格走后续解析，不能带着原 ID 换实物。

## 5. 线圈 Coils

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/coils` | 查询参数 `spec?/sheets?/material?/slotType?/schemeCode?/schemeStatus?/isDefault?/ratedVoltageV?/ratedFrequencyHz?/market?/schemeFamilyCode?` | 能力 `coils.list`。`coilQueries` 按类型化字段精确筛选并只读返回完整线圈方案档案，字段含稳定 `schemeCode`、`isDefault`、`ratedVoltageV/ratedFrequencyHz/market/schemeFamilyCode`、`diameterMm/commonName/material/slotType/schemeName/schemeStatus/stock`、`pricingMode=calculated\|kit`、`kitPrice`、成本组成和绕组数据；`stock` 单位为套，整数筛选必须为正整数，`isDefault` 仅接受 `true/false/1/0`，非法筛选返回 `400` 而不放宽查询。Query 严格只读，事实来源为 `coils + stator_variants`，风险 low，天然幂等；Web、AI 和内部调用共用 |
| `GET` | `/api/coils/variants` | 无 | `coilQueries` 只读返回定子组合列表；组合键为标准直径、材质和槽眼 |
| `POST` | `/api/coils` | `spec, diameterMm, material, slotType, sheets, schemeCode?, schemeName?, schemeStatus?, isDefault?, ratedVoltageV?, ratedFrequencyHz?, market?, schemeFamilyCode?, pricingMode?=calculated\|kit, kitPrice?, unitPrice?, wireWeight?, copperBase?, coilFee?, rotorFee?, ...`；推荐请求头 `Idempotency-Key` | 能力 `coils.create`。`schemeCode` 留空时服务端生成且创建后不可修改；电压和频率若填写必须成对为正整数。同组合、同片数允许多套 `official`，新增不会降级旧方案；首套正式方案自动成为默认，显式 `isDefault=true` 会在同一事务切换唯一默认。`calculated` 按成本组成计算；`kit` 要求 `kitPrice>0`，参考线重/铜价不参与成本。返回完整方案和标准命令回执 |
| `PATCH` | `/api/coils/:id` | 线圈 camelCase 字段（含 `isDefault/ratedVoltageV/ratedFrequencyHz/market/schemeFamilyCode/pricingMode/kitPrice/wireWeight/copperBase`；不接受修改 `schemeCode`），`expectedUpdatedAt?`, `idempotencyKey?` | 能力 `coils.update`。修改方案元数据、定子组合、绕组或计价方式；默认切换在事务内保证同组唯一。套件参考线重和铜价不进入成本。库存大于 0 或已有流水后尺寸身份被冻结；新调用必须传资源版本 |
| `DELETE` | `/api/coils/:id` | `{ expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `coils.delete`。仅允许删除库存为 0 且从未产生库存流水的线圈方案；已有库存或流水时返回 `409`，避免破坏库存追溯。页面继续显式确认；旧空请求兼容执行并返回缺少版本/重试保护 warning |
| `POST` | `/api/coils/spec-draft` | `{ spec, diameterMm?, material?, slotType? }` | `coilQueries` 复用 `coilCost` 按定子组合生成新的 `pricingMode=calculated, kitPrice=0` 录入草稿；精确组合优先从计算方案带入单片价和计算字段，只有套件方案时不复制套件价或传统计算字段，但可带入默认线径/电容等辅助档案；不写库 |
| `POST` | `/api/coils/spec-price-preview` | `{ spec, unitPrice, material?, slotType? }` | 能力 `coils.batch_update_unit_price` 的只读预览。按标准直径及可选材质/槽眼只列出 `calculated` 方案的单片价、成本差异和 `expectedUpdatedAt`，返回 `previewHash` 与建议幂等键；供应商套件价方案不参与且不写库 |
| `PATCH` | `/api/coils/spec/:spec` | `{ unitPrice, material?, slotType?, previewHash?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `coils.batch_update_unit_price`。按预览批量更新定子单片价并重算各方案成本；版本、价格或成本漂移返回 `409`，任一写入/审计失败整批回滚。保留原路径和顶层 `updated`；旧无预览请求兼容执行并返回 warning |
| `POST` | `/api/coils/calculate` | `{ spec, sheets, material?, slotType?, coilId?, schemeCode?, schemeFamilyCode?, wireWeight?, copperPrice?, includeTesting? }` | `sheets` 必须为正整数，线重和铜价必须为非负数字；默认只使用正式方案，includeTesting=true 可在只读试算中包含测试方案，停用方案仍不参与。`coilId` 或 `schemeCode` 用于精确锁定方案；多候选未指定方案返回 `409 COIL_SCHEME_AMBIGUOUS`。插值或外推必须以 `schemeFamilyCode` 锁定同一方案族，否则返回 `409 COIL_SCHEME_FAMILY_REQUIRED`。精确命中 `kit` 时返回 `pricingMode/kitPrice/wireWeight/copperBase/totalCost`，其中线重和铜价基数是保存的可选参考值，忽略请求中的成本覆盖参数且 `totalCost` 始终等于 `kitPrice`；套件方案不参与插值或外推 |
| `GET` | `/api/coils/specs` | 无 | `coilQueries` 只读返回正式方案可用的规格、标准直径、材质、槽眼和片数；`variants[]` 按材质+槽眼返回各自可用片数，供配方联动选择 |
| `GET` | `/api/coils/:id/stock-movements` | 查询参数 `limit?` | `coilQueries` 校验方案存在后只读返回最近库存流水，`limit` 为 1-100、默认 20；字段为 `changeQty/balanceAfter/movementType/referenceType/referenceId/note/createdAt` |
| `POST` | `/api/coils/:id/stock-adjustment` | `{ idempotencyKey?, changeQty, expectedUpdatedAt?, note? }` | 能力 `inventory.coils.adjust_stock` 的单项兼容入口；`changeQty` 必须是非零整数，库存不足返回 `409`。成功保留 `coil/adjustment` 并附 operation receipt |
| `POST` | `/api/coils/stock-adjustments-preview` | `{ adjustments: [{ coilId, changeQty }], note? }` | 能力 `inventory.coils.adjust_stock` 的正式只读预览；最多 50 项，返回型号、材质、槽眼、当前/执行后库存和服务端确认凭证。库存不足在签发确认前拒绝 |
| `POST` | `/api/coils/stock-adjustments` | `{ confirmationToken, idempotencyKey? }`；推荐请求头 `Idempotency-Key`、`X-Operation-ID` | 标准批量执行入口，仅执行确认凭证绑定的线圈、数量、备注和资源版本；任一项版本冲突或库存不足时，库存、流水、审计和 operation 整批回滚 |

AI 工具 `adjust_coil_stock` 的“规格俗称-片数”解析、正式方案唯一匹配和材质/槽眼歧义拒绝集中在 `aiCoilStockExecution`；查询 executor 只负责委托。该 AI 编排层不访问数据库、不计算库存结果，必须依次调用上述正式批量 Preview/Command，并消费服务端签发的 `confirmationToken` 与 `suggestedIdempotencyKey`。库存校验、版本绑定、原子事务、流水和审计仍以正式 API 为唯一权威。

AI 的 Part/Coil 当前库存数量共用 `inventoryQuantity/current/current_inventory` Fact，并映射为 `inventory.quantity` scalar Claim；数值只取上述正式 Query 的匹配实体 `stock`，Part 单位为“件”、Coil 单位为“套”，合法 `0` 仍是已验证数量。`schemeStatus` 只描述线圈方案生命周期，不是库存状态；数量与状态不能互相满足 FactRequirement。价格、成本、历史快照和知识内容不参与当前库存物化。

## 6. 模板 Templates

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/templates` | 查询参数 `shellModel?`, `description?`, `limit?`（1–100） | 正式能力 `templates.list`；型号和描述按空白分词、各词全部匹配且忽略大小写（保留词内标点），筛选后限制数量，无 `limit` 时返回全部泵壳模板，标准字段含 `id/createdAt/updatedAt/configurationPolicyJson` |
| `GET` | `/api/templates/:id` | 无 | 正式能力 `templates.detail`；经 `templateQueries` 返回单个完整模板，包含 BOM、泵壳组件、转子参数、工资、表面处理、成本模式、套件成本和备注；非法 ID 返回 400，不存在返回 404。Query 严格只读，事实来源 `pump_shell_templates`，风险 low，天然幂等、无并发/事务/审计要求，默认超时 15 秒；Web、AI 和内部调用共用 |
| `GET` | `/api/templates/:id/cost` | 无 | 经 `templateQueries` 聚合模板固定配件、壳体组件和正式零件目录，再委托 `costEngine` 兼容入口计算成本；不写库 |
| `GET` | `/api/templates/:id/default-recipe` | 无 | 经 `templateQueries` 基于模板生成配方草稿、配件、转子参数、`configurationPolicyJson` 和正式成本结果；`recipeDraft.templateId` 使用标准 `id`，不写库 |
| `POST` | `/api/templates/:id/apply` | `{ recipe? }` | 经 `templateQueries` 把模板默认项应用到传入配方草稿；只生成草稿，不写库 |
| `GET` | `/api/templates/:id/recipes` | 无 | 经 `templateQueries` 返回引用该模板的配方列表 |
| `POST` | `/api/templates` | 请求头 `Idempotency-Key`；`shellModel/shell_model` 等模板字段；`bundleNote` 为泵壳套件备注；`shellComponentsJson` 在 `components` 模式下保存自由组合计价项，只接收 `name/model/supplier/qty/unitCost/pricingMode/included/optional/componentType/subassemblyContents/note`，未知字段明确忽略；历史 `isStainlessStretchBarrel` 仅用于只读识别，不保存。每个计入项的 `qty` 必须为正数，`model` 必须存在于零件库“泵壳搭配”分类，否则返回 400。普通单件使用 `componentType=standard`；不锈钢拉伸筒使用 `stainlessStretchBarrel`；供应商小套件使用 `subassembly` 并带一级 `subassemblyContents: [{ name, qty, referenceUnitPrice?, note? }]`，其中 `referenceUnitPrice` 可省略、提供时必须为非负数。计入的小套件至少 1 个、最多 30 个组成项，组成项数量必须为正数。自由搭配最多 50 个计价项。`surfaceTreatmentMode` 支持 `none/painting/electrophoresis/electrophoresis_powder_coating/powder_coating`，`surfaceTreatmentCost` 为非负费用 | 能力 `templates.create`。新增模板并返回原模板顶层字段和标准 operation receipt；模板、operation 与强审计同一事务。`bundle` 模式的 `shellModel` 应引用零件库泵壳整套型号；`components` 模式的单件或小套件父项必须引用“泵壳搭配”零件。Web 选择父型号时将该型号当前目录价带入 `unitCost` 作为备用单价；正式计价仍优先读取当前零件库价格。小套件父项是唯一计价和库存单位，组成项的 `referenceUnitPrice` 只用于查询、小计和套件差额比较，不生成独立 BOM、不重复计价或扣库存；历史组件名称和缺少参考单价的组成项继续兼容读取 |
| `PATCH` | `/api/templates/:id` | 请求头 `Idempotency-Key`；同新增模板字段及 `expectedUpdatedAt` | 能力 `templates.update`。资源版本、组件目录校验、模板更新、operation 与强审计同一事务；原 URL 和模板字段保持兼容 |
| `DELETE` | `/api/templates/:id` | 请求头 `Idempotency-Key`；请求体或查询参数 `expectedUpdatedAt` | 能力 `templates.delete`。无任何历史配方引用时硬删除并返回标准回执；有引用返回 `409 template_in_use`。原删除保护语义保持不变 |

模板领域按 Query / Command 分层：`templateQueries` 只读取正式模板、零件目录和关联配方，并生成成本或配方草稿；目录价优先、模板手工备用价回退的既有规则保持兼容，正式成本仍由 `costEngine`（经 `api/db.cjs:calculateRecipeCost` 兼容导出）计算。模板新增、修改和删除唯一委托 `templateCommands`，路由只负责请求/响应协议适配。供应商小套件不允许嵌套；其组成项及可选 `referenceUnitPrice` 只保存在父计价项的 JSON 中，不是零件目录、正式成本或库存事实。

模板新增和修改可传 `configurationPolicyJson`；服务端接受 JSON 字符串或对象并规范化为版本 1。创建配方时模板规则复制到配方，后续模板修改不反写已有配方。空值表示 `legacy_open`，用于兼容历史数据。

## 7. 常用配置预设（历史路径 Model Variants）

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/model-variants` | 无 | 常用配置预设列表，标准字段含 `id/createdAt/updatedAt`；路径、`modelVariantId/modelName` 字段和 capability ID 作为历史兼容标识保留 |
| `POST` | `/api/model-variants` | `modelName, templateId` 必填；可带线圈、机筒、长螺丝、叶轮字段、`customFieldsJson` 和 `idempotencyKey?`；精确线圈片数用 `coilId`，非精确片数用 `coilSchemeFamilyCode`；推荐请求头 `Idempotency-Key` | 能力 `model_variants.create`。新增常用配置预设；线圈选择按精确方案或插值/外推系列持久化。若模板含长螺丝且预设有机筒长度，会按参数化螺丝公式自动补齐对应长度的螺丝零件。常用配置预设、自动生成零件、operation 和全部强审计同一事务提交；历史顶层字段及响应顶层 `createdLongScrewParts` 保持兼容 |
| `PATCH` | `/api/model-variants/:id` | 同新增字段，另带 `expectedUpdatedAt?`, `idempotencyKey?`；推荐请求头 `Idempotency-Key` | 能力 `model_variants.update`。更新常用配置预设并校验、持久化精确 `coilId` 或非精确 `coilSchemeFamilyCode`，同时可能沉淀新的长螺丝规格；新调用绑定资源版本，旧无版本请求兼容执行并返回 warning；历史兼容字段与 `createdLongScrewParts` 保持兼容 |
| `DELETE` | `/api/model-variants/:id` | `{ expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `model_variants.delete`。按资源版本软删除常用配置，历史配方及其引用 ID 不删除；旧空请求兼容执行并返回缺少版本/重试保护 warning |

## 8. 配方 Recipes

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/recipes` | 可选 query：`keyword`、`hasTechnicalFiles=true/false` | 经纯读 `recipeQueries` 返回配方列表；默认列表和筛选结果均返回 `technicalFileCount`，`keyword` 对成品型号（字段 `name`）和配置摘要（字段 `spec`）做模糊筛选，`hasTechnicalFiles` 按有效技术档案关联筛选。标准字段含 `id/createdAt/updatedAt/customBarrelLength/longScrewExtraLength/configurationPolicyJson` |
| `GET` | `/api/recipes/:id` | 无 | 经纯读 `recipeQueries` 返回单个配方，标准字段含 `id/createdAt/updatedAt/customBarrelLength/longScrewExtraLength/configurationPolicyJson` |
| `POST` | `/api/recipes/model-variant-draft` | `{ modelVariantId }` | 经 `recipeQueries` 根据常用配置和其关联泵壳模板生成配方表单草稿；返回 `recipeDraft, variant, template`，并恢复其 `coilId/coilSchemeFamilyCode`；不写库 |
| `POST` | `/api/recipes/bom-draft` | `{ templateId?, modelVariantId?, useRecipeBaseline?, baseRecipeId?, customBarrelLength?, coilId?, coilSchemeFamilyCode?, coilSpec?, coilSheets?, coilMaterial?, coilSlotType?, coilWireWeight?, packingParts?, optionalParts?, requireStablePartIdentity? }` | 聚合模板、具体线圈方案、正式零件和系统设置并生成标准化 BOM；不写库。HTTP 默认保持独立配置语义；useRecipeBaseline=true 或 baseRecipeId 启用在售配方基准，按同模板及明确线圈参数优先匹配，多个基准返回 409 RECIPE_BASELINE_AMBIGUOUS。继承未指定配置及配方人工费用，只覆盖显式字段；packingParts 按包装角色替换并保留其他辅料，空数组清空包装，qty=0 移除对应角色；optionalParts 显式提供时替换。改变线圈组合不继承旧方案 ID、线重和方案族。configurationBasis 返回基准身份、继承/覆盖字段；无基准时 configurationComplete=false，金额只代表已知配置，pricingComplete 只说明定价完整。响应同时返回 `costPreview`，由 `costEngine` 计算 `currentTotalCost/partsCost/laborCost/pricingComplete/missingParts`。包装和可选零件先绑定正式身份；简称可复用同模板现有配方的唯一一致型号，多候选返回 `409 CONFIGURED_PART_AMBIGUOUS`，未找到返回 `404 CONFIGURED_PART_NOT_FOUND`。精确片数用 `coilId` 绑定具体正式方案；没有精确片数而需要插值或外推时，用 `coilSchemeFamilyCode` 绑定同一正式计算方案系列。同组合多套正式方案且未指定 ID、也没有唯一默认时返回 `409 COIL_SCHEME_AMBIGUOUS`；跨方案族插值未指定方案系列时返回 `409 COIL_SCHEME_FAMILY_REQUIRED`。`coilSnapshot` 和线圈 BOM 行返回稳定方案及计价字段；浮球/电缆未显式给线径时可使用已绑定线圈的正式默认搭配线径。全部 BOM 行继续返回 `snapshotPrice`，计算来源使用 `formula/costSource/source`，不得由页面或 AI 另算。 |
| `POST` | `/api/recipes/cost-draft` | `{ parts, assemblyWage?, packingWage?, surfaceTreatmentMode?, surfaceTreatmentCost?, managementFee?, coilMaterial?, customBarrelLength?, longScrewExtraLength?, enableLongScrewByBarrelLength? }` | 基于配方草稿生成保存用成本快照；不写库。`enableLongScrewByBarrelLength=false` 时不会把普通固定长螺丝按机筒长度重写。配方正式保存时 `customBarrelLength` 和 `longScrewExtraLength` 都会持久化，重新编辑可恢复原值 |
| `POST` | `/api/recipes/save-payload-draft` | `{ recipeId?, expectedUpdatedAt?, form, costDraft?, packingParts?, optionalParts?, technicalData? }`，`form.configurationPolicyJson?` | `recipes.create/recipes.update` 的正式只读预览兼保存 payload 草稿。精确片数的 `form.coilId` 与非精确片数的 `form.coilSchemeFamilyCode` 分别绑定具体方案和插值/外推系列。服务端规范化配置规则，并根据 `form + templateId/modelVariantId + packingParts/optionalParts` 重新调用权威 BOM 引擎和 `costEngine`，生成带稳定零件身份、`costRole` 和 `configurationDependencies` 的 `partsJson/savedTotalCost/savedCostDetails`；客户端 `costDraft` 仅为兼容输入，其零件、快照价、总成本和说明均不作为事实。新建时未显式传规则则复制模板规则，编辑时未传则保留当前规则。逐项检查 BOM 快照单价，普通目录零件身份缺失或多供应商歧义时返回 422。统一返回 `previewHash/changes/warnings` 和建议幂等键，不写配方、operation 或审计 |
| `GET` | `/api/recipes/:id/inventory-status` | 无 | `recipes.inventory_status`。同一只读事务按 BOM 查询零件/线圈目录库存；返回 `recipe/items/sourceOfTruth`。每项保留 `model/snapshotName`，另返 `currentName/referenceStatus/message`；未核实库存为 null，非库存费用为 not_tracked，不执行生产或扣减 |
| `POST` | `/api/recipes` | 请求头 `Idempotency-Key`；请求体为 `/save-payload-draft` 返回 payload，并携带 `previewHash?` | 能力 `recipes.create`。填写 `coilSpec + coilSheets` 时，精确片数必须提供与组合一致的正式 `coilId`；需要插值或外推的非精确片数必须提供有效 `coilSchemeFamilyCode`。缺少选择分别返回 `409 recipe_coil_selection_required` 或 `409 recipe_coil_scheme_family_required`；BOM 线圈项的具体方案或方案系列也必须与配方绑定一致。`recipeCommands` 再次通过 `costEngine` 固化 BOM/成本快照；配方、自动补齐的参数化长螺丝零件、operation 和强审计同一事务提交。相同请求安全重放，预览篡改、异参复用、未定价 BOM 或审计缺失不会产生部分写入。响应顶层继续提供完整配方字段和旧 `createdLongScrewParts`，同时增加标准回执；旧请求缺少协议字段仍兼容并返回 warnings |
| `PATCH` | `/api/recipes/:id` | 请求头 `Idempotency-Key`；请求体为 `/save-payload-draft` 返回 payload，并携带 `{ expectedUpdatedAt?, previewHash? }`；历史部分字段 PATCH 继续兼容 | 能力 `recipes.update`。保存前合并当前配方快照，再由 `costEngine` 重建权威成本；修改线圈维度时，精确片数必须绑定具体正式 `coilId`，非精确片数必须绑定 `coilSchemeFamilyCode`。历史上尚未绑定且本次完全不触碰线圈字段的部分字段 PATCH 可原样保留，不能借兼容路径更换或猜选方案。版本、预览、异参复用或审计冲突返回 409。配方、参数化长螺丝补齐、规则学习刷新、operation 和强审计在同一事务内执行；响应保持顶层配方字段兼容并增加标准回执。旧请求缺少协议字段仍兼容并返回 warnings |
| `POST` | `/api/recipes/:id/delete-preview` | `{ expectedUpdatedAt? }` | 能力 `recipes.delete` 的正式无副作用 Preview。返回规范目标、当前版本、BOM/保存成本摘要、软删除 change、影响说明、warnings 和 previewHash；不存在或版本漂移 fail-closed，不写业务、operation、审计或业务变更表 |
| `DELETE` | `/api/recipes/:id` | 请求头 `Idempotency-Key`；请求体或 query `{ expectedUpdatedAt? }`，也兼容 `If-Unmodified-Since` | 能力 `recipes.delete`。配方软删除、规则学习刷新、operation 和强审计同一事务提交；相同请求安全重放，版本、异参复用或审计冲突返回 409。Web/AI 传递当前资源版本；旧请求缺少协议字段仍兼容并返回 warnings |
| `GET` | `/api/recipes/:id/technical-files` | 无 | 通过技术档案 Query service 列出配方性能测试报告附件、解析摘要和可信测试曲线；`testCurve` 只从逐条有效测试点生成，包含 `dataBasis=measuredTestPoints`、`pointCount`、单位、`maxHead/maxHeadAtFlow`、`maxFlow/headAtMaxFlow`，以及有对应有效点时返回的 `maxCurrent/maxCurrentAtFlow/maxCurrentAtHead/maxCurrentSequence`、`maxUnitEfficiency/maxUnitEfficiencyAtFlow/maxUnitEfficiencyAtHead/maxUnitEfficiencySequence`。并列极值稳定采用报告中的首个有效测试点。规定点、实测点和偏差不参与极值；历史已解析附件读取时即时生成，无需重新上传。严格只读，不返回文件二进制和完整解析文本 |
| `POST` | `/api/recipes/:id/technical-files` | 请求头 `Idempotency-Key`；`multipart/form-data` 字段 `file`、`expectedUpdatedAt?`，支持 `.xls/.xlsx`，最大 10MB | 能力 `recipes.technical_files.upload`。验证真实文件类型并解析水泵性能报告；统一文件对象、配方附件、operation 和强审计同一事务提交。相同幂等键安全重放，同一配方重复上传相同 SHA-256 返回现有附件；版本或审计冲突不留下部分文件。响应继续在顶层返回原附件字段并增加标准回执；旧请求缺少协议字段仍兼容并返回 warnings。规定点、实测点和偏差不进入 API 摘要或知识检索文本 |
| `GET` | `/api/recipes/:id/technical-files/:fileId/download` | 无 | 通过技术档案 Query service 下载原始测试报告；优先读取统一文件对象，兼容历史附件 BLOB |
| `DELETE` | `/api/recipes/:id/technical-files/:fileId` | 请求头 `Idempotency-Key`；请求体 `{ expectedUpdatedAt? }` | 能力 `recipes.technical_files.delete`。软删除附件关联，不删除可能被其他业务引用的统一文件对象；附件、operation 和强审计同一事务提交，相同请求安全重放，版本或审计冲突返回 409。变更自动触发现有知识派生同步；旧请求仍兼容并返回 warnings |
| `GET` | `/api/recipes/:id/cost` | 无 | 经 `costQueries` 读取正式配方并委托 `costEngine` 重算当前配件参考；不是保存成本，也不是完整总成本 |
| `GET` | `/api/recipes/current-costs` | 无 | 经 `costQueries` 批量返回所有配方的当日完整成本；先按配方参数和当前泵壳模板完整重建 BOM，再由成本引擎按当前零件库价格、全局动态配置和当前线圈数据重算，并叠加配方人工、表面处理与管理费。响应顶层返回 `asOf/sourceOfTruth=costEngine/basis=currentTemplateAndRecipeParameters`；每项返回 `costComplete/warnings/missingParts`。单条配方因历史线圈方案未明确等原因无法重算时，该项返回 `calculationError { code, message, details? }`、`costComplete=false` 和空正式金额，其他配方仍正常返回，列表不得因一条 enrichment 失败而整体消失。存在未定价项目时 `currentTotalCost/partsCost/difference` 为 `null`，只保留明确标记为诊断用途的 `partialPartsCost/partialTotalCost`，禁止把缺失项按 ¥0 形成正式成本。成品电缆当前成本同样必须取得当前电缆目录价；历史快照不能掩盖当前目录缺价 |
| `POST` | `/api/recipes/:id/cost-preview` | `{ overrides: { coilId?, coilSpec?, coilSheets?, coilMaterial?, coilSlotType?, ... } }` | 报价和直接建单共用的客户配置试算。线圈覆盖应以具体 `coilId` 锁定方案，并校验组合字段一致；最终 `configurationSnapshot` 保存 `coilId`。其余配置白名单、包装、表面处理、不锈钢接轴和成本权威规则不变；线圈无法唯一计价时明确失败，不按记录顺序猜测 |

库存引用规则：普通件复用 `bomPartIdentity.resolveSavedCatalogPartIdentity`，使用配方已保存的 partId 读取目录现名和库存，弃用旧名称不再作为匹配条件；明确 partId 不回退；名称-only 必须唯一命中，并尊重明确供应商。线圈按 BOM coilId、配方 coilId、最后无 ID 的精确规格唯一候选/唯一默认顺序解析，明确失效 ID 不回退。`referenceStatus` 为 resolved/resolved_legacy/missing/ambiguous/inactive/invalid_id/identity_mismatch/invalid_reference/invalid_stock/not_tracked；`status` 为 in_stock/out_of_stock/missing/needs_review/not_tracked，`inventoryType` 为 part/coil/none。身份异常返回 currentStock:null；明确供应商与 ID 对应目录不符时标记 identity_mismatch。读取成功只表示查到对应目录库存，不证明实物规格一致或授权采购入库；新写入仍严格检查 ID 与名称。加工费、未绑定外包装估算及显式非库存行不显示缺货。损坏 BOM 返回422，超过10000行返回413；普通读取不修复快照。

配方列表、详情、库存状态、常用配置预设草稿（历史路径 Model Variant）和 BOM 草稿的数据库聚合统一在 `recipeQueries`。BOM 规则仍只由 `recipeBomEngine` 展开，正式保存成本仍只由 `costEngine` 重建；Query/Preview 不写配方、库存、operation、审计或知识索引。

`configurationPolicyJson` 版本 1 结构为 `{ version: 1, fields?, packingPartIds?, surfaceTreatmentOptions? }`。`fields` 可包含 `hasFloat/floatWire/floatAccessoryType/hasCable/cableLength/cableWire/cableAccessoryType/coilSpec/coilSheets/coilMaterial/coilSlotType/customBarrelLength` 的允许值数组；`packingPartIds` 是稳定正整数零件 ID 数组；`surfaceTreatmentOptions` 是 `{ mode, cost }[]`。未知键、未知字段、重复工艺或无效类型返回稳定的 `RECIPE_CONFIGURATION_POLICY_*` 400 错误；单个列表最多 100 项。

BOM 快照角色为 `fixed/shell/barrelLength/stainlessShellBundle/longScrew/capacitor/coil/float/cable/packing/rotorProcess`。`configurationDependencies` 记录该行受哪些配置字段影响：机筒及长螺丝依赖 `customBarrelLength`，线圈和电容依赖线圈规格/片数/材质/槽眼，浮球、电缆和包装分别依赖各自配置字段；`rotorProcess` 依赖 `hasStainlessShaftJoint/stainlessShaftJointCost`，属于生产工艺要求和成本行，不是零件或线圈库存物料，不进入采购计划。它们是服务端生成的快照元数据，调用方不得自行指定来改变正式成本。

## 9. 成本 Cost

### 9.1 成本入口

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/cost/parts` | `{ parts: [{ model, supplier?, qty?, snapshotPrice? }] }` | 经 `costQueries` 委托 `costEngine` 按配件数组计算成本、缺失项和明细；不自动叠加配方工资/管理费 |
| `POST` | `/api/cost/full-estimate` | `{ recipeId? | recipeName?, stator?, statorMaterial?/material?, cableLength?, hasFloat?, floatWire?, cableWire?, floatAccessoryType?, cableAccessoryType?, boxType?, packingPartsJson? }` | AI/N8N 的已有配方兼容成本入口；`recipeId/recipeName` 至少提供一个，名称只允许唯一匹配正式配方。输入统一转换为配方配置覆盖，并由角色感知成本预览替换原线圈、电容、浮球、电缆和包装后计价一次；成功返回 `sourceOfTruth=costEngine/costBasis=currentFullCost|overridePreview`，并为旧调用方保留从最终线圈 BOM 行派生的 `statorCost` 参考明细，但总成本包含完整配方费用，不能等同于 `statorCost`。未找到、匹配多条或把泵壳模板名当配方名时整体返回 4xx。兼容字段 ~~`pumphousing_model`~~ 仅在 route adapter 中按 `recipeName` 读取一个周期；模板临时成品配置使用 `POST /api/recipes/bom-draft`，仅泵壳本体长度试算使用 `preview_pump_shell_cost`。 |
| `POST` | `/api/cost/recipe-difference` | `{ leftRecipeId?/leftRecipeName?, rightRecipeId?/rightRecipeName?, limit? }` | 经 `costQueries` 和 `costDifference` 比较两个正式配方的当日完整成本；名称片段只允许唯一匹配，多条命中返回 `409 RECIPE_SELECTOR_AMBIGUOUS`。成本统一按当前模板/BOM、线圈和零件价格计算，并包含安装工资、打包工资、表面处理和管理费；返回 `sourceOfTruth=costEngine/costBasis=currentFullCost`、双方配件/人工小计、总差额和主要差异驱动项。任一配方存在未定价 BOM 时返回 `422 RECIPE_COST_INCOMPLETE`，禁止按 0 元形成正式对比；不写库 |

配方域的常用配置预设草稿（历史路径 Model Variant）、成本草稿、保存 payload、当前成本和覆盖试算接口统一登记在第 8 节，本节不重复维护同一 Method + Path。

### 9.2 拆分估算入口

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/cost/coil` | 同 `/api/coils/calculate` | 经 `costQueries` 委托 `coilCost` 的线圈成本兼容入口，不再复用另一个 route handler |
| `POST` | `/api/cost/float` | `floatWire?, floatAccessoryType?` 等 | 经 `costQueries` 和 `dynamicConfigCost` 单独估算浮球成本 |
| `POST` | `/api/cost/cable` | `{ cableLength|length, cableWire|wire?, model?, supplier?, cableAccessoryType? }` | 经 `costQueries` 委托 `costEngine` 单独估算完整成品电缆；`cableLength` 必须为正数、型号必须有有效目录价、配件类型只能是 `standard/xinjie`，否则返回 `400/422 + CABLE_*`。返回 `cableSubtotal/accessoryName/accessoryFee/totalCost` 以及 `cablePriceSource/cableAccessorySource/formulaVersion` |
| `POST` | `/api/cost/packing` | `packingParts?/packingPartsJson?/boxType?` 等 | 经 `costQueries` 委托 `costEngine` 单独估算包装材料成本 |
| `POST` | `/api/cost/overhead` | `{ assemblyWage?, packingWage?, surfaceTreatmentCost?, managementFee? }` | 经 `costQueries` 委托 `costEngine` 汇总人工工资、表面处理和管理费 |
| `POST` | `/api/cost/dynamic` | `{ stator?/statorSpec?/statorSheets?, hasFloat?, floatWire?, hasCable?, cableWire?, cableLength?, boxType?, ...AccessoryType }` | 经 `costQueries` 和 `dynamicConfigCost` 编排浮球、成品电缆、包材；成品电缆复用 `costEngine` 的统一计价、配置来源和校验，明细不拆成两个 BOM 项，但保留线材长度、每米价、配件费及来源字段 |

### 9.3 查询和市场指标

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/cost/recipe/by-name?name=xxx` | `name` 查询参数 | 兼容入口；经 `costQueries` 按名称包含关系查正式配方并委托 `costEngine` 计算配件成本 |
| `GET` | `/api/copper-price` | 无 | 只读查询实时铜价和数据库已采用的线圈铜价基数；返回 `source/sourceOfTruth/asOf`，不写库 |
| `POST` | `/api/copper-price/update` | 推荐请求头 `Idempotency-Key` | 维护能力 `market.sync_copper_price`。先在 SQLite 事务外读取外部铜价，再只更新 `calculated` 模式中铜价基数或成本发生变化的线圈；`kit` 模式保持不变。线圈、operation 和逐项强审计同一事务，返回兼容字段 `updatedCount/skippedCount/unchanged` 及标准回执 |
| `GET` | `/api/market-indicators` | 无 | 只读查询铜价、铝价、美元兑人民币汇率的实时值与数据库已采用值；返回 `sources/sourceOfTruth/asOf`，不写库 |
| `POST` | `/api/market-indicators/update` | 推荐请求头 `Idempotency-Key` | 维护能力 `market.sync_indicators`。行情在事务外并行获取，只更新 `calculated` 线圈的铜价/成本并保持 `kit` 的 `kitPrice/cost` 不变；随后与铝线价格基数、美元汇率、operation 及全部强审计在同一 SQLite 事务原子提交；同键重试返回首次行情快照和回执，不重复写库 |

成本 HTTP 层统一由 `costQueries` 承接正式数据读取和只读场景编排，路由只负责参数、日志和响应。`costQueries` 不保存成本或修改数据库，也不定义新公式：配件/包装/人工仍由 `costEngine`，线圈由 `coilCost`，动态项由 `dynamicConfigCost`，报价覆盖由 `dynamicCostPreview`，当日完整成本与差异解释分别由 `currentRecipeCost` 和 `costDifference` 计算。

两项市场同步都是显式 maintenance，不开放 AI 写工具。网页按钮属于明确同步动作；启动补跑在每次 API 进程启动时执行并在当前进程内幂等，每日 15:00 BJT 调度使用“触发类型 + 北京日期”幂等窗口。此类能力不提供 Preview/确认弹窗：Preview 后再次抓取的行情可能已经变化，不能作为可执行快照；替代保护为外部请求超时/有限重试、`502 market_data_unavailable`、事务外抓取、执行时快照、90 天持久幂等、原子提交、逐项强审计和标准 operation receipt。相同幂等键表达“同步当时可用行情”这一意图，因此重放只返回第一次已提交结果。

## 10. 客户与报价

### Customers

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/customers` | 查询参数 `id?`, `name?`, `limit?`（1–100） | 正式能力 `customers.list`；ID 精确、名称模糊筛选，无 `limit` 时返回全部客户 |
| `GET` | `/api/customers/:id/context` | 查询参数 `keyword?`, `historyType?=all/quotation/order`, `limit?`（1–50） | 正式能力 `customers.history`；从实时 `customers/quotations/orders` 聚合客户历史。`historyType=quotation` 只返回报价，`order` 只返回订单，默认 `all` 返回两者；只读取所选范围并在 `sourceOfTruth` 中如实标记，避免无关完整订单或报价明细挤占 AI 上下文。报价按创建时间排列且使用连续 `displaySequence`。无 `limit` 时返回所选范围全部记录，明确“最近/前 N 份”才限制数量；可按配方/型号关键词筛选。响应含 `summary/query/sourceOfTruth/asOf/provenance`，不读取知识条目、不计算成本且不写库 |
| `POST` | `/api/customers` | 请求头 `Idempotency-Key`；`{ name, contactInfo?, defaultMargin?, remark? }` | `customers.create`；客户名称唯一，默认利润率必须非负；客户、operation 与强审计同一事务。同键同参重试返回原客户，旧请求仍兼容 |
| `PATCH` | `/api/customers/:id` | 请求头 `Idempotency-Key`；客户字段及 `{ expectedUpdatedAt? }` | `customers.update`；支持部分字段更新，使用资源版本阻止并发覆盖；客户、operation 与强审计同一事务。旧请求仍兼容并返回缺失保护 warning |
| `DELETE` | `/api/customers/:id` | 请求头 `Idempotency-Key`；`{ expectedUpdatedAt? }` | `customers.delete`；存在活动订单时返回 409，防止正式归属失效；只有历史订单或报价时允许软删除并在回执给出关系保留 warning，不级联删除历史事实。使用资源版本、持久幂等和强审计 |

### Quotations

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/quotations` | 查询参数 `status?`, `customerName?`, `limit?`（1–100） | 正式能力 `quotations.list`；按报价状态精确筛选、按客户名称模糊筛选并按最新报价排序。无参数时兼容返回全部报价；只读且不会因页面、AI 或监控查询而更新状态 |
| `GET` | `/api/quotations/:id` | 无 | 正式能力 `quotations.detail`；返回指定报价的完整正式资源并附加客户名称，包含全部 `itemsJson`、成本售价、备注、转换订单信息和时间字段。非法 ID 返回 400，不存在返回 404。Query 严格只读，事实来源 `customers + quotations`，风险 low，天然幂等、无并发/事务/审计要求，默认超时 15 秒；Web、AI 和内部调用共用 |
| `POST` | `/api/quotations/save-payload-draft` | `{ customerId, status?, items|itemsJson, remark?, attachmentFileIds?, attachmentSummary?, attachmentSourceFileIds? }`；明细可含 `overrides`，`qty` 可省略或为 `null`，附件最多 20 个，摘要依据最多 4 个且必须属于本次附件 | `quotations.create/update` 的正式只读预览。后端按每个有效 `baseRecipeId` 通过共享客户配置快照服务先校验配方配置范围，再调用权威成本逻辑；报价明细保存 `overrides/configurationSnapshot/warnings`、单位成本、销售单价、`bomSnapshot/costSnapshot`。客户包材覆盖只接受稳定 `partId`、型号、供应商、数量和展示语义，忽略请求中的快照价并按正式目录重新定价；身份歧义或规则外配置返回 422。只有全部明细数量均为正数时才返回数值型总额，否则保持 `null` 并返回数量待确认 warning。返回规范化附件字段、`previewHash` 和建议幂等键；不信任前端成本且不写库 |
| `POST` | `/api/quotations/inquiry-summary-draft` | `{ fileIds: number[1..4], customerName? }` | 正式只读能力 `quotations.inquiry_summary_draft`。校验统一文件库中的原始附件后强制使用现有 Kimi 开放平台配置：图片以原图进入多模态模型，PDF、Word、Excel、CSV 和文本通过 Kimi 文件抽取接口读取；不经过通用 AI 意图规划，不使用本地 OCR 作为询价摘要来源，也不静默回退 DeepSeek。返回 `{ preview, summaryText, sourceFileIds, provider: "kimi", model, sourceMode: "original_attachments", warnings }`，不写报价、文件、operation 或审计；Kimi 不可用时返回 502/503 |
| `POST` | `/api/quotations` | 请求头 `Idempotency-Key`；请求体使用上述完整草稿并带 `previewHash` | `quotations.create`；新建页面可先上传客户询价文件并生成 AI 要求摘要。保存时事务内重新试算并复核附件，同时创建报价、关联 `quotation_source` 原始附件、保存摘要、operation 与强审计；同键同参重试不重复建单或关联。附件与摘要不参与成本和价格计算 |
| `GET` | `/api/quotations/:id/inquiry-summary` | 无 | 正式只读能力 `quotations.inquiry_summary`；返回随报价保存的 `quotation_source` 附件、下载地址、询价摘要及最多 4 个摘要来源 ID。不存在摘要时仍返回报价和附件上下文；不写库、不重新归纳，也不提供建单后的上传或编辑入口 |
| `PATCH` | `/api/quotations/:id` | 请求头 `Idempotency-Key`；核心明细使用保存草稿并带 `{ expectedUpdatedAt?, previewHash? }`；仅备注更新可不带明细 | `quotations.update`；只有“草稿”或“报价中”允许更新核心明细。事务内校验资源版本、重新试算并强审计；旧请求仍兼容并返回缺失保护 warning |
| `POST` | `/api/quotations/:id/status` | 请求头 `Idempotency-Key`；`{ status, expectedUpdatedAt? }` | `quotations.change_status`；按 `草稿 → 报价中 → 已接受 → 已转订单` 状态机流转，报价中也可进入已拒绝/已过时，终态不能恢复；版本、幂等、operation 与强审计在同一事务 |
| `DELETE` | `/api/quotations/:id` | 请求头 `Idempotency-Key`；`{ expectedUpdatedAt? }` | `quotations.delete`；只有草稿、已拒绝或已过时报价允许软删除；版本、幂等、operation 与强审计在同一事务 |
| `POST` | `/api/quotations/:id/order-draft` | `{ itemQuantities?: [{ quotationItemId, qty }] }`，最多 100 项，数量必须为正整数 | 从报价单价及已展开的配置、BOM 和成本快照生成订单预览、采购清单和待办，原样保留 `configurationOverrides/configurationSnapshot/configurationWarnings` 供订单追溯。所有即将写入新订单的普通 BOM 项统一补齐稳定 `partId`，只补身份、不改报价锁定价格；历史快照无法按型号和供应商唯一绑定时返回 422，不能生成新的无身份订单。报价明细没有保存数量时必须通过 `itemQuantities` 补齐；缺失返回 `422 quotation_item_quantity_required`，重复、未知明细或无效数量返回 400。响应回传规范化 `itemQuantities`、`capabilityId`、报价 `expectedUpdatedAt`、确认内容 `previewHash` 和一次性建议 `suggestedIdempotencyKey`。`previewHash` 绑定最终数量及正式订单/BOM/采购/待办语义；旧报价缺少快照时临时回退配方 BOM 并标记 `legacy_recipe_fallback`；不写库 |
| `POST` | `/api/quotations/:id/convert` | 请求头 `Idempotency-Key`；请求体 `{ expectedUpdatedAt?, previewHash?, itemQuantities? }` | 只有“已接受”报价可转单；最终数量必须与订单草稿一致并进入持久幂等请求和预览哈希。执行前按相同数量重算草稿，报价版本、数量或采购平衡事实改变时要求重新预览。在同一事务内创建订单、更新报价、保存 operation 回执并写两条强审计。相同主体、能力、幂等键和请求返回原回执；异参复用、资源版本、预览、重复或越级冲突返回 409。历史报价已保存有效数量时，旧调用不传 `itemQuantities` 仍兼容 |

报价保存命令不会信任请求中的 `totalCost/totalPrice/unitCost/bomSnapshot/costSnapshot`：`quotationDraft` 会再次从正式客户、配方和成本服务生成快照。报价阶段数量是可选业务事实；未确认时 `itemsJson.qty/totalPrice` 与报价顶层 `totalCost/totalPrice` 保存为 `null`，列表和统计不得按 0 或 1 计入总金额。预览哈希排除条目展示 ID 和生成时间等非业务字段，因此相同草稿的网络重试稳定；报价配置、成本或业务输入变化会导致旧预览被拒绝。成功响应在原报价字段之外增加标准 operation receipt，旧页面依赖的报价字段保持兼容。

不锈钢接轴在报价保存时会把启用状态、最终费用和 `rotorShaftProcess=stainless_friction_weld` 一并冻结到配置与成本快照，并生成 `rotorProcess` 非库存工艺 BOM 行。报价转订单原样继承这些事实，不按转换时的全局默认重算；该工艺行不要求 `partId`，也不进入采购清单。

报价超过一个月自动过期已从 GET 路由迁移到 `quotationExpiry` maintenance service。API 启动时先补跑一次，之后每天北京时间 00:05 执行；维护只把有效且仍为“报价中”、`createdAt` 不晚于一个月前的记录改为“已过时”。同一轮更新位于一个 SQLite 事务内，逐条使用 `safeUpdate` 写审计，并记录 `operationId/startedAt/completedAt/expiredCount/changes`。当前不新增公开维护端点。

## 11. 订单 Orders

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/orders` | 可选 query：`limit`、`status`、`customerName`、`contractNo` | 经 `orderQueries` 返回只读订单列表；支持状态精确筛选、客户/合同号模糊筛选和最多 100 条限制。按创建顺序平衡全部活动订单的库存占用并在响应中返回实时采购缺口及采购参考价，同一库存不会被多个订单重复使用，但不写回订单快照 |
| `GET` | `/api/orders/purchase-overview` | query `{ limit?, supplier?, pendingOnly? }` | 经 `orderQueries` 聚合当前活动订单的采购任务；支持供应商模糊筛选、只看待采购任务和最多 100 条限制，返回筛选后汇总、`filters`、`returnedCount/truncated` 及按待采购优先排列的任务明细。严格只读，不修改采购计划、订单或库存 |
| `GET` | `/api/orders/lookup` | `query=订单ID/客户名称/合同号` | 经 `orderQueries` 只读查找订单候选，不刷新采购计划；AI 按客户或合同解析订单时使用 |
| `GET` | `/api/orders/readiness-overview` | 无 | 经 `orderQueries` 一次计算全部活动订单的库存平衡和生产准备结论；返回分类汇总、主要问题、缺料和第一个未阻塞处理步骤，只读不写库 |
| `GET` | `/api/orders/:id` | 无 | 经 `orderQueries` 只读返回单个订单，标准字段含 `id/createdAt/updatedAt`；采购清单按全部活动订单实时平衡后仅覆盖响应视图，不改变数据库及 `updatedAt` |
| `GET` | `/api/orders/:id/knowledge-package` | 无 | V10.4 只读订单知识包；合并实时订单、采购、待办、生产准备和处理方案，以及人工确认的客户要求、执行事实和来源文件；排除未确认草稿。AI 执行单订单详情、生产准备或处理方案查询时，由能力注册表自动以同一订单目标伴随调用；无确认知识时不扩写回答，有相关记录时只提取与当前问题有关的资料，读取失败时不得作“没有异常”等否定结论 |
| `GET` | `/api/orders/:id/requirements` | 无 | 读取客户要求草稿、最后确认版本、知识状态和当前订单附件；只读 |
| `PUT` | `/api/orders/:id/requirements/draft` | 请求头 `Idempotency-Key`；`{ summaryText, sourceFileIds?, expectedUpdatedAt? }` | `orders.requirements.save_draft`；保存可编辑草稿，来源文件必须已有效关联当前订单，不进入知识库。草稿、operation 与强审计原子提交；旧调用兼容并返回缺少幂等或版本保护 warning |
| `POST` | `/api/orders/:id/requirements/confirm` | 请求头 `Idempotency-Key`；`{ summaryText?, sourceFileIds?, expectedUpdatedAt? }` | `orders.requirements.confirm`；原子保存并人工确认当前版本，确认内容自动合并到该订单知识条目；不修改订单明细、配方、采购或库存。确认快照、operation 与强审计同一事务 |
| `POST` | `/api/orders/:id/requirements/revoke` | 请求头 `Idempotency-Key`；`{ expectedUpdatedAt? }` | `orders.requirements.revoke`；撤销知识确认并保留草稿与原文件；订单知识自动移除已确认客户要求。版本、持久幂等、operation 与强审计同一事务 |
| `GET` | `/api/orders/:id/execution-records` | 无 | 读取订单执行事实时间线、草稿/确认状态和当前订单附件；只读 |
| `POST` | `/api/orders/:id/execution-records` | 请求头 `Idempotency-Key`；`{ phase, recordType, title?, summaryText, occurredAt?, sourceFileIds? }` | `orders.execution_records.create_draft`；新建执行事实草稿，阶段和事实类型必须匹配，不进入知识库；草稿、operation 与强审计原子提交 |
| `PUT` | `/api/orders/:id/execution-records/:recordId/draft` | 请求头 `Idempotency-Key`；同新建入参并带 `expectedUpdatedAt?` | `orders.execution_records.update_draft`；修改当前草稿；已有确认版本时保留上一次正式知识，直到重新确认。旧调用兼容并返回保护缺失 warning |
| `POST` | `/api/orders/:id/execution-records/:recordId/confirm` | 请求头 `Idempotency-Key`；可传完整草稿字段及 `expectedUpdatedAt?`，或只传版本确认已保存草稿 | `orders.execution_records.confirm`；可选草稿更新、确认快照、operation 与逐项强审计原子提交；不修改订单状态、配方、采购或库存 |
| `POST` | `/api/orders/:id/execution-records/:recordId/revoke` | 请求头 `Idempotency-Key`；`{ expectedUpdatedAt? }` | `orders.execution_records.revoke`；撤销该事实的知识确认，保留当前草稿和附件；版本、operation 与强审计同一事务 |
| `DELETE` | `/api/orders/:id/execution-records/:recordId` | 请求头 `Idempotency-Key`；`{ expectedUpdatedAt? }` | `orders.execution_records.delete`；软删除未确认草稿并返回标准回执；已确认记录必须先撤销确认，删除、operation 与强审计同一事务 |
| `GET` | `/api/orders/:id/readiness` | 无 | 经 `orderQueries` 编排只读生产准备检查；按订单状态、配方与BOM、零件库存、线圈库存、采购进度、成本与价格六步返回 `ready/waiting_materials/needs_review/blocked/not_applicable`，不写订单和库存 |
| `GET` | `/api/orders/:id/readiness-plan` | 无 | `orders.execute_readiness_action` 的正式只读预览；基于实时生产准备结果生成处理步骤，并为可执行白名单步骤返回 `command/actions` 中的 `expectedUpdatedAt/previewHash/suggestedIdempotencyKey`，只生成方案不执行 |
| `POST` | `/api/orders/:id/readiness-actions/:actionId` | 请求头建议 `Idempotency-Key`；路径动作仅支持 `confirm_order/generate_purchase_plan`；标准请求体 `{ expectedUpdatedAt, previewHash, idempotencyKey? }` | `orders.execute_readiness_action` 正式命令；事务内重新生成实时检查和方案，仅执行仍为 `confirmable + available` 的步骤。订单/库存/采购事实或版本漂移、步骤已完成/受阻时返回 `409`；订单、operation 和强审计原子提交，相同请求安全重放。旧空请求仍兼容，但回执会标记缺少版本、预览绑定或幂等保护 |
| `GET` | `/api/orders/history-price/:recipeName` | 路径参数 `recipeName` | 经 `orderQueries` 查该配方最近历史售价和利润率；历史坏 JSON 会跳过，不作为事实返回 |
| `POST` | `/api/orders/purchase-plan` | `{ items: [{ partsJson, qty }] }` | 按订单明细生成采购清单和供应商待办；“外包装估算”等成本占位项不进入正式采购；不写库 |
| `POST` | `/api/orders/save-payload-draft` | 新建：`{ customerId?, customerName?, contractNo?, remark?, items: [{ id?, recipeId, qty, profitMargin?, unitPrice?, pricingMode?, configurationOverrides? }] }`；编辑另传 `{ orderId, editReason }` | `orders.create/update_draft` 的正式只读预览兼保存 payload 草稿。新增调用提交稳定 `customerId`。编辑仅允许“待确认”，或采购项 `orderedQty/receivedQty/stockedQty` 全为 0 的“待采购”订单，并强制填写不超过 500 字的修改原因。每个产品必须引用有效配方；未改变客户配置时保留订单原有锁定成本、BOM 和配置快照，避免配方后续变化回写历史订单；明确改变配置时通过共享 `configuredRecipeSnapshot + costEngine` 重新生成最终配置、成本和 BOM。手工售价通过 `pricingMode=manual` 保持固定并重算利润率。服务端把当前订单从活动订单平衡中替换为草稿后重建采购计划，避免重复占用库存；客户端成本、BOM、采购清单和待办不作为事实。返回 `preview=true`、`changes/warnings`、`previewHash` 和建议幂等键，不写订单、operation、修订或审计；售价低于成本返回 warning 但允许人工确认 |
| `GET` | `/api/orders/:id/revisions` | 无 | 能力 `orders.revisions.list`；按修订号倒序返回修改原因、时间、操作者标签、修改前后完整业务快照和结构化变化摘要。严格只读，不返回原始鉴权身份 |
| `POST` | `/api/orders/purchase-items/batch-draft` | 单任务：`{ identityKey?, model, supplier?, purchased }`；同供应商多任务：`{ supplier, purchased, tasks: [{ identityKey?, model, supplier? }] }`，`tasks` 为 1–50 项、不得重复或混入其他供应商 | 只读重算全部活动订单平衡计划；单任务继续返回 `task`，统一返回规范化 `tasks`、逐订单逐物料 `affectedItems`、去重后的受影响订单、各订单版本、下单数量变化、`previewHash` 和建议幂等键；不写库 |
| `POST` | `/api/orders/purchase-items/batch` | 请求头 `Idempotency-Key`；请求体为草稿入参并增加 `{ expectedVersions?, previewHash? }` | 按一个采购规格跨订单整项下单/取消，或把同一供应商最多 50 种物料一次原子下单/取消；活动订单平衡快照、全部目标物料、受影响订单、operation 和强审计同一事务提交，禁止半批成功。相同请求安全重放，任务集合、订单集合、版本、预览、幂等参数或审计变化返回 409。旧单任务调用及不传协议字段的兼容行为保留，后者返回 warnings |
| `POST` | `/api/orders/:id/status-draft` | 请求体 `{ status, reason?, inventoryDisposition?, inventoryDispositionNote? }` | 能力 `orders.change_status` 的无写入预览；返回 `expectedUpdatedAt/previewHash/suggestedIdempotencyKey/changes/deductions`。关闭并领用时按订单冻结 BOM 汇总零件与正式线圈的扣减数量、当前库存和扣减后库存；库存不足或身份缺失时拒绝生成确认预览 |
| `POST` | `/api/orders/:id/status` | 请求头 `Idempotency-Key`；请求体 `{ status, reason?, expectedUpdatedAt?, previewHash?, inventoryDisposition?, inventoryDispositionNote? }` | 能力 `orders.change_status`；人工动作只允许确认订单、关闭订单或取消订单。取消必须填写原因；关闭必须明确 `inventoryDisposition=order_outbound_deducted/reservation_released`，释放预留还必须填写 `inventoryDispositionNote`。前者按冻结 BOM 扣减完整生产用量，后者不扣库存；历史输入 `manual_outbound_confirmed` 兼容归一为自动扣库。库存、线圈流水、订单、operation 和强审计同一事务提交，库存不足、版本或预览漂移整体回滚。确认订单时重算全部活动订单采购计划；采购中/采购完成继续由数量自动推导 |
| `POST` | `/api/orders/:id/purchase-items/progress-draft` | `{ identityKey?, model, supplier?, orderedQty, receivedQty, stockedQty, purchasePrice?, actualSupplier?, allowOverPurchase? }` | 只读重算活动订单平衡计划，校验 `入库 ≤ 到货 ≤ 下单` 与库存映射，返回变更前后数量、库存影响、`expectedUpdatedAt/previewHash/suggestedIdempotencyKey`；不写订单、库存、operation 或审计 |
| `POST` | `/api/orders/:id/purchase-items/progress` | 请求头 `Idempotency-Key`；请求体为草稿入参并增加 `{ expectedUpdatedAt?, previewHash? }` | 保存单项采购进度；入库增量、其他活动订单平衡快照、当前订单、operation 回执和强审计同一事务提交。相同请求安全重放，版本、确认预览、异参复用或审计冲突返回 409。旧调用不传协议字段仍兼容，但响应 warnings 会说明保护缺失 |
| `POST` | `/api/orders/:id/purchase-items/toggle` | `{ model, supplier?, purchased? }` | 旧客户端兼容动作；由 `purchasingItemProgress` 在 service 内按当前正式采购项映射为整项下单/取消下单，再委托 `purchasing.order.item_progress` command；已有到货或入库时不能取消，旧响应仍只返回订单 |
| `POST` | `/api/orders/:id/todos/toggle` | 请求头建议 `Idempotency-Key`；`{ todoId, done?, expectedUpdatedAt?, idempotencyKey? }` | `orders.todos.toggle` 正式命令；切换或设置指定采购待办，订单、operation 和强审计同一事务提交。相同请求安全重放，版本冲突返回 `409`；重复目标状态或未知待办作为无写入回执返回。响应顶层继续兼容订单字段，旧请求缺少协议字段时返回 warning |
| `POST` | `/api/orders/:id/complete-purchase-draft` | 无 | 只读重算全部活动订单库存平衡，返回本订单待入库的零件、正式线圈和非库存项，以及 `expectedUpdatedAt/previewHash/suggestedIdempotencyKey`；`previewHash` 绑定确认时看到的物料和数量，不写库 |
| `POST` | `/api/orders/:id/complete-purchase` | 请求头 `Idempotency-Key`；请求体 `{ expectedUpdatedAt?, previewHash? }` | 一次性把全部剩余计划登记为已下单、已到货和已入库；普通零件与正式线圈分别增加库存并记录线圈流水，非库存计算项只推进采购进度。库存、其他活动订单平衡快照、订单状态、operation 回执和强审计同一事务提交；相同请求返回原回执，版本、预览、异参复用或重复入库冲突返回 409。旧调用不传新字段仍兼容，但响应 warnings 会说明保护缺失 |
| `POST` | `/api/orders` | 请求头 `Idempotency-Key`；请求体为 `/save-payload-draft` 返回 payload，并携带 `previewHash?` | 能力 `orders.create`；新增订单固定进入“待确认”。订单、operation 回执和强审计同一事务提交；相同请求安全重放，预览篡改、异参复用或审计缺失整体回滚。为保持现有页面兼容，响应顶层继续提供完整订单字段，同时增加 `order`、`operationStatus` 和标准回执字段；旧请求不传协议字段仍兼容并返回 warnings |
| `PATCH` | `/api/orders/:id` | 请求头 `Idempotency-Key`；请求体为编辑 `/save-payload-draft` 返回 payload，并携带 `{ editReason, expectedUpdatedAt?, previewHash? }` | 能力 `orders.update_draft`；允许“待确认”和零采购进度的“待采购”订单修改客户、合同、备注、产品、数量、客户配置及售价。命令事务内再次重验状态、采购进度、版本和预览；订单、不可变 `order_revisions` 修订、operation 与两条强审计原子提交。采购已下单/到货/入库、预览漂移、异参重放或审计缺失返回 409 且不留下部分更新。响应包含订单、修订、变化摘要和标准回执 |
| `DELETE` | `/api/orders/:id` | 请求头 `Idempotency-Key`；请求体或 query `{ expectedUpdatedAt? }`，也兼容 `If-Unmodified-Since` | 能力 `orders.delete`；只有待确认或已取消订单允许软删除。删除标记、operation 和强审计原子提交，相同请求安全重放，版本、状态、异参复用或审计冲突返回 409；旧调用缺少幂等键/版本仍兼容并返回 warnings |

活动订单的采购名称视图由 `orderPurchasePlanning` 调用 `buildSavedBalancedOrderPlanViews`，在同一只读事务中读取订单、目录和库存。保存的 partId/coilId 用于读取当前名称，采购行 `model` 返回现名、`snapshotName` 保留保存 BOM 中的名称；角色名称不随物料改名替换。采购总览复用该视图，配置身份、原采购行 ID、实际供应商、实际价格和已下单/到货/入库进度保持。浮球与电缆配置不依赖新显示名重新推断。失效 ID、供应商冲突或旧进度无法唯一接续时明确失败，不自动绑定或合并。已关闭/已取消订单使用独立历史名称装配：只替换按 partId/coilId 读取的显示名，不重算计划、价格、库存或进度；保留 `snapshotName`，并返回 `nameReferenceStatus=resolved/inactive/missing/unbound/invalid_reference/not_tracked`。无 ID 不猜测名称匹配，损坏或超过10000行的快照保留原文并返回 `purchaseNameWarning=invalid_snapshot/snapshot_limit_exceeded`。生产准备及写操作仍走严格计划构建，不因 Query 使用现名而放宽校验。

采购项快照字段包括稳定 `id/identityKey` 以及 `plannedQty/orderedQty/receivedQty/stockedQty/purchasePrice/purchasePriceRecorded/referencePrice/referencePriceSource/actualSupplier/orderedAt/receivedAt/stockedAt/stockInHistory/inventoryType`。`purchasePrice` 是人工确认后的实际采购单价；尚未记录时，Web 可把单位一致的零件库 `referencePrice` 作为输入默认值并标明 `part_catalog` 来源，保存后以 `purchasePriceRecorded=true` 锁定实际价格，不得再被参考价覆盖。精确匹配正式线圈方案的线圈转子以该方案每套 `cost`（线圈页面“总成本”）作为参考价：计算计价方案采用当前后端计算结果，供应商套件方案采用与 `kitPrice` 等值的保存成本；两者都标明 `coil_total_cost` 来源，不得使用按片计价的 `unitPrice`。普通零件使用 `inventoryType=part + partId`；精确匹配正式线圈方案的线圈转子使用 `inventoryType=coil + coilId`，按套占用和增加 `coils.stock`；插值或外推产生、没有正式方案的计算型线圈使用 `inventoryType=none`，可完成采购进度但不写库存且不生成线圈参考价。`purchaseUnit/stockQtyPerUnit/specification/cableLength/cableAccessoryType/floatAccessoryType` 保留采购配置，计算型线圈同时保留 `material/slotType`；这些字段区分采购展示单位和底层库存单位。成品电缆按“根”计划，入库时按 `stockQtyPerUnit` 折算为线材米数；历史按米保存的活动订单仅在来源行唯一、每项数量能准确换算为整根且未记录实际采购单价时兼容转换；不能整除或已有实际计价时返回 `PURCHASE_UNIT_MIGRATION_REQUIRED`，不得向上取整。旧 `needToBuy/purchased` 字段继续兼容读取。旧“已完成”订单启动迁移后映射为“已关闭”。

采购计划先按正式 ID 或唯一名称解析物料，再用同一公共身份服务汇总、接续进度和生成总览任务。`identityKey` 是不透明值，调用方必须使用当前查询返回值，不得自行拼接或解析；零件/线圈 ID 与采购单位、库存换算率、电缆长度/接头、浮球接头共同区分采购配置。同一物料的不同配置共享底层库存预留，但保留独立采购行；相同配置的新行 ID 由身份确定，旧行唯一匹配后保留原 `id`、已开始的计划数量、下单/到货/入库数量、实际供应商、价格及入库历史。旧行未记录浮球接头时，只在同一订单冻结 BOM 中物料和配置唯一对应时接续；已有明确类型不得覆盖，多配置不能复用一条旧进度。旧 `identityKey` 不再作为重建匹配依据；按旧字段重新核实，重复候选、旧行被多次使用或已有采购事实无法接续分别返回 `PURCHASE_CONTINUITY_AMBIGUOUS/PURCHASE_CONTINUITY_LOST`（409），不选首行或静默清零。只读装配不写原订单 JSON。

单项进度、旧下单兼容入口和跨订单批量下单都要求目标配置唯一。未传 `identityKey` 时，同名不同配置返回 `PURCHASE_TARGET_AMBIGUOUS`（409）；传入过期键不能回退名称。已有明确零件/线圈 ID 的无效、缺失或停用目标不回退同名物料；ID＋型号不一致仍拒绝，历史显示绑定不能绕过实物身份校验。入库预览和执行共用目标、数量及换算验证，线圈只接受正式方案和整数数量，电缆支持小于1米的正换算率；零增量不写库存。多条成品电缆保留各自配置，含义不明的新旧电缆混合返回 `CABLE_LEGACY_CONFIGURATION_AMBIGUOUS`，不再只保留第一条。


生产准备检查以本轮实时库存为准：`totalQty - currentStock` 才是当前缺口，不能因采购项已经下单或到货就判定可生产。`inventoryType=none` 的计算型线圈、仍含“外包装估算”的订单BOM、没有 `partId` 的普通采购项、缺少BOM快照或未确认订单会形成数据阻塞；库存满足但成本为 0、售价低于成本或来源配方不可追溯时返回待复核。AI 工具 `check_order_readiness` 通过该接口读取结论，匹配多个客户订单时必须要求明确订单ID或合同号。

订单准备总览只读取未关闭且未取消的活动订单，并且每次请求只运行一次 `buildBalancedOrderPlans`，避免逐单重复平衡库存。总览按 `blocked → waiting_materials → needs_review → ready` 排序，`attentionRequired` 是前三类之和。AI 工具 `get_order_readiness_overview` 和管理看板“订单准备”页签使用同一接口，均不属于生产执行或库存写入。

订单列表、详情、候选查找、历史售价与准备度读取统一由纯读 `orderQueries` 编排；其中实时采购清单视图继续由 `orderPurchasePlanning` 生成，准备度事实继续由 `activeOrderReadiness` 计算。Query 不调用持久化函数，只有明确的采购进度、批量下单、采购完成或 `generate_purchase_plan` 等写操作才允许保存采购计划；现有路径、参数和 `purchaseListJson` 响应结构保持兼容。

处理方案状态为 `complete/ready_for_confirmation/action_required/needs_resolution/waiting/not_applicable`。步骤模式 `confirmable` 表示存在可映射的标准写工具，但仍需后续用户确认；`manual` 表示需要人员在业务页面处理，`needs_input` 表示缺少价格等业务决定，`monitor` 表示等待到货等外部状态。存在缺BOM或库存映射等前置问题时，后续确认和采购步骤通过 `dependsOn` 标记为阻塞。AI 工具 `plan_order_readiness_actions` 只读取该接口，不属于 `WRITE_TOOLS`；`execute_order_readiness_action` 属于 `WRITE_TOOLS`。确认后的实时执行计划重验、正式预览读取、动作 API 调用、结果包装和执行历史集中在 `aiOrderReadinessExecution`，订单领域 executor 只委托；正式业务事务仍唯一由 `orderReadinessCommands` 执行。AI service 不访问数据库，且只有取得服务端生成的 `expectedUpdatedAt/previewHash/suggestedIdempotencyKey` 才会调用动作接口。

执行档案与生产准备方案是两类数据：生产准备保存系统实时检查、待办和建议；执行档案只保存已经发生的准备结果、人工决定、过程调整、异常、质量和交付事实。每条执行记录保留独立草稿和最后一次人工确认快照，只有确认快照合并到现有订单知识条目。修改草稿不会覆盖旧知识，重新确认才替换；确认引用的订单附件在撤销或重新确认前不能解除关联。所有接口均属于记录与追溯，不是生产执行模块。

V10.4 订单知识包不新建业务事实，也不依赖知识同步时点。`order/readiness/actionPlan` 每次从实时订单、库存和采购数据重算，`confirmedKnowledge` 只读取最后一次人工确认的客户要求和执行事实；`pendingDraftCount/hasPendingDraft` 只能说明存在待确认变更，响应不会暴露草稿正文作为正式依据。`sourceFiles` 保留 `customer_requirement/execution_evidence` 角色和下载入口，`provenance` 明确区分 `live_business` 与 `human_confirmed`。

订单动作接口不接受客户端提交的状态、采购数量或采购清单，只接受动作 ID 并在服务端映射到现有订单状态和采购计划逻辑。`confirm_order` 使订单离开待确认，并按实时采购数量进度进入待采购、采购中或采购完成；`generate_purchase_plan` 保存本轮实时生成的采购清单，并仅在原待办为空时补充待办。两者都通过安全写入和审计日志，不提供生产确认或自动扣库存能力。

## 12. 业务变更 Business Changes

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/business-changes/revision` | 无 | `business_changes.revision`；认证只读接口，返回 `{revision,sourceOfTruth}`，按已提交事件最大 ID 和 operation 生成不透明版本，空库为 empty；不返回事件正文。`Cache-Control: no-store`。版本变化只用于触发正式资源回读，不能作为写授权。Web 零件/订单/采购页面共用约1秒轮询；隐藏暂停，恢复前台或联网强制回读，版本读取5秒和后台资源读取10秒超时，失败保持待刷新状态并重试；不重置表单草稿 |
| `GET` | `/api/business-changes` | 查询参数 `period?=today/yesterday/last7days/last30days/all`、`from?`、`to?`、`domain?=order/quotation/purchasing/part/recipe/template/coil/customer/model_variant/quality/rotor/settings/file/knowledge/workflow`、`entityType?`、`entityId?`、`eventType?=created/updated/deleted/status_changed/inventory_changed/converted`、`keyword?`、`semanticQuery?`、`beforeId?`、`limit?` | 能力 `business_changes.list`。从追加型结构化事件返回 `items/total/nextCursor/appliedFilters/asOf/provenance`；`period` 按北京时间计算，最大 100 条。精确时间、数量和筛选始终来自事件表；`semanticQuery` 只用知识/向量投影筛选候选，零命中返回空列表，向量或投影不可用时由结构化筛选继续提供正式历史 |

每个已登记正式业务命令最多生成一条事件，即使同一操作修改多个订单、库存或报价；关联对象在 `entities` 中完整列出。空操作、失败事务和幂等重放不新增事件。订单受控修改的 `detailRef` 指向不可变 `order_revisions`，事件不复制订单详情权威。现有订单修订在迁移 67 安全补录；其他领域不从旧审计猜测历史，从本版本上线后开始记录。

AI 只读工具 `search_business_changes` 直接调用本接口，覆盖订单、报价、采购、零件价格/库存、配方、泵壳模板、线圈、客户、常用配置预设（技术类型 `model_variant`）、质量规则、转子档案、业务设置、文件、知识资料和工作流记录，不再为各领域新增独立“修改记录”工具。管理页面 `/business-changes` 使用同一接口核验 AI 可见事实。

## 13. 工作台 Workbench

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/workbench/summary` | 无 | 经营、库存、采购和待办汇总。财务分为 `orderBook`（非取消订单额）、顶层已确认有效订单预计值和 `completed`（已关闭订单）；`totalCost=lockedTotalCost+procurementVariance`，采购价差只计已记录实际采购价且已有正式参考价的下单数量 |
| `GET` | `/api/workbench/action-center` | 无 | 聚合订单准备、经营风险、数据质量、规则学习和知识库健康检查，返回完整待办、今日执行队列、生命周期和最近 24 小时处理进展 |
| `GET` | `/api/workbench/action-history` | 查询参数 `status?=active/resolved`, `limit?` | 只读查询管理事项生命周期历史和汇总，默认最近 20 条、最多 100 条 |
| `POST` | `/api/workbench/execution-plan` | `{ workflowType, goal?, orderId?, quotationId?, actionId? }` | V8 只读生成统一工厂执行计划；`workflowType` 支持 `order_readiness/quotation_to_order/management_action` |
| `GET` | `/api/workbench/execution-runs` | 查询参数 `workflowType?`, `subjectId?`, `actionId?`, `status?=completed/failed`, `limit?` | V8.4 只读查询执行历史及成功/失败统计 |
| `POST` | `/api/workbench/execution-runs` | `{ workflowType, subjectType, subjectId, actionId, toolName, status, plan, result?, recheck?, outcomeSummary?, error?, startedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key`、`X-Operation-ID` | 能力 `workbench.execution_runs.record`。V8.4 由受保护 AI 执行器记录一次确认尝试；运行记录、最近 500 条保留清理、operation 和逐项强审计同一事务提交，相同命令重放不重复增加尝试次数。响应继续在 `data` 顶层保留原运行记录字段，并追加标准命令回执 |

管理待办中心复用各业务域的实时检查结果，不复制成本、库存或知识同步规则。优先级为 `critical/high/medium/low`，类别为 `order_readiness/business_risk/data_quality/rule_learning/knowledge_health`；同一订单的采购提醒由订单准备结论统一呈现，避免与经营风险重复计数。最近一次真实 AI 回归存在失败或待确认时，以稳定键 `knowledge-regression:release-gate` 生成知识健康事项；最新一次全部通过后自动消失。返回项包含来源、数量、建议动作和可执行页面路径，但不包含写工具或自动执行动作。当前按单人管理助理设计，界面和 AI 不要求分配负责人。AI 工具 `get_management_action_center` 和管理看板“今日待办”页签使用同一接口。

V7.1 使用后台监控把稳定待办键与 `management_action_lifecycles` 对齐，只在首次出现、实质内容变化、消失或再次出现时写入；普通 `GET` 查看保持只读。`management_action_events` 追加保存 `appeared/resolved/reopened` 三类不可覆盖事件。生命周期不会替代实时检查，也不会把“检查不再出现”解释为人工已处理；看板只说明当前规则已不再检出该事项。

V7.2 在返回结果中增加 `executionQueue`。队列最多突出 3 项，业务优先级是不可跨越的第一排序条件，同级事项再按持续时间、累计出现次数和影响数量评分。每项返回 `rank/queueLabel/score/scoreBreakdown/reasons`，便于看板和 AI 解释为什么先处理；`remainingCount` 表示仍保留在完整待办中的其余事项。该排序是纯计算，不新增任务、状态或查看写入。

V7.3 为每条待办增加 `resolution`：`mode` 为 `navigate/confirmable/needs_input/monitor`，并返回最短动作、说明、完成标准和业务页面路径。只有订单处理方案中仍为 `available + confirmable` 的步骤才返回 `canAiConfirm=true` 及受保护的 `execute_order_readiness_action` 参数；看板跳转 AI 后仍需刷新订单方案并显示确认卡片，普通页面跳转、业务判断和等待事项不会生成写动作。

V7.4 在成功的核心业务 `POST/PUT/PATCH/DELETE` 响应结束后，请求一次 500ms 防抖的生命周期复查；连续操作合并执行，失败响应、GET、草稿/试算类 POST 和 AI 对话本身不触发。复查仍以五类实时检查为准，不再出现的稳定事项键自动写为 `resolved` 并追加事件。`GET /api/workbench/action-center` 保持只读，新增 `progress`：`resolvedCount/unresolvedCount/blockedCount/recurringCount` 以及最近已解决、暂时受阻和反复出现明细，窗口默认最近 24 小时。看板和 AI 只消费该统一结果，不需要人工维护完成状态。

V8.1 的执行计划统一返回 `status/subject/metrics/steps/safeguards`。步骤模式为 `automatic/confirmable/manual/needs_input/monitor`，并通过 `dependsOn` 表示前置关系；`canExecute=true + confirmation` 才代表已经接入现有受保护执行器。当前订单确认和采购清单生成可继续使用 `execute_order_readiness_action`，服务端执行前重新检查；报价转订单在 V8.1 仅生成计划并指向报价页面，不能因为步骤模式为 `confirmable` 就宣称 AI 已经能够直接转单。该 POST 只用于承载结构化入参，不写业务数据，也不属于 `WRITE_TOOLS`。

V8.2 增加 AI 写工具 `execute_factory_workflow_step`，当前只接受 `workflowType=quotation_to_order + actionId=convert_quotation + quotationId`。工具属于 `WRITE_TOOLS`，未确认时只返回确认卡片；确认后的跨 API 编排集中在 `aiFactoryWorkflowExecution`，领域 executor 只负责委托。该 service 先重新调用 `/api/workbench/execution-plan`，仅当步骤仍为 `available + confirmable + canExecute` 且服务端确认参数完全一致时继续；执行链依次调用只读 `/api/quotations/:id/order-draft` 预检、正式命令 `/api/quotations/:id/convert` 转单、只读 `/api/orders/:id/readiness-plan` 检查新订单，最后再次刷新原报价计划并保存执行历史。它不直接访问数据库、不重算报价或库存。预检返回的 `expectedUpdatedAt` 会传给正式命令，AI 的 `operationId` 会作为持久化幂等键；计划过期、报价未接受、已转单、预检失败、版本冲突或网络重试都不能绕过报价状态机或重复建单。

V8.3 不新增写 API。AI 执行计划界面直接使用 `subject.path` 和步骤 `path` 进入带业务 ID、页签或处理参数的最短页面；`/quotations?quotationId=:id` 会在报价数据加载后自动打开对应详情。只有 `available + confirmable + canExecute` 且确认器为现有 `execute_order_readiness_action` 或 `execute_factory_workflow_step` 的步骤才提供“发起确认”。该按钮只生成一条明确的 AI 执行请求，服务端仍重新调用本节标准接口校验并返回原确认卡片；历史计划只保留查看入口，前端不会直接调用确认接口或业务写接口。

V8.4 使用 `factory_workflow_runs` 保存每次已确认尝试的计划指纹、动作、工具、尝试次数、成功或失败、结果摘要、错误和最新复查快照，默认保留最近 500 次。记录入口收口为持久化 maintenance command，AI executor 继续只调用正式 HTTP API；确认编排的父 `operationId` 归正式领域业务命令及其幂等语义所有，执行历史作为随后发生的独立 maintenance command，使用同一编排 trace 下新生成的子 `operationId`，不得在两条命令间复用业务操作号。最终 AI 回执聚合两条命令各自的 formal operation/audit 证据。原先无审计的裸保留清理已改为受控 `hardDelete` 和逐项强审计。`POST /api/workbench/execution-plan` 仍只读，但会附加 `executionHistory.latestAttempt/latestRecheck/recovery`：失败记录只有在当前实时步骤仍为 `available + canExecute` 时返回 `retry_available`；计划变化或受阻时返回 `blocked`；最近写操作完成后仅继续新的未完成步骤。同一计划指纹下已有成功记录的动作会清除确认参数并标记完成。

执行历史是二级执行证据，不是订单、报价、采购、库存或成本的 sourceOfTruth，也不能替代各业务命令的状态机和 `api_operations`。当前记录请求发生在业务命令响应之后，因此业务动作成功但进程在记录请求前中断时，历史仍可能缺一条；此时以正式业务状态和对应业务 operation 回执为准，不允许仅凭“没有执行历史”重做业务写入。该限制是模块化单体内保留现有 executor 编排方式的明确兼容边界，不引入消息队列。

## 14. 设置 Settings

允许的设置 key：

- `management_fee`
- `stainless_shaft_joint_default_cost`（不锈钢接轴默认加工费，5–8 元，初始化为 6 元）
- `cable_accessories`
- `float_accessory_delta`
- `aluminum_wire_price_per_kg`
- `usd_cny_rate`

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/settings` | 无 | 经 `settingsQueries` 只读返回业务白名单内的设置 key-value 对象；内部设置不会泄漏 |
| `GET` | `/api/settings/:key` | 白名单 key | 经 `settingsQueries` 返回单个业务设置的 `key/value/updatedAt`，供写入时绑定当前资源版本；非法 key 返回 400，不存在返回 404 |
| `PUT` | `/api/settings/:key` | `{ value, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `settings.update_business_value`。更新成本与业务白名单设置；数值类必须非负，`stainless_shaft_joint_default_cost` 必须在 5–8 元闭区间，`cable_accessories` 必须含 `standard/xinjie` 的 `name` 和 `fee`。设置、operation 和强审计同一事务提交；Web 新调用绑定资源版本，旧无版本/幂等键请求兼容执行并返回 warning |
| `GET` | `/api/settings/runtime` | 无 | 经 `settingsQueries` 和 `runtimeConfig` 读取系统初始化页公开运行配置、整体 `updatedAt`、密钥配置状态、待重启项和只读部署环境状态；AI 配置包含 `aiProvider/localModel/localBaseUrl/localVisionEnabled` 以及 DeepSeek/Kimi 字段，永不返回 API Key 原文或密文 |
| `PUT` | `/api/settings/runtime` | 推荐请求头 `Idempotency-Key`；camelCase 运行设置对象及 `expectedUpdatedAt?` | 能力 `settings.update_runtime`。整批校验白名单内的 AI 与知识检索设置；`aiProvider` 支持 `auto/local/local-first/deepseek/kimi`。`local` 严格只使用局域网模型，`local-first` 允许临时故障时降级；局域网模型地址只允许 localhost 或私网 IP 的 HTTP/HTTPS，当前无密钥也可用。空云端密钥表示保留原值，API Key 使用 `JWT_SECRET` 派生密钥进行 AES-256-GCM 加密。设置、operation 与逐项强审计同一事务，提交成功后才更新当前进程环境；冷配置继续返回待重启字段 |
| `POST` | `/api/settings/runtime/test-ai` | AI 提供商、模型、地址及可选新 API Key | 经 `settingsQueries` 编排当前或本次输入的候选配置，对实际启用的提供商逐个执行最小连接测试并返回提供商、模型和耗时；`local` 与 `local-first` 都只探测局域网模型，不因测试调用云端；不保存配置 |

设置领域按 Query / Command 分层：`settingsQueries` 只读取业务白名单和公开运行快照，AI 连接测试只执行外部探测，不写数据库或进程环境；`businessSettingCommands` 与 `runtimeSettingCommands` 分别负责业务设置和加密运行配置写入。路由不再直接查询 `system_settings` 或编排多提供商探测。

`/setup` 系统初始化页只开放业务运行参数。AI 提供商、模型、API Key 和图片输入设置保存后供 AI 工作台即时读取；混合检索和向量批量大小即时读取。知识自动同步、向量开关、向量自动生成、Embedding 模型/维度/精度、缓存目录和离线模式涉及已初始化的后台控制器或模型实例，保存后会返回 `restartRequired=true`，重启 API 服务后生效。管理密码、JWT、内部接口密钥、CORS、端口和生产模式只显示配置状态，仍必须由部署环境提供，不能在网页中读取或修改。

局域网模型、DeepSeek 与 Kimi 的配置和能力由统一 Provider Registry 提供。`AI_PROVIDER=local` 时所有对话只使用 `LOCAL_AI_BASE_URL` 指向的 OpenAI 兼容服务，失败不回退云端；`AI_PROVIDER=local-first` 使用同一本地服务，但连接失败、超时、408/429/5xx 时允许在已配置 DeepSeek 后降级，参数、认证和协议错误不降级。当前局域网服务使用纯文本 `Ornith-1.5-35B-A3B-APEX-i-compact.gguf`，32K 上下文、Q4 KV、单推理槽且默认关闭 thinking；服务允许无 API Key，请求层不会发送空 Authorization。`AI_PROVIDER=auto` 保留原智能路由：DeepSeek 处理普通对话和本地已成功解析的普通文档；图片、扫描/OCR、解析截断、含未解析页/技术图候选或本地解析不可用的文件切换 Kimi K3。Kimi 使用开放平台 `https://api.moonshot.cn/v1` 与开放平台 API Key；Kimi Coding 会员订阅凭证不能用于此处。图片以 base64 原图输入，只有确需外部识别的非图片附件才按 `/v1/files` 临时上传、抽取正文并立即删除；同轮已解析附件直接内联。本机只缓存 Kimi 抽取结果 10 分钟，正文始终作为不可信业务数据。也可设为 `deepseek` 或 `kimi` 强制固定云端模型。

## 15. 转子 Rotor

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/rotor/draw-preview` | 结构化出图参数；可带 `drawingName/drawing_name`、`drawingText/drawing_text`；轴承支持 `6201`–`6205`、`6303`、`6304` 及对应三位别名/密封后缀 | 能力 `drawings.rotor.generate_pdf` 的只读预览。服务端规范化轴承和尺寸，已提供但不是数字或超出 `FC_PARAM_LIMITS` 的参数返回 `400 rotor_parameters_invalid`。成功返回 `confirmationToken/operationId/inputHash/expiresAt/suggestedIdempotencyKey/params/warnings`；`warnings` 当前包括 `rotor_length_parameters_incomplete`（总长度五项只填写部分，details 含 `missingParameters/components/calculatedTotalMm`）和 `rotor_stator_clearance_low`（`开档 - 片数 / 2 - 定位 < 35mm`，details 含 `clearanceMm/thresholdMm`）。预览不写库、不启动 FreeCAD |
| `POST` | `/api/rotor/draw` | 请求头 `Idempotency-Key`；`{ confirmationToken }` | 消费 `/draw-preview` 绑定的服务端参数和警报快照，原子登记 `api_operations + rotor_drawings(queued) + audit_log` 后启动 FreeCAD。Web 可在逐条展示警报后明确确认继续；能力 `drawings.rotor.generate_pdf`，风险 high；相同幂等键只返回原任务回执，不重复出图。标准回执状态依次为 `accepted/processing/completed/failed`，原 `jobId/drawingName/params/message` 字段继续保留 |
| `POST` | `/api/rotor/save` | 请求头 `Idempotency-Key`；结构化转子参数，可带 `drawingName/drawing_name`、`drawingText/drawing_text` | 能力 `drawings.rotor.save_parameters`。保存暂定参数到历史，不启动 FreeCAD；记录、operation 和强审计同一事务提交，相同请求安全重放。返回继续保留顶层 `jobId/drawingName/params` 并增加标准回执；旧请求缺少幂等键仍兼容并返回 warning |
| `POST` | `/api/rotor/recipe-draft` | `{ recipeId }` | 根据配方技术档案生成出图表单草稿；配方录入的转子出图参数优先于泵壳模板历史默认值，并带入成品型号（字段 `name`）、机筒长度和不锈钢机筒开档；不写库 |
| `POST` | `/api/rotor/template-draft` | `{ templateId, variantId? }` | 根据泵壳模板和可选常用配置预设生成出图表单草稿，带入轴承、油封、泵壳 notes 默认参数、不锈钢机筒开档和图纸备注；`variantId` 为历史兼容字段；不写库 |
| `POST` | `/api/rotor/chat` | `{ message, force?, supplements?, baseParams?, drawingName?, drawingText? }` | `rotorNaturalLanguage` 调用 DeepSeek 提取候选参数，再由 `rotorParameters` 确定性纠偏、校验并复用正式 Preview 的共享安全检查器；标准返回 `{ success, data }`，`data.status` 为 `need_params/warning/confirmation_required`。`warning` 同时返回结构化 `warnings` 和旧 `missing_length/stator_clearance` 兼容字段；参数完整时返回与 `/draw-preview` 相同的确认凭证，不直接启动 FreeCAD |
| `GET` | `/api/rotor/status/:jobId` | 无 | 查询任务状态；先读当前进程任务缓存，进程重启或缓存过期后回退 `rotor_drawings` 正式记录；返回 `{ success, data }` |
| `GET` | `/api/rotor/history` | 无 | 最近 100 条出图/保存历史；标准字段为 `jobId, drawingName, nlInput, paramsJson, fcParamsJson, fileUrl, linkedPumpModel, createdAt, updatedAt`；`status=saved` 表示仅保存参数 |
| `PATCH` | `/api/rotor/history/:id/name` | 请求头 `Idempotency-Key`；`{ drawingName/drawing_name, expectedUpdatedAt? }` | 能力 `drawings.rotor.rename_history`。重命名、operation 和强审计同一事务提交；版本冲突返回 409，相同请求安全重放。旧请求仍兼容并返回 warning |
| `PATCH` | `/api/rotor/history/:id/link` | 请求头 `Idempotency-Key`；`{ linkedPumpModel/linked_pump_model, expectedUpdatedAt? }` | 能力 `drawings.rotor.link_history`。关联订单型号、常用配置预设（历史类型 Model Variant）或配方；版本、幂等、事务和强审计受正式命令协议保护，响应继续在顶层提供 `linkedPumpModel` |
| `DELETE` | `/api/rotor/history/:id` | 请求头 `Idempotency-Key`；请求体 `{ expectedUpdatedAt? }` | 能力 `drawings.rotor.delete_history`，风险为可重新生成派生图纸的 medium，而不是删除订单/库存事实的 high。历史记录、operation 与强审计先在同一事务提交，再仅在受控 `public/drawings` 目录幂等清理 PDF；文件清理失败返回 warning 并保留可回收孤立文件，不回滚已确认的数据库删除。页面继续先要求用户确认，旧请求仍兼容 |
| `POST` | `/api/rotor/print/:jobId/preview` | 无 | 能力 `drawings.rotor.print_pdf` 的只读预览。校验任务状态、正式记录和受控 PDF 文件，返回绑定 `jobId/fileUrl/updatedAt` 的确认凭证和 `external_print_side_effect` 警报；Web 必须显示该警报，不发送打印 |
| `POST` | `/api/rotor/print/:jobId` | 请求头 `Idempotency-Key`；`{ confirmationToken }` | 消费打印预览凭证，先持久化 operation 和 `EXTERNAL_PRINT_REQUESTED` 强审计，再向服务器默认打印机发送一次任务；风险 critical。Windows 依次尝试 SumatraPDF、Edge、rundll32，macOS 使用 `lp`；同一幂等键重试不重复打印 |
| `GET` | `/api/rotor/order-pump-models` | 无 | 从订单明细中提取可关联的水泵型号 |
| `GET` | `/api/rotor/link-targets` | 无 | 出图历史可关联对象，合并订单型号、常用配置预设（历史类型 Model Variant）和配方，返回 `{ type, id, label, value, secondary }[]` |

静态下载路径：`/drawings/*` 映射到 `public/drawings/`，用于下载生成的 PDF。

转子只读数据边界统一在 `rotorQueries` 与 `rotorHistory`：订单型号、关联目标、配方/模板草稿和历史状态只聚合正式 SQLite 数据，不调用 AI、不写库；参数标准化、数值范围校验和确认前安全警报统一在 `rotorParameters`。自然语言候选提取、DeepSeek 超时/重试、JSON 容错、正则纠偏和基础参数合并统一在 `rotorNaturalLanguage`，其兼容警报响应由共享检查器派生；模型输出不是正式图纸参数事实，必须经过确定性校验和 `/draw-preview` 确认。FreeCAD 与打印设备执行已抽入 `rotorExternalCommands`，通过 `businessConfirmation` 绑定 Preview 参数与警报快照，并用 `api_operations` 持久化 `accepted/processing/completed/failed` 回执。路由只保留鉴权主体、命令上下文、service 调用和响应适配。

## 16. AI

### 私人助理与长期记忆（V1）

聊天循环保留完整正式工具回执及页面明细；送给模型的订单、报价、配方列表使用标注 `modelView.kind=list_summary` 的基本信息视图，逐行 `omittedFields` 标明嵌套字段未展示，`modelView.detailTool` 指向既有详情工具。该视图不改变 HTTP/AI 工具的正式输入、响应或能力登记。详情中的 JSON 字符串在模型视图中无损解码。历史引用摘要最多估算 4096 token，超出则要求重新查询；工具说明占用过大时精简说明，保留所有工具及 schema 校验结构。大明细已取得但目录无法同时容纳时，结束工具循环并回答已有证据，缺失部分明确说明，不直接丢弃整轮答案。

聊天入口仍为 `POST /api/ai/chat`，接受可选 `conversationId`（1–100 位字母、数字、冒号、下划线或短横线）和 `providerPreference`（`default | local | deepseek | kimi`）。`conversationId` 用于现有登录主体下的服务端会话引用；不传时不跨请求保存引用。`providerPreference=default` 沿用当前全局路由；其他值仅严格选择本轮已配置 Provider，不修改全局设置，也不跨模型降级。非法值返回 `400 AI_PROVIDER_SELECTION_INVALID`，未配置 Provider 返回 `422 AI_PROVIDER_NOT_CONFIGURED`。所有登记 Query/Preview 均可跨类型、跨域组合；明确肯定式的受支持业务命令进入确认式写通道，询问、否定和说明类文本仍按只读对话处理。

| Method | Path | 说明 |
|---|---|---|
| `GET` | `/api/ai/personal-memories` | 个人记忆列表；afterId 默认 0，limit 默认 30，上限 100；返回 items、hasMore、nextAfterId，无写副作用 |
| `POST` | `/api/ai/personal-memories/change` | 个人记忆变更；action=save/update/delete/undo；save/update 需 1–1500 字 content，非 save 需 id 与 expectedVersion；支持 idempotencyKey |

记忆 DTO：`{ id, content, version, deleted, updatedAt }`。变更返回正式 CommandReceipt，包含 memory、operationId、status、auditId/auditIds、idempotentReplay；重复保存同样的有效内容返回 unchanged。输入非法 400，条目不存在 404，版本或幂等冲突 409；变更、修订、审计与回执原子提交。记忆是单人助理的偏好资料，不修改业务表，不进入业务变更历史；网站登录或现有内部身份沿用。

聊天快捷指令：`记入长期记忆：规则内容`、`规则内容。这点记入长期记忆`（支持请/帮我、记到/保存到及句末标点）、`把刚才那条改成：新内容`、`忘掉刚才那条记忆`、`撤销刚才记忆修改`。句尾指令保存本条消息前面的完整规则，不要求把保存指令放在句首。明确指令直接取得正式存储回执，无额外确认按钮；当前版本未定位到指代时追问，不假装已经记住。普通纠正、引用、假设或否定句不持久化。现有反馈按钮暂保留原机制，统一入口列在技术债清单。


### AI 入口与框架撤除

当前源码的 `POST /api/ai/chat` 经 `aiDispatcherV3` 进行服务端双通道路由：普通对话与查询调用 `aiAssistantRuntime`，明确业务写命令调用 `aiAgentRuntimeV3` 的确认和回执链。单零件录入在类别、型号、单价、供应商、库存等标签字段明确时，服务端直接按 `create_part` 现有 schema 提取参数并生成确认；`修改/更新/设置` 以及 `将/把某零件修改成...` 可按 `update_part` 现有 schema 确定性提取资料字段。`刚才录入的零件` 只绑定同一登录所有者、同一 `chat-<ID>` 会话最近 20 条助理消息内带正式执行证据的 `create_part` 回执；查询结果、失败结果和其他所有者会话不能提供修改目标。上述完整命令直接生成受保护 TaskEnvelope，不依赖模型规划或 tool choice；字段不完整或缺少可信相对目标时不构造确定性调用。V5 shadow、preview、authority mux 和 Candidate 已撤除；废弃入口 `/api/ai/owner-read-canary` 替代为 `/api/ai/chat`。旧 header/开关不再选择另一条回答链。

内部 `TaskEnvelope` 以 Capability Registry 的稳定能力身份和已校验参数记录本轮步骤、必答字段与展示类型，不建立第二套业务参数 schema，也不改变 `/api/ai/chat` 请求或 SSE 契约。`EvidenceBundle` 只接受带正式 `aiExecutionEvidence` 的 Query/Preview 回执。配置 BOM 与权威业务规则已使用领域 Presenter V1 验收必答字段；模型回答不完整时从正式证据确定性生成简短答案，未验证结果不会进入该底稿。

Web 携带 `conversationId`（通常为 `chat-<正安全整数>`），服务端用于主体绑定的会话隔离和上一轮候选引用，不再构造 Candidate 跨进程信封。`chat-<ID>` 还会从该所有者的数据库会话中恢复最近 20 条助理消息内、带正式执行证据的候选，供重启后或失败续问后的序号/名称选择使用；同一窗口内带正式写回执的最近零件结果可解析用户明确的“刚才录入”引用。候选金额和状态不会被当作当前事实，选中后仍重新调用正式 API；相对写目标也只用于生成确认参数，最终执行仍由标准 API 重读目标和版本。省略或非法会话标识时不会复用会话内存、持久候选或相对写目标；旧 turnState 仅保留传输兼容，不授予身份或写权限。

### 有界业务集合查询（只读）

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/collections/read` | `{resourceType, operation, pageSize?, afterId?, targetId?, identity?, status?, customerName?, customerKeyword?}` | 能力 `collections.read`。五类资源 orders/customers/parts/recipes/coils；list/count/detail；严格 schema、未知字段拒绝。默认20、最多50条，SQL `id DESC` + keyset + LIMIT，在转移前有界。count 是同过滤条件的正式 COUNT，不取当前页长度；customerKeyword 仅 customers/list，响应同时返回正式 totalCount |

这是 Query，沿用正式 JWT/内部访问认证。无需 allowWrite、确认或业务审计；只读事务同时读取计数和页。列表仅传资源已批准识别字段与 canonicalId；详情在 Business service 内先应用 `<resource>.detail.v1` 白名单投影，再检查8192字节的投影上限，之后才序列化传输。订单原始 items_json 仅在服务端解析，最多50条明细只保留 recipeName/qty/unitPrice，不开放配置或成本快照；备注最多512字符。批准投影超长、嵌套条数超限、身份多匹配或读取失败均拒绝，不截断原始字符串或按大小临时删字段。schema 与投影以 `collectionReadContract`、`collectionDetailProjection` 为当前实现；历史 V5 交互契约不再适用。现有256KiB保护不变。

订单过滤支持正式状态、`active`（排除已关闭/已取消）和客户名称精确相等。客户 list 支持 `customerKeyword`：1..160字符、非空白，SQL `instr(name, :customerKeyword)>0` 做原文字面包含，大小写和标点不改写，`%`/`_` 不是通配符；同一事务内 COUNT、id DESC keyset、LIMIT，响应 `filters.customerKeyword` 精确回显。无关键词的旧响应保持原字段。其余资源不增加过滤。排序为稳定创建记录 ID 降序，不宣称更新时间排序。精确详情仍使用正式名称（线圈也支持 schemeCode equality），HTTP detail 多匹配仍拒绝；关键词候选即使仅一个也不能自动替代目标。

### 有界关系读取（保留实现，当前主入口未挂载）

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/relations/read` | `{version:1, relation, rootId?, pageSize?, afterId?, stockStatus?}` | 能力 `relations.read`；严格类型化字段。保留 router/service 和业务测试，当前 `api.cjs` 未挂载；Candidate 撤除后没有运行入口，未来启用需按 API SOP 接入。返回 BoundedRelationResultV1，不返回原始订单/BOM JSON |

relation 仅支持 customer.orders、order.customer、order.lines、recipe.parts、part.recipes、parts.stock、part.facts。除 parts.stock 外要求规范 rootId，调用方须先通过正式查询确认目标。页默认20、最大50，id DESC + keyset，正式 COUNT/精确关系计数，hasMore/pageBoundary，逐页只读事务，不承诺跨页历史快照。单客户/两事实请求禁止 afterId。完整结果仍受262144字节上限保护，不提高现有全局上限。

客户关系优先 orders.customer_id，仅无ID旧记录使用唯一 exact customer_name；悬空ID不回退名称。订单明细仅已保存 recipeName/qty/unitPrice，序号是根订单内的行引用，不是产品ID。BOM按已保存 model/supplier（存在partId时要求ID及文本一致）查当前零件，不做supplier→model降级；线圈转子角色明确排除，不冒充完整成品BOM。recipe.parts 的正式精确零匹配按下述缺失引用契约披露；多匹配、ID冲突、技术错误仍拒绝。反向配方查询仍保持原有 fail-closed 语义，在 Business service 内作 exact JSON 引用筛选，最多512候选；未知/损坏来源不作为不存在。嵌套最多50条，无嵌套无限分页。任何超界、歧义、错误证据均 fail closed。

recipe.parts 必须返回 `referenceResolution:{version:1,allResolved,sourceReferenceCount,resolvedReferenceCount,missing:[{sourceOrdinal,model,supplier,status:"NOT_FOUND"}]}`。仅正式精确查找已完成且为零匹配时生成 missing；供应商 `null` 表示原记录未指定，空字符串表示明确空值，不混用。未知字段、伪造状态/计数/序号均拒绝，missing 无 canonicalId、价格或库存，不能用作后续详情目标。`items/totalCount` 仅包含唯一已核实零件；resolvedReferenceCount 是已解析的原引用数（允许重复引用同一零件），与去重后的 totalCount 区分。sourceReferenceCount 等于 resolvedReferenceCount + missing.length + excludedNonPartCount，最大50。`complete=true` 表示本次有界引用核验完整执行，**不代表全部引用已解析**，后者由 allResolved 表达。分页只推进已核实零件；每页保留本次正式核验的缺失说明，不新增嵌套分页。调用方应明确区分“已核实零件”和“原配方引用未找到对应目录记录”，所有引用缺失也不得说成配方没有零件；不替换供应商、不补造实时值、不修改数据。

parts.stock 的 stockStatus 只接受正式 low(0<stock≤5)/out(stock≤0)/attention(stock≤5)/ok(stock>5)，SQL在传输前过滤、计数和分页，NULL库存沿用正式查询的0口径。part.facts 是当前目录库存及目录单价（元/目录数量单位），不是制造成本或成品库存。结果字段由每类投影白名单验证，包含 canonical identities、queryId、语义、过滤、排序、总数、页边界、asOf、provenance及单位；不透传未知DTO字段。

### 内部实体解析查询（只读）

#### 线圈完整身份文本位置供给

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/entity-span-candidates` | `{ version: 1, sourceText: string, entityScope: 'coil' }` | 只读能力 `entities.coil_span_candidates`；返回 `{ version, status, complete, identityScanCount, candidateCount, candidates: [{ start, end, entityType: 'coil', identityKind: 'schemeName'\|'schemeCode' }] }`。只返回完整正式身份在当前请求中逐字符相同的出现位置，不返回名称目录、canonical ID、库存或其他业务记录。输入拒绝未知字段、非字符串、空白及超过 4096 UTF-16 code units；位置同样按 UTF-16 计数 |

权威来源为正式 `coils.scheme_name/scheme_code`，经 Business API `entitySpanCandidates` 服务的一条只读 SQL 读取。仅 internal 调用，risk=low、access=query、无需 preview/confirmation/allowWrite；幂等 inherent、无写事务/业务审计，timeout=15000ms、retry=0、deprecated=false。沿用统一 `/api` JWT/内部服务认证。响应 no-store，日志与 API trace 仅记录状态/数量，不记录输入或身份值。

扫描预算为 **512 条非空身份字段记录**，同名不同记录及 schemeName/schemeCode 分别计数；与既有 lookup 一致，不隐式过滤方案状态。SQL 最多读取 513 条以判定超限；超过 512 返回 `IDENTITY_SCAN_BUDGET_EXCEEDED`、`complete=false`、空 candidates，不采用 first-N。单请求最多 8 个去重后的 `(start,end,identityKind)`，超过返回 `SPAN_CANDIDATE_BUDGET_EXCEEDED` 和空 candidates。技术错误返回稳定 `SPAN_SUPPLY_INTERNAL_ERROR`，输入错误 400 `SPAN_REQUEST_INVALID`。有界失败不等于 NOT_FOUND，调用方不得把不完整结果当作已找到身份。

发现语义仅为“完整正式身份原样出现在源文本中”，无 case rewriting、标点/空格删除、模糊匹配或 n-gram 枚举；一个短字符串只有本身也是完整正式身份时才可命中。重复名称仅合并同一跨度，不裁决 canonical entity；选中后的 `/api/entity-lookup` 继续保留歧义。内部调用适配 `internalApiClient.supplyCoilSpanCandidates` 保留。原 V5 调用方已撤除，当前助理不自动调用该能力。

#### 候选实体解析

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `POST` | `/api/entity-lookup` | `{ version: 1, mention: string, entityTypes: ('coil'\|'customer'\|'order'\|'part'\|'recipe'\|'template')[], matchPolicy: 'EXACT'\|'APPROVED_ALIAS'\|'EXACT_OR_APPROVED_ALIAS' }` | 内部只读 Query 能力 `entities.lookup_batch`。严格拒绝额外字段、类型强制转换、重复/越界实体类型和超长 mention；返回显式 `complete`、候选数量以及含 `entityType/canonicalId/matchKind` 的最小候选；coil 可增加 `bindingRefs: [{ kind: 'schemeCode', value: string }]`，值仅来自正式 `coils.scheme_code`，只供软件只读参数绑定，不提供给模型或写入日志。只做正式身份字段等值查询，无 contains/prefix/fuzzy/top-1；当前六类没有正式 alias 来源。内部调用适配为 `internalApiClient.lookupEntities`，不得由 AI 直连数据库。该 POST 不需要 `allowWrite`、确认、幂等键或 mutation/audit row，仍受统一 `/api` 鉴权保护。边界：mention 160 个 Unicode code point、每次 6 类、每类 10 候选、总计 30 候选；不完整结果不得解析成唯一实体 |

能力登记：`capabilityId=entities.lookup_batch`，`domain=entities`，`access=query`，source of truth 为六类正式业务表经 `entityLookupService` 的有界等值读取；内部查询实现保留，原 V5 shadow resolver 调用方已撤除。风险为 low；无 preview/confirmation/idempotency/写事务/业务审计要求，错误必须区分 invalid/unsupported/incomplete/internal error，不得把技术失败当作未找到。历史设计见 `docs/ai-governance/entity-lookup-api-v1.md`；其中 V5 运行要求已退役。

### AI

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/ai/capabilities` | 无 | 返回当前 `provider/model`、是否支持图片输入、允许的附件类型及数量/大小限制；`providerOptions` 返回 `value/displayName/model/available/supportsImages`，不包含密钥，供输入框的单轮模型选择使用。智能路由额外返回 `defaultProvider=deepseek`，并分别返回可用的 `visionProvider=kimi` 与 `fileProvider=kimi`。`fileProvider` 表示 Kimi 文件抽取能力可用，不表示所有文档都会上传；`AI_VISION_ENABLED` 只控制图片原图输入，不关闭按解析状态选中的 Kimi 文件抽取 |
| `GET` | `/api/ai/health` | 无 | 能力 `ai.health.read`。返回脱敏的模型配置就绪状态、本进程有界请求统计、总耗时与首字耗时（TTFT）、业务域规划/能力规划/工具/总结阶段耗时、重试/降级/超时、最近错误码、供应商真实返回的 token usage 覆盖率与累计值、当前发布门禁结果和运行版本；未返回 usage 的请求标记为不可用，不用本地估算冒充真实用量。不返回 API Key、问题正文、回答正文、附件内容或工具参数。`local-first` 以无密钥局域网模型配置为必需项；`auto` 时 DeepSeek 是普通对话必需提供商，Kimi 是图片/文件能力的可选提供商 |
| `POST` | `/api/ai/chat` | `{ messages, conversationId?, providerPreference?, pageContext?, resolutionContext?, turnState? }` | SSE 流式对话；`providerPreference` 只接受 `default/local/deepseek/kimi`，手工选择仅影响本轮且不跨模型降级；消息可带 `attachments: [{ id }]`；`conversationId=chat-<ID>` 可按当前所有者恢复持久化的可信候选；`pageContext` 当前仅接受白名单化的订单 `resourceType/resourceId/view`；`resolutionContext` 与 `turnState` 仅保留兼容传输，不作为候选身份、执行证据或授权 |
| `POST` | `/api/ai/confirm-tool/preview` | `{ confirmationToken, toolName, args }` | 能力 `ai.tool_confirmation.repreview`，无业务写入的 Preview。只允许当前登录主体编辑尚未消费的确认卡；修改参数必须重新通过对应 AI tool schema 和现有写前 Preview。新卡签发成功后旧 token 立即废弃，校验失败则恢复原卡的 pending 状态。返回新 `AiToolResult` 确认卡，仍需用户再次点击确认执行 |
| `POST` | `/api/ai/confirm-tool` | `{ confirmationToken, toolName?, args? }` | 使用确认卡片中的服务端 token 执行写工具；token 绑定当前登录会话、capability、规范化参数哈希和 operationId，5 分钟有效且单次消费。新客户端只提交 `confirmationToken`；可选 `toolName/args` 仅用于检测篡改。没有 token 的旧请求返回 `409 confirmation_token_required`，不会执行。正式 API 还必须返回匹配 capability 的 `operationId`、完成状态和非空审计 ID；缺失时返回 `502 ai_write_evidence_missing`，token 记为失败，不会向客户端宣称完成 |
| `GET` | `/api/ai/system-prompt` | 默认无参数；新调用使用 `includeMeta=1` | 兼容路径；默认继续返回配置字符串。`includeMeta=1` 返回 `{ prompt, version, sourceOfTruth }`，其中 `version` 是当前内容 SHA-256，供并发保存；不返回系统核心规则 |
| `PUT` | `/api/ai/system-prompt` | `{ prompt, expectedVersion?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.factory_profile.update`。更新内存和 SQLite `config.ai-factory-profile`；不能为空，最大 8000 字符，不能覆盖核心安全、来源和写入确认边界。新 Web 调用先读内容版本再保存；配置、operation 和强审计同一事务提交，相同命令安全重放。旧无版本/幂等键调用继续执行并返回 warning |
| `POST` | `/mcp` | MCP Streamable HTTP JSON-RPC；请求头 `Authorization: Bearer <service-token>`；现代客户端同时发送协议 `_meta`/标准 MCP 头 | 通用无状态入口。官方 SDK v2 原生服务 `2026-07-28` 协议，并以同一 server factory 兼容 2025 版 `initialize` 流程。支持 `server/discover`、`tools/list`、`tools/call` 和 2026 `input_required` form elicitation；工具同时声明 `inputSchema/outputSchema`，结果同时返回文本 JSON 与 `structuredContent`。对象输入从唯一 AI tool schema 派生，并显式设置 `additionalProperties=false`；入口先限流、鉴权，再独立解析 JSON。默认只导出固定 Query/Preview 白名单；现代客户端只有同时通过全局写开关、认证 `clientId` 和该身份逐工具 allowlist 时，才额外看到被授权的 Preview + Confirmation 命令，不能因取得 `mcp:write` scope 看见其他写工具。全部执行仍复用 capability registry、executor、internal API client、正式 API 与执行证据门 |
| `GET` | `/mcp` | 同上鉴权 | 当前为无状态服务，不建立旧协议 SSE 会话；返回 `405` |
| `DELETE` | `/mcp` | 同上鉴权 | 当前不签发 `Mcp-Session-Id`，没有可删除会话；返回 `405` |

参数落地时，当前用户消息中唯一明确的线圈 `规格-片数` 简写优先于模型拆分及旧历史中的其他规格；跨轮指代仍必须使用带正式执行证据的服务端候选。

AI 对话请求只保留最近 10 条有效的 `user/assistant` 消息作为上下文；前端与后端都会执行该限制，当前消息包含在这 10 条内，并按 token 预算优先保留最近消息。只读通道直接向模型提供已登记只读工具；命令通道使用受保护的两阶段计划，并由服务端固定可信写模式、业务域及无歧义操作的正式能力。处理链和预算见 [私人 AI 助理](ai-assistant.md)。每条用户消息最多关联 4 个已经通过 `/api/files` 校验的附件。执行阶段使用 provider-neutral 的保守 token 估算；每次 provider 请求入口把系统提示、历史消息、工具 schema、tool choice、附件片段、图片预留和正式证据放入同一总输入预算。默认上下文窗口/预留输出/历史消息/附件/知识片段/正式证据预算分别为 `32768/4096/8192/8192/6144/16384`，可由对应 `AI_*_TOKENS` 环境变量调整；分项上限不能相加后突破总窗口。100KB 附件文字和 256KB 正式工具结果字节限制继续作为最后的传输安全边界。长附件不再只保留文件开头，而是按当前问题选择有字符范围的相关片段；正式 API 结果预算不足时仍显式返回超限，不静默删除业务字段。auto 智能路由根据每个服务端文件的实际解析结果判断：无附件、普通文本、`parserStatus=parsed` 且有正文的 Word/表格/普通文字型 PDF（包括已成功提取的 PDF 表格）使用 DeepSeek 和本地内容；图片在 Kimi API Key、模型和视觉开关可用时使用 Kimi 原图；扫描/OCR PDF、含技术图候选或未解析页的 PDF、解析截断、`failed`、`metadata_only`、pending/processing 或没有可用正文的文档使用 Kimi 文件抽取。混合附件只上传被判定为 `external_file` 的文件，其余附件继续内联。纯 TXT 不经过解析器，上传时已校验 UTF-8，始终直接读取原始正文；CSV 作为表格解析。若视觉关闭但同轮另有文件需要 Kimi，Kimi 仍处理该文件，图片只提供本地 OCR。K3 成功接收图片原图时不再重复附加整段本地 OCR。单次提供商 HTTP 请求默认 120 秒，整轮 `/api/ai/chat` 默认 180 秒，分别由 `AI_PROVIDER_TIMEOUT_MS/AI_CHAT_TIMEOUT_MS` 配置；浏览器停止或断开会沿共享 `AbortSignal` 取消规划、提供商响应流和内部正式 API，避免后台继续消耗。SSE 默认每 15 秒发送注释心跳，可由 `AI_SSE_HEARTBEAT_MS` 调整。仅网络失败、超时、429 和 5xx 标记为可降级，Kimi 此时回退 DeepSeek 并使用本地解析/OCR，分别记录 `vision_fallback/file_fallback`；认证、参数错误和用户取消直接返回，不进行错误回退。已建立请求的响应体若因 `terminated/UND_ERR_SOCKET` 等网络问题中断，统一映射为 `AI_PROVIDER_NETWORK_ERROR`。SSE 会发送 `provider` 事件，前端将实际模型保存到 AI 回复元数据并显示标签。运行进程仅以有界内存保存请求数、TTFT、阶段耗时、供应商 usage、重试、降级、取消和错误码，不保存问题、回答、附件或工具参数，进程重启后重新计数。第三方 OpenAI 兼容流由 `aiProviderStream` 独立解析，可容忍网络分片、UTF-8 字符分片、K3 `reasoning_content`、工具调用增量、usage 尾帧和非 JSON 状态行；K3 后续工具轮会原样回传模型推理字段，但不会向用户展示。

通用 MCP V1 白名单覆盖 capability registry 当前全部 48 个 `access=read`、`operation=query/preview` 且 `requiresConfirmation=false` 的 AI 能力，按领域包括：成本与线圈 `full_calculate/get_copper_price/calculate_coil_cost/get_coil_specs/search_coils/dynamic_config_cost`；零件、模板与配方 `search_parts/search_templates/get_template_detail/get_all_recipes/get_recipe_detail/get_recipe_technical_files/build_recipe_bom_draft/preview_recipe_cost/preview_pump_shell_cost/compare_recipes`；客户与报价 `search_customers/search_quotations/get_quotation_detail/search_customer_history/inspect_quotation_file/build_quotation_draft/explain_cost_change`；订单与经营 `get_recent_orders/get_order_detail/get_purchase_overview/build_order_draft/get_order_knowledge_package/check_order_readiness/get_order_readiness_overview/plan_order_readiness_actions/get_dashboard_summary/get_business_alerts/get_management_action_center/plan_factory_workflow`；质量、规则与知识 `get_data_quality_summary/analyze_recipe_configuration/get_factory_learning_health/get_factory_rule_candidates/get_factory_rule_impact/get_factory_rule_compliance/get_factory_rule_history/search_factory_file_archive_targets/search_factory_knowledge/get_factory_knowledge_detail/get_factory_knowledge_health`；出图历史与业务变更 `get_rotor_drawing_history/search_business_changes`。目录契约测试会把白名单与注册表中的全部安全 Query/Preview 做集合比对，新增安全读能力未同步或误暴露写能力都会失败。任何写能力或意外返回确认令牌的调用仍会在 executor 前后双重拒绝。全部工具标记 `readOnlyHint=true`；其中 `get_copper_price` 会访问管理域外的实时铜价来源，因此标记 `openWorldHint=true`，其余正式工厂数据工具标记 `openWorldHint=false`。这些 annotations 只帮助通用 MCP 客户端理解工具行为，不替代服务端权限控制。MCP 层不持有业务实现，不访问数据库，不接收原始 URL，也不向任何 Agent 下发 `INTERNAL_SECRET`；它使用服务器内部 executor → internal API client → 正式 API 链路，并要求 `aiExecutionEvidence` 证明本轮正式 API 已成功完成后才返回业务事实。正式 API 以结构化 JSON 明确返回 `404` 时，MCP 保留 `AI_RESOURCE_NOT_FOUND` 和已验证负结果；网络失败、5xx、非 JSON 响应或超时仍返回执行证据不足，不能伪装成“未找到”。

通用 MCP V2 另有 18 个可授权写工具：`execute_order_readiness_action/execute_factory_workflow_step/sync_factory_knowledge/generate_purchase_list/create_order/add_recipe_to_order/remove_recipe_from_order/update_order_item/archive_factory_file/create_recipe/update_recipe/delete_recipe/adjust_coil_stock/batch_create_parts/adjust_part_stock/delete_part/batch_update_prices/generate_rotor_drawing`。物理打印 `print_rotor_drawing` 保留为正式 HTTP/AI 业务能力，但在设备集成正式完成并重新安全审计前不属于 MCP 目录，即使身份 allowlist 伪造该名称也不能发现或调用。其中 `generate_purchase_list/add_recipe_to_order/remove_recipe_from_order/update_order_item` 必须携带用户明确提供的 `reason`，AI 或 MCP 客户端不得自动编造订单修改原因；修改或移除订单产品必须传订单详情返回的 `orderItemId`，可选 `recipeName` 只用于与该 ID 交叉核对，不能单独作为写入目标或使用部分名称猜测。所有写工具必须同时在 capability registry 声明 `access=write`、`operation=command`、`supportsPreview=true`、`requiresConfirmation=true`；没有正式 Preview 的 `create_part/update_part/delete_order` 等能力不会因已经存在于 AI 工具目录而自动暴露。每个已授权身份还必须在 `MCP_WRITE_TOOL_ALLOWLISTS` 中显式列出最小工具子集；目录按该子集过滤，实际执行再次校验，伪造 scope 或直接调用未授权工具返回 `mcp_write_tool_not_allowed`。写工具首轮只以 `allowWrite=false` 调统一 executor，取得规范化参数、正式 Preview 上下文和短时 confirmation token；2026 客户端随后通过协议原生 `input_required` form elicitation 向用户展示确认内容。只有 `action=accept` 且结构化 `confirm=true` 才进入统一 `executeConfirmedAiTool` service，消费已绑定主体/能力/参数/operationId 的服务端 token，并要求匹配正式 capability 的 operation/audit 回执；普通命令必须 `completed`，只有显式 `completionMode=accepted_async` 的出图任务可以返回 `accepted/processing`，且不能描述为出图已完成。MCP 回执的主 `operationId` 指向第一条正式业务 operation，`formalOperationIds/formalCapabilityIds/auditIds` 保留全部正式证据；一个确认编排如果执行业务动作后还持久化执行历史，每条正式命令使用独立 operationId，避免把确认 trace 当成多个业务事件的唯一身份。AI 确认层的非持久操作号单独放在 `confirmationOperationId`，不得与正式审计混用。确认后若业务校验失败，优先透传正式业务 code；执行器没有稳定 code 时返回 `ai_write_execution_failed`，只有“业务自称成功但缺 operation/audit”才返回 `ai_write_evidence_missing`。Agent 文字和客户端自报 `clientInfo` 均不提供授权。多轮 `requestState` 由官方 SDK HMAC codec 完整性保护，绑定已验证服务身份和调用方法；换身份、换工具、换参数、过期、篡改、并发重复消费均拒绝。2025 无状态客户端继续完整支持只读目录，但没有 elicitation 回路，因此写工具不进入其 `tools/list`，直接调用也返回安全错误且不会执行。

MCP 默认 `MCP_ENABLED=false`。单 Agent 可配置 `MCP_CLIENT_ID + MCP_TOKEN`；多 Agent 推荐使用 `MCP_SERVICE_TOKENS={"clientId":"token"}`，每个 token 至少 32 字符、不得跨身份复用，也不能与 `INTERNAL_SECRET`、`JWT_SECRET` 或管理密码相同。写能力独立默认 `MCP_WRITE_ENABLED=false`；启用时必须同时配置 `MCP_WRITE_CLIENT_IDS=<clientId,...>` 和 `MCP_WRITE_TOOL_ALLOWLISTS={"clientId":["sync_factory_knowledge"]}`。每个写身份必须拥有已登记 token 和非空、无重复、只含上述 18 个正式写工具的数组；缺少映射、未知身份/工具或空数组会使启动配置校验失败。只有该身份获得 `mcp:write` scope，且目录与执行都只允许其数组中的工具；其余身份保持 `mcp:read`。Host/Origin 必须位于 `CORS_ORIGIN` hostname 或 `MCP_ALLOWED_HOSTS`。默认每 IP 每分钟 60 次、单次结果上限 262144 bytes；可分别通过 `MCP_RATE_LIMIT_PER_MINUTE`（1-600）和 `MCP_MAX_RESULT_BYTES`（16384-1048576）调整。日志只记录 requestId、服务身份、token 短 SHA-256 指纹、协议代际、工具名、成功状态、结果分类、稳定错误码和耗时，不记录 token、工具参数或业务结果。正式 API 已证实的“未找到”等业务负结果记为 INFO/`verified_negative`，只有协议错误、执行失败或证据缺失才记为 WARN/`error`。旧 `HERMES_MCP_*` 在一个兼容周期内仍可读取，通用变量一旦出现即优先。

生产身份与逐工具 allowlist 由 `scripts/manage-mcp-identities.cjs` 统一维护，不手工编辑 `.env`。新的权威写工具首次进入生产灰度集合默认使用单项 `approve-write`；一个固定候选集完成整体代码审计、18/18 localhost 成功路径及逐工具原生拒绝零副作用验收，且输入集合与 `scripts/mcp-write-acceptance-manifest.cjs` 当前候选清单精确一致后，可使用 `approve-write-batch` 对一个身份整批首次批准。批量列表必须非空、无重复、全部是尚未灰度的权威写工具，任一缺失、多余或不符即整批拒绝；它使用独立确认词并只产生一个锁、一份备份和一次原子配置替换。`grant-write` 仅把已经灰度的工具委派给另一身份。每次变更先生成脱敏计划。单项正式应用由同目录排他 lockfile 保护“读取、规划、权限受限备份、原子替换”临界区；Mac Mini 批量入口则在同一个远端进程和同一个锁内继续完成一次 API 重启，并以 2026-07-28 官方 SDK 按身份精确比较“48 个权威只读工具 + 该身份实际写 allowlist”的完整名称集合。数量相同但名称错误、缺失、重复或越权均判失败；失败时先恢复该次唯一备份、再次重启并核验旧目录，达到明确终态后才释放锁，避免覆盖并发身份变更。

MCP 变更在发布到 Mac Mini 前运行 `npm run verify:mcp-local`：它组合协议/安全单测、官方 conformance 场景，以及基于临时数据库和隔离 API 的真实 HTTP 验收；Hermes 兼容的 2025 客户端与通用 2026 客户端分别发现并调用全部 48 个只读工具，2026 写身份再完成一次 `sync_factory_knowledge` 正式 Preview → form elicitation → Command → operation/audit 回执闭环。隔离进程仅为连续调用把测试限流提高到 600，所有写入只发生在临时数据库副本，生产默认值和源数据库不变。正式环境部署后的日常发布自动运行 `npm run verify:mcp-prod-read`，严格核对 48 个只读工具及 annotations；若验收身份处于写灰度，只允许额外出现其逐工具 allowlist 中的写工具，未知或越权目录会失败。随后在一个连接内复用三个成本场景，并覆盖库存、配方、模板详情、客户/报价详情、订单/采购、管理/质量、知识、出图历史和统一业务变更；每个结果必须带已验证执行证据、能力 ID 和正式数据源，并核对完整资源没有大小写重复键或业务字段裁剪。生产空数据不视为协议失败，也不为覆盖详情造数据；全部 48 个工具和缺价路径仍在隔离库验收。生产写开关的发现和单笔可回滚验收仍必须另行明确批准。详细流程和 Windows conformance CLI 的退出兼容边界见 `docs/mcp-development-guide.md`。

MCP 写目录、确认协议、executor 或正式 command 变更还必须运行 `npm run verify:mcp-write-local`。该门禁以 `scripts/mcp-write-acceptance-manifest.cjs` 为显式验收清单，并与上述 18 个正式写工具做严格集合比对；清单还把本轮之前已完成人工灰度验收的 9 项作为测试基线，将批次候选 9 项按“订单与报价转单（7 项）/文件归档（1 项）/转子出图（1 项）”形成三个场景，二者必须无重复、无遗漏。物理打印不进入 MCP 验收清单，并由目录负向测试保证即使伪造 allowlist 也不能调用。该本地分组不是生产 allowlist 的事实来源，实际生产权限始终由部署后的认证身份目录核对。快速协议矩阵逐工具覆盖 scope 拒绝、逐工具 allowlist 拒绝、Preview、HMAC 主体/工具/参数绑定、明确接受、确认层重放和拒绝无副作用。随后 `scripts/run-mcp-write-local-e2e.cjs` 创建全新临时 SQLite、随机 localhost 端口和 2025/2026 两代真实客户端；2026 写客户端只取一次权威目录快照，让 18 个工具逐一完成 MCP form elicitation → 正式 executor/API → operation/audit → Query/数据库回读闭环，并让剩余 9 项逐一完成真实 form decline，逐项比较数据库与外部命令计数为零。订单明细修改/移除使用回读得到的 `orderItemId`，同名歧义和部分名称必须 fail-closed；订单准备及报价转单还核对业务动作与 workflow history 的 operationId 独立且正式回执均被聚合。2025 客户端仍真实完成只读调用并拒绝隐藏写工具。五个代表性正式命令使用同一 `requestState/inputResponses` 做真实幂等重放，订单、库存、配方和文件覆盖真实失败且零副作用；`update_recipe` 额外从空规格基线改为临时非空规格，再以 `clearSpec:true` 完成第二次原生确认和正式恢复，核对包含包装箱型与旧喷漆工资迁移状态的完整业务快照恢复、零件目录零副作用及第二次持久 operation。`delete_recipe` 使用同一临时配方完成正式删除 Preview、原生确认、软删除 Command、operation/audit、详情 404、列表数量精确减一和零件目录零副作用闭环；`delete_part` 使用同轮临时零件完成唯一目标解析、正式删除 Preview、版本与哈希绑定、原生确认、软删除 Command、operation/audit、目录不可见和其他零件零副作用闭环。报价转订单核对来源业务字段，转子出图核对完成任务的 `jobId/PDF`；订单与报价转换的不可逆测试状态随临时数据库整体销毁，FreeCAD 由可计数替身拦截并回读异步终态。报告分别写入 `logs/mcp-write-local-latest.json` 和 `logs/mcp-write-local-e2e-latest.json`，包含目录快照、候选清单、三场景结果和逐工具拒绝证据，并明确记录 `productionTouched=false/physicalSideEffects=false`。本地 18/18 通过只证明代码链路具备受控写入条件，不构成生产写开关、身份或逐工具 allowlist 的授权；报价转单和归档仍只能使用专用灰度数据。

当前认证是面向同一管理域内 Agent/CI 的静态 service-token 模式，不等同于 MCP Authorization 规范中的完整 OAuth 2.1 Resource Server。不得把该入口直接作为不受控多租户公网平台；若未来开放第三方用户授权，必须先实现 OAuth Protected Resource Metadata、audience 绑定、scope 与 token 生命周期，并继续禁止 token passthrough。当前不支持 MCP Resource 或 Prompt。写能力仅适用于支持 2026 form elicitation、会把确认实际呈现给人的受控客户端；恶意或自动接受 elicitation 的客户端仍等同于持有写凭证的受信服务，因此不得把当前静态 token 发给不受控 Agent。回滚写能力设置 `MCP_WRITE_ENABLED=false` 并重启；完全回滚 MCP 设置 `MCP_ENABLED=false`，均不涉及数据库迁移。

工具结果、资料和记忆作为不可信数据处理，不能获得写权限。新运行器记录工具耗时、结果状态和提供商 usage；观测数据不是业务事实来源。当前默认链不产生旧两阶段意图信封。

注册表共登记 77 个 AI 工具、当前 123 个已迁移正式业务能力；登记总数不代表当前聊天全部开放。AI 工具名称、displayName、读写属性、风险、来源、executorKey 和 resultProvenance 统一在 `api/capabilities/registry.cjs` 登记，输入唯一 schema 在 `api/routes/ai/tools.cjs`。`WRITE_TOOLS` 是注册表投影。新助理只暴露 read/query 或 preview；未登记、schema 不匹配、标识无依据或不在 allowlist 的调用在 API 前拒绝。`read_collection/read_relation` 已从 AI 工具目录撤除，保留的正式业务接口按各自挂载状态说明。

已迁移能力契约摘要（完整机器事实以 `api/capabilities/registry.cjs` 为准）：

| capabilityId | toolName | 类型 | sourceOfTruth | 风险 | 确认 | 预览 | 幂等/并发 | 事务与审计 | 超时 |
|---|---|---|---|---|---|---|---|---|---|
| `catalog.reference_audit` | Internal CLI | query/read | 目录、业务明细与嵌套引用 | low | 否 | 不适用 | 天然幂等 | 同一只读事务；不写审计或业务表 | 有界扫描 |
| `catalog.naming_rules` | HTTP/Web/Internal | query/read | 服务端命名规则注册表 | low | 否 | 不适用 | 天然幂等 | 严格只读、无审计 | 15s |
| `catalog.name_preview` | HTTP/Web/Internal | preview/read | 服务端命名规则注册表 | low | 否 | 本能力仅预览 | 天然幂等 | 无事务写入、无审计 | 15s |
| `catalog.references_resolve` | HTTP/Web/Internal | query/read | 主目录和 `catalog_identity_profiles` | low | 否 | 不适用 | 天然幂等 | 同一只读事务、无审计 | 15s |
| `catalog.bind_references` | HTTP/Web/Internal | command/write | 盘点源行、身份档案与历史绑定 | high | 是 | 绑定预览 | 90天持久化幂等 | 来源/目标/档案哈希重验；写入、强审计、业务事件及回执同一事务 | 15s |
| `catalog.bound_names` | HTTP/Web/Internal | query/read | 原始来源、历史绑定和主目录 | low | 否 | 不适用 | 天然幂等 | 同一只读事务；按绑定 ID 有界分页 | 15s |
| `parts.list` | HTTP/Web/`search_parts` | query/read | `parts`；当前目录价格由正式零件 Query 返回 | low | 否 | 不适用 | 不适用 | 严格只读 | 默认 HTTP 超时 |
| `coils.list` | HTTP/Web/`search_coils` | query/read；输出 `CoilProfile[]` 完整档案 | `coils + stator_variants` | low | 否 | 不适用 | 天然幂等/无并发 | 严格只读、无审计 | 15s |
| `orders.list` | HTTP/Web/`get_recent_orders` | query/read | `orders` + 实时采购平衡 + `parts.price` + `coils.cost` | low | 否 | 不适用 | 不适用 | 严格只读 | 默认 HTTP |
| `orders.revisions.list` | HTTP/Web | query/read | `order_revisions` | low | 否 | 不适用 | 不适用 | 严格只读 | 默认 HTTP |
| `quotations.list` | HTTP/Web/`search_quotations` | query/read | `customers` + `quotations` | low | 否 | 不适用 | 不适用 | 严格只读 | 默认 HTTP |
| `quotations.detail` | HTTP/Web/`get_quotation_detail` | query/read | `customers` + `quotations` | low | 否 | 不适用 | 不适用 | 严格只读 | 默认 HTTP |
| `purchasing.overview` | HTTP/Web/`get_purchase_overview` | query/read | 活动订单采购计划 | low | 否 | 不适用 | 不适用 | 严格只读 | 默认 HTTP |
| `recipes.inventory_status` | HTTP/Web/Internal | query/read | `recipes.parts_json + parts + coils` | low | 否 | 不适用 | 天然幂等 | 同一只读事务，未知/歧义与零库存分开 | 默认 HTTP |
| `recipes.list` | HTTP/Web/`get_all_recipes` | query/read | `recipes + recipe_technical_files` | low | 否 | 不适用 | 不适用 | 严格只读 | 默认 HTTP |
| `customers.list` | HTTP/Web/`search_customers` | query/read | `customers` | low | 否 | 不适用 | 不适用 | 严格只读 | 默认 HTTP |
| `customers.history` | HTTP/`search_customer_history` | query/read | `customers` + `quotations` + `orders` | low | 否 | 不适用 | 不适用 | 严格只读 | 默认 HTTP |
| `templates.list` | HTTP/Web/`search_templates` | query/read | `pump_shell_templates` | low | 否 | 不适用 | 不适用 | 严格只读 | 默认 HTTP |
| `templates.detail` | HTTP/Web/`get_template_detail` | query/read | `pump_shell_templates` | low | 否 | 不适用 | 不适用 | 严格只读 | 默认 HTTP |
| `parts.create` | HTTP/Web/`create_part` | command/write | `parts` | medium | 页面保存或 AI 外层确认 | 无 | 90 天持久化幂等；新资源无版本 | 零件、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `parts.batch_create` | HTTP/Web/AI/Internal/`batch_create_parts` | command/write | `parts` | high | `/api/parts/batch-create-preview` + Web 或 AI 外层确认 | `/api/parts/batch-create-preview` | 90 天持久化幂等；confirmation token 绑定整批规范化输入，执行时重验型号+供应商仍不存在 | 全批零件、operation、逐项强审计同一 SQLite 事务，失败整批回滚 | 默认 HTTP |
| `parts.update` | HTTP/Web/`update_part` | command/write | `parts` 元数据；改名须通过引用盘点保护；AI 不接受库存字段 | medium | 页面保存或 AI 外层确认 | 库存必须另走库存预览 | 90 天持久化幂等 + `expectedUpdatedAt` | 零件元数据、operation、逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `parts.save_profile` | HTTP/Web 零件资料页 | command/write | `parts` 资料和绝对目标库存 + 表单业务设置；引用盘点保护改名 | critical | 必须消费服务端确认 token | `/api/parts/:id/save-preview` | 90 天持久化幂等 + token 绑定零件和设置版本、改名引用源哈希 | 资料、目标库存、设置、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `parts.delete` | HTTP/Web/AI/`delete_part` | command/write | `parts` | medium | `/api/parts/:id/delete-preview` + 页面或 AI/MCP 外层确认 | `/api/parts/:id/delete-preview` | 90 天持久化幂等 + `expectedUpdatedAt` + `previewHash`；AI/MCP 冻结唯一 `partId` | 软删除、operation、强审计同一 SQLite 事务；确认后正式目录回读不可见 | 默认 HTTP |
| `parts.batch_delete` | HTTP/Web 零件资料页 | command/write | `parts` | high | 页面确认后消费服务端确认 token | `/api/parts/batch-delete-preview` | 90 天持久化幂等 + token 绑定全部资源版本 | 整批软删除、operation 和逐项强审计同一 SQLite 事务，失败整批回滚 | 默认 HTTP |
| `parts.batch_update_prices` | HTTP/Web/`batch_update_prices` | command/write | `parts.price` | high | 页面提交或 AI 外层确认 | `/api/parts/prices-preview` | 90 天持久化幂等 + 每项 `expectedUpdatedAt` + `previewHash` | 整批价格、operation、逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `coils.create` | HTTP/Web | command/write | `stator_variants` + 具体线圈方案元数据/计价/默认 | medium | 页面保存是明确动作 | 无 | 90 天持久化幂等；新资源无版本 | 定子组合、唯一默认、模式化成本、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `coils.update` | HTTP/Web | command/write | 当前线圈 + 定子组合 + 方案元数据 + 计价方式 + 库存流水 | high | 页面保存是明确动作 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 身份冻结检查、唯一默认切换、成本重算、operation 和强审计同一 SQLite 事务 | 默认 HTTP |
| `coils.delete` | HTTP/Web | command/write | 线圈库存 + 流水 | high | 页面删除确认 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 追溯保护、硬删除、operation 和强审计同一 SQLite 事务 | 默认 HTTP |
| `coils.batch_update_unit_price` | HTTP/Web | command/write | 定子组合 + `calculated` 方案的 `coils.unit_price/cost` | high | 页面提交是明确动作 | `/api/coils/spec-price-preview` | 90 天持久化幂等 + 每项版本 + `previewHash` | 计算方案整批单片价/成本、operation 和逐项强审计同一 SQLite 事务；套件价不参与 | 默认 HTTP |
| `templates.create` | HTTP/Web | command/write | `pump_shell_templates` + 零件组件目录 | medium | 页面保存是明确动作 | 无 | 90 天持久化幂等；新资源无版本 | 模板、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `templates.update` | HTTP/Web | command/write | 当前模板 + 零件组件目录 | high | 页面保存是明确动作 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 模板、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `templates.delete` | HTTP/Web | command/write | 模板 + 全部历史配方引用 | high | 页面删除确认 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 引用检查、硬删除、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `model_variants.create` | HTTP/Web | command/write | 常用配置 + 泵壳模板 + 零件目录 | high | 页面保存是明确动作 | 无 | 90 天持久化幂等；新资源无版本 | 常用配置、自动生成长螺丝零件、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `model_variants.update` | HTTP/Web | command/write | 当前常用配置 + 泵壳模板 + 零件目录 | high | 页面保存是明确动作 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 配置、自动生成长螺丝零件、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `model_variants.delete` | HTTP/Web | command/write | 当前常用配置 + 历史配方引用 | high | 页面删除确认 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 软删除、operation 和强审计同一 SQLite 事务；不删除历史配方 | 默认 HTTP |
| `settings.update_business_value` | HTTP/Web | command/write | `system_settings` + `costEngine` 消费方 | high | 页面保存是明确动作 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 白名单业务设置、operation 和强审计同一 SQLite 事务 | 默认 HTTP |
| `settings.update_runtime` | HTTP/Web | command/write | `runtime_settings` + 当前进程环境 | high | 初始化页保存是明确动作 | 无 | 90 天持久化幂等 + 整体 `expectedUpdatedAt` | 加密设置、operation 和逐项强审计原子提交；成功后应用热配置，冷配置标记待重启 | 15s |
| `market.sync_copper_price` | HTTP/Web/Internal scheduler | maintenance/write | 外部铜行情 + `coils.copper_base/cost` | high | 页面按钮、启动补跑或定时调度本身是明确触发 | 不适用；执行时抓取快照 | 90 天持久化幂等；启动按进程窗口、调度按北京日期窗口 | 外部抓取在事务外；变化线圈、operation 和逐项强审计原子提交 | 25s |
| `market.sync_indicators` | HTTP/Web | maintenance/write | 外部铜/铝/汇率 + `coils` + `system_settings` | high | 页面同步按钮是明确动作 | 不适用；执行时抓取快照 | 90 天持久化幂等；同键重放首次快照 | 外部抓取在事务外；线圈、两个设置、operation 和全部强审计原子提交 | 25s |
| `inventory.parts.batch_adjust_stock` | HTTP/Web/Internal | command/write | `parts.stock` | critical | 正式执行必须消费服务端确认 token | `/api/parts/batch-stock-preview` | 90 天持久化幂等 + token 绑定库存快照和资源版本 | 业务、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `inventory.coils.adjust_stock` | `adjust_coil_stock`/Web | command/write | `coils.stock` + `coil_stock_movements` | critical | 正式执行必须消费服务端确认 token | `/api/coils/stock-adjustments-preview` | 90 天持久化幂等 + token 绑定库存快照和资源版本 | 库存、流水、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `workflow.quotation.convert_to_order` | HTTP/Web；由 `execute_factory_workflow_step` 编排 | command/write | `quotations` + 报价 BOM/成本快照 + 活动订单库存平衡 + `orders` | critical | Web 预览确认；AI 必须使用服务端确认 token | `/api/quotations/:id/order-draft` + `previewHash` | 90 天持久化幂等 + `expectedUpdatedAt` + 预览哈希 | 建单、报价状态、operation、两条强审计同一 SQLite 事务 | 默认 HTTP |
| `purchasing.order.item_progress` | HTTP/Web；旧 toggle 兼容层 | command/write | 活动订单平衡计划 + 订单采购项 + `parts.stock`/`coils.stock` | critical | Web 保存是明确动作；增加库存时再显示正式预览中的数量、换算和库存后值；尚无 AI 调用方 | `/api/orders/:id/purchase-items/progress-draft` + `previewHash` | 90 天持久化幂等 + `expectedUpdatedAt` + 预览哈希 | 平衡快照、库存/流水、订单、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `purchasing.task.batch_order` | HTTP/Web | command/write | 全部活动订单平衡采购计划 | high | Web 可按单物料或同供应商 1–50 个任务显示物料、影响订单数和数量变化；尚无 AI 调用方 | `/api/orders/purchase-items/batch-draft` + `previewHash` | 90 天持久化幂等 + 每个受影响订单 `expectedVersions` + 任务/预览哈希 | 全部任务、计划快照、订单状态、operation、强审计同一 SQLite 事务；任一失败整体回滚 | 默认 HTTP |
| `purchasing.order.complete_inbound` | HTTP/Web | command/write | 活动订单平衡计划 + `parts.stock` + `coils.stock`/流水 | critical | Web 必须先显示正式预览；尚无 AI 调用方 | `/api/orders/:id/complete-purchase-draft` + `previewHash` | 90 天持久化幂等 + `expectedUpdatedAt` + 预览哈希 | 平衡快照、库存、流水、订单、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `orders.create` | HTTP/Web/`create_order` | command/write | 稳定客户 ID + 配方保存成本/BOM + 活动订单采购平衡 + `orders` | high | Web 保存是明确动作；AI 必须确认 | `/api/orders/save-payload-draft` + `previewHash` | 90 天持久化幂等；新资源无版本 | 订单、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `orders.change_status` | HTTP/Web/`update_order_status` | command/write | 订单状态机 + 活动订单采购平衡 + 关闭库存去向 + 零件/线圈库存 | critical | Web/AI 都需明确动作；关闭必须确认库存去向和扣库明细 | `POST /api/orders/:id/status-draft` | 90 天持久化幂等 + `expectedUpdatedAt` + `previewHash` | 状态、库存去向、扣库、线圈流水、相关采购计划、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `orders.execute_readiness_action` | HTTP/`execute_order_readiness_action` | command/write | 实时准备度 + 活动订单采购平衡 + `orders` | critical | AI 外层确认；正式 API 绑定实时计划预览 | `/api/orders/:id/readiness-plan` | 90 天持久化幂等 + `expectedUpdatedAt` + `previewHash` 绑定订单、库存和采购事实 | 订单、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `orders.requirements.save_draft` | HTTP/Web/`save_order_requirement_draft` | command/write | 订单 + 客户要求草稿 + 已关联来源文件 | medium | 页面保存或 AI 外层确认 | 无 | 90 天持久化幂等 + 已有草稿 `expectedUpdatedAt` | 草稿、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `orders.requirements.confirm` | HTTP/Web | command/write | 客户要求确认快照 + 知识同步来源 | high | 订单页“确认进入知识库”是明确动作 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 可选草稿更新、确认快照、operation、逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `orders.requirements.revoke` | HTTP/Web | command/write | 客户要求确认快照 + 知识同步来源 | high | 订单页撤销确认是明确动作 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 撤销确认、operation、强审计同一 SQLite 事务；保留草稿和文件 | 默认 HTTP |
| `orders.execution_records.create_draft` | HTTP/Web/`save_order_execution_draft` | command/write | 订单 + 执行事实草稿 + 已关联依据文件 | medium | 页面保存或 AI 外层确认 | 无 | 90 天持久化幂等；新记录无版本 | 草稿、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `orders.execution_records.update_draft` | HTTP/Web | command/write | 当前执行事实草稿 + 依据文件 | medium | 页面保存是明确动作 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 草稿更新、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `orders.execution_records.confirm` | HTTP/Web | command/write | 执行事实确认快照 + 知识同步来源 | high | 订单页“确认进入知识库”是明确动作 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 可选草稿更新、确认快照、operation、逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `orders.execution_records.revoke` | HTTP/Web | command/write | 执行事实确认快照 + 知识同步来源 | high | 订单页撤销确认是明确动作 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 撤销确认、operation、强审计同一 SQLite 事务；保留草稿和附件 | 默认 HTTP |
| `orders.execution_records.delete` | HTTP/Web | command/write | 未确认执行事实草稿 | high | 页面删除确认是明确动作 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 软删除、operation、强审计同一 SQLite 事务；已确认事实拒绝删除 | 默认 HTTP |
| `orders.todos.toggle` | HTTP/Web | command/write | `orders.todos_json` | medium | 页面勾选本身是明确动作，无额外弹窗 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 待办、operation、强审计同一 SQLite 事务；无变化不写库 | 默认 HTTP |
| `orders.update_draft` | HTTP/Web/订单编辑 AI 工具 | command/write | 订单保存草稿 + 活动订单采购平衡 + `orders` + `order_revisions` | high | Web 显示变化和警告后再次确认；AI 必须确认 | `/api/orders/save-payload-draft` + `previewHash` | 90 天持久化幂等 + `expectedUpdatedAt` | 订单、修订、operation、两条强审计同一 SQLite 事务 | 默认 HTTP |
| `orders.delete` | HTTP/Web/`delete_order` | command/write | `orders` | high | Web/AI 都需明确动作 | 暂无独立预览 | 90 天持久化幂等 + `expectedUpdatedAt` | 软删除、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `customers.create` | HTTP/Web | command/write | `customers` | medium | 页面保存是明确动作，无额外弹窗 | 无 | 90 天持久化幂等；新资源无版本 | 客户、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `customers.update` | HTTP/Web | command/write | `customers` | medium | 页面保存是明确动作，无额外弹窗 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 客户、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `customers.delete` | HTTP/Web | command/write | `customers` + 稳定客户关系 + 报价/订单历史 | medium | 页面删除确认 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 活动订单阻止删除；否则客户软删除、operation、强审计同一 SQLite 事务并保留历史关系 | 默认 HTTP |
| `quotations.inquiry_summary` | HTTP/Web | query/read | 报价 + 客户 + `quotation_source` 附件 + 询价摘要 | low | 无 | 无 | 固有只读 | 不适用；严格不写库 | 默认 HTTP |
| `quotations.inquiry_summary_draft` | HTTP/Web | preview/read | 统一文件库原始附件 + Kimi API | low | 无 | 无 | 单次只读调用 | 不适用；严格不写库 | 120 秒 |
| `quotations.create` | HTTP/Web | command/write | 客户 + 配方 + `costEngine` + `quotations` + 可选询价附件/摘要 | high | 页面保存是明确动作 | `/api/quotations/save-payload-draft` + `previewHash` | 90 天持久化幂等；新资源无版本 | 报价、询价附件关联、摘要、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `quotations.update` | HTTP/Web | command/write | 当前报价 + 客户 + 配方 + `costEngine` | high | 页面保存是明确动作 | `/api/quotations/save-payload-draft` + `previewHash` | 90 天持久化幂等 + `expectedUpdatedAt` | 报价、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `quotations.change_status` | HTTP/Web | command/write | 报价状态机 + `quotations` | high | 状态按钮是明确动作 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 状态、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `quotations.delete` | HTTP/Web | command/write | `quotations` | high | 页面删除确认 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 软删除、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `quotations.expire_overdue` | Internal scheduler | maintenance/write | `quotations.status + created_at` | high | 启动补跑或每日 00:05 BJT 定时触发，无人工确认 | 无；规则确定且执行时重查 | 90 天持久化幂等；启动按进程窗口、调度按北京时间日期窗口 | 过期状态、逐项强审计和 operation 回执同一 SQLite 事务 | 15s |
| `recipes.create` | HTTP/Web/`create_recipe` | command/write | 保存草稿 + `costEngine` + `recipes` | high | Web 保存是明确动作；AI 必须确认 | `/api/recipes/save-payload-draft` + `previewHash` | 90 天持久化幂等；新资源无版本 | 配方、长螺丝补齐、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `recipes.update` | HTTP/Web/`update_recipe` | command/write | 当前配方 + 保存草稿 + `costEngine` | high | Web 保存是明确动作；AI 必须确认 | `/api/recipes/save-payload-draft` + `previewHash` | 90 天持久化幂等 + `expectedUpdatedAt` | 配方、长螺丝补齐、规则刷新、operation、强审计同一 SQLite 事务 | 默认 HTTP |
| `recipes.delete` | HTTP/Web/`delete_recipe` | command/write | `recipes` + 规则学习 | high | Web/AI 都需明确动作 | `POST /api/recipes/:id/delete-preview`，绑定目标、版本、软删除变化和影响 | 90 天持久化幂等 + `expectedUpdatedAt`；AI token 绑定正式删除 Preview | 软删除、规则刷新、operation、业务变更和强审计同一 SQLite 事务 | 默认 HTTP |

`create_recipe/update_recipe` 不再把 AI 提供的零件放入已废弃且不会参与保存的成本草稿字段；模型选择的普通零件先解析为稳定 `partId/model/supplier`，再作为 `optionalParts` 交给 `/api/recipes/save-payload-draft`，由权威 BOM 和 `costEngine` 重建最终 `partsJson` 与成本。已保存且可验证的普通可选零件增删改会进入正式保存；模板、线圈、电容、浮球、电缆等联动生成项不能被 AI 当作普通可选件直接移除或改数量，必须修改模板/配置。历史配方若 `extraPartsJson` 为空或缺失，executor 会先用正式保存草稿以 `optionalParts=[]` 重建当前 BOM；只有型号、供应商、数量和重复项完全解释现有 `partsJson` 时才继续，无法区分历史手工零件与生成项时返回 `RECIPE_OPTIONAL_PARTS_MIGRATION_REQUIRED`，要求先在配方页面核对保存，不会静默丢失或重复 BOM。

`update_recipe` 的确认不是按原始名称直接签发：服务端先通过正式配方 Query 解析名称，优先精确匹配，仅在部分匹配结果唯一时接受，否则对零匹配或多匹配 fail-closed，并绑定到 `recipeId/expectedUpdatedAt`；随后调用 `/api/recipes/save-payload-draft` 生成整份保存 Preview。规格更新可用 `newSpec`；清空已有规格既兼容显式 `newSpec:""`，也提供跨客户端推荐的 `clearSpec:true`，避免客户端省略空字符串，`clearSpec:true` 与非空 `newSpec` 同时出现会在确认前拒绝。重复零件目标、单次超过 15 项零件增删改、历史可选零件无法解释、仍带旧 `paintingWage` 迁移值、Preview 不完整或带 warning 时也均在确认前 fail-closed。原生确认完整展示正式配方、名称/规格/零件变化、BOM 条数和保存成本；token 只在服务端绑定规范参数与正式 draft。确认后直接消费该 draft 执行 `PATCH /api/recipes/:id`，不重新信任名称或重算未确认 payload；命令必须取得 `recipes.update` operation/audit 回执，并以 `GET /api/recipes/:id` 核对名称、规格、BOM、可选零件、成本、技术、包装（含 `boxType`）、工资及配置快照后才声明成功。由于正式保存会按当前目录和 `costEngine` 重建完整快照，修改规格并非只更新 `spec`；灰度恢复必须比较包含 `boxType/paintingWage` 的完整业务快照，不能只看规格文字。`delete_recipe` 复用同一唯一目标绑定规则，并在确认前调用 `POST /api/recipes/:id/delete-preview` 取得正式、无副作用的删除预览；预览返回规范目标、当前版本、BOM/成本摘要、软删除变化、库存/零件目录不变的影响说明和 warnings。预览不完整、带 warning、目标不存在或版本漂移时不签发确认。确认 token 在服务端绑定完整 Preview、`recipeId/expectedUpdatedAt`，确认后只按该稳定 ID 和版本调用正式删除 Command，不会重新按名称选择目标；成功必须取得 `recipes.delete` operation/audit 回执，并通过详情 404、列表不可见及相关目录不变核对软删除结果。

| `files.upload` | HTTP/Web | command/write | 经真实类型校验的文件字节 + `factory_files` | medium | 用户选择文件并上传即为明确动作 | 无 | 90 天持久化幂等 + SHA-256 内容去重 | 文件对象、operation 和强审计同一 SQLite 事务；需解析的新文件随后使用独立解析 operation | 60s |
| `files.upload_business_attachment` | HTTP/Web 通用业务附件区 | command/write | 经真实类型校验的文件字节 + `factory_files` + `factory_file_links` | high | 必须消费服务端确认 token | `/api/files/business-attachment-preview` | 90 天持久化幂等 + token 绑定文件哈希、业务目标和目标版本 | 原文件、业务关联、operation 和逐项强审计同一 SQLite 事务；解析作为提交后的独立 operation | 60s |
| `files.parse` | HTTP/Web；上传后可作为内部后续步骤 | maintenance/write | `factory_files.file_blob` + 本地解析器/OCR | medium | 上传或重新解析动作本身明确，无额外确认 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` + 15 分钟解析状态锁 | processing、accepted 回执和强审计先原子提交；解析/OCR 在长事务外；结果状态另行强审计并保存终态回执；中断后同键恢复或重建终态 | 120s |
| `files.delete` | HTTP/Web | command/write | `factory_files` + 知识、配方、业务关联和会话引用 | medium | 当前移除动作明确；软删除和引用保护是最终安全边界 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 引用检查、软删除、operation 和强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.conversations.create` | HTTP/Web | command/write | `ai_conversations` | medium | 新建会话按钮或首条消息本身是明确动作 | 无 | 90 天持久化幂等；新资源无版本 | 会话、operation 和强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.conversations.messages.append` | HTTP/Web | command/write | 当前会话 + `ai_conversation_messages` + 有效附件 | medium | 发送消息本身是明确动作 | 无 | 90 天持久化幂等 + 会话 `expectedUpdatedAt` | 消息、会话摘要、operation 和两条强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.conversations.messages.update_metadata` | HTTP/Web | command/write | 当前会话消息 | medium | 保存模型、工具和展示元数据，无额外确认 | 无 | 90 天持久化幂等 + 消息 `expectedUpdatedAt` | 消息元数据、operation 和强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.conversations.delete` | HTTP/Web | command/write | `ai_conversations` | medium | 页面删除确认是明确动作 | 无 | 90 天持久化幂等 + 会话 `expectedUpdatedAt` | 会话软删除、operation 和强审计同一 SQLite 事务；消息留存追溯 | 默认 HTTP |
| `ai.conversations.batch_delete` | HTTP/Web | command/write | `ai_conversations` | medium | 页面批量删除确认是明确动作 | 无 | 90 天持久化幂等 + 每个会话 `expectedUpdatedAt`；最多 50 条 | 选中会话软删除、operation 和逐项强审计同一 SQLite 事务；任一目标失败时整批回滚 | 默认 HTTP |
| `ai.health.read` | HTTP/Web | query/read | 当前模型配置 + 本进程有界遥测 + 最近内部发布评测 | low | 无 | 无 | 查询天然幂等 | 只读且脱敏；不保存或返回问题、回答与密钥 | 默认 HTTP |
| `ai.evaluations.runs.start` | HTTP/Web/发布门禁脚本 | maintenance/write | 手动启用或发布门禁启用的评测用例 + `ai_evaluation_runs` | medium | 启动检查本身是明确动作；`release` scope 只允许内部主体 | 无 | 90 天持久化幂等；新运行无版本 | 同 owner 未结束运行、当前运行、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.evaluations.results.record` | HTTP/Web/发布门禁脚本 | maintenance/write | 当前正式业务只读事实 + 评测用例 + `ai_evaluation_results` | medium | 自动评测记录，无额外确认 | 无 | 90 天持久化幂等 + 运行 `expectedUpdatedAt` + `(runId, caseId)` 唯一约束 | 单项结果、operation 和强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.evaluations.runs.complete` | HTTP/Web/发布门禁脚本 | maintenance/write | 当前运行及其已保存结果 | medium | 完成检查本身是明确动作 | 无 | 90 天持久化幂等 + 运行 `expectedUpdatedAt` | 汇总状态、operation 和强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.evaluations.cases.review` | HTTP/Web | maintenance/write | 纠错回归用例 + 关联纠正规则状态 | medium | 审核按钮本身是明确治理动作 | 无 | 90 天持久化幂等 + 用例 `expectedUpdatedAt` | 审核状态、operation 和强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.evaluations.system_cases.configure` | HTTP/Web | maintenance/write | 非核心内置系统评测用例的启用状态 | medium | 启用或停用按钮本身是明确治理动作 | 无 | 90 天持久化幂等 + 用例 `expectedUpdatedAt` | 开关、operation 和强审计同一 SQLite 事务；`release_gate_enabled=1` 的核心系统用例拒绝停用 | 默认 HTTP |
| `ai.feedback.list` | HTTP/Web | query/read | 回答反馈快照 + 原会话 owner/删除状态 | low | 无 | 无 | 查询天然幂等 | 只读；原会话软删除后反馈继续保留并按 owner 隔离 | 15s |
| `ai.feedback.submit` | HTTP/Web | maintenance/write | 已保存 AI 回复 + 回答反馈 + 可选纠正规则/回归用例 | medium | 点赞或提交问题本身是明确动作 | 无 | 90 天持久化幂等；已有反馈绑定 `expectedUpdatedAt` | 反馈、派生规则、回归用例、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.feedback.diagnose` | HTTP/Web | maintenance/write | 当前反馈 + 当前知识同步状态 | medium | 诊断按钮本身是明确动作 | 无 | 90 天持久化幂等 + 反馈 `expectedUpdatedAt` | 诊断快照、operation 和强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.feedback.retest` | HTTP/Web | maintenance/write | 当前复测回答/工具依据 + 回答反馈 | medium | 复测流程本身是明确动作 | 无 | 90 天持久化幂等 + 反馈 `expectedUpdatedAt` | 复测快照、operation 和强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.feedback.review` | HTTP/Web | maintenance/write | `ai_answer_feedback` | medium | 处理按钮本身是明确动作 | 无 | 90 天持久化幂等 + 反馈 `expectedUpdatedAt` | 处理状态、operation 和强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.learning_rules.update` | HTTP/Web | maintenance/write | 长期纠正规则 + 派生回归用例 | medium | 启停/编辑按钮本身是明确治理动作 | 无 | 90 天持久化幂等 + 规则 `expectedUpdatedAt` | 规则、回归用例、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `ai.factory_profile.update` | HTTP/Web | command/write | `config.ai-factory-profile` | medium | 页面保存本身是明确动作 | 无 | 90 天持久化幂等 + 内容 SHA-256 `expectedVersion` | 配置、operation 和强审计同一 SQLite 事务；提交后才更新进程内配置 | 默认 HTTP |
| `quality.recipe_feedback.save` | HTTP/Web/`set_recipe_analysis_feedback` | maintenance/write | 当前配方 + 检查反馈 + 派生候选规则 | medium | 页面判断或 AI 外层确认 | 无 | 90 天持久化幂等；已有反馈绑定 `expectedUpdatedAt` | 反馈、候选、事件、派生知识、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `quality.recipe_feedback.resolve` | HTTP/Web | maintenance/write | 当前配方智能检查 + 检查反馈 + 派生候选规则 | medium | 页面确认已解决 | 无 | 90 天持久化幂等 + 反馈 `expectedUpdatedAt` | 反馈、候选、事件、派生知识、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `quality.rule_candidates.refresh` | HTTP/Web/`refresh_factory_rule_candidates` | maintenance/write | 配方反馈 + 当前配方版本 + 候选规则 | medium | 运维按钮或 AI 外层确认 | 无 | 90 天持久化幂等；SQLite 即时事务串行重算 | 候选、事件、派生知识、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `quality.rule_candidates.review` | HTTP/Web/`review_factory_rule_candidate` | maintenance/write | 当前候选证据 + 规则状态 + 派生知识 | medium | 页面审核或 AI 外层确认 | 先读取影响接口 | 90 天持久化幂等 + 候选规则 `expectedUpdatedAt` | 规则、事件、派生知识、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `quality.rule_events.restore` | HTTP/Web/`restore_factory_rule_event` | maintenance/write | 历史事件 + 当前证据 + 当前候选规则 | medium | 页面恢复或 AI 外层确认 | 先读取历史和当前候选 | 90 天持久化幂等 + 当前候选 `expectedUpdatedAt` | 恢复、事件、派生知识、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `workbench.execution_runs.record` | HTTP/AI internal | maintenance/write | `factory_workflow_runs` 二级执行证据 | medium | 仅在受保护业务动作已产生结果后内部记录 | 无 | 90 天持久化幂等；并发版本不适用 | 执行记录、保留清理、operation 和逐项强审计同一 SQLite 事务 | 默认 HTTP |
| `files.archive` | HTTP/Web/`archive_factory_file` | command/write | `factory_files` + `factory_file_links`；知识归档另含 `knowledge_documents` | high | 标准调用必须先取得服务端确认 token；旧直传归档参数仅兼容 | `/api/files/:id/archive-preview` | 90 天持久化幂等 + token 绑定文件、目标、关联和资料快照 | 资料、关联、operation、强审计同一 SQLite 事务 | 30s |
| `files.links.delete` | HTTP/Web | command/write | `factory_file_links` + 已确认订单资料引用 | medium | 页面删除确认 | 无 | 90 天持久化幂等 + `expectedUpdatedAt` | 软删除、operation、强审计同一 SQLite 事务 | 15s |
| `drawings.rotor.generate_pdf` | HTTP/Web/`generate_rotor_drawing` | external command/write | 转子参数与共享安全警报、`rotor_drawings`、FreeCAD | high | Web 展示正式警报后确认；AI 外层确认后若正式预览无警报才继续 | `/api/rotor/draw-preview` | 90 天持久化幂等 + token 绑定规范参数与警报快照 | operation 与 queued 记录先原子提交，随后执行外部出图并持久化终态 | 180s |
| `drawings.rotor.print_pdf` | HTTP/Web/`print_rotor_drawing` | external command/write | `rotor_drawings`、受控 PDF、默认打印机 | critical | AI 外层确认 + 正式服务端确认 | `/api/rotor/print/:jobId/preview` | 90 天持久化幂等 + token 绑定任务和文件版本 | operation 与强审计先提交，外部打印终态持久化；同键不重复发送 | 45s |

转子两项在 AI 层仍先返回确认卡片，未确认时不调用正式 CAD 或打印 API；AI 确认完成后，executor 还必须调用正式 `/draw-preview` 或 `/print/:jobId/preview` 获取业务确认凭证。正式出图预览只要包含安全警报，AI 就返回 `rotor_draw_preview_warning` 和完整 `warnings`，不调用 `/draw`；Web 则在确认框逐条展示警报，用户明确选择继续后才能消费 token。AI 确认卡片包含 `confirmationToken/operationId/argsHash/expiresAt`，正式业务预览包含独立的 `confirmationToken/operationId/inputHash/expiresAt/suggestedIdempotencyKey`。两层 token 都保存在单机 API 进程内，服务重启后自动失效；正式 operation 回执持久化在 SQLite，网络重试不会重复出图或打印。`drawings.rotor.generate_pdf` 显式登记 `completionMode=accepted_async`：正式 queued 记录、operation 和强审计原子提交后可返回 `accepted`，AI/MCP 只能说明任务已受理并返回 `jobId`，必须通过 `/api/rotor/status/:jobId` 回读终态；打印和其他普通命令仍只接受 `completed` 作为成功证据。库存、报价转订单、采购、订单核心写入、订单准备动作与待办、配方核心 CRUD、配方性能测试报告附件、转子、人工知识同步、知识资料上传/删除以及文件归档/解除关联正式命令已经使用数据库持久化回执、资源版本或预览绑定和强审计。

系统提示词按四层动态组装：不可编辑核心规则、当前工具路由命中的业务领域规则、可编辑工厂配置、与本轮问题相关的已启用纠正规则。普通闲聊不加载业务领域规则；业务问题只加载当前领域，关闭动态工具路由时加载全部领域作为故障回退。最终回复只呈现面向用户的结果，不展示内部思考、逐步推理、工具选择或处理过程；简单问题使用短段落，一般问题可使用一个简短标题和 2-5 个短要点，保留结论、关键数字或异常、必要下一步和风险。用户要求原因时提供可核验的关键依据，而非内部推理链；写入确认、失败原因和关键风险不得省略。工具计划、调用结果和来源由 Web 正文上方的默认折叠区承载。旧 `config.ai-system-prompt` 首次启动时先备份到 `ai-system-prompt-legacy-backup`，再按当前 8000 字和核心边界校验迁移；不合格旧内容只保留备份并回退安全默认配置。把保存逻辑从 route 抽到 `factoryProfileService`，内容 SHA-256 作为兼容表没有时间戳时的正式版本；事务成功后才替换进程内配置，审计失败会连同配置和 operation 一并回滚。核心规则和领域规则始终高于工厂配置和纠正规则。

规则执行采用统一优先级：系统核心规则 > 当前领域规则 > 已批准配方检查规则 > 正式工厂事实 > 用户回答纠错 > 工厂个性化配置。`sourceTable=business_rules` 是可直接引用的正式工厂事实；`factory_rule_candidates` 在知识索引中只是可追溯副本，只由配方智能检查服务执行。`factory_ai_rules` 不进入通用知识索引，只能在本轮经审批、有效期、范围和冲突解析后注入。纠正规则由可管理的 `conflictGroup` 明确定义规则主题，再结合范围、对象和类型生成稳定 `conflictKey`；原问题只是适用示例，不参与冲突身份。同组相同 `instruction` 按优先级、版本和更新时间去重；不同 `instruction` 由更高优先级胜出，最高优先级并列时整组标记为 `conflicted` 并暂停。

业务页右侧 AI 可额外发送 `pageContext: { resourceType: "order", resourceId, path: "/orders", view }`。后端只保留合法订单 ID，并将 `view` 限制为 `requirements/readiness/execution/items/purchase/todos`；客户端标签、指令或业务数值都会被丢弃。页面上下文只用于解析“这个订单”“下一步怎么处理”等指代，不写入会话消息，也不替代实时业务工具查询；明确指定其他订单或询问全部订单时，以用户文字为准。

本地新版要求价格、成本、库存、订单状态等易变业务数据从本轮正式工具读取，不强制独立的首轮规划或工具选择。金额回答缺少当前依据时最多提示一次继续取证，所有只读工具仍可组合；候选目录不能作为已经完成的成本预览摘要。复述用户本轮拟定价格不要求为此查库。明确查询知识库时使用知识库结果；若知识条目与实时业务 API 冲突，以实时业务值为准并提示同步知识库。

`local/local-first` 模式下，内置 AI 默认由能力注册表元数据和当前问题生成 1–8 项只读工具短名单，普通闲聊不发送工具 schema；`AI_LOCAL_TOOL_SHORTLIST_ENABLED=false` 可恢复全量目录。两个明确 `规格-片数` 简写的成本对比会确定性路由到两次 `calculate_coil_cost` 正式试算，并输出两侧成本与差额；明确的配方/成品/产品对比仍使用 `compare_recipes`。该策略不增加模型规划调用，也不改变通用 MCP 的 48 项固定只读目录。

### AI 会话历史

AI 工作台会把会话和消息保存到 SQLite。所有接口均需登录，并按当前登录身份隔离；历史消息中的待确认工具只读，不能从历史记录重复执行。

| 方法 | 路径 | 请求 | 说明 |
|---|---|---|---|
| `GET` | `/api/ai/conversations?limit=50` | 无 | 获取最近会话，默认 50 条，最大 100 条 |
| `POST` | `/api/ai/conversations` | `{ title, idempotencyKey? }`；推荐请求头 `Idempotency-Key`、`X-Operation-ID` | 能力 `ai.conversations.create`。创建会话，标题最大 80 字符；相同命令安全重放，返回保留会话字段的标准回执 |
| `GET` | `/api/ai/conversations/:id` | 无 | 获取会话及按时间排序的全部消息 |
| `POST` | `/api/ai/conversations/:id/messages` | `{ role, content, metadata?, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.conversations.messages.append`。追加消息并原子刷新会话摘要；用户附件放在 `metadata.attachments: [{ id }]`，服务端重新读取文件名、类型、大小和下载路径后保存。新调用绑定会话版本，同键重放不重复消息；旧调用兼容并返回保护缺失 warning |
| `PATCH` | `/api/ai/conversations/:id/messages/:messageId` | `{ metadata, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.conversations.messages.update_metadata`。更新已保存消息的工具执行结果；新调用绑定消息版本，相同命令安全重放，旧调用兼容 |
| `DELETE` | `/api/ai/conversations/:id` | `{ expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.conversations.delete`。软删除会话；历史消息保留在数据库中但不再展示。新调用绑定会话版本并持久幂等，旧空请求兼容 |
| `POST` | `/api/ai/conversations/batch-delete` | `{ items: [{ id, expectedUpdatedAt }] }`；推荐请求头 `Idempotency-Key` | 能力 `ai.conversations.batch_delete`。一次原子软删除 1–50 个当前 owner 的会话；重复 ID、目标不存在、越权或任一版本漂移均整批拒绝，历史消息继续留存追溯 |

### AI 回答反馈

用户可对已经保存的 AI 回复标记“准确”，或报告“内容错误、来源过期、资料不足”。反馈绑定 assistant 消息，并保存当时的用户问题、AI 回答和知识来源快照。只有用户选择“内容错误”、填写以后应遵守的可复用正确做法并明确勾选“让 AI 长期记住”时，系统才生成结构化纠正规则和唯一回归候选；其他反馈不会自动学习。规则具有全局/领域/对象范围、业务域、规则类型、规则主题、优先级、生效期、版本和冲突键。新候选一律待人工审核，批准前规则不会进入 AI 上下文。纠错规则始终不进入通用知识检索，避免过期、范围外或冲突规则从 RAG 旁路生效。规则独立于原会话，删除原对话不会删除规则。纠正规则只约束后续 AI 回答和工具选择，不修改知识原文或业务数据。

| 方法 | 路径 | 请求 | 说明 |
|---|---|---|---|
| `GET` | `/api/ai/feedback?conversationId=&status=&rating=&limit=50` | 无 | 能力 `ai.feedback.list`。按当前登录身份查询反馈和汇总；`status` 为 `open/resolved`，最大 100 条。每项返回 `conversationDeleted`；原会话已软删除的反馈仍返回并可继续处理 |
| `POST` | `/api/ai/feedback` | `{ messageId, rating, note?, learnFromCorrection?, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.feedback.submit`。新增或改判指定 AI 回复；`rating` 为 `helpful/incorrect/outdated/missing_source`。`learnFromCorrection=true` 仅允许用于 `incorrect` 且必须填写正确做法；反馈、规则和回归用例原子提交 |
| `POST` | `/api/ai/feedback/:id/diagnose` | `{ expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.feedback.diagnose`。对照当前知识概况并保存诊断快照；诊断不是业务事实，绑定反馈版本 |
| `POST` | `/api/ai/feedback/:id/retest` | `{ answerText, toolResults, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.feedback.retest`。保存使用原问题重新查询所得的新回答和来源，供人工对比；不自动归档 |
| `PATCH` | `/api/ai/feedback/:id` | `{ status, resolutionNote?, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.feedback.review`。将问题标记为待处理或已处理；处理说明最大 500 字符 |
| `GET` | `/api/ai/learning-rules?status=&effectiveStatus=&domain=&limit=100` | 无 | 能力 `ai.learning_rules.list`。列出结构化长期纠正规则、评测审批、版本、冲突和生效统计；`status` 为 `active/disabled`，`effectiveStatus` 可筛选 `effective/pending_review/scheduled/expired/conflicted/shadowed/duplicate/disabled` |
| `PATCH` | `/api/ai/learning-rules/:id` | `{ status?, title?, triggerText?, instruction?, scopeType?, domains?, objectType?, objectRef?, ruleType?, conflictGroup?, priority?, effectiveFrom?, expiresAt?, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.learning_rules.update`。更新结构化规则或启停；正文、示例、范围、类型或规则主题变化会升高规则版本、重建回归候选并恢复为待人工审核，批准前不生效 |

同一 `messageId` 只保留一条最新判断；`helpful` 自动设为 `resolved`，其余三类问题设为 `open`。同一反馈最多生成一条纠正规则，再次提交会更新原规则，不会重复堆积。改判为非内容错误或取消长期记住会停用已有关联规则。反馈、规则、回归候选绑定和处理写入均通过 `safeInsert/safeUpdate` 并进入审计日志。删除原 AI 会话只隐藏聊天历史，不删除已经提交的反馈快照、纠正规则、回归案例、诊断或复测记录；这些记录继续按原会话 owner 隔离并可治理，但已删除会话不能再新增或改判反馈。

运行时先排除停用、未审批、未到生效时间、已过期和范围不匹配的规则。对象规则必须同时匹配本轮规划的 `objectType` 和问题中的 `objectRef`；无法确认对象类型时不生效。同一规则主题和结构化范围才进入同一冲突组：同一正确做法只保留最高版本/优先级；不同做法由更高优先级胜出；最高优先级相同则整组标记冲突并暂停。随后按本轮问题和结构化业务域评分，最多将 8 条规则加入系统上下文。纠错规则不作为 RAG 知识条目检索；自由文本规则仍由模型执行，且低于核心安全和正式领域规则。

`GET /api/knowledge/overview` 的 `ruleGovernance` 只返回通用知识投影中的规则概况：`precedence` 是完整优先级，`stats/byKind/overlaps` 用于检查正式事实、配方检查副本和规范化文字重复。纠正规则的 `effective/conflicted/shadowed/duplicate` 状态以 `GET /api/ai/learning-rules` 为权威，不会再被统计或检索为知识条目。两类检查都只读，不删除原规则或证据。

诊断依据是反馈保存时的 `sourceTable + sourceId` 来源快照和 `/api/knowledge/overview` 当前内容哈希状态。无来源时会从原问题中的型号、编号或引号内容检索候选知识。管理界面的“重新验证”重新调用标准 AI 对话流并保存新回答，用户必须比较新旧内容后手工确认归档；系统不会根据模型自评自动判定正确。

### 知识库回归检查

回归检查使用项目内置用例重新调用标准 AI 对话流，再由确定性规则核对当前业务值、实际工具、来源类型、必需词和禁用词。AI 不参与给自己打分。首批用例覆盖零件当前价格、`12-220` 全部正式线圈方案、Excel 性能测试报告类型、测试模板无效字段、客户报价展示顺序和成品电缆语义。

管理待办中的 AI 回归健康信号只统计当前 `enabled=1` 且已审核通过的用例。用例停用后，其历史失败仍保留在运行记录中供追溯，但不再形成当前紧急待办；新启用且尚未包含在最近运行中的用例会标记为待检查，不能被旧运行误判为健康。

管理待办进展中的 `recurringItems/recurringCount` 只统计当前仍处于 active 状态且曾重新出现的事项；已归档的反复事项只保留在 `resolvedItems` 历史中，不能再被 AI 描述为当前反复待办。

| 方法 | 路径 | 请求 | 说明 |
|---|---|---|---|
| `GET` | `/api/ai/evaluations/overview` | 无 | 返回手动启用用例、全部内置系统检查项、手动/发布门禁统计、当前登录身份最近一次运行和逐项结果；`latestRunMatchesConfiguration` 标记历史结果是否仍对应当前配置 |
| `POST` | `/api/ai/evaluations/runs` | `{ scope?: 'manual' \| 'release', caseKey?: string }`；推荐请求头 `Idempotency-Key` | 能力 `ai.evaluations.runs.start`。页面默认 `manual`，所有 manual 运行必须使用普通登录身份；不传 `caseKey` 时运行所有已审核且手动启用的用例，传稳定 `caseKey` 时只创建一个已审核、已启用案例的诊断运行，未知、停用或待审核 key 分别返回明确错误。诊断使用独立 owner namespace，不会中止或替换同登录角色的 manual 全量运行。内部发布脚本使用 `release`，运行已批准、已启用且开启发布门禁的系统检查和用户纠错案例；服务端和 runner 复用同一发布策略，固定 9 条核心系统检查缺失、停用、待审或退出门禁时均拒绝启动，不能由其他案例凑数。`release` scope 拒绝登录用户调用并拒绝 `caseKey`，internal 身份拒绝 manual；正式发布运行写入独立 `owner_key=release:internal`，发布健康只读取该 namespace，升级前遗留的 `owner_key=internal` 手动记录不会被误判为发布结果。同一运行 namespace 内未完成旧运行会在事务中标为失败，相同命令重放不会重复建运行 |
| `POST` | `/api/ai/evaluations/runs/:id/results` | `{ caseId, answerText?, toolResults?, errorText?, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.evaluations.results.record`。保存单项 AI 回答并执行后端确定性判定；新调用绑定运行版本，同一运行和用例只记录一次。只能由创建该 manual/diagnostic 运行的登录主体或创建 release 运行的内部主体继续写入，访问判定与运行 namespace 共用同一服务契约 |
| `POST` | `/api/ai/evaluations/runs/:id/complete` | `{ expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.evaluations.runs.complete`。汇总通过、需修复和需确认数量并结束运行；已结束运行使用新键再次提交会拒绝，同键重试返回原回执。主体访问规则与结果写入相同，不能用原始登录角色直接比较 `release:` 或 `diagnostic:` 持久化 namespace |
| `PATCH` | `/api/ai/evaluations/cases/:id` | `{ reviewStatus, reviewNote?, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.evaluations.cases.review`。审核回答纠错生成的候选回归用例；`reviewStatus` 为 `pending/approved/rejected`，只有带确定性检查项且关联纠正规则仍启用的案例可以进入运行；新调用绑定用例版本 |
| `PATCH` | `/api/ai/evaluations/system-cases/:id` | `{ enabled, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `ai.evaluations.system_cases.configure`。只允许配置非核心内置系统检查项并绑定用例版本；迁移 72 将核心项纳入发布门禁，迁移 73 恢复旧页面曾停用的固定核心项；`release_gate_enabled=1` 的核心系统用例拒绝停用并返回 `409 AI_CORE_RELEASE_CASE_REQUIRED`，不修改知识内容或用户纠错案例 |

运行记录按登录身份隔离。`part_price` 规则直接读取当前 `parts.price`，不会把历史固定价格写入用例；客户报价规则读取当前有效报价数量，并检查回答是否把 `#3/#5` 这类数据库 ID 当成业务展示顺序。检查运行过程只读取业务数据，运行结果仅写入 `ai_evaluation_runs/results` 运维证据；案例审核和系统检查项配置只更新 `ai_evaluation_cases`，不会修改被检查的业务数据。五项写入均返回 operation、强审计和幂等回执。为兼容原页面和脚本，结果/运行自身的业务 `status` 保持原字段，标准命令状态另以 `operationStatus` 返回；旧调用缺少幂等键或版本时仍执行并返回 warning。

生产发布后执行 `npm run verify:ai-release`。该命令固定使用内部身份，以 `release` scope 运行 `approved + enabled + release_gate_enabled` 的案例；失败、待确认或模型调用错误返回非零状态，发布流程不能标记验收成功。开发诊断可执行 `npm run test:knowledge-case -- --case-key=<稳定 key>`，但只允许普通登录身份，报告明确标记 `mode=diagnostic` 和 `releaseGate=false`，不能作为发布证据。脚本在开始前按固定 `case_key` 要求 9 条核心系统案例全部存在、启用、审核通过并开启门禁，任一缺失都直接失败，不能用其他系统项凑数、用 `--case-key` 缩小 release scope 或以 `skipped` 绕过；`skipped` 仅保留给手动检查。当前 9 条内置系统案例由迁移 47、63、76 和 79 维护确定性规则，迁移 72 将已批准系统案例纳入发布门禁，迁移 73 恢复旧页面曾停用的原核心项；普通管理接口拒绝停用核心项。已批准且启用门禁的用户反馈案例继续额外参与。结果摘要写入 `logs/ai-release-gate-latest.json`，不含完整回答。迁移 48 起，依赖指定配方测试报告的案例会先读取当前业务库：资料存在时继续严格核对内容和来源，资料不存在时只接受明确的未找到或无法确认说明；客户或目标零件不存在时同样要求明确说明未找到，不把不存在的客户伪装成“0 份报价”，也不把不存在的零件伪装成“0 元”。迁移 63 的线圈绕组档案检查会核对当前 `12-120` 正式方案已保存的主副线线径和绕组值，并拒绝“没有绕组数据字段”这类错误结论；迁移 76 的模板配置成本检查会动态核对完整模板、线圈、浮球、木箱、珍珠棉与正式 `costEngine` 总成本，迁移 79 进一步要求最终回答明确复述 `12-120` 和带浮球，不能只依赖工具参数正确而省略配置条件。Mac Mini LaunchDaemon 安装脚本在 API ready 和 Web 登录页通过后自动执行该门禁。

迁移 50 将线圈正式方案回归从 `search_factory_knowledge` 改为 `search_coils`，要求实时正式 API 返回全部材质、槽眼和成本方案；知识快照不再作为线圈库存或当前成本的验收来源。迁移 51 进一步让该用例感知生产库是否存在目标规格：不存在时只接受明确零结果，存在时恢复材质、槽眼、成本和来源的严格检查。迁移 52 保留成品电缆的事实、工具和来源要求，同时接受“共同组成一条”“单一整体业务项”等等价正确措辞，避免发布门禁因表面词形产生假失败。

`learnFromCorrection=true` 会在保存长期纠正规则的同一事务中生成或更新一条 `source_type=feedback` 的回归案例。服务端只从明确引号、型号、带单位数字、正向分类和否定结论中生成确定性检查项；所有候选案例均以 `reviewStatus=pending`、`enabled=false` 进入人工审核，65 分只作为置信度和审核参考，不会触发自动批准。只有人工审核为 `approved` 且关联纠正规则仍有效时，案例才允许启用并进入回归；人工拒绝不会删除原反馈或长期规则，纠正规则停用时关联案例立即退出回归。历史纠正规则早期由迁移 42 回填候选案例，迁移 74 已统一撤销机器自动批准并恢复为待人工审核状态；`case_key/source_feedback_id` 唯一保证重复提交不会制造重复用例。

`search_customer_history` 先通过正式客户列表唯一定位客户，再调用 `/api/customers/:id/context`；“客户某某现有的全部报价/历史报价”由模型选择该工具，正式 API 负责筛选与身份判定。报价筛选、创建时间顺序、连续 `displaySequence` 和内部报价 ID 移除全部由 Query API 负责；无 `limit` 时返回全部，面向用户统一展示为“第 1 份、第 2 份”。测试报告规则允许“不是工程图纸”这类正确否定说明，只禁止把附件直接标成“参考图纸”。成品电缆用例要求引用正式业务规则，并明确线材、长度、插头和规格属于一个整体业务项。

默认助理通过 `aiExecutionEvidence` 核对正式执行证据，保留成功与失败工具结果；接口失败不能作为“没有数据”。`internalApiClient` 提供实际 API 调用依据。旧 `aiObservationV3` 和 Evidence Ledger 是保留的历史实验实现，不参与当前默认链。

本地聊天与 processAiChat 统一经 aiDispatcherV3 路由：查询进入 aiAssistantRuntime 的单模型循环，明确写命令进入 aiAgentRuntimeV3 的计划 → 确认卡 → 正式 executor/API → operation/audit 回执链。明确的“条件规则，记到长期记忆里/中”也由正式记忆服务保存；条件规则不等于假设性保存指令，否定、引用及询问不保存。保存回执独立返回；若本主体与会话仍有未取得成本预览的模板查询，保存后继续原问题，重新读取实时事实。续查失败保留已保存回执，过期或其他会话不自动续接。旧两阶段 planner、V4 实验实现保留为历史兼容代码，不是默认入口，也不作为 fallback/shadow。单次最多 7 个模型轮次、10 次工具提议；所有已登记 Query/Preview 跨域、跨类型可组合。生产实际版本及验收证据以发布检查清单为准。

旧 `aiEntityResolverV3` 实现仍供历史测试使用；不能把其自动规范化、探针或 resolutionReceipt 视为当前聊天行为。当前候选与标识处理见 [私人 AI 助理](ai-assistant.md)。

新版服务端按主体和 conversationId 保存上一轮正式工具结果与原问题，供紧邻候选选择或指代使用；返回的实时结果仍必须在本轮重查。旧 turnState 字段保留传输兼容，不能作为客户端指定实体或写授权入口。

注册表保留 `entityScopes` 元数据供兼容调用方使用；V1 私人助理不按 single/collection/global 裁减读取权限，可按用户目的组合全局和单对象查询。

`/api/ai/chat` 保留 SSE 协议兼容。新运行器主要发送 `status/content/tool_call/tool_result/detail/metrics/done/error`；`tool_plan/turn_state` 为既有协议事件，不能要求新循环每轮产生。模型调用前即发送 `status`，前端在请求期间实时显示当前阶段和已用时间。未开放业务工具的普通对话将供应商正文分片直接转发为多个 `content` 事件；有业务工具参与时，正文必须等工具回执和证据校验完成后再提交，工具草稿不得流入正式回复。`metrics` 在 `done` 前发送，包含总耗时、首条内容延迟、模型调用耗时、工具耗时及次数。Token 仅使用供应商返回的真实 usage；`tok/s` 优先使用供应商原生生成计时（llama.cpp 的 `predicted_n / predicted_ms`）并标记为“生成速度”，供应商不返回原生计时时，才用全部模型轮次的输出 Token 除以模型调用总耗时并标记为“有效速度”。精确速度需等供应商尾帧，因此在完成时固定显示。正常成功流以 done 结束；error 或提前断流不得视为完成。Next Web/PWA 在连接中断时自动重试一次，重试前清空本轮不完整正文、工具结果和轮次状态；第二次失败只显示错误，不保存半截回复。传输重试不授权业务写入。

AI 调度器 V3 能力目录中的草稿/编排工具均不直接写库：

- `search_coils`：调用 `/api/coils` 读取线圈/定子方案的实时完整档案，按 `spec/sheets/material/slotType/schemeCode/schemeStatus/isDefault/ratedVoltageV/ratedFrequencyHz/market/schemeFamilyCode` 类型化筛选；除库存、成本和方案状态外，还返回稳定方案编码、默认标记、电压、频率、市场、方案族、默认电容、默认搭配电缆线径及主副线漆包线线径/绕组数据。测试或停用方案继续携带明确 `schemeStatus`，空字段表示该方案未填写，不能推断系统没有该字段。不用知识快照回答当前线圈档案、库存或成本。
- `get_recipe_detail`：按配方 ID、名称或可唯一匹配的简称定位后调用 `/api/recipes/:id` 读取正式 BOM 明细；名称匹配忽略大小写，多条命中时返回结构化候选并等待下一轮选择。工具响应只输出标准 camelCase，不向 MCP/AI 扩散正式 API adapter 为旧调用方保留的 `Id/CreatedAt/UpdatedAt`。`includeCurrentCost=true` 时调用 `/api/recipes/current-costs` 并按 `recipeId` 选择同一配方，返回 `currentCost.currentTotalCost/sourceOfTruth=costEngine/costBasis=currentFullCost/asOf`；~~`currentCost.unitCost`~~ 仅为 DSH、Claude Code 等现有 Agent 的一个兼容周期废弃别名，值必须与 `currentTotalCost` 相同，调用方应迁移到 `currentTotalCost`，确认外部 Agent 无依赖后删除。`/api/recipes/:id/cost-preview` 只用于带覆盖参数的报价/试算，保存成本和空覆盖试算均不能冒充当前完整成本。
- `build_recipe_bom_draft`：调用 `/api/recipes/bom-draft`，按正式泵壳模板、线圈、浮球、电缆、包装和可选零件生成联动 BOM，并在同一响应的 `costPreview` 中返回 `sourceOfTruth=costEngine/costBasis=configuredBomDraft/currentTotalCost/partsCost/laborCost/pricingComplete/missingParts`。AI 可传本轮正式查询确认的 `coilId`，并传其材质与槽眼，以保持已选线圈方案身份；默认偏好先查当前正式默认方案，零个或多个默认须澄清，不能取第一条。AI 通过 `shellModel` 进入统一模板实体解析并绑定 `templateId`，不能把完整模板名缩成配方名。包装/可选零件必须落到正式 `partId/model/supplier`；简称先按同模板现有配方的一致选择解析，仍有多个正式候选时返回 `409 CONFIGURED_PART_AMBIGUOUS`，不存在时返回 `404 CONFIGURED_PART_NOT_FOUND`，不猜型号或价格。AI 默认开启 useRecipeBaseline（显式常用预设除外），不得把未提配置设为 false 或空数组；用户明确脱离已有配方时才关闭。显式 baseRecipeId 可独立定位模板，与指定模板冲突拒绝。该能力只读、不保存草稿。
- `preview_recipe_cost`：复用 V3 统一资源解析器按配方 ID、名称或可唯一匹配的简称解析已有配方。没有覆盖参数时调用 `/api/recipes/current-costs` 并返回 `currentTotalCost/sourceOfTruth=costEngine/costBasis=currentFullCost`；私人助理默认 `useRecipeBaseline=true`，有覆盖时调用 `/api/recipes/bom-draft`，按配方完整配置与当前价格重算，返回 `costBasis=configuredBomDraft`，包装按角色替换。API/MCP 未传该选项时保留兼容行为：存在覆盖参数时才调用 `/api/recipes/:id/cost-preview` 并返回同一主字段 `currentTotalCost` 及 `costBasis=overridePreview`。~~`unitCost`~~ 在两种口径中都只保留为与 `currentTotalCost` 等值的一个兼容周期废弃别名，调用方完成迁移后删除。名称匹配忽略大小写，多条命中时返回结构化候选，用户以序号、完整名称、后缀或规格确认后绑定正式 ID 并继续原成本目标。
- `preview_pump_shell_cost`：调用 `/api/recipes/bom-draft` 试算指定泵壳模板在某个机筒长度下的泵壳本体成本；适用于不锈钢机筒整体泵壳随长度加价。
- `full_calculate`：已有正式配方的兼容成本入口，必须传 `recipeId` 或可唯一匹配的 `recipeName`。它已统一委托配方角色覆盖预览：线圈、电容、浮球、电缆和包装替换原角色后只计一次，返回 `sourceOfTruth=costEngine` 及 `costBasis=currentFullCost|overridePreview`，不再把临时配置机械叠加到保存 BOM。兼容字段 ~~`pumphousing_model`~~ 仍只按配方名解析。泵壳模板 + 临时配置的完整成本必须用 `build_recipe_bom_draft`；仅泵壳本体且指定机筒长度才用 `preview_pump_shell_cost`。
- `build_quotation_draft`：调用 `/api/quotations/save-payload-draft` 生成报价保存草稿。
- `build_order_draft`：调用 `/api/orders/save-payload-draft` 生成订单保存草稿、采购清单和待办。
- `search_customer_history`：调用 `/api/customers/:id/context` 查询正式客户、报价和订单历史，供报价前参考；AI executor 不再拉取全量报价/订单自行拼接。
- `compare_recipes` / `explain_cost_change`：统一调用 `/api/cost/recipe-difference`，按当日完整成本比较两个配方，包含工资、表面处理和管理费；两者不再各自重算配件小计。两项能力都登记 `dataMode=live`、`resultProvenance=live_business` 和 `sourceOfTruth=costEngine`。差额统一按“对比配方（配方2/right）减基准配方（配方1/left）”计算，正数表示对比配方更贵。
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
- `sync_factory_knowledge`：先调用 `/api/knowledge/sync-preview` 绑定当前正式来源与派生知识快照，再调用 `/api/knowledge/sync` 增量更新知识条目并刷新 FTS；该工具写入派生索引，位于写工具白名单，AI 确认和正式业务确认两层都不能绕过。
- `save_order_requirement_draft`：把已经展示并经用户明确要求保存的订单客户要求归纳结果写入可编辑草稿；必须使用真实订单 ID 和已关联附件的精确文件 ID，需确认后执行。该工具不能确认知识，也不能修改订单明细、配方、采购或库存。
- `save_order_execution_draft`：把用户明确陈述的订单执行事实新建为可编辑草稿；必须区分生产前/中/后和事实类型，建议、预测与待办不能写成已发生事实。该工具需确认后执行，但仍不能确认知识或修改订单状态、配方、采购和库存。
- `get_order_knowledge_package`：按订单 ID、客户名或合同号读取 V10.4 只读订单知识包。除直接知识查询外，`get_order_detail`、`check_order_readiness`、`plan_order_readiness_actions` 在能力注册表声明本工具为只读伴随能力，调度器会复用同一订单目标自动调用；`get_recent_orders` 使用客户简称或合同号模糊筛选且唯一命中时，也会按正式结果 ID 自动伴随调用，多条命中不猜选。有确认知识时，调度器在回答合成载荷中把人工确认的客户要求和执行事实提升为优先证据，模型必须提取与当前问题相关的资料，不能因实时库存或准备度数据较长而漏掉；无记录时不主动展开，读取失败时整体证据不完整且不能作“没有异常”等否定结论；不属于 `WRITE_TOOLS`。
- `get_purchase_overview`：调用 `/api/orders/purchase-overview` 读取活动订单的当前采购汇总；支持 `supplier/pendingOnly/limit` 类型化筛选，默认最多 20 条重点任务。只读，不生成采购清单、不下单、不入库。
- `search_quotations`：调用正式 `GET /api/quotations`，支持 `status/customerName/limit` 类型化筛选并保留命中报价的全部正式字段。“报价中的报价”“还在报价中的报价”直接传 `status=报价中`；不先读取全量报价再由模型二次判断状态。`get_quotation_detail` 调用 `GET /api/quotations/:id` 稳定读取一份完整报价，保留全部明细、备注、转换信息和时间字段。
- `search_templates`：调用正式 `GET /api/templates` 筛选模板并保留每条完整正式档案；`get_template_detail` 按 ID 或唯一泵壳型号调用 `GET /api/templates/:id`，返回 BOM、泵壳组件、转子参数、工资、表面处理和套件成本。两者不得用字段白名单换取回答简洁。
- `get_recipe_technical_files`：先用正式配方列表按 ID 或完整名称定位配方，再调用 `/api/recipes/:id/technical-files` 读取性能测试报告摘要、可信测试曲线和服务端确定的最高扬程、最大流量、最大电流及最高机组效率；AI 必须直接使用 `files[].testCurve` 的正式统计和对应测试点回答，不得自行遍历列表选择极值，也不得从模板中的规定点、实测点或偏差推断。返回 `associationWarnings[]`：报告 `summary.model` 与关联配方名称不一致时使用 `technical_report_model_mismatch` 提醒核实归属，该提醒不否定附件已关联的事实。返回配方来源，只读且不修改附件。

AI 工具表不再暴露旧的 `query_recipe_cost_by_name`、`query_recipe_cost_by_id` 和 `get_all_parts`。零件、线圈、订单、采购、配方等自然语言事实查询由模型归纳为结构化意图和最小能力步骤，再生成类型化 tool 参数。参数直接按 `AI_TOOLS` 唯一 JSON schema 校验；未知字段、错误类型、非法枚举、缺失必填或越界数值不会执行。服务端不再剥离语义标签、删除停用词或把剩余文本重写成关键词；无法可靠映射时由模型明确歧义并请求必要信息。

八个业务域的正式筛选契约为：`search_parts(keyword/category/supplier/stockStatus/limit/数值边界)`、`search_coils(spec/sheets/material/slotType/schemeCode/schemeStatus/isDefault/ratedVoltageV/ratedFrequencyHz/market/schemeFamilyCode)`、`get_recent_orders(limit/status/customerName/contractNo)`、`search_quotations(status/customerName/limit)`、`get_purchase_overview(limit/supplier/pendingOnly)`、`get_all_recipes(keyword/hasTechnicalFiles)`、`search_customers(name/limit)`、`search_templates(shellModel/description/limit)`；客户历史另以 `search_customer_history(customerId|customerName, historyType?=all/quotation/order, keyword?, limit?)` 先唯一定位客户，`historyType` 决定正式 API 实际读取的报价/订单范围。配方、模板和报价明细分别使用 `get_recipe_detail`、`get_template_detail` 和 `get_quotation_detail`；纯成本和单配方技术档案分别使用 `preview_recipe_cost`、`get_recipe_technical_files`。正式 Query API 持有筛选语义，AI executor 只传递 schema 已验证参数、清理旧重复别名并保留正式资源全部 camelCase 字段；回答精简只发生在最终表达层。询问哪些配方有测试报告或数量时，模型必须选择 `get_all_recipes(hasTechnicalFiles=true)` 从正式关联表筛选，不得把“有测试报告的”作为成品型号。用户说“所有/全部”时不注入隐式 `limit`；只有明确“最近/前 N 个”才限制数量。

普通 AI 对话送入模型的累计只读证据上限为 262144 bytes。单项或累计超限时统一返回 `AI_QUERY_RESULT_TOO_LARGE`，保留正式执行证据但不删除任何业务字段，要求改用正式筛选、显式 `limit` 或单资源详情；该边界与 MCP 的独立结果上限职责分开。`get_quotation_detail` 的报价 ID 必须由用户明确给出、来自当前报价页面，或来自本轮已验证的 `search_quotations` 正式结果；模型猜测 ID 会被阻止。

当前 AI 使用单模型工具循环，不强制两阶段计划或单对象能力封锁。`订单/单子/单据` 均表示订单，因此“采购中的单子有几个”可调用 `get_recent_orders(status=采购中)`；`get_purchase_overview` 只用于采购任务、供应商、采购物料、待采购数量或采购进度。`get_order_detail` 接受明确 `orderId` 或客户名/合同号 `orderQuery` 二选一；名称查询通过正式 `/api/orders/lookup` 唯一解析，零匹配或多匹配均停止。订单读取工具的 `orderId` 必须出现在用户明确编号、当前订单页面上下文，或本轮已经通过正式 API 执行证据门的订单查询结果中；只读 `orderQuery` 可以保留用户简称，也允许模型扩展为可能的标准客户名或合同号候选，再由正式 API 唯一解析。这样“叶总”和“台州叶总”都能唯一解析为同一正式订单，后续生产准备和知识包查询可以安全复用该正式订单 ID；模型自行猜测 ID或缺少执行证据的结果仍会在正式 API 前被拒绝。机筒长度、线圈片数等会改变计算口径的业务数值同样必须来自用户明确输入或本轮正式结果。`search_quotations` 权威负责按报价状态等条件筛选当前报价列表；具名客户的全部报价或历史记录由 `search_customer_history` 负责，以区分客户不存在和客户存在但记录为零。`search_coils` 权威负责列出全部已有线圈方案、实时库存和完整档案，并通过 `schemeStatus` 区分正式、测试和停用；只有用户明确询问正式方案时才筛选 `official`。`calculate_coil_cost` 只负责指定方案的插值或自定义线重试算。回答应保留原始型号、单位和必要条件，不补造缺失日期。

`calculate_coil_cost` 在材质或槽眼未唯一时返回的正式候选保留 `pricingMode/kitPrice/wireWeight/copperBase/cost`，使套件价候选明确区分最终套件成本与不参与计价的参考线重、铜价基数。

R3 Claim Grounding 未启用时，计划内能力全部取得验证证据后，调度器另起无工具的回答提取请求，只传当前用户目标和本轮正式结果，不复用工具执行对话继续扩搜。供应商若把 DSML/tool call 协议写入文本，协议门会拦截并校正一次，内部标记不得成为最终回答。

R3 Claim Grounding 由独立开关 `AI_CLAIM_GROUNDING_V4_ENABLED=true` 启用，默认关闭，并且只有同时进入 R2 V4 的 `query/analysis + single` 首批 part/coil/template/recipe/cost 范围才生效。该路径不再把兼容 `toolResults` 直接交给自由 Markdown 合成，而是由服务端从 terminal InvestigationState、FactRequirements、Observations 和 Evidence Ledger 构造 verified Claims，检查 entity/predicate/时态/场景/单位/值与 required Fact coverage，再生成 AnswerPlan。单一事实、正式未找到、歧义和未验证失败均确定性输出；复杂多 Claim renderer 只能接收当前目标、AnswerPlan、Claim labels 和允许的 premise refs，不能使用工具或历史 assistant 结论，factual 内容最终仍由服务端按 Claim 输出。renderer 校验或一次受限修复失败时保留原 Claims 并确定性降级，不进入 legacy free-form composer。Claim identity 不含 capability/tool/planner；current cost 与 saved cost snapshot 不可互换，成本值只能来自正式成本 Evidence。

单一正式 Query 已完整回答当前列表或状态问题时，应直接整理结果，不再扩展相邻统计；当前目标需要不同职责的证据时，必须在意图计划中显式安排对应能力。知识库只用于用途、经验、规则依据、历史确认知识或用户明确点名的知识查询，不回答实时业务列表。零件低库存口径仍为库存 1–5；“有没有缺货的零件”只传 `stockStatus=out`，“列出所有零件”不传关键词，“列出电缆”只传 `keyword=电缆`；“列出还在报价中的报价”只传 `status=报价中`。订单状态的“改为/改成/设为/设置为/变更为”属于写意图，否定表达和“修改记录/历史/日志”查询不得升级为写操作。该调整不删除底层业务 API，也不影响历史会话中已保存的旧工具结果展示。

知识查询工具结果包含 `provenance` 和 `sources`。`provenance.kind=knowledge_snapshot` 表示最近一次知识同步快照；每个 source 包含 `knowledgeEntryId/title/sourceTable/sourceId/syncedAt/sourceUpdatedAt/freshness/knowledgePath/sourcePath`。`freshness` 支持 `fresh/pending_insert/pending_update/pending_delete`。价格、库存、订单状态等实时业务查询使用 `provenance.kind=live_business`；实时结果与知识快照冲突时以实时业务结果为准。

Next iPhone PWA `/ai` 复用本节接口：

- 文字指令通过 `apps/web-next/lib/ai.ts:streamAiChat()` 调用 `POST /api/ai/chat`。
- 手机网络导致 SSE 提前结束时，PWA 自动重试一次；只有收到 `done` 的完整回复才写入会话。“再试一次”“重试”等短指令会重新执行最近五条用户消息内最新的有效只读业务查询，不继承零件入库等写操作。
- 写操作确认通过 `apps/web-next/lib/ai.ts:confirmAiTool()` 调用 `POST /api/ai/confirm-tool`；参数需人工修改时，先由 `reviseAiToolConfirmation()` 调用 `POST /api/ai/confirm-tool/preview` 重新校验并签发新卡，不直接执行业务写入。
- 移动端不得绕过 AI executor 自由拼接业务 API；新增助手能力必须先登记能力注册表，再扩展 `tools.cjs`、对应 executor、正式 API、文档和契约测试。
- PWA 使用 JWT Cookie 鉴权，未登录时由 `proxyFetch()` 跳转 `/login`。
## 17. 数据质量

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/quality/summary` | 无 | 汇总零件、配方、模板、常用配置预设（历史类型 Model Variant）、线圈、客户和报价的数据质量问题；只读不写库 |
| `GET` | `/api/quality/business-alerts` | 无 | 汇总报价和订单经营异常提醒，如长期未跟进、低于成本、成本为 0、待采购卡住和可完成订单；只读不写库 |
| `POST` | `/api/quality/recipe-analysis` | `{ recipeId?, recipeName?, limit?, draft? }` | Knowledge V3 配方智能检查；可分析已保存配方，也可在 `draft.parts` 中提交当前未保存 BOM 草稿。返回相似配方、确定性配置矛盾、同类配方高频项、已批准规则的学习置信度和固定件价格异常；反馈后配方已修改时返回 `feedback.outdated=true`，旧“忽略/特殊情况”不再抑制当前提醒；只读不写库 |
| `POST` | `/api/quality/recipes/:recipeId/feedback` | `{ findingKey, findingType, decision, note?, findingSnapshot?, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `quality.recipe_feedback.save`。保存当前配方某条智能检查提醒的人工判断。服务端会覆盖并写入 `findingSnapshot.evidenceContext`，固化反馈时的配方、泵壳模板和时间，客户端不能指定证据归属。`decision` 支持 `confirmed/ignored/special_case/review`；已有反馈用 `expectedUpdatedAt` 防止并发覆盖；`peer_pattern` 反馈、候选规则、事件、派生知识、operation 与逐项强审计原子提交 |
| `POST` | `/api/quality/recipe-feedback/:id/resolve` | `{ note?, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `quality.recipe_feedback.resolve`。处理重新智能检查后已不再出现的待复核学习反馈。仅允许当前确实处于内容过期或模板漂移状态的 `peer_pattern` 反馈；保留原始证据快照，把判断恢复为 `review` 并原子刷新候选规则。当前仍有效、已处理、版本冲突或归档配方反馈返回 409 |
| `GET` | `/api/quality/rule-compliance` | 无 | 汇总全部已批准规则的当前执行情况，返回规则问题总数、受影响配方去重数量、例外数量以及各规则的实时影响明细；只读不写库 |
| `GET` | `/api/quality/rule-learning-health` | 查询参数 `limit?` | 扫描全部 `confirmed/special_case/ignored` 的 `peer_pattern` 反馈，包括尚未达到候选规则门槛的证据。返回 `active/outdated/drifted/archived` 状态、待重新检查配方和汇总；`limit` 为 1-200、默认 100；只读不写库 |
| `GET` | `/api/quality/rule-candidates` | 查询参数 `status?` | 读取候选业务规则及学习证据；状态支持 `candidate/approved/rejected/stale`。返回 `supportCount/specialCaseCount/ignoredCount/driftedCount/outdatedCount/confidenceScore/confidenceLevel/learningEvidence/needsReview/approvalEligible/approvalBlockers/approvalRequirements`；`learningEvidence.drifted/outdated` 仅追溯历史，不计入支持数 |
| `GET` | `/api/quality/rule-events` | 查询参数 `candidateId?`、`limit?` | 读取规则生命周期记录，按时间倒序返回 `eventType/previousStatus/newStatus/actor/note/snapshot/createdAt`；`candidateId` 可限定单条规则，`limit` 为 1-100、默认 30；只读不写库 |
| `POST` | `/api/quality/rule-events/:id/restore` | `{ restoreNote?, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `quality.rule_events.restore`。恢复该历史事件记录的 `candidate/approved/rejected` 审核状态，但保留规则当前内容、证据和置信度；`expectedUpdatedAt` 绑定当前候选版本，批准会按当前证据重新校验；恢复、事件、派生知识、operation 和强审计原子提交 |
| `POST` | `/api/quality/rule-candidates/refresh` | `{ idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `quality.rule_candidates.refresh`。从同一泵壳模板的 `peer_pattern` 反馈中归纳候选规则；反馈按生成时的模板和配方版本归属，后来更换模板标记为范围漂移，修改配方标记为内容过期并排除。至少 2 个不同配方确认才会进入候选；已批准规则失去最低支持时转为 `stale`，置信度跌破 65% 时撤回为 `candidate`。返回 `minimumEvidence/minimumConfidence` 及含 `suspended/driftedEvidence/outdatedEvidence` 的统计；相同幂等键不会重复刷新或重复写事件 |
| `GET` | `/api/quality/rule-candidates/:id/impact` | 无 | 只读计算规则对当前同模板配方的影响；按实时 BOM 和有效反馈分为 `compliant/needsReview/specialCases/ignored`。配方在反馈后修改时，旧例外以 `feedbackOutdated=true` 回到 `needsReview`；返回数量、配方清单和待复核占比，不修改配方 |
| `PATCH` | `/api/quality/rule-candidates/:id` | `{ status, reviewNote?, expectedUpdatedAt?, idempotencyKey? }`；推荐请求头 `Idempotency-Key` | 能力 `quality.rule_candidates.review`。人工审核候选规则；`status` 支持 `candidate/approved/rejected`。批准要求当前至少 2 个不同配方确认且置信度不低于 65%；`expectedUpdatedAt` 防止覆盖另一位审核者。返回 `knowledgeSync`，规则、事件、派生知识、operation 和强审计原子提交 |

数据质量报告返回 `score/totals/issues/topIssues`，用于 `/dashboard` 的“数据质量”视图和 AI 质量检查工具；旧 `/quality` 页面仅保留兼容跳转。常见检查包括零件价格/供应商/库存、配方 BOM 和保存成本、模板泵壳引用、线圈默认电容/线径、客户默认利润率和历史报价金额异常。

上述 5 个质量治理写入口保留原 URL 和业务字段。标准命令回执附加 `operationId/capabilityId/changes/warnings/auditId/auditIds/idempotentReplay/completedAt`；候选规则原有业务 `status` 继续保留，命令状态使用 `operationStatus`，避免破坏现有页面和 AI executor。未提供幂等键或资源版本的旧调用仍兼容执行并返回 warning，新 Web 调用已默认发送。

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

## 18. 统一文件 Files

V9.1 使用 `factory_files` 作为 PDF、Word、Excel、文本和图片的统一原文件对象。上传时以后端检测出的真实内容类型为准，不信任浏览器提交的 MIME；文件最大 10MB，支持 `.pdf/.doc/.docx/.xls/.xlsx/.csv/.txt/.md/.png/.jpg/.jpeg/.webp`。DOCX 必须包含 Word 主文档结构，DOC 必须是含 WordDocument 流的 OLE 文件；扩展名与文件签名不一致、无效 UTF-8 文本、损坏 Office 文件、危险可执行扩展名或空文件会在写库前拒绝。V9.2 对 PDF 提取文字层、页码、行坐标和连续表格行；V9.3 对 Excel/CSV 提取工作表、行列、单元格、公式和表格块；Word 提取正文、页眉页脚、脚注、尾注、批注和文本框；V9.4 对图片和无文字层 PDF 执行本地中英文 OCR；V9.5 使用 `factory_file_links` 把同一文件可追溯地关联到客户、报价、配方、质量问题或知识资料，不复制原文件。V10.1 增加订单客户要求文件关联。

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/files` | 查询参数 `detectedType?=pdf/spreadsheet/image/text`, `sourceType?`, `limit?` | 列出统一文件元数据，不返回二进制；默认 30 条，最大 100 条 |
| `POST` | `/api/files` | `multipart/form-data`: `file`；推荐请求头 `Idempotency-Key`、`X-Operation-ID` | 能力 `files.upload`。支持 PDF、Word、Excel、CSV、UTF-8 文本与常见图片并验证真实签名；按 SHA-256 去重，新文件返回 `201`，重复文件或幂等重放返回 `200`。文件、operation 和强审计原子提交；PDF、Word、表格或图片随后使用独立 `files.parse` operation 自动解析 |
| `POST` | `/api/files/business-attachment-preview` | `multipart/form-data`: `file, targetType, targetId, relationRole?, title?, note?, source?` | `files.upload_business_attachment` 只读预览；在内存校验文件真实类型、业务目标及目标版本，签发绑定文件 SHA-256 和目标快照的确认凭证，不存储文件 |
| `POST` | `/api/files/business-attachment` | `multipart/form-data`: `file, confirmationToken`；请求头 `Idempotency-Key` | 正式上传并归档业务附件；只接受预览绑定的业务目标。原文件和关联在同一事务提交，关联失败时文件、重复计数、审计和 operation 一并回滚；成功后再以独立 operation 解析文件 |
| `GET` | `/api/files/archive-targets` | 查询参数 `targetType=customer/quotation/order/recipe/recipe_analysis_feedback/ai_answer_feedback`, `query?`, `limit?` | 只读查找真实业务资料关联目标；订单可按客户名或合同号查找；返回业务标签和说明，供界面或 AI 消歧，不接受知识资料类型；路径中的 `archive-targets` 是历史兼容标识 |
| `GET` | `/api/files/links` | 查询参数 `targetType`, `targetId` | 按业务对象列出有效文件关联及文件元数据 |
| `GET` | `/api/files/:id` | 无 | 读取单个文件对象的类型、大小、哈希、解析状态和来源 |
| `GET` | `/api/files/:id/links` | 无 | 列出该文件当前关联的业务对象 |
| `POST` | `/api/files/:id/archive-preview` | `{ targetType, targetId?, relationRole?, title?, note?, documentType?, tags?, source? }` | `files.archive` 只读预览；校验真实目标和知识文件解析状态，返回文件/目标、预计变更、`confirmationToken`、`operationId`、快照哈希和建议幂等键，不写库 |
| `POST` | `/api/files/:id/archive` | 标准：`{ confirmationToken, idempotencyKey? }`，建议同时使用 `Idempotency-Key`；兼容：原 `{ targetType, ... }` | `files.archive` 正式命令；标准调用只执行 token 绑定的文件、目标、角色和元数据快照，快照变化返回 `409`；资料、关联、operation 和强审计原子提交，返回保留原 `link/knowledgeDocument/deduplicated` 字段的标准回执。旧直传归档参数仍可执行并返回 `legacy_archive_without_explicit_preview` warning，但没有跨请求重试保证，新调用禁止使用 |
| `DELETE` | `/api/files/:id/links/:linkId` | `{ expectedUpdatedAt?, idempotencyKey? }`，建议同时使用 `Idempotency-Key` | `files.links.delete` 正式命令；软删除指定文件关联，不删除原文件或目标业务记录；已被确认客户要求或执行档案引用时返回 `409`；旧空请求兼容但返回缺少版本/幂等保护 warning |
| `POST` | `/api/files/:id/parse` | JSON：`expectedUpdatedAt?`, `idempotencyKey?`；推荐请求头 `Idempotency-Key`、`X-Operation-ID` | 能力 `files.parse`。重新解析 PDF、Word、Excel、CSV 或图片；解析状态登记和外部解析使用持久化回执，同键重放不会重复 OCR 或文本提取。新调用绑定文件版本；旧空请求兼容但回执带版本/幂等保护缺失 warning。成功 `data` 保留文件字段并追加标准回执，失败仍返回当前文件状态 |
| `POST` | `/api/files/:id/quotation-draft` | `{ customerName? }` | 只读把已解析 Excel/CSV 报价文件映射为客户、配方、数量、文件单价和待确认项；只有全部精确匹配时返回 `quotationDraftInput`，不创建客户、配方或报价。文件待解析、解析失败、正在解析或解析器版本过期时返回 `409 factory_file_parse_required` 及 `parsePath`，调用方必须先显式执行 `/parse`，本接口不暗中写解析状态 |
| `GET` | `/api/files/:id/content` | 无 | 读取完整解析结果；PDF 包含逐页 `lines/tables`，表格包含逐工作表 `rows/cells/tables`，均保留原文定位且不返回原二进制 |
| `GET` | `/api/files/:id/download` | 可选 query：`inline=1` | 下载原文件；`inline=1` 时以浏览器内联方式返回，其他情况作为附件下载 |
| `DELETE` | `/api/files/:id` | JSON：`expectedUpdatedAt?`, `idempotencyKey?`；推荐请求头 `Idempotency-Key`、`X-Operation-ID` | 能力 `files.delete`。软删除未被业务资料引用的文件；引用检查、文件、operation 和强审计原子提交。仍被知识资料、配方测试报告、聊天历史或 `factory_file_links` 引用时返回 `409`；旧空请求兼容但回执带版本/幂等保护缺失 warning |

PDF 上传在上传命令提交后自动完成解析：有文字层的页面使用 `【第 N 页】`，无文字层页面自动渲染并使用 `【第 N 页 OCR】`；混合 PDF 按页面合并。文件字节及上传回执先提交，CPU 密集解析和 OCR 不占用 SQLite 长事务；解析状态、结果或失败各自使用强审计，并与同一解析 operation 关联。增加解析中断恢复：结果已经落库时重建终态回执，仍在新鲜锁内时返回 `processing`，锁超时后用原 operation 继续解析。PDF 文字层最多处理 100 页和 30 万字符，OCR 最多处理 12 个扫描页、单页最多约 700 万渲染像素。图片 OCR 支持 PNG、JPG 和 WebP，原图超过 4000 万像素会拒绝解析。OCR 结果保存逐页/逐行文字框与置信度，并生成只读 `drawingCandidates`；低于 85% 标记 `needsReview`。未识别到文字时为 `metadata_only + ocrApplied=true`，AI 不得猜测原图内容。表格最多处理 20 个工作表、5000 个非空行、100 列、5 万个非空单元格和 30 万字符；保留工作表名、行号、列号、单元格引用、公式与合并区域，超出部分通过 `truncated=true` 明示。

报价映射使用当前未归档客户和配方，只把精确名称/型号命中标记为可继续；客户型号精确命中优先于“规格”字段，避免常见规格同时出现在多个历史配方时把明确型号误判为多候选。近似匹配、同名重复、多个候选、数量无效、金额不一致和未找到记录都进入待确认项。`quotationDraftInput` 只是现有 `/api/quotations/save-payload-draft` 的候选入参，文件单价不等于系统成本，正式报价草稿仍必须由标准报价 API 按当前配方重新试算。该链路不自动新增客户或配方，也不写正式报价。

V9.5/V10.1 归档使用多态目标校验：客户、报价、订单、配方和知识资料必须仍处于有效状态；“质量问题”映射到现有 `recipe_analysis_feedback` 或 `ai_answer_feedback`，不虚构第三套质量表。归档到知识库只允许已经 `parsed/metadata_only` 的文件，系统创建的 `knowledge_documents` 复用 `factory_files.file_id`，并通过现有知识自动同步进入检索。在这些规则外增加正式 Preview → Confirmation → Command：确认凭证同时绑定原文件版本、真实目标版本、现有/已删除关联和知识资料状态，防止确认后目标或关联漂移；相同业务关联继续去重。AI 工具 `search_factory_file_archive_targets` 只读查目标，`archive_factory_file` 属于写工具，必须先显示 AI 确认卡片，确认后 executor 仍通过正式预览和命令 API 执行。聊天附件卡片也复用同一正式 client 并显示已有归档。OCR 参数候选即使随文件归档也不升级为已确认事实。

V9 收口后，客户详情、订单资料和质量反馈等通用业务附件入口统一使用 `/api/files/business-attachment-preview` → `/api/files/business-attachment`，不再由 Web 串联“先上传、后归档”；列表统一读取 `GET /api/files/links`，解除关联使用软删除接口。客户询价附件则在新建报价表单上传，最多选择 4 个来源调用 `/api/quotations/inquiry-summary-draft`，由 Kimi 直接读取原图或通过官方文件接口抽取原始文件内容后联合归纳；该专用链路不经过通用 AI 规划、本地 OCR 或 DeepSeek 回退。人工核对后的摘要、来源和全部附件经 `/api/quotations/save-payload-draft` 绑定预览，并在创建报价时原子归档。已建报价仅通过 `GET /api/quotations/:id/inquiry-summary` 只读查看，不提供补传或编辑入口，摘要始终不会改变正式报价金额或明细。AI 回答反馈也可在知识管理页关联问题截图或原始资料。业务页上传不会自动创建知识资料；需要长期检索时必须另行归档到 `knowledge_document`。

## 19. 工厂知识库 Knowledge

Knowledge Base V1 使用本地 SQLite `knowledge_entries` 表保存派生知识条目，并在 SQLite 支持 FTS5 时启用 `knowledge_entries_fts`；如果当前 SQLite 构建不支持 FTS5，搜索自动回退到 `LIKE`。

同步来源覆盖：零件、泵壳模板、配方、线圈、客户、报价、订单、数据质量问题、业务规则和独立工厂资料。配方知识条目会合并其性能测试报告解析文本，因此 AI 可检索报告型号、测试结论和每个性能点；上传或删除报告后由 V4 自动同步对应派生知识。配方条目的 `metadata.testReports` 以 `{ id, kind: "pump_performance_test", label: "性能测试报告", fileName }` 明确标识附件类型，测试报告不得作为图纸展示。知识条目字段统一为 camelCase 响应，核心字段包括 `id/entryType/sourceTable/sourceId/title/summary/content/tags/metadata/syncedAt/updatedAt`。

| 方法 | 路径 | 入参 | 返回/说明 |
|---|---|---|---|
| `GET` | `/api/knowledge/overview` | 无 | 只读生成当前业务知识快照，并用 `sourceTable + sourceId + contentHash` 与已同步条目比较；返回条目总量、分类覆盖、最近同步时间、FTS 状态、待新增/更新/移除清单和 `autoSync` 运行状态，不写数据库 |
| `GET` | `/api/knowledge/sync-runs` | 查询参数 `limit?`, `status?=success/failed` | 读取最近同步运行历史和汇总；返回自动/即时/手动模式、成功或失败、触发来源、尝试次数、耗时、变更统计和错误原因，最多保留最近 200 次 |
| `GET` | `/api/knowledge/health` | 无 | 只读检查自动同步关闭、等待或运行超时、未安排的知识变化和最近失败；返回 `healthy/attention/critical`、问题明细及是否建议人工恢复 |
| `GET` | `/api/knowledge/vector-health` | 无 | 只读返回向量扩展、embedding 模型、缓存目录、后台队列、覆盖率及最近运行；组件可用且混合检索开关开启时 `searchMode=hybrid`，否则为 `fts` |
| `GET` | `/api/knowledge/vector-sync-runs` | 查询参数 `limit?`, `status?=success/failed` | 读取最近向量同步历史和汇总，包含模型、维度、新增、更新、跳过、删除、失败、待处理和耗时，最多保留最近 200 次 |
| `GET` | `/api/knowledge/retrieval-evaluation` | 无 | 只读运行固定中文检索评测，对比 FTS/BM25、纯向量和混合检索的 Top 1/Top 3；返回 `status=passed/failed/incomplete`、逐项期望、名次、前三标题、验收结论和覆盖详情。验收至少执行 70% 固定用例，且精确、语义、错别字、别名等配置类别各有实际用例；前置资料跳过过多时只能标记 `incomplete`，不能显示通过。不调用外部 AI、不写数据库 |
| `GET` | `/api/knowledge/documents` | 无 | 列出未删除的独立工厂资料元数据，不返回文件二进制和提取全文 |
| `POST` | `/api/knowledge/documents` | `multipart/form-data`: `documentType`, `title`, `description?`, `contentText?`, `tags?`, `file?`, `idempotencyKey?`；推荐请求头 `Idempotency-Key`、`X-Operation-ID` | 能力 `knowledge.documents.upload`。导入独立工厂资料；必须填写技术内容或上传文件，文件最大 10MB，支持 `.txt/.md/.csv/.xls/.xlsx/.pdf`。上传是用户主动选取资料的 medium command，不额外要求确认；资料、统一文件对象、operation 和强审计在同一事务提交。返回保留原资料顶层字段，并增加标准命令回执 |
| `GET` | `/api/knowledge/documents/:id/download` | 无 | 下载独立工厂资料原文件 |
| `DELETE` | `/api/knowledge/documents/:id` | JSON：`expectedUpdatedAt?`, `idempotencyKey?`；推荐请求头 `Idempotency-Key`、`X-Operation-ID` | 能力 `knowledge.documents.delete`。软删除原始资料并触发对应派生知识移除；页面继续显式确认。新调用传资源版本和幂等键，旧无 body 调用兼容执行但回执带并发/重试保护缺失 warning |
| `GET` | `/api/knowledge` | 标准 query：`query?`, `entryType?`, `sourceTable?`, `limit?`；兼容别名：`keyword?`=`query?`、`type?`=`entryType?` | 使用 FTS/BM25 + 向量混合搜索知识条目；`entryType` 支持 `part/template/recipe/coil/customer/quotation/order/quality_issue/business_rule/document/change_event`。`change_event` 是 `business_change_events` 的可重建检索投影，结构化时间、领域和实体筛选仍以 `/api/business-changes` 为准；默认最多 10 条，最大 50 条。每项附带 `matchMode/evidenceLevel/exactMatch/keywordRank/vectorDistance/finalScore/relevantChunks`；`relevantChunks` 是条目召回后按当前 query 动态选择的有界正文片段，每段含 `chunkIndex/charStart/charEnd/content/relevanceScore`，搜索列表不返回无界完整 `content`，完整正文仍由详情接口读取。关键词与向量候选采用同一片段协议；`evidenceLevel=semantic_candidate` 表示纯语义候选，即使有相关片段也不能单独证明用途、兼容性或专用配件关系。型号、规格、客户名和合同号等精确命中优先。线圈条目以“规格-片数 + 材质 + 槽眼”区分，`defaultWireGauge` 在知识正文中标注为“默认搭配电缆线径”；新增调用只使用标准参数名 |
| `GET` | `/api/knowledge/:id` | 无 | 读取单条知识详情，包含完整 `content/tags/metadata` |
| `POST` | `/api/knowledge/sync-preview` | 无 | 能力 `knowledge.sync_derived` 的只读预览。计算正式业务来源和当前派生条目的内容哈希快照，返回新增/更新/移除明细、`previewHash`、服务端 `confirmationToken/operationId` 和建议幂等键；不写库 |
| `POST` | `/api/knowledge/sync` | 请求头 `Idempotency-Key`；`{ confirmationToken }` | 消费同步预览凭证并重新核对快照；漂移返回 409。派生条目、FTS、同步运行历史、operation 与强审计原子提交；提交后只调度可重建的向量增量任务。相同 key 重试返回原回执，不重复同步，不修改原业务资源 |

同步响应的 `stats` 包含 `total/inserted/updated/unchanged/deleted/byType`。任一业务条目或 FTS 写入失败时，整个同步事务回滚，继续保留上一版完整知识库。

概况响应的 `stats` 包含 `currentTotal/storedTotal/fresh/pendingTotal/pendingInsert/pendingUpdate/pendingDelete`，`byType` 按知识分类返回当前来源数、已同步数、最新数和待同步数。新鲜度以实际生成内容的哈希为准，不仅比较更新时间，因此不会因报告生成时间或质量检查时间变化产生虚假过期提示。

V4 自动同步监听标准写入 helper 中的核心来源变更，300ms 内的连续写入会合并为一次同步。`autoSync` 返回 `enabled/running/pending/pendingSources/lastRequestedAt/lastStartedAt/lastCompletedAt/lastFailedAt/lastError/consecutiveFailures/retryScheduled/lastResult`。失败会保留待同步来源并按 1 秒、5 秒、15 秒自动重试；人工 `/api/knowledge/sync` 成功后会清除失败和等待状态。可通过 `KNOWLEDGE_AUTO_SYNC_ENABLED=false` 临时关闭自动同步，人工同步不受影响。

V4 第二阶段使用 SQLite `knowledge_sync_runs` 保存同步运行历史。每次自动重试是独立记录，`attempt` 表示同一轮同步的尝试次数；正式人工同步的成功运行历史与派生条目、FTS、operation 和强审计同一事务提交，失败运行在回滚后单独记录。系统只保留最近 200 次运行，避免运行日志无限增长。

V4 第三阶段通过 `/api/knowledge/health` 汇总运行态、内容哈希差异和最近历史。待同步超过 60 秒、运行超过 120 秒、存在未安排变化或同步失败时产生告警；自动同步关闭只标记为需要关注。没有业务变化时，即使很久没有产生新同步记录也保持健康，避免时间型假告警。看板恢复动作继续使用受确认保护的人工同步入口。

V5.1 使用 SQLite `knowledge_documents` 保存系统外资料及可选原文件。`technical_note/pump_performance_test/drawing/spreadsheet/other` 是当前资料类型；文本和 Excel 提取正文进入 `document` 知识条目，性能测试报告继续复用水泵测试报告解析器。PDF 原件保存在 SQLite，但 `parserStatus=metadata_only`，当前只检索标题、说明、标签和文件信息；AI 不得据此推断图纸尺寸、材料、结构或其他正文参数。资料新增和软删除均自动触发知识同步。V5.1 写入口现已委托 `knowledgeDocuments` service：上传的文件哈希参与命令请求指纹，相同幂等键重试不会重复建资料或增加文件重复计数；删除使用 `expectedUpdatedAt` 防止基于旧页面状态误删。

V6.1 增加本地向量底座，但不改变现有搜索结果。`knowledge_embeddings` 以 `entryId + model` 唯一保存 384 维 Float32 BLOB、内容哈希和更新时间；`sqlite-vec v0.1.9` 负责余弦距离计算，`@huggingface/transformers v4.2.0` 按需加载 `Xenova/multilingual-e5-small`。模型默认缓存到当前用户的 `.cache/pump-knowledge-models`，可用 `KNOWLEDGE_MODEL_CACHE_DIR` 指定目录；生产机联网时先运行 `npm run knowledge:model-prepare` 完成首次缓存和真实 embedding 检查，再设置 `KNOWLEDGE_MODEL_OFFLINE=true` 并重启。`npm run knowledge:vector-check` 只检查扩展与运行时，不下载模型。

V6.2 在每次文字知识成功提交后请求独立后台队列，按 `knowledge_entries.content_hash` 分批生成新增或变化向量。每批成功即提交，模型加载或单批失败不会回滚业务数据、文字知识和其他成功批次；失败任务自动重试，来源删除通过外键立即级联删除向量。模型或维度变化时，新模型可断点生成，全部当前向量新鲜后才清理旧模型，检索链路不会混用模型。`knowledge_vector_sync_runs` 持久化新增、更新、跳过、删除、失败、待处理和耗时；可用 `KNOWLEDGE_VECTOR_AUTO_SYNC_ENABLED=false` 关闭后台生成，`KNOWLEDGE_VECTOR_BATCH_SIZE` 默认 16、最大 64。

V6.3 的搜索先分别取得 FTS/BM25 与当前模型的新鲜向量候选，再使用稳定 RRF 融合。标题、来源标识和型号、规格、客户名、合同号等结构化元数据包含完整查询词时增加确定性优先级，不会被语义近似项挤出；已有精确关键词命中时不追加纯向量近似项，避免把相邻型号或规格混入回答。两条链路共同使用 `entryType/sourceTable` 过滤；查询 embedding、sqlite-vec 或模型加载失败时返回原 FTS/LIKE 结果，并将结果标记为 `keyword/exact` 而非伪造 `vector/hybrid`。`KNOWLEDGE_HYBRID_SEARCH_ENABLED=false` 可临时关闭混合检索，AI 仍使用原 `search_factory_knowledge` 工具入口。

V6.4 使用 11 条固定中文样例验收检索层，覆盖精确泵壳型号、用途口语、错别字、菲律宾配方、线圈材质与槽眼、成品电缆、完整成本、客户报价和测试报告别名。`npm run test:knowledge-retrieval` 复用运行中 API 的本地 embedding 模型执行，不调用外部 AI；每条固定样例先以正式知识标题检查前置资料，测试库缺少目标资料时明确记为 `missing_prerequisite` 并从 Top1/Top3 分母排除，不再误报为检索算法失败。实际评测至少执行 70% 固定样例，并覆盖配置中的精确、语义、错别字和别名类别；覆盖不足返回 `status=incomplete`。覆盖完整后，混合检索不得降低 FTS 的 Top 1/Top 3，精确样例必须保持 Top 1，且语义样例的 Top 3 必须得到提升。`npm run knowledge:backup-check` 使用 SQLite 在线备份创建临时恢复库，并自动验证完整性、外键、条目/向量数量和实际余弦查询，结束后删除临时文件。

向量结果只负责召回候选，不自动成为业务事实。搜索结果中的 `exact_text/text_match` 表示存在可核对的文本命中，`semantic_candidate` 表示仅语义相近；AI 只有在条目标题、摘要、正文或结构化元数据明确写出用途、兼容性或配件关系时，才能使用“适合、专用、自带、配套”等肯定表述。知识库内置“切割泵壳与配件识别”正式规则，区分 800平刀切割泵壳、SPA 清水泵壳、外六角切边长螺丝和不配刀泵壳；回归检查覆盖这些结论，防止普通螺丝或 SPA 被误称为切割专用，也禁止在来源未写明时声称“全套含刀”。

AI 工具层采用证据优先门控：同一次搜索已有 `exact_text/text_match` 结果时，不把其余纯 `semantic_candidate` 候选交给回答模型；只有完全没有文本证据时才保留语义候选用于继续核对。产品用途、适用型号和专用配件问题会由服务端强制发起本轮知识查询，得到工具结果后移除历史 assistant 结论，仅保留用户上下文和本轮工具链，避免旧会话中的错误回答覆盖新证据。

AI 工具：

- `search_factory_knowledge`：只读搜索知识库。
- `get_factory_knowledge_detail`：只读读取详情。
- `get_factory_knowledge_health`：只读诊断自动同步状态、失败原因和人工恢复建议。
- `get_management_action_center`：只读汇总今天优先处理的订单、经营、质量、规则学习和知识库健康事项。
- `adjust_part_stock`：按零件精确型号批量增减零件库库存；属于 critical 写工具。服务端统一识别文字和符号库存增量，在确认前通过正式零件 Query 唯一解析目标并调用正式库存 Preview；零匹配返回相似候选，多匹配返回真实候选，预览不完整时停止，均不签发确认。确认卡仅由结构化 executor 回执生成并展示标准型号和正式 API 的当前/预计库存，模型文字无确认效力。预览凭证作为不下发客户端的服务端上下文绑定 AI confirmation token，确认后只调用一次正式 Command 并整批事务执行；随后核对 operation/audit、逐项变更数量和值并通过正式零件 Query 回读最终库存，任一不一致不得输出成功。
- `batch_update_prices`：按正式类别批量调价，或通过 `targets` 明确指定 1–8 个零件；属于 high 写工具。明确目标使用 `partId` 或完整 `model+supplier`，但两种选择器都必须在确认前通过本轮正式零件 Query 重新唯一绑定。零匹配、多匹配、重复目标、缺价，或正式 Preview 跳过、warning、价格漂移时不签发确认；确认卡完整展示全部标准零件身份及 Preview 的当前/预计价格。确认后消费服务端绑定的 `/prices-preview` 上下文执行一次 `/prices`，并核对 operation/audit、无重复的精确逐项 changes 集合和正式价格回读。
- `adjust_coil_stock`：按“规格俗称-片数”批量调整独立线圈成品库存，例如 `12-120` 表示规格 12、片数 120；属于写工具。确认卡生成前由 `aiCoilStockExecution` 唯一匹配正式材质/槽眼方案并调用正式 Preview，卡片展示数据库标准方案和变更前后库存；正式 Preview 凭证只绑定在服务端 AI confirmation token 中，确认后直接调用原子 Command，不再次信任模型参数。不得改写零件库存，匹配多个方案时停止并要求明确。
- `sync_factory_knowledge`：同步知识索引；因为会写 `knowledge_entries`，必须经过 AI 写操作确认。
- `save_order_requirement_draft`：经用户确认后保存订单客户要求草稿；草稿不属于正式知识，确认进入知识库和撤销确认只能在订单页面完成。
- `save_order_execution_draft`：经用户确认后新建订单执行事实草稿；AI 无权确认、撤销或删除正式事实，知识确认只能在订单页面完成。

## 20. 当前兼容边界

- 核心资源已补齐 `id/createdAt/updatedAt` 标准字段；`Id/CreatedAt/UpdatedAt` 是历史兼容字段，Web 页面必须使用标准字段。
- 零件、配方、订单、客户和报价的更新/删除统一使用 `/:id` 路径入口；旧式 body 带 ID 写入口已移除。
- 成本正式场景入口为 `/api/cost/parts`、`/api/recipes/cost-draft`、`/api/recipes/:id/cost-preview` 和 `/api/cost/full-estimate`；`/api/cost/dynamic` 仍有 AI executor 调用，继续兼容保留。
- `/api/cost/coil`、`/api/cost/float`、`/api/cost/cable`、`/api/cost/packing`、`/api/cost/overhead` 和 `/api/cost/recipe/by-name` 是待核对外部调用的兼容候选。当前阶段不得删除；新增调用不得依赖这些入口。
- `/api/model-variants` 有当前 Web 调用方，不是删除候选。
- `/api/rotor/order-pump-models` 当前仓库内主要剩余测试依赖，列为兼容观察项；确认外部调用和迁移路径前不得删除。
- `GET /api/rotor/history` 已输出 camelCase 标准字段；snake_case 字段仅作为历史兼容字段。
- `POST /api/rotor/draw`、`POST /api/rotor/chat` 标准响应为 `{ success, data/error }`。
- 客户和报价新增接口标准返回完整 `data` 对象，不再返回顶层 `id`。
- 正式业务资源的新增、动态更新和删除已分别收口到 `safeInsert`、`safeUpdate`、`softDelete` / `hardDelete`；系统初始化、`system_settings` / `config` UPSERT 仍属于基础设施边界。

未完成风险、整改状态和优先级不在本接口总表重复维护，统一见 [当前技术债与优化清单](./technical-debt.md)。当前接口自身存在的副作用或兼容行为已写在对应 Method/Path 行内。

线圈 AI 成本预览的身份处理：未指定 coilId/schemeCode 时，即使材质和槽眼相同，也先核对全部已登记方案，保留 testing 等方案状态，不默认把一个电气方案当成全部。唯一候选以标准 ID 绑定；无现成记录且维度完整时保留插值。只读试算调用现有 `/api/coils/calculate` 的 `includeTesting=true`，不改变方案状态、配方生产绑定或库存写入规则；停用方案仍由正式 service 拒绝试算。
