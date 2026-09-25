# SEC-R0 交付报告（Supervisor 审阅用）

**Ticket:** SEC-R0 — Contain Leaked Internal Secret and Close JWT Bypass on Write Routes
**Branch:** `ai-native/prod-canary-s2`
**START_COMMIT:** `e086543`
**实现提交:** `ded46ab`（代码/测试）
**STATUS:** **PASS**（唯一未完成项：生产密钥轮换，属需要用户执行的生产基础设施动作，见 §4）

---

## 1. 结论

公开泄露的 `INTERNAL_SECRET` **已不再具备任何业务写权限**：内部共享密钥现在只授权内部只读；任何业务写操作（POST/PUT/PATCH/DELETE）必须额外持有独立、窄范围的机器写凭据（`x-internal-write-secret`，来自 `INTERNAL_WRITE_SECRET`），且该凭据未配置/过短/与共享密钥相同时一律 fail closed。

---

## 2. Internal Secret 用途地图（§2）

| 路径 | 用途 | 读/写 | 变更前授权行为 | 变更后 |
|---|---|---|---|---|
| `api.cjs:150-160` | `/api` 认证中间件：命中 `x-internal-secret` 即跳过 JWT | 读写皆可 | **共享密钥单独即可写业务数据** | 仅授权只读；写需专用凭据，否则 403 `INTERNAL_WRITE_FORBIDDEN` |
| `api/routes/ai/internalApiClient.cjs:9` | AI/MCP 工具执行调用正式 REST API（唯一发送方） | 读写 | 发送共享密钥 | 读：共享密钥；写：额外发送专用写凭据 |
| `api/routes/ai/executor.cjs` → `executors/*` | AI 工具执行层（读 + 确认后写） | 读写 | 经 internalApiClient | 经 internalApiClient（同上） |
| `api/mcp/write.cjs` → `aiConfirmedAiTool`/`executeToolCall` | MCP 写工具（进程内调用，最终仍经 internalApiClient HTTP） | 写 | 共享密钥 | 需专用写凭据 |
| `api/services/commandRequest.cjs:16-17` | 由请求推导命令 actor/审计身份 | 写（审计） | `internal:<sha256(密钥)>` | **不变**（审计身份保持稳定） |
| `api/services/aiToolConfirmation.cjs:323-324` | 由请求推导确认主体（preview↔execute 绑定） | 写 | `internal:<hash>` | **不变**（确认绑定语义保持稳定） |
| `api/services/ontologyRelationCanaryEligibility.cjs:17` | canary 资格判定（owner 或内部密钥） | 读/AI | 计入 canary 资格 | 不变（但 NATIVE-R2 起不再能进入 AI chat 入口） |
| `api/routes/ai/{personalMemory,feedback,evaluations,prompt,conversations,tasks}.cjs` | 各 AI 端点的内部免认证分支 | 读/AI | 共享密钥放行 | 不变（这些端点不做业务写；tasks 另有 ownerMiddleware） |
| `api/services/runtimeConfig.cjs:307` | 只上报「是否已配置」布尔 | — | 已配置=true | 不变 |
| `api/services/environment.cjs:4,241` | 生产必需变量 / MCP token 互异校验 | — | — | 不变 |
| 测试与脚本 | fixture / 验收脚本发送共享密钥 | 读/写 | — | 已识别并处置（§6） |

---

## 3. 写绕过：变更前 / 变更后

- **变更前**：`api.cjs:155` 命中共享密钥即 `next()`，包括正式写路由。且 `parts.create`/`parts.update` 的能力声明为 `requiresConfirmation:false, supportsPreview:false`（`api/capabilities/registry.cjs:947,980`）→ **持有共享密钥即可无确认直写业务库**。
- **变更后**：同一路由上，仅共享密钥的写请求在**任何 handler 之前**被拒（403 `INTERNAL_WRITE_FORBIDDEN`）。

**WRITE_BYPASS_PRESENT_BEFORE:** YES
**WRITE_BYPASS_PRESENT_AFTER:** NO

---

## 4. 密钥轮换（§4）——需要用户执行

