# SEC-R0-PROD-R1 交付报告（Supervisor 审阅用）

**Ticket:** SEC-R0-PROD-R1 — Align Production to GitHub Native Baseline, Rotate Compromised Secrets, and Close SEC-R0
**Branch:** `ai-native/prod-canary-s2`
**FROM_COMMIT:** `20755dd4d85d5e2a7f8efbd3209e036b4ca669cc`
**代码部署提交:** `6af1de7bf6e1710243deefe1772a62fcfcfe14ae`
**STATUS:** **PASS**

---

## 1. 部署结果（§1–§3）

| 项目 | 值 |
|---|---|
| 部署前生产 HEAD | `20755dd`（= 工单 CURRENT_PRODUCTION_HEAD） |
| 部署方式 | 权威流程的代码步骤：`git fetch` + `git pull --ff-only`（快进，无冲突、无 reset、无 cherry-pick、未涉及 Gitee 历史） |
| 部署后生产 HEAD | **`6af1de7`** |
| `PRODUCTION == GITHUB` | **YES** |
| 生产 worktree | **0 行**（干净） |
| 本地未推送提交 | 0 |
| `SECURITY_FIX_COMMIT ded46ab` | 已部署（祖先校验通过） |
| `EXPECTED_REMOTE_HEAD b9933f5` | 已部署（祖先校验通过） |
| 依赖变更 | `package.json` / lockfile **无变更** → 无需 `npm install` |
| 数据库迁移 | `api/database` **无变更** → 无新迁移（ready 报 migrations v88） |
| Web 侧 | `apps/web-next` 本批 **0 个文件变更** → 无需重建/重启 Web |

**关于 `b9933f5` 与 `6af1de7` 的一处差异（需 Supervisor 知悉）**：`origin` 当前 tip 为 `6af1de7` = `b9933f5` + **1 个 docs-only 提交**，即上一轮被要求产出的《SEC-R0-PROD blocked return》报告。生产已与 origin 完全一致；该提交不含任何代码/测试改动（工单 §1 亦明确"implementation 之上的 documentation-only 提交"属批准范围）。

---

## 2. 备份（§2）：PASS

- 部署前生产库为活库，按 §2 要求创建并校验**新的** release 备份：
  `backups/release/pump-release-2026-09-25T12-50-14-698Z.db`（47,128,576 bytes，`gitCommit=20755dd`、`schemaVersion=88`）
- `db:backup:verify --latest --type release` 通过
- 该新备份与既有 `pump-release-2026-09-25T12-21-41-469Z.db` 的 sha256 **完全一致** → 库内容在两次备份之间无实质变化（既有备份本就仍有效）
- **旧备份全部保留**，未覆盖、未删除

---

## 3. 凭据轮换（§5）：全部完成

| 变量 | 状态 | 长度 |
|---|---|---|
| `INTERNAL_SECRET` | **已轮换** | 64 hex |
| `INTERNAL_WRITE_SECRET` | **已配置**（此前生产**缺失**，本轮新增） | 64 hex |
| `ACCESS_PASSWORD` | **已轮换** | 48 hex |
| `PUMP_OWNER_ACCESS_PASSWORD` | **未改动** | ≥32（保持原值） |

- `.env` 中**三行以外每一行逐字节未变**（`unrelatedLinesChanged: []`），无重复键
- `INTERNAL_SECRET ≠ INTERNAL_WRITE_SECRET`；新 `ACCESS_PASSWORD ≠ PUMP_OWNER_ACCESS_PASSWORD`
- 原子写入（tmp + rename），权限保持 `600`；`.env` 仍被 Git 忽略；未提交、未进入任何 tracked 文件

**Owner 认证依赖判定（§5 要求只报结论）**：`api/services/ownerAuthentication.cjs` 的 `ownerConfigValid` 要求「`PUMP_OWNER_ACCESS_PASSWORD` 为 32–512 字符、`ACCESS_PASSWORD` 非空、且二者**必须不同**」。轮换前实测：`PUMP_OWNER_ACCESS_PASSWORD` 已配置且长度合规、与 `ACCESS_PASSWORD` 本就不同 ⇒ **只轮换 `ACCESS_PASSWORD` 不会改变 Owner 认证语义**。`PUMP_OWNER_ACCESS_PASSWORD` 也**不在**历史泄露集合内（历史扫描显示仍在使用中的泄露值仅 `INTERNAL_SECRET` 与 `ACCESS_PASSWORD`），故**未轮换**。

---

## 4. 重启（§6）

因本机 `sudo` 非免密，按 §6 要求**暂停并交回 ACTION_REQUIRED**（未使用 kill+KeepAlive 绕过）。用户执行：

```
sudo launchctl kickstart -k system/com.pumpfactory.api
```

重启后实测：旧 pid `85097` 已消失，新 pid `24207`，启动时间 `21:13:39` **晚于** `.env` 修改时间 `20:50:53`。

---

## 5. 验证结果

### §7 重启后基线：PASS
`/api/health` 200、`/api/health/ready` 200（`status=ready`、`migrations=88`、`gitCommit=6af1de7`、`pid=24207`）；生产 HEAD `6af1de7`；worktree 0 行。

