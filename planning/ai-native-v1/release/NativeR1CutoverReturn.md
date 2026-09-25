# NATIVE-R1 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-R1 — Native Read Cutover — Decompose F1 and establish first Native-only read families
**Branch:** `ai-native/prod-canary-s2`
**Start Commit:** `34c3fd0696cb91e3fd8bc8e4436ffee2995706ee`
**End Commit:** `761ab78634269fc345de764891db17860871214e`
**中间提交:** `be2c03fd23ec83a295f1a49bac5a93bbda1ef718`（实现）、`761ab786…`（逐族证明测试）
**Repository:** `origin` = `git@github.com:xinqixu0426-gmail/ai-pump.git`（本阶段唯一代码事实源；已 push，`LOCAL_HEAD == origin/ai-native/prod-canary-s2`）
**Worktree:** clean（0 行改动，门禁运行前后均无变化）
**STATUS:** **PASS**

---

## 1. 本阶段做了什么（一句话）

把 F1（`aiDispatcherV3` 准入不满足 → `runAiAssistant` 出 Legacy 答案）的成因完全分解为可执行条件，并把其中**四个只读族**改为 Native 独家负责：它们的读取、事实、需求与答案链路本已存在，此前仅因覆盖表未声明而被 F1 送往 Legacy。四族在成功与全部失败路径下均不再进入 Legacy。

---

## 2. F1 准入成因分解（Phase A，全部为可执行条件追踪）

F1 = `api/services/aiDispatcherV3.cjs:46-49`。

| ID | 判定条件 | 来源 | 生产可达 | Native 能力已存在 | 仅因准入/路由而走 Legacy | 需新写 Native |
|---|---|---|---|---|---|---|
| F1-C1 | `businessWritePolicy !== 'FORBIDDEN'` → `WRITE_BEARING_REQUEST` | `aiNativeOwnerTrialCoverage.cjs:254` | 是 | 否 | 否 | 是（§10 禁止本轮纳入，保持 fail closed） |
| F1-C2 | `kinds.length === 0` → `EMPTY_PLAN` | `:255` | 几乎不可达（`aiTaskSemanticsV2.cjs:286/337` 保证 ≥1 goal） | 是 | **是** | 否 |
| **F1-C3a** | goal kind 未登记于覆盖表 → `familiesForGoalKind` 为空 → `FAMILY_NOT_SUPPORTED` | `:259-263`；控制器实现见 `aiTaskControllerV2.cjs:932-947` | 是 | **是（读取/fact/requirement/答案模板四层齐备）** | **是** | **否** |
| **F1-C3b** | goal kind 仅被 UNSUPPORTED/PARTIAL 族覆盖 → `FAMILY_NOT_SUPPORTED` | `:259-263` | 是 | `MANAGEMENT_OVERVIEW` 是 / `OTHER` 否 | `MANAGEMENT_OVERVIEW` **是** / `OTHER` 否 | `MANAGEMENT_OVERVIEW` 否 |
| F1-C4 | `structuralReady !== true` → `STRUCTURAL_NOT_READY` | `:253` | **否（生产不可达）** | 是 | 否 | 否 |

- **F1-C4 为何不可达**：生产调用点 `aiTaskControllerV2.cjs:113` 只传 `goalKinds` 与 `businessWritePolicy`，`structuralReady` 取默认 `true`；仅测试/直接调用方可触发。
- **F1-C3a 涉及 kind**：`QUOTATION_QUERY`、`BUSINESS_CHANGES`、`COIL_QUERY`、`CUSTOMER_HISTORY`、`ORDER_READINESS`、`IMPACT_INVESTIGATION`。这些在 `aiTaskControllerV2.cjs` globalReads、`aiTaskStructuredReadsV2.cjs` requirement、`aiTaskAnswerV2.cjs:187-193` templateFor 三层均已实现，能力也已在 `capabilities/registry.cjs` 登记 —— **纯准入债，不是能力债**。
- **非 F1（避免误判）**：`aiDispatcherV3.cjs:58`（非 owner 或 `AI_NATIVE_MODE`≠owner，Native 从未被尝试，属默认路由）；`aiDispatcherV3.cjs:18`（commandRoute → Legacy 命令运行时）。
- **命名误导澄清**：`aiTaskControllerV2.cjs:37 LEGACY_READ_GOALS` 只是 Native 前台可续接的目标集合（用于 `:1364` 选取 activeGoals），**不构成任何回退**。

---

## 3. Read Family 矩阵（Phase B）

