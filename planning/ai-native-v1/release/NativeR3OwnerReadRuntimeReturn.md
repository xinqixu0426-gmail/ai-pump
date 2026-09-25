# NATIVE-R3 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-R3 — Eliminate Remaining Owner Read F1 and Establish Native-Only Read Runtime
**Branch:** `ai-native/prod-canary-s2`
**START_COMMIT:** `6af1de7bf6e1710243deefe1772a62fcfcfe14ae`
**实现提交:** `6bb5f2e`
**STATUS:** **PASS**（代码/测试阶段；按 §16 **未自动部署生产**）

---

## 1. 本阶段做了什么

消除剩余的 **Owner READ F1**：Owner + `AI_NATIVE_MODE=owner` + 只读请求，**无论准入是否满足**（未支持族 / 未知 / 无计划 / 结构状态 / 空结果 / 歧义 / 工具异常 / 验证失败），都不再进入 `runAiAssistant`。unknown / no-plan / 未支持读被确立为 **Native 的状态**，而不是 Legacy 的路由条件。

---

## 2. 剩余 F1 成因分解（§2，在 START_COMMIT 上重新枚举）

准入闸门唯一实现位于 `api/services/aiNativeOwnerTrialCoverage.cjs:303 ownerReadCanaryAdmission`；F1 出口位于 `api/services/aiDispatcherV3.cjs:69-71`。

| # | 可执行条件 | reason | 生产可达 | Native 实现现状 | 分类 |
|---|---|---|---|---|---|
| 1 | `structuralReady !== true` | `STRUCTURAL_NOT_READY` | **否** —— 唯一生产调用点 `aiTaskControllerV2.cjs:114` 不传该参数（默认 `true`）；已在当前 HEAD 复核，并由 `R3-STRUCT-1` 静态证明 | 不适用 | **UNREACHABLE_STATE** |
| 2 | `businessWritePolicy !== 'FORBIDDEN'` | `WRITE_BEARING_REQUEST` | 是（写意图） | 写路径，不在本阶段 | 出范围（§12），保持既有路径 |
| 3 | `kinds.length === 0` | `EMPTY_PLAN` | 实际不可达（确定性 planner `aiTaskSemanticsV2.cjs:286/337` 保证 ≥1 goal） | Native 可处理 | **UNREACHABLE_STATE**（仍按 §3 留在 Native） |
| 4 | 存在 kind 无任何 SUPPORTED 族覆盖 | `FAMILY_NOT_SUPPORTED` | **是** | 见下 | 混合（见分类） |

### 分类（§2 要求）

**A. REAL_NATIVE_CAPABILITY_GAP**
- `IMPACT_INVESTIGATION`：控制器 `aiTaskControllerV2.cjs:1097` **主动标记能力缺口**（`N4.1A_CAPABILITY_GAP`：现有影响能力只接受已批准规则候选 ID，当前语义无法安全绑定正式候选）；`project_business_impact` 未登记于能力注册表。→ 本轮**不**伪称支持；改为产出 Native 的 gap/limitation 结果。

**B. COVERAGE_DECLARATION_DEBT**（实现齐备、只是未声明 → 本轮声明）
- `CUSTOMER_HISTORY`：planner 可产出（`aiTaskSemanticsV2.cjs:240`，需可解析客户主体）；控制器 `:880 goalFor('CUSTOMER_HISTORY')` 完整读取（正式回执 + 客户身份一致性校验）；`requirementsForStructuredGoal` 有 `customer.*_history`；模板 `HISTORY_V1`。
- `ORDER_READINESS`：planner 可产出（`aiTaskSemanticsV2.cjs:242`，需 order 主体）；控制器 `:921 goalFor('ORDER_READINESS')` 完整读取（order knowledge package）；requirement `order.identity/readiness/readiness_actions`；模板 `READINESS_V1`。

**C. AMBIGUOUS_OR_UNSUPPORTED_READ**
- `OTHER`（catch-all：工程判断类与无法归类请求）与 `spec-configuration-difference`（仅 `OTHER` 部分）。→ 本轮**不**声明为 SUPPORTED（不得让 catch-all 冒充已支持），改由**读取路径所有权**保证其留在 Native。

**D. UNREACHABLE_STATE**：`STRUCTURAL_NOT_READY`、`EMPTY_PLAN`（依据见上表）。

