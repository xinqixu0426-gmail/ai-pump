# NATIVE-W2-PROD-SAFE 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-W2-PROD-SAFE — Deploy Native Write Chat UX with Production Write Kill Switch Still OFF
**Branch:** `ai-native/prod-canary-s2`
**STATUS:** **PASS**
**日期:** 2026-09-26
**报告位置:** 两个 git checkout 之外（`planning/ai-native-w2-prod-safe/`），保证「已推送 = 已验收」一致。

---

## 0. 三个 SHA 与 Web 版本

| 对象 | 值 |
|---|---|
| GitHub `origin/ai-native/prod-canary-s2` | `a8efa83d0c6e29c05f437c731e3312cf2b515c4e`（== `EXPECTED_GITHUB_HEAD`） |
| 生产工作区 `git rev-parse HEAD` | `a8efa83d0c6e29c05f437c731e3312cf2b515c4e` |
| API `/api/health/ready` → `runtime.gitCommit` | `a8efa83d0c6e`（同一 40 位 SHA 前缀） |
| 公网 `https://xuxinqi.xin/api/health/ready` | `a8efa83d0c6e`，ready=true |
| **部署前**生产工作区 HEAD | `154287dcba362709ede48e2866d6e6bbc318c212` |
| **Web BUILD_ID（部署前 → 部署后）** | `esRdWernsehjkYQTYKBqp` → **`2T9AVCKUa7m64Zq5Vp78x`** |

`RUNTIME == WORKTREE == GITHUB` = **YES**；生产工作区干净。

---

## 1. §1 前置检查（全部实测）

| 检查 | 结果 |
|---|---|
| GitHub HEAD == 期望值 | ✅ `a8efa83d0c6e29c05f437c731e3312cf2b515c4e` |
| 生产 HEAD 是 GitHub HEAD 祖先 | ✅ true，**可快进**（领先 7 个提交） |
| 生产工作区干净 | ✅ 干净（操作前后都是 0 改动） |
| API 健康 | ✅ `/api/health/ready` 200 |
| Web 健康 | ✅ `/login` 200、`/ai` 200 |
| `AI_NATIVE_WRITE_ENABLED` | ✅ **false**（若为 true 本票立即 STOP） |
| `AI_NATIVE_MODE` | ✅ `owner` |
| DB schema | ✅ `user_version = 88` |

未使用 `reset --hard`、未 force、未碰 Gitee、未 cherry-pick、未做任何手工 DB 改动。

---

## 2. §2 变更范围审计（`154287d..a8efa83`，7 个提交）

**包含（与票面一致）**：

| 类别 | 文件 |
|---|---|
| W1.5 后端桥 | `api/services/aiNativeWriteChatBridgeV2.cjs`、`api/services/aiDispatcherV3.cjs`、`api/routes/ai/chat.cjs`、`api/services/aiConversations.cjs` |
| W1.5 / W1.5-R1 语义 | `api/services/aiProtectedCommandRoute.cjs` |
| W2 前端 | `apps/web-next/components/ai/NativeWriteProposalCard.tsx`、`ai-view.tsx`、`AiAnswerProcess.tsx`、`AiMessageList.tsx`、`useAiMessageStream.ts`、`useAiConversationHistory.ts`、`apps/web-next/lib/ai.ts`、`ai-write-proposal.cjs/.d.cts`、`ai-write-proposal-client.cjs/.d.cts` |
| docs / 证据 | `docs/api-reference.md`、`docs/ai-native-v1-handoff.md`、`N7.3-closure-validation.json` |
| 测试 | 5 个 W1.5 / W1.5-R1 / W2 测试文件 |

**确认不包含**（逐项 grep 通过）：❌ DB 迁移 / schema、❌ costEngine、❌ Business API（`api/routes/parts*`、`inventoryCommands`）、❌ 第二个 Native Write 能力（`aiNativeWriteScope.cjs` **未被本区间修改**）、❌ DELETE 开放、❌ detached worker（`aiTaskWorkerV2.cjs` 未改动）、❌ Legacy 恢复（无任何 legacy 文件）。

→ **`WEB_REBUILD_REQUIRED = YES`**（`apps/web-next/**` 有改动）。

---

## 3. §3 备份（权威发布备份机制）

