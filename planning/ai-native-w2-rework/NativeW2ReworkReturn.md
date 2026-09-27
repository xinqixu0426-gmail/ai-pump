# NATIVE-W2 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-W2 — Native Write V1 Chat UX: Proposal, Owner Confirmation, Verified Result
**Branch:** `ai-native/prod-canary-s2`（未产生任何提交）
**STATUS:** **REWORK**（按 ticket §21「STOP and return REWORK before adding it」）
**日期:** 2026-09-26

> **一句话结论：W2 无法以「UI/interaction wiring only」实现，因为 W1 写生命周期在生产中
> 没有任何可达入口——没有任何路径能产生提案。** 这不是前端能补的缺口，也不是「新增一个
> 展示端点」能解决的；它需要 supervisor 显式授权一次后端改动（涉及 AI 写意图语义与任务
> 状态机，即 W1 当初被门禁管控的同一类改动）。本报告给出实测证据与最小方案，未擅自实施。

---

## 0. 基线（未改动任何文件）

| 项 | 值 |
|---|---|
| START_COMMIT | `154287dcba362709ede48e2866d6e6bbc318c212` |
| END_COMMIT | `154287dcba362709ede48e2866d6e6bbc318c212`（**相同**） |
| 工作区 | ✅ 干净（`git status --short` 为空，无残留文件） |
| 是否推送 | 无改动可推；`origin/ai-native/prod-canary-s2 == 154287d` |
| 生产开关 | `AI_NATIVE_WRITE_ENABLED=false`（未触碰生产） |

---

## 1. 发现（实测，非推断）

### 1.1 聊天路径：写意图**永远**得到 WRITE_DISABLED，与写开关无关

**生产实测**（Owner 会话，只读、零模型调用、零业务写入）：

```
POST /api/ai/chat  {"messages":[{"role":"user","content":"把 6202 轴承库存增加 100"}]}
→ HTTP 200 SSE（5 个事件）
data: {"type":"status","stage":"native_write_disabled", ...}
data: {"type":"content","content":"本次请求包含写操作意图（[object Object]）。AI 写入当前未开放，……"}
data: {"type":"detail","state":"WRITE_DISABLED","commandRoute":{"mode":"command","domains":["catalog"],
        "preferredCapability":null,"recentPartWrite":null,"source":"explicit_user_command"},
        "nativeWriteEnabled":false}
data: {"type":"metrics", ..., "modelRequestCount":0, "toolCallCount":0}
data: {"type":"done"}
```

- **没有任何提案 / 确认卡 / token**：无 `requiresConfirmation`、无 `confirmationToken`、无 `rows`。
- `nativeWriteEnabled` 是**硬编码 `false`**（`api/services/aiDispatcherV3.cjs:29`），
  dispatcher **从不读取**写开关；`api/services/aiDispatcherV3.cjs:85`
  `if (commandRoute) return nativeWriteDisabledOutcome(...)` 无条件短路。
- 顺带暴露两个**现网缺陷**（非本票引入，但影响 W2 UX 与可观测性）：
  1. `aiDispatcherV3.cjs:27` 把对象 `commandRoute` 插值进模板串 → 用户可见文案里出现
     **`[object Object]`**（上句已复现）；
  2. `nativeWriteEnabled:false` 恒为假，前端**无法**得知真实写状态。

### 1.2 意图识别认不出产品自己的说法

`api/services/aiProtectedCommandRoute.cjs:47-49`：零件库存分支要求文本里出现 `零件|配件|物料`。
实测（直接调用生产代码）：

| 用户说法 | `preferredCapability` | 服务端工具参数 |
|---|---|---|
| `把 6202 轴承库存增加 100`（**ticket §1 原句**） | **`null`** | `null` |
| `把 6202 轴承的库存增加 100` | `null` | `null` |
| `把 6202 零件库存增加 100` | `adjust_part_stock` | **`null`** |
| `把12-120线圈库存增加100套` | `adjust_coil_stock` | `{items:[{model:"12-120",changeQty:100}]}` |

