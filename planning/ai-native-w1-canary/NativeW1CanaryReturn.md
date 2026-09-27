# NATIVE-W1-CANARY 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-W1-CANARY — Owner Production Canary / First Real Native AI Write
**Branch:** `ai-native/prod-canary-s2`
**STATUS:** **PASS**
**日期:** 2026-09-26
**报告位置:** 两个 git checkout 之外（`planning/ai-native-w1-canary/`），保证「已推送 = 已验收」一致。

---

## 0. 结论

第一笔真实生产 Native AI 写入**由 Owner 本人在 `/ai` 界面发起并确认**，完整闭环成立：

```
Owner 自然语言「把轴承-202库存增加1」
  → 确定性命令路由（0 次额外模型调用）
  → canonical 唯一零件 #150（轴承-202）
  → 既有 W1 正式预览 → 冻结提案（当前 200 → 调整后 201）
  → 任务 WAITING_APPROVAL + 结构化 NATIVE_WRITE_PROPOSAL 事件 → W2 确认卡
  → Owner 人眼核对并点击「确认执行」
  → 批准事实先落盘（CONFIRMED）→ 既有 Business API 写一次（api_operations 完成）
  → 独立回读核验 stock=201 → VERIFIED → SUCCEEDED
  → UI 显示核实值：库存 200 → 201 / 已核实当前库存：201
```

**恰好一次**业务写入，**只有**被选中的那一个零件发生变化，其余一切未变。

---

## 1. SHA / 生产状态

| 对象 | 值 |
|---|---|
| GitHub HEAD | `a8efa83d0c6e29c05f437c731e3312cf2b515c4e` |
| 生产工作区 HEAD | `a8efa83d0c6e29c05f437c731e3312cf2b515c4e` |
| API runtime | `a8efa83d0c6e` |
| Web 构建 | BUILD_ID `2T9AVCKUa7m64Zq5Vp78x`（W2 卡片已生效，运行中 Web 实际下发） |
| 工作区 | ✅ 干净（0 改动） |
| health / ready | ✅ 200 / ready=true |

## 2. §3 备份 与 §4 回滚程序

| 项 | 值 |
|---|---|
| release 备份 | `/Users/dan/pump-cost-accounting-system/backups/release/pump-release-2026-09-26T15-13-34-301Z.db` |
| source commit / schema | `a8efa83d0c6e29c05f437c731e3312cf2b515c4e` / 88（88/88） |
| sha256 / 校验 | `60798cab7051eb1f056d05f512635a0a0b8c6bf55d1864468a0be0ed066b7465` / ✅ `success:true` |
| `.env` 备份 | `.env.bak-before-canary-20260926T231413`（mode 600） |
| 回滚程序 | `/Users/dan/w1-canary/canary-rollback.sh`（幂等、无需 sudo、不打印密钥）：flag→false → `launchctl kickstart -k system/com.pumpfactory.api` → 轮询 ready → 运行 `canary-verify-disabled.cjs` 断言 `WRITE_DISABLED` |
| 启用前验证 | ✅ 回滚目标状态实测成立（Owner 写意图 = `WRITE_DISABLED`，无提案、无 token） |

## 3. §5 只改一个开关

`.env` diff = **removed 1 行 / added 1 行**，且只有 `AI_NATIVE_WRITE_ENABLED`（false→true）；
`AI_NATIVE_MODE`、`TASK_WORKER_DEFAULT_ENABLED`、`INTERNAL_SECRET`、`INTERNAL_WRITE_SECRET`、
`ACCESS_PASSWORD`、`JWT_SECRET`、`PUMP_OWNER_SUBJECT` **逐字节未变**；白名单未改。
开关生效证据（无副作用）：API 启动日志 `[AI Native] mode=owner authority=owner-scoped-native writeEnabled=true`。

## 4. §7 写入范围（canary 前）

| 项 | 值 |
|---|---|
| 允许的 Native Write 能力 | **恰好 1**：`inventory.parts.batch_adjust_stock` |
| 被拒写/命令能力 | **94** |
| DELETE 允许数 | **0**（17 个删除类全部拒绝） |
| 非 W1 能力走向 | `WRITE_UNSUPPORTED`（dispatcher 静态分支；隔离运行时既有证据：线圈库存/调价/删除 → `WRITE_UNSUPPORTED`） |
| detached worker | 关闭 |

## 5. §9 基线与 §10 人工步骤

| 项 | 值 |
|---|---|
| 目标（Owner 选择） | `轴承-202`（canonical id **150**，万佳轴承，¥1.2，型号唯一 `matches=1`） |
| 基线库存 | **200**（`updated_at 2026-09-20T02:53:58.752Z`） |
| 请求 delta | **+1** |
| 提案值（实测） | currentStock **200** / delta **+1** / nextStock **201** |
| Owner 确认 | ✅ 由 Owner 本人在生产 `/ai` 点击「确认执行」（Codex 未代点、未自行发起任何写入） |

## 6. §11 独立核验（权威数据源，全部 PASS）

