# NATIVE-W1 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-W1 — Native Write V1：安全单能力零件库存调整（Safe Single-Capability Part Stock Adjustment）
**Branch:** `ai-native/prod-canary-s2`
**STATUS:** **PASS**
**日期:** 2026-09-26
**角色:** 单一实施 agent（本票无 detached worker，单步同步生命周期）

---

## 0. 基线 SHA（三处一致）

| 对象 | SHA |
|---|---|
| START_COMMIT（W1 起点 = NATIVE-W0 交付） | `0363f1ae1dc4e7a101a342894512807e26f5f580` |
| 本地 HEAD（交付版） | `ee2a10e79327e1657d74086bc6eb2d02f56f23c7` |
| GitHub `origin/ai-native/prod-canary-s2` | `ee2a10e79327e1657d74086bc6eb2d02f56f23c7` |
| 生产工作区 `git rev-parse HEAD` | `cb5be53e622292d4da0b9ce7906108e2fc69568b`（**未部署 W1**） |
| 生产 `/api/health/ready` → `runtime.gitCommit` | `cb5be53e6222`（生产仍在 HC2-PROD 版本） |

W1 提交链（4 个提交，全部在 origin 上）：

```
ee2a10e test(ai): NATIVE-W1 close three matrix gaps and refine the write gate order
4dd9e0f chore(ai): refresh the N7.3 closure artifact hashes for the NATIVE-W1 doc update
d360c0d fix(ai): NATIVE-W1 keep the write kill switch ahead of the owner gate
9af6721 feat(ai): NATIVE-W1 native write V1 -- safe single-capability part stock adjust
```

---

## 1. 唯一获批写能力与范围不变式

| 项 | 值 |
|---|---|
| 唯一获批 AI 工具 | `adjust_part_stock`（注册表 capabilityId `ai.adjust_part_stock`） |
| 唯一获批业务能力 | `inventory.parts.batch_adjust_stock` |
| 允许的动作 | 对**恰好一个**规范零件、按**用户显式给定**的非零整数数量调整库存 |
| 作用域模块 | `api/services/aiNativeWriteScope.cjs`（纯判定：不碰 DB、不调业务 API、无副作用） |
| 默认姿态 | **deny-by-default**：只有显式登记的工具可进入写链 |

**明确不在 W1 范围**（未被实现、且被拒绝）：线圈库存、价格批量、配方增删改、零件创建/修改、订单、
报价、删除、多零件批量、设置、行情同步、工作流、文件/知识。

能力面统计（实测，来自唯一能力注册表）：

| 指标 | 数量 |
|---|---|
| 业务能力总数 | 137 |
| 写/命令类能力 | 95 |
| **其中被 V1 拒绝** | **94** |
| 删除类能力（永不在白名单） | 17 |
| AI 工具总数 | 83 |

多目标请求（如「把 6202 和 6203 都加 100」）→ `409 NATIVE_WRITE_SINGLE_TARGET_REQUIRED`，
**不静默拆分**、不部分执行。

---

## 2. 完整流程链（实现映射）

| 步骤 | 落点 | 证据 |
|---|---|---|
| 1 意图分类 → 任务/工具 | 既有 Native 任务链 + 白名单 | W1-SCOPE-1 |
| 2 规范解析（canonical） | 既有 `preparePartStockAdjustment` 正式预检 | W1-LOOP-1 |
| 3 唯一目标 | 作用域层强制 `items.length === 1` | W1-SCOPE-3 |
| 4 正式预检 | `buildWriteConfirmation` 带出 `proposal` + `idempotencyKey` | W1-LOOP-1 |
| 5 冻结提案 | `spec.writeV1`（phase `PROPOSAL_READY`） | W1-LOOP-1 / W1-SPEC-1 |
| 6 持久化提案 | `spec_json` 复用（**无 schema 迁移**） | W1-SPEC-1 |
| 7 确认卡 | 唯一携带 token 的响应；token/预检上下文**不入任务数据** | W1-LOOP-1 |
| 8 Owner 批准 | Owner-only 门 + Owner 资格 | W1-AUTH-1/2/3 |
| 9 **批准事实先落盘** | `spec.writeV1.approval`（`CONFIRMED` + `WRITE_APPROVED`）发生在业务写之前 | W1-LOOP-1 |
| 10 Business API 写 | 既有 `inventory.parts.batch_adjust_stock`（未改动） | W1-E2E-2 |
| 11 持久化 `api_operations` | 既有 `UNIQUE(actor_key, capability_id, idempotency_key)` | W1-LOOP-2 |
| 12 重新读取零件 | 独立回读（目录重读） | W1-LOOP-1 / W1-RESTART-2 |
| 13 核验库存 | 冻结 `nextStock` 逐字段比对 | W1-LOOP-1 / W1-FAIL-5 |
| 14 `VERIFIED`/`SUCCEEDED` | goal `VERIFIED` + `writeV1.phase=VERIFIED` | W1-LOOP-1 |
| 15 最终答复 | `outcome{phase,verified,stock,operationId}` | W1-LOOP-1 / W1-E2E-2 |

