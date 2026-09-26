# NATIVE-HC2 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-HC2 — Physically Delete Retired Legacy AI Orchestration
**Branch:** `ai-native/prod-canary-s2`
**START_COMMIT:** `30c5c53a9236c6ec3bba62b799066ed41705ab26`
**END_COMMIT:** `3282494ce7752a36c7cc2ff124e9aa4f8e40c58c`（实现+门禁）+ 紧随其后的本文档 docs 提交
**STATUS:** **PASS**（开发阶段；按 §18 **未部署生产**）
**日期:** 2026-09-26

---

## 0. 一句话结论

退役的 Legacy AI 编排已**从仓库实现层物理移除**：85 个 `api/` 模块、22 个脚本、5 个测试夹具/helper、3 个 fixture、2 个 planning 一次性脚本、64 个 Legacy 测试文件全部删除（合计 **181 个文件、约 4.9 万行**），13 个只为 Legacy 存在的开关被清除，163 个"改指当前实现"的断言重写到 Native 服务上，并新增一个**构建失败型**静态不变量测试（`tests/nativeHc2LegacyDenylist.test.cjs`）。全部幸存门禁 PASS，生产未部署。

---

## 1. §2 依赖清单（在 START_COMMIT 重新计算，不信旧数字）

方法：从真实入口 `api.cjs` 求静态 `require` 闭包（P）；从 Legacy 根 `aiAssistantRuntime` / `aiAgentRuntimeV3` /
`aiReadInvestigationDriverV4` 求闭包（L）；再分别求 `tests/**`（T）与 `scripts/**`（S）闭包；对每个候选核对
解析后的真实路径、当前消费者、测试/脚本引用。

| 集合 | 数量 |
|---|---|
| 仓库内 `.cjs/.js` 源文件 | 977 |
| 生产闭包 P（`api.cjs` 出发） | 295 |
| Legacy 闭包 L | 193 |
| **L \ P（Legacy-only，删除候选）** | **79**（17,003 行） |
| L ∩ P（共享/活跃，保留） | 114 |
| 孤儿模块（不在 P/L/T/S 任一） | 2（`ontology/shadowWorker`、`ontology/traversalWorker`） |
| 其它非 P 非 L 模块（逐个审计） | 10（5 保留、5 删除，见 §2.2） |
| 文本引用旧数量（上一票估计 51 模块 / 39 测试） | **已过时**：实际 79 模块 / 71 个受影响测试文件 |

**动态 require 校验**（防止闭包漏边）：`api/` 下在所有 `.cjs` 中检测非字面量 `require(<expr>)` = **0 处**，
因此 P 是完备的；Legacy 闭包亦无动态边。脚本区存在动态 require（`CANARY_PATH`、`definitionPath`、
`path.join(ROOT, …)` 等），已逐个核对，涉及退役模块的脚本本身即在删除列表中。

### 1.1 分类结果（§3）

| 分类 | 数量 | 说明 |
|---|---|---|
| **DELETE_LEGACY_ONLY** | **181 个文件** | 85 `api/` 模块 + 22 脚本 + 5 helper + 3 fixture + 2 planning 脚本 + 64 测试 |
| **KEEP_ACTIVE_SHARED** | **119** | 114 = Legacy 闭包内同时被生产闭包引用的模块（业务基础设施）；+5 = 非 P 非 L 但被活跃消费者使用（§2.2） |
| **EXTRACT_THEN_DELETE** | **0** | 见 §3 理由 |
| **KEEP_NON_AI_BUSINESS_COMPAT** | **1 个模块 + 若干业务字段** | `api/services/legacyPartNaming.cjs`（旧客户端零件命名适配器）；以及业务 API 的 `legacy_open` / `bound_legacy` / `resolved_legacy` / `legacy_recipe_fallback` 等**业务兼容字段**（非 AI 编排） |
| **UNKNOWN** | **0** | — |

### 1.2 非 P 非 L 的 10 个模块逐条裁定（§3C/D/E）

