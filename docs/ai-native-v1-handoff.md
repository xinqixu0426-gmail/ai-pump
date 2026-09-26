# AI Native V1 — 交接文档（Handoff）

> **本文档的目标读者：** 完全没有参与 N0–N7.2 实现的人或会话。
> **目标：** 只读本文件（及其明确指向的文件）就能定位正式入口、复现测试、识别未开放能力、安全停用 Native。
> **状态口径：** 本文只描述**当前仓库事实**。凡"目标/计划/未实现"的内容一律显式标注，绝不写成已上线事实。
>
> 权威计划包：`planning/ai-native-v1/AI-native实施总计划.md`（来源 commit `6150edf`）。
> 本文件的证据来源是仓库代码与实测输出，不是计划文档的转述。

---


> **当前事实（NATIVE-HC1 → NATIVE-HC2，取代本文 §1–§4 的历史描述）**
> - 生产 AI 现为 **Native-only**：`AI_NATIVE_MODE=owner`，仅正式 Owner JWT 可进入 Native 只读链。
> - **Legacy AI 编排已退役并从仓库物理删除**：`aiAssistantRuntime`、`aiAgentRuntimeV3`、
>   `aiReadInvestigationDriverV4`、Legacy 工具循环/答案与金额守卫、business-semantics / business-impact
>   强制层、ontology shadow/binding/canary 等 85 个 `api/` 模块、22 个脚本、64 个测试。
> - `AI_NATIVE_WRITE_ENABLED=false`：AI 写入未开放；写意图得到 `WRITE_DISABLED`，零业务写入。
> - `off` / `shadow` 现在只表示 **AI 不可用**（403 `AI_UNAVAILABLE`），不再回退 Legacy。
> - 本文 §1–§4 中的「生产没跑 Native」「Legacy 未删除」「Legacy 仍是权威」「可回退 Legacy」等表述
>   均已被上述事实取代：**不要按它们去启用 Legacy 回退或旧开关**（相应开关也已删除）。

## 0. 30 秒速览

| 问题 | 答案 |
|---|---|
| 现在生产在跑 Native 吗？ | **是。** 生产 `AI_NATIVE_MODE=owner`，Native 是唯一生产 AI 运行时（见顶部「当前事实」）。 |
| Native 写入开启了吗？ | **没有。** `AI_NATIVE_WRITE_ENABLED` 默认 `false`，且与 mode 相互独立。 |
| Owner 试点开始了吗？ | **没有。** `READY_FOR_OWNER_TRIAL = YES`，`OWNER_TRIAL_ACTUALLY_STARTED = NO`。 |
| 怎么一键停用 Native？ | 把 `AI_NATIVE_MODE` 设为 `off`（或删除该变量）。**不需要**数据库恢复，**不需要** schema 回滚。 |
| Legacy 删掉了吗？ | **已经删掉。** NATIVE-HC2 已把退役的 Legacy AI 编排从仓库物理移除；下方 §4 为历史记录。 |
| 权威门禁命令？ | `npm run verify:api-contract` + `npm test` + `npm run test:deep-api` + `npm run lint` + `npm run build`。 |

---

## 1. 当前基线（N7.3 记录）

| 项 | 值 |
|---|---|
| 正式分支 | `ai-native/v1` |
| 基线 commit | `ef895dc05d641a4c087dd6dfa919dbeb5f2f0dfe` |
| 基线 tree | `a34bfbf7cb43c1f38b77a03e92936024c32316fb` |
| 工作区 | clean（`git status --porcelain` 为空） |
| schema 版本 | **88**（`api/database/migrations.cjs` 最后一个 `version: 88`，`currentVersion = MIGRATIONS.at(-1).version`） |
| migration 数量 | **88** |
| Node | v24.16.0 |
| npm | 11.13.0 |
| 包管理 | npm（`package-lock.json`） |
| 远端 | `origin/ai-native/v1` 仍为 `3b685b166af6cd35959e8767011dd683f388acd2`（本地领先 4 个 commit，未 push） |

> 注意：`master` 主工作区与本基线**历史不相交**（`merge-base` 为空）。不要试图把它与本分支合并。

---

## 2. 从用户请求到业务结果的完整链路（当前实现）