---

## 3. 授权与身份（§3 / §5 / §9）

三层必须**同时**通过，且顺序固定（全局 kill switch → Owner 身份 → 完整 rollout）：

| 层 | 规则 | 错误码 |
|---|---|---|
| 1 全局写开关 | `AI_NATIVE_WRITE_ENABLED` 生产默认 `false`；未开放时**任何身份**（Owner / 非 Owner JWT / 内部凭据）都是 | `403 AI_NATIVE_WRITE_DISABLED` |
| 2 Owner 身份门 | 必须是规范 Owner 凭据（`authn=owner_credential_v1`）；非 Owner JWT、`x-internal-secret`、`x-internal-write-secret`、未认证都不构成批准 | `403 NATIVE_WRITE_OWNER_REQUIRED`（未认证为 401） |
| 3 完整 rollout | `AI_NATIVE_MODE=owner` ∧ Owner 资格 ∧ 写开关 | `403 AI_NATIVE_WRITE_DISABLED` |

- `write-execute` 与 `write-reconcile` 受**同一个** rollout 授权（同一中间件 + handler 内同源校验）。
- **`INTERNAL_WRITE_SECRET` 未被用作 Owner 授权**：见 W1-AUTH-3。
- 批准事实中的 `ownerSubject` 只存 `sha256(subject)`（64-hex），任务数据不落任何 token/凭据。

---

## 4. 对账策略（§14 / §15）与终局约束

| 正式 operation 观测 | 结论 | 终局 |
|---|---|---|
| `COMPLETED` | 仍需**独立回读核验** `nextStock` 才算成功 | `SUCCEEDED` / `VERIFIED`；核验失败 → `FAILED_SAFE` |
| `MISSING` | 安全失败并要求重新确认（`reconfirmRequired`），**不重发** | `FAILED` / `FAILED_SAFE`（`OPERATION_MISSING`） |
| `PENDING` | **有界**等待（`RECONCILE_MAX_ATTEMPTS=5`、`RECONCILE_MAX_ELAPSED_MS=10min`） | 超界 → `FAILED_SAFE` / `manualReviewRequired`（`RECONCILIATION_BOUND_EXCEEDED`） |
| `AMBIGUOUS` | 安全失败 + 人工核对 | `FAILED` / `manualReviewRequired`（`OPERATION_AMBIGUOUS`） |

- `RECONCILING` 有**终局出口**（契约新增自转移 + `FAILED`/`PARTIAL` 出口），任务不会永久停留在 `RECONCILING`。
- 任何路径都**不得**更换幂等键重试、不得自动重发写入、不得推断成功；所有对账用例都实测 `writes === 1`。
- 有在途 `COMMAND` step（`RUNNING`/`UNKNOWN_EFFECT`）时禁止重新预览（`409 TASK_WRITE_INFLIGHT`），在途写入不被新提案覆盖。

---

## 5. §28 行为矩阵（40 行）→ 证据映射

测试文件：`tests/nativeW1PartStockWrite.test.cjs`（19）、`tests/nativeW1PartStockHttpE2E.test.cjs`（5）、
`tests/aiTaskWriteBridgeV2.test.cjs`（7）。**24 个专用 W1 用例全部通过**。

