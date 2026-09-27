# NATIVE-W1-LIVE-R1 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-W1-LIVE-R1 — Native Write V1 First-Use Stabilization（保持单能力在线）
**Branch:** `ai-native/prod-canary-s2`
**STATUS:** **PASS（开发与门禁完成；按 §12 未部署，等 Supervisor 批准部署）**
**日期:** 2026-09-26
**报告位置:** 两个 git checkout 之外（`planning/ai-native-w1-live-r1/`）

---

## 0. 一句话结论

Owner 第一次失败**不是**安全事件，而是一个**真实可用性缺陷**：中文里「库存」也可以说在动作之后
（「将轴承202增加1库存」），而旧实现一律以「库存」为右边界，把动作与数量一起吞进了目标
（抽出 `"轴承202增加1"`），于是预览找不到零件、任务安全失败、**零写入**。
本票只修这一个边界问题（外加失败原因可观测性），**没有**放宽任何写安全语义；生产**未部署**。

---

## 1. §2 第一次失败的事实（全部取自权威记录，非推测）

| 项 | 值 | 来源 |
|---|---|---|
| 任务 | `ddf5384b-8015-43cb-9145-bf710db6b9d2` | `ai_tasks` |
| **用户原话** | **「将轴承202增加1库存」** | `ai_tasks.spec_json.userGoal` + `ai_conversation_messages id=404` |
| 助手回复 | 「没有找到要调整的零件，请确认型号后重新提交。」 | `ai_conversation_messages id=405` |
| 命令路由 | `adjust_part_stock`（族识别成功） | 复现 + 任务确实被创建 |
| 抽取到的目标 | **`轴承202增加1`**（错误：含动作与数量） | 复现 |
| 抽取到的数量/动作 | `+1`（正确） | 复现 |
| 为何 hasWriteV1=false | 正式预览以「目标找不到」拒绝 → 桥未持久化提案 | 复现 + `spec.writeV1` 缺失 |
| 失败阶段/码 | 预览阶段 `part_stock_target_not_found`（用户文案与该码 1:1） | 助手文案 + 复现 |
| 来源消息持久化是否有关 | **无关**：任务绑定 `user_message_id=404`，`inputHash` 校验通过（否则 createTask 会直接抛错） | `createTask` 契约 + 任务存在 |
| 是否预期的不支持措辞 | **不是**：这是本能力语义族内的自然词序 | §2 分类 |
| 第二次为何成功 | 「将 轴承-202 库存增加1」→ 右边界正好落在「库存」→ 目标 = `轴承-202` | 生产实录 |

零写入证据：无 `writeV1`、无 `approvalOperationIds`、无 `ai_task_steps`、无 `api_operations`、库存未变。

## 2. §3 分类

**`SUPPORTED_PHRASE_BUG`**（主因：目标边界对词序敏感）。

同时必须诚实区分一个**次因**：该句里用户写的是 `轴承202`，而目录里的规范型号是 `轴承-202`
（少一个连字符）。这一条**不是**缺陷、也**不应**修复：W1 明确要求精确解析、禁止模糊首匹配
（§5），正确行为就是给出安全拒绝。修复后用户会看到回显的型号，从而自己发现是写法差异——
这正是第二次尝试成功的原因。

## 3. 修复（只改两处行为，均不触碰写安全）

| # | 改动 | 说明 |
|---|---|---|
| 1 | `partStockTargetMention`：右边界改为「库存锚点」与「第一个增减/赋值动词」中**更靠前者** | 词序不再影响型号抽取；`将轴承-202增加1库存` 现在能正常生成提案；`把轴承-202库存增加1` 等原句式**逐字不变** |
| 2 | 目标找不到时回显用户写的型号（长度≤60，纯文本渲染） | 「没有找到型号为「轴承202」的零件，请确认准确型号后再试。」——直接帮助发现型号写法差异 |
| 3 | 预览拒绝时把 `{phase:'PREVIEW_REJECTED', code}` 写入既有 `TASK_FAILED` 事件 | §6 可观测性：首用调查时只能靠用户文案反推失败码，属真实缺口；**不新增任何平台/端点** |

明确**未**做：不模糊匹配型号、不放宽任何澄清类拒绝、不扩大白名单、不加第二个能力、
不改 schema/Business API/costEngine、不启用 worker、不恢复 Legacy。

## 4. §6/§7 安全失败质量（对照票面示例）

| 场景 | 现有文案 | 判定 |
|---|---|---|
| 缺数量 | 「请说明要调整的数量，例如「把 6202 轴承库存增加 100」。」 | ✅ 与示例等价 |
| 绝对目标值 | 「当前只支持按数量增加或减少库存，请明确说增加多少或减少多少。」 | ✅ 与示例等价 |
| 多目标 | 「一次只能调整一个零件的库存，请分开提交。」 | ✅ 与示例等价 |
| 目标歧义 | 「找到多个匹配的零件，无法确定要调整哪一个，请改用更精确的型号。」 | ✅（**未**列出候选：当前聊天链路没有把候选集带到该层，票面 §7 的候选展示是「若现有读基础设施已支持」的条件项，故不扩范围） |
| 目标找不到 | **已改进**：回显用户型号 + 「请确认准确型号后再试。」 | ✅ 本票修复 |

## 5. §11 回归测试