括号内为实际文件路径，均已核对存在。

```
用户请求
  → api/routes/ai/chat.cjs             POST /api/ai/chat（认证 confirmAuth）
  → api/services/aiDispatcherV3.cjs     读/受保护写请求分流
  → 责任模式判定：api/services/aiNativeRolloutPolicy.cjs
        ├─ off / shadow  → Legacy：api/services/aiAssistantRuntime.cjs 或 aiAgentRuntimeV3.cjs
        └─ owner（仅已认证 Owner）→ Native：api/services/aiTaskControllerV2.cjs
  → 统一执行适配：api/services/aiTaskCapabilityAdapterV2.cjs
  → 正式业务 API（internalApiClient → api/routes/*）
  → 成本/BOM/配置/订单/采购/库存/文件/知识正式服务
  → SQLite（api/db.cjs，写操作经 safeUpdate + audit_log）
  → 事实与回执：api/services/aiTaskFactsV2.cjs（FactRecordV1，仅服务端可造）
  → 答案与投影：api/services/aiTaskAnswerV2.cjs、api/services/aiTaskPublicV2.cjs
```

### Native 任务链路的持久化与控制面

| 关注点 | 文件 |
|---|---|
| 任务契约与状态机 | `api/services/aiTaskContractV2.cjs`、`api/services/aiTaskSessionV2.cjs` |
| 持久化任务存储（SQLite，migration 88 引入） | `api/services/aiTaskStoreV2.cjs` |
| 单槽 leased Worker | `api/services/aiTaskWorkerV2.cjs` |
| 崩溃/重启恢复 | `api/services/aiTaskRecoveryV2.cjs`、`api/services/aiTaskLifecycleV2.cjs` |
| 校验 | `api/services/aiTaskValidationV2.cjs` |
| 公开投影 | `api/services/aiTaskPublicV2.cjs` |
| 写桥（预览/确认/执行/对账） | `api/services/aiTaskWriteBridgeV2.cjs`、`api/services/aiProtectedCommandRoute.cjs` |
| 正式操作回读 | `api/services/aiTaskOperationReadbackV2.cjs` |
| 质量/发布门禁 | `api/services/aiNativeQualityGate.cjs`、`scripts/run-ai-native-quality-gate.cjs` |

### 正式 HTTP 入口（已核对路由注册）

| 用途 | 方法与路径 | 文件 |
|---|---|---|
| **AI 主入口（对话）** | `POST /api/ai/chat` | `api/routes/ai/chat.cjs:309` |
| 能力清单 / 健康 | `GET /api/ai/capabilities`、`GET /api/ai/health` | `api/routes/ai/chat.cjs:111,119` |
| 受保护工具预览（Legacy 确认桥） | `POST /api/ai/confirm-tool/preview` | `api/routes/ai/chat.cjs:319` |
| 受保护工具执行（Legacy 确认桥） | `POST /api/ai/confirm-tool` | `api/routes/ai/chat.cjs:348` |
| **创建后台任务** | `POST /api/ai/tasks` | `api/routes/ai/tasks.cjs:51` |
| 任务详情 | `GET /api/ai/tasks/:taskId` | `api/routes/ai/tasks.cjs:69` |
| 任务事件流 | `GET /api/ai/tasks/:taskId/events` | `api/routes/ai/tasks.cjs:72` |
| 澄清后续接 | `POST /api/ai/tasks/:taskId/resume` | `api/routes/ai/tasks.cjs:80` |
| 取消 | `POST /api/ai/tasks/:taskId/cancel` | `api/routes/ai/tasks.cjs:90` |
| **受保护写：预览** | `POST /api/ai/tasks/:taskId/write-preview` | `api/routes/ai/tasks.cjs:103` |
| **受保护写：执行** | `POST /api/ai/tasks/:taskId/write-execute` | `api/routes/ai/tasks.cjs:121` |
| **受保护写：失联对账** | `POST /api/ai/tasks/:taskId/write-reconcile` | `api/routes/ai/tasks.cjs:137` |

AI 路由以 `app.use('/', aiRouter)` 挂载（`api.cjs:141`），因此上表路径即最终路径。

### 工作台（前端）

