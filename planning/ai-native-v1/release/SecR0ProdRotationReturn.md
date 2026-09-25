# SEC-R0-PROD 交付报告（Supervisor 审阅用）

**Ticket:** SEC-R0-PROD — Production Secret Rotation and Final Containment Verification
**Branch:** `ai-native/prod-canary-s2`
**EXPECTED CODE COMMIT:** `ded46ab`
**STATUS:** **BLOCKED**（预检第 1 条不满足 + 缺少生产重启权限；**未做任何配置变更**）

---

## 1. 预检结果（§1，仅报告存在性，全程未打印任何值）

| 检查项 | 结果 |
|---|---|
| 生产仓库 HEAD | `20755dd4d85d5e2a7f8efbd3209e036b4ca669cc` |
| HEAD 是否包含 `ded46ab` | **NO** |
| HEAD 是否含 SEC-R0 收口代码 | **NO** |
| `.env` 存在 | **YES**（权限 `-rw-------`，已被 Git 忽略） |
| `INTERNAL_SECRET` 已配置 | **YES**（非空） |
| `INTERNAL_WRITE_SECRET` | **已声明但为空**（fail closed 默认姿态） |
| `ACCESS_PASSWORD` 已配置 | **YES**（非空） |
| `JWT_SECRET` / `PUMP_OWNER_ACCESS_PASSWORD` 已配置 | YES / YES |
| API `/api/health` | HTTP **200** |
| API `/api/health/ready` | HTTP **200** |
| Web `/login` | HTTP **200** |
| API pid / 启动时间 | `85097` / 2026-09-25 08:30:00 |
| `.env` mtime | 2026-09-24 18:38:07（本次预检**未修改**，size 2924 不变） |

**生产/release 备份（§1）：PASS** —— 已用仓库权威机制创建并校验：
- `backups/release/pump-release-2026-09-25T12-21-41-469Z.db`（47,128,576 bytes）
- `gitCommit=20755dd`、`schemaVersion=88`、`sha256` 已记录在 `.meta.json`，`db:backup:verify --latest --type release` 通过（含 audit_log 6808 / business_change_events 155 等表计数）

---

## 2. BLOCKER 1（决定性）：生产尚未包含 SEC-R0 收口代码

生产 HEAD `20755dd` **不包含** `ded46ab`。运行中的部署落后分支 **12 个提交**（含 NATIVE-R1、NATIVE-R2、SEC-R0）：

```
b9933f5 docs: SEC-R0 return record        ded46ab fix(security): SEC-R0 containment
4ba6cd7 docs: NATIVE-R2 return            e086543 fix(test): R2 fixture
7694f43 feat: NATIVE-R2 owner-only        …
be2c03f feat: NATIVE-R1 read cutover      …
```

源码级证据（生产目录实测）：

| 证据 | 结果 |
|---|---|
| `api.cjs` 引用 `internalWriteAuthorization` | **0** 处 |
| `api.cjs` 含 `INTERNAL_WRITE_FORBIDDEN` | **0** 处 |
| `api/services/internalWriteAuthorization.cjs` 存在 | **NO** |
| `internalApiClient.cjs` 发送 `x-internal-write-secret` | **0** 处 |

生产 `api.cjs:153-155` 仍是旧逻辑：命中共享密钥即 `return next()`（读写皆放行）。

**为什么这使本工单无法完成（而不是仅仅"顺序不同"）：**
- §6B 期望「新共享密钥单独发写请求 → 403 `INTERNAL_WRITE_FORBIDDEN`」。该响应码只存在于新代码；在**未部署的旧代码**上，同一请求会**通过认证并真正写入业务数据** —— 即用一次"验证"污染生产库，违反 §7 与 §11。
- §7 期望「带专用写凭据 → 通过认证并到达业务校验（400/422）」。旧代码**完全忽略**该请求头，因此无法区分"专用写授权生效"与"共享密钥单独放行"。
- §9 期望「非 owner AI → 403 `AI_OWNER_ONLY`」。该边界由 NATIVE-R2 引入，同样未部署；当前非 owner 仍会进入 Legacy runtime 出答案。

