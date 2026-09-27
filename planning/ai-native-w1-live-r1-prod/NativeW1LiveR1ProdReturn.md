# NATIVE-W1-LIVE-R1-PROD 交付报告（Supervisor 审阅用）

**Ticket:** NATIVE-W1-LIVE-R1-PROD — Deploy First-Use Word-Order Fix While Keeping Single Native Write Capability Live
**Branch:** `ai-native/prod-canary-s2`
**STATUS:** **PASS**
**日期:** 2026-09-27
**报告位置:** 两个 git checkout 之外（`planning/ai-native-w1-live-r1-prod/`）

---

## 0. SHA 与一致性

| 对象 | 值 |
|---|---|
| 批准修复提交（EXPECTED_FIX_COMMIT） | `1952d6c63b835f21ee424bf68aca64c7cbfe7291` |
| **GitHub HEAD（实际部署）** | **`437662df330033e772efbc1d942b65c8309bdee4`** |
| 生产工作区 HEAD | `437662df330033e772efbc1d942b65c8309bdee4` |
| API runtime | `437662df3300`（startedAt 2026-09-27T00:12:31.769Z） |
| 部署前生产 HEAD | `a8efa83d0c6e29c05f437c731e3312cf2b515c4e` |
| Web | `/ai` 200（本次未改前端） |

`RUNTIME == WORKTREE == GITHUB` = **YES**；工作区干净。

**关于比批准提交多出的 1 个提交（必须说明）**：第一次部署在 [4/9] 门禁处**如实中止**（未重启），
原因是 `W1-LOOP-4` 失败；根因是**我自己用例里的会话隐患**（详见 §6），修复只改了两个测试文件：

```
1952d6c..437662d  →  tests/nativeW1PartStockHttpE2E.test.cjs | 7 +++++-
                     tests/nativeW1PartStockWrite.test.cjs   | 12 +++++++++++-
（无任何产品代码改动：git diff --name-only | grep -v '^tests/' = 空）
```

产品侧改动与批准范围完全一致：仅 `api/services/aiProtectedCommandRoute.cjs`（词序边界修复）
与 `api/services/aiNativeWriteChatBridgeV2.cjs`（失败文案回显 + 失败原因持久化）。

## 1. §1 前置检查（实测）

| 检查 | 结果 |
|---|---|
| 修复提交是 GitHub HEAD 祖先 | ✅ |
| 生产 HEAD 是 GitHub HEAD 祖先 / 可快进 | ✅（2 个提交） |
| 生产工作区干净 | ✅ |
| API / Web 健康 | ✅ 200 / 200 / 200 |
| `AI_NATIVE_WRITE_ENABLED` | ✅ `true` |
| `AI_NATIVE_MODE` | ✅ `owner` |
| Native Write 能力总数 | ✅ **1**（`inventory.parts.batch_adjust_stock`）；被拒 94 |
| DELETE 允许数 / worker / Legacy | ✅ 0 / 关闭 / ABSENT |

## 2. §2 待处理写任务安全检查（重启前，两次部署前都查过）

```
id 1  ddf5384b…  FAILED   （首用安全失败，无 writeV1）
id 2  ef6f9d79…  SUCCEEDED（canary，writeV1.phase=VERIFIED）
active/unresolved W1 tasks = 0
open COMMAND steps (RUNNING/UNKNOWN_EFFECT/PLANNED) = 0
```
→ **不存在未决提案**，重启不会打断任何 Owner 确认卡。

## 3. §3 备份

| 项 | 值 |
|---|---|
| 路径 | `/Users/dan/pump-cost-accounting-system/backups/release/pump-release-2026-09-27T00-08-35-302Z.db` |
| source commit / schema | `a8efa83…` / 88（88/88） |
| sha256 / 校验 | `05b16f9970190873ba855c262a9939d6201c4418ce647f0f0b6a3c8484121750` / ✅ `success:true` |
| 启动备份 | [6/9] 另验证：`gitCommit = 437662df330033e772efbc1d942b65c8309bdee4` |

## 4. §4 变更范围审计（`a8efa83..437662d`）

包含：词序目标抽取修复、失败文案回显、失败原因持久化、回归测试（`nativeW1LiveR1PhraseOrder` 等）、
测试会话复用修正。**不包含**（逐项 grep 通过）：Business API、DB 迁移/schema、costEngine、
第二个写能力、白名单扩张（`aiNativeWriteScope.cjs` 未改动）、DELETE 开放、worker 启用、Legacy 恢复。