- 组件：`apps/web-next/components/ai/AiTaskWorkbench.tsx`

---

## 3. 责任模式与开关（以代码为准）

来源：`api/services/aiNativeRolloutPolicy.cjs`。

| 开关 | 取值 | 默认 | 说明 |
|---|---|---|---|
| `AI_NATIVE_MODE` | `off` \| `shadow` \| `owner` | **`off`** | 未设置即 `off`。**非法值 fail closed**：`modeValid=false`，`config.mode` 回落到 `off`，`reason=AI_NATIVE_MODE_INVALID`，绝不按 owner 处理。 |
| `AI_NATIVE_WRITE_ENABLED` | `true` \| `false` | **`false`** | 与 mode **独立**。非法值同样 fail closed。 |

### 各模式的实际行为

| 模式 | 责任者 | 行为 |
|---|---|---|
| `off` | `LEGACY` | 原路径、原工具面、原答案、原 provider 调用行为保持；不附加模型调用；`reason=AI_NATIVE_OFF_LEGACY_AUTHORITATIVE`。 |
| `shadow` | `LEGACY` | 仍由 Legacy 负责答案；`shadow=true`，不改变答案、不额外发模型请求。 |
| `owner` | `NATIVE_OWNER` | **仅当请求通过正式 Owner 认证**时 `nativeTaskDelegation=true`。共享 admin、internal secret、客户端 header、prompt 都不能提权；未认证时 `reason=AI_NATIVE_OWNER_REQUIRED` 并回落 Legacy。 |

### 关键不变量

- **`owner` 模式 ≠ 写入开启。** `nativeWriteAllowed = ownerEligible && AI_NATIVE_WRITE_ENABLED === 'true'`。
- mode 在**每个请求开始时快照**，请求输入无法改变它。
- **是否需要重启才能改开关？** 需要按代码更正一个常见误解：`readAiNativeRolloutConfig(env)` 在**每次请求**读取 `process.env`，所以进程内修改 `process.env` 会立即生效。但通过部署改 env 文件/服务定义后，仍需按运维流程重启进程才能让新 env 进入进程（见 `docs/operations-runbook.md`）。**本文件不对"是否必须重启"做超出代码的判断**。

---

## 4. Legacy / Native 责任边界（N7.2 终态）

> **历史章节（已被 NATIVE-HC1/HC2 取代）**：下文的「Legacy 仍承担权威职责」「删掉它等于删掉生产路径」等结论
> 成立时生产仍是 Legacy 权威。现在生产是 Native-only，且这些 Legacy 组件已从仓库删除；本节仅作历史记录。


N7.2 的结论**不是**"Legacy 已删除"，而是：

> **冗余职责已退出；剩余 Legacy 都有明确、唯一的职责。**

| 分类 | 数量 | 含义 |
|---|---|---|
| `AUTHORITATIVE` | 5 | 当前仍承担正式权威职责 |
| `WITNESS` | 1 | 保留用于 Native/Legacy 行为比较 |
| `FALLBACK` | 1 | `off` / 回退路径仍依赖 |
| `DUPLICATE_EXECUTION` | **0** | 无重复执行 |
| `DEAD` | **0** | 无死代码残留 |
| `AMBIGUOUS_DUAL_AUTHORITY` | **0** | 无双权威歧义 |

### 为什么剩余 Legacy 仍然存在

1. **`AI_NATIVE_MODE` 默认 `off`** —— Legacy 就是当前生产权威。删掉它等于删掉生产路径。
2. `off` / `shadow` 模式下答案责任仍在 Legacy，包括 Legacy/OUT_OF_SCOPE 的数值溯源保护（Money Guard、跨目录候选、线圈变体披露、业务规则披露、线圈→配方关系修复）。BUS-P6 已判定其中没有可全局删除的组件。
3. **MCP 读取能力** 与 **Legacy 工具面** 是独立受支持的对外契约，不因 Native 未使用而失效。

详见 `planning/ai-native-v1/implementation/N7.2/legacy-redundancy-matrix.json` 与 `responsibility-inventory.md`。

### N7.2 实际退出了什么

