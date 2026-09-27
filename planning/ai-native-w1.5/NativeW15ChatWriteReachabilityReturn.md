# NATIVE-W1.5 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-W1.5 — Make Native Write V1 Reachable from Natural-Language Chat
**Branch:** `ai-native/prod-canary-s2`
**STATUS:** **PASS**
**日期:** 2026-09-26
**报告位置说明:** 与 NATIVE-W1-PROD-SAFE 一致，本报告写在两个 git checkout 之外
（`/Users/dan/Documents/ai-native-pump-system/planning/ai-native-w1.5/`），避免交付后再产生
文档提交影响「已推送 = 已验收」的一致性。报告所述的 END_COMMIT 已推送到 GitHub。

---

## 0. 提交与基线

| 项 | 值 |
|---|---|
| START_COMMIT | `154287dcba362709ede48e2866d6e6bbc318c212` |
| END_COMMIT | `f35e0297d1fc00d7659c947e805108839e125f9c` |
| GitHub `origin/ai-native/prod-canary-s2` | `f35e0297d1fc00d7659c947e805108839e125f9c`（与本地一致） |
| 工作区 | ✅ 干净 |
| 生产 HEAD / runtime | `154287d` / `154287dcba36`（**未部署 W1.5**） |
| 生产 `AI_NATIVE_WRITE_ENABLED` | `false`（未改；`.env` 未编辑） |

提交链（3 个提交）：

```
f35e029 test(ai): NATIVE-W1.5 assert zero model calls and zero command steps during the chat turn
1db921c chore(ai): refresh the N7.3 closure artifact hashes for the NATIVE-W1.5 doc update
ff942e0 feat(ai): NATIVE-W1.5 make the W1 write proposal reachable from natural-language chat
```

改动清单（10 个文件，**无前端文件**）：

```
api/services/aiProtectedCommandRoute.cjs     写意图语义族 + 数量/目标确定性抽取 + 稳定能力描述
api/services/aiNativeWriteChatBridgeV2.cjs   新增：聊天回合 → W1 提案桥（只准备、不执行）
api/services/aiDispatcherV3.cjs              按服务端 rollout 决定走向；结果分支；修 [object Object]
api/routes/ai/chat.cjs                       传入 nativeWriteAllowed 与持久化来源消息解析
api/services/aiConversations.cjs             新增 loadAiLatestUserMessage（提案只绑定持久化消息）
tests/nativeW15ChatWriteProposal.test.cjs    新增：确定性行为矩阵（9 例）
tests/nativeW15ChatWriteProposalHttpE2E.test.cjs 新增：真实进程 E2E（6 例）
docs/api-reference.md                        /api/ai/chat 补全 W1.5 契约
docs/ai-native-v1-handoff.md                 当前事实增加 W1.5 可达性说明
planning/ai-native-v1/release/N7.3-closure-validation.json  证据哈希刷新（既有机制）
```

---

## 1. 一句话结论

Owner 在生产同构（flag=true）的隔离实例里说一句 **「把 6202 轴承库存增加 100」**，
现在真的能走通：确定性写意图 → `adjust_part_stock` → canonical 唯一零件 + 显式数量 →
**同步**建任务并调用**既有** W1 正式预览 → 冻结提案 → `WAITING_APPROVAL` →
`/api/ai/chat` 下发结构化 `NATIVE_WRITE_PROPOSAL` 事件；**该回合零写入、零 COMMAND step、
零模型调用**。随后用**既有** `write-execute` 契约确认，才写一次并回读核验。
不需要 hand-shaped 任务，也没有启用 detached worker。

---

## 2. 实现要点（对应 ticket 各节）

