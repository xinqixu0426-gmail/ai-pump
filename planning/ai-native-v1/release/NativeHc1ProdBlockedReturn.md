# NATIVE-HC1-PROD 交付报告（Supervisor 审阅用）—— BLOCKED

**Ticket:** NATIVE-HC1-PROD — Deploy Native-Only Runtime and Prove Legacy AI Is Dead in Production
**Branch:** `ai-native/prod-canary-s2`
**STATUS:** **BLOCKED**（发布门禁在生产环境失败；**未部署、未重启、生产行为零变化**）
**日期:** 2026-09-25

---

## 0. 一句话结论

HC1 代码本身没有问题，但**权威发布流程在生产机上跑不过**：`verify:release` 的 `npm test` 有 3 项失败，全部来自 `tests/secR0InternalWriteAuthorization.test.cjs`。根因是**该测试夹具自身**：它 spawn `api.cjs` 时继承了生产 `.env` 的 `BEHIND_PROXY=true` 与 `MCP_WRITE_ENABLED=true`，却把 `MCP_ENABLED` 钉成 `false`，于是子进程被判定为生产、启动即被 `assertProductionEnvironment` 拒绝。按 ticket §2「存在真实阻断项则 STATUS=BLOCKED、不得部署」，**已停止部署**。

---

## 1. 基线事实（§1，全部为实测 git 证据）

| 项 | 值 |
|---|---|
| 权威仓库 | GitHub `xinqixu0426-gmail/ai-pump`（生产与开发两个 clone 的 `origin` 均指向它；Gitee 仅作 `gitee-backup`） |
| 权威分支 | `ai-native/prod-canary-s2` |
| **GITHUB_HEAD（部署前）** | `6fd2ac0e6d7e334f45bd6134454a3b1eef985860` |
| GITHUB_HEAD（本报告提交后） | `b5d1790f9d3fb5147e2cefbe0acaee6437c673c2`（仅多一份本报告文档，包含 HC1） |
| **PRODUCTION_HEAD（部署前）** | `f7f7467ff6743583dfe05461174b1df053456bb5`（分支 `ai-native/prod-canary-s2`，`git status --short` 为空） |
| production 是否是 GitHub HEAD 的祖先 | **是**（`git merge-base --is-ancestor f7f7467 6fd2ac0` = true） |
| GitHub HEAD 是否包含 `286a8c6` | 是 |
| GitHub HEAD 是否包含 `cf6e9e3` | 是 |
| GitHub HEAD 是否包含 SEC-R0（`ded46ab`） | 是 |
| GitHub HEAD 是否包含 NATIVE-R1（`9ea41dd`） | 是 |
| GitHub HEAD 是否包含 NATIVE-R2（`7694f43`） | 是 |
| 生产工作区是否 dirty | **否**（操作前后均为空） |

**生产缺失的提交（`git log --oneline f7f7467..6fd2ac0`）**

```
6fd2ac0 docs(ai): NATIVE-HC1 supervisor-facing Legacy hard-cut return
cf6e9e3 test(ai): NATIVE-HC1 rewrite the rollout-safety gate to Native-only semantics
286a8c6 feat(ai)!: NATIVE-HC1 hard cut — Legacy AI orchestration removed from production
1b71072 docs(ai): NATIVE-R3 supervisor-facing Native-only read runtime return
6bb5f2e feat(ai): NATIVE-R3 establish Native-only Owner read runtime
```

→ 如实说明：本次部署目标不只含 HC1，**还含 NATIVE-R3**（`6bb5f2e`）。两者都在 GitHub 权威 HEAD 内，符合 ticket §5「部署含 HC1 的 GitHub HEAD」。

### 上一份报告 SHA 差异（`6af1de7` vs `f7f7467`）的解释

两份报告都没错，说的是两件不同的事：

- `6af1de7` 是 SEC-R0-PROD 的**阻塞版**返回记录（轮换前置条件未满足）。
- 之后完成轮换，`f7f7467` 是 SEC-R0-PROD-R1 的**完成**记录，且 `6af1de7` 是它的祖先。
- 另外，**生产运行中的进程报告的 commit 是 `6af1de7`**（`/api/health/ready` → `runtime.gitCommit = 6af1de7bf6e1`，进程启动于 13:13），而**工作区 HEAD 已经是 `f7f7467`**——因为 `6af1de7..f7f7467` 的差异**只有一个文档文件**：

