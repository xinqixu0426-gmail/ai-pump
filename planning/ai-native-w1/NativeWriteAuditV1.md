# NATIVE-W0 — Native Write 架构审计（复用既有受保护业务写基础设施）

**Ticket:** NATIVE-W0 — Native Write Architecture Audit
**Baseline:** `cb5be53e622292d4da0b9ce7906108e2fc69568b`（branch `ai-native/prod-canary-s2`）
**性质:** 只读审计与设计。**本票未实现任何 Native Write，未改业务 API / schema / costEngine / 确认策略，未部署。**
**机器可读附件:** `planning/ai-native-w1/write-capability-inventory.json`（95 条变更能力 + 注册表元数据）

---

## 0. 结论摘要

1. **不需要新建写引擎。** 现有"受保护业务写基础设施"已经覆盖期望流程的每一环：
   Native 预检 → 正式预览 → 服务端确认卡 → Owner 批准 → 业务 API 执行 → 回执/审计 → 回读核验。
2. **Native 写链路在代码层已经存在并已挂载**：`POST /api/ai/tasks/:taskId/write-preview|write-execute|write-reconcile`
   （`api/routes/ai/tasks.cjs:103/121/137`），由 `AI_NATIVE_WRITE_ENABLED=false` 通过
   `assertNativeWriteRollout()`（`tasks.cjs:33-42`）确定性 403 `AI_NATIVE_WRITE_DISABLED` 关闭。
3. **真正缺的东西很集中**（4 类，见 §15/§18）：
   (a) 生产里**没有任何进程启动 Native worker**（`TASK_WORKER_DEFAULT_ENABLED=false`，仅脚本引用），
       因此 detached 任务永不执行、租约过期恢复永不运行；
   (b) 写状态机缺 `PROPOSAL_READY` / `CONFIRMED` / `COMMITTED` / 显式 `NOT_STARTED` 四类状态，
       对账停在 `MISSING/PENDING/AMBIGUOUS` 时没有超时/升级出口；
   (c) 确认主体绑定用的是**原始 cookie token 哈希或 INTERNAL_SECRET 哈希**，不是 Owner 身份；
       "Owner 批准"与"内部凭据执行"在服务端尚无显式串联；
   (d) 除 7 个有正式 preflight 的写工具外，其余写工具的**执行期会按名称重新解析目标**（无冻结 id/版本），
       对 Native 写属于禁用面。
4. **一次性写是崩溃安全的**：`executePersistentCommand` 把「api_operations pending 行 + 业务写入 + 强审计 +
   业务变更事件 + completed 回执」放在**同一个 SQLite 事务**（`api/services/commandExecution.cjs:87-214`），
   崩溃要么全回滚（可安全重试），要么全部提交（按幂等键回放原回执）。这是本审计最重要的正面结论。
5. **删除不进入 V1**：17 个删除类能力中多数为软删除但**没有恢复 API**（全仓只有 1 个 restore 端点），
   `files.delete` 等可能不可逆（§13）。

**审计规模**：137 个正式业务能力中 **95 个变更能力**（`access=write` 或 `operation=command`）；
其中 29 个有预览、40 个要求确认、**只有 7 个**同时具备"正式 preflight + 冻结目标"；
AI 工具面暴露 29 个写工具、MCP 写目录 18 个。

---

## 1. 审计方法（§1/§2）

- 一切结论来自**当前 HEAD 代码**（`cb5be53`），不采信历史 planning 文档或旧工具计数。
- 变更能力清单由 `api/capabilities/registry.cjs` 的 `listBusinessCapabilities()` **运行时导出**生成
  （`access==='write' || operation==='command'`），并与 `api/routes/ai/tools.cjs`、`api/mcp/catalog.cjs`、
  `api/routes/ai/executor.cjs` 交叉核对；原始 95 行见附件 JSON。
- 关键链路（确认、幂等、事务、回读、恢复、授权边界）逐文件阅读，附 `file:line` 证据；未由代码证实的项标 `MISSING`。
- 本票为只读：未修改任何生产代码，仅新增 `planning/ai-native-w1/` 下的审计文档与清单。

---

## 2. §3 写基础设施清单（MODULE / ROLE / CONSUMER / AUTH / PREVIEW / CONFIRMATION / IDEMPOTENCY / ROLLBACK / VERIFY / NATIVE-READY）

