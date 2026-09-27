# NATIVE-W1-PROD-SAFE 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-W1-PROD-SAFE — Deploy Native Write V1 Backend with Production Write Kill Switch Kept OFF
**Branch:** `ai-native/prod-canary-s2`
**STATUS:** **PASS**
**日期:** 2026-09-26
**报告位置说明:** 本报告写在两个 git checkout **之外**（`/Users/dan/Documents/ai-native-pump-system/planning/ai-native-w1-prod-safe/`），
以保证「生产 HEAD == GitHub 权威 HEAD == `154287d`」这条退出标准在交付后仍然成立（不产生额外提交）。

---

## 0. 三个 SHA（commit consistency）

| 对象 | SHA |
|---|---|
| GitHub `origin/ai-native/prod-canary-s2`（部署前解析） | `154287dcba362709ede48e2866d6e6bbc318c212` |
| 生产工作区 `git rev-parse HEAD`（部署后） | `154287dcba362709ede48e2866d6e6bbc318c212` |
| 生产 `/api/health/ready` → `runtime.gitCommit` | `154287dcba36`（即同一 40 位 SHA 的前 12 位） |
| 生产公网 `https://xuxinqi.xin/api/health/ready` | `154287dcba36`，ready = true |
| **部署前**生产工作区 HEAD | `cb5be53e622292d4da0b9ce7906108e2fc69568b` |
| W1 gates-green 实现提交（部署内容） | `7b1bc0fc328bf7cb564564fa30846947bdfacf53` |

**`RUNTIME == WORKTREE == GITHUB` = YES**（三者 40 位 SHA 完全一致）。

远端说明：`origin` 为 `git@github.com:xinqixu0426-gmail/ai-pump.git`（长期使用的 GitHub 权威远端，
与历次票一致），其上 `ai-native/prod-canary-s2` 的 HEAD 与票面 `EXPECTED_GITHUB_HEAD` 逐字符相同；
另有 `gitee-backup` 远端存在但**本票全程未使用**。

---

## 1. §2 前置检查（全部实测）

| 检查 | 结果 |
|---|---|
| 重新解析 `origin/ai-native/prod-canary-s2` | ✅ `154287d`（== `EXPECTED_GITHUB_HEAD`） |
| W1 实现提交是 GitHub HEAD 祖先 | ✅ `git merge-base --is-ancestor 7b1bc0f origin/…` = true |
| 生产 HEAD | ✅ `cb5be53e622292d4da0b9ce7906108e2fc69568b`（== 票面 CURRENT PRODUCTION HEAD） |
| 生产 HEAD 是 GitHub HEAD 祖先 | ✅ true，**可快进**（领先 9 个提交） |
| 生产工作区干净 | ✅ `git status --porcelain` 为空 |
| 生产服务健康 | ✅ `/api/health/ready` HTTP 200、ready=true、runtime `cb5be53e6222` |
| `AI_NATIVE_WRITE_ENABLED` | ✅ **false**（`.env` 第 57 行；若为 true 本票立即 STOP） |

未使用 `reset --hard`、未 force、未 cherry-pick 兼容分支、未碰 Gitee、未做任何手工 DB 改动。

---

## 2. §3 备份（权威发布备份机制）

| 项 | 值 |
|---|---|
| 机制 | `scripts/deploy-macmini-release.sh` 第 [1/9] 步：`db:backup:release` + `db:backup:verify` |
| 备份路径 | `/Users/dan/pump-cost-accounting-system/backups/release/pump-release-2026-09-26T09-35-54-243Z.db` |
| source commit | `cb5be53e622292d4da0b9ce7906108e2fc69568b`（部署前版本） |
| bytes | 47,128,576 |
| sha256 | `39dc8be6c00edac848b489c508c52e1ea5022b9ba3741b4377ce5ddb50d32d20` |
| schema | userVersion 88 / migrationVersion 88 / migrationCount 88 |
| 校验 | ✅ `verify --latest --type release --expect-commit cb5be53e…` → `success: true`，sha256 与创建时一致 |
| 容器计数 | parts 92 / recipes 3 / orders 1 / coils 14 / customers 2 / quotations 1 |
| 保留策略 | 仅由既有策略自行清理（本轮移除 1 份 2026-09-20 旧备份） |
| 启动备份 | 第 [6/9] 步另验证重启后启动备份：`success: true`，schema 88，`gitCommit = 154287dcba362709ede48e2866d6e6bbc318c212` |
| 密钥泄漏 | ✅ 报告与日志只输出路径/哈希/计数，无任何密钥值 |