| # | 要求 | 证据 |
|---|---|---|
| 1 | 恰好一个获批能力，且与注册表一致 | W1-SCOPE-1 |
| 2 | 注册表写能力远多于 1，白名单必须显式收敛 | W1-SCOPE-1 |
| 3 | 其余写能力（94 个）一律拒绝 | W1-SCOPE-2 |
| 4 | 删除类（17 个）永不在白名单 | W1-SCOPE-2 |
| 5 | 线圈库存能力不开放 | W1-SCOPE-3, W1-SCOPE-4 |
| 6 | 价格批量能力不开放 | W1-SCOPE-4 |
| 7 | 配方修改能力不开放 | W1-SCOPE-4 |
| 8 | 零件删除不开放 | W1-SCOPE-4 |
| 9 | 多目标 → 409，不静默拆分 | W1-SCOPE-3, W1-SCOPE-4 |
| 10 | 空目标数组同样拒绝 | W1-SCOPE-3 |
| 11 | 缺数量 → `NATIVE_WRITE_QUANTITY_INVALID` | W1-SCOPE-3 |
| 12 | 数量为 0 → 拒绝 | W1-SCOPE-3 |
| 13 | 非整数数量（1.5）→ 拒绝 | W1-SCOPE-3 |
| 14 | 缺目标型号 → `NATIVE_WRITE_TARGET_MODEL_REQUIRED` | W1-SCOPE-3 |
| 15 | 未登记工具 → `NATIVE_WRITE_CAPABILITY_UNSUPPORTED` | W1-SCOPE-3 |
| 16 | 请求体不能自行提权（含 `allowWrite:true`） | aiTaskRoutesV2 `N7.1` |
| 17 | 生产默认（flag false）三端点全部 `WRITE_DISABLED` | W1-AUTH-2, W1-E2E-1 |
| 18 | kill switch 在任何任务改动前生效（steps = 0） | aiTaskRoutesV2 `N7.1` |
| 19 | 非 Owner JWT 不能预览/执行/对账 | W1-AUTH-1, W1-E2E-5 |
| 20 | `x-internal-secret` 不能批准 | W1-AUTH-1, W1-E2E-5 |
| 21 | `x-internal-write-secret` 不构成 Owner 批准（SEC-R0） | W1-AUTH-3 |
| 22 | 未认证 → 401 | W1-AUTH-1, W1-E2E-5 |
| 23 | 对账与执行同受一个 rollout 授权 | W1-AUTH-2（三端点一致）+ 路由结构 |
| 24 | 规范解析出唯一目标（partId + model） | W1-LOOP-1 |
| 25 | 正式预检产出结构化提案事实 | W1-LOOP-1 |
| 26 | 提案冻结持久化（`PROPOSAL_READY`） | W1-LOOP-1 |
| 27 | `proposalHash`/`argsHash` 为 64-hex | W1-LOOP-1, W1-SPEC-1 |
| 28 | 确认卡 token / 预检上下文不入任务数据 | W1-LOOP-1, W1-SPEC-1 |
| 29 | 任务进入 `WAITING_APPROVAL` | W1-LOOP-1 |
| 30 | Owner 批准事实先于业务写落盘 | W1-LOOP-1（`approval` + `WRITE_APPROVED`） |
| 31 | 批准事实与冻结提案强绑定（hash/partId/idempotencyKey） | W1-LOOP-1, W1-SPEC-1 |
| 32 | 恰好一次业务写 | W1-LOOP-1, W1-E2E-2 |
| 33 | 重复提交/双击不二次调整（幂等回放） | W1-LOOP-2, W1-E2E-2 |
| 34 | 批准后篡改参数/目标 → 拒绝、零写 | W1-LOOP-3 |
| 35 | 在途写入时禁止重新预览覆盖 | W1-LOOP-4 |
| 36 | 写后独立回读核验（目录重读 + 逐字段） | W1-LOOP-1, W1-RESTART-2, W1-E2E-2 |
| 37 | 核验通过才 `VERIFIED`/`SUCCEEDED` | W1-LOOP-1 |
| 38 | 回读缺失/不一致 → 绝不声称成功 | W1-FAIL-5 |
| 39 | 业务明确拒绝（版本漂移 409）→ 安全失败 | W1-FAIL-1, W1-E2E-3 |
| 40 | 结果未知 → `RECONCILING`；MISSING → 安全失败 + 重新确认；PENDING 有界终止；AMBIGUOUS → 人工复核；COMPLETED → 回读后成功；重启后恢复 | W1-FAIL-2/3/4, W1-RESTART-1/2, W1-E2E-4 |