| 模块 | 裁定 | 依据 |
|---|---|---|
| `api/ontology/traversal.cjs` (79) | DELETE | 仅被孤儿 worker 与已删 Legacy 测试引用 |
| `api/services/aiArchitectureAcceptanceV4.cjs` (553) | DELETE | Legacy V4 验收夹具，被 Legacy shadow/测试引用 |
| `api/services/aiIntentPlannerV2.cjs` (2) | DELETE | 2 行兼容壳，`module.exports = require('./aiGoalPlannerV3.cjs')` |
| `api/services/aiShadowComparisonV4.cjs` (475) | DELETE | Legacy V4 shadow 比较 |
| `api/services/aiNativeQualityGate.cjs` (66) | KEEP | 当前发布门禁脚本 `scripts/run-ai-native-quality-gate.cjs` 的消费者 |
| `api/services/aiTaskWorkerV2.cjs` (215) | KEEP | Native 持久任务 worker 脚手架，被 Native live/evidence 脚本与测试使用（**非 Legacy**） |
| `api/services/aiTaskRecoveryV2.cjs` (91) | KEEP | 同上（崩溃恢复） |
| `api/services/databaseRestore.cjs` (124) | KEEP | `db:restore` 运维链消费者 |
| `api/services/ownerAuthenticationGateway.cjs` (80) | KEEP | 生产 Owner 登录守护进程消费者 |
| `api/lib/evidenceHashing.cjs` (73) | KEEP | 发布证据生成/校验链消费者 |

---

## 2. §6 删除的 Legacy 运行时（按目录）

| 目录 | 删除数 | 代表模块 |
|---|---|---|
| `api/services/` | **46** | `aiAssistantRuntime`、`aiAgentRuntimeV3`、`aiReadInvestigationDriverV4`、`aiReadInvestigationRuntimeV4`、`aiClaimGroundingV4`、`aiFactModelV4`、`aiFactReducerV4`、`aiGroundedAnswerV4`、`aiObservationV3`、`aiNumericScalarFactsV4`、`aiStableEntityIdentityV4`、`aiCapabilityBrokerV4`、`aiCapabilityCatalogV2`、`aiCapabilityGraphV3`、`aiEntityResolverV3`、`aiGoalPlannerV3`、`aiIntentPlannerV2/V3`、`aiToolProtocol`、`aiToolShortlist`、`aiToolIdentifierGrounding`、`aiPromptComposer`、`aiProviderStream`、`aiAssistantAnswer/Context/Session`、`aiPresentationNormalizer`、`aiMoneyGuard`、`moneyFactProjection`、`criticalFactProjection`、`canonicalEntityIdentity`、`aiBusinessRulebook`、`aiPageContext`、`aiContext`、`aiEvidenceBundle`、`aiTaskEnvelope`、`aiResponsePresenter`、`aiSafetyReplies`、`aiKnowledgeCompanionsV2`、`aiCoilVariantAnswer`、`recipeCoilRelationAnswer`、`recipePartRelationAnswer`、`l5OffCompatibility`、`aiShadowComparisonV4`、`aiArchitectureAcceptanceV4` 等 |
| `api/ontology/` | **16** | `bindingContract`、`bindingCurrentFacts`、`bindingMetadata`、`relationBinder`、`relationRootCanonical`、`relationRoutingCanary`、`runtimeShadow`、`shadowContract`、`shadowEligibility`、`shadowWorker`、`traversal`、`traversalBinder`、`traversalContract`、`traversalPolicy`、`traversalShadow`、`traversalWorker` |
| `api/business-semantics/` | **14** | `answerBoundary`、`answerProjection`、`authoritativeCandidateScope`、`completenessPolicy`、`contract`、`eligibilityBoundary`、`evidencePlanContract`、`evidencePlanValidator`、`evidencePlanner`、`factCapabilityRegistry`、`formalRelationEvidence`、`frameBuilder`、`shadowObserver`、`validator` |
| `api/business-impact/` | **9** | `answerBoundary`、`contract`、`eligibility`、`enforcementContract`、`evidenceBundle`、`projection`、`shadowObserver`、`triggerBuilder`、`validator` |

**保留**（同一目录下的活跃基础设施）：`api/ontology/{contract,resolver,resolverContract,sources,validator}.cjs`、
`api/business-semantics/{questionSemantics,readinessSemantics}.cjs`（生产闭包内，Native 语义与知识关系读取在用）。

---

## 3. §5 为什么 `EXTRACT_THEN_DELETE = 0`

裁定规则是「只有**当前活跃消费者**或**已批准的 Native 契约**才保留」。本轮逐个核对后没有任何模块满足抽取条件：