**未修改生产 `.env`**（本票不需要；`.env` 全程逐字节未变）。

---

## 3. §4 部署（权威流程）

`scripts/deploy-macmini-release.sh`（`PUMP_DEPLOY_BRANCH=ai-native/prod-canary-s2`）一次性走完 [1/9]–[9/9]，
**用时 88 秒**，退出码 0，结束行：`发布完成：commit 154287dcba36，用时 88 秒。`

| 步骤 | 结果 |
|---|---|
| [1/9] 备份+校验 | ✅ §2 |
| [2/9] `git fetch` + `pull --ff-only` | ✅ `cb5be53 → 154287d` **快进** |
| [3/9] 依赖 | ✅ 锁文件未变，按流程跳过 `npm ci` |
| [4/9] 代码发布门禁 | ✅ PASS（§4，`set -euo pipefail` 保证**门禁失败即中止，不会走到重启**） |
| [5/9] LaunchDaemon 重启 | ✅ `launchctl kickstart -k system/com.pumpfactory.{api,web}`，**无需 sudo 交互**（未触发 ACTION_REQUIRED） |
| [6/9] ready / Web / 启动备份 | ✅ `validate_ready_commit` 通过（runtime commit == 目标 commit）、`/login` 可取、启动备份校验 PASS |
| [7/9] 真实 AI 发布门禁 | ✅ `passed`（核心用例已于 2026-09-19 由负责人决定退役） |
| [8/9] 公网 ready / 登录页 / AI 页 | ✅ |
| [9/9] 生产 MCP 只读验收 | 按 2026-09-19 负责人决定默认跳过（不阻断发布） |

预期与实际一致：**无 schema 迁移、无 Business API 语义变更、无 costEngine 变更**（§7 给出证明）。

---

## 4. §5 发布门禁（生产 checkout，`verify:release`）

日志：`/tmp/w1prod-deploy.log` 第 84–2634 行（完整 gate 输出）。
门禁文件：`logs/release-code-gate-154287dcba362709ede48e2866d6e6bbc318c212.json`。

| 门禁 | 结果 |
|---|---|
| `npm audit` / `web-next audit` | ✅ 各 `found 0 vulnerabilities` |
| `verify:api-contract` | ✅ **28/28** |
| `npm test` | ✅ **2289/2289** |
| `test:deep-api` | ✅ **passed 489 / failed 0**（canonical deterministic source，未读本机 `pump.db`） |
| `lint` | ✅ PASS |
| `build` | ✅ PASS（Next.js 15.5.25，18/18 静态页） |
| `verify:ai-native-release` | ✅ `status PASS`、`STRUCTURALLY_READY`、`READY_WITHIN_SUPPORTED_SCOPE`、`sourceRevision 154287d` |
| `verify:prod-env` | ✅ 「生产环境变量检查通过」 |

生产 checkout 内**显式复跑**指定套件（重启后独立证据）：

| 套件 | 结果 |
|---|---|
| Native W1 targeted（`nativeW1PartStockWrite` + `nativeW1PartStockHttpE2E`） | ✅ 24/24（含 5 个真实进程 E2E） |
| HC2 Legacy denylist（`nativeHc2LegacyDenylist`） | ✅ 7/7（DENY-1..7） |
| SEC-R0（`secR0InternalWriteAuthorization`） | ✅ 4/4 |
| 四者合计 | ✅ **35/35 PASS，0 fail** |

发布门禁内亦已确认：`npm test` 中共出现 **24 个 `✔ W1-` 用例**、**4 个 `✔ SEC-R0`**、**7 个 `✔ HC2-DENY`**
（即门禁本身已覆盖票面要求的全部指定套件）。

---

## 5. §6/§7 重启与提交一致性