| ticket | 要求 | 实现 |
|---|---|---|
| §3 | dispatcher 必须真读写开关 | `runAiDispatcherV3` 只依据服务端依赖 `nativeWriteAllowed`（来自 `resolveAiNativeRollout` 快照）；请求体无法影响 |
| §3 | 三分支 | flag=false → `nativeWriteDisabledOutcome`；flag=true + 白名单能力 → 提案；flag=true + 非白名单 → `WRITE_UNSUPPORTED`。**永不 Legacy** |
| §4 | 去掉 `[object Object]` | 新增 `describeCommandRoute()` → 稳定中文能力名（「零件库存调整」等），正文不再拼接内部路由对象；生产回归由 E2E 断言 `[object Object]` 不出现 |
| §5 | 语义族不依赖「零件」 | 判据 = 库存语义（库存/入库/出库）+ 明确增减动作 + 显式数量；支持 `把6202轴承库存增加100`/`6202库存加100`/`把6202轴承库存减少20`/`6202库存减20个`；线圈/价格/删除/配方仍走各自分支，不被吞掉 |
| §6 | 数量确定性抽取 | `增加/加/入库/补充/上调` → 正；`减少/减/出库/扣减/下调` → 负；允许「增加了/加到」；缺数量 → `NATIVE_WRITE_QUANTITY_REQUIRED`；多数量 → `QUANTITY_AMBIGUOUS`；带负号或非正数 → `ACTION_AMBIGUOUS`；绝对赋值（改成/设为…）→ `ACTION_AMBIGUOUS`。**不猜、不推断** |
| §7 | 目标解析 | 只抽取「目标提及」（库存锚点左侧、去请求语与把/将、去尾「的」、折叠空白），**身份由既有 canonical resolver 决定**：0 匹配 → `part_stock_target_not_found`，多匹配 → `part_stock_target_ambiguous`；绝不 first-match、绝不用模型生成的 ID |
| §8 | 任务语义 | 命令任务直接构造为写提案任务：`businessWritePolicy=CONFIRMATION_REQUIRED` + goal `PREPARE_CHANGE`（既有 goal 概念）。**不落成 INVENTORY_QUERY 再打补丁**：命令路径根本不经过只读语义层 |
| §9 | 写策略只对本次提案 | 策略与目标、参数、冻结提案、幂等键一起持久化在 `spec.writeV1`；其余 94 个写能力仍在作用域层被拒绝 |
| §10 | 同步推进、不启用 worker | `NEW → UNDERSTANDING → RESOLVING → RUNNING`（全部为既有合法转移）→ W1 桥推进 `WAITING_APPROVAL`；`TASK_WORKER_DEFAULT_ENABLED` 保持 `false`；**未新增状态机、未改状态契约**（没有出现「缺一条转移」的情况） |
| §11 | 回合内绝不执行 | 预检以 `allowWrite:false` 调用；E2E 断言聊天回合后 `api_operations=0`、`ai_task_steps=0`、库存不变 |
| §12 | 复用既有 W1 预览 | 直接调用 `prepareAiTaskWriteConfirmationV2`（W1 桥）→ `executeToolCall(..., allowWrite:false)` → 既有 executor/executor preflight → 既有业务目录读取。**零重复预览逻辑** |
| §13 | 结构化传输 | `{type:'write_proposal', stage:'NATIVE_WRITE_PROPOSAL', proposal:{kind,capabilityId,items:[{partId,model,currentStock,delta,nextStock,clampedToZero}]}, confirmation:{confirmationToken,operationId,expiresAt,toolName,args}, task:{taskId,revision,state,statusPath}}`；**不含** `argsHash`/`subjectHash`/`proposalHash`/审计哈希/任何凭据（E2E 对整段 SSE 做禁用字段断言） |
| §14 | 非 W1 命令 | flag=true 时线圈/价格/删除/配方等 → `detail.state=WRITE_UNSUPPORTED`，零预览、零任务、零写入 |
| §15 | 多目标 | `把6202和6203库存都增加100` → 判定 `target_multi` → `NATIVE_WRITE_SINGLE_TARGET_REQUIRED`；**不拆分、不循环、不生成两张卡、不选第一个** |
| §16 | 授权 | 非 Owner → 403 `AI_OWNER_ONLY`；未认证 → 401；`x-internal-secret` / `x-internal-write-secret` 都不能取得 Owner 提案（E2E 实测） |
| §17 | reconcile 门共享 | 重新验证：`write-preview`/`write-execute`/`write-reconcile` 三者共用同一 rollout 中间件（+handler 内同源校验）；flag=false 时三者都返回 `AI_NATIVE_WRITE_DISABLED`（E2E-6 实测）。**未改对账设计** |
| §21 | 不加额外模型调用 | 命令路由与抽取全是确定性正则/字符串处理；E2E 断言 `metrics.modelRequestCount=0`、`toolCallCount=0` |