| MODULE | ROLE | 当前活跃消费者 | 鉴权模型 | PREVIEW | CONFIRM | IDEMPOTENCY | ROLLBACK | POST-WRITE VERIFY | NATIVE-READY |
|---|---|---|---|---|---|---|---|---|---|
| `api/routes/ai/tasks.cjs` | Native 任务 HTTP（start/get/events/resume/cancel/**write-preview/execute/reconcile**） | `api/routes/ai.cjs:10` 挂载（生产） | ownerMiddleware + `assertNativeWriteRollout`（写端点） | ✅ 转发正式预览 | ✅ WAITING_APPROVAL | ✅ 幂等键 `Idempotency-Key` | ❌ | ✅ 转发回执/回读 | **PARTIAL**（reconcile 未过 rollout 门；见 §5/§15） |
| `api/services/aiTaskWriteBridgeV2.cjs` | Native 写入桥：preflight → 确认卡 → 执行 → 对账 | `api/routes/ai/tasks.cjs:8` | 依赖注入 `confirmationSubject` | ✅ `prepareAiTaskWriteConfirmationV2` | ✅ 冻结 task/tool/args/幂等键 | ✅ `spec.approvalOperationIds` + step.idempotencyKey | ❌ | ✅ | **PARTIAL**（白名单仅 2 个工具；见 §14） |
| `api/services/aiConfirmedToolExecution.cjs` | **唯一**确认写执行器（AI 与 MCP 共用） | `chat.cjs`、`mcp/write.cjs`、`aiTaskWriteBridgeV2.cjs` | subject 绑定 + 一次性消耗 | —（消费既有卡） | ✅ | ✅ 透传 operationId/幂等键 | ❌ | ✅ `hasVerifiedWriteExecution` 门 | **YES** |
| `api/services/aiToolConfirmation.cjs` | L1 确认卡（进程内 Map，5min，可回放回执） | chat/tasks/executor | subjectHash = cookie 哈希 / INTERNAL_SECRET 哈希 | — | ✅ | ✅ 单次执行 + 缓存回执 | ❌ | — | **PARTIAL**（重启即失效；主体非 Owner 语义） |
| `api/services/businessConfirmation.cjs` | L2 正式业务确认（进程内 Map，绑定 inputHash/previewHash/idempotencyKey）；**但全仓只有 9 个服务真正消费它** | 各受保护预览/命令路由 | `commandActorKey` 指纹 | ✅ 预览即正式快照 | ⚠️ 多数路由不消费（见 §4.1） | ✅ 绑定首个幂等键 | ❌ | — | **PARTIAL** |
| `api/services/commandExecution.cjs` | 持久命令封装：pending→exec→审计门→变更事件→completed 回执（**单事务**） | 全部正式命令 | 由路由传入 actorKey | — | — | ✅ `api_operations` UNIQUE(actor,capability,key) | ❌（原子回滚，非业务补偿） | ✅ 回执/审计/变更事件原子 | **YES** |
| `api/services/commandRequest.cjs` | 幂等键/operationId/actorKey 解析 | 各命令路由 | internal 指纹 / jwt 指纹 / role:iat | — | — | ✅ 键缺失→生成+兼容告警 | — | — | **YES** |
| `api/services/internalWriteAuthorization.cjs` | SEC-R0 机器写凭据边界（≥32 且 ≠INTERNAL_SECRET；定时安全比较） | `api.cjs:159` | 机器→机器 | — | — | — | — | — | **YES** |
| `api/services/aiProtectedCommandRoute.cjs` | 写意图确定性识别（command/domains/preferredCapability） | `aiDispatcherV3.cjs`（生产） | 服务端规则 | — | — | — | — | — | **YES**（识别层） |
| `api/routes/ai/internalApiClient.cjs` | AI→业务 API 内部客户端（GET 只读；mutating 自动带 `x-internal-write-secret`） | executor | 机器凭据 | — | — | ✅ 透传 `x-operation-id`/`Idempotency-Key` | — | — | **YES** |
| `api/routes/ai/executor.cjs` | 工具→正式 API 执行器 + 写前预览（`WRITE_PREFLIGHTS` **7 个**）+ 证据附着 | 生产 chat/tasks 链 | allowWrite 门（唯一 `true` 调用点在确认执行器） | ✅ 7 个工具 | ✅ `confirmationRows` | ✅ 透传 | — | ✅ 证据门 | **PARTIAL**（其余写工具无 preflight） |
| `api/services/aiExecutionEvidence.cjs` | 正式回执→verified 证据（kind=`formal_api_command`，需 operationId+capabilityId+auditIds） | executor/adapter/确认执行器 | — | — | — | — | — | ✅ 证据模型 | **YES** |
| `api/services/aiTaskOperationReadbackV2.cjs` | 按幂等键回读 `api_operations`（MISSING/PENDING/AMBIGUOUS/COMPLETED） | `tasks.cjs:9`（reconcile） | 任务所有者 + 审批 id 校验 | — | — | ✅ | — | ✅ 对账真源 | **YES** |
| `api/services/aiTaskStoreV2.cjs` / `aiTaskLifecycleV2.cjs` / `aiTaskRecoveryV2.cjs` | 任务持久化/状态机/崩溃恢复（租约 fencing、COMMAND 阻断重试） | store→worker(仅脚本)、reconcile 路由 | 租约 token | — | — | ✅ COMMAND step 持久化幂等键 | ❌ | ✅ 证据复核（tamper） | **PARTIAL**（worker 未接线；见 §5） |
| `api/services/aiTaskWorkerV2.cjs` | detached 单槽 leased worker | **仅 `scripts/run-ai-native-n5-1b-live.cjs`**（生产无人启动） | 租约 | — | — | — | — | — | **NO** |
| `api/db.cjs` `safeUpdate`/`safeInsert`/`softDelete`/`hardDelete` + `audit_log` | 自动审计的写助手（表/列白名单 `SAFE_TABLES:704`）；**无版本谓词**。注意：**强审计原子性只在 `executePersistentCommand` 内强制**（`requireAudit:true`，审计不足即整体回滚）；其它调用点审计失败被吞掉（`db.cjs:807-809`），属 best-effort | 全部服务 | — | — | — | — | — | — | **YES**（审计）/ 并发靠服务层断言 |
| `api/services/businessChanges.cjs` | `business_change_events` + 实体链接（变更历史） | 命令服务 | — | — | — | — | — | ✅ 变更记录 | **YES** |
| `api/services/resourceVersion.cjs` | `expectedUpdatedAt` 并发断言（`resource_version_conflict` 409） | 命令服务 | — | — | — | ✅ 乐观并发 | — | — | **YES** |

---

## 3. §4 当前业务变更能力枚举（95 条）

**总数与分布**（附件 JSON 为逐条明细）：

| 域 | 变更能力 | 域 | 变更能力 |
|---|---|---|---|
| `ai`（会话/评测/记忆/反馈/学习规则） | 17 | `purchasing` | 3 |
| `recipe` | 11 | `cost` | 3 |
| `catalog` | 10 | `customer` | 3 |
| `order` | 10 | `inventory` | 2 |
| `knowledge` | 7 | `template` | 2 |
| `quotation` | 6 | `configuration` | 1 |
| `drawing` | 6 | `management` | 1 |
| `file` | 6 | | |
| `coil` | 4 | **合计** | **95** |
| `quality` | 5 | | |

**元数据分布**（全部 95 条，来自注册表）：

| 维度 | 分布 |
|---|---|
| `supportsPreview` × `requiresConfirmation` | 预览+确认 **29**；仅确认 **11**；两者皆无 **55** |
| `idempotency` | 全部 95 条 = `persistent_actor_capability_key_request_hash_90_days`（统一声明，见 §6 实现） |
| `concurrencyControl` | `expectedUpdatedAt` 50；`confirmationToken_bound_*` 13；`not_applicable` 16；其余为组合式（`expectedVersions`、`expectedUpdatedAt+previewHash_bound_*` 等） |
| `transactionality` | 全部声明为「业务写 + 审计 + operation 回执原子」（个别为「先记录后外部副作用」） |
| `recordsBusinessChange` | **72 true** / 23 false |
| `riskLevel` | medium 47 / high 39 / critical 9 |
| 暴露面 | AI 写工具 **29**；MCP 写目录 **18**；**有正式 preflight 的 7** |

**7 个具备"正式 preflight + 冻结目标"的写能力**（`api/routes/ai/executor.cjs:44-52` `WRITE_PREFLIGHTS`）：

| AI 工具 | 正式能力 | 预览端点 | 风险 | 并发控制 |
|---|---|---|---|---|
| `adjust_part_stock` | `inventory.parts.batch_adjust_stock` | `/api/parts/batch-stock-preview` | critical | `confirmationToken_bound_inventory_snapshot` |
| `adjust_coil_stock` | `inventory.coils.adjust_stock` | `/api/coils/stock-adjustments-preview` | critical | `confirmationToken_bound_inventory_snapshot` |
| `batch_create_parts` | `parts.batch_create` | `/api/parts/batch-create-preview` | high | `confirmationToken_bound_absence_snapshot` |
| `batch_update_prices` | `parts.batch_update_prices` | `/api/parts/prices-preview` | high | `expectedVersions` |
| `delete_part` | `parts.delete` | `/api/parts/:id/delete-preview` | medium | `expectedUpdatedAt+confirmationToken_bound_delete_preview` |
| `delete_recipe` | `recipes.delete` | `/api/recipes/:id/delete-preview` | high | `expectedUpdatedAt+confirmationToken_bound_delete_preview` |
| `update_recipe` | `recipes.update` | `/api/recipes/save-payload-draft` | high | `expectedUpdatedAt` |

**无 preflight 的 AI 可见写能力（10 个，V1 禁用面）**：`parts.create`、`parts.update`、
`orders.requirements.save_draft`、`orders.execution_records.create_draft`、`orders.delete`、
`quality.recipe_feedback.save`、`quality.rule_candidates.refresh`、`quality.rule_candidates.review`、
`quality.rule_events.restore`、`workbench.execution_runs.record`——执行期按名称重新解析目标（§7）。

---

## 4. §5 确认模型审计（A–J）

系统里有**两层确认**，都是**进程内 Map（无 DB 持久化）**：
L1 = `aiToolConfirmation.cjs`（AI 确认卡）；L2 = `businessConfirmation.cjs`（正式业务确认，含 `previewHash`/幂等键绑定）。
**真正的防重复写在第三处**：`api_operations`（DB）。

| 问题 | 结论 | 证据 |
|---|---|---|
| A 执行前产出什么 | L1：32 字节随机 token，`Map` 以 `sha256(token)` 为键；条目含 capability/tool/**冻结 args**/**冻结 executionContext**/argsHash/subjectHash/resourceVersion/operationId/TTL/status/receipt | `aiToolConfirmation.cjs:6,91-114`；L2 `businessConfirmation.cjs:7,61-76` |
| B 预览↔执行绑定 | L1：`sha256(canonicalJson(args))`，消费时比对，不等即 409 `confirmation_payload_mismatch`；L2：冻结 input 的 `inputHash`，并由各服务再比 `previewHash` | `aiToolConfirmation.cjs:42-44,179-185`；`businessConfirmation.cjs:63`；`inventoryCommands.cjs:144,251` |
| C 目标身份是否冻结 | **7 个有 preflight 的工具**：冻结 `partId/recipeId + expectedUpdatedAt/previewHash`；执行期版本漂移 → 409 `resource_version_conflict`。**其余写工具**：无 preflight，执行期按名称重解析（last-writer-wins） | `aiPartExecution.cjs:206-229,590-596`；`recipeExecutors.cjs:544-550`；`resourceVersion.cjs:12-21`；反面证据 `aiPartExecution.cjs:691-727` |
| D 参数是否冻结 | 冻结：签发时 `cloneJson(args)`；执行只用服务端快照；调用方若传 `args` 必须哈希相等 | `aiToolConfirmation.cjs:93,100,102,225-227`；`aiConfirmedToolExecution.cjs:32`；`chat.cjs:387` |
| E 批准后能否改参数 | 不能。无任何改参代码路径；只能「重新预览」→ 旧卡置 `superseded` → 需重新批准。`editableFields[].locked` 只是 UI 元数据（服务端不强制） | `aiToolConfirmation.cjs:172-185,235-280`；`chat.cjs:341-368`；`executor.cjs:259-261` |
| F 是否过期 | L1/L2 均默认 5 分钟，钳制 [30s,15min]，过期删除并 409 `confirmation_token_expired`；`executing/revising` 条目容忍过期 | `aiToolConfirmation.cjs:4,94,143-153`；`businessConfirmation.cjs:5,64-67,109-116` |
| G 能否重放 | L1：执行中并发重复→409 `confirmation_in_progress`；完成后重放**返回缓存回执**（`idempotentReplay:true`）；失败后 token 死亡。L2：非一次性，绑定首个幂等键，换键→409 `confirmation_already_bound`。真正的写去重在 `api_operations` | `aiToolConfirmation.cjs:186-219`；`businessConfirmation.cjs:139-146`；`commandExecution.cjs:89-113` |
| H 批准是否绑定身份 | subjectHash = **`internal:sha256(INTERNAL_SECRET)`**（优先）或 **`jwt:sha256(cookie token)`** 或 `authenticated:role:iat`；不匹配→403 `confirmation_subject_mismatch`。**不是 JWT sub / Owner key**。因此内部机器主体无法消费 Owner 签发的卡（反之亦然），但"Owner 批准过"这件事在服务端只体现为"某个 cookie 会话哈希" | `aiToolConfirmation.cjs:322-333,103,154-160`；`commandRequest.cjs:15-25` |
| I 执行是否确定 | 是。`/api/ai/confirm-tool` → `executeConfirmedAiTool` → `consume` → `execute(toolName, 冻结args, {allowWrite:true})` → executor → `internalApiClient` → 业务路由；链路内**无模型调用**；`allowWrite:true` 全仓仅 1 处 | `chat.cjs:370-388`；`aiConfirmedToolExecution.cjs:9-52`；`executor.cjs:330,405-416` |
| J 进程重启后 | **两层确认全部丢失**（内存态），错误文案明确提示"服务已重启，请重新发起"；任务表只持久化不透明 `approvalOperationIds`，从不持久化 token | `aiToolConfirmation.cjs:139`；`businessConfirmation.cjs:105`；`aiTaskWriteBridgeV2.cjs:59-64` |