| 检查 | 结果 |
|---|---|
| 重启机制 | ✅ 系统级 LaunchDaemon（`launchctl kickstart -k`），**未使用 sudo、未使用 kill+KeepAlive 变通** |
| 进程启动时间 | `2026-09-26T09:37:16.392Z`（pid 11501） |
| runtime commit | `154287dcba36` |
| 生产工作区 HEAD | `154287dcba362709ede48e2866d6e6bbc318c212` |
| `origin/ai-native/prod-canary-s2` | `154287dcba362709ede48e2866d6e6bbc318c212` |
| 三者一致 | ✅ **YES**（40 位 SHA 逐一相同） |
| 工作区干净 | ✅ `git status --porcelain` 为空 |

---

## 6. §8 生产写开关（本票最重要的不变式）

| 项 | 值 |
|---|---|
| `AI_NATIVE_WRITE_ENABLED` | ✅ **`false`**（`.env` 第 57 行，重启后实测仍为 false） |
| `AI_NATIVE_MODE` | `owner`（未改） |
| 是否修改过 `.env` | **否**（本票全程未编辑生产 `.env`） |
| 是否临时开启过开关 | **否**（未以任何方式临时启用写能力来测试端点） |
| Native Write V1 代码是否已部署 | ✅ 是（`api/services/aiNativeWriteScope.cjs` 存在，4112 bytes） |

---

## 7. §9/§10 生产行为与 W1 端点门控（真实 HTTP，只读，绝不批准任何写入）

Owner 会话经**真实 Owner 认证网关**（LaunchDaemon `org.pump.owner-authentication`，`127.0.0.1:3104`）取得，
经 `/api/auth/check` 确认 `owner: true`；凭据只用于本票验收，未在任何输出中打印或持久化。

| 用例 | 请求 | 实测 |
|---|---|---|
| A  Owner 支持读 | `POST /api/ai/chat`「V550大脚板-2寸-经典款现在成本多少？」 | ✅ HTTP 200，SSE 阶段 `task_v2`，终态 `SUCCEEDED` + `VERIFIED`（Native 只读保持） |
| B  Owner 变更意图 | `POST /api/ai/chat`「把某个真实零件库存增加 1」 | ✅ SSE 阶段 `native_write_disabled`，detail **`WRITE_DISABLED`**；**无 `confirmationToken`、无 `requiresConfirmation:true`**（不存在可执行的确认卡） |
| C  非 Owner（admin JWT） | 同 A 问法 | ✅ **403 `AI_OWNER_ONLY`** |
| D  未认证 | 同 A 问法 | ✅ **401** |

W1 三个写端点在 `AI_NATIVE_WRITE_ENABLED=false` 下的门控（用不存在任务的 UUID，绝不触达真实业务）：

| 端点 | Owner 会话 | `x-internal-secret` |
|---|---|---|
| `POST /api/ai/tasks/:taskId/write-preview` | ✅ 403 `AI_NATIVE_WRITE_DISABLED` | ✅ 403 `AI_NATIVE_WRITE_DISABLED` |
| `POST /api/ai/tasks/:taskId/write-execute` | ✅ 403 `AI_NATIVE_WRITE_DISABLED` | ✅ 403 `AI_NATIVE_WRITE_DISABLED` |
| `POST /api/ai/tasks/:taskId/write-reconcile` | ✅ 403 `AI_NATIVE_WRITE_DISABLED` | ✅ 403 `AI_NATIVE_WRITE_DISABLED` |

结论：**端点存在但被 kill switch 安全门控**（生产顺序为 全局写开关 → Owner 身份门 → 完整 rollout，
未开放时任何身份一致得到 `WRITE_DISABLED`），**零业务副作用**。
未以任何方式临时开启该开关来"验证能不能写"。

---

## 8. §11 范围证明（生产 checkout 静态）

| 检查 | 结果 |
|---|---|
| `NATIVE_WRITE_V1_TOOLS` | `["adjust_part_stock"]` |
| `NATIVE_WRITE_V1_CAPABILITIES` | `["inventory.parts.batch_adjust_stock"]` |
| 业务能力总数 / 写或命令类 | 137 / 95 |
| **被 V1 允许** | **恰好 1 个**（`inventory.parts.batch_adjust_stock`） |
| 被 V1 拒绝 | **94 个** |
| 删除类能力（delete/remove/purge） | 17 个，**允许 0 个**（`deleteAllowedByV1: []`） |
| 作用域模块读环境变量 | **0 处**（`scopeReadsEnv: []`）→ 无运行期/配置路径可自动开启额外能力 |
| 白名单形态 | ✅ 冻结字面量（`Object.freeze([...])`），只能靠改代码扩权 |
| 写桥是否复用作用域模块 | ✅ 是（`aiTaskWriteBridgeV2.cjs` → `aiNativeWriteScope`） |
| 路由器中的写端点 | 恰好 3 个（preview / execute / reconcile） |
| 全仓 `process.env.AI_NATIVE_WRITE*` 扫描 | 仅 rollout 开关本身；**无**任何"按环境变量开放某能力"的入口 |