| 切片 | 内容 | 结果 |
|---|---|---|
| N72-R01 | 同一 Native 任务内正式基线情景成本被重建两次 | 去重：正式能力调用 **2 → 1**（`toolCalls` 6 → 5）；分类 `DUPLICATE_EXECUTION → FALLBACK`；**未删代码** |
| N72-R08 | Native 适配层中不可达的 `preview_recipe_cost` 投影键（`CANONICAL_PROJECTORS`） | 删除 1 个投影键（-3 行）；**全局描述符完整保留**（Legacy/MCP/注册表/发布门禁仍需要） |

---

## 5. Native 当前能力面（READ / PREVIEW / COMMAND）

### 5.1 暴露给 Native 规划器的工具（模型工具面）

来源：`api/services/aiNativeToolDefinitionsV2.cjs`（实测枚举，**仅 3 个**）：

| 工具 | 访问类别 | 说明 |
|---|---|---|
| `compare_recipe_scenarios` | PREVIEW | 同一正式读取集合内比较一个已确认配方的当前重建成本与最多 3 个候选配置 |
| `preview_profitability` | PREVIEW | 同一读取集合上试算单台毛利、销售毛利率、成本加价率 |
| `preview_virtual_readiness` | PREVIEW | 按当前库存扣除活动订单占用，预览齐料情况 |

> 该工具面**刻意不追加进 Legacy 的 `AI_TOOLS`**（源码注释明确说明），以保证 Legacy 工具目录在迁移期间保持冻结。

### 5.2 控制器可执行的工具（固定集合，不等于模型可选）

`api/services/aiTaskControllerV2.cjs` 实际执行 12 个工具名：
`compare_recipe_scenarios`、`get_all_recipes`、`get_factory_knowledge_detail`、`get_order_knowledge_package`、`get_recipe_technical_files`、`preview_profitability`、`preview_virtual_readiness`、`search_coils`、`search_customer_history`、`search_customers`、`search_factory_knowledge`、`search_parts`。

### 5.3 分类口径

| 类别 | 内容 |
|---|---|
| Native 支持（PREVIEW） | 上述 3 个 Native 工具 |
| Native 支持（QUERY，经控制器编排） | 上述读取类工具 |
| Native 支持（COMMAND） | **无**（写路径在 `AI_NATIVE_WRITE_ENABLED=false` 下被阻断；`TASK_V2_COMMAND_NOT_ENABLED`） |
| Legacy 专有 | Legacy `AI_TOOLS` 工具面（例如 `preview_recipe_cost`、`full_calculate`、`build_recipe_bom_draft` 等） |
| 共享 | 正式业务 API、`costEngine`、能力注册表 `api/capabilities/registry.cjs` |
| MCP 暴露 | `api/mcp/catalog.cjs` 的只读工具目录（含 `preview_recipe_cost`、`full_calculate` 等） |
| Native 未暴露 | 所有 Legacy 专有工具（含 `preview_recipe_cost`） |
| 未开放生产 | 全部 Native COMMAND 写入 |

**重要：** 某能力"在仓库里实现了"**不等于**"生产已启用"。能力存在性与发布状态是两件事，见 §0 与 §8。

---

## 6. 公开字段契约与必须隐藏的内部字段

### 6.1 公共任务投影（`TaskPublicViewV1`）

来源：`api/services/aiTaskPublicV2.cjs`（`publicTask()`）。实测任务对象顶层键为：

`version`, `taskId`, `conversationId`, `requestId`, `revision`, `planRevision`, `state`, `answerOwner`, `executionMode`, `goals`, `facts`, `sourceConflicts`, `sourceConfigComparisons`, `sourceEvidence`, `questions`, `budgetUsage`

公共事实（`facts`）每项实测只有 4 个键：
`key`, `evidenceState`, `complete`, `planRevision`

### 6.2 必须**不得**外泄的内部字段

由实现与测试共同保证（`tests/aiTaskLegacyRetirementN72.test.cjs` 等）：

| 字段 | 原因 |
|---|---|
| `ownerKey` | 仅服务端保存，由认证请求取值，不接受请求 body |
| `receiptId` / `resultPointer` / `sourceHash` | 内部回执溯源；公共投影只保留 `key/evidenceState/complete/planRevision` |
| `confirmationToken` | 走既有受保护确认通道，不进公共投影 |
| 完整 args / 原始模型输出 | 公共投影不含 |
| 租约（lease / lease_token） | 仅服务端 |