**额外发现（安全相关，供 §16 使用）**：
- `confirmAuth`（`chat.cjs:104-109`）只要求「内部密钥 或 任意有效 JWT」，**不是 Owner-only**；Owner 语义只在 AI 策略层判定（`aiNativeRolloutPolicy.cjs:34-38`）。
- AI/MCP 路由挂载在该 `/api` 内部密钥守卫**之前**（`api.cjs:88,143` vs `:150`），所以 `/api/ai/confirm-tool` 不受 SEC-R0 写门保护；但真正落到业务写时 `internalApiClient` 会带上写凭据，缺失则 403。
- `api.cjs:158` 对 `INTERNAL_SECRET` 使用普通 `===`（非定时安全），而同项目的 `isTrustedInternalAiRequest`/`confirmationSubjectForRequest` 用 `equalSecret`。

---

## 5. §6 任务/恢复语义（Native 写的主要安全阻塞点）

**真实状态机**：任务 14 态（`aiTaskContractV2.cjs:6`）+ 步骤 6 态（`:14`），转移表在 `:26-35`、`aiTaskStoreV2.cjs:325`；`SUCCEEDED` 要求全部 goal `VERIFIED`（`aiTaskStoreV2.cjs:196`）。

| 崩溃窗口 | 现有机制能判定什么 | 能否重复写 |
|---|---|---|
| POST 前崩溃 | 步骤已 `RUNNING`（**写前落盘**：`aiTaskControllerV2.cjs:1347-1351`），无回执；读步骤可重试 1 次，COMMAND 步骤进 `blocked: COMMAND_RECONCILIATION_REQUIRED` | 否 |
| POST 中崩溃 | 业务写与 `api_operations` pending 行在**同一事务**内，崩溃整体回滚 → 对外等价于 `MISSING` | 否（重试=首次执行） |
| POST 返回后、本地 checkpoint 前 | 步骤停在 `RUNNING` 无回执；COMMAND 走对账：按持久化幂等键查 `api_operations`，`completed` 即可判定成功 | 否 |
| 提交后、答案前 | `api_operations` 已 `completed` + `response_json`；重启后按回执复用（`VERIFIED_REUSED`） | 否 |

- **重复写风险当前为低**，但原因是"COMMAND 在任务运行时被硬禁用"（`aiTaskControllerV2.cjs:1338`、`aiTaskCapabilityAdapterV2.cjs:335`）＋"恢复期阻断 COMMAND 步骤"（`aiTaskRecoveryV2.cjs:45`），而不是因为重试逻辑本身对写安全。
- **对账没有终局出口**：`MISSING/PENDING/AMBIGUOUS` 只返回 `resolved:false`，任务可长期停在 `RECONCILING`，无超时/退避/人工升级（`aiTaskWriteBridgeV2.cjs:175-181`）。
- **生产没有 worker**：`createAiTaskWorkerV2` 只被 `scripts/run-ai-native-n5-1b-live.cjs` 引用，`TASK_WORKER_DEFAULT_ENABLED=false`，无人调用 `worker.start()`；因此 `recoverExpiredLeases` 在生产从不运行，detached 任务不会被认领执行。
- **租约 fencing 正确但不能中止在途调用**：租约丢失后旧持有者的落盘写全部 `LEASE_FENCED`，但在途 HTTP 不会被取消（`internalApiClient.cjs:26` 只用请求信号）。
- **任务层无业务补偿/回滚**（`aiTask*` 内 grep 无 compensation/undo）。
- **QUERY/PREVIEW 步骤没有幂等键**（`aiTaskCapabilityAdapterV2.cjs:361`），仅在"只读无副作用"前提下安全。
- **COMMAND 步骤的幂等键是稳定的**：来自正式预览的 `suggestedIdempotencyKey`，入账到步骤（`aiTaskWriteBridgeV2.cjs:119-125`），并在对账时用于查 `api_operations`（`aiTaskOperationReadbackV2.cjs:25-27`），不会每次重试重新生成。

**可判定性**：`NOT_STARTED` 无显式状态（只能靠"没有步骤行"推断）；`STARTED_UNKNOWN` 可（blocked 标记 / 步骤 `RUNNING`/`UNKNOWN_EFFECT`）；`COMMITTED` 只能从 `api_operations` 读出；`VERIFIED` 可（`SUCCEEDED` + 可信回执 + 证据校验）。

---

## 6. §7 幂等审计（真实实现）