- 79 个 Legacy-only 模块**不在生产闭包内**（P 从 `api.cjs` 出发，包含 295 个模块），因此不存在任何生产调用者需要它们的确定性逻辑；
- Native 已有等价实现且正在生产使用：金额/展示口径 → `api/capabilities/monetaryPresentationContract.cjs` + `aiTaskAnswerV2`；事实与证据 → `aiTaskFactsV2` + `aiExecutionEvidence` + `aiAnswerGrounding`；校验/歧义 → `aiTaskValidationV2`；语义与就绪 → `business-semantics/{questionSemantics,readinessSemantics}` + `aiTaskSemanticsV2`；实体/身份 → `aiResourceResolutionV3` + `aiTaskStructuredReadsV2`；
- 由此没有出现「Native → 部分保留的 Legacy 模块」这种被 §5 禁止的形态，也没有为了"rename 架构"而新建 shared 文件。

**唯一"改指"而非删除的东西**是 9 个仍有效的测试断言（§6）——它们保留的是**业务不变量**，指向当前生效的 Native 实现，不是把 Legacy 逻辑搬进新文件。

---

## 4. §7 测试处理

| 处理 | 数量 | 说明 |
|---|---|---|
| 删除（Legacy 行为/回退/影子/canary 专属） | **64 个测试文件** | V4 调查与 claim grounding、Legacy 助手/工具协议/短名单/答案与展示、金额守卫与投影、business-semantics/impact 强制层、ontology 关系/canary/shadow/traversal、Legacy 冗余审计与 witness 语料、L5 兼容、`aiIntentPlannerV2` 壳等 |
| 重写（保留仍有效的业务不变量，改指当前实现） | **9 个文件 / 163 个断言** | 见下表 |
| 新增（构建失败型不变量） | **1 个文件 / 7 个用例** | `tests/nativeHc2LegacyDenylist.test.cjs` |
| 另删除的 Legacy-only 测试辅助 | 5 helper + 1 验收测试 + 3 fixture | `legacyAiRuntime`、`legacyRedundancyHarness`、`ontologyRoutingCorpus`、`ontologyTraversalCorpus`、`runOntologyRoutingApiFixture`、`relationRuntimeAcceptance.test.cjs`、`l5-off-compatibility-v1.json`、`ontology-coil-recipe-legacy-oracle-v3/v4.json` |

重写清单（**没有一条是"为了保住旧实现"**）：

| 文件 | 处理 | 保留的不变量 |
|---|---|---|
| `apiStaticContract.test.cjs` | 删除 5 个直接读退役文件的用例；24 个用例去掉只描述已删 Legacy 提示词装配器的断言 | 路由/工具/注册表/服务/UI 的只读与边界断言全部保留 |
| `apiRouteIntegrationContract.test.cjs` | 删除 2 个 Legacy 链路用例；1 个展示名用例去掉 Legacy 协议文件断言 | 展示名来自能力注册表、executorKey 唯一分发等 |
| `businessChangeContracts.test.cjs` | 改指 `aiTaskStructuredReadsV2` + 能力注册表 | 「变更历史」与「管理待办」是两个正式域/能力 |
| `businessTerminologyContract.test.cjs` | 身份面清单移除已删文件 | 产品命名一致性 |
| `ontologyRelationResolver.test.cjs` | 无暴露检查的文件清单改为活跃文件 | Ontology resolver 不得进入 chat/工具/MCP/HTTP |
| `pwaContract.test.cjs` | 去掉 3 条 Legacy 提示词断言 | 前端 SSE/Markdown 流式契约 |
| `recipeIdentityResolution.test.cjs` | 删除 Legacy `resolveRelationIdentity` 用例 | 正式 `/api/recipes/identity` 能力契约 |
| `nativeCoverageWave1(.R1).test.cjs` | 删除仅依赖 Legacy `projectMoneyFacts` 的 6 个用例 | Native 覆盖/准入/比较/续接全部用例保留 |
| `s2r1CurrentFunctionStability.test.cjs` / `s2r3p1ReadinessSemanticBoundary.test.cjs` | 删除 Legacy 口径与 Legacy 语义边界用例 | Native 控制器口径、齐料域、OWNER-1..6 全部保留 |
| `aiExecutorBehavior.test.cjs` | 删除 8 个经 Legacy 对话夹具驱动的用例 | 22 个直接验证活跃 `executeToolCall` 的用例保留 |
| `aiProvider.test.cjs` | 删除 1 个使用 Legacy stream reader 的超时用例 | Provider 超时/重试仍由相邻活跃用例覆盖 |

---

## 5. §8 静态架构不变量（新增守门人）

`tests/nativeHc2LegacyDenylist.test.cjs`（7/7 PASS，随 `npm test` 构建失败）：

