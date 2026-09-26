# NATIVE-HC2-PROD 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-HC2-PROD — Deploy Physical Legacy Removal and Clean Retired Production Flags
**Branch:** `ai-native/prod-canary-s2`
**STATUS:** **PASS**
**日期:** 2026-09-26

---

## 0. 三个 SHA（§6）

| 对象 | SHA |
|---|---|
| GitHub `origin/ai-native/prod-canary-s2` | `4b3084a9404fe0a9ad978f784a0af282040abcce` |
| 生产工作区 `git rev-parse HEAD` | `4b3084a9404fe0a9ad978f784a0af282040abcce` |
| `/api/health/ready` → `runtime.gitCommit` | `4b3084a9404f`（即 `4b3084a9404fe0a9ad978f784a0af282040abcce` 的前 12 位） |

**三者一致**；公网 `https://xuxinqi.xin/api/health/ready` 同为 `4b3084a9404f`。

---

## 1. §1 前置检查（全部实测）

| 检查 | 结果 |
|---|---|
| GitHub HEAD 含 HC2 提交 | ✅ `24fb1a3`（删除主体）、`3282494`（哈希链维护）、`4b3084a`（报告）均在 `origin/ai-native/prod-canary-s2` 祖先链上 |
| 生产 HEAD 是 GitHub HEAD 的祖先 | ✅ `git merge-base --is-ancestor 30c5c53 4b3084a` = true |
| 生产工作区干净 | ✅ `git status --short` 为空（操作前后均为空） |
| 无未提交的受跟踪配置改动 | ✅ 受跟踪树干净；`.env` 为 gitignore 文件，其改动见 §2 |
| DB schema | ✅ `PRAGMA user_version = 88` |
| 服务健康 | ✅ `/api/health` 200；`/api/health/ready` ready=true、schema 88、startupBackup.ok=true |

未使用 `reset --hard`、未 force、未碰 Gitee、未做任何 DB 手工改动。

---

## 2. §2 备份（权威机制）

| 项 | 值 |
|---|---|
| 机制 | `scripts/deploy-macmini-release.sh` 第 [1/9] 步：`npm run db:backup:release` + `db:backup:verify` |
| 备份路径 | `/Users/dan/pump-cost-accounting-system/backups/release/pump-release-2026-09-26T05-05-16-119Z.db` |
| source commit | `30c5c53a9236c6ec3bba62b799066ed41705ab26`（部署前版本） |
| sha256 | `15affa94c575f7e5fc916dc2b1e6637e0ea2ebbdcd0c7911c3d25f83bd33bb8e` |
| schema | userVersion 88 / migrationVersion 88 / migrationCount 88 |
| 校验结果 | **PASS**（create + verify 两次输出一致；`success: true`，`parts 92 / recipes 3 / orders 1 / coils 14 / customers 2 / quotations 1`） |
| 启动备份 | 第 [6/9] 步另验证重启后 startup 备份：`db:backup:verify --latest --type startup` PASS，`gitCommit = 4b3084a9404f` |
| 保留策略 | 未手工删除任何旧备份；仅由既有保留策略自行处理 |

**生产 `.env` 备份**（因 §3 需修改该文件）：`.env.bak-before-hc2-20260926-130508`（mode 600，内容为改动前逐字节副本）。

---

## 3. §3 退役开关审计与清理

### 3.1 零消费者证明（对 **CURRENT GitHub HEAD `4b3084a`** 逐条核对）

13 个退役开关在**当前 GitHub HEAD** 上：

| 检查面 | 命中数 |
|---|---|
| 生产/源码读取（`api.cjs` + `api/**/*.cjs`） | **0 / 13** |
| 发布/部署脚本读取（`run-tests`、`run-deep-api-smoke`、`run-ai-native-quality-gate`、`run-ai-native-rollout-live`、`verify-production-env`、`run-knowledge-evaluation`、`manage-database-backups`、`run-ai-architecture-acceptance`、`n73-generate-release-evidence`、`deploy-macmini-release.sh`、`deploy-macmini.ps1`） | **0 / 13** |
| `.env.example` | **0 / 13** |

→ `RETIRED_ENV_FLAGS_ZERO_CONSUMER: YES`（无任何活跃消费者，故按 §3 继续删除，未 STOP）。