- **键来源**：`Idempotency-Key` 头 > `body.idempotencyKey` > `X-Operation-ID`；都缺省时生成 `request:<requestId>` 并附**兼容告警** `idempotency_key_missing_compatibility`（即"未显式给键的调用跨请求重试不受保护"）。格式 `^[a-zA-Z0-9._:/-]{8,200}$`。（`commandRequest.cjs:28-48`、`commandExecution.cjs:5`）
- **存储与唯一性**：`api_operations`，`UNIQUE(actor_key, capability_id, idempotency_key)`，`request_hash=sha256(canonicalJson(input))`，`status CHECK(pending|completed)`，`expires_at` 90 天。（`schema.cjs:432-447`）
- **判重语义**（同一 `immediate` 事务内）：同 hash+completed → 返回**原回执**（`idempotentReplay:true`，不二次写）；同键不同 hash → 409 `idempotency_key_conflict`；存在 pending → 409 `operation_in_progress`。（`commandExecution.cjs:87-130,200-214`）
- **原子性**：pending 插入 → 业务写 → 强审计校验（不足即 500 `strong_audit_required` 整体回滚）→ 业务变更事件校验 → completed+回执，全部在一个事务里。
- **操作号暴露**：确认卡 `operationId`、回执 `operationId/confirmationOperationId/formalOperationIds`、错误体 `operationId`、对账按 `operation_id` 索引。
- **乐观并发**：`expectedUpdatedAt` 与 `record.updated_at` 比对，漂移→409 `resource_version_conflict`；**缺版本只是告警不是失败**；且 `safeUpdate` 自身**没有**版本谓词（并发控制完全依赖服务层"先读后断言"）。
- **分类**（按真实语义，不按例子推广）：
  - 幂等（重复执行结果相同）：`update_*`/`set_*` 型（赋值类）——但**大多数仍受版本断言保护**，重复执行通常以 409/回放结束；
  - **非幂等**：`inventory.*.adjust_stock`（增减）、`purchasing.*`（入库/下单）、`orders.execute_readiness_action`、`files/knowledge` 上传（有内容哈希去重）、`ai.*` 追加消息——这些**必须**依赖 `api_operations` 幂等键，不能靠"重试无害"。
  - 结论：**任何写重试都必须复用同一幂等键**，这点在 Native 桥里已实现，但**没有强制的全链路检查**（例如 reconcile 之外的路径不校验键存在）。

---

### 6.1 注册表元数据与实现的四类不一致（**对 V1 选型影响最大**）

1. **"要求确认" ≠ "真的消费确认"**：全仓只有 **9 个服务**真正调用 `consumeBusinessConfirmation`
   （`partCommands.cjs:473/903/1168`、`catalogRename.cjs:100`、`catalogMigration.cjs:39`、`catalogBindings.cjs:94`、
   `inventoryCommands.cjs:374/398`、`factoryFileCommands.cjs:136`、`factoryFileLifecycleCommands.cjs:316`、
   `knowledgeSyncCommand.cjs:120`、`rotorExternalCommands.cjs:317/476`）。其余"声明要确认"的写路由实际只靠
   **可选**的 `expectedUpdatedAt`/`previewHash`。
2. **存在一类"永远无法满足"的确认声明**：`issueBusinessConfirmation` 要求
   `requiresConfirmation && supportsPreview`（`businessConfirmation.cjs:53`），因此注册表里
   `requiresConfirmation=true` + `supportsPreview=false` 的条目根本签不出确认卡
   （`customers.delete`、`coils.delete`、`templates.delete`、`model_variants.delete`、`quotations.change_status/delete`、
   `orders.delete`、`orders.requirements.confirm/revoke`、`orders.execution_records.confirm/revoke/delete`、
   `recipes.technical_files.delete`、`drawings.rotor.delete/rename/link_history`、`knowledge.documents.delete`、
   `files.links.delete` 等）。
3. **版本与预览哈希都是"可选项"**：`assertExpectedUpdatedAt`（`resourceVersion.cjs:13`）与
   `assertPreviewHash`（`previewIntegrity.cjs:17`）对 falsy 直接返回；省略在订单/采购/报价/客户/质量/转子路径上
   一律降级为兼容告警。**唯一硬失败**的是 AI 齐料动作路径（`aiOrderReadinessExecution.cjs:43-47`）。
4. **`previewHash` 被嵌进 4 个确认输入，但执行时从不重新断言**（`partCommands.cjs:481/911`、`inventoryCommands.cjs:382`）——
   即"预览绑定"在多数路径上是**弱绑定**。

**对 V1 的含义**：只有"正式预览 + 服务端确认卡 + 版本断言 + 回读核验"四条同时成立的 7 个 preflight 能力，
才具备可宣称的强绑定；其余能力的"确认/版本"不能当作 Native 写安全依据。

### 6.2 写面总数与未登记写入口

- 注册表变更能力 **95**；实际 mutating HTTP 路由条目 **104**（含 2 条仅写内存确认态）。
- **未登记（无 capabilityId）的写入口**：全部 6 条 `/api/ai/tasks*`（write-execute 会真正写业务数据）、
  以及两个更弱的"兄弟路由"——`POST /api/coils/:id/stock-adjustment`（**无确认 token、无 previewHash、
  幂等键缺失时自动补**，是 `inventory.coils.adjust_stock` 的弱化旁路）与
  `POST /api/orders/:id/purchase-items/toggle`（**只按型号定位**，无版本/哈希）。
- 路由层**没有任何中间件按 `capabilityId` 或 `riskLevel` 授权**：写门是全局 JWT/内部写中间件 + 执行器 `allowWrite`。

---

## 7. §8 目标身份安全

- **满足"mention → canonical → 唯一 → 冻结 ID → 确认 → 同 ID 执行"的 7 个能力**：即 §3 表中的 `WRITE_PREFLIGHTS`。
  最完整的例子是 `adjust_part_stock`：型号→`partId` 精确匹配，0 命中→`part_stock_target_not_found`(+相似候选)、多命中→`part_stock_target_ambiguous`（整批停止）、重复→`part_stock_target_duplicate`；随后由**业务 API 预览**返回 `confirmationToken` + `suggestedIdempotencyKey` + 每项 `currentStock→nextStock`。（`aiPartExecution.cjs:452-494,549-597`）
- **不满足的写能力**（Native 禁用面）：无 preflight 的 10 个 AI 可见写能力 + 其余 66 个无预览写能力。
  典型反例 `update_part`：执行期用 `allParts.find(...)` 按名称重新解析，并把**当时读到的** `updatedAt` 当版本，因此预览与执行之间目标被改动会静默覆盖（`aiPartExecution.cjs:691-727`）。
- **不允许**的三种形态在现有 7 个 preflight 能力中都不存在；在其余能力中**普遍存在**（名称-only / 列表序号 / 模型给的 id）。

---

## 8. §9 写入输入接地分级

| 字段族 | 归类 | 证据 |
|---|---|---|
| 目标标识（`model`/`recipeName`/`orderId`/`customerName`） | `CANONICAL_LOOKUP`：必须由服务端解析为唯一正式 id（7 个 preflight 能力）或 `MODEL_GENERATED_FORBIDDEN`（其余写能力） | `aiPartExecution.cjs:452-494`；`recipeExecutors.cjs:345-377` |
| 数量/增减（`changeQty`、`qty`、`delta`） | `USER_SUPPLIED`（必须来自用户原话，且由服务端解析/校验；禁止模型推算） | `tools.cjs:156-190`；`aiPartExecution.cjs:552-555` |
| 价格（`price`、`percentChange`、`absoluteChange`） | `USER_SUPPLIED`；百分比/固定额由服务端确定性换算（`Math.round`），并逐项进入预览与回读 | `aiPartExecution.cjs:989-1006,927-967` |
| 成本/铜价等派生金额 | `DERIVED_DETERMINISTIC`（只允许 costEngine/正式 API 计算；AI 不得自算） | `api/services/costEngine.cjs`（生产唯一口径）；`aiAnswerGrounding.cjs` |
| 配方组件变更 | `USER_SUPPLIED` + 服务端 BOM/成本重算（草稿），执行后回读逐字段比对 | `recipeExecutors.cjs:525-548,345-377` |
| 备注/文本（`note`、`remark`） | `MODEL_GENERATED_ALLOWED`（无业务语义后果） | `aiPartExecution.cjs:110-113` |
| 版本（`expectedUpdatedAt`/`expectedVersion`） | `CANONICAL_LOOKUP`（必须由服务端读取，不接受模型自报） | `resourceVersion.cjs:3-21` |
| 幂等键/operationId | `DERIVED_DETERMINISTIC`（由正式预览签发） | `aiPartExecution.cjs:590-594` |
| 结果库存/结果价格 | `MODEL_GENERATED_FORBIDDEN`（只能来自回读） | `aiPartExecution.cjs:529-546,949-958` |

**原则**：schema 校验通过 ≠ 允许模型编造；`target id / 版本 / 数量 / 价格 / 成本` 四类必须来自用户原话或服务端确定性读取。

---

## 9. §10 预览 / 差异模型