### 与 §22「likely modules」的差异（有意为之）

未修改 `aiTaskSemanticsV2.cjs` / `aiTaskControllerV2.cjs`。原因：把「库存增加」塞进只读语义层的
WRITE 正则只能让任务变成「可写的 INVENTORY_QUERY」，仍需再补 goal 种类与状态推进，正是 §8 明令
禁止的「先落成 INVENTORY_QUERY 再打补丁」。命令路径改为**独立、确定性、单能力**地构造写提案任务，
既不动只读语义层（`POST /api/ai/tasks` 行为零回归），也不需要任何状态契约变更。

---

## 3. §18 flag=true 后端 E2E（真实进程，隔离 DB）

`tests/nativeW15ChatWriteProposalHttpE2E.test.cjs` × 6 例全绿。核心用例实测：

```
POST /api/ai/chat  (Owner, conversationId=chat-1, "把 W15-6202轴承 库存增加 100")   → HTTP 200 SSE
  1. status.stage = native_write_proposal
  2. content      = 已生成…（无 [object Object]）
  3. write_proposal:
       proposal.items[0] = {partId:9001, model:"W15-6202轴承", currentStock:100, delta:100, nextStock:200, clampedToZero:false}
       confirmation      = {confirmationToken:"…", toolName:"adjust_part_stock", args:{items:[{model,changeQty:100}]}}
       task              = {taskId:"…", revision:5, state:"WAITING_APPROVAL", statusPath:"/api/ai/tasks/…"}
  4. metrics.modelRequestCount = 0 / toolCallCount = 0
  5. done
DB（聊天回合之后）：任务 state=WAITING_APPROVAL、businessWritePolicy=CONFIRMATION_REQUIRED、
  goals[0].kind=PREPARE_CHANGE、spec.writeV1.phase=PROPOSAL_READY、nextStock=200；
  parts.stock 仍 =100；api_operations=0；ai_task_steps=0        ← 聊天回合零写入
POST /api/ai/tasks/:id/write-execute（既有契约，Owner，同一确认身份 + expectedRevision）
  → 200，outcome.verified=true，outcome.stock=200，task.state=SUCCEEDED
DB（确认之后）：parts.stock=200（恰好 +100）、api_operations 恰好 1 条
  inventory.parts.batch_adjust_stock                                          ← 写一次并回读核验
```

另外两例：不带「把」的说法 `${MODEL}库存加100` → +100；`把 … 库存减少 20` → delta=-20、nextStock 由
60 → 40，且库存不变。

## 4. §19 flag=false 契约（与生产现状逐字一致）

```
POST /api/ai/chat（同一句话，flag=false）→ 200，
  detail.state = WRITE_DISABLED，nativeWriteEnabled = false，commandLabel = 零件库存调整
  无 write_proposal、无 confirmationToken
DB：ai_tasks=0、parts.stock 不变、api_operations=0
```

## 5. §20 失败矩阵（实测）