---

## 9. §12 安全回归（生产实测 + 套件）

| 检查 | 结果 |
|---|---|
| Owner-only AI 边界 | ✅ 非 Owner `POST /api/ai/chat` → 403 `AI_OWNER_ONLY`；未认证 → 401 |
| `INTERNAL_SECRET` 仍只读 | ✅ `GET /api/parts` + 内部密钥 → 200；`POST /api/parts` + 仅内部密钥 → **403 `INTERNAL_WRITE_FORBIDDEN`** |
| 内部密钥不能进入 Owner AI 语义 | ✅ `POST /api/ai/chat` + `x-internal-secret` → 403 `AI_OWNER_ONLY` |
| 内部密钥不能批准 Owner 提案 | ✅ 三个写端点 + `x-internal-secret` → 403；且生产套件 `W1-AUTH-1/AUTH-3` 通过（内部只读密钥与 SEC-R0 机器写密钥都不升格为 Owner） |
| `INTERNAL_WRITE_SECRET` 单独配置 | ✅ 存在、64 字符、与 `INTERNAL_SECRET` 互异、与 `ACCESS_PASSWORD` 互异（只输出长度与布尔，不输出值） |
| Owner 凭据与共享密码分离 | ✅ `PUMP_OWNER_ACCESS_PASSWORD != ACCESS_PASSWORD` |
| SEC-R0 | ✅ PASS（生产套件 4/4） |
| Legacy 物理不存在 | ✅ `aiAssistantRuntime.cjs` / `aiAgentRuntimeV3.cjs` / `aiReadInvestigationDriverV4.cjs` 均 ABSENT |
| HC2 denylist | ✅ PASS（生产套件 7/7，含生产 require 闭包） |
| worker | ✅ `TASK_WORKER_DEFAULT_ENABLED = false` 保持，未启用 |
| 密钥轮换 | **未做**（本票不需要） |
| 密钥输出 | ✅ 终端、日志与报告均无任何密钥值 |

---

## 10. §13 数据安全（部署 + 验收窗口前后）

窗口 `2026-09-26T09:35:54Z → 09:40Z`（覆盖 ff 部署、重启、Owner 只读/写意图冒烟与三个写端点探测）：

| 表 | before | after | Δ |
|---|---|---|---|
| parts（数量 / 库存合计） | 92 / 8800 | 92 / 8800 | **0 / 0** |
| parts 指纹（id+model+stock+updated_at） | `8c2b856b…` | `8c2b856b50e3fc2b92b2a194f99089a326be4f0df353c100668039e64088e7c9` | **一致** |
| coils（数量 / 指纹） | 14 / `2c8225a8…` | 14 / `2c8225a8d79cbd273c659a12ea58d16d184cb5a883fc2e3028a0a5e0990a73cf` | **0 / 一致** |
| coil_stock_movements | 5 | 5 | **0** |
| recipes / orders / quotations | 3 / 1 / 1 | 3 / 1 / 1 | **0 / 0 / 0** |
| business_change_events | 155 | 155 | **0** |
| ai_tasks / ai_task_steps / evidence | 0 | 0 | **0** |
| audit_log | 6819 | 6821 | **+2** |
| api_operations | 1852 | 1854 | **+2** |

**非零增量逐条归因（全部为系统启动调度，与 W1 无关）**：

- `api_operations` +2 = `quotations.expire_overdue`（`actor_key=system:quotation-expiry`）+ `market.sync_copper_price`（`system:market-sync`），
  时间戳 `2026-09-26T09:37:16.634Z / .637Z`（紧随 09:37:16.392Z 服务重启的启动期调度）。