| 能力 | 分级 | 证据 |
|---|---|---|
| 7 个 preflight 能力：BEFORE→AFTER、受影响实体、`confirmationRows` | **A：已存在** | `aiPartExecution.cjs:583-596`（`当前 X → 预计 Y`）；`recipeExecutors.cjs:536-541`（`BOM 条数 a→b`、`保存成本 a 元→b 元`） |
| 财务影响 | **A（部分）/ B**：库存与价格类预览只给数量/价格差；配方类预览**已含成本前后值**（costEngine 草稿）。其他场景可用只读成本 API 确定性计算（`/api/recipes/cost-preview`、`/api/cost/parts`、`/api/cost/full-estimate`） | `recipeExecutors.cjs:530-541`；`api/routes/cost.cjs` |
| 依赖对象影响 | **B**：现货 API 可确定性推导（如库存调整对订单齐料的影响、删件对 BOM 的引用），但没有现成的"预览期依赖影响"聚合 | registry 的 `recordsBusinessChange`/`sourceOfTruth`；`businessChanges.cjs` |
| 通用 DIFF 渲染 | **C（需要新逻辑，属展示层）** | — |

结论：**预览层不需要重建**；V1 只需要把正式预览已有的行投影成统一卡片（Native 侧），并可选接入只读成本 API 给出金额影响。

---

## 10. §11 写后验证

- **证据门（通用）**：`hasVerifiedWriteExecution` 要求 `kind='formal_api_command'` + 至少一条回执，且回执 `capabilityId ∈ formalCapabilityIds`、`status` 按 `completionMode`（同步=completed），并含 ≥1 个 `auditId`。（`aiExecutionEvidence.cjs:21-28,94-127,161-169`；`aiConfirmedToolExecution.cjs:45-52`）
- **独立回读（最强，覆盖 3 类）**：
  - 零件库存：数量一致 + 逐项 `partId/field=stock/from/to` 精确比对 + **重新 `GET /api/parts` 校验 `stock === nextStock`**，否则 `part_stock_readback_mismatch`。（`aiPartExecution.cjs:496-547`）
  - 零件价格：同样 `verifyPartPriceReadback`（`:927-967`）+ `assertExactPartFieldChanges`（`:332-368`）。
  - 配方修改：`assertRecipeUpdateReadback` 按草稿字段逐项回读，不一致→`recipe_update_readback_mismatch`。（`recipeExecutors.cjs:345-377,640-671`）
  - 零件删除：删除后回读目录必须看不到目标。（`aiPartExecution.cjs:278-303`）
- **对账真源**：`api_operations`（与业务写同事务），`readTaskCommandOperationV2` 输出 `MISSING/PENDING/AMBIGUOUS/COMPLETED` 并校验回执内部一致性。（`aiTaskOperationReadbackV2.cjs:15-43`）
- **缺口**：任务运行时的 worker/controller **不在**任何地方调用上述回读（只在 rollout 门后的 write-execute 里）；没有"答案生成后再核验一次"的钩子；没有定期核验器；除 count/字段等值外没有部分应用检测（多步操作）。

---

## 11. §12 回滚现实

- **没有业务级自动回滚**：`aiTask*` 层无补偿；`commandExecution` 的事务回滚只覆盖"单次命令内部失败"，一旦提交就没有反向操作。
- **原子性是主要安全网**：单命令 = 全有或全无（业务写+强审计+operation 回执同事务）。注意强审计的原子性**仅限于** `executePersistentCommand`；其它写点审计是 best-effort（`db.cjs:807-809` 吞掉审计异常）。
- **变更历史是不可变的只读记录**：`business_change_events` + `business_change_event_entities` 为 append-only（DDL 触发器 `schema.cjs:21-75`），变更历史 API 只读（`api/routes/businessChanges.cjs`）。15 个写能力 `recordsBusinessChange=false`，另有一批变更**根本不产生事件**：铜价/行情同步对线圈单价与成本的改写（`copperPriceUpdate.cjs:41-68`、registry `:1155,1171`）、`files.parse`、AI 会话/评测/反馈/记忆/学习规则、`quality.rule_candidates.refresh`、转子出图/打印——这些"改了业务数据但没有变更事件"，对 Native 写是可观测性缺口。
- **`order_revisions` 存了完整 before/after 快照，但没有任何代码读它做恢复**（grep 仅 `catalogReferenceAudit.cjs:19` + 前端类型）→ 典型"数据层可逆、代码层未实现"。
- 逐族现实（a=代码自动可逆；b=可经另一个 API 手工补偿；c=可补偿但未实现；d=不可逆）：

| 变更族 | 等级 | 可逆性来源 / 证据 |
|---|---|---|
| 零件 CRUD（改回字段） | **b** | `partCommands.cjs:558,703`（再发一次更新） |
| 零件库存调整 | **b** | `inventoryCommands.cjs:268`（反向 delta；**无流水台账**，只有审计） |
| 线圈库存调整 | **b** | `coilInventory.cjs:90-100`（有 `coil_stock_movements` 台账，含 `balance_after`） |
| 批量调价 | **c** | 预览带 `oldPrice`（`aiPartExecution.cjs:999-1005`），可再调回但无自动实现 |
| 配方 CRUD | **b** | `recipeCommands.cjs:776,881` |
| 配方修改后的成本变化 | **c** | 回读带 `savedTotalCost`（`recipeExecutors.cjs:663`），无反向执行 |
| 模板 CRUD | **b** | `templateCommands.cjs:537` |
| 订单编辑 | **c** | `order_revisions` 快照存在但无 apply 路径（`orderCommands.cjs:590-599`） |
| 订单状态 已关闭/已取消、报价 已拒绝/已转订单/已过时 | **d（终态）** | `orderWorkflow.cjs:5-22` |
| 客户 CRUD | **b** | `customerCommands.cjs:88,206` |
| 文件 / 文件关联 | **b** | 重新上传同 sha256 / 重新归档即"复活"（`factoryFileStore.cjs:293-305`、`factoryFileArchive.cjs:557-568`，有审计） |
| 知识文档 | **c** | `knowledgeDocuments.cjs:375` 软删，无恢复入口 |
| 知识条目/向量 | **a** | 派生数据，由同步重建（`knowledge.cjs:926`） |
| 设置 / 运行设置 | **b** | 重新下发更新，旧值在审计里（`businessSettingCommands.cjs:163`、`runtimeSettingCommands.cjs:93`） |
| 铜价同步引发的线圈单价/成本重写 | **c** | 有审计但**无变更事件**，无确定性逆向 |
| 质量规则候选 | **b** | `POST /api/quality/rule-events/:id/restore` |
| 转子历史/图纸、工作流运行 | **d** | 硬删 + 关联文件解绑（`rotorCommands.cjs:366,401-405`） |
| 整库 | **b** | 仅离线 `scripts/manage-database-backups.cjs:112`，无 API |

---

## 12. §13 删除语义（**V1 明确不含删除**）

- 删除类能力 **17 个**（`parts.delete/batch_delete`、`coils.delete`、`recipes.delete`、`templates.delete`、`model_variants.delete`、`customers.delete`、`quotations.delete`、`orders.delete`、`orders.execution_records.delete`、`recipes.technical_files.delete`、`drawings.rotor.delete_history`、`knowledge.documents.delete`、`files.delete`、`files.links.delete`、`ai.conversations.delete/batch_delete`）。
- **恢复能力只有 3 处**：`factory_file_links`（重新归档即复活）、`factory_files`（重新上传同 sha256 即复活）、`factory_rule_candidates` 状态（显式 `POST /api/quality/rule-events/:id/restore`）。其余 12 张软删表**没有任何恢复 API**。
- **依赖/引用检查严重不均**（这是比"无恢复"更硬的阻断理由）：
  - `delete_part` / `parts.batch_delete`：**完全没有引用检查**（`partCommands.cjs:947-987 / 847-894`）。删除后零件从 `dbGetAllParts` 消失（`db.cjs:574`），而配方仍保留 `partId/model` → **直接破坏 BOM 成本口径**；
  - `delete_recipe`、`model_variants.delete`：同样无引用检查（`recipeCommands.cjs:417-438`、`modelVariantCommands.cjs:474-536`）；
  - `coils.delete`：无 catalog profile 时是**硬删除**（`coilCommands.cjs:832`），且 `recipes.coil_id` / `pump_model_variants.coil_id` 为 `ON DELETE SET NULL`（`schema.cjs:181,515`）→ 静默级联；
  - `templates.delete` 有配方引用检查（`templateCommands.cjs:594-603`）、`delete_order` 有状态守卫（仅 待确认/已取消 可删，`orderCommands.cjs:651-657`；注意 AI 工具文案写的是「彻底删除」`tools.cjs:639`，与软删实现不一致）；
  - `drawings.rotor.delete_history`：硬删 + 解绑 PDF（`rotorCommands.cjs:340-412`）→ 不可逆；
  - `files.delete` / `files.links.delete`：软删 + 引用检查 + 可复活（相对安全）；
  - 硬删除的可追溯性只靠 `audit_log.old_value`，默认 365 天后被清理（`auditRetention.cjs:1`）。