---

## 6. 门禁证据（在干净提交 `ee2a10e` 上运行）

日志：`.dev-local/logs/rework-gates-w1r3-20260926T164155.log`（`status=` 为空 = 工作区干净）

| 门禁 | 结果 |
|---|---|
| `secR0-targeted` | ✅ exit 0（4/4） |
| `hc1-full`（7 个 Native 回归套件） | ✅ exit 0（90/90） |
| `verify:api-contract` | ✅ exit 0（**28/28**，含「Express 路由 ↔ api-reference 双向唯一对应」） |
| `npm test` | ✅ exit 0（**2289/2289**，含 24 个 W1 专用用例） |
| `test:deep-api` | ✅ exit 0（**passed 489 / failed 0**） |
| `lint` | ✅ exit 0 |
| `build` | ✅ exit 0 |
| `test:ai-architecture` | ✅ exit 0（9/9） |
| `verify:ai-native-release` | ✅ exit 0（`status PASS`、`STRUCTURALLY_READY`、`READY_WITHIN_SUPPORTED_SCOPE`、`sourceDirty false`、12/12 质量判据 PASS） |

真实进程 E2E（隔离临时 DB + 真实 `api.cjs` + 真实业务 API，`tests/nativeW1PartStockHttpE2E.test.cjs`）：

| 用例 | 实测 |
|---|---|
| W1-E2E-1 | 生产默认 flag=false：三端点全 `WRITE_DISABLED`，库存零变化 |
| W1-E2E-2 | 真实闭环：预览 → Owner 批准 → 写一次 → 回读 → `SUCCEEDED`；重复提交不再调整 |
| W1-E2E-3 | 批准后目标版本漂移 → `409 resource_version_conflict`，零写入、任务安全失败 |
| W1-E2E-4 | 重启：未批准卡失效（不写），重新预览后正常完成；已提交写入经对账 + 回读确认 |
| W1-E2E-5 | HTTP 层边界：非 Owner / 内部凭据 / 未认证都不能批准，零写入 |

---

## 7. 未变更证明

| 约束 | 结果 |
|---|---|
| 无 DB schema 变更 | ✅ 无迁移文件改动；`spec_json` 复用（`writeV1` 走既有列）；W1-SPEC-1 证明只做结构校验 |
| 无 `costEngine` 变更 | ✅ `api/services/costEngine.cjs` 未在改动清单内 |
| 无 Business API 变更 | ✅ `/api/parts` 路由、`inventoryCommands.cjs`、`partsService` 均未改动 |
| 无 `shared/**`/工具链变更 | ✅ 未改动 |
| 无 detached worker 引入 | ✅ `api/services/aiTaskWorkerV2.cjs` 未改动，`TASK_WORKER_DEFAULT_ENABLED = false` 保持 |
| 生产开关 | ✅ `AI_NATIVE_WRITE_ENABLED=false`（`.env` 第 57 行）、`AI_NATIVE_MODE=owner` 均未改 |
| 未部署 | ✅ 生产 HEAD 仍为 `cb5be53e`，runtime `cb5be53e6222`，ready=true，工作区干净 |
| 工作区干净 / 已推送 | ✅ `git status --short` 为空；`origin/ai-native/prod-canary-s2 == ee2a10e` |

改动清单（13 个文件，`+1719 / -118`）：

