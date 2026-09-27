# NATIVE-W2 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-W2 — Native Write V1 Chat UX: Proposal → Owner Confirmation → Verified Result
**Branch:** `ai-native/prod-canary-s2`
**STATUS:** **PASS**
**日期:** 2026-09-26
**报告位置:** 两个 git checkout 之外（`planning/ai-native-w2/`），保证「已推送 = 已验收」一致。

---

## 0. 提交与基线

| 项 | 值 |
|---|---|
| START_COMMIT | `cc00b54a957337dea9cbfdf2cdea889235c1e437` |
| END_COMMIT | `a8efa83d0c6e29c05f437c731e3312cf2b515c4e` |
| GitHub `origin/ai-native/prod-canary-s2` | `a8efa83d0c6e29c05f437c731e3312cf2b515c4e`（与本地一致） |
| 工作区 | ✅ 干净 |
| 生产 | **未部署**（HEAD 仍 `154287d`、runtime `154287dcba36`），`AI_NATIVE_WRITE_ENABLED=false` 未改 |

改动文件（13 个，**全部在 `apps/web-next` 与 W2 测试内，后端零改动**）：

```
apps/web-next/lib/ai-write-proposal.cjs / .d.cts        新增：卡片纯展示与状态逻辑
apps/web-next/lib/ai-write-proposal-client.cjs / .d.cts 新增：执行/对账唯一入口（注入式 request）
apps/web-next/components/ai/NativeWriteProposalCard.tsx 新增：确认卡片组件
apps/web-next/lib/ai.ts                                 SSE 事件类型、历史标记、执行客户端封装
apps/web-next/components/ai/AiAnswerProcess.tsx         ChatItem 增加结构化 writeProposal
apps/web-next/components/ai/useAiMessageStream.ts       write_proposal → 卡片状态
apps/web-next/components/ai/useAiConversationHistory.ts 历史会话 → 失效卡片
apps/web-next/components/ai/AiMessageList.tsx           渲染卡片 + 回调
apps/web-next/components/ai-view.tsx                    确认/取消回调 + 在途防重复 + 非执行历史标记
tests/nativeW2WriteProposalUi.test.cjs                  新增：13 个展示/交互契约用例
tests/nativeW2WriteProposalHttpE2E.test.cjs             新增：5 个真实进程链路用例
```

---

## 1. 产品体验（flag=true 的真实链路，隔离实例实测）

```
老板：把 W2-6202轴承 库存增加 100
助手：〔库存调整确认〕
        W2-6202轴承
        当前库存        350
        本次调整      +100（增加）
        调整后库存      450
        [确认执行]  [取消]
      ← 此刻库存仍为 350，零 operation
老板点击 [确认执行]
      → 正在执行并核验库存…（按钮立即禁用，重复点击不产生第二个请求）
      → 既有 W1 write-execute（服务端签发身份）
      → 必要时既有 write-reconcile（只读、有界）
      → 服务端回读核验
助手：〔库存调整完成〕
        零件：W2-6202轴承
        库存：350 → 450
        已核实当前库存：450
      ← 库存恰好 +100，api_operations 恰好 1 条
```

## 2. 实现要点（对应 ticket 各节）