| 用例 | 内容 |
|---|---|
| `W1LIVE-R1-1` | **生产原句锚点**「将轴承202增加1库存」→ mention 必须是 `轴承202`（不得含「增加1」） |
| `W1LIVE-R1-2` | 词序矩阵：库存在前/在后/无把将/带「的」/标准句式 7 种 → 同一型号与增量 |
| `W1LIVE-R1-3` | 词序修复**不改变**安全语义：绝对目标值/缺目标/缺数量/方向冲突仍被拒 |
| `W1LIVE-R1-4` | 失败文案回显型号；无型号时退回稳定文案；长度受限 |
| `W1LIVE-R1-5` | 生产第二次成功原句仍产生完全相同的提案事实 |
| `W15-E2E-7`（真实进程） | 生产词序 + 型号写法不一致 → 安全失败、`TASK_FAILED` 事件**携带原因码**、零 COMMAND step、零写入 |

**过程中发现并修复了我自己的一个测试隐患（诚实披露）**：W1.5/W2 的真实进程 E2E 在「预览」与
「执行」两步各自调用一次 `ownerCookie()`，而每次调用都会签发新 JWT（`iat` 以秒计）。同一秒内
两次签发得到同一 token，测试一直侥幸通过；在整仓门禁的并发负载下跨过秒边界后，两次请求属于
**不同登录会话**，服务端正确地返回 `403 confirmation_subject_mismatch`。这恰好反证了
「确认凭证绑定登录会话」这一安全不变量在真实环境中生效。已改为复用同一个 cookie（真实浏览器行为），
并更正了上一提交消息里的测试数字（该提交门禁实跑为 2332 passed / 1 failed）。

## 6. 门禁（干净提交 `1952d6c`）

日志：`.dev-local/logs/rework-gates-w1liver1f2-20260927T005210.log`（`status=` 为空）

| 门禁 | 结果 |
|---|---|
| W1.5-R1 / W1.5 / W1 / W2 | ✅ 5/5、16/16、24/24、18/18（W2-UI 13 + W2-E2E 5） |
| W1-LIVE-R1（新增） | ✅ 5/5 + E2E 回归 7/7 |
| `npm test` | ✅ **2333/2333** |
| `verify:api-contract` | ✅ 28/28 |
| `test:deep-api` | ✅ 489 passed / 0 failed |
| `lint` / `build` | ✅ PASS / PASS |
| `test:ai-architecture` | ✅ 9/9 |
| `verify:ai-native-release` | ✅ PASS（`STRUCTURALLY_READY`、`sourceDirty=false`） |
| HC2 denylist / SEC-R0 | ✅ 7/7 / 8（含两套 SEC-R0 上下文） |

改动范围（5 个文件，**无前端、无 schema、无 costEngine、无 Business API、无 worker、白名单未动**）：

```
api/services/aiProtectedCommandRoute.cjs              目标边界修复（缺陷本体）
api/services/aiNativeWriteChatBridgeV2.cjs            失败文案回显 + 失败原因持久化
tests/nativeW1LiveR1PhraseOrder.test.cjs              新增回归（5）
tests/nativeW15ChatWriteProposalHttpE2E.test.cjs      +E2E-7 回归 + 失败矩阵补词序用例 + 会话复用修复
tests/nativeW2WriteProposalHttpE2E.test.cjs           会话复用修复
```

## 7. §12 生产状态（未部署，等批准）

| 项 | 值 |
|---|---|
| 生产 HEAD / API runtime | `a8efa83d0c6e29c05f437c731e3312cf2b515c4e` / `a8efa83d0c6e`（**未变**） |
| 生产工作区 | ✅ 干净 |
| `AI_NATIVE_WRITE_ENABLED` | **`true`**（保持；未发生任何安全回滚条件） |
| 修复是否已上线 | **否**（生产仍是旧抽取器；已确认新实现标记在生产代码中不存在） |
| Web | ✅ `/ai` 200 |
| 已推送 | ✅ `origin/ai-native/prod-canary-s2 == 1952d6c` |

## 8. §4/§5/§13/§14 安全不变量（生产实测，全部保持）

| 检查 | 结果 |
|---|---|
| 允许的 Native Write 能力 | ✅ **恰好 1**（`inventory.parts.batch_adjust_stock`）；被拒 94 |
| DELETE | ✅ 允许 **0** |
| Owner-only | ✅ 非 Owner/未认证/内部凭据均被拒（`WRITE_DISABLED` 之外的正确拒绝） |
| 确认 / 幂等 / 核验 | ✅ 首用留痕：批准事实先落盘、恰好一次 operation、回读核验 `verified=true` |
| worker / Legacy | ✅ worker 关闭；legacy 运行时文件 ABSENT |
| 紧急停机条件 | ✅ **均未出现**（无未确认写入、无错目标/错数量、无重复、无非 W1 可执行、无 DELETE 可执行） |
| 实时写入统计 | `LIVE_NATIVE_WRITES_OBSERVED=1`（canary）；`WRITE_FAILURES_OBSERVED=1`（安全失败）；`UNSAFE_WRITES_OBSERVED=0` |
| canary 证据链 | ✅ operation `953fef2d…` ↔ task spec / COMMAND step / `audit_log 7075` / `business_change_events 156` 一一对应 |

**BLOCKERS：无。** 下一步请 Supervisor 批准是否部署本修复（部署后再让 Owner 用自然词序复测即可）。