```
$ git diff --name-status 6af1de7 f7f7467
A   planning/ai-native-v1/release/SecR0ProdR1CutoverReturn.md
```

即：**运行中的运行时 = `6af1de7`，签到 HEAD = `f7f7467`，两者无任何代码差异**。所以「生产 HEAD 到底是哪个」的答案是：**git HEAD = `f7f7467`；运行中的代码 = `6af1de7`（内容等价）**。

---

## 2. `productionReadiness = NOT_READY` 的逐条枚举与分类（§2）

运行 `npm run verify:ai-native-release`（干净树，`cf6e9e3`）得到：

```json
{"status":"PASS","readiness":"READY_FOR_OWNER_TRIAL","structuralReadiness":"STRUCTURALLY_READY",
 "ownerTrialCoverageReadiness":"READY_WITHIN_SUPPORTED_SCOPE","productionReadiness":"NOT_READY",
 "sourceRevision":"cf6e9e349670b88f813db62bb8601891fe7424e2"}
```

`readinessBreakdown` 共三项，**只有第三项是 NOT_READY**：

| # | 条件 | 判定来源 | 分类 | 是否阻断部署 |
|---|---|---|---|---|
| 1 | `productionReadiness = NOT_READY` | **硬编码常量**：`scripts/run-ai-native-quality-gate.cjs:104-107` 写死 `status:'NOT_READY'`，`reason:'E1 阶段不部署、不做生产灰度；生产就绪需要独立授权与生产形状验收。'` **不由任何技术条件计算得出** | **EXPECTED_PRODUCT_BOUNDARY**（流程/授权边界，非技术阻断；本 ticket 正是这份"独立授权 + 生产形状验收"） | **否** |
| 2 | `ownerTrialReadiness = NOT_READY`（仅当以生产形状运行门禁时出现） | `api/services/aiNativeQualityGate.cjs:48-57` 要求 `config.mode === 'off'`；生产 `AI_NATIVE_MODE=owner` → 该门禁按其"试用前置检查"设计必然 NOT_READY | **EXPECTED_PRODUCT_BOUNDARY**（这是 owner-trial 前置门禁，不是生产门禁；HC1 批准的生产契约要求 `owner`） | **否** |
| 3 | `AI_NATIVE_WRITE_ENABLED=false` | 生产 `.env`（实测 `false`） | **EXPECTED_PRODUCT_BOUNDARY**（§3 契约明确要求 owner 写请求得到 `AI_WRITE_DISABLED`） | **否** |
| 4 | 14 个只读族中 2 个未支持（`IMPACT_INVESTIGATION` 能力缺口、`OTHER` catch-all） | R3 交付边界，fail-closed 为 Native 显式受限结论 | **EXPECTED_PRODUCT_BOUNDARY** | **否** |
| 5 | F2 休眠（`AI_READ_INVESTIGATION_V4_ENABLED` 未设置） | R3 已记录为 DORMANT | **EXPECTED_PRODUCT_BOUNDARY** | **否** |

**结论：`productionReadiness NOT_READY` 没有任何一条来自技术条件，全部是已批准的产品/流程边界。**（实测方式：以生产形状 env 直接调用 `ownerTrialReadiness`，逐条打印每个判据的取值。）

### 但部署时发现了**另一个**真实阻断项（不在上面 5 条内）

按 ticket §2 的标准，这一条属于 **REAL_DEPLOYMENT_BLOCKER**（它使权威发布流程无法完成），因此 **STATUS = BLOCKED**。详见 §3。

---

## 3. 阻断项：生产环境发布门禁 `npm test` 3 项失败（根因已定位）

### 3.1 现象

`deploy-macmini-release.sh` 在第 [4/9] 步 `npm run verify:release` 失败（脚本 `set -e` 退出，未进入第 [5/9] 重启步）：

```
ℹ tests 3263
ℹ pass 3260
ℹ fail 3

✖ SEC-R0 内部密钥不再单独授权业务写；内部只读与合法内部自动化保持可用 (60263ms)
✖ SEC-R0 非 owner 在 Owner-only 路由被拒（AI 入口），业务写不因此获得 Owner 语义 (60215ms)
✖ SEC-R0 专用写凭据的配置约束（长度与互异性）在真实运行环境中生效 (60233ms)

Error: SEC_R0_RUNTIME_NOT_READY
  Error: MCP_WRITE_ENABLED=true 时必须同时启用 MCP_ENABLED=true
      at assertProductionEnvironment (api/services/environment.cjs:341)
      at Object.<anonymous> (api.cjs:44:3)
```