1. `HC2-DENY-1` 181 个退役文件在磁盘上**不存在**；
2. `HC2-DENY-2` 任何 `.cjs/.js` 都不得 `require` 退役模块（**按解析后的真实路径比对**，避免 basename 碰撞）；
3. `HC2-DENY-3` 从 `api.cjs` 出发的生产闭包（>200 模块）**不可达任何退役模块**；
4. `HC2-DENY-4` 生产代码（`api/**`）不得出现 18 个退役符号（`runAiAssistant`、`runAiAgentRuntimeV3`、`projectMoneyFacts`、`deterministicSemanticAnswer`、`composeAiSystemPrompt`、`readAiProviderStream` 等）；
5. `HC2-DENY-5` 发布/部署链脚本（`run-tests`、`run-deep-api-smoke`、`run-ai-native-quality-gate`、`run-ai-native-rollout-live`、`verify-production-env`、`run-knowledge-evaluation`、`manage-database-backups`、`run-ai-architecture-acceptance`、`n73-generate-release-evidence`）不得引用退役实现；
6. `HC2-DENY-6` 13 个退役开关不得再被生产代码读取、也不得写进 `.env.example`；
7. `HC2-DENY-7` 当前架构文档必须声明 Native-only，且不得再指示退役开关。

---

## 6. §9 / §14 开关与命令清理

**删除的 13 个开关**（先核对"没有任何幸存代码读取"，再删）：

`AI_READ_INVESTIGATION_V4_ENABLED`、`AI_READ_INVESTIGATION_V4_SHADOW_ENABLED`、`AI_CLAIM_GROUNDING_V4_ENABLED`、
`AI_DYNAMIC_TOOL_ROUTING_ENABLED`、`AI_LOCAL_TOOL_SHORTLIST_ENABLED`、`AI_ONTOLOGY_RELATION_SHADOW_ENABLED`、
`AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED`、`AI_ONTOLOGY_2HOP_SHADOW_ENABLED`、`AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED`、
`AI_BUSINESS_IMPACT_SHADOW_ENABLED`、`AI_BUSINESS_IMPACT_ENFORCEMENT_CANARY_ENABLED`、
`AI_BUSINESS_SEMANTIC_SHADOW_ENABLED`、`AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED`

**保留的开关**（有活跃消费者，逐类）：Native rollout `AI_NATIVE_MODE` / `AI_NATIVE_WRITE_ENABLED`；Owner/AI 身份
`AI_V5_OWNER_SUBJECTS` / `PUMP_OWNER_*`；Provider `AI_PROVIDER` / `AI_PROVIDER_TIMEOUT_MS` / `AI_VISION_ENABLED`；
上下文预算 `AI_CONTEXT_WINDOW_TOKENS` / `AI_RESERVED_OUTPUT_TOKENS` / `AI_ATTACHMENT_CONTEXT_TOKENS` /
`AI_HISTORY_CONTEXT_TOKENS` / `AI_KNOWLEDGE_EXCERPT_TOKENS` / `AI_EVIDENCE_CONTEXT_TOKENS`；SSE/观测
`AI_CHAT_TIMEOUT_MS` / `AI_SSE_HEARTBEAT_MS` / `AI_OBSERVABILITY_ENABLED` / `AI_OBSERVABILITY_PROJECT` / `AI_TRACE_CONTENT`；
MCP 全套 `MCP_*`。**未改动任何活跃 Native rollout 语义**；生产 `.env` 未改（其中遗留的死键不影响运行，已由 `.env.example` 与文档移除）。

**删除的脚本（22 个 `scripts/`）**：`phase-d/oracles`、`phase-e2/run-wave1-live`、`phase-e2/run-wave1-r1-live`、
`phase-s1/run-owner-stability-live`、`run-ai-native-phase-d-live`、`run-ai-shadow-evaluation`、
`run-business-impact-benchmark`、`run-business-semantic-enforcement-acceptance`、`run-business-semantic-production-validation`、
`run-business-semantic-shadow`、`run-business-understanding-benchmark-v2`、`run-observability-p03b-trace-harness`、
`run-observability-p06-replay`、`observability-p06-replay-preload`、`run-ontology-binding-corpus`、
`run-ontology-routing-deepseek-ab`、`run-ontology-routing-http-runtime`、`run-ontology-routing-real-ab`、
`run-ontology-routing-real-local-ab`、`run-ontology-shadow-corpus`、`run-ontology-traversal-corpus`、
`run-relation-runtime-acceptance`；另删 2 个 `planning/…/release/_*.cjs` 一次性缺陷分析脚本。