### 3.2 生产 `.env` 实际清理

| 项 | 值 |
|---|---|
| 期望退役集合 | 13 |
| 生产 `.env` 中实际存在 | **5**（其余 8 个生产从未设置：`AI_READ_INVESTIGATION_V4_ENABLED`、`AI_READ_INVESTIGATION_V4_SHADOW_ENABLED`、`AI_CLAIM_GROUNDING_V4_ENABLED`、`AI_DYNAMIC_TOOL_ROUTING_ENABLED`、`AI_LOCAL_TOOL_SHORTLIST_ENABLED`、`AI_ONTOLOGY_RELATION_SHADOW_ENABLED`、`AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED`、`AI_ONTOLOGY_2HOP_SHADOW_ENABLED`） |
| 已删除的 5 个键 | `AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED`、`AI_BUSINESS_IMPACT_SHADOW_ENABLED`、`AI_BUSINESS_IMPACT_ENFORCEMENT_CANARY_ENABLED`、`AI_BUSINESS_SEMANTIC_SHADOW_ENABLED`、`AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED` |
| 行数变化 | 64 → 59（恰好删除 5 行） |
| 其余行完整性 | ✅ 逐行比对：结果 == 原文**仅**去掉这 5 行，其它行逐字节未变 |
| 删除后残留退役键 | **0** |
| 环境形状回归 | ✅ 删除后 `verify-production-env` = 「生产环境变量检查通过」 |
| 值泄漏 | ✅ 审计与报告只输出键名，未输出任何值 |

---

## 4. §4/§5 部署与重启（权威流程）

`scripts/deploy-macmini-release.sh`（`PUMP_DEPLOY_BRANCH=ai-native/prod-canary-s2`）一次性走完 **[1/9]–[9/9]，用时 100 秒**，
日志 `logs/hc2-prod-deploy-20260926T130515.log`：

| 步骤 | 结果 |
|---|---|
| [1/9] 备份+校验 | ✅（§2） |
| [2/9] `git fetch` + `pull --ff-only` | ✅ `30c5c53 → 4b3084a` 快进（无 force/reset/cherry-pick/Gitee） |
| [3/9] 依赖 | ✅ 锁文件未变，按流程跳过 `npm ci` |
| [4/9] 代码发布门禁 `verify:release` | ✅ **PASS**（`npm audit` ×2 = 0 vulnerabilities；`verify:api-contract` 28/28；`lint` PASS；**`npm test` 2265/2265**；`test:deep-api` 489/489；`build` PASS；`verify:ai-native-release` PASS；`verify:prod-env` PASS）→ 证据文件 `logs/release-code-gate-4b3084a9404fe0a9ad978f784a0af282040abcce.json` = `{"status":"passed"}` |
| [5/9] LaunchDaemon 重启 | ✅ `launchctl kickstart -k system/com.pumpfactory.{api,web}`，**无需 sudo 交互**（未触发 ACTION_REQUIRED，未使用 kill+KeepAlive 变通） |
| [6/9] 本机 ready / Web / 启动备份 | ✅ `validate_ready_commit` 通过（runtime commit == 目标 commit）、`/login` 可取、startup 备份校验 PASS |
| [7/9] 真实 AI 发布门禁 | ✅ `passed`（核心用例已于 2026-09-19 由负责人决定退役，`coreCasesRetired: true`，`gitCommit 4b3084a9404f`） |
| [8/9] 公网 ready / 登录页 / AI 页 | ✅ |
| [9/9] 生产 MCP 只读验收 | 按 2026-09-19 负责人决定默认停用（不阻断发布） |

---

## 5. §7 物理删除的生产侧证明