| 项 | 值 |
|---|---|
| 机制 | `scripts/deploy-macmini-release.sh` [1/9]：`db:backup:release` + `db:backup:verify` |
| 备份路径 | `/Users/dan/pump-cost-accounting-system/backups/release/pump-release-2026-09-26T14-24-41-176Z.db` |
| source commit | `154287dcba362709ede48e2866d6e6bbc318c212` |
| sha256 | `d4c97b34c3c07ba495674fb448a301201f443d575457d05145b49f71b2b7eb8a` |
| schema | userVersion 88 / migrationVersion 88 / migrationCount 88 |
| 校验 | ✅ `verify --expect-commit 154287d…` → `success: true`，sha256 与创建时一致 |
| 启动备份 | [6/9] 另验证：`success: true`，`gitCommit = a8efa83d0c6e29c05f437c731e3312cf2b515c4e` |
| 密钥泄漏 | ✅ 报告与日志只输出路径/哈希/计数 |

---

## 4. §4/§5 部署与发布门禁

`PUMP_DEPLOY_BRANCH=ai-native/prod-canary-s2 zsh scripts/deploy-macmini-release.sh` 一次走完 [1/9]–[9/9]，
**用时 89 秒**，退出码 0，结束行：`发布完成：commit a8efa83d0c6e，用时 89 秒。`
日志：`/tmp/w2prod-deploy.log`（gate 段第 97–2685 行）。

| 门禁（[4/9] `verify:release`） | 结果 |
|---|---|
| `npm audit` ×2 | ✅ 0 vulnerabilities |
| `verify:api-contract` | ✅ 28/28 |
| `lint` | ✅ PASS |
| `npm test` | ✅ **2327/2327** |
| `test:deep-api` | ✅ passed 489 / failed 0 |
| `build` | ✅ PASS（重新生成 `apps/web-next/.next`） |
| `verify:ai-native-release` | ✅ `status PASS`、`STRUCTURALLY_READY`、`sourceRevision a8efa83` |
| `verify:prod-env` | ✅ 「生产环境变量检查通过」 |

门禁文件：`logs/release-code-gate-a8efa83d0c6e29c05f437c731e3312cf2b515c4e.json` = `{"status":"passed"}`（部署前无该文件，因此**真实执行了全部门禁**，没有复用旧证据）。

**指定套件在生产 gate 内实测存在并通过**：W2-UI 13、W2-E2E 5、W1.5-R1 5、W1.5 15、W1 24、SEC-R0 4、HC2-DENY 7。
另在**生产 checkout 内显式复跑**上述 9 个套件：**73/73 PASS，0 fail**。

`set -euo pipefail` 保证「任何门禁失败即中止，不会走到重启」；本次全绿后才执行 [5/9]。

---

## 5. §6 Web 构建与部署证明（本票的关键新增项）

| 检查 | 结果 |
|---|---|
| 权威流程是否重建 Web | ✅ [4/9] `verify:release` → `npm run build` → `next build`，产出 `apps/web-next/.next` |
| BUILD_ID 变化 | ✅ `esRdWernsehjkYQTYKBqp` → `2T9AVCKUa7m64Zq5Vp78x`（mtime 22:25:46 = 部署构建时刻） |
| 部署前 bundle 是否含 W2 | ❌ 不含（`W2_MARKER_PRESENT_BEFORE=no`） |
| 部署后构建产物是否含 W2 | ✅ `W2_MARKER_PRESENT_AFTER=yes`（chunks `222-13918b42feadf2ad.js`、`852-39cad214ef93757c.js`） |
| **运行中的 Web 是否提供新构建** | ✅ `GET http://127.0.0.1:3000/ai` 引用的 chunk 中，实际下载 `222-…js` 与 `852-…js` 均包含「库存调整确认」→ `SERVED_BUNDLE_HAS_W2=yes` |
| Web 进程重启 | ✅ `pumpfactory-web-daemon` 启动于 **22:26:02**（部署 [5/9] 时刻），非旧进程 |
| `/ai` 部署后可用 | ✅ 本机 200、公网 `https://xuxinqi.xin/ai` 200 |
| 机制 | ✅ 只用既有 LaunchDaemon + 既有发布脚本，未发明新机制、未用 kill+KeepAlive |

---

## 6. §7/§8/§9 重启、提交一致性与 kill switch

| 检查 | 结果 |
|---|---|
| API 重启 | ✅ `launchctl kickstart -k system/com.pumpfactory.api`（pid 27446，startedAt 14:26:02.587Z），**无需 sudo 交互** |
| Web 重启 | ✅ `launchctl kickstart -k system/com.pumpfactory.web`（22:26:02） |
| API runtime commit | `a8efa83d0c6e` |
| 生产工作区 HEAD | `a8efa83d0c6e29c05f437c731e3312cf2b515c4e` |
| GitHub HEAD | `a8efa83d0c6e29c05f437c731e3312cf2b515c4e` |
| **`AI_NATIVE_WRITE_ENABLED`** | ✅ **`false`**（未改；`.env` 全程未编辑） |
| `AI_NATIVE_MODE` | `owner`（未改） |
| Web 版本证明 | §5（BUILD_ID + 服务端实际下发的 chunk 内容） |