即：即使 dispatcher 改成读开关，ticket 的原句也**不会被识别**；而且
`buildProtectedCommandToolCall` 只为 `create_part / update_part / adjust_coil_stock` 抽取参数，
`adjust_part_stock` **没有服务端参数抽取器**。

### 1.3 从自然语言创建的任务，**永远**满足不了 W1 写前置条件

隔离运行时（`AI_NATIVE_WRITE_ENABLED=true`、`AI_NATIVE_MODE=owner`、Owner 会话、临时 DB、
已播种零件 stock=100 与用户消息），实测 `POST /api/ai/tasks` → `GET` → `write-preview`：

```
POST /api/ai/tasks   → 202 {"taskId":"35dd4662-…","revision":1,"state":"NEW", "executionMode":"DETACHED"}
GET  /api/ai/tasks/:id → 200 goals:[{goalKey:"goal_1",description:"查询库存",state:"PENDING"}]   ← 公开投影不含 kind/policy
（DB spec_json 真值：businessWritePolicy:"FORBIDDEN"，goal.kind:"INVENTORY_QUERY"）
POST /api/ai/tasks/:id/write-preview → 403 {"code":"TASK_WRITE_POLICY_FORBIDDEN","error":"当前任务不允许准备业务写入"}
```

原因链（逐条实测 + `file:line`）：

| # | 事实 | 位置 |
|---|---|---|
| 1 | 写意图正则 `WRITE` 不匹配「库存增加」→ `businessWritePolicy=FORBIDDEN` | `api/services/aiTaskSemanticsV2.cjs:15`、`:47` |
| 2 | 目标构建器只产出只读 goal（`库存` → `INVENTORY_QUERY`），**从不**产出 `APPLY_CHANGE`/`PREPARE_CHANGE` | `api/services/aiTaskSemanticsV2.cjs:206-286`、`:251` |
| 3 | `APPLY_CHANGE` 被强制标记 UNSUPPORTED 并挂 blocker `WRITE_EXECUTION_NOT_ENABLED` | `api/services/aiTaskControllerV2.cjs:20-22`、`:231-236` |
| 4 | `requireWritableTask` 要求 DETACHED + `CONFIRMATION_REQUIRED` + `PREPARE_CHANGE/APPLY_CHANGE` + 非终态 | `api/services/aiTaskWriteBridgeV2.cjs:73-81` |
| 5 | 新任务状态是 `NEW`；`NEW → WAITING_APPROVAL` 非法 → `400 TASK_TRANSITION_INVALID` | `api/services/aiTaskContractV2.cjs:26-40`、`aiTaskLifecycleV2.cjs:43`、`aiTaskWriteBridgeV2.cjs:197` |
| 6 | 唯一能把 `NEW` 推进到 `RUNNING` 的是 worker，而它**故意未启用**、`api.cjs` 也从不启动 | `api/services/aiTaskWorkerV2.cjs:14,118-119`（`TASK_WORKER_DEFAULT_ENABLED=false`） |

**对照实验（同一隔离运行时）**：把任务手工造成 W1 形状（policy `CONFIRMATION_REQUIRED` + goal
`APPLY_CHANGE` + state `RUNNING`）后，写链路**完全正常**：

```
write-preview  → 202，data.confirmation.confirmationToken（不透明 token）、
                 data.proposal {partId, model, currentStock:100, delta:100, nextStock:200, …}
write-execute  → 200，data.outcome {"verified":true,"partId":9001,"model":"…","stock":200,…}
隔离 DB 直查    → parts.stock 100 → 200（**恰好一次**）；api_operations 恰好 1 条
                 inventory.parts.batch_adjust_stock；恰好 1 个 COMMAND step；任务 SUCCEEDED
```

→ **W1 的执行/对账/回读核验本身是好的、可复用的；缺的是「从用户一句话到一个可写任务」的入口。**