`publicTask()` 还显式拒绝客户端提交这些同名保留字段（`api/services/aiTaskValidationV2.cjs:24` 的 forbidden 集合含 `owner`、`ownerKey`、`canonicalId`、`allowWrite`、`approved`、`approval`、`confirmationToken`）。

### 6.3 消费者可以依赖什么

- 可以依赖：§6.1 列出的字段与 `state` / `goals[].state` 枚举（契约见 `api/services/aiTaskContractV2.cjs` 与 N1.1 合同）。
- **不可**依赖：任何不在 §6.1 的字段；它们随时可变且可能是服务端内部实现细节。

---

## 7. 运行时参数（实测自代码）

| 参数 | 值 | 来源 |
|---|---|---|
| Worker 租约时长 | 30 000 ms | `aiTaskWorkerV2.cjs:11` |
| 租约续约间隔 | 10 000 ms | `aiTaskWorkerV2.cjs:12` |
| 轮询间隔 | 1 000 ms | `aiTaskWorkerV2.cjs:13` |
| Worker 默认启用 | **false** | `aiTaskWorkerV2.cjs:14` |
| 中断读重试上限 | 2 次尝试（`attempt < 2` 才入 interrupted，否则 `RECOVERY_RETRY_LIMIT`） | `aiTaskRecoveryV2.cjs:44` |
| `maxModelCalls` | 7 | `aiTaskControllerV2.cjs:56` |
| `maxToolCalls` | 10 | 同上 |
| `maxApiCalls` | 32 | `aiTaskControllerV2.cjs:22` |
| `maxToolResultBytes` | 98 304 | 同上 |
| `maxTaskStateBytes` | 262 144 | 同上 |
| `maxActiveMs` | 默认 60 000，夹在 10 000–900 000 | `aiTaskControllerV2.cjs:23,56` |
| `businessWritePolicy` | `FORBIDDEN` \| `CONFIRMATION_REQUIRED` | `aiTaskContractV2.cjs:16` |

---

## 8. 生产状态（必须如实阅读）

| 项 | 状态 |
|---|---|
| `READY_FOR_OWNER_TRIAL` | **YES** |
| `OWNER_TRIAL_ACTUALLY_STARTED` | **NO** |
| `AI_NATIVE_MODE` 生产值 | `off`（默认） |
| `AI_NATIVE_WRITE_ENABLED` 生产值 | `false`（默认） |
| 生产 Native 写入 | 0 |
| 生产 schema/数据迁移（因 Native） | 无 |

**不要**把 Native 描述成"已全量上线"，也**不要**把 `owner` 模式描述成当前生产默认。

---

## 9. 回滚程序（Accepted）

### 9.1 控制面回滚

```
AI_NATIVE_MODE=off        # 或直接删除该变量
```

- **改变什么：** 后续请求的入口责任选择。`off` 时 `responsibility=LEGACY`，Native 不再被委派。
- **不改变什么：** 不删代码、不动数据库、不动 schema、不动业务历史账。
- **需要数据库恢复吗：** 不需要。
- **需要 schema 回滚吗：** 不需要。
- **在途任务怎么办：** 只读任务可安全取消并保留证据。

### 9.2 已提交写命令的例外（重要）

已经发出的**正式写命令不能靠切回 Legacy 重新执行**。切回 `off` **不会**抹掉已提交命令的对账责任：

- `UNKNOWN_EFFECT` 必须进入 `RECONCILING`；
- 必须走正式回读（`api/services/aiTaskOperationReadbackV2.cjs`）与对账入口 `POST /api/ai/tasks/:taskId/write-reconcile`。

即：**关模式 ≠ 免除对账义务。**

### 9.3 证据

N7.1 已证明 `off → shadow → owner(write=false) → off` 无需 DB 恢复、无需 schema 回滚。脚本：`scripts/run-ai-native-rollout-live.cjs`（需真实 provider 凭据）。

---

## 10. 测试与门禁：怎么跑