| 检查 | 结果 |
|---|---|
| `api/services/aiAssistantRuntime.cjs` | **ABSENT** |
| `api/services/aiAgentRuntimeV3.cjs` | **ABSENT** |
| `api/services/aiReadInvestigationDriverV4.cjs` | **ABSENT** |
| 退役 Legacy 运行时文件 | **0 个存在**（生产 checkout 内运行 `tests/nativeHc2LegacyDenylist.test.cjs` → **7/7 PASS**，其中 `HC2-DENY-1` 逐个核对 181 个退役文件均不存在） |
| 生产 Legacy AI import 边 | **0**（生产 checkout 独立静态闭包：从 `api.cjs` 出发 295 个可达模块，Legacy 入口 `legacyEntryModulesOnDisk: []`、`legacyImportEdges: []`；denylist `DENY-2/3/4` 亦为 0） |
| 测试 import 退役运行时 | **0**（`DENY-2`） |
| 发布脚本调用退役运行时 | **0**（`DENY-5` 覆盖 9 个发布/部署链脚本） |
| `legacyPartNaming.cjs` | 保留（旧客户端零件命名适配器，**未**按 Legacy AI 编排处理；闭包中唯一 `/legacy/` 命名命中） |

---

## 6. §8 生产 AI 冒烟（真实 HTTP，只读/非变更）

证据：`logs/hc2-prod-acceptance-20260926T130713.json`（进程 `gitCommit=4b3084a9404f`，遥测 `requests 0 → 8`）

| 用例 | 问法 | HTTP | SSE 阶段 | detail 终态 | Legacy 阶段 |
|---|---|---|---|---|---|
| A 支持读 | `V550大脚板-2寸-经典款现在成本多少？` | 200 | `task_v2` | `SUCCEEDED` | **无** |
| B 未支持读 | `今天天气怎么样？` | 200 | `task_v2`,`native_owned` | `UNSUPPORTED` | **无** |
| B2 影响调查 | `这次配方变更会影响哪些订单？` | 200 | `task_v2`,`native_owned` | `PARTIAL` | **无** |
| C 歧义/裸指代 | `它现在成本多少？` | 200 | `task_v2` | `SUCCEEDED`（Native 继承语义） | **无** |
| C2 无计划/不存在实体 | `查一下 V999不存在的配方 的成本` | 200 | `task_v2` | `UNSUPPORTED`（精确 Native 负结论） | **无** |
| D 写意图 | `把12-120线圈库存增加100套` | 200 | `native_write_disabled` | `WRITE_DISABLED` | **无** |
| E 非 owner（admin JWT） | 同 A | **403** `AI_OWNER_ONLY` | — | — | 无 |
| F 未认证 | 同 A | **401** | — | — | 无 |

8 次请求的 SSE 阶段只出现 Native 阶段，**Legacy 类阶段标记 = 0**；`/api/ai/health` 遥测 `sampleCount 0 → 8`（6 completed + 2 failed，即 E 与 SEC-R0 探测），说明「不是没流量才为 0」。

---

## 7. §9 安全回归（生产实测，只读安全）

| 项 | 结果 |
|---|---|
| `GET /api/parts` + `x-internal-secret` | **200**（内部只读保留） |
| `POST /api/parts` + 仅 `x-internal-secret` | **403 `INTERNAL_WRITE_FORBIDDEN`** |
| `POST /api/ai/chat` + `x-internal-secret` | **403 `AI_OWNER_ONLY`**（机器秘密未升格为 Owner） |
| `POST /api/ai/chat` 未认证 | **401** |
| `INTERNAL_SECRET` | 存在 / 64 字符 / 只读语义 |
| `INTERNAL_WRITE_SECRET` | 存在 / 64 字符 / 与 `INTERNAL_SECRET` 及 `ACCESS_PASSWORD` 互异 |
| `AI_NATIVE_WRITE_ENABLED` | **false**（未改；`AI_NATIVE_MODE=owner` 未改） |
| 密钥轮换 | **未做**（本票不需要） |
| 密钥输出 | ✅ 报告、终端、日志均无任何密钥值 |

---

## 8. §10 数据安全（部署+验收窗口前后实测）

窗口 `2026-09-26T05:05:13Z → 05:07:30Z`（覆盖 ff 部署、重启与 8 次 AI 冒烟）：

| 表 | before | after | Δ |
|---|---|---|---|
| parts / recipes / orders / quotations | 92 / 3 / 1 / 1 | 92 / 3 / 1 / 1 | **0 / 0 / 0 / 0** |
| customers / coils / coil_stock_movements | 2 / 14 / 5 | 2 / 14 / 5 | **0 / 0 / 0** |
| order_execution_records / order_requirement_summaries | 0 / 0 | 0 / 0 | **0 / 0** |
| business_change_events / …_entities | 155 / 223 | 155 / 223 | **0 / 0** |
| ai_conversations / ai_conversation_messages | 66 / 403 | 66 / 403 | **0 / 0** |
| ai_tasks / steps / evidence / events / memories | 0 | 0 | **0** |
| audit_log | 6815 | 6817 | **+2** |
| api_operations | 1847 | 1849 | **+2** |

