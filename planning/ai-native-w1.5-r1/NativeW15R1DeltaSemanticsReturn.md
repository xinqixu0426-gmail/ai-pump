# NATIVE-W1.5-R1 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-W1.5-R1 — Fix Delta-vs-Absolute Stock Semantics Before Native Write UI
**Branch:** `ai-native/prod-canary-s2`
**STATUS:** **PASS**
**日期:** 2026-09-26
**报告位置:** 写在两个 git checkout 之外（`planning/ai-native-w1.5-r1/`），避免交付后再产生文档提交。

---

## 0. 提交与基线

| 项 | 值 |
|---|---|
| START_COMMIT | `f35e0297d1fc00d7659c947e805108839e125f9c` |
| END_COMMIT | `cc00b54a957337dea9cbfdf2cdea889235c1e437` |
| GitHub `origin/ai-native/prod-canary-s2` | `cc00b54a957337dea9cbfdf2cdea889235c1e437`（与本地一致） |
| 工作区 | ✅ 干净 |
| 生产 | **未部署**（HEAD 仍 `154287d`），`AI_NATIVE_WRITE_ENABLED=false` 未改 |

改动文件（7 个，**无前端、无 schema、无 Business API、无 costEngine**）：

```
api/services/aiProtectedCommandRoute.cjs     绝对目标值语法优先识别；增量语法移除 到/至/为；数值安全
api/services/aiNativeWriteChatBridgeV2.cjs   新增 absolute_target / quantity_zero / sign_conflict 文案与错误码
tests/nativeW15R1DeltaSemantics.test.cjs     新增：delta/绝对/顺序/数值安全契约（5 例）
tests/nativeW15ChatWriteProposal.test.cjs    期望值更新为修正后的契约
tests/nativeW15ChatWriteProposalHttpE2E.test.cjs  失败矩阵增加绝对目标值与数值安全用例
docs/api-reference.md                        /api/ai/chat 行声明 delta-only 与新的澄清码
planning/ai-native-v1/release/N7.3-closure-validation.json  证据哈希刷新（既有机制）
```

---

## 1. 缺陷与根因

V1.5 的增量正则为：

```
(增加|加|入库|补充|上调|减少|减|出库|扣减|下调) \s* (?:了|到|至|为)? \s* (-?\d+)
                                        ^^^^^^^^^^^^^^^ 这里把「到/至/为」当成连接词
```

于是 **「把6202轴承库存增加到30」（最终值 30）被读成 `+30`** —— 与 V1 的 delta 契约冲突，
属于写语义安全缺陷（会把「设为 30」误执行成「加 30」）。这是我上一票引入的，本票修复。

## 2. 修复

**解析顺序（安全契约，被测试锁定）**：绝对目标值 → 方向冲突 → 增量。

1. **绝对目标值语法（有界确定性语法，不做通用正则框架）**：
   - `<增减动词> + (到|至|为|成) + 数字`：增加到30 / 加到30 / 提高到30 / 上调到30 /
     减少到20 / 减到20 / 降低到20 / 降到20 / 下调到20 / 调整到30 / 增加至30 / 增加为30
   - 无动词的 `库存到30`
   - 赋值动词直接带数字：改成30 / 改为30 / 设成30 / 设为30 / 设置为30 / 变成30 / 定为30
   - 空格与间隔写法一致处理（`把 6202轴承 库存 增加 到 30`）
   → `reason = absolute_target` → **不生成提案、不签发 token、不建可写任务、零写入**，
     返回 `NATIVE_WRITE_ABSOLUTE_STOCK_UNSUPPORTED` +
     「当前只支持按数量增加或减少库存，请明确说增加多少或减少多少。」
2. **增量语法收紧**：只允许 `了`（`增加了30` 仍是 delta）；`到/至/为` 不再出现在增量语法里。
3. **数值安全补齐**：
   - `库存增加` / `库存加一点` → `NATIVE_WRITE_QUANTITY_REQUIRED`
   - `库存增加100还是200`（或 `或者`）→ `NATIVE_WRITE_QUANTITY_AMBIGUOUS`
   - `库存加0` → `NATIVE_WRITE_QUANTITY_INVALID`
   - `库存加-20` / `库存减-20` → `NATIVE_WRITE_ACTION_AMBIGUOUS`（sign_conflict）
   - 同句同时出现增加与减少（`增加100减少20`、`增加又减少100`）→ `NATIVE_WRITE_ACTION_AMBIGUOUS`
   - `库存调整100`（方向不明）→ `NATIVE_WRITE_ACTION_AMBIGUOUS`
   以上全部为确定性拒绝，**无任何模型推断**。

