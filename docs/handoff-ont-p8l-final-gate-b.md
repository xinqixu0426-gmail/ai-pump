# 接手须知 —— 水泵工厂管理系统 / ONT-P8L-FINAL（Gate B）

> 用途：在新会话开场直接粘贴本文件内容（或让我读它）。写于 2026-09-20，作者=上一个会话的 DSH 实例。
> 所有事实都来自实测；未验证之处均已注明。仓库当前干净，所有提交已推送 gitee。

## 0. 上下文交接来源（重要）

上一个会话在「Supervisor 中继 + 大量验收迭代」后**上下文接近上限**，主动停止写代码。
交接时**没有未提交的改动**，工作区干净：`git status --porcelain` 为空。

## 1. 环境与仓库

- 工作目录：`C:\Users\Dan\Documents\水泵订单及生产管理系统`（Windows 开发机）
- remote：`origin` = `git@gitee.com:lowkeydan/pump-cost-accounting-system.git`（**这才是主远端**）
- ⚠️ 另有一个 `github` remote = `xinqixu0426-gmail/ai-pump`，是**独立单提交快照历史，与本项目无共同祖基（685 vs 1）**。**不要对它 pull/merge**。
- 分支：`master`。本地 = `origin/master` = **`08c94d4`**（交接时）。
- 生产服务器：Mac Mini，SSH 别名 `macmini`（走 Cloudflare，`ssh macmini '<cmd>'` 可用；`~/.ssh/config` 已有）。
  生产路径 `/Users/dan/pump-cost-accounting-system`，生产 commit **`886e514cec6ae6185474c16868decc3bfa0595a1`**（**未部署任何本轮提交**）。
- 隔离验证实例：`/Users/dan/pump-p8l-validation`（Mac Mini 上的独立 git worktree，detached HEAD），
  端口 **3012**，`nohup node api.cjs` 运行（**未受管**），DB = 生产库的 verified copy `pump-validation.db`。
  启动方式（`NODE_TEST_CONTEXT` + `PUMP_TEST_DATABASE_PATH` 重定向，不动生产库）：
  ```
  cd /Users/dan/pump-p8l-validation
  nohup /opt/homebrew/bin/node api.cjs > logs/validation-api.log 2>&1 &
  ```
  逐条事实：`PORT=3012`、`PUMP_TEST_DATABASE_PATH=<worktree>/pump-validation.db`、`NODE_TEST_CONTEXT=ontology-p8l-validation`
  写在 worktree 的 `.env` 里；`node_modules` 是指向生产仓库的符号链接。

## 2. 生产开关现状（**不要擅自改**）

```
Semantic Shadow        = true
Semantic Enforcement   = false     ← 本会话曾发现被未入库工具遗留为 true，已按 Supervisor 裁定恢复
Ontology Routing       = false
```
生产 `.env` 未改（除上述一次经授权的 flag 恢复）；`AI_PROVIDER` 在生产 `.env` 中**未设置**。

## 3. 门禁命令与当前数字（b8e5adf 时实测）