- 结论：**Native Write V1 不含任何 DELETE**。若未来要开，前置条件是：引用检查统一化 + 恢复入口（或明确不可逆声明）+ 硬删改为软删。

---

## 13. §14 候选范围（V1 建议）

**选择依据**：确定性身份 + 成熟业务 API + 正式预览 + 确认 + 审计 + 可回读验证 + 有界影响面 + 可补偿。

**推荐 V1（3 个）**：

1. **`adjust_part_stock` → `inventory.parts.batch_adjust_stock`**（**首选**）
   - 身份：型号→`partId` 精确 fail-closed（0/多/重复全拒）`aiPartExecution.cjs:452-494`；
   - 预览：`/api/parts/batch-stock-preview` 返回 `currentStock→nextStock` + `confirmationToken` + 建议幂等键；
   - 验证：**最强**——数量+逐项 from/to+独立回读 `verifyPartStockReadback`（`:496-547`）；
   - 可补偿：反向调整；影响面：≤100 项、单次原子。
   - 注意：业务路由的 `previewHash` 是"嵌入确认输入但执行时不重新断言"，AI 层用"版本断言 + 回读核验"补偿了这一点；
     新增 V1 能力时必须把这两条补强写成准入断言（见 §20.5）。
2. **`batch_update_prices` → `parts.batch_update_prices`**
   - 身份：显式目标或按类别枚举，逐项进预览（`previewHash` 绑定），版本 `expectedVersions`；
   - 预览：`/api/parts/prices-preview` 给出每项 `oldPrice→newPrice`；
   - 验证：`verifyPartPriceReadback`（`:927-967`）；
   - **条件（两条，缺一不可）**：(a) 限制单次影响行数上限并在卡片上明示"影响 N 个零件/金额变化"（它是类别级批量，爆炸半径最大）；
     (b) 该路由**并不消费确认 token**（注册表声明 `requiresConfirmation=true`，实现只断言 `previewHash`+`expectedUpdatedAt`），
     所以 Native 侧必须由 write-preview 自己签发并消费 L1 卡，不能依赖业务路由的"确认"。
3. **`update_recipe` → `recipes.update`**
   - 身份：AI 层要求 `recipeName`（先精确、再子串 `includes` 匹配，**歧义会拒绝**），绑定后以 `recipeId` + 冻结草稿 + `expectedUpdatedAt` 进入预览与执行；
   - 预览：`save-payload-draft`（含 `previewHash`、BOM 条数与**成本前后值**）；
   - 验证：`assertRecipeUpdateReadback` 逐字段回读；业务价值高（改配方）。
   - **条件**：卡片必须展示成本前后值与 BOM 变化条数。

**NOT_FOR_V1**（含具体阻断理由）：

| 能力 | 理由 |
|---|---|
| `delete_part` / `delete_recipe` / 其余 15 个删除类 | 无恢复 API、依赖检查分散、部分不可逆（§13）。特别是 `delete_part` 虽然路由层强制 `expectedUpdatedAt`+`previewHash` 且歧义拒绝，但**完全没有引用检查**：删除后零件从目录消失而配方仍保留 `partId/model`，会直接破坏 BOM 成本 |
| `adjust_coil_stock` | 虽有正式预览 + 真实消费确认 token，但**没有独立回读核验**（`aiCoilStockExecution.cjs:112-137` 只回传 API 的 `adjustments/changes`），未达 V1 验证标准；且存在一个**无 token/无哈希的兄弟路由** `POST /api/coils/:id/stock-adjustment`，纳入 V1 前必须先关掉该旁路 |
| `batch_create_parts` | 新建实体无"目标身份"概念，主要风险是重复建模/目录污染，且验证弱于库存/价格类 |
| `parts.create` / `parts.update` / `parts.save_profile` | 无正式 preflight；`update_part` 的 AI 层用 `allParts.find(model===...)` **首个匹配且不做歧义拒绝**（`aiPartExecution.cjs:692`）→ last-writer-wins |
| `create_order` / `update_order_*` / `orders.*`（除 readiness action） | 无正式 preflight；多行/多物料、部分应用面大 |
| `execute_order_readiness_action` / `execute_factory_workflow_step` | 动作型 + 外部副作用（采购/工作流），无 V1 级回读 |
| `generate_rotor_drawing` / `print_rotor_drawing` | 外部副作用（出图/打印），不可逆且非业务数据写 |
| `sync_factory_knowledge` / `knowledge.*` | 派生同步、外部模型参与，验证成本高 |
| 全部 `ai.*`（会话/评测/反馈/学习规则） | 属 AI 自身治理面，与"业务写"不同风险类别，另行考虑 |
| `settings.update_runtime` / `settings.update_business_value` | 影响全局运行参数（含加密配置与进程环境），爆炸半径最大 |

---

## 14. §15 写状态机（复用现有契约，不新建运行时）

**现有可用状态**（`aiTaskContractV2.cjs:6,7,14`）：任务 `NEW/UNDERSTANDING/RESOLVING/RUNNING/WAITING_INPUT/WAITING_APPROVAL/VERIFYING/SUSPENDED/RECONCILING/SUCCEEDED/PARTIAL/UNSUPPORTED/FAILED/CANCELLED`；goal `VERIFIED` 等；步骤 `PLANNED/RUNNING/SUCCEEDED/FAILED/CANCELLED/UNKNOWN_EFFECT`。

| 期望概念 | 现有映射 | 缺口 |
|---|---|---|
| INTENT_RESOLVED | `RESOLVING` | 无显式状态（可接受） |
| TARGET_BOUND | goal/subject resolution（`UNIQUE/SELECTED`） | 无显式状态；未把 `partId/recipeId` 作为任务级字段持久化 |
| PROPOSAL_READY | 仅 `spec.recovery.proposal`（`aiTaskStoreV2.cjs:64,82`） | **MISSING**（无状态，也就无法在重启后判断"提案是否曾就绪"） |
| AWAITING_CONFIRMATION | **`WAITING_APPROVAL`**（`aiTaskWriteBridgeV2.cjs:65-70`） | 无（映射即可） |
| CONFIRMED | 仅内存卡 + `spec.approvalOperationIds` | **MISSING**（重启后无法证明"曾被批准"，只能靠 operationId 存在与否推断） |
| EXECUTION_STARTED | 任务/步骤 `RUNNING`（写前落盘） | 无 |
| EXECUTED（已提交） | 无；最接近步骤 `SUCCEEDED`+回执，或 `UNKNOWN_EFFECT` | **MISSING**（`COMMITTED` 只能从 `api_operations` 推出） |
| VERIFIED | `VERIFYING` → `SUCCEEDED`；goal `VERIFIED`；步骤 `SUCCEEDED`+可信回执 | 无 |
| FAILED_SAFE | 已知 4xx→`FAILED`；未知→`UNKNOWN_EFFECT`+`RECONCILING`；运行时故障→`SUSPENDED`；取消竞态→`PARTIAL` | 语义分散在 4 处，**没有单一口径**；且 `RECONCILING` 无终局出口 |