**E. ACTUAL_BUG**：**无**。

### READ_GOAL_KINDS_BEFORE（14 个只读 kind）

准入合格（10）：`CURRENT_COST`、`CONFIGURATION_COMPARE`、`PROFITABILITY`、`INVENTORY_QUERY`、`COIL_COST`、`RECIPE_COST_COMPARISON`、`MANAGEMENT_OVERVIEW`、`QUOTATION_QUERY`、`BUSINESS_CHANGES`、`COIL_QUERY`
准入不合格（4，即 F1 来源）：`CUSTOMER_HISTORY`、`ORDER_READINESS`、`IMPACT_INVESTIGATION`、`OTHER`

---

## 3. Owner 只读所有权规则（§7）

新增 `isNativeOwnedOwnerRead({ businessWritePolicy })`（`aiNativeOwnerTrialCoverage.cjs`）：

> **只读计划（`businessWritePolicy === 'FORBIDDEN'`）一律由 Native 独家负责。**

- 判据只来自**已落定的计划**（`aiTaskControllerV2.cjs` 在 `taskResult` 中计算并附加 `nativeReadOwned`），请求体 / 页面上下文 / 模型都无法影响。
- dispatcher 不再以 Legacy 准入资格作为安全网：`aiDispatcherV3.cjs` 的 F1 分支现在只在**写意图计划**时才回既有路径。
- 唯一例外是写意图：**绝不因"留在 Native"而把 mutation-bearing 请求重分类为读**（§12 fail closed）。

---

## 4. 行为契约（§3 / §6）

| 情形 | R3 之前的结局 | R3 之后 |
|---|---|---|
| 已支持族 | Native 答案 | Native 答案（不变） |
| 未支持读（`IMPACT_INVESTIGATION`） | **Legacy 答案** | **Native 显式 gap / limitation** |
| 未知读（`OTHER`） | **Legacy 答案** | **Native limitation / 澄清** |
| 无计划 / 空计划 | **Legacy 答案** | **Native 显式安全失败** |
| 结构状态不满足 | **Legacy 答案** | **Native 显式安全失败**（且该状态生产不可达） |
| 空结果 / 歧义 / 未验证回执 | **Legacy 答案** | **Native 结果或澄清** |
| 工具/API 异常 | Legacy 或错误 | **Native fail-closed 抛出**（dispatcher 不落 Legacy） |
| 写意图 / commandRoute | 既有写路径 | **既有写路径（不变）** |

**产品后果（如实说明，属 §3 的明确要求）**：此前由 Legacy 兜底回答的"无法归类 / 未支持"提问，现在会得到 Native 的受限结论（例如显式说明缺少可验证依据），而不是 Legacy 的自由回答。这是"unknown 是 Native 状态"这一架构决定的直接结果。

---

## 5. 运行时证明（§14：真实调用计数，非标签）

`tests/nativeR3OwnerReadRuntime.test.cjs`（11/11 PASS）：

| 测试 | 内容 | 结果 |
|---|---|---|
| `R3-RULE-1/2/3` | 所有权判据；两个新族声明；未支持读不被伪装成 SUPPORTED | PASS |
| **`R3-READ-1`** | **当前全部 14 个只读 goal kind**（含 `OTHER`、`IMPACT_INVESTIGATION`）经真实 dispatcher：`aiAssistantRuntime` **0**、`aiAgentRuntimeV3` **0**、Native 进入 1 次、必然产出 Native 结果 | PASS |
| `R3-READ-2` | 6 个真实问法（经营概况 / 报价 / 业务变更 / 线圈目录 / 未知·OTHER / 影响调查）：计划与准入由**真实 controller** 产出后再进真实 dispatcher，Legacy 计数 0 且产出 Native 结果 | PASS |
| `R3-FAIL-1` | 空结果 / 未验证回执 / 歧义 × 6 个问法：Native 结果或 Native fail-closed 抛出，Legacy 0 | PASS |
| `R3-FAIL-2` | 工具异常：Native fail-closed 抛出，Legacy 计数器 0 | PASS |
| `R3-FAIL-3` | `EMPTY_PLAN` / `STRUCTURAL_NOT_READY` / `FAMILY_NOT_SUPPORTED` 三种形态：Native 显式安全失败，Legacy 0 | PASS |
| `R3-FAIL-4` | 写意图计划仍走既有路径（Legacy 只读 +1，命令路径 0） | PASS |
| `R3-FAIL-5` | 非 Native 委派（off/shadow / 非 owner）行为不变 | PASS |
| **`R3-STRUCT-1`** | 静态证明：`STRUCTURAL_NOT_READY` 无生产调用点；Legacy runtime 的生产引用面**仅** `aiDispatcherV3.cjs` + `aiDispatcherV2.cjs`（转发 stub） | PASS |

