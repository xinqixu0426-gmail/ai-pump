# NATIVE-HC1 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-HC1 — Hard Cut: Remove Legacy AI Orchestration from the Production Request Path
**Branch:** `ai-native/prod-canary-s2`
**实现提交:** `286a8c6`（硬切）+ `cf6e9e3`（rollout-safety 门禁改写）
**STATUS:** **PASS**（代码/测试阶段；**未部署生产**）
**日期:** 2026-09-25

---

## 1. 一句话结论

生产请求路径上**已经不再存在通往 Legacy AI 编排的任何一条边**：Owner 只读走 Native，写意图得到 Native 的显式"AI 写入未开放"，未启用 Native 委派时得到确定性的"AI 不可用"（403）。**不再有静默回落 Legacy 的兜底**。

---

## 2. 本阶段做了什么

1. **删掉最后一个 Legacy 入口**：删除 `api/services/aiDispatcherV2.cjs`（转发 stub）及其测试。
2. **重写 dispatcher**：`api/services/aiDispatcherV3.cjs` 不再 import `aiAssistantRuntime` / `aiAgentRuntimeV3`，只剩三种确定性结局：
   - `aiUnavailableOutcome` —— 未启用 Native 委派（非 owner / 未开 AI-Native）→ 明确不可用，**不回落**；
   - `nativeWriteDisabledOutcome` —— 写/命令意图 → Native 显式"AI 写入未开放"，零写入；
   - `nativeOwnedOutcome` —— 只读（含准入不合格）→ Native 结果或 Native 安全失败。
3. **边界前置**：`api/routes/ai/chat.cjs` + `apiNativeRolloutPolicy.cjs` 在建立 SSE 连接、读取业务数据**之前**判定；非 owner ⇒ `403 AI_OWNER_ONLY`，owner 但未启用 ⇒ `403 AI_UNAVAILABLE`。
4. **rollout 开关语义改写**：`off` / `shadow` 不再表示"改用 Legacy"，只表示"AI 不可用"。

---

## 3. 行为契约（改动前 → 改动后）

| 情形 | HC1 之前 | HC1 之后 |
|---|---|---|
| Owner 只读（任何准入状态） | Native | Native（不变） |
| 非 owner / 未认证 | 视配置可能落到 Legacy | **403 `AI_OWNER_ONLY` / 401，Legacy 0** |
| owner 但 Native 未启用（off/shadow） | Legacy 兜底 | **403 `AI_UNAVAILABLE`** |
| 写 / 命令意图 | 可能进入 Legacy 写运行时 | **Native"写入未开放"，`aiAgentRuntimeV3` = 0** |
| 工具/验证异常 | Legacy 或错误 | **Native fail-closed** |

**产品后果（如实说明）**：AI 助手在当前部署下只提供已声明的 12 个只读族的 Native 答案；其余一律是确定性拒绝或受限结论。**这是刻意的**——宁可明确拒绝，也不再让退役路径产生自由回答。

---

## 4. 运行时证明（`tests/nativeHc1LegacyHardCut.test.cjs`，6/6 PASS）

| 测试 | 内容 | 结果 |
|---|---|---|
| `HC1-STATIC-1` | 静态证明：生产代码对 Legacy runtime 的 import 边 = **0** | PASS |
| `HC1-STATIC-2` | dispatcher 不持有任何 Legacy 运行时依赖 | PASS |
| `HC1-A…F` | Owner 只读六种形态（支持 / 未支持 / 歧义 / 无计划 / 工具错 / 验证失败）→ Legacy 调用 **0** | PASS |
| `HC1-G` | Owner 写请求 → `aiAgentRuntimeV3` **0**、Legacy **0** | PASS |
| `HC1-H/I` | 非 owner → 403；未认证 → 401；两者 Legacy **0** | PASS |
| `HC1-ROLLOUT` | off/shadow → AI 不可用（不再表示"改用 Legacy"），Legacy **0** | PASS |

计数为**真实调用计数**（module-level 计数器），非标签断言。

---

## 5. 未改动 / 保持冻结

| 项目 | 状态 |
|---|---|
| 写 / 命令路径（业务 API、确认、审计、回滚、变更历史） | **未改动** |
| `AI_NATIVE_WRITE_ENABLED` | **仍为 `false`** |
| SEC-R0 `INTERNAL_SECRET`(只读) / `INTERNAL_WRITE_SECRET`(机器写) 边界 | **未改动** |
| DB schema（v88） | **未改动**（无迁移） |
| costEngine | **未改动** |
| 生产部署 | **未执行**（生产仍为 `f7f7467` = R1+R2+SEC-R0 基线） |

---

## 6. 门禁（干净树，`286a8c6` / `cf6e9e3`）

| 门禁 | 结果 |
|---|---|
| `npm test` | **PASS** — 3263 / 3263，fail 0 |
| `npm run verify:api-contract` | **PASS** — 28 / 28 |
| `npm run test:deep-api` | **PASS** — 489 / 489 |
| `lint` | **PASS** |
| `build` | **PASS** |
| `verify:ai-native-release` | **PASS** — `READY_WITHIN_SUPPORTED_SCOPE`，`productionReadiness NOT_READY`，`sourceRevision cf6e9e3` |
| `test:ai-architecture` | **PASS** — 120 / 120 |
| NATIVE-HC1 专项 + NATIVE-R3 专项 | **PASS** — 6 / 6 + 11 / 11 |

**显式改写的旧断言（未静默删除，均带 NATIVE-HC1 说明）**：`nativeR1ReadCutover`、`nativeR2AiOwnerBoundary`、`nativeR3OwnerReadRuntime`、`nativeS1CanaryScope`、`aiChatRoute`、`aiProtectedCommandRoute`、`apiStaticContract`、`aiFrameworkRetirement`、`observabilityTracing`、`observabilityCorrelationRedaction`；`scripts/run-ai-native-rollout-live.cjs` 现在断言 off/shadow ⇒ 403、owner ⇒ `task_v2`。

---

## 7. 剩余工作（**未获授权，未开始**）

**NATIVE-HC2（建议）**：Legacy 运行时文件在**生产已不可达**，但仍留在仓库里作为死代码，并有 **39 个测试文件**仍直接引用它们（约 **51 个模块 / 1.6 万行** 可达集）。

建议做法：先把仍然有效的确定性逻辑（金额守卫、证据绑定/核验、实体解析、业务语义/影响分析）抽到中立服务，再把 39 个测试文件重新指向这些中立服务，最后删除 Legacy-only 模块。**不授权就不动。**

---

## 8. Blockers

无技术阻断。两点需 Supervisor 决定：
1. **生产未部署**：生产线仍运行 R1/R2/SEC-R0 基线（`f7f7467`）。HC1 上线需走批准后的发布流程；上线后 owner 之外的用户会看到 403 而非 AI 回答——**这是预期行为，需要提前告知使用方**。
2. **HC2 是否启动**：需要明确授权。

**等待 Supervisor 审核；不启动 AI WRITE。**