| 检查 | 结果 |
|---|---|
| A 库存 | `轴承-202` 由 **200 → 201**；`expected 201 == actual 201` ✅ |
| B api_operations | 该能力总数 3 → **4**；新增 `id 1903`，`status=completed`，幂等键 `part-stock:953fef2d-…`，`completed_at 16:05:01.239Z`；actor `internal:bf861921…`（AI 写通道，与历史人工行 `internal:30fe890f…` 可区分） ✅ |
| C 幂等/重复 | 新增 completed = **1**，distinct idempotency keys = **1**，`idempotentReplay=false` ✅ |
| D 审计 | `audit_log id 7075`：`UPDATE parts record_id=150`，`user=internal:bf861921…`，`operation_id=953fef2d-…`，`capability_id=inventory.parts.batch_adjust_stock` ✅ |
| E 业务变更事件 | `business_change_events id 156`：`operation_id=953fef2d-…`，`event_type=inventory_changed`，summary「调整库存零件 轴承-202（#150）」，`changes=[{part,150,stock,from:200,to:201,delta:1}]`，`audit_ids=[7075]` ✅ |
| F 任务链路 | 任务 `ef6f9d79-…`：`businessWritePolicy=CONFIRMATION_REQUIRED`，goal `PREPARE_CHANGE→VERIFIED`，`writeV1.phase=PROPOSAL_READY→CONFIRMED→COMMITTED→VERIFIED`，`approval.ownerSubject=fca467f4…`/`approvedAt 16:05:01.225Z`，`verification={verified:true,stock:201,partId:150}`，`execution={operationId:953fef2d…,status:completed,auditIds:[7075]}`，任务终态 **SUCCEEDED**；COMMAND step `SUCCEEDED` 且绑定同一 operationId ✅ |
| G UI 真实性 | UI 成功块渲染的是服务端 **核实值**（`verification.stock=201`），不是提案值；Owner 回报「核验成功」与库内一致 ✅ |

## 7. §12 零额外写入证明

| 项 | 结果 |
|---|---|
| 库存被改动的零件 | **恰好 1 个**：`id 150 轴承-202`（按 `updated_at > 开关启用时刻` 查询） ✅ |
| 线圈 | 无任何行更新（`coils_updated_since_flag=[]`），指纹与基线一致 `2c8225a8…` ✅ |
| 配方 / 订单 / 报价 | 3 / 1 / 1，与基线一致 ✅ |
| 开关启用后的 operation（按能力） | `inventory.parts.batch_adjust_stock` **1**（canary）；`ai.conversations.create` 1 + `ai.conversations.messages.append` 4（Owner 对话记账）；`market.sync_copper_price` 1 + `quotations.expire_overdue` 2（**系统定时任务**，已区分） ✅ |
| 不相关的 Native AI 写入 | 0 ✅ |

**关于 Owner 的第一次尝试**（15:52:36）：产生了任务 `ddf5384b-…`，终态 **FAILED**，
`hasWriteV1=false`、`approvalOperationIds=[]`、无 COMMAND step —— 即**在预览阶段安全失败，零写入**
（符合 W1.5 设计：预览拒绝不留可写任务）。它没有产生任何 operation 或库存变化。

## 8. §13 重放安全（未做第二次写入）

| 检查 | 结果 |
|---|---|
| 已完成任务状态 | `SUCCEEDED`（终局） |
| 冻结提案阶段 | `VERIFIED`（不再是 `PROPOSAL_READY`） |
| `write-execute` 是否可能再次准入 | **否**（要求 `state=WAITING_APPROVAL` 且 `phase=PROPOSAL_READY`） |
| 重新预览 | 终局任务被拒（`TASK_WRITE_STATE_INVALID`） |
| 重复 HTTP 重放 | 未在生产重放；隔离证据：W2-E2E-2 / W1-LOOP-2（重复确认库存只变一次） |

## 9. §18 安全回归（生产实测，flag=true 下）

| 检查 | 结果 |
|---|---|
| 未认证 → write-execute | ✅ 401 |
| 非 Owner（admin JWT） | ✅ 403 `NATIVE_WRITE_OWNER_REQUIRED` |
| `x-internal-secret` | ✅ 403 `NATIVE_WRITE_OWNER_REQUIRED`（内部密钥不能批准 Owner 提案） |
| `x-internal-write-secret` | ✅ 401（不能作为 Owner 身份） |
| `INTERNAL_SECRET` 只读 | ✅ `GET /api/parts` 200；`POST /api/parts` 403 `INTERNAL_WRITE_FORBIDDEN` |
| SEC-R0 / HC2 denylist | ✅ 4/4 与 7/7（发布门禁内） |
| Legacy / worker / DELETE | ✅ Legacy 文件 ABSENT、worker 关闭、DELETE 允许 0 |
| 服务健康 | ✅ API ready 200、Web `/ai` 200 |
| 工作区 | ✅ 干净 |

## 10. §15 未做补偿写入

未做任何自动回补。`轴承-202` 现在的 201 是**合法业务事实**。若 Owner 希望回到 200，
必须由 Owner 再发起**第二笔显式审批**的 `-1`（走完全相同的提案→确认→核验流程）。

## 11. §17 待 Supervisor 决策（Codex 不做该产品决策）

当前生产 `AI_NATIVE_WRITE_ENABLED` **仍为 `true`**（canary 环境保持启用），白名单未扩大。
请 Supervisor 决定：
- **A** 保持启用，供 Owner 正常使用该唯一能力；或
- **B** 验收后关回 `false`（一条命令即可，脚本已就绪：`/Users/dan/w1-canary/canary-rollback.sh`）。

**BLOCKERS：无。**