### 1.4 结论

`/ai` 目前**不能**把任何写意图变成确认卡：聊天路径硬编码 WRITE_DISABLED；任务路径产不出
可写任务；唯一的状态推进器（worker）被有意关闭。因此 ticket §1 要求的 enabled-mode UX、
§19 强制的 flag-true 隔离 E2E、以及 §25 的退出标准 1–11 **在当前后端上不可达**。

---

## 2. 为什么我 STOP 而没有顺手补后端

- ticket 架构基线写明「**W2 is UI/interaction wiring only**」，§3 要求前端只做展示与显式动作，
  §22 禁止把 W2 变成通用写平台；
- §21 明确要求：前端集成若真的需要新的服务端面，**先 STOP 并返回 REWORK，不要先加**；
- 真正的缺口不是「展示端点」，而是**AI 写意图语义 + 任务目标种类 + 任务状态推进 + 聊天传输**，
  等于**新开一个生产 AI 写入口**——这正是 W1 当初必须走独立票据、独立门禁和独立 SUPERVISOR
  授权的那一类改动。由本票自行实施会越过授权边界，也会让「W2 未部署」的安全承诺失去意义。

因此本票**未新增任何服务端能力，未做任何提交**，工作区保持干净（`END == START == 154287d`）。
W2 的前端部分（卡片/状态机/失败映射）我已完成设计与纯逻辑实现，但在没有可达提案路径时
它只是**永远渲染不出来的死代码**，故按项目规约（未完成不宣告、不留半成品）未提交。

---

## 3. 已就绪、等授权即可实施的最小方案（建议 NATIVE-W1.5 后端票）

**目标**：为**唯一获批能力**打通「一句话 → 服务端冻结提案 → 前端确认卡」，不新增 HTTP 端点，
不改 Business API / schema / costEngine，生产写开关保持 `false`。

| # | 改动 | 文件 | 说明 |
|---|---|---|---|
| A1 | 单能力命令目标可写：对**白名单内**能力产出 `businessWritePolicy=CONFIRMATION_REQUIRED` + `APPLY_CHANGE` goal，并移除该能力的强制 UNSUPPORTED blocker | `api/services/aiTaskSemanticsV2.cjs`、`aiTaskControllerV2.cjs` | 仅白名单能力生效，其余写意图行为不变 |
| A2 | 命令路由任务的**可写状态**：在聊天回合内把命令任务推进到 `RUNNING`（不启用 worker），或显式授权启用 worker | `aiTaskControllerV2.cjs`（+ 可选 `aiTaskWorkerV2.cjs`/`api.cjs`） | 推荐前者：不重新引入后台执行面 |
| A3 | 聊天路径读真实写开关 + 发提案事件：`nativeWriteAllowed` 透传；开放且路由命中白名单能力时调用**既有** `prepareAiTaskWriteConfirmationV2`，把冻结提案与确认身份经 SSE 下发；关闭时**逐字节保持**今天的 WRITE_DISABLED 行为 | `api/services/aiDispatcherV3.cjs`、`api/routes/ai/chat.cjs` | 同时修掉 `[object Object]`（:27）与硬编码 `nativeWriteEnabled:false`（:29） |
| A4 | 识别产品自己的说法并**在服务端**抽取参数：`库存增加/减少/入库/出库 + 型号`（含「6202 轴承」这类不含「零件」字样的说法），产出 `{items:[{model,changeQty}]}` | `api/services/aiProtectedCommandRoute.cjs` | 复用既有线圈抽取器写法；参数只在服务端解析，前端不解析自然语言 |
| A5 | 之后才是本票原本描述的 W2 UI：确认卡（服务端冻结提案数字）、`确认执行`→既有 `write-execute`、必要时 `write-reconcile`、仅以回读核验结果渲染成功；§11 A–F 失败文案映射；§18 flag=false 无卡无请求 | `apps/web-next/**` | 卡片逻辑已设计完毕，可直接落地 |