```
api/routes/ai/executor.cjs               api/routes/ai/tasks.cjs
api/services/aiNativeWriteScope.cjs      api/services/aiPartExecution.cjs
api/services/aiTaskContractV2.cjs        api/services/aiTaskStoreV2.cjs
api/services/aiTaskWriteBridgeV2.cjs     tests/aiTaskWriteBridgeV2.test.cjs
tests/nativeW1PartStockWrite.test.cjs    tests/nativeW1PartStockHttpE2E.test.cjs
docs/api-reference.md                    docs/ai-native-v1-handoff.md
planning/ai-native-v1/release/N7.3-closure-validation.json  （证据哈希刷新）
```

---

## 8. 文档同步

| 文档 | 更新 |
|---|---|
| `docs/api-reference.md` | 三个写端点的当前契约：唯能力白名单、单目标/数量校验、Owner-only 批准、批准先落盘、写后回读核验、对账有界终止与安全失败；保留 N6.1/N6.2 出处 |
| `docs/ai-native-v1-handoff.md` | 「当前事实」增加 NATIVE-W1 单能力写说明（含**生产仍 false / 未部署**）；修正写端点源码行号 |
| `planning/ai-native-v1/release/N7.3-closure-validation.json` | 按既有机制刷新 2 个被证据绑定工件的 canonical sha256（新增 `nativeW1RefreshNote` 说明），历史基线与 ReleaseEvidenceV1 载荷未动 |

---

## 9. 退出标准核对

| # | 标准 | 结果 |
|---|---|---|
| 1 | 只有**一个**获批写能力 | ✅ `adjust_part_stock` / `inventory.parts.batch_adjust_stock` |
| 2 | 恰好一个零件、用户显式数量 | ✅ W1-SCOPE-3、W1-LOOP-1 |
| 3 | 多目标请求拒绝且不拆分 | ✅ W1-SCOPE-3/4 |
| 4 | 线圈/价格/配方/订单/报价/删除/设置/行情全部拒绝 | ✅ W1-SCOPE-2/4（94 个写能力被拒） |
| 5 | 未扩大范围 | ✅ 未新增任何写能力或路由；改动限于写链 |
| 6 | 无 detached worker | ✅ W1-RESTART 语义与既有 worker 配置均未变 |
| 7 | 写路径（execute 与 reconcile）共用同一 rollout 门 | ✅ 同中间件 + 同源 handler 校验 |
| 8 | 生产保持 `AI_NATIVE_WRITE_ENABLED=false` | ✅ 实测 |
| 9 | 未把 `INTERNAL_WRITE_SECRET` 当 Owner 授权 | ✅ W1-AUTH-3 |
| 10 | `write-execute` 与 `write-reconcile` 同一 rollout 门 | ✅ 代码 + W1-AUTH-2 |
| 11 | 批准前必须 Owner 确认、批准事实先落盘 | ✅ W1-LOOP-1 |
| 12 | 写后独立回读核验才可声明成功 | ✅ W1-LOOP-1/5、W1-RESTART-2 |
| 13 | 对账策略与有界终局 | ✅ W1-FAIL-2/3/4 |
| 14 | 重启语义安全 | ✅ W1-RESTART-1/2、W1-E2E-4 |
| 15 | 40 行矩阵有专用测试覆盖 | ✅ §28 表（24 个专用用例） |
| 16 | 全部门禁 PASS | ✅ 9/9 |
| 17 | 无 schema / costEngine / Business API 变更 | ✅ §7 |
| 18 | 工作区干净、已推送 GitHub | ✅ `ee2a10e` |
| 19 | **未部署**、生产 flag false | ✅ §7 |

---

## 10. BLOCKERS

**无。**

### 已知边界（非阻断，留给后续票）

1. **W2 前端接线未做**：W1 只交付 Native 写后端链路（预检/批准/执行/对账是既有的 AI 任务端点）。
   Chat UI 上把「写意图 → 确认卡 → Owner 批准」串起来属于 W2 范围，本票未触碰 `apps/web-next`。
2. **W0 的零抽取结论保持**：Native 已有金额/呈现/证据/校验的等价实现，本票未从 Legacy 抽取任何逻辑。
3. 生产中 N6 写端点仍按 HC2 版本行为存在，但因为 `AI_NATIVE_WRITE_ENABLED=false`，实测一律
   `WRITE_DISABLED`，零业务写入。
