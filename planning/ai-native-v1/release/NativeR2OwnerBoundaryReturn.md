# NATIVE-R2 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-R2 — Remove Non-Owner Legacy Entry and Freeze Owner-Only Native AI Boundary
**Branch:** `ai-native/prod-canary-s2`
**START_COMMIT:** `761ab78634269fc345de764891db17860871214e`（= 工单指定）
**实现提交:** `7694f43`
**fixture 修复提交:** `e086543`（代码/测试终态）
**STATUS:** **PASS**

---

## 1. 架构决定与实现边界

AI 助手被冻结为 **OWNER-ONLY 产品能力**：

```
OWNER            → AI-Native（沿用既有 rollout 快照）
NON-OWNER        → 确定性 403（AI_OWNER_ONLY）
UNAUTHENTICATED  → 401（既有安全行为，未改动）
INTERNAL-SECRET  → 确定性 403（不被升格为 Owner）
```

实现（两处生产改动，无兼容层、无新正则、无新意图系统）：

1. `api/services/aiNativeRolloutPolicy.cjs` 新增 `AI_CHAT_ACCESS` 与 `resolveAiChatAccessBoundary({ rollout })`。
   判据**只**来自规范 Owner 判定（owner cookie JWT + `ownerConfigValid`，即 `isAuthenticatedOwnerRequest`）。
2. `api/routes/ai/chat.cjs`：`handleAiChat` 在任何业务读取、任何 SSE 头、任何 dispatcher 调用**之前**判定边界；
   非 Owner 立即返回 403 `AI_OWNER_ONLY`（文案「AI 助手当前仅对 Owner 开放。」，不含运行时名、工具目录、授权内部信息）。
   请求开始时的 rollout 快照现在只取一次，边界判定与 runtime 选择读同一快照。

被移除的路径：`aiDispatcherV3.cjs:58` 的「非 owner → `runAiAssistant`」。该路径现在对非 owner 不可达（根本不会调用 dispatcher）。

---

## 2. Legacy 调用计数证明（真实函数调用，非路由标签）

`tests/nativeR2AiOwnerBoundary.test.cjs`（真实 `POST /api/ai/chat` 路由 + 真实 dispatcher + Legacy 入口计数器），5/5 PASS：

| 场景 | Native | aiAssistantRuntime | aiAgentRuntimeV3 | HTTP |
|---|---|---|---|---|
| owner（已迁移族） | **1** | **0** | **0** | 200 + Native 答案 |
| 已认证非 owner | **0** | **0** | **0** | 403 `AI_OWNER_ONLY` |
| 未认证 | **0** | **0** | **0** | 401 |
| 仅 `x-internal-secret` | **0** | **0** | **0** | 403 `AI_OWNER_ONLY` |

补充证明：
- `R2-BOUNDARY-5`：请求体 / `pageContext` / `resolutionContext` / 伪造 `x-owner` 头都无法让非 owner 通过边界。
- `R2-BOUNDARY-4`：直接对边界取证 —— internal-secret 请求产生的 rollout 快照 `ownerAuthenticated === false`。
- `tests/aiChatRoute.test.cjs` 的 N7.1：owner 在 off/shadow 仍为 `delegated:false`（行为不变），owner 在 owner 模式为 `delegated:true`；**非 owner 在 owner 模式不再到达 dispatcher**（旧断言已按新架构显式改写，附 NATIVE-R2 说明）。

---

## 3. 剩余 Legacy 可达性（下一阶段删除图谱）

生产代码中 Legacy runtime 的 require 点仅一个文件：`aiDispatcherV3.cjs:1-2`。