| 命令 | 作用 | 备注 |
|---|---|---|
| `npm run verify:api-contract` | API 契约与能力注册表治理 | 27 项，确定性 |
| `npm test` | 全仓确定性测试 | 通过 `scripts/run-tests.cjs`，每个测试文件用隔离临时 SQLite |
| `npm run test:deep-api` | **canonical 深度 API 门禁** | 见 §11 |
| `npm run lint` | 后端 + `apps/web-next` lint | 确定性 |
| `npm run build` | Next 前端构建 | 确定性 |
| `npm run verify:release` | 组合门禁（audit + 契约 + lint + test + deep-api + build + **ai-native-release** + prod-env） | **包含** Native 质量门禁；见下 |
| `npm run verify:ai-native-release` | **Native 质量/发布门禁** | 也可单独运行；被 `verify:release` 调用 |

`verify:release` 与 `verify:ai-native-release` 的关系由 N7.1 的发布门禁架构固定：
`planning/ai-native-v1/implementation/N7.1/native-quality-summary.json` 的 `hardGate`
明文写着 `npm run verify:ai-native-release, included by npm run verify:release`，
`package.json` 与该声明一致。**不要**为了让某个环境更容易通过而把 Native 硬门禁从
`verify:release` 里摘掉；也**不要**反过来为了匹配旧文档而改动 `package.json`。

两层门禁的性质不同，必须分清：

| 层次 | 内容 | 依赖 |
|---|---|---|
| 仓库/静态验证 | `verify:api-contract`、`npm test`、`lint`、`build`、`test:deep-api`（canonical 确定性源） | 只依赖仓库内容与本地临时 SQLite，离线可跑 |
| 新鲜 live 证据 | `verify:ai-native-release` 的 `rolloutSafety` 维度 | 需要真实 `DEEPSEEK_API_KEY` |

发布脚本 `scripts/deploy-macmini-release.sh` 在跑 `verify:release` 之前先断言
**受版本控制的工作区干净**（`git status --porcelain --untracked-files=no`），这正好
满足门禁对 `sourceDirty` 的要求；同一 commit 已通过的证据会被复用
（`.release-code-gate-<sha>.json`），所以未变更的 revision 不会重复消耗模型调用。

### Native 质量门禁的真实前提

`npm run verify:ai-native-release` → `scripts/run-ai-native-quality-gate.cjs`，其中 `rolloutSafety` 维度会执行 `scripts/run-ai-native-rollout-live.cjs`，**需要真实 `DEEPSEEK_API_KEY`**。

- **不要**声称它在缺少 `DEEPSEEK_API_KEY` 时也会 PASS —— 它会在入口处以 `DEEPSEEK_API_KEY_MISSING` 直接失败。
- **不需要生产 Owner 凭据**：`run-ai-native-rollout-live.cjs` 自己签发隔离的合成 Owner 凭据（`n7-isolated-owner-credential-not-production`），不读取 `PUMP_OWNER_ACCESS_PASSWORD` 的实际值。
- 它的 `deepApiDeterminism` 维度取自 `scripts/run-deep-api-smoke.cjs`，即 §11 的 canonical 门禁。
- 新鲜度绑定 revision：`api/services/aiNativeQualityGate.cjs:24` 以 `sourceRevision === currentRevision` 判定，任何早于当前 revision 的证据都会 `stale = FAIL`。

**live Native 发布质量在缺少真实 provider 凭据时不得判定为 PASS。** 在进入生产
Owner 试点之前，必须用真实 `DEEPSEEK_API_KEY` 在当时的 revision 上重跑该门禁取得
fresh PASS；旧证据不能替代。

---

## 11. Canonical deep-api 门禁（N7.2 建立）

| 项 | 值 |
|---|---|
| 命令 | `npm run test:deep-api`（**不设** `DEEP_API_SOURCE_DATABASE_PATH`） |
| 源数据库 | **运行时由仓库自身 88 个版本化迁移构建**（`api/database/migrations.cjs`），落在 `os.tmpdir()` |
| 需要本机 `./pump.db` | **否**（报告字段 `localPumpDbUsed: false`） |
| 含生产数据 | **否**（源库只有 schema，无业务记录） |
| 行情数据 | 临时库内注入确定性 current-BJT 快照（`seedMcpDailyMarketSnapshotFixture`） |
| 检查数 | **489**（当前 revision 实测；连跑两次一致，检查身份集合相同） |
| 失败数 | 0 |
| 自述字段 | 报告内 `sourceMode` / `canonicalSource` / `localPumpDbUsed` |