**删除的 package 命令（1 个）**：`test:ai-shadow`（唯一只跑 Legacy 的门禁命令）。其余命令（业务/API/测试/部署/MCP/备份）全部保留。

---

## 7. §10 / §11 / §12 专项审计

- **§10 工具/执行器**：活跃执行面是 `api/routes/ai/executor.cjs` + `executors/*` + `api/routes/ai/tools.cjs`（均在 P 内，保留，业务 API 仍是唯一真源）。Legacy 侧不存在独立的业务写实现可被误留：Legacy 的写路径全部经由同一 executor/命令链，`aiToolProtocol` 等 Legacy 包装层已删除。**没有复制任何业务 API。**
- **§11 答案/守卫/证据**：Legacy 的 `aiMoneyGuard`、`moneyFactProjection`、`criticalFactProjection`、`aiPresentationNormalizer`、`canonicalEntityIdentity`、`aiToolIdentifierGrounding`、`aiGroundedAnswerV4`、`aiClaimGroundingV4` 均为**与 Native 竞争的重复实现**，已整体删除；Native 侧保留 `monetaryPresentationContract`、`aiTaskAnswerV2`、`aiTaskValidationV2`、`aiAnswerGrounding`、`aiExecutionEvidence`、`aiTaskFactsV2`。未出现"两套并行版本"。
- **§12 Ontology**：按**当前可执行使用**审计（而非历史投入）——保留 5 个活跃模块（`contract`、`resolver`、`resolverContract`、`sources`、`validator`，均在 P 内，服务 `/api/relations/read|resolve` 与关系解析），删除 16 个 Legacy shadow/binding/canary/traversal 模块（含 2 个死 worker）。**没有因为 F3 撤除而整体删除 Ontology。**

---

## 8. §13 文档清理

- **当前文档改为 Native-only 事实**：`docs/ai-native-v1-handoff.md`（新增「当前事实（NATIVE-HC1 → HC2）」区块，并把速览表中"生产没跑 Native / Legacy 没删"两行改为当前事实，§4 标注为历史章节）、`docs/ai-assistant.md`（运行时描述、源码入口、开关段落）、`docs/api-reference.md`（4 处运行时/rollout/canary 描述）、`docs/README.md`、`README.md`、`docs/deployment-checklist.md`。
- **删除"怎么开启 Legacy"的指令**：`.env.example` 移除 11 个开关与相关注释；`docs/deployment-checklist.md` 的开关前置项改为"这些开关已删除"。
- **历史记录保留、不重写历史**：14 篇描述已删组件的设计/审计文档加一行「已退役（NATIVE-HC2）」横幅；`planning/**` 历史报告原文保留。
- **哈希链维护**：`docs/ai-native-v1-handoff.md`、`docs/api-reference.md`、`scripts/n73-generate-release-evidence.cjs` 被 N7.3 closure record 绑定了 canonical sha256，已按既有机制刷新这 3 个哈希并加了说明字段；`ReleaseEvidenceV1.json` 与其历史基线 revision/tree、payload 侧文件**未改动**（不重写历史证据）。`n73-generate-release-evidence.cjs` 的提示词哈希改指当前生效的 `api/routes/ai/prompt.cjs`。

---

## 9. §15 未触动项（逐条确认）

| 项 | 状态 |
|---|---|
| 业务 API 行为 | **未改动**（`api/routes/**` 除已删 Legacy 模块外无改动；契约测试全绿） |
| `costEngine` 公式 | **未改动** |
| DB schema / migrations | **未改动**（无迁移、无 schema 变更；deep-api 报告 `migrationHead=88, applied=88`） |
| 审计 / 确认 / 回滚 / 变更历史 | **未改动** |
| SEC-R0 认证边界 | **未改动**（`api/services/internalWriteAuthorization.cjs`、`api.cjs` 内部密钥边界零改动；专项测试 4/4 PASS） |
| Owner-only AI 边界 | **未改动**（`aiNativeRolloutPolicy`、`aiChatAccessBoundary` 零改动） |
| `AI_NATIVE_WRITE_ENABLED` | **false**（未改） |
| Native Write | **未开启** |
| 新功能 | **未新增** |

---

## 10. §16 Before / After