仓库历史扫描证明：**生产当前仍在使用的 `INTERNAL_SECRET` 与 `ACCESS_PASSWORD` 仍等于历史中已公开的值**（另：`JWT_SECRET`、DeepSeek 旧 key、阿里云 AK/SK、`SIRI_API_TOKEN` 已轮换）。开发环境 `.env` 的这三个值在本机重建时已重新生成，与生产不同，无需再轮换。

**因此生产轮换为 BLOCKED_USER_ACTION**（属生产基础设施变更，按规矩不由本阶段代执行；也不在此暴露任何值）：

1. 生成新值（本机执行，不要贴到任何地方）：
   `openssl rand -hex 32` → 新 `INTERNAL_SECRET`
   `openssl rand -hex 32` → 新 `INTERNAL_WRITE_SECRET`（必须与前者不同）
   另生成一个 ≥20 位的新 `ACCESS_PASSWORD`
2. 编辑 `/Users/dan/pump-cost-accounting-system/.env`：替换 `INTERNAL_SECRET`、`ACCESS_PASSWORD`，**新增** `INTERNAL_WRITE_SECRET=<新值>`（不设置则内部写保持 fail closed）
3. 重启生产 API 使其生效：`sudo launchctl kickstart -k system/com.pumpfactory.api`
4. 验证（不打印值）：用旧值发写请求应被拒（403/401）；用新共享密钥单独发写请求应 403 `INTERNAL_WRITE_FORBIDDEN`；同时带新专用写凭据应成功
5. `.env` 已被 gitignore；不要提交任何新值。Gitee 旧仓库**不得再视为密钥安全位置**

---

## 5. 仓库/历史扫描（§5）

| 扫描 | 结果 |
|---|---|
| 当前 tracked 文件 | **PASS** — 无真实凭据。命中项均为既有合成夹具；12 个不同 `sk-` 串与当前生产凭据**逐字节比对无一相同** |
| 新专用写凭据 | **PASS** — 仓库中只有变量名与**合成测试值**（`sec-r0-synthetic-…`、`deep-api-internal-write-secret-…`），无生产值 |
| 当前分支 GitHub 侧 `.env` | **不可读**（分支 tip HTTP 404） |
| Gitee 泄漏提交在 GitHub 侧 | **不可读**（HTTP 404）→ **GitHub 历史未包含 `.env`** |
| Git 历史（Gitee） | 🔴 仍含**当前生产在用**的 `INTERNAL_SECRET`（2 个版本）与 `ACCESS_PASSWORD`（1 个版本） |

**CURRENT_REPOSITORY_SECRET_SCAN:** PASS
**GITHUB_HISTORY_SECRET_EXPOSURE:** NO（两个分支 tip 与两个 Gitee 泄漏提交在 GitHub 均 404）
**GITEE_HISTORY:** TREATED_AS_COMPROMISED
未做任何历史重写 / force-push（§5 明确要求先轮换、且需用户批准）。

---

## 6. 合法内部调用方的识别与保持（§3 / §6F）

变更前逐一识别（全部经 `internalApiClient` 这一个发送方）：
- AI 工具执行（读 + 确认后写）— `ai/routes/ai/executor.cjs` → executors
- MCP 写工具（`MCP_WRITE_ENABLED=true`）— `api/mcp/write.cjs` → 同一执行层
- `test:deep-api` 隔离运行时执行 `sync_factory_knowledge` 等写工具
- 各验收脚本（benchmarks / shadow / synthetic / relation acceptance）——其中多个以共享密钥 POST `/api/ai/chat`；该入口自 **NATIVE-R2** 起已冻结为 Owner-only（本阶段之前既已如此），这些脚本需改用 Owner 凭据，与本阶段无关

处置：给**专用、窄范围**的写凭据（不是把共享密钥升格为 Owner JWT）。内部写自动化在配置了 `INTERNAL_WRITE_SECRET` 的环境继续工作；`.env.example` 已记录该变量（默认空）。测试隔离运行时已在 `scripts/run-deep-api-smoke.cjs` 显式配置合成凭据。

---

## 7. 授权测试（§6，真实 HTTP 路由）