| family | native 覆盖 | Legacy 依赖 | 渲染模板 |
|---|---|---|---|
| recipe 当前成本 / 配方成本比较 / 配置变更+毛利+齐料 / 虚拟齐料 / 线圈成本 / 线圈库存 | SUPPORTED（原有 6 族） | 无 | 各自 `*_V1` |
| **经营概况 / 看板** | **SUPPORTED（本轮由 UNSUPPORTED 转入）** | 原 F1-C3b | `MANAGEMENT_V1` |
| **报价查询** | **SUPPORTED（本轮新增）** | 原 F1-C3a | `CATALOG_V1` |
| **业务变更记录** | **SUPPORTED（本轮新增）** | 原 F1-C3a | `BUSINESS_CHANGE_V1` |
| **线圈目录查询** | **SUPPORTED（本轮新增）** | 原 F1-C3a | `CATALOG_V1` |
| 客户历史 / 订单 readiness | PARTIAL（实现与渲染已在，未声明） | F1-C3a | `HISTORY_V1` / `READINESS_V1` |
| 影响调查 | UNSUPPORTED | F1-C3a | `IMPACT_V1`（阻断：`project_business_impact` 未登记） |
| 规格/配置差异（非金额）、不存在的对象、其他 | UNSUPPORTED / PARTIAL | F1-C3b | — / `RECIPE_CATALOG_NEGATIVE_V1` / `LIMITATION_V1` |

结构一致性：`validateCoverageAgainstCapabilities()` → `{"consistent":true,"problems":[]}`。

---

## 4. 首批 Native-only Wave（Phase C）

`management-overview`、`quotation-read`、`business-change-read`、`coil-catalogue-query`

选择依据（在实施前已写入工作笔记 `NativeR1F1AdmissionDecomposition.json`）：只读；生产相关性高；正式 Business API 已成熟且已接线；零 schema 变更；**零新业务算法**；确定性验证（verified receipt → 指针等值校验 → requirement 满足 → VERIFIED）。

被排除项及原因：`IMPACT_INVESTIGATION`（能力未登记）、`OTHER`（catch-all，声明它等于把所有无法归类请求变成 Native 权威，超出"小批次"）、`CUSTOMER_HISTORY`/`ORDER_READINESS`（留待下一批）。

---

## 5. Native 所有权机制（不新增兼容层）

1. 覆盖表新增显式字段 `nativeOwned: true`（仅 4 个 wave 族）。
2. 新增 `nativeOwnershipDecision({ goalKinds, businessWritePolicy })`：写意图 / 空计划 / 无拥有族 → `LEGACY_ALLOWED`（fail closed）；**只要计划触及任一 nativeOwned 族即为 `NATIVE_OWNED`**（与未覆盖目标混合也算）。
3. `aiTaskControllerV2.taskResult` 把 `nativeOwned` / `nativeOwnedFamilies` 附加到 `canaryAdmission`（服务器自有；请求方字段无法影响）。
4. `aiDispatcherV3`：admission 不满足且 `nativeOwned === true` → `nativeOwnedOutcome()`，只输出 controller 已产出的确定性答案，无答案则给 Native 显式安全失败 —— **不调用任何 Legacy runtime**。
5. `suspendFamily()` 立即撤销所有权并自动退回既有路径（安全阀保留）。观测：状态事件带 `legacyRuntimeEntered: false|true`。

无新 Legacy 回退、无 Legacy 新功能、无新正则路由、无第二套意图系统、无模型决定是否走 Legacy。

---

## 6. 迁移族证明矩阵（Phase D/E）

来源：`tests/nativeR1ReadCutover.test.cjs`（13/13 PASS）。调用计数为**真实函数调用缺席**证明（dispatcher 注入 spy），不是路由标签。

| 族 | normal success | empty result | ambiguity | tool failure | verification failure | aiAssistantRuntime | aiAgentRuntimeV3 | Legacy tool loop |
|---|---|---|---|---|---|---|---|---|
| management-overview | 准入+owned+`get_management_action_center`+`MANAGEMENT_V1` | owned 不变 | 澄清路径 | fail-closed 抛出 | owned 不变 | **0** | **0** | **0** |
| quotation-read | 准入+owned+`search_quotations` | 同上 | 范围受限措辞 | 同上 | 同上 | **0** | **0** | **0** |
| business-change-read | 准入+owned+`search_business_changes` | 同上 | 同上 | 同上 | 同上 | **0** | **0** | **0** |
| coil-catalogue-query | 准入+owned+`search_coils` | 同上 | 不多候选汇总 | 同上 | 同上 | **0** | **0** | **0** |

dispatcher 层额外场景，Legacy 计数同为 0：
- admission 不满足的混合计划（`R1-DISP-1`）→ 输出 Native 答案；
- Native 无答案（`R1-DISP-2`）→ Native 显式安全失败；
- controller 抛错（`R1-DISP-5`）→ 错误向上抛（fail closed），不落 Legacy；
- 对照组：未拥有族 `OTHER` 仍回落 Legacy、写请求仍走命令路径（行为未变，`R1-DISP-3`）。

---

## 7. F1 收缩量化