---

## 7. §10/§11/§13 真实生产 flag=false 行为（Owner 身份，只读探测）

Owner 会话经真实 Owner 认证网关（`127.0.0.1:3104`，`/api/auth/check` → `owner:true`）取得；未启用写开关、未批准/执行任何写入。

| 用例 | 请求 | 实测 |
|---|---|---|
| 变更意图 | `把一个真实零件库存增加1` | ✅ 200，`stage=native_write_disabled`，`detail.state=WRITE_DISABLED`，`nativeWriteEnabled=false`；**无 `write_proposal` 事件、无 confirmationToken**；文案无 `[object Object]` |
| 绝对目标值 | `把6202库存增加到30` | ✅ 同样 `WRITE_DISABLED`（kill switch 优先，绝不解释为写入） |
| Owner 只读 | `V550大脚板-2寸-经典款现在成本多少？` | ✅ `task_v2` → `SUCCEEDED`（只读不受影响） |
| 非 Owner（admin JWT） | 变更意图 | ✅ **403** |
| 未认证 | 变更意图 | ✅ **401** |
| 仅 `x-internal-secret` | 变更意图 | ✅ **403 `AI_OWNER_ONLY`** |

**W2 UI 行为（flag=false）**：`write_proposal` 事件根本不出现 → 前端 `isNativeWriteProposalEvent` 对所有事件为假 → 不渲染 `NativeWriteProposalCard`、不存在「确认执行」/「取消」按钮、不会发出任何 preview/execute/reconcile 请求（该判定已由 13 个前端契约用例与 5 个真实链路用例锁定，其中 flag=false 用例断言无任何事件构成卡片）。未临时开启开关、未使用假数据。

**绝对目标值在「开关打开时」的安全性**：生产未开开关，因此按票面要求改用**部署代码内的证据**：
- 部署 checkout 内 `api/services/aiProtectedCommandRoute.cjs:182` 先于增量抽取判定 `isAbsoluteStockTarget`，
  `api/services/aiNativeWriteChatBridgeV2.cjs:45` 映射为 `NATIVE_WRITE_ABSOLUTE_STOCK_UNSUPPORTED`；
- 生产 checkout 内实跑 `tests/nativeW15R1DeltaSemantics.test.cjs` → **5/5 PASS**（含「增加到30 / 减到20 / 改为30 / 设为30 → absolute_target」与解析顺序证明）。

---

## 8. §12 静态 W2 部署证明

| 检查 | 结果 |
|---|---|
| `NativeWriteProposalCard.tsx` 存在于部署 checkout | ✅ |
| `ai-write-proposal.cjs/.d.cts`、`ai-write-proposal-client.cjs/.d.cts` 存在 | ✅ |
| `write_proposal` SSE 处理 | ✅ `apps/web-next/lib/ai.ts`、`components/ai/useAiMessageStream.ts` 各 1 处 |
| 历史失效卡片行为 | ✅ `useAiConversationHistory.ts` 使用 `hydrateHistoricalWriteCard()` |
| 唯一 UI 能力 | ✅ 作用域模块仍为 `["adjust_part_stock"]` / `["inventory.parts.batch_adjust_stock"]`；前端只接受该 capabilityId |
| 通用写 UI | ✅ **无**（`grep write_proposal components/` 仅命中卡片与流处理两处） |

---

## 9. §14 安全回归（生产实测）

| 检查 | 结果 |
|---|---|
| Owner-only AI 边界 | ✅ 非 Owner 403、未认证 401、内部密钥 403 `AI_OWNER_ONLY` |
| `INTERNAL_SECRET` 仍只读 | ✅ `GET /api/parts` + 内部密钥 200；`POST /api/parts` + 仅内部密钥 **403 `INTERNAL_WRITE_FORBIDDEN`** |
| `INTERNAL_WRITE_SECRET` 独立配置 | ✅ 存在、64 字符、与 `INTERNAL_SECRET` 及 `ACCESS_PASSWORD` 互异（只输出长度与布尔） |
| 内部凭据不能充当 Owner | ✅ 实测 403；SEC-R0 套件 4/4 PASS |
| SEC-R0 | ✅ PASS |
| Legacy 物理不存在 | ✅ `aiAssistantRuntime.cjs` / `aiAgentRuntimeV3.cjs` / `aiReadInvestigationDriverV4.cjs` 均 ABSENT |
| HC2 denylist | ✅ PASS（7/7） |
| 密钥轮换 | 未做（本票不需要）；报告中无任何密钥值 |