| 指标 | Before `30c5c53` | After `3282494` | Δ |
|---|---|---|---|
| `api/` 模块数 | 384 | **299** | −85 |
| `api/` 行数 | 102,812 | **84,749** | −18,063 |
| `scripts/` 文件数 / 行数 | 83 / 21,061 | **61 / 14,653** | −22 / −6,408 |
| `tests/` 文件数 / 行数 | 370 / 90,976 | **300 / 73,085** | −70 / −17,891 |
| 测试文件（`*.test.cjs`） | 341 | **277** | −64 |
| `npm test` 用例数 | 3264 | **2265** | −999 |
| 删除文件总数 | — | **181** | — |
| 退役开关 | 13 个被读取/记录 | **0** | −13 |
| 退役脚本 / 命令 | 24 / 1 | **0 / 0** | −24 / −1 |
| 提交级 diff | — | — | 223 files changed, **+568 / −49,403** |

---

## 11. §17 门禁（干净树 `3282494`）

| 门禁 | 结果 |
|---|---|
| targeted SEC-R0 | **PASS** — 4/4 |
| HC1 专项 + R3 等 7 文件 | **PASS** — 90/90 |
| `npm test` | **PASS** — **2265/2265**，fail 0 |
| `verify:api-contract` | **PASS** — 28/28 |
| `test:deep-api` | **PASS** — passed 489 / failed 0（canonical 确定性源，未读本机 DB） |
| `lint` | **PASS** |
| `build` | **PASS** |
| `verify:ai-native-release` | **PASS** — `READY_WITHIN_SUPPORTED_SCOPE`（`productionReadiness NOT_READY` 为已接受的边界） |
| `test:ai-architecture` | **PASS** — 120/120 |
| **HC2 静态架构** | **PASS** — 7/7 |
| 门禁日志 | `.dev-local/logs/rework-gates-hc2b-20260926T120544.log` |

被删/改写的门禁说明：无任何活跃安全门禁被跳过或放宽；唯一删除的门禁命令是只运行 Legacy 影子评估的 `test:ai-shadow`，其判据已由 HC2 denylist 取代。

---

## 12. §18 生产部署

**未部署**（按 ticket 要求，HC2 属结构清理，等 Supervisor PASS 后再走发布流程）。
生产保持 `30c5c53a9236c6ec3bba62b799066ed41705ab26`（工作区干净、运行时 `30c5c53a9236`、ready=true），
GitHub 权威 HEAD 现为 `3282494ce7752a36c7cc2ff124e9aa4f8e40c58c`（已推送）。

---

## 13. §19 退出标准核对

| # | 标准 | 结果 |
|---|---|---|
| 1 | 所有 Legacy AI 候选已分类 | ✅ 181 DELETE / 119 KEEP / 0 EXTRACT / 1+业务字段 COMPAT |
| 2 | UNKNOWN = 0 | ✅ |
| 3 | Legacy-only 运行时模块已物理删除 | ✅ 85 个 `api/` 模块 |
| 4 | Legacy-only 测试已删除/替换 | ✅ 64 删除 + 9 重写 + 1 新增 |
| 5 | 生产无退役运行时 import | ✅ DENY-2/3/4 |
| 6 | 无活跃测试实例化退役运行时 | ✅ DENY-2 |
| 7 | 无发布脚本调用退役运行时 | ✅ DENY-5 |
| 8 | 无 Legacy 回退开关残留（除非独立活跃） | ✅ 13 个删除，0 残留 |
| 9 | 可复用逻辑仅在**有当前消费者**时保留 | ✅ 无抽取；`EXTRACT_THEN_DELETE = 0` 且已说明理由 |
| 10 | 无重复的 Legacy/Native 双实现 | ✅ Legacy 重复实现整体删除 |
| 11 | 当前文档描述 Native-only | ✅ DENY-7 + §8 |
| 12 | 业务 API 保留 | ✅ |
| 13 | costEngine 未变 | ✅ |
| 14 | DB schema 未变 | ✅ |
| 15 | SEC-R0 保留 | ✅ |
| 16 | Owner-only 边界保留 | ✅ |
| 17 | `AI_NATIVE_WRITE_ENABLED=false` | ✅ |
| 18 | 全部幸存门禁 PASS | ✅ §11 |
| 19 | 工作区干净 | ✅ `git status --short` 为空 |
| 20 | 已推送到 GitHub | ✅ `3282494`（origin 一致） |

---

## 14. BLOCKERS

**无。**

一点需 Supervisor 知悉（非阻断）：生产 `.env` 里仍保留着这些已删除的 Legacy 开关键；它们已不被任何代码读取，
删除它们需要改生产环境文件（本票 §15/§9 未授权改生产 env），因此留给下一次已批准的发布一并清理。当前不影响运行。