## 5. §5/§6 发布门禁与部署

`PUMP_DEPLOY_BRANCH=ai-native/prod-canary-s2 zsh scripts/deploy-macmini-release.sh`
（第二次执行，用时 **90 秒**，[1/9]–[9/9] 全绿）：`发布完成：commit 437662df3300`。
门禁文件 `logs/release-code-gate-437662d….json = {"status":"passed"}`。

| 门禁 | 结果 |
|---|---|
| `npm test` | ✅ **2333/2333** |
| `verify:api-contract` | ✅ 28/28 |
| `test:deep-api` | ✅ 489 passed / 0 failed |
| `lint` / `build` | ✅ PASS / PASS |
| `test:ai-architecture` | ✅ 9/9 |
| `verify:ai-native-release` | ✅ `status PASS`、`STRUCTURALLY_READY` |
| `verify:prod-env` | ✅ 通过 |
| W1-LIVE-R1 / W1.5 / W1 / W2 | ✅ 5 / 16 / 24 / 18 |
| SEC-R0 / HC2 denylist | ✅ 4 / 7 |

重启：`launchctl kickstart -k system/com.pumpfactory.{api,web}`（无需 sudo，未用 kill+KeepAlive）。
重启后：runtime `437662df3300` == worktree `437662d` == origin `437662d`；`AI_NATIVE_WRITE_ENABLED=true`。

## 6. 第一次部署中止的如实说明（非产品缺陷）

生产 checkout 在 [2/9] 已被快进到 `1952d6c`，但 [4/9] 门禁失败 → **脚本按设计在重启前中止**
（API 仍运行 `a8efa83` 的旧代码，服务健康、开关仍 true）。失败项：

```
✖ W1-LOOP-4 … expected 'RECONCILING' actual 'WAITING_APPROVAL'
```

根因：W1 用例中的 `ownerCookie()` **每次请求都签发新 JWT**，而 `iat` 以秒计——同秒内两次签发
完全相同，跨秒则变成**两个登录会话**。确认凭证绑定登录会话，于是预览签发的确认卡在执行时被
服务端**正确地**拒绝（`confirmation_subject_mismatch`），任务因此停在 `WAITING_APPROVAL`。
已实测确认：相隔 >1s 的两个 token 与派生 subject 确实不同。

修复：两个 W1 用例文件复用同一个 Owner 会话（真实浏览器行为）。修复后
W1 路由 24/24 + W1 E2E 6/6 + W1.5 E2E 7/7 + W2 E2E 5/5 = 36/36，连续三轮全绿。

## 7. §7 生产词序验收（**未执行任何写入**）

用 Owner 身份、在新建的隔离会话中（真实持久化消息 → SSE）：

| 项 | 实测 |
|---|---|
| 测试短语 | **「将轴承-202增加1库存」**（「库存」在句尾） |
| SSE 阶段 / detail | `native_write_proposal` / **`WRITE_PROPOSAL_READY`** |
| 抽取目标 | **`轴承-202`**（不再吞掉「增加1」） |
| 抽取增量 | **+1** |
| canonical 目标 | partId **150** |
| 基线库存（canonical 生产值） | **201** |
| 提案 currentStock / nextStock | **201** / **202**（= 201 + 1） |
| 结构化提案事件 | ✅ 存在（`write_proposal`） |
| 确认身份 | ✅ 存在（`confirmationToken`） |
| 任务 | `d4f962b8-…`，state **`WAITING_APPROVAL`**，revision 5 |
| **write-execute 调用** | **未调用**（明确不执行） |
| 卡片状态 | 未消费，按设计安全过期 |

## 8. §8 原始非规范写法（仅记录，未据此改代码）

| 项 | 实测 |
|---|---|
| 短语 | 「将轴承202增加1库存」（`轴承202` 少一个连字符） |
| 结果 | `WRITE_CLARIFICATION_REQUIRED` + `part_stock_target_not_found` |
| 提案 / token | 均无（不会出卡片） |
| 用户可见文案 | **「没有找到型号为「轴承202」的零件，请确认准确型号后再试。」**（本票新增的回显生效） |
| 是否绑定到 轴承-202 | **否**——没有模糊匹配、没有静默绑定，未加任何解析别名 |