### 3.2 根因（完整调用链）

1. `tests/secR0InternalWriteAuthorization.test.cjs:60-86` `startRuntime()` 以 `{...process.env, NODE_ENV:'test', MCP_ENABLED:'false', ...}` spawn `api.cjs`。
2. `api.cjs:6` `require('dotenv').config()`（**不覆盖**已存在的进程变量）→ 生产 `.env:14` `BEHIND_PROXY=true` 被注入子进程。
3. `api/services/environment.cjs:10-15` `isProductionEnvironment()`：即使 `NODE_ENV=test`，只要 `BEHIND_PROXY=true` 且非 Windows 就**返回 true** → 子进程被判为生产。
4. `api.cjs:43-45` 于是执行 `assertProductionEnvironment()`。
5. `environment.cjs:210-215` `validateMcpConfiguration()`：`MCP_ENABLED` 被测试钉成 `false`，而 `MCP_WRITE_ENABLED` 从生产 `.env:45` 继承为 `true` → 报 `MCP_WRITE_ENABLED=true 时必须同时启用 MCP_ENABLED=true` → 子进程启动即死 → `waitForReady` 60s 超时 → 3 个用例全部 `SEC_R0_RUNTIME_NOT_READY`。

### 3.3 证据：与 HC1 **无关**，是既有夹具缺陷

| 证据 | 结果 |
|---|---|
| `git diff --stat f7f7467 6fd2ac0 -- tests/secR0InternalWriteAuthorization.test.cjs` | 空（HC1 未改动该测试） |
| `git diff --stat f7f7467 6fd2ac0 -- api.cjs api/services/environment.cjs` | 空（HC1 未改动启动与环境校验） |
| 开发 clone（dev `.env` 无 `BEHIND_PROXY=true`、MCP 关闭） | `npm test` 3263/3263 PASS → 说明是**环境触发**，不是代码坏了 |
| 生产 checkout 内 `MCP_WRITE_ENABLED=false node --test tests/secR0InternalWriteAuthorization.test.cjs` | **3/3 PASS** |
| 生产 checkout 内 `BEHIND_PROXY=false node --test tests/secR0InternalWriteAuthorization.test.cjs` | **3/3 PASS** |

→ 该缺陷自 SEC-R0 起就潜伏在测试夹具里；生产最近一次完整门禁是对 `20755dd` 跑的（`logs/release-code-gate-20755dd….json` 存在），SEC-R0/R3/HC1 的推进未再跑过完整 `verify:release`，因此在本次部署才暴露。**它会让以后每一次生产部署都卡在同一处。**

### 3.4 建议的最小修复（**未执行，等 Supervisor 批准**）

只改测试夹具，使其环境自洽、且与 boot 模式无关（`tests/secR0InternalWriteAuthorization.test.cjs` `startRuntime()` 的 env 覆盖表，第 63-85 行）：

```js
 BEHIND_PROXY: 'false',        // 夹具声明 NODE_ENV=test，就不该被生产 .env 的代理标记翻成生产模式
 MCP_ENABLED: 'false',
+MCP_WRITE_ENABLED: 'false',   // 与上一行同组，必须一致，否则生产断言拒绝启动
```

两行都是测试夹具范围，**零产品行为改动、不涉及 Legacy、不涉及兼容层**；两种单变量修复均已实测 3/3 通过。

---

## 4. 备份（§4，已完成）

走的是既有权威机制（`npm run db:backup:release` + `db:backup:verify`），在 pull 之前对**部署前版本**做的：

| 项 | 值 |
|---|---|
| 备份路径 | `/Users/dan/pump-cost-accounting-system/backups/release/pump-release-2026-09-25T15-47-56-022Z.db` |
| sha256 | `5bea4a5ac18c1013d1a2760245b8e9e3d9dba74b63d26d2bea8291b02211596d` |
| 字节 | 47,128,576 |
| schema | userVersion 88 / migrationVersion 88 / migrationCount 88 |
| 源 commit | `f7f7467ff6743583dfe05461174b1df053456bb5` |
| 验证结果 | **PASS**（部署流程内一次 + 事后独立重跑一次，两次一致） |
| 保留策略副作用 | 该机制按自身保留策略删除了更旧的一份 `pump-release-2026-09-20T13-32-39-050Z.db`（既有行为，非本次新增覆盖） |