规模估计：A1–A4 约 4–5 个后端文件、~150–250 行，**无新端点**、无 schema/costEngine 变更。
A1–A4 完成后，本票的 §1/§19/§25 才具备可实施与可验证的前提。

---

## 4. 按 ticket §26 的返回字段

| 字段 | 值 |
|---|---|
| `WRITE_UI_CAPABILITIES` | 无（未实施） |
| `TOTAL_WRITE_UI_CAPABILITIES` | 0（目标值仍为 1） |
| `PRODUCTION_AI_NATIVE_WRITE_ENABLED` | `false`（未触碰） |
| `PROPOSAL_CARD` | 未渲染（后端无提案可渲染） |
| `FLAG_FALSE_BEHAVIOR` | ✅ **现网已符合 §18**：写意图只得到 `WRITE_DISABLED` 文案，无卡片、无 token、无 preview/execute/reconcile 请求（实测见 §1.1） |
| `FLAG_TRUE_ISOLATED_E2E` | ❌ 不可达：flag=true 时聊天仍返回 WRITE_DISABLED；任务路径 403 `TASK_WRITE_POLICY_FORBIDDEN` |
| `NON_W1_MUTATION_UI` | 无（未实施；白名单边界不变） |
| `BUSINESS_API_CHANGED` | **NO** |
| `DATABASE_SCHEMA_CHANGED` | **NO** |
| `COST_ENGINE_CHANGED` | **NO** |
| `SEC_R0_BOUNDARY` | PASS（未触碰；生产写端点仍由 kill switch 与 Owner 门共同守住） |
| `OWNER_ONLY_BOUNDARY` | PASS（实测非 Owner 403 `AI_OWNER_ONLY`、未认证 401） |
| `LEGACY_DENYLIST` | PASS（HC2 denylist 7/7，生产未变） |
| `TESTS` | 本票未改动代码，故未新增测试；基线门禁仍为 W1-PROD-SAFE 的全绿状态（`npm test` 2289/2289、api-contract 28/28、deep-api 489/489、lint/build/ai-arch/verify:ai-native-release PASS） |
| `WORKTREE_CLEAN` | **YES** |
| `PUSHED_TO_GITHUB` | 无改动（`origin == 154287d`） |

---

## 5. 需要 Supervisor 决策的问题

1. 是否授权 **NATIVE-W1.5**（上表 A1–A4）？这是让 W2 可实施的**唯一**前提。
2. A2 采用哪一种：**(i) 聊天回合内把命令任务推进到 RUNNING**（推荐，不启用后台 worker），
   还是 **(ii) 启用 Native worker**（会重新引入后台执行面，影响面更大）？
3. 两个现网缺陷（`[object Object]` 文案、硬编码 `nativeWriteEnabled:false`）是否随 W1.5 一并修复？
   它们不影响安全性，但直接影响 `/ai` 在写意图下的可读性。
4. 在 W1.5 完成前，是否希望我先提交「不会被渲染的」卡片纯逻辑 + 组件骨架（含 §20 的 15 个
   失败 UI 用例）？我默认**不提交**，以免生产携带死代码并造成阶段性完成的错觉。

---

## 6. 附：本报告的取证方式（可复核）

- 生产只读探测：真实 Owner 网关（`127.0.0.1:3104`）取会话 → `POST /api/ai/chat` 写意图；
  该路径 `modelRequestCount=0`、`toolCallCount=0`，**零模型调用、零业务写入**。
- 隔离实验：临时 DB（`PUMP_TEST_DATABASE_PATH`）+ 随机端口 + 合成密钥 + `api.cjs` 真实进程，
  flag=true；进程已全部终止，未触碰生产 checkout 与生产 DB。
- 静态取证：直接 `require` 生产代码做纯函数调用（`detectProtectedCommandRoute` /
  `buildProtectedCommandToolCall`），不写库。
- 全程未输出任何密钥值；未允许、未执行任何生产写入。