| 命令 | 结果 |
|---|---|
| `npm test` | **2669/2669 pass** |
| `npm run verify:api-contract` | **26/26 pass** |
| `npm run test:deep-api` | **493 passed / 0 failed** |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run verify:prod-env` | 只在 Mac Mini 生产上通过（38 个 env）；**本机 Windows 会失败**，因为本机 `.env` 是开发配置（10 个键、无 `CORS_ORIGIN`）——不是缺陷 |

## 4. 本会话已完成并有测试守护的工作

1. **`recipe -> coil` 方向不再读整表**：`api/ontology/relationRoutingCanary.cjs` 的
   `shortlistByRelation['recipe.uses_coil']` 由该方向的声明读推导（`get_recipe_detail`、`search_coils`），
   整表读 `get_all_recipes` 只留给 Legacy。依据：`get_recipe_detail` 一次有界读即返回
   `coilId/coilSpec/coilSheets/coilMaterial/coilSlotType`。
2. **绑定器 per-record ownership 修复**：`api/ontology/relationBinder.cjs` 原先按"结果值的形状"判定 ownership，
   而 `get_recipe_detail` 的回执证据**同时**含列表调用 `/api/recipes` 与单条调用 `/api/recipes/12`，
   于是整行被当成集合读丢弃 → 配方行**永远进不了绑定器**。现改为：集合读拥有其数组、详情读只拥有它命名的那一条，
   二者不可互替；详情读 id 不符或非 GET 不构成 provenance。
3. **冻结资产哈希跨平台**：`tests/helpers/businessUnderstandingOracle*.cjs` 改用内容身份（行尾归一），
   Windows CRLF 不再把未变的冻结资产判成"已变"。
4. **验收基础设施入库**：`scripts/run-relation-runtime-acceptance.cjs`（双门禁 fail-closed runner）+
   `tests/relationRuntimeAcceptance.test.cjs`（15 项）。要点：`--gate p8l-local|ontology-cloud`、必须 `--execute`、
   每门禁断言自己的开关组合与唯一可接受 provider、业务不变性用**逻辑指纹**（行数+内容哈希+audit/operation 差值）
   而非 WAL 文件哈希、正确率必须由 ontology 路由产出（`routedCorrectRatio=1`）。

## 5. 当前的**唯一**未完成目标（Gate B）

Supervisor 裁定：**Gate B = REWORK**。退出条件（原文口径）：
```
Forward correct       8/8
Forward bound/routed  8/8
Forward aggregate     0
Reverse positive      4/4
Reverse empty         4/4
Reverse aggregate     0
Wrong Root / Relation / Direction  0
Additional Provider   0
Fallback              0
Writes                0
```
最近一轮实测（隔离实例 3012，真实 DeepSeek，2 轮）：
`forward 7/8`、`reverse 4/4`、`emptyCertified 4/4`、**`routedCorrect 9/9`**、
**`legacyFallbacks 3`**（全部是「配的什么绕组」问法）、`wrongRoot 1`、accepted path `get_all_recipes 0`、
`cloudFallbacks 0`、`additionalProviderRounds 0`、`unauthorizedWrites 0`、业务表无变化。

### 5.1 根因（已复现，**修正了早前的错误推测**）

**不是**"名称同时是配方与模板的冲突"。真实数据：
```
配方 13 = V750大脚板-2寸-经典款
模板    = 模板-V750大脚板-2寸-经典款      ← 名字不同
```
真实原因是：`recipe.uses_coil` 的绑定**只能**从"上一轮已验证回执"里解析根名称
（`relationBinder.cjs` 的 `bindRelation` → `verifiedRows(input.verifiedToolResults)` 与
`verifiedRows(session.toolResults)`），而**上一轮模型选哪个读取工具是不确定的**。

同一问法在隔离实例上连续 3 次复现，得到 3 种不同回执组合：
```
run1 seedTools=["get_recipe_detail"]                                              → 命中
run2 seedTools=["get_all_recipes","search_templates"]                              → 回执里没有配方行 → 未命中
run3 seedTools=["get_all_recipes","get_template_detail","get_recipe_detail"]       → 又一次掉进 Legacy
```
命中链：绑定成功 → canary 路由 → 软件预置 `get_recipe_detail`（有界）。
未命中链：`possible` 为空 → 绑定未命中 → canary 不路由（`ONTOLOGY_CANARY_FALLBACK`）→
`coilRecipeRelationQuery` 为真 → **Legacy 关系特殊路径介入并把整表读带回工具面**
（`api/services/aiAssistantRuntime.cjs` 约 `:357` 与 `:540`）。

**结论：路由召回不应依赖模型上一轮的偶然选择。**

### 5.2 Supervisor 已裁定的方向

- **(1) A** —— 修**绑定**（不要在 semantic 层去改"该名称判成模板"）。
- **(2) 是** —— 允许在 Mac Mini **验证实例/验证库副本**上构造稳定复现（**不得动生产**）。
- **(3) 是** —— 维持 Gate A `DEFERRED`、生产 `886e514` 与三个开关现状。

### 5.3 建议的修法（**未开工，动手前先确认**）

在运行时为绑定的关系根做一次**确定性的、按该关系 `fromType` 的名称解析读取**：
对 `recipe.uses_coil` 就是一次**有界的配方名解析**，使绑定不再取决于模型历史。
注意与既有架构约束对齐：必须是有界读、不得引入新的全量读取、不得新增 API/工具面以外的能力，
并遵守 `docs/api-contract.md` / `docs/api-sop.md`（若触及 API 还需 `npm run verify:api-contract` 与文档同步）。

## 6. 复现与复跑命令

**稳定复现（只读，跑在 Mac Mini 上）**：同一会话先问
`V750大脚板-2寸-经典款 用的是哪个泵壳模板？`，再问 `V750大脚板-2寸-经典款 配的什么绕组？`，重复 3 次，
即可看到上表三种回执组合与 Legacy 回退。

**复跑 Gate B**（隔离实例，真实 DeepSeek；`--gate p8l-local` 需本地模型 `192.168.31.111:8080`，
**当前不可达 → Gate A 保持 DEFERRED**）：
```
cd /Users/dan/pump-p8l-validation
git fetch origin master && git checkout --detach <目标提交>
# 重启隔离实例（按端口精确 kill，不要 pkill 宽模式，以免误伤生产 3002）
PID=$(lsof -nP -iTCP:3012 -sTCP:LISTEN -t | head -1); [ -n "$PID" ] && kill -TERM "$PID"
nohup /opt/homebrew/bin/node api.cjs > logs/validation-api.log 2>&1 &
AI_PROVIDER=deepseek AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED=true \
PUMP_ACCEPTANCE_DATABASE_PATH=$PWD/pump-validation.db \
node scripts/run-relation-runtime-acceptance.cjs --gate ontology-cloud --execute --rounds 2 \
  --base http://127.0.0.1:3012 --report logs/gates/<名字>.json