**F1_OWNER_READ_STATUS: ELIMINATED**（Owner 只读在任何已测条件下 Legacy 调用 = 0）
**F3_REACHABLE_FROM_OWNER_READ: NO** —— F3 只存在于 `aiAssistantRuntime.cjs:1079-1087`，而 Owner 只读已不进入该模块。

**F2_STATUS: DORMANT** —— `AI_READ_INVESTIGATION_V4_ENABLED` 仍为空（生产亦未启用）；`aiAgentRuntimeV3.cjs` / `aiReadInvestigationDriverV4.cjs` 本阶段**零改动**。
**F3 内部未做任何 family-by-family 修补**（§10）✓

---

## 6. 未改动项（§12 / §16）

| 项目 | 状态 |
|---|---|
| 写 / 命令路径（`commandRoute` → `aiAgentRuntimeV3`） | **未改动** |
| `AI_NATIVE_WRITE_ENABLED` | **false** |
| 确认 / 审计 / 回滚 / 变更历史 | 未改动 |
| SEC-R0 `INTERNAL_SECRET`(只读) / `INTERNAL_WRITE_SECRET`(机器写) 边界 | **未改动**（本阶段未触碰 api.cjs 或 internalApiClient） |
| DB schema | **未改动**（无迁移） |
| costEngine | **未改动** |
| Legacy runtime 文件（`aiAssistantRuntime` / `aiAgentRuntimeV3` / `aiReadInvestigation*`） | **未改动** |
| 生产部署 | **未执行**（§16：code/test first，未经批准不自动发布） |

---

## 7. 门禁（`6bb5f2e`，干净树）

| 门禁 | 结果 |
|---|---|
| `npm test` | **PASS** — tests **3291** / pass **3291** / fail **0** |
| `npm run verify:api-contract` | **PASS** — 28 / 28 |
| `npm run test:deep-api` | **PASS** — passed **489** / failed **0** |
| `lint` | **PASS** |
| `build` | **PASS** |
| `verify:ai-native-release` | **PASS**（`READY_WITHIN_SUPPORTED_SCOPE`；`productionReadiness NOT_READY`） |
| `test:ai-architecture` | **PASS** — 120 / 120 |
| `nativeR3` 专项 | **PASS** — **11 / 11** |

**显式改写的旧断言（未静默删除，均带 NATIVE-R3 说明）**
- `tests/nativeS1CanaryScope.test.cjs`：`S1-E2` 由"admission 不合格 → 交回 Legacy"改写为"Owner 只读留在 Native；写意图仍走既有命令路径"；`S1-C2` 的"未支持"示例由已被 R3 支持的 `CUSTOMER_HISTORY` 换成 `IMPACT_INVESTIGATION`；计数 10→12、total 12→14
- `tests/nativeCoverageWave1.test.cjs`：supported 10→12
- `tests/nativeCoverageWave1R1.test.cjs`：total 12→14、supported 10→12
- `tests/nativeR1ReadCutover.test.cjs`：`R1-DISP-3` 由"未拥有族回落 Legacy"改写为"只读留在 Native；写意图走命令路径"，helper 增加 `nativeReadOwned`

---

## 8. Blockers

无技术阻断。两点需 Supervisor 知悉：
1. **生产未部署**：生产仍为 `f7f7467`（R1/R2/SEC-R0 基线）。R3 上线需另行走批准后的发布流程。
2. **产品行为变化**：如 §4 所述，无法归类 / 未支持的提问将从"Legacy 自由回答"变为"Native 受限结论"。若希望提升这类提问的质量，需要为对应领域补 Native 能力（例如 IMPACT 的候选绑定），而不是恢复 Legacy 兜底。

**NATIVE-R4（或下一阶段）未开始，等待 Supervisor 审核。**