| ticket | 要求 | 实现 |
|---|---|---|
| §3 | 结构化事件而非 Markdown | `AiStreamEvent` 增加 `write_proposal`；`ChatItem.writeProposal` 保存卡片状态（显式类型，不做文本重建） |
| §4 | 只渲染服务端数据 | `toProposalCardModel` 只用 `proposal.items[0]` 的 model/currentStock/delta/nextStock；组件静态契约测试断言组件源码**不含**任何算术 |
| §5 | delta 显式符号 | `formatDelta` → `+100` / `−20`（U+2212），并附方向文字（增加/减少），不依赖颜色 |
| §6 | clampedToZero | 只用服务端 `clampedToZero`：为真才显示「注意：本次减少量超过当前库存，执行后库存将为 0。」；为假即便 nextStock=0 也不提示（测试锁定） |
| §7 | 确认用既有契约 | `buildExecuteRequestBody` 原样转发 `{version, expectedRevision, confirmationToken, toolName, args}`；篡改显示值不影响请求体（测试锁定） |
| §8 | 在途状态 | 点击后立即 `executing`（按钮禁用、取消禁用），显示「正在执行并核验库存…」；`ai-view` 另有 messageId 级在途集合，双击不会发出第二个请求 |
| §9 | 取消 | 纯本地失活（`cancelled` + 「已取消本次库存调整。」），**零网络请求**（测试断言） |
| §10 | 成功判定 | 只有 `outcome.verified === true` 才成功；「库存：350 → 450 / 已核实当前库存：450」取核实值（核验值与提案值不同时以核实值为准，测试锁定） |
| §11 | 对账 | 执行返回未定 → 显示「正在核对本次库存调整结果…」，随后有界调用**既有** `write-reconcile`（只读）；成功→成功态，安全失败→失败态；**永不自动发起第二次写入**（测试断言 execute 调用恰好 1 次） |
| §12 | 失败映射 | 按 ticket 给出的码逐条映射为固定文案；测试断言每条文案**不包含**后端码本身 |
| §13 | 绝对目标值 | 后端 `NATIVE_WRITE_ABSOLUTE_STOCK_UNSUPPORTED` 是普通澄清消息；`isNativeWriteProposalEvent` 为假 → 无卡片、无按钮、无预览（E2E 实测） |
| §14 | 其它澄清 | 缺数量/歧义/多目标/目标不存在等同样不出卡片（E2E 实测） |
| §15 | 非 W1 变更 | 只有 `capabilityId === inventory.parts.batch_adjust_stock` 才可能出卡片；线圈/调价/删除 → WRITE_UNSUPPORTED，前端不渲染通用确认卡 |
| §16 | 重复提案 | 每个服务端提案/任务独立身份；同文本不同 taskId 不合并（测试锁定）；卡片内只允许一次在途执行；后端幂等仍是真正保护 |
| §17 | 重载/历史 | 只持久化 `{capabilityId, taskId}` 这种**非执行**标记；不持久化 token、不持久化可重建请求的数值；重载后渲染「该库存调整方案已失效，请重新生成方案。」且不可执行 |
| §18 | flag=false | 生产默认下聊天只得到 WRITE_DISABLED → 无卡片、无按钮、无任何 preview/execute/reconcile 浏览器请求（E2E 实测）；没有前端开关可以绕过服务端 |
| §21 | 设计语言 | 复用 `rounded-panel/border-line/shadow-panel` 与既有 Button；紧凑、无模态套娃；不显示任务状态枚举/operationId/幂等键/哈希 |
| §22 | 前端安全 | 新增模块**零 console 调用**、零浏览器存储（静态契约测试）；确认 token 不进入任何日志或 localStorage（已审计触碰文件） |
| §23 | 可访问性 | 真实 `<button>`（可聚焦、可禁用）、`aria-busy`、`role="status" aria-live="polite"` 的在途文案、`role="alert"` 的失败文案、关键提示为文字而非仅颜色、失效卡片明显降饱和 |

---

## 3. 测试证据

### W2 前端契约（`tests/nativeW2WriteProposalUi.test.cjs`，13/13）

覆盖 §20 的 19 个场景在决策层的行为，含：正向/负向提案、clampedToZero、取消零请求、
重复确认只执行一次、失败码逐条映射、非提案事件不出卡、重载历史卡片不可执行、
多提案身份独立，以及静态 UI 契约（组件不算术、不渲染内部证据、使用真实按钮与禁用态）。

### W2 真实链路（`tests/nativeW2WriteProposalHttpE2E.test.cjs`，5/5）