| # | 路径 | 触发条件 | 分类 | 生产可达 |
|---|---|---|---|---|
| 1 | `aiDispatcherV3.cjs:18` → `runAiAgentRuntimeV3` | owner 且 `commandRoute`（写/命令意图，`aiProtectedCommandRoute.cjs` 正则判定） | **ACTIVE_PRODUCTION** | YES（owner 发起的写命令；§10 明确本轮不动写路径） |
| 2 | `aiDispatcherV3.cjs:48` → `runAiAssistant`（F1） | owner 且 admission 不满足且计划非 nativeOwned（`OTHER` / `CUSTOMER_HISTORY` / `ORDER_READINESS` / `IMPACT_INVESTIGATION` / 空计划） | **ACTIVE_PRODUCTION** | YES（仅 owner） |
| 3 | `aiDispatcherV3.cjs:58` → `runAiAssistant` | owner 且 `AI_NATIVE_MODE` ≠ owner（off/shadow） | **ACTIVE_PRODUCTION**（配置相关；生产 `AI_NATIVE_MODE=owner`） | YES（取决于 env） |
| 4 | `aiAssistantRuntime.cjs:1079-1087` ontology canary → `legacyTools()`（F3） | 一旦经 #2/#3 进入 Legacy 后内部触发 | **ACTIVE_PRODUCTION**（Legacy 内部，非入口） | YES |
| 5 | `aiAgentRuntimeV3.cjs:549→654` V4→V3（F2） | flag `AI_READ_INVESTIGATION_V4_ENABLED` | **DORMANT_FLAGGED** | NO（flag 为空→false，未触碰） |
| 6 | `chat.cjs:403 processAiChat` → dispatcher（无 HTTP 挂载的内部服务入口） | 仅 `tests/*` 与 `scripts/run-business-semantic-production-validation.cjs` 调用 | **TEST_OR_TOOLING_ONLY** | NO（生产无调用方） |
| 7 | `aiDispatcherV2.cjs:2` 转发 `aiAgentRuntimeV3` | 无生产 importer | **DEAD_OR_UNREACHABLE** | NO |

**非 owner 入口**：已移除（零 Legacy）。

---

## 4. 只改测试/夹具的显式变更（未削弱门禁）

| 文件 | 变更 | 原因 |
|---|---|---|
| `tests/aiChatRoute.test.cjs` | SSE 传输测试改为规范 Owner 身份；内部-secret 与非 owner 用例断言改为「在 dispatcher 之前被拒绝」 | R2 冻结入口；旧断言编码了被取代的架构 |
| `tests/observabilitySseEquivalence.test.cjs` | 以 Owner 身份驱动；补 `res.status/json` 使失败可读 | 同上 |
| `tests/helpers/ontologyHttpRuntimeFixture.cjs` | 改用 Owner cookie（+ 挂载 cookie-parser）；**复用**调用方已声明的 owner 配置与 JWT_SECRET；仅在缺失时补齐 | `x-internal-secret` 不再是 AI 入口 |
| `scripts/run-ai-native-rollout-live.cjs` | 未修改（fixture 修复后 `errors: []`） | 该脚本声明自己的隔离 owner 身份，必须被复用 |

---

## 5. 门禁（`e086543`，干净树）

| 门禁 | 结果 |
|---|---|
| `npm test` | PASS — tests **3278** / pass **3278** / fail **0** |
| `verify:api-contract` | PASS — 28 / 28 |
| `test:deep-api` | PASS — passed **489** / failed **0**（`localPumpDbUsed=false`） |
| `lint` | PASS |
| `build` | PASS |
| `verify:ai-native-release` | PASS（修复后恢复；`productionReadiness NOT_READY`） |
| `test:ai-architecture` | PASS — 120 / 120 |
| `tests/nativeR2AiOwnerBoundary.test.cjs` | PASS — **5 / 5** |

---

## 6. 未变更项

- `AI_NATIVE_WRITE_ENABLED` 仍为 false；写路径、确认/审计/回滚均未改动
- 数据库 schema 未变；costEngine 未变
- 未新增 Legacy 功能 / 回退 / 兼容层；未扩展 ontology canary；未启用 F2；未新增 Native 读族

---

## 7. Blockers

1. **owner + `AI_NATIVE_MODE`=off/shadow 仍走 Legacy**（上表 #3）。这是 rollout 开关的既有语义，R2 未改动它（「owner Native behavior unchanged」）。若要彻底关闭，则需把 Legacy 从 owner 路径也移除——属下一阶段，且必须先完成剩余 F1 源（#2）的接管。
2. **owner 的写命令仍走 Legacy**（#1）。写路径迁移是独立阶段（Native Write），§10 已明确本轮不得触碰。
3. 既有安全项（用户指示自行处理、本轮未动）：`api.cjs:153-155` 的 `x-internal-secret` 可跳过 JWT 命中正式写路由（`POST /api/parts/` 无确认卡要求），其当前值在公开 Gitee 历史中可匿名读取。

---

## 8. 结论

生产 AI 已不再需要「非 Owner → Legacy」兼容路径：非 owner（含仅 internal-secret）在进入任何业务读取、任何 dispatcher、任何 Legacy runtime 之前就被确定性拒绝，`aiAssistantRuntime` / `aiAgentRuntimeV3` 调用次数实测为 0；owner 行为逐字保持不变。

**下一阶段未开始，等待 Supervisor 审核。**