---

## 10. §15 数据安全（部署 + 验收窗口前后）

窗口 `2026-09-26T14:24Z → 14:35Z`（覆盖 ff 部署、API/Web 重启、真实 Owner 只读探测）：

| 表 | before | after | Δ |
|---|---|---|---|
| parts（数量 / 库存合计） | 92 / 8800 | 92 / 8800 | **0 / 0** |
| parts 指纹 | `8c2b856b…` | `8c2b856b50e3fc2b92b2a194f99089a326be4f0df353c100668039e64088e7c9` | **一致** |
| coils（数量 / 指纹） | 14 / `2c8225a8…` | 14 / `2c8225a8d79cbd273c659a12ea58d16d184cb5a883fc2e3028a0a5e0990a73cf` | **0 / 一致** |
| recipes / orders / quotations | 3 / 1 / 1 | 3 / 1 / 1 | **0** |
| business_change_events | 155 | 155 | **0** |
| `inventory.parts.batch_adjust_stock` 操作行 | 3 | **3** | **0**（无任何新增库存变更操作） |
| ai_tasks | 0 | **0** | **0**（未创建任何 AI 任务） |
| api_operations | 1854 | 1856 | **+2** |
| audit_log | 6821 | 6823 | **+2** |

**非零增量逐条归因**：`api_operations` +2 = `quotations.expire_overdue`（`system:quotation-expiry`）+ `market.sync_copper_price`（`system:market-sync`），时间戳 `2026-09-26T14:26:02.852Z / .854Z`，紧随 14:26:02.587Z 的 API 重启（启动期调度）；`audit_log` +2 为同两条系统任务的 INSERT（`user=system`）。探针残留：`parts LIKE '%W2-PROD%'` = **0**。

→ **`BUSINESS_MUTATION_OCCURRED: NO`**（零 Native AI 写入）。

---

## 11. §17 退出标准核对

| # | 标准 | 结果 |
|---|---|---|
| 1 | production checkout == GitHub HEAD | ✅ `a8efa83` |
| 2 | API runtime == GitHub HEAD | ✅ `a8efa83d0c6e` |
| 3 | 生产 Web 构建含 W2 | ✅ BUILD_ID 变化 + 服务端下发 chunk 含 W2 标记 |
| 4 | W1.5 / R1 / W2 已部署 | ✅ 三者在部署 checkout 内存在并通过各自套件 |
| 5 | `AI_NATIVE_WRITE_ENABLED=false` | ✅ |
| 6 | Owner 写请求 = WRITE_DISABLED | ✅ |
| 7 | flag=false 时不发 `write_proposal` | ✅ |
| 8 | flag=false 时无可执行卡片 | ✅ |
| 9 | 零 Native AI 写入 | ✅ §10 |
| 10 | 唯一 W1 能力（代码与 UI） | ✅ |
| 11 | 部署代码含绝对目标值保护 | ✅ §7 |
| 12 | Owner 只读保持 | ✅ |
| 13 | 非 Owner 403 | ✅ |
| 14 | 未认证 401 | ✅ |
| 15 | SEC-R0 保持 | ✅ |
| 16 | Legacy denylist 保持 | ✅ |
| 17 | DB schema 未变 | ✅ 88 |
| 18 | costEngine 未变 | ✅ |
| 19 | Business API 未变 | ✅ |
| 20 | 发布门禁 PASS | ✅ §4 |
| 21 | API/Web 健康 | ✅ 200/200/200，公网 ready=true |
| 22 | 工作区干净 | ✅ |

---

## 12. BLOCKERS

**无。**

### 观察（非阻断）

1. **Web 版本证明方式**：仓库没有「Web 构建对应的 commit」标记文件，因此用三层证据代替：
   `BUILD_ID` 变化 + 构建产物含 W2 标记 + **运行中的 Web 实际下发的 chunk 含 W2 标记**（部署前同一检查为「无」）。
   未为此新增任何产品端点。
2. **本机 `/ai` 页面在部署后仍建议浏览器强刷一次**：SSE/JS chunk 已由服务端更新（已验证），
   但旧标签页可能仍持有旧 chunk；这不是部署缺陷。
3. **`native_write_ops` 生产基线为 3 条**：那是**业务页面/接口**正常使用同一 capability 的历史记录
   （非 AI 写入）；本票窗口内 Δ=0。后续 AI canary 评估时需要按 `actor_key`/请求来源区分 AI 与人工写入。
4. **Owner canary 未启动**（按票面要求）。