| 用例 | 输入 | 结果 |
|---|---|---|
| A | `把 <型号> 库存增加 100` | ✅ 提案 |
| B | `<型号>库存加100` | ✅ 提案 |
| C | `把 <型号> 库存减少 20` | ✅ 提案（−20） |
| D | `把 <型号> 库存增加` | ✅ `NATIVE_WRITE_QUANTITY_REQUIRED` 澄清 |
| E | `…增加 100 再减少 50` | ✅ `NATIVE_WRITE_QUANTITY_AMBIGUOUS`（单测） |
| F | `把库存增加100` | ✅ `NATIVE_WRITE_TARGET_REQUIRED` 澄清 |
| G | `把 W15-不存在 库存增加 10` | ✅ 安全 not-found（`part_stock_target_not_found`，零提案） |
| H | 同名多供应商零件 | ✅ 歧义（`part_stock_target_ambiguous`，零提案） |
| I | `把6202和6203库存都增加100` | ✅ `NATIVE_WRITE_SINGLE_TARGET_REQUIRED` |
| J | 线圈库存 | ✅ `WRITE_UNSUPPORTED` |
| K | 零件调价 | ✅ `WRITE_UNSUPPORTED` |
| L | `删除零件A` | ✅ `WRITE_UNSUPPORTED` |
| M | 非 Owner JWT | ✅ 403 `AI_OWNER_ONLY` |
| N | 未认证 | ✅ 401 |
| O | 仅 `x-internal-secret`（及 `x-internal-write-secret`） | ✅ 403 / 401，零提案 |
| P | flag=false | ✅ `WRITE_DISABLED` |
| Q | 用户可见文案含 `[object Object]` | ✅ 已修复（断言不出现） |

附加：未被持久化的消息不生成提案（`NATIVE_WRITE_SOURCE_MISMATCH`）——避免卡片对应错的消息。
预览拒绝路径最多留下 1 条 `FAILED` 任务记录（可审计、无 `writeV1`、无法执行），
E2E 断言不存在任何非终局/可写悬挂任务。

---

## 6. 门禁（干净提交 `f35e029`）

日志：`.dev-local/logs/rework-gates-w15final-20260926T203913.log`（`status=` 为空）

| 门禁 | 结果 |
|---|---|
| Native W1.5 targeted | ✅ 15/15（9 确定性 + 6 真实进程 E2E） |
| Native W1 | ✅ 24/24（未回归） |
| `npm test` | ✅ **2304/2304**（2289 + 15 新增） |
| `verify:api-contract` | ✅ 28/28 |
| `test:deep-api` | ✅ passed 489 / failed 0 |
| `lint` | ✅ PASS |
| `build` | ✅ PASS |
| `test:ai-architecture` | ✅ 9/9 |
| `verify:ai-native-release` | ✅ PASS（`STRUCTURALLY_READY`，`sourceDirty=false`） |
| HC2 Legacy denylist | ✅ 7/7（含在 npm test） |
| SEC-R0 | ✅ 4/4（含在 npm test） |

---

## 7. 未变更证明

| 约束 | 结果 |
|---|---|
| `BUSINESS_API_CHANGED` | **NO**（`api/routes/parts*`、`inventoryCommands`、`partsService` 未改动） |
| `DATABASE_SCHEMA_CHANGED` | **NO**（无迁移文件；`spec_json` 复用；未改状态契约） |
| `COST_ENGINE_CHANGED` | **NO** |
| 前端 | **未触碰** `apps/web-next/**`（无 UI 实现） |
| detached worker | **未启用**：`TASK_WORKER_DEFAULT_ENABLED = false` 保持，`api.cjs` 未启动 worker |
| 写能力数量 | 仍恰好 1 个（`inventory.parts.batch_adjust_stock`）；94 个其它写能力仍被拒绝 |
| 生产 | **未部署**、`.env` 未改、flag 仍 `false`、runtime 仍 `154287dcba36` |

---

## 8. BLOCKERS

**无。**

### 观察（非阻断）

1. **同一句持久化消息重复发送会各生成一份提案**（两张 `WAITING_APPROVAL` 卡）。两者都不写库；
   批准其中一张仍然只写一次（W1 幂等 + 唯一确认身份）。是否需要按 (会话, 消息) 去重可在 W2 一并决定。
2. **提案只认同库中最新一条用户消息**：若客户端先发流式请求、后落库（与现有 UI 顺序相反），
   会得到 `NATIVE_WRITE_SOURCE_MISMATCH` 的明确提示而不是错卡。现有 UI 已是「先落库再流式」，无需改动。
3. **两个既有生产缺陷已顺手修复**（都在本票范围内且被 E2E 断言）：写意图文案的 `[object Object]`；
   `nativeWriteEnabled` 硬编码 `false`。
4. 本票**未实现任何 UI**，W2 仍待授权；`NATIVE_WRITE_PROPOSAL` 事件的消费方（确认卡）尚未存在。