`backups/` 属 gitignore 目录，未提交、未暴露任何密钥。

---

## 5. 部署执行到哪一步（§5/§6）

| 步骤 | 结果 |
|---|---|
| [1/9] 备份 + 校验 | ✅ PASS |
| [2/9] `git fetch` + `pull --ff-only` | ✅ PASS：`f7f7467..6fd2ac0` **快进**成功（无 force、无 reset、未碰 Gitee、无 cherry-pick、无 DB 手工改动） |
| [3/9] 依赖安装 | ✅ 依赖锁未变化，按流程跳过 `npm ci` |
| [4/9] 代码发布门禁 `verify:release` | ❌ **FAIL**（§3）→ 脚本退出，**未写入门禁证据文件**（`logs/release-code-gate-6fd2ac0….json` 不存在） |
| [5/9] LaunchDaemon 重启 | ⛔ **未执行** |
| [6/9]–[9/9] 就绪/公网/AI 验收 | ⛔ **未执行** |

**当前生产状态（重要）**

- git HEAD：`6fd2ac0`（已被快进，含 HC1），工作区 `git status --short` **为空**。
- **运行中的进程没有被重启**：`runtime.gitCommit = 6af1de7bf6e1`，启动时间 `2026-09-25T13:13:39Z`（即仍跑部署前的代码）。
- 因此实际对外行为 **零变化**；但**生产工作区已"装填"HC1**——此后任何一次进程重启（含 KeepAlive 崩溃重启）都会加载 HC1。
- 未做任何回退/重置（ticket §1 明确禁止 `reset --hard` / `clean` / force）。是否要把工作区退回 `f7f7467` 请 Supervisor 明确指示。

---

## 6. §7 / §8 生产硬切验收

**未执行**（HC1 未进入运行进程，做了也证明不了 HC1）。本节留空，等门禁修复后重跑。

---

## 7. SEC-R0 回归（§9，对**运行中**的生产服务实测）

`SEC_R0_BOUNDARY: PASS`（边界未变，仍被强制）：

| 探测 | 期望 | 实测 |
|---|---|---|
| `GET /api/parts` + `x-internal-secret` | 200（内部只读通道保留） | **200** |
| `POST /api/parts` + 仅 `x-internal-secret`（空体） | 403 `INTERNAL_WRITE_FORBIDDEN` | **403 `INTERNAL_WRITE_FORBIDDEN`** |
| `POST /api/ai/chat` + `x-internal-secret` | 403 `AI_OWNER_ONLY`（机器秘密不得升格为 Owner） | **403 `AI_OWNER_ONLY`** |
| `POST /api/ai/chat` 未认证 | 401 | **401** |
| `INTERNAL_SECRET` | 存在、64 字符 | ✅ |
| `INTERNAL_WRITE_SECRET` | 存在、64 字符、与 `INTERNAL_SECRET` 及 `ACCESS_PASSWORD` 互异 | ✅ |
| `AI_NATIVE_WRITE_ENABLED` | `false` | ✅ `false` |
| 密钥轮换 | **未做**（ticket §9 明确不再轮换） | ✅ 未做 |
| 密钥输出 | 报告与终端均未打印任何密钥值 | ✅ |

---

## 8. 生产数据安全（§10，实测前后对比）

基线 `2026-09-25T15:49:35Z` → 收尾 `2026-09-25T18:29:31Z`：

| 表 | before | after | Δ |
|---|---|---|---|
| parts | 92 | 92 | **0** |
| recipes | 3 | 3 | **0** |
| orders | 1 | 1 | **0** |
| quotations | 1 | 1 | **0** |
| customers / coils | 2 / 14 | 2 / 14 | **0 / 0** |
| coil_stock_movements | 5 | 5 | **0** |
| business_change_events | 155 | 155 | **0** |
| business_change_event_entities | 223 | 223 | **0** |
| audit_log | 6810 | 6810 | **0** |
| api_operations | 1844 | 1845 | **+1** |
| ai_conversations / messages | 66 / 403 | 66 / 403 | **0 / 0** |
| ai_tasks / steps / evidence / events | 0 | 0 | **0** |

`api_operations` 的那 +1 行已逐行核对：`id 1883`、`capability_id = quotations.expire_overdue`、`actor_key = system:quotation-expiry`、`idempotency_key = quotation-expiry:scheduled:2026-09-26`、`created_at = 16:04:59Z`——是**系统自身的定时报价过期任务**，与本 ticket 的探测（发生在 18:29）无关。