| 用例 | 实测 |
|---|---|
| E2E-1 | 真实 SSE 提案 → 卡片数值与服务端逐项一致（350/+100/450）→ 确认前库存不变且零 operation → 确认后 `verified`、库存 350→450 恰好一次、1 条 `inventory.parts.batch_adjust_stock`、任务 `SUCCEEDED` |
| E2E-2 | 重复确认（双击/重放同一张卡）：库存仍只 +100，operation 仍为 1；UI 侧成功后卡片不可再执行 |
| E2E-3 | 取消：建立在真实提案上，零请求、零写入、卡片失活 |
| E2E-4 | flag=false：无任何事件构成卡片；库存不变、零 operation、零任务 |
| E2E-5 | 绝对目标值/缺数量/多目标/线圈变更：都不出卡片、零写入 |

**关于 §19「不得用假装是 UI 的 API 脚本」的诚实说明**：本仓库**没有浏览器测试框架**
（无 playwright/puppeteer/vitest/jest；前端只由 `lint` + `next build` 验证），§26 允许在没有
可用机制时不引入重型框架。因此 E2E **不是**手写 API 脚本，而是用**卡片组件所使用的同一批前端模块**
（`createWriteCard` / `toProposalCardModel` / `reduceWriteCard` / `confirmNativeWriteProposal`
以及 `ai-view` 相同的调用顺序）去驱动真实服务端；唯一未覆盖的是 React 渲染本身，该层由
`next build`（类型检查 + 编译）与 `lint` 保障。

### 门禁（干净提交 `a8efa83`）

日志：`.dev-local/logs/rework-gates-w2final-20260926T215558.log`（`status=` 为空）

| 门禁 | 结果 |
|---|---|
| W2 frontend | ✅ 13/13 |
| W2 integration/E2E | ✅ 5/5 |
| W1.5-R1 | ✅ 5/5 |
| W1.5 | ✅ 15/15 |
| W1 | ✅ 24/24 |
| `npm test` | ✅ **2327/2327**（2309 + 18 新增） |
| `verify:api-contract` | ✅ 28/28 |
| `test:deep-api` | ✅ passed 489 / failed 0 |
| `lint` | ✅ PASS |
| `build` | ✅ PASS |
| `test:ai-architecture` | ✅ 9/9 |
| `verify:ai-native-release` | ✅ PASS（`STRUCTURALLY_READY`、`sourceDirty=false`） |
| HC2 denylist | ✅ 7/7 |
| SEC-R0 | ✅ 4/4 |

## 4. 未变更证明

| 约束 | 结果 |
|---|---|
| `BUSINESS_API_CHANGED` | **NO** |
| `DATABASE_SCHEMA_CHANGED` | **NO** |
| `COST_ENGINE_CHANGED` | **NO** |
| 后端文件 | **零改动**（`git diff --stat` 仅 `apps/web-next/**` 与 `tests/nativeW2*`） |
| 写能力数量 | 仍恰好 1 个；前端只认这一个 capabilityId |
| 生产 | 未部署、`.env` 未改、flag 仍 `false` |

## 5. BLOCKERS

**无。**

### 观察（非阻断，供后续决定）

1. **同一句持久化消息重复发送会产生第二张未批准提案卡**（W1.5 已记录）：W2 按 ticket §16
   保持「每个服务端提案独立身份」，未做文本级去重；两张卡都不写库，批准其中一张仍只写一次。
   若希望合并，需要后端提供按 (会话, 消息) 的提案幂等——属于后端范围，本票未动。
2. **历史卡片只显示「已失效」**：因为没有持久化确认身份（§17 要求），重载后无法展示历史数值。
   这是有意的安全取舍（显示值不可用于重建请求）。
3. W1.5 的 `NATIVE_WRITE_PROPOSAL` 事件已被消费；若后续新增能力，需要重新做同样的
   展示/确认设计，而非把它扩成通用写平台（本票未建通用框架）。
