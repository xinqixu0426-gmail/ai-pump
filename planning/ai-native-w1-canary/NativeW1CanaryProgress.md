# NATIVE-W1-CANARY 进度报告（等 Owner 执行第一笔真实写入）

**Ticket:** NATIVE-W1-CANARY — Owner Production Canary / First Real Native AI Write
**Branch:** `ai-native/prod-canary-s2`
**状态:** **等待 Owner 人工执行（ACTION_REQUIRED）** — 自动化部分已全部完成，未由 Codex 提交任何生产写入。

---

## 1. §2 前置检查（全部实测，全部 PASS）

| 检查 | 结果 |
|---|---|
| GitHub HEAD == 生产工作区 HEAD | ✅ `a8efa83d0c6e29c05f437c731e3312cf2b515c4e` |
| API runtime == 同一提交 | ✅ `a8efa83d0c6e` |
| Web W2 构建生效 | ✅ BUILD_ID `2T9AVCKUa7m64Zq5Vp78x`；运行中的 Web 实际下发的 chunk 含 W2 标记 |
| 工作区干净 | ✅ `git status --porcelain` 为空 |
| health / ready | ✅ 200 / ready=true |
| DB schema | ✅ 88 |
| `AI_NATIVE_MODE` | ✅ `owner` |
| `AI_NATIVE_WRITE_ENABLED`（启用前） | ✅ `false` |
| `INTERNAL_WRITE_SECRET` 已配置且互异 | ✅ 64 字符、与 `INTERNAL_SECRET`/`ACCESS_PASSWORD` 互异（只输出长度与布尔） |
| Native Write 白名单能力数 | ✅ **恰好 1**（`inventory.parts.batch_adjust_stock`）；其余 **94** 个写/命令能力被拒 |
| DELETE 允许数 | ✅ **0**（17 个删除类能力全部拒绝） |
| detached worker | ✅ 关闭（`TASK_WORKER_DEFAULT_ENABLED = false`） |
| Legacy denylist | ✅ 7/7 PASS |

---

## 2. §3 备份

| 项 | 值 |
|---|---|
| 机制 | 权威发布备份 `db:backup:release` + `db:backup:verify` |
| 路径 | `/Users/dan/pump-cost-accounting-system/backups/release/pump-release-2026-09-26T15-13-34-301Z.db` |
| source commit | `a8efa83d0c6e29c05f437c731e3312cf2b515c4e` |
| sha256 | `60798cab7051eb1f056d05f512635a0a0b8c6bf55d1864468a0be0ed066b7465` |
| schema | userVersion 88 / migrationCount 88 |
| 校验 | ✅ `success: true`，sha256 与创建时一致，`parts 92 / coils 14` |
| `.env` 备份 | `.env.bak-before-canary-20260926T231413`（mode 600） |

---

## 3. §4 回滚/急停程序（启用前已建立并验证）

脚本：`/Users/dan/w1-canary/canary-rollback.sh`（幂等，**无需 sudo**，不打印任何密钥值）：

```
[1/4] sed 把 AI_NATIVE_WRITE_ENABLED 置回 false（并校验确实为 false）
[2/4] /bin/launchctl kickstart -k system/com.pumpfactory.api
[3/4] 轮询 /api/health/ready 直到 200（最多 30s）
[4/4] 运行 node /Users/dan/w1-canary/canary-verify-disabled.cjs
```

**启用前已验证**：
- `launchctl print system/com.pumpfactory.api` 存在、kickstart 无需 sudo（本票 §6 重启即用同一机制）；
- 回滚目标状态（Owner 写意图 → `WRITE_DISABLED`，无提案、无 token）在启用前实测为真：

```json
{"ownerLogin":200,"chatStatus":200,"state":"WRITE_DISABLED",
 "writeProposalEvent":false,"confirmationToken":false,"WRITE_DISABLED_CONFIRMED":true}
```

---

## 4. §5 只启用全局 W1 开关

| 项 | 结果 |
|---|---|
| 变更 | `AI_NATIVE_WRITE_ENABLED=false` → **`true`**（唯一一行） |
| `.env` diff | `removed_lines=1 added_lines=1`，且只有 `AI_NATIVE_WRITE_ENABLED`（值已掩码） |
| 其它受保护键 | `AI_NATIVE_MODE` / `TASK_WORKER_DEFAULT_ENABLED` / `INTERNAL_SECRET` / `INTERNAL_WRITE_SECRET` / `ACCESS_PASSWORD` / `JWT_SECRET` / `PUMP_OWNER_SUBJECT` **逐字节未变** |
| 白名单/worker/凭据 | 未改动 |

## 5. §6 重启与生效验证

| 检查 | 结果 |
|---|---|
| 重启机制 | ✅ `launchctl kickstart -k system/com.pumpfactory.api`（pid 27446 → 28446，startedAt 15:14:30Z） |
| health / ready | ✅ 200 / ready=true |
| runtime commit | ✅ `a8efa83d0c6e`（未变） |
| 工作区 HEAD | ✅ `a8efa83`（未变） |
| Web | ✅ `/ai` 200、`/login` 200 |
| 开关已生效（**无副作用证据**） | ✅ API 自身启动日志：`[AI Native] mode=owner authority=owner-scoped-native writeEnabled=true`（此前各次启动为 `writeEnabled=false`） |

## 6. §7 写入范围证明（未执行任何被拒能力）

- **静态**：白名单恰好 1 个；被拒 94 个；删除类允许 0 个。
- **dispatcher 分支**：`AI_NATIVE_WRITE_ENABLED=false` → `WRITE_DISABLED`；开关打开且能力 ≠ 唯一白名单 → `WRITE_UNSUPPORTED`（`api/services/aiDispatcherV3.cjs:193-196`）。
- **隔离运行时的既有证据**（在**同一提交** `a8efa83`、启用前采集的发布门禁）：线圈库存 / 零件调价 / 删除 → `WRITE_UNSUPPORTED`；缺数量、目标不存在、目标歧义 → 澄清；只有单零件库存调整产生提案。

## 7. §9 CANARY 基线（只读）

| 项 | 值 |
|---|---|
| canonical 目标 | `轴承-202`（id **150**，类别 轴承，供应商 万佳轴承，单价 ¥1.2） |
| 型号唯一性 | ✅ `matches=1`（解析不会歧义） |
| 基线库存 | **200** |
| 版本 | `updated_at = 2026-09-20T02:53:58.752Z` |
| 该能力 operation 基线 | 已完成 **3** 条（全部 `actor_key=internal:30fe890f…`，即业务页面/接口的人工历史，非 AI） |
| ai_tasks 基线 | **0** |
| business_change_events 基线 | 155 |
| 其它表指纹 | parts `8c2b856b…`、coils `2c8225a8…`、recipes 3 / orders 1 / quotations 1 |
| 请求的 delta | **+1**（预期写入后库存 = **201**） |

---

## 8. 待 Owner 执行（§10 ACTION_REQUIRED）

见对话中的 ACTION_REQUIRED 指令。**Codex 不会代替 Owner 点击确认，也不会自行发起任何生产写入。**

## 9. 失败政策（§14，已就绪）

若出现任一项（提案零件/库存/delta/调整后库存不符、卡片缺失、未确认即写入、重复调整、
回读不符、任务未 VERIFIED、无法解释的 operation 重复、UI 谎报成功、任何非 W1 能力变为可执行、
授权异常）→ 立即执行 §3 的回滚脚本（关开关 + 重启 + 验证 `WRITE_DISABLED`），保留证据，
**不做任何自动补偿写入**，并返回 REWORK/BLOCKED。