**本 ticket 未造成任何业务数据变化；写意图探测从未越过业务校验边界。**

---

## 9. 门禁（开发 clone，干净树 `cf6e9e3`；供参照）

| 门禁 | 结果 |
|---|---|
| `npm test`（dev `.env`） | PASS — 3263 / 3263 |
| `npm run verify:api-contract` | PASS — 28 / 28 |
| `npm run test:deep-api` | PASS — 489 / 489 |
| `lint` / `build` | PASS / PASS |
| `verify:ai-native-release` | PASS — `READY_WITHIN_SUPPORTED_SCOPE`（`productionReadiness NOT_READY`，见 §2） |
| NATIVE-HC1 专项 + NATIVE-R3 专项 | PASS — 6 / 6 + 11 / 11 |
| `npm test`（**生产 checkout**） | **FAIL — 3260 / 3263**（§3 的 3 项，全部为夹具缺陷） |

---

## 10. 退出标准核对（§11）

| # | 标准 | 结果 |
|---|---|---|
| 1 | 真实生产 HEAD 已查明 | ✅ `f7f7467`（运行 `6af1de7`，内容等价，§1） |
| 2 | `NOT_READY` 已完整解释 | ✅ §2 |
| 3 | 无真实部署阻断项残留 | ❌ **存在一个**（§3） |
| 4 | production == GitHub 权威 HEAD | ❌ 工作区已快进到 `6fd2ac0`，但**未重启**；运行态 ≠ HEAD |
| 5 | HC1 提交已部署 | ❌ 未部署 |
| 6 | Owner 只读为 Native-only | ⛔ 未测（未部署） |
| 7 | 未支持/无计划只读留在 Native | ⛔ 未测（未部署） |
| 8 | Owner AI 写显式失败且不进 Legacy | ⛔ 未测（未部署） |
| 9 | 非 owner = 403 | ✅ 运行态 403 `AI_OWNER_ONLY`（§7） |
| 10 | 未认证 = 401 | ✅ 401（§7） |
| 11 | `aiAssistantRuntime` 生产调用 = 0 | ⛔ 未测（未部署）；**静态已达 0**（见下） |
| 12 | `aiAgentRuntimeV3` 生产调用 = 0 | ⛔ 未测（未部署）；**静态已达 0** |
| 13 | Legacy tool loop 生产调用 = 0 | ⛔ 同上 |
| 14 | SEC-R0 保持 | ✅ §7 |
| 15 | `AI_NATIVE_WRITE_ENABLED=false` | ✅ |
| 16 | 生产业务数据未变化 | ✅ §8 |
| 17 | health / ready PASS | ✅（旧代码运行中，`/api/health` 200、`/api/health/ready` ready=true） |
| 18 | 工作区干净 | ✅ |

**静态可达性（对生产 checkout `6fd2ac0` 实测，与部署无关，先给出）**：从生产入口 `api.cjs` 出发遍历 295 个静态 require 可达模块，**Legacy 编排 import 边 = 0**，`aiAssistantRuntime` / `aiAgentRuntimeV3` / `aiReadInvestigationDriverV4` 均不在可达闭包内（三者仍在磁盘上，属 HC2 待删死代码；闭包内唯一命中 `/legacy/` 文件名的是 `api/services/legacyPartNaming.cjs`，那是旧客户端零件命名适配器，与 AI 编排无关）。

---

## 11. BLOCKERS

1. **【阻断部署】** 生产环境 `verify:release` 的 `npm test` 3 项失败，根因是 `tests/secR0InternalWriteAuthorization.test.cjs` 夹具环境自相矛盾（§3）。修复需 Supervisor 批准（两行测试夹具改动，方案已给出且两种变体均已实测 3/3 通过）。
2. **【状态需指示】** 生产工作区已被快进到含 HC1 的 `6fd2ac0`，但服务未重启；此后任何进程重启都会加载 HC1。请指示：批准修复后一次性完成部署，还是先显式把工作区退回 `f7f7467`。
3. **产品行为预告（部署后必然发生）**：HC1 上线后，owner 之外的用户访问 AI 会得到 `403 AI_OWNER_ONLY`；未支持/无法归类的只读提问会得到 Native 的受限结论而非自由回答。属批准契约，但建议提前告知使用方。

**未启动 HC2；未改动任何产品代码；未重启服务；未轮换密钥；未写业务数据。等待 Supervisor 决定。**