### canonical 与 extended 的区别

```
CANONICAL RELEASE GATE      = npm run test:deep-api                     → 489 检查，跨机器确定性
EXTENDED DATA-SHAPE COVERAGE = DEEP_API_SOURCE_DATABASE_PATH=<本机库> npm run test:deep-api → 493 检查
```

- extended 多出的 4 项（`GET纯度-订单详情`、`订单正式状态筛选`、`订单详情`、`知识详情`）**全部是源库数据形状条件分支**，分类为 `EXTENDED_DATA_SHAPE_ONLY`。
- canonical 是 extended 的**严格子集**（反向 missing = 0）。
- **不要把 493 当作不变量** —— 它依赖源库内容，会随本机数据变化。
- **不要把 extended 计数当作全仓通用基线。**
- canonical 计数属于**当前 accepted revision 的证据**；runner 演进后必须重新生成。

---

## 12. Provider / Model 契约

| 项 | 值 | 来源 |
|---|---|---|
| 默认 provider 选择 | `AI_PROVIDER=auto` | `.env.example:48` |
| `auto` 语义 | 普通对话与本地可解析文档走 DeepSeek；图片/扫描/OCR/解析截断走 Kimi | `.env.example:42` |
| 也可设 | `deepseek` 或 `kimi` 强制单一 provider | `.env.example:45` |
| accepted 验证模型 | `deepseek-v4-flash` | `.env.example:62`（`DEEPSEEK_MODEL`） |
| DeepSeek base URL（示例值） | `https://api.deepseek.com` | `.env.example:63` |
| 超时 | `AI_PROVIDER_TIMEOUT_MS=120000` | `.env.example:69` |

区分口径：

- **支持的 provider 配置：** `auto` / `deepseek` / `kimi` / `local`。
- **accepted 验证 provider/model：** DeepSeek `deepseek-v4-flash`（N0.2 与后续 live 验收所用）。
- **生产实际配置：** **未读取**（本工作区无生产凭据与生产 env）。不要臆断。
- **密钥：** 本文档不含任何密钥；实际值只在 `.env`（不入库）。

---

## 13. 契约、语料与 Oracle

| 资产 | 路径 | 版本/冻结 |
|---|---|---|
| AI Native 执行总契约 | `planning/ai-native-v1/contracts/contracts.schema.json` | V1，计划包 |
| 任务状态机 | `planning/ai-native-v1/contracts/state-machine.json` | V1 |
| 任务存储 DDL | `planning/ai-native-v1/contracts/task-storage.sql` | V1 |
| Legacy witness 语料 | `tests/fixtures/legacy-witness-corpus-v1.json` | **冻结**（SHA-256 `30045b77…0f05`） |
| Legacy 冗余矩阵 | `docs/legacy-redundancy-matrix-v1.json` | **冻结**（SHA-256 `800524e7…3741a`） |
| 线圈/配方 Legacy Oracle v1/v2 | `tests/fixtures/ontology-coil-recipe-legacy-oracle-v1.json`、`-v2.json` | 版本化 |
| 业务语义 frame oracle | `tests/fixtures/business-semantic-frame-oracle-v1.json` | V1 |
| Native 基线 | `tests/fixtures/ai-native-baseline-v1.json` | V1 |
| 合成业务验收 | `tests/fixtures/synthetic-business-acceptance-v1.json` | V1 |
| 生产形状回归 | `tests/fixtures/production-shape-regression-v1.json` | V1 |

> 未在此表列出的语料不要凭记忆补版本号。

---

## 14. 明确"未开放"/"不要做"的清单

按 canonical N7.3 要求，未来会话必须能判断什么**不该**做：