**结论**：状态机**不需要新造**，需要的是 4 个补丁：`PROPOSAL_READY`（可选状态或在 spec 里显式标记）、`CONFIRMED`（持久化"批准事实"，例如把 `confirmationOperationId` + 批准主体指纹+时间写入 spec）、`COMMITTED`（由 reconcile 写入 `api_operations` 判定结果）、以及 `RECONCILING` 的**超时→`FAILED_SAFE`/人工升级**出口。

---

## 15. §16 安全模型（需要明确写入契约的部分）

**目标信任分离**：

```
Owner（唯一批准者）—— 批准对象 = 冻结的提案（tool/args/target id/version/previewHash）
        │  (owner_credential_v1 JWT)
        ▼
Native AI 服务 —— 只做"提案 + 转达批准"，绝不自造目标/参数
        │  (x-internal-secret + x-internal-write-secret：仅代表"服务到服务"的可执行性)
        ▼
业务 API（写权威）—— 校验业务规则/版本/审计/变更事件，返回正式回执
```

**现状与差距**：

| 要求 | 现状 | 差距 |
|---|---|---|
| AI 只能由 Owner 使用 | ✅ `resolveAiChatAccessBoundary`：非 owner 403 `AI_OWNER_ONLY` | 无 |
| Owner 批准与执行主体分离 | ⚠️ 确认 subject = cookie 哈希或 INTERNAL_SECRET 哈希；**没有把"Owner 批准"持久化为可审计事实** | **需补**：确认条目/任务 spec 记录 Owner 主体指纹（`sub`/`authn=owner_credential_v1`）+ 批准时间 + 冻结哈希 |
| 内部凭据不得当作"用户授权" | ✅ 语义上正确：`INTERNAL_WRITE_SECRET` 只放行机器写门；`actorKey=internal:<sha256(INTERNAL_SECRET)>` 与 Owner 确认主体**空间不同**，不能互相消费 | **需补**：显式断言 + 集成测试（当前无测试覆盖跨主体消费） |
| SEC-R0 边界 | ✅ `INTERNAL_SECRET` 只读；写需 `INTERNAL_WRITE_SECRET`（≥32、≠、定时安全比较） | 小修：`api.cjs:158` 的 `===` 改为定时安全比较 |
| `write-reconcile` 也须受 Native 写门约束 | ❌ 该端点未过 `assertNativeWriteRollout` | **需补**（见 §17 失败契约） |
| 确认端点只对 Owner 开放 | ⚠️ `confirmAuth` 接受任意有效 JWT | 需明确策略（建议：Native 写路径的确认端点要求 Owner 凭据） |

### 15.1 额外发现（安全 / 契约一致性，供后续单独排期）

| # | 发现 | 证据 |
|---|---|---|
| 1 | 路由层不按 `capabilityId`/`riskLevel` 授权；写门只有全局中间件 + 执行器 `allowWrite` | `registry.cjs:2339-2345`；`api.cjs:150-171`；`executor.cjs:353` |
| 2 | `api.cjs:158` 用普通 `===` 比较 `INTERNAL_SECRET`（同项目其它处用定时安全比较） | `api.cjs:158` vs `aiToolConfirmation.cjs:46-56` |
| 3 | 目标"首个匹配即写"（无歧义拒绝）出现在 `update_part`、`create_order`、`add_recipe_to_order` | `aiPartExecution.cjs:692`；`orderExecutors.cjs:51-53` |
| 4 | 列表序号从不被接受为目标身份（正面结论：不存在"按序号写"的形态） | ordinal 只作为匹配输出：`purchasingItemProgress.cjs:168,452` |
| 5 | AI 自管理写面缺 owner 作用域：`ai.personal_memory.change` 仅按 id 查（可跨 owner 改/删） | `aiPersonalMemory.cjs:36` |
| 6 | 评测用例/系统用例/学习规则更新同样未按请求 owner 限定行 | `aiEvaluationCommands.cjs:477,217`；`factoryAiRules.cjs:217` |
| 7 | 铜价/行情同步**重写全部线圈的单价与成本**，但既不要求确认、也不产生业务变更事件 | `copperPriceUpdate.cjs:41-68`；`registry.cjs:1155,1171` |
| 8 | 文件上传后**自动解析**是第二个写操作，失败被吞成 `parseWarning` | `files.cjs:114-117,210-213` |
| 9 | 转子打印/出图存在不可逆外部副作用（物理打印、FreeCAD + 文件系统） | `rotorExternalCommands.cjs:423-458,251` |

这些都不阻断 V1（因为 V1 只覆盖 1 个能力且不涉及上述面），但应在 V1 之后按优先级单独处理。

---

## 16. §17 失败契约（Native 期望行为，全部"无 Legacy 兜底、无盲重试"）

| 情形 | 期望行为 | 现有可复用机制 |
|---|---|---|
| 目标歧义 | 不写；返回澄清（带候选），goal 停 `WAITING_INPUT` | `part_stock_target_ambiguous` 等（`aiPartExecution.cjs:468-480`）；`WAITING_INPUT` |
| 参数非法 | 400/422，`FAILED`，零写入 | schema 校验 + `assertPrepareRequest` |
| 目标已过期（版本漂移） | 409 `resource_version_conflict`，零写入，要求重新预览 | `resourceVersion.cjs:12-21` |
| 确认过期 | 409 `confirmation_token_expired`，零写入 | `aiToolConfirmation.cjs:143-153` |
| 批准后用户改需求 | 必须重新预览（旧卡 `superseded`），禁止复用旧批准 | `aiToolConfirmationRevision.cjs:235-280` |
| 业务 API 拒绝（4xx） | `FAILED` + 原错误码；不得重试 | `knownBusinessRejection`（`aiTaskWriteBridgeV2.cjs:99-101,157-159`） |
| 超时（未确定结果） | 步骤 `UNKNOWN_EFFECT` + 任务 `RECONCILING`；**绝不重发** | `aiTaskWriteBridgeV2.cjs:161-162` |
| 可能已提交 | 用持久化幂等键查 `api_operations`：`COMPLETED`→VERIFIED；`MISSING`→(需补)终局失败；`PENDING/AMBIGUOUS`→(需补)超时升级 | `aiTaskOperationReadbackV2.cjs` |
| 验证不一致 | 视为失败/对账，不得宣告成功 | `part_stock_readback_mismatch` 等 |
| 崩溃/重启 | 内存确认卡作废（要求重新批准）；已提交则按回执复用 | §5 表 |
| 重复提交 | 同幂等键→回放原回执；不同 hash→409；pending→409 | `commandExecution.cjs:89-113` |
| 多步部分应用 | （缺）需要"逐步骤提交 + 每步幂等键 + 失败即停在对账态"，不引入跨步事务 | 步骤级 `operationId/idempotencyKey` 已具备 |

---

## 17. §18 WRITE_SAFETY_GAP_MATRIX

单元格：`READY` / `PARTIAL` / `MISSING`（附证据）。仅列关键能力；其余 80 余条按注册表元数据可机械推导（附件 JSON）。