`tests/secR0InternalWriteAuthorization.test.cjs`（启动真实 `api.cjs` + 独立临时数据库），**3/3 PASS**：

| 用例 | 请求 | 期望 | 结果 |
|---|---|---|---|
| A | 有效 Owner JWT cookie → `POST /api/parts` | 依既有业务规则放行 | 200 且 `success:true`，数据真正落库 |
| B | 仅 `x-internal-secret` → `POST /api/parts` | 业务写被拒 | **403 `INTERNAL_WRITE_FORBIDDEN`**，且业务数据中无该标记 |
| C | 已泄露/过期 internal secret → `POST` | 被拒 | 401，无数据 |
| D | 未认证 → `POST` | 被拒 | 401，无数据 |
| E | 已认证非 owner → `POST /api/ai/chat`（Owner-only） | 被拒 | 403 `AI_OWNER_ONLY` |
| F | 共享密钥 → `GET /api/parts` | 明确保留的内部只读 | 200 |
| G | 共享密钥 + 专用写凭据 → `POST` | 合法内部自动化保持可用 | 200 且数据落库 |
| 附加 | 写凭据 = 共享密钥 / 长度不足 | 必须无效（fail closed） | 403，无数据 |

核对方式：经 API 自身读回业务数据，确认被拒写入**没有产生任何业务数据**（不只看中间件返回值）。

---

## 8. 审计调查（§8）

- **能否识别历史内部密钥写入：能。** `api_operations.actor_key`、`business_change_events.actor_key`、`audit_log.user` 都记录 actor key；内部密钥通道的 actor key 形如 `internal:<sha256(INTERNAL_SECRET)>`，并可通过 `operation_id` 关联到 audit_log。
- **观测到的内部通道写入**（用当前生产密钥指纹精确匹配，不打印密钥）：
  - `api_operations`：**254** 行；`business_change_events`：**15** 行；`audit_log`：**303** 行
  - 且 `internal:` 前缀的行**全部**属于同一个 actor（即该共享密钥），无其它内部身份
  - 时间范围：`api_operations` 2026-08-04 → 2026-09-25；`business_change_events` 2026-08-23 → 2026-09-20
- **可疑写入：无法证明。** 合法自动化与滥用同一密钥产生**完全相同**的 actor key，因此从审计无法区分动机；时间分布与量级与常规自动化一致，但**不能据此断言未发生滥用**。
- **confidence: LOW**（对任何入侵结论）。本阶段**不推断**已发生事件，仅报告可证事实：这些写入**确实存在**且**可被识别为该通道**。

---

## 9. 门禁（`ded46ab`）

| 门禁 | 结果 |
|---|---|
| `npm test` | PASS — tests **3281** / pass **3281** / fail **0** |
| `verify:api-contract` | PASS |
| `test:deep-api` | PASS — passed **489** / failed **0** |
| `lint` | PASS |
| `build` | PASS |
| `verify:ai-native-release` | PASS |
| `test:ai-architecture` | PASS — 120 / 120 |
| security-specific（`tests/secR0InternalWriteAuthorization.test.cjs`） | PASS — **3 / 3** |

`AI_NATIVE_WRITE_ENABLED` 仍为 **false**；未改 DB schema；未改 costEngine；未改 Legacy；未引入新的宽泛绕过；Owner 认证行为与写确认/审计/回滚/变更历史全部保持。

---

## 10. Blockers

1. **生产轮换待用户执行**（§4 给了确切步骤）。在轮换前，泄露值仍能授权**读**（写已被封死）。
2. **生产内部写当前为 fail closed**：`INTERNAL_WRITE_SECRET` 尚未在生产 `.env` 配置，因此 MCP 写工具与 AI 确认写会返回 403 —— 这是刻意的安全姿态。要恢复内部写自动化，需按 §4 第 2 步配置该变量并重启。
3. 验收脚本若仍以共享密钥驱动 `/api/ai/chat`，需改用 Owner 凭据（NATIVE-R2 起即已如此，与本阶段无关）。

**下一阶段未开始，等待 Supervisor 审核。**