```
产物与历史证据都在 `/Users/dan/pump-p8l-validation/logs/gates/*.json`。

## 7. 踩过的坑（避免重犯）

1. **macOS 上读不到进程环境**：`ps -E` / `ps eww` 都不暴露（实测 0 命中）。等效证据 = 启动命令显式传 env
   + 应用侧解析结果 + 运行实例 `/api/health` 的 `gitCommit` 一致 + SSE 里实际 provider。
2. **不要用宽 `pkill`**：验证实例的命令行是 `node api.cjs`，模式匹配会误伤生产 3002。**按端口 kill**。
3. **PowerShell 陷阱**：`-replace` + `Set-Content -NoNewline` 曾把整个测试文件压成一行（已从 git 恢复）。
   改文件优先用 edit 工具；`tail` 在本机是 cmdlet 冲突，用 `Select-Object -Last N`。
4. **SSH 传脚本用 base64**：stdin 管道会带 BOM（`bash: ﻿cd: command not found`），
   用 `ssh macmini "echo <b64> | base64 -d | bash"` 最稳。
5. **Supervisor 中继会退化**：出现过空回复（`chars=0`）与单字符截断（`我的`/`裁`/`(`）。
   规程：`supervisor_verify` 核对 → 重发精简消息；**绝不把截断内容当裁定**。
6. **`dbUnchanged` 不要用文件 SHA**：SQLite WAL 下不可靠，用逻辑指纹。
7. **判定"答案正确"要按身份等价**，但不能过宽：`12片规格` 是"12 片"的数量表达，
   **不得**作为 `spec=12` 的依据；绕组数据 `44-44-44-44` / `78-78` 不是线圈身份
   （线圈形如 `规格-片数`，spec 1–2 位、片数 3 位）。

## 8. 规约（务必遵守）

- 项目根 `AGENTS.md`：所有动态 UPDATE 走 `safeUpdate`；前端请求走 `proxyRequest`；后端 Row Adapter 输出 camelCase；
  成本计算只走既定 API；API 变更必须读 `docs/api-contract.md` + `docs/api-sop.md` 并同步 `docs/api-reference.md`。
- `~/.dsh/AGENTS.md`：阶段结束默认自动回报 Supervisor（`supervisor_open` → `supervisor_return` → `supervisor_ask`）；
  **生产部署/破坏性操作必须先问用户**；门禁数字缺失时向用户要，**不得编造**。
- Supervisor 目标对话：**「解释Ontology及工厂应用」**（relay 配置在 `C:\Users\Dan\Documents\chatgpt-relay`）。
- **不要部署到生产**：Supervisor 明确要求不要部署本轮提交；生产保持 `886e514`。

## 9. 下一步（按优先级）

1. 按 §5.3 的确定性名称解析修绑定（先确认方向，再动代码）。
2. 补回归测试：绑定不得依赖上一轮模型选择了哪个读取工具（用 §6 的三次复现作为语料）。
3. 复跑 Gate B 两轮 → 目标 §5 的全部数字。
4. 跑全套门禁（`npm test` / `verify:api-contract` / `test:deep-api` / `lint` / `build`）并回报 Supervisor。
5. Gate A 待本地模型可达（`192.168.31.111:8080`，当前 `TCP_FAIL`）后再执行，**不得算 PASS**。