## 9. §9 回归（部署后实测）

| 检查 | 结果 |
|---|---|
| 未认证 / 非 Owner / 内部只读密钥 / SEC-R0 机器写密钥 | ✅ 401 / 403 `NATIVE_WRITE_OWNER_REQUIRED` / 403 `NATIVE_WRITE_OWNER_REQUIRED` / 401 |
| `INTERNAL_SECRET` 只读 | ✅ `GET /api/parts` 200；`POST /api/parts` 403 `INTERNAL_WRITE_FORBIDDEN` |
| SEC-R0 + HC2 denylist 套件 | ✅ 11/11（生产 checkout 内实跑） |
| Native Write 能力数 / DELETE | ✅ 1 / 允许 0 |
| worker / Legacy | ✅ 关闭 / 文件 ABSENT |
| 部署代码包含修复 | ✅ `Math.min(...cuts)` 边界修复、`previewFailureMessage`、`PREVIEW_REJECTED` 均存在 |

## 10. §10 业务数据安全（验收前后）

| 项 | 基线 | 验收后 |
|---|---|---|
| `轴承-202` 库存 | 201 | **201**（`updated_at` 也未变：`2026-09-26T16:05:01.240Z`） |
| `inventory.parts.batch_adjust_stock` 操作行 | 4 | **4** |
| business_change_events | 156 | **156** |
| `audit_log` 中 parts#150 记录 | 3 | **3** |
| 验收窗口内被改动的零件 / 线圈 | — | **0 / 0** |
| 配方 / 订单 / 报价 | 3 / 1 / 1 | 3 / 1 / 1 |
| AI 任务 | 2 | 4（提案任务 + 安全澄清失败任务，**允许且非业务写入**） |
| 验收产生的 COMMAND step | — | **0**（`ai_task_steps` 查询为空） |
| 验收产生的 operation | — | 仅 `ai.conversations.create/append` 记账（+2 条系统定时任务） |

## 11. §11 canary 库存

`轴承-202` 保持 **201**（合法业务事实）。**未做**任何脚本/数据库补偿写入。

## 12. §12 退出标准

| # | 标准 | 结果 |
|---|---|---|
| 1 | 修复已部署 | ✅ |
| 2 | runtime == worktree == GitHub | ✅ `437662d` |
| 3 | 写开关保持 true | ✅ |
| 4 | 恰好 1 个写能力 | ✅ |
| 5 | 重启前无未决 W1 任务 | ✅ 0 |
| 6 | canonical「库存放句尾」正确生成提案 | ✅ 201 → 202 |
| 7 | 验收期间未执行 | ✅ 未调用 execute |
| 8 | 业务库存未变 | ✅ 201 → 201 |
| 9 | 无新增 W1 operation 行 | ✅ 4 → 4 |
| 10 | 非规范写法绝不绑定错误目标 | ✅ 安全 not-found |
| 11–15 | Owner-only / SEC-R0 / DELETE / worker / Legacy | ✅ 全部保持 |
| 16 | 全部门禁 PASS | ✅ |
| 17 | health / ready PASS | ✅ |
| 18 | 工作区干净 | ✅ |

## 13. BLOCKERS

**无。**

### 观察（非阻断）

1. **本次多出 1 个纯测试提交**（`437662d`）——原因是第一次门禁拦截了我的用例会话隐患；
   产品代码与批准范围完全一致（可复核：`1952d6c..437662d` 只含 2 个测试文件）。
2. **验收留下 1 条未消费的 `WAITING_APPROVAL` 任务**（`d4f962b8-…`）：票面 §7 明确允许
   （"Allow it to remain unconsumed/expire safely"）。其确认凭证 TTL 为 5 分钟，现已过期，
   无法再被批准；任务记录保留作为审计。
   **对后续部署的提示**：本票 §2 的前置检查（重启前确认无未决写任务）应成为每次重启的固定动作；
   本次两次部署前都已确认 0 条。
3. **非规范型号（少连字符）仍是安全拒绝**：这是 W1 的实体身份契约（不模糊匹配）。本票只让
   文案回显用户写的型号，帮助 Owner 自行发现写法差异；若将来希望支持别名，需要单独的、
   显式的规范化设计，不在本票范围。