| | 准入 kind | 不可准入 kind |
|---|---|---|
| Before | 6 | **8**：`MANAGEMENT_OVERVIEW, OTHER, QUOTATION_QUERY, BUSINESS_CHANGES, COIL_QUERY, IMPACT_INVESTIGATION, CUSTOMER_HISTORY, ORDER_READINESS` |
| After | **10** | **4**：`OTHER, IMPACT_INVESTIGATION, CUSTOMER_HISTORY, ORDER_READINESS` |

并且对 4 个 nativeOwned kind，F1 在**任何条件**下都不再触发（含混合未覆盖目标、Native 无答案、controller 抛错）。

**F2:** Dormant / untouched（`AI_READ_INVESTIGATION_V4_ENABLED` 仍为空；`aiAgentRuntimeV3.cjs:549→654` 未触碰）。
**F3:** Present（未修改）；**Reachable from migrated families: NO** —— 迁移族从不进入 `aiAssistantRuntime`，故 `:1079-1087` 的 `ONTOLOGY_CANARY_FALLBACK` 分支对其不可达。

**WRITE_PATH_CHANGED:** NO　**DATABASE_SCHEMA_CHANGED:** NO　**COST_ENGINE_CHANGED:** NO
**REUSABLE_LEGACY_ASSETS_EXTRACTED:** 0（无需抽取：四族链路本已是 Native 代码）

---

## 8. 门禁与测试（END_COMMIT `761ab78`）

| 门禁 | 结果 |
|---|---|
| `npm test` | PASS — tests **3273** / pass **3273** / fail **0** |
| `verify:api-contract` | PASS — 28 / 28 |
| `test:deep-api` | PASS — passed **489** / failed **0**；`localPumpDbUsed=false`、`tempDatabaseIntegrity=ok` |
| `lint` | PASS |
| `build` | PASS（静态页 18/18） |
| `verify:ai-native-release` | PASS — `READY_FOR_OWNER_TRIAL`；canaryScope 由 6 族扩为 **10 族**；`productionReadiness NOT_READY` |
| `test:ai-architecture` | PASS — 120 / 120 |
| `tests/nativeR1ReadCutover.test.cjs` | PASS — **13 / 13** |

**被显式改动（非静默删除）的旧断言**，均带 NATIVE-R1 说明：
- `tests/nativeS1CanaryScope.test.cjs`：`S1-B1` baseline 6→10 族并列出新 ID；`S1-C2` 用仍未登记的 `CUSTOMER_HISTORY` 替代已准入的 `MANAGEMENT_OVERVIEW` 代表"未支持"；supported 计数 6→10、total 9→12。
- `tests/nativeCoverageWave1.test.cjs`：supported 6→10、unsupported 2→1（附架构变更说明）。
- `tests/nativeCoverageWave1R1.test.cjs`：计数 6/1/2→10/1/1、total 9→12，测试标题同步更新。

---

## 9. Blockers

1. **非 owner 流量的残余面**：`aiDispatcherV3.cjs:58` 仍把非 owner 请求交给 Legacy。这不属于 F1（Native 从未被尝试），因此"迁移族永不进入 Legacy"当前只在 F1 人群（`AI_NATIVE_MODE=owner` + owner 身份）内成立。关闭它等于把 Native 只读能力开放给全部已登录用户 —— **属产品/风险决策，需 Supervisor 裁定**。
2. 剩余 F1 源：`OTHER`（catch-all）、`IMPACT_INVESTIGATION`（需先登记 `project_business_impact`）、`CUSTOMER_HISTORY` / `ORDER_READINESS`（实现已在，待纳入下一批）。
3. 既有安全项（按用户指示本轮未处置）：`api.cjs:153-155` 的 `x-internal-secret` 可跳过 JWT 命中正式写路由（`POST /api/parts/` 无确认卡要求），且该密钥当前值在公开 Gitee 历史中可匿名读取。

---

## 10. 结论

第一批四个只读族已**真正脱离 Legacy**：准入由覆盖表显式声明、由计划级所有权闸门兜底，在成功与全部失败路径下 `aiAssistantRuntime` / `aiAgentRuntimeV3` / Legacy tool loop 的调用次数经实测均为 0，F3 对其不可达，且全程未新增任何 Legacy 回退、未改写入路径、未动 schema 与 costEngine。

**下一阶段未开始，等待 Supervisor 审核。**

---

## 附：证据索引

- 工作笔记 / Phase A-B-C 分解：`planning/ai-native-v1/release/NativeR1F1AdmissionDecomposition.json`
- 实现：`api/services/aiNativeOwnerTrialCoverage.cjs`、`api/services/aiTaskControllerV2.cjs`、`api/services/aiDispatcherV3.cjs`
- 测试：`tests/nativeR1ReadCutover.test.cjs`（新增）、`tests/nativeS1CanaryScope.test.cjs`、`tests/nativeCoverageWave1.test.cjs`、`tests/nativeCoverageWave1R1.test.cjs`
- 门禁日志：`.dev-local/logs/gates/*.log`（本地，未入库）