### §8 旧凭据吊销（旧值仅本地 0600 保留，验证后已 `shred` 删除）
| 检查 | 结果 |
|---|---|
| 旧 `INTERNAL_SECRET` → 内部 GET | **401 REJECTED** |
| 旧 `INTERNAL_SECRET` → 业务 POST | **401 REJECTED**（未进入 mutation handler） |
| 旧 `ACCESS_PASSWORD` → 登录路径 | **401 REJECTED** |
| 新 `ACCESS_PASSWORD` → 登录路径 | **200 WORKS** |

### §9 新共享密钥 = 只读
| 检查 | 结果 |
|---|---|
| 仅新 `INTERNAL_SECRET` → 内部 GET | **200（授权）** |
| 仅新 `INTERNAL_SECRET` → 业务 POST | **403 `INTERNAL_WRITE_FORBIDDEN`（DENIED）** |

### §10 新写凭据边界（未产生任何生产业务数据）
| 检查 | 结果 |
|---|---|
| 新共享密钥 + 新写凭据 + **非法载荷**（空 model / 负价格） | **400 `PART_NAMING_REQUIRED`** —— 到达业务校验，**非 401、非 403** → AUTH_PASSED |
| 业务数据是否变化 | `parts 92→92`、`business_change_events 155→155`、`api_operations 1844→1844`、`audit_log 6810→6810`；canonical payload 38988→38988 字节 → **未产生任何记录，零非预期变更事件** |

### §11 Owner / 边界冒烟
| 检查 | 结果 |
|---|---|
| A. Owner 请求（迁移族「经营概况」） | 200，SSE 阶段 `task_v2`（Native 进入），**无 `canary_ineligible`（未回落 Legacy）**，goal `VERIFIED`，产出内容 |
| B. 已认证非 owner | **403 `AI_OWNER_ONLY`** |
| C. 仅 internal-secret 请求 `/api/ai/chat` | **403 `AI_OWNER_ONLY`**（未被升格为 Owner） |
| D. 未认证 | **401**（既有未授权行为） |
| E. `AI_NATIVE_WRITE_ENABLED` | **false** |

> 说明：普通（准入通过）的 Native 轮次只会发 `task_v2` 状态、不发 `native_owned`（后者仅用于"准入不满足但族已归属 Native"的兜底路径），因此 `nativeOwned=false` 属预期，**不代表**走了 Legacy —— 判据是 `task_v2 存在` + `canary_ineligible 不存在` + goal `VERIFIED`。

### §12 NATIVE-R1 四族生产只读冒烟（真实生产数据，Owner 身份）
| 族 | HTTP | Native 进入 | Legacy 回落 | goal | 内容 |
|---|---|---|---|---|---|
| 经营概况 / 看板 | 200 | `task_v2` | 无 | VERIFIED | 有 |
| 报价查询 | 200 | `task_v2` | 无 | VERIFIED | 有 |
| 业务变更记录 | 200 | `task_v2` | 无 | VERIFIED | 有 |
| 线圈目录查询（真实规格 12-120） | 200 | `task_v2` | 无 | VERIFIED | 有 |

### §13 审计身份：符合预期，未回写
- `OLD_INTERNAL_ACTOR`（历史）：`api_operations` **254**、`business_change_events` **15**、`audit_log` **303** —— 与轮换前完全一致，**保持不可变**
- `NEW_INTERNAL_ACTOR`：三项均 **0**（尚无内部自动化写入）
- 不存在其它 `internal:` actor（0）
- 未对 `api_operations` / `business_change_events` / `audit_log` 做任何写入或回填；未输出任何 actor 哈希

### §14 最终密钥安全
- 两次全仓 tracked 文件扫描：生产新密钥在**任一仓库中均不出现**（0 命中）
- `.env` 仍被 Git 忽略、权限 `600`；开发与生产 worktree 均 **0 行**
- `INTERNAL_SECRET ≠ INTERNAL_WRITE_SECRET`；长度 64 / 64 / 48
- 旧凭据全部被拒；验证期间**未改变任何生产业务记录**

### §15 生产健康终检
`/api/health` 200、`/api/health/ready` 200（ready、migrations 88、`gitCommit=6af1de7`、pid 24207）、Web `/login` 200、监听 `3000/3002/3104` 正常。
仓库更重的部署后冒烟（真实 AI 发布门禁、公网验收、MCP 全领域只读验收）**未对生产执行**，以避免写密集/外部依赖副作用；§17 要求的最小集合已全部覆盖。

---

## 6. 未做（合规）

未 force reset、未 merge Gitee 历史、未恢复历史本地改动、未 cherry-pick 单个文件、未手改数据库；未重写 Git 历史；未改应用代码、schema、costEngine；未扩 `AI_NATIVE_WRITE_ENABLED`；未使用旧泄露凭据做任何探测以外用途；未在任何输出中打印凭据值（旧值保留文件已 shred 删除，临时脚本已清理）。

**NATIVE-R3 未开始，等待 Supervisor 审核。**