- `audit_log` +2 = 上述两条系统任务的 `INSERT` 审计（`user=system`，09:37:16.985Z / 09:37:17.997Z）。
- 任何 Native AI 写操作：**0 条**（`api_operations` 中不存在 `inventory.parts.batch_adjust_stock` 记录）。
- 探针残留：`parts LIKE '%W1-PROD%'` = **0**；审计中无探针痕迹。

→ **`BUSINESS_MUTATION_OCCURRED: NO`**（无任何 AI 引起的业务变更；非零增量与 W1 无因果关系）。

---

## 11. 未变更证明

| 约束 | 结果 |
|---|---|
| DB schema | ✅ 未变（userVersion 88 / migrationVersion 88 / migrationCount 88，部署前后一致；本次 ff 未含迁移文件） |
| costEngine | ✅ 未改（本票为部署，不产生任何代码改动） |
| Business API 语义 | ✅ 未改（`/api/parts` 等行为实测与部署前一致：内部密钥仍只读） |
| 新增写能力 | ✅ 无（§8：恰好 1 个） |
| chat UI | ✅ 未触碰（`apps/web-next` 无改动） |
| worker | ✅ 未启用 |
| DELETE / 价格 / 配方写 | ✅ 未开启（§8） |
| 生产 `.env` | ✅ 未编辑 |

---

## 12. §15 退出标准核对

| # | 标准 | 结果 |
|---|---|---|
| 1 | production == GitHub 权威 HEAD | ✅ `154287d` |
| 2 | W1 代码已部署 | ✅ `aiNativeWriteScope.cjs` 存在，runtime 含 W1 |
| 3 | `AI_NATIVE_WRITE_ENABLED=false` | ✅ |
| 4 | Owner 变更仍 `WRITE_DISABLED` | ✅ §7-B |
| 5 | 零 Native AI 业务变更 | ✅ §10 |
| 6 | preview/execute/reconcile 在 flag=false 下安全门控 | ✅ §7（全 403 `AI_NATIVE_WRITE_DISABLED`） |
| 7 | 代码白名单恰好 1 个 W1 能力 | ✅ §8 |
| 8 | 其余变更全部拒绝 | ✅ 94/94 拒绝 |
| 9 | DELETE 拒绝 | ✅ 17 个删除类能力允许 0 个 |
| 10 | Owner 只读行为保持 | ✅ `task_v2` + `SUCCEEDED`/`VERIFIED` |
| 11 | 非 Owner = 403 | ✅ `AI_OWNER_ONLY` |
| 12 | 未认证 = 401 | ✅ |
| 13 | SEC-R0 保持 | ✅ 4/4 |
| 14 | HC2 Legacy denylist 保持 | ✅ 7/7 |
| 15 | DB schema 未变 | ✅ 88 |
| 16 | costEngine 未变 | ✅ |
| 17 | 全部门禁 PASS | ✅ §4 |
| 18 | health/ready PASS | ✅ 本机与公网均 ready=true、runtime `154287dcba36` |
| 19 | 生产工作区干净 | ✅ `git status --porcelain` 为空 |

---

## 13. BLOCKERS

**无。**

### 观察（非阻断，供 Supervisor 知悉）

1. **远端命名**：票面写 `GitHub lowkeydan/pump-cost-accounting-system`，实际 `origin` 为
   `git@github.com:xinqixu0426-gmail/ai-pump.git`（历次票使用的 GitHub 权威远端），
   其 `ai-native/prod-canary-s2` HEAD 与票面 `EXPECTED_GITHUB_HEAD` **逐字符一致**，故不构成阻断。
2. **Owner 认证网关端口**：生产实际监听 `127.0.0.1:3104`（LaunchDaemon `org.pump.owner-authentication`）。
   验收脚本最初按 3010 探测（该端口属于另一进程）而得到 401，改指 3104 后取得真实 Owner 会话；
   这只是验收脚本定位问题，不涉及任何产品行为或开关。
3. **本报告未提交进仓库**：为保证退出标准 1（production == GitHub HEAD）在交付后依然成立，
   报告放在两个 checkout 之外；生产与开发工作区均保持干净。
4. **W2 未开始**：Chat UI 未接线、未新增写能力、未启用 worker，均按要求保持关闭。