---

## 3. §7 真实聊天 E2E（flag=true，隔离实例，真实 `api.cjs`）

| 用例 | 输入 | 实测 |
|---|---|---|
| A | `把6202轴承库存增加100` | ✅ W1 提案，`delta=+100`，`currentStock=100→nextStock=200`，任务 `WAITING_APPROVAL`；确认后写一次、回读核验、`SUCCEEDED`、库存恰好 +100 |
| B | `把6202轴承库存减少20` | ✅ W1 提案，`delta=−20`（nextStock 60→40），库存不变 |
| C | `把6202轴承库存增加到30` | ✅ `WRITE_CLARIFICATION_REQUIRED` / `NATIVE_WRITE_ABSOLUTE_STOCK_UNSUPPORTED`，零提案、零 token、零 operation |
| D | `把6202轴承库存减到20` | ✅ 同上 |
| E | `把6202轴承库存改为30` | ✅ 同上 |
| F | `把6202轴承库存设为30` | ✅ 同上 |

E2E 同时实测（矩阵内）：`增加 100 还是 200` → `NATIVE_WRITE_QUANTITY_AMBIGUOUS`；
`库存加 0` → `NATIVE_WRITE_QUANTITY_INVALID`；全部拒绝路径 `parts.stock` 不变、
`api_operations = 0`、无任何可写悬挂任务；flag=false 时那句 delta 仍然只得到 `WRITE_DISABLED`。

## 4. §8 flag=false 未变

隔离实例 flag=false 实测：同一句 delta 请求 → `detail.state=WRITE_DISABLED`、
`nativeWriteEnabled=false`、无提案、无 token、`ai_tasks=0`、库存不变、零 operation。
生产契约（`AI_NATIVE_WRITE_ENABLED=false`）与部署基线均未改动。

---

## 5. 门禁（干净提交 `cc00b54`）

日志：`.dev-local/logs/rework-gates-w15r1-20260926T210425.log`（`status=` 为空）

| 门禁 | 结果 |
|---|---|
| W1.5-R1 targeted | ✅ 5/5（含顺序证明与 §3/§6 全矩阵） |
| W1.5 | ✅ 15/15 |
| W1 | ✅ 24/24 |
| `npm test` | ✅ **2309/2309**（2304 + 5 新增） |
| `verify:api-contract` | ✅ 28/28 |
| `test:deep-api` | ✅ passed 489 / failed 0 |
| `lint` | ✅ PASS |
| `build` | ✅ PASS |
| `test:ai-architecture` | ✅ 9/9 |
| `verify:ai-native-release` | ✅ PASS（`STRUCTURALLY_READY`、`sourceDirty=false`） |
| HC2 denylist | ✅ 7/7 |
| SEC-R0 | ✅ 4/4 |

## 6. 未变更证明

| 约束 | 结果 |
|---|---|
| 新能力 | **无**（仍恰好 1 个：`inventory.parts.batch_adjust_stock`；绝对库存赋值未被加入） |
| Business API / schema / costEngine | **均未改动** |
| 前端 | **未触碰**（W2 未开始） |
| worker | `TASK_WORKER_DEFAULT_ENABLED = false` 保持 |
| 模型调用 | 命令路由与抽取仍为 0 次额外调用（E2E 断言 `modelRequestCount=0`、`toolCallCount=0`） |
| 生产 | 未部署、`.env` 未改、flag 仍 `false` |

## 7. BLOCKERS

**无。**

### 观察（非阻断）

1. `库存调整100`（只说「调整」未说方向）判为 `ACTION_AMBIGUOUS` 澄清；`库存调整到30` 判为
   绝对目标值。两者都不产生写入，语义边界清晰。
2. 绝对目标值一律拒绝、不提供「先读当前库存再换算成 delta」的自动换算——自动换算会在库存
   并发变化时产生错误增量，属于本票明确排除的范围。
3. W2（UI）仍未获得授权；`NATIVE_WRITE_PROPOSAL` 事件的消费方尚未实现。