| 不要做 | 原因 |
|---|---|
| 把 `AI_NATIVE_MODE` 在生产设为 `owner` | 生产 Owner 试点未启动，需单独授权 |
| 把 `AI_NATIVE_WRITE_ENABLED` 设为 `true` | 写开关默认 false，且需独立批准；owner ≠ 写开启 |
| 认为 Native 写能力已开放 | Native COMMAND 在写开关关闭时被 `TASK_V2_COMMAND_NOT_ENABLED` 阻断 |
| 删除剩余 Legacy（Money Guard / 跨目录候选 / 线圈变体 / 规则披露 / 关系修复） | 它们仍有唯一职责；BUS-P6 判定无可全局删除项 |
| 把 `preview_recipe_cost` 从 Legacy/MCP/注册表删除 | 仍被 Legacy 工具面、MCP 目录与发布门禁真实需要 |
| 把计划中的能力写成已上线 | canonical 明令禁止 |
| 用旧质量证据证明发布就绪 | 新鲜度绑定 revision，旧证据 `stale=FAIL` |
| 在生产库上跑测试或造 fixture | 测试一律用隔离临时 SQLite |
| 把 `493` 当成 deep-api 的固定期望值 | 它是扩展数据形状计数，随源库变化 |
| 在 `master` 主工作区合并/重置本分支 | 两者历史不相交 |

---

## 15. 交接自测（不依赖对话记忆）

用本文档回答以下问题；括号内是本文件给出答案的位置。

| # | 问题 | 位置 |
|---|---|---|
| 1 | 正式 AI 入口是哪个 HTTP 路径？ | §2 表：`POST /api/ai/chat` |
| 2 | Native 运行时在哪里？ | §2：`api/services/aiTaskControllerV2.cjs` 及其 store/worker/recovery/lifecycle/write bridge |
| 3 | 怎么跑 canonical 测试门禁？ | §10、§11 |
| 4 | 怎么跑 Native 发布门禁？ | §10（`npm run verify:ai-native-release`） |
| 5 | live 发布证据需要什么凭据？ | §10：真实 `DEEPSEEK_API_KEY` + Owner 凭据 |
| 6 | Native 默认模式？ | §3：`off` |
| 7 | Native 写入当前开启了吗？ | §0、§8：没有（`false`） |
| 8 | 怎么关掉 Native？ | §9.1：`AI_NATIVE_MODE=off` |
| 9 | 回滚需要数据库恢复吗？ | §9.1：不需要（也不需要 schema 回滚） |
| 10 | 当前哪些业务写能力是 Native 支持的？ | §5.3：**没有**（COMMAND 未开放） |
| 11 | 哪些能力未开放？ | §5.3、§14 |
| 12 | 任务/对账记录在哪里处理？ | §2（store/worker/write-reconcile 表）、§9.2 |
| 13 | canonical deep-api 的源是什么？ | §11：仓库迁移构建的临时库，非本机 `pump.db` |
| 14 | ReleaseEvidenceV1 在哪里？ | `planning/ai-native-v1/release/ReleaseEvidenceV1.json`（+ 说明 `N7.3-release-evidence.md`） |
| 15 | N7.3 之后唯一的下一任务是？ | §16 |

**自测结论（N7.3）：15/15 可由本文档直接回答，无需源码考古。**

---

## 16. 唯一的下一任务

canonical 计划在 N7.3 之后**没有定义 N8 或任何后续阶段**（已核对 `AI-native实施总计划.md` 的一级标题与 `05-分阶段实施.md` 的阶段表：`N0…N7`，N7.3 是最后一个任务包）。

因此：

- **canonical 阶段层面：N7.3 是终点。**
- **唯一的下一项工作是运维决策，不是新的 canonical 阶段：**

> **生产 Owner Trial 前置验收**
> 内容：用真实 `DEEPSEEK_API_KEY`，在当时的 revision 上重跑 `npm run verify:ai-native-release` 取得 fresh PASS（Owner 身份由该门禁内部签发的隔离合成凭据提供，不需要生产 Owner 凭据），并按 `docs/deployment-checklist.md` 完成切换前核对（代码/schema/实际开关/备份/证据一致）。
> 前置：N7.1、N7.2 已完成（canonical 前置满足）。
> **这不是本仓库内的下一个编码任务**，需要生产授权与凭据。

不要在此之外自行发明"下一阶段"或同时留下多个竞争优先级。