因此：**在部署包含 `ded46ab` 的提交之前，本工单的 §5–§9 验证无法在不破坏生产数据的前提下完成。**

---

## 3. BLOCKER 2：缺少生产重启权限

`sudo -n true` 失败 → **无免密 sudo**。§4 指定的权威重启机制 `sudo launchctl kickstart -k system/com.pumpfactory.api` 必须由你本人执行。
（技术上以 `dan` 身份向 pid 发信号、依赖 `KeepAlive` 也能重启，但那不是权威机制，且不能解决 BLOCKER 1，因此**未执行**。）

---

## 4. 本阶段实际执行/未执行清单

**已执行（只读或备份，无配置变更）：**
- 预检（§1）：部署提交、服务健康、`.env` 存在性与配置项存在性、sudo 可用性
- 生产/release 备份 + 校验（§1）
- 运行中配置一致性取证：进程启动（09-25 08:30）晚于 `.env` 修改（09-24 18:38），且 `.env` 之后未变 → **运行中的进程持有的就是该 `.env` 的值**
- 两个 clone 的工作树洁净性核对（均为 0 行）

**未执行（因 BLOCKER 1/2，且刻意不做半应用状态）：**
- §2 生成新凭据、§3 更新生产 `.env`、§4 重启
- §5 旧凭据吊销验证、§6 新共享密钥只读验证、§7 新写凭据验证、§8 ACCESS_PASSWORD 轮换验证
- §9 AI/Owner 冒烟（其中"非 owner → 403"在当前部署上必然失败）

**明确未做（合规红线）：**
- 未修改任何生产配置（`.env` mtime/size 复核不变）
- 未提交/未打印任何密钥值（`SECRETS_EXPOSED_IN_OUTPUT: NO`）
- **未使用**已泄露的旧凭据对生产发起任何请求（包括只读探测）——旧值仍被接受这一点由代码 + "进程启动晚于 .env 且 .env 未变"推定，无需实际使用该凭据
- 未重写历史、未 force-push、未改应用代码、未动数据库 schema/costEngine

---

## 5. 审计身份影响（§10，确认预期）

`commandRequest.commandActorKey` 与 `aiToolConfirmation.confirmationSubjectForRequest` 都以 `sha256(INTERNAL_SECRET)` 派生内部 actor 身份，因此轮换会**产生新的内部 actor 指纹**。这是**预期行为**：
- `OLD_INTERNAL_ACTOR`：仅历史记录（现存 `api_operations` 254 行、`business_change_events` 15 行、`audit_log` 303 行）
- `NEW_INTERNAL_ACTOR`：轮换后生效
- 历史审计行**保持不可变**，不做任何回填/重写（本次未输出任何指纹哈希，遵循既有安全惯例）

---

## 6. 推荐下一步（二选一，均需 Supervisor 决策）

**选项 A（最小安全面，推荐）**：从 `20755dd` 切一个安全发布提交，仅包含 SEC-R0 的收口改动（等价的 `ded46ab` 变更），**不带** NATIVE-R1/R2 的行为变更。然后重跑 SEC-R0-PROD：我可以一次完成"生成 → 写 `.env` → 你执行 `sudo launchctl kickstart`（或授权我以 KeepAlive 机制重启）→ §5–§9 全量验证 → 报告"。

**选项 B（最简单，但改变生产 AI 行为）**：直接把分支快进部署到生产（`origin/ai-native/prod-canary-s2` = `b9933f5`，包含 `ded46ab`，全部门禁已在同源提交上通过）。代价是同时上线 NATIVE-R1（4 个只读族转 Native 独家负责）与 NATIVE-R2（非 owner AI → 403 `AI_OWNER_ONLY`）。这属于产品行为变更，需你明确批准。

无论哪种：轮换时必须同时写入 `INTERNAL_WRITE_SECRET`（≥32 字符且与 `INTERNAL_SECRET` 不同），否则**MCP 写工具与 AI 确认写在新代码上会 fail closed**（当前旧代码上它们仍以共享密钥工作）。

**下一阶段（NATIVE-R3）未开始，等待 Supervisor 审核。**