| Capability | Identity | Grounding | Preview | Confirmation | Idempotency | Execution | Audit | Verification | Rollback | Crash Recovery | **Native V1 Ready** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `inventory.parts.batch_adjust_stock` | READY `aiPartExecution.cjs:452-494` | READY `:552-555` | READY `:556-596` | READY `:590-596`+L1/L2 | READY `commandExecution.cjs:89-113` | READY `aiConfirmedToolExecution.cjs:32` | READY `commandExecution.cjs:143-185` | READY `aiPartExecution.cjs:496-547` | PARTIAL（补偿未实现） | READY（写前落盘+UNKNOWN_EFFECT+对账） | **YES** |
| `parts.batch_update_prices` | READY（逐项 partId+expectedVersions）`aiPartExecution.cjs:983-1006` | READY `:989-1006` | READY `:1008-1024` | READY | READY | READY | READY | READY `:927-967` | PARTIAL | READY（同一写桥） | **YES（需行数上限）** |
| `recipes.update` | READY `recipeExecutors.cjs:544-550` | READY `:525-541` | READY（含成本前后值）`save-payload-draft` | READY | READY | READY `:634-645` | READY | READY `:345-377` | PARTIAL | READY | **YES（需展示成本差）** |
| `inventory.coils.adjust_stock` | READY `aiCoilStockExecution.cjs:11-73` | READY | READY `:74` | READY | READY | READY `:119` | READY | **MISSING**（无独立回读）`aiCoilStockExecution.cjs:112-137` | PARTIAL | READY | NEEDS_WORK |
| `parts.batch_create` | PARTIAL（无既有目标，靠 absence 快照） | PARTIAL | READY `/api/parts/batch-create-preview` | READY | READY | READY | READY | PARTIAL（仅 createdCount） | PARTIAL | READY | NEEDS_WORK |
| `parts.delete` | READY（id+version+delete-preview） | READY | READY | READY | READY | READY | READY | READY（删除后回读）`aiPartExecution.cjs:278-303` | **MISSING**（无 restore API） | READY | **NO（V1 不含删除）** |
| `recipes.delete` | READY | READY | READY | READY | READY | READY | READY | PARTIAL | **MISSING** | READY | **NO** |
| 其余 15 个删除类 | PARTIAL/READY | PARTIAL | MISSING（多数无预览） | PARTIAL（3 个 `requiresConfirmation=false`） | READY | READY | READY | MISSING/PARTIAL | **MISSING** | PARTIAL | **NO** |
| `parts.create` / `parts.update` | **MISSING**（名称重解析，无冻结 id/版本）`aiPartExecution.cjs:691-727` | PARTIAL | MISSING | READY | READY | READY | READY | MISSING | MISSING | PARTIAL | **NO** |
| `orders.*`（create/update/status/items/delete） | PARTIAL | PARTIAL | MISSING | READY | READY | READY | READY | MISSING | MISSING | PARTIAL | **NO** |
| `orders.execute_readiness_action` / `execute_factory_workflow_step` | PARTIAL | PARTIAL | MISSING | READY | READY | READY | READY | MISSING | MISSING | PARTIAL | **NO** |
| `files.*` / `knowledge.*` | PARTIAL | PARTIAL | MISSING/PARTIAL | PARTIAL | READY（内容哈希去重） | READY | READY | MISSING | **MISSING**（二进制不可逆） | PARTIAL | **NO** |
| `drawings.rotor.generate_pdf` / `print_pdf` | READY | PARTIAL | MISSING | READY | READY | READY（外部副作用） | READY | MISSING | **MISSING**（外部副作用） | PARTIAL | **NO** |
| `settings.update_runtime` / `update_business_value` | READY | PARTIAL | MISSING | READY | READY | READY（含进程环境应用） | READY | PARTIAL | **MISSING** | PARTIAL | **NO** |
| **任务运行时（横向）** | — | — | MISSING（`PROPOSAL_READY`） | PARTIAL（`CONFIRMED` 未持久化） | PARTIAL（QUERY/PREVIEW 无键） | READY | READY | PARTIAL（无答案后核验） | MISSING | PARTIAL（worker 未接线；`RECONCILING` 无终局出口） | — |

---

## 18. §19 本票未做（合规声明）

未设置 `AI_NATIVE_WRITE_ENABLED=true`；未启用任何 Native 变更；未改业务 API 行为；未改 DB schema（仍 88）；
未改 costEngine；未新增写端点；未改确认策略；未部署生产；未删除审计/历史；未改 SEC-R0 凭据；未引入兼容运行时。
生产状态保持 `cb5be53`（runtime `cb5be53e6222`，`AI_NATIVE_WRITE_ENABLED=false`）。

---

## 19. §20 门禁基线（`cb5be53`，干净树）

| 门禁 | 结果 |
|---|---|
| `npm test` | PASS — 2265 / 2265 |
| `verify:api-contract` | PASS — 28 / 28 |
| `test:deep-api` | PASS — 489 / 489 |
| `test:ai-architecture` | PASS — 120 / 120 |
| `lint`（本票有文档改动，附加） | PASS |
| `build`（附加） | PASS |
| `verify:ai-native-release`（附加） | PASS — `READY_WITHIN_SUPPORTED_SCOPE` |

---

## 20. REQUIRED_NATIVE_RUNTIME_CHANGES（最小集）

1. **启动 detached worker**（生产进程内启动单槽 worker + 启动即 `recoverExpiredLeases`），或明确"Native 写只走同步 write-preview/execute"而**不**启用 detached：二选一，必须在设计里定死。
2. **状态机补 4 项**：`PROPOSAL_READY`（或 spec 标记）、`CONFIRMED`（持久化批准事实：Owner 主体指纹+时间+冻结哈希）、`COMMITTED`（对账写入）、`RECONCILING` 的终局出口（超时→`FAILED_SAFE`/人工升级）。
3. **把 `write-reconcile` 纳入 `assertNativeWriteRollout`**（当前漏网）。
4. **确认主体契约**：为 Native 写路径显式要求 Owner 凭据，并把 Owner 主体指纹写入确认条目与任务 spec；补"内部主体不能消费 Owner 确认卡"的集成测试。
5. **`N6_1_WRITE_TOOLS` 扩展到 V1 三件套**（`adjust_part_stock`、`batch_update_prices`、`update_recipe`），并为每个 V1 能力加"回读验证必须存在"的准入断言。
6. **对账结果要落库**：把 `readTaskCommandOperationV2` 的 `COMPLETED` 落成步骤/任务状态，使 `COMMITTED` 可查询。

## 21. REQUIRED_BUSINESS_API_CHANGES

- **无需新增写端点**。V1 三项所需预览/命令端点均已存在（`/api/parts/batch-stock-preview`、`/api/parts/prices-preview`、`/api/recipes/save-payload-draft` + 对应命令）。
- 建议（非阻塞）：为 `batch_update_prices` 增加**影响行数上限**；为 `adjust_coil_stock` 补一个与零件同构的**回读校验**入口（若要把它纳入 V1）。
- 可选加固：`api.cjs:158` 内部密钥比较改为定时安全比较。

## 22. REQUIRED_SCHEMA_CHANGES

- **无必需 schema 变更**（api_operations / ai_tasks / ai_task_steps / business_change_events 已足够）。
- 若要持久化"批准事实"，可复用 `ai_tasks.spec_json`（无需迁移）；仅当需要独立查询时才考虑新增列/表（本审计不建议在 W1 动 schema）。

---

## 23. ARCHITECTURE_CONCLUSION

**当前基础设施距离安全开放第一批 Native Write，缺的不是"写引擎"，而是四件事**：(1) 生产里没有任何进程真正运行 Native 任务 worker/恢复；
(2) 写状态机缺 `PROPOSAL_READY/CONFIRMED/COMMITTED` 与 `RECONCILING` 的终局出口；
(3) "Owner 批准"尚未作为可审计事实与服务端内部执行凭据显式串联（当前只是 cookie 哈希 / 机器密钥哈希）；
(4) 除 7 个有正式 preflight 的写能力外，其余写能力在执行期会按名称重解析目标。
一次性写的原子性/幂等/审计/回读**已经具备**，因此最小实现阶段应严格限定在已具备 preflight 的能力上。

## 24. RECOMMENDED_NEXT_STAGE（只提一个最小阶段）

**NATIVE-W1：把"单步、已具备正式 preflight 的零件库存调整"打通为唯一 Native Write 能力。**

范围：仅 `adjust_part_stock`（`inventory.parts.batch_adjust_stock`），仅同步链路
（`/api/ai/tasks/:taskId/write-preview` → Owner 批准 → `/write-execute` → `/write-reconcile`），
不启用 detached worker、不启用其他任何写能力、不启用删除。

必须交付：Owner 批准事实持久化 + `write-reconcile` 纳入 rollout 门 + 对账终局出口 + 回读验证准入断言 +
真实 HTTP 端到端验收（含崩溃/重复提交/版本漂移/确认过期四类失败路径）。

验收标准：`AI_NATIVE_WRITE_ENABLED=true` 仅在测试实例；生产仍为 false；V1 之外所有写能力继续返回 `WRITE_DISABLED`。