**非零增量逐行归因（全部为系统定时任务，非本票验收所致）**：
`audit_log` +2 = `knowledge_sync_runs` INSERT + `knowledge_vector_sync_runs` INSERT（`user="system"`，时间戳 05:06:47/48，紧随 05:06:46 服务重启的启动期自动同步）；
`api_operations` +2 = `quotations.expire_overdue`（`actor_key=system:quotation-expiry`）+ `market.sync_copper_price`（`system:market-sync`），同为启动期调度。

→ **`BUSINESS_MUTATION_OCCURRED: NO`**（无任何测试引起的业务变更）。

---

## 9. §11 发布元数据（仅报告，未重构）

`logs/ai-native-quality-gate-latest.json`（生产，`sourceRevision=4b3084a9404fe0a9ad978f784a0af282040abcce`，`sourceDirty=false`）：

```
quality.status                    = PASS
readiness                         = READY_FOR_OWNER_TRIAL
structuralReadiness               = STRUCTURALLY_READY
ownerTrialCoverageReadiness       = READY_WITHIN_SUPPORTED_SCOPE
productionReadiness               = NOT_READY
  reason: E1 阶段不部署、不做生产灰度；生产就绪需要独立授权与生产形状验收。
```

**未做任何"改标签"动作**。按 §11 说明：该 `NOT_READY` 是历史硬编码元数据；**实际获批的部署门禁全部通过**
（`quality.status=PASS`、`STRUCTURALLY_READY`、`READY_WITHIN_SUPPORTED_SCOPE`、`sourceDirty=false`、发布流程 [1/9]–[9/9] 全绿）。

---

## 10. §12 退出标准核对

| # | 标准 | 结果 |
|---|---|---|
| 1 | production == GitHub HEAD | ✅ `4b3084a` |
| 2 | HC2 删除已部署 | ✅ [2/9] 快进 + [5/9] 重启 |
| 3 | 服务已重启到 HC2 | ✅ runtime `4b3084a9404f`，启动于 05:06:46Z |
| 4 | 退役文件物理不存在 | ✅ 0（denylist DENY-1 7/7） |
| 5 | 生产 Legacy AI import = 0 | ✅ 闭包 295/0 边 + DENY-2/3/4 |
| 6 | 测试 Legacy AI import = 0 | ✅ DENY-2 |
| 7 | 发布脚本 Legacy AI import = 0 | ✅ DENY-5 |
| 8 | 13 个退役 env key 经零消费者证明后移除 | ✅ 13/13 零消费者；生产实际存在的 5 个已删除，8 个本就不存在；残留 0 |
| 9 | Owner 只读仍为 Native-only | ✅ A/B/B2/C/C2 |
| 10 | Owner 变更仍 WRITE_DISABLED | ✅ D |
| 11 | 非 owner = 403 | ✅ `AI_OWNER_ONLY` |
| 12 | 未认证 = 401 | ✅ |
| 13 | SEC-R0 保持 | ✅ §7 |
| 14 | `AI_NATIVE_WRITE_ENABLED=false` | ✅ |
| 15 | DB schema 未变 | ✅ 88 |
| 16 | costEngine 未变 | ✅ 本票未触碰 `api/services/costEngine.cjs` |
| 17 | 无测试引起的业务变更 | ✅ §8（Δ 全 0，非零增量均归因系统调度） |
| 18 | health / ready PASS | ✅ 本机 200 + ready=true + schema 88 + 启动备份 ok；公网 ready=true、commit `4b3084a9404f` |
| 19 | 工作区干净 | ✅ `git status --short` 为空 |

---

## 11. BLOCKERS

**无。**

附注（非阻断）：生产 `.env` 已按 §3 删除 5 个退役键并留了逐字节备份 `.env.bak-before-hc2-20260926-130508`；
另 8 个退役键生产从未设置，无需处理。生产运行时与仓库现已一致地不含任何 Legacy AI 编排。
