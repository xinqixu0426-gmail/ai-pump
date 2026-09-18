# 生产发布检查清单

> 更新于 2026-09-07。

## 当前修复版本 V1.0.2：生产已发布并验证

- 按在售配方继承完整配置，只覆盖用户明确变更项；浮球、电缆、包装和配件未提及的模型默认值不覆盖基准。BOM 服务按当前价格重算；私人助理的配方覆盖试算也采用当前基准，原 HTTP/MCP 报价快照兼容行为不变。
- 修复条件句长期记忆保存、保存后续查、模板目录上下文、超大上轮记录保留试算参数、表格金额证据校验及正式总价汇总。未启用业务写入、未变更生产配置。
- 本地测试 **1882/1882**、契约 **26/26**、深度 API **437/437**、lint/build 通过。深度检查曾因外部铜价源 fetch failed 中断，确认源恢复后复核通过，失败日志保留。
- Mac Mini 隔离数据库正式 API 与在售配方当前成本对照：完整配置 **273.23**（保存快照 271.89），去浮球 **265.23**，保留浮球换指定纸箱 **265.23**。三轮真实聊天“木箱带浮球→去浮球→再换 v550牛皮纸箱” **3/3**，金额 **273.23→265.23→257.23**。最终隔离真实 AI 运行 **51：9/9**；这是隔离验证，尚非生产结果。
- 历史修复过程保留：隔离运行 48、49 各 **8/9**，分别为繁体否定与明确排除目录候选的评测误判；修复后运行 50 为 **9/9**。连续配置测试先后暴露未试算、表格无证据金额、丢失旧标识、模型删除未提电缆，各自修复后才复测，未改写失败记录。当前成功三轮日志为 `v102-explicit-config-live.log`，此前失败日志均在本机发布归档目录。
- 首次生产发布 `fb9efc3` 真实运行 48 为 **8/9**：唯一绕组方案用纵向表格分行展示材质和槽眼，评测分段未识别，答案及正式值本身一致。修复单方案表格识别，仍检查身份、每个绕组值和多方案分段；原回执离线复核 9/9，不算新模型运行。原 8/9 保留于 `failed-fb9efc3.db` 与 `v102-deployment.log`。
- 首次发布失败后已恢复 `9ad4112` 与发布前 Web 构建，ready=true、迁移 80、启动备份通过，生产配置哈希一致。没有迁移变化，数据库保留现有数据与真实失败记录，没有用旧数据库覆盖用户数据。
- 第二次发布 `9c1f6e9`：生产运行 49 **9/9**、MCP 与公网页面检查通过；登录后连续配置专项 **2/3**，第三轮模型没有取得本轮查询证据，系统安全拒答。随后恢复 `9ad4112` 与原 Web 构建；记忆及业务数据库保留。修复为在无证据金额草稿后的纠错轮要求正式只读工具调用，仍沿用相同轮次预算。
- 公网登录专项另发现原 3104 登录兼容进程停止，Cloudflare 仍指向该端口，造成 502。生产业务服务本地登录正常。已按原配置及 NODE_PATH 恢复原兼容程序，登录和自然语言记忆回执通过，用户明确规则仅一条有效记录；未改公网路由、生产 .env、凭据或 owner 权限。原 LaunchAgent 所需 GUI domain 当前不可用，现用原程序后台运行；开机自动启动尚待单独收口。
- 最终生产代码 `ddf8344cf5ff`：发布完整代码检查通过（1882 测试、26 契约、437 深度 API、lint/build、依赖及环境检查），生产真实运行 **50：9/9**，MCP 九领域只读、公网 ready/login/ai 通过。公网真实登录后记忆保存回执通过，规则有效记录仍仅 1 条；三轮配置专项 **3/3：273.23→265.23→257.23**，每轮均有正式成本回执，见 `v102-production-acceptance-required-evidence.log`。
- 只读逐表比较发布前后一共 53 张表：业务事实表无变化，仅评测、操作审计、用户明确的个人记忆、索引/同步及管理生命周期记录变化。生产 .env 哈希不变，原未跟踪配置备份保留。原始日志在本机发布归档目录，Mac Mini 制品位于 `~/pump-release-staging/v102/`；回退数据库核验件为 `rollback-stable/pump-verified.db`。
- 源码修复发布标签 `pump-ai-v1.0.2`；后续发布记录提交仅更新文档，生产运行代码不变。原人工冻结基准 `pump-ai-v1.0.1` / `9ad4112` 与所有历史结果保留。V1.0.2 为自动验收通过，不替代用户新的人工验收；登录兼容进程的开机自启动限制见技术债清单。

## 原稳定冻结版本：水泵ai管理系统 V1.0.1

- 2026-09-07 用户确认“目前 ai 可以用了”，要求冻结当前版本。发布标签为 `pump-ai-v1.0.1`，以该标签对应提交作为后续开发与回退的稳定源码基线，不移动或覆盖已有标签。
- 冻结包含生产运行代码 `d0d6b5cf4cdcf47284ceb5454e20247fec2a9c33` 及之后的验收、冻结文档；之后提交仅修改文档，运行代码一致。Git 发布标签标识修复版，包内版本字段仍为 `1.0.0`，不因冻结修改运行文件或重启服务。
- 复核本地与远端 master 一致、已跟踪工作区干净，生产运行 d0d6b5c、ready=true、迁移 80；已有生产 AI 9/9 与 MCP 通过报告保留。自动化测试 1863/1863、契约 26/26、深度 API 437/437、lint/build 及用户人工验收共同构成本次基线，不重复模型测试来改写历史。
- 本次仅更新冻结文档和创建标签，生产同步文档与标签，不改业务数据、配置或写权限。原 V1.0.0、历史失败和回滚证据保留；复杂长链查询预算、未启用的业务写入等限制不变。
- 后续功能和修复使用新提交及新版本标签；源码标签不包含数据库、密钥或生产构建，恢复生产时须另行核对备份及迁移兼容性。

## 水泵ai管理系统 V1.0.0 原始冻结记录

- 版本标签：`pump-ai-v1.0.0`，包版本 `1.0.0`。以标签对应提交为冻结源码，后续修复使用新的版本标签，不移动本标签。
- 2026-09-07 用户明确确认 Windows 本地人工验收通过。本次为源码审计、清理与冻结；未发布新版至 Mac Mini，未修改或重启生产 Legacy。
- 本次最终验证：全量测试 1848/1848、API 契约 26/26、隔离深度 API 437/437；完整 lint 与生产构建通过；后端和 Web 依赖审计各 0 个已知漏洞。深度 API 中的 401/502/503 为失败路径测试，整体退出码 0。
- 审计核对默认聊天/内部调用进入新工具循环、正式 API 事实来源、48 个只读工具、写工具拒绝、会话隔离、记忆回执和迁移 80、上下文预算及保留明细路径。清理后修正一处未使用导入，未另行扩大功能。
- V1 包含当前已实现的跨业务只读查询、正式成本比较、自然语言明确记忆保存/修改/删除/撤销。自由指代记忆、记忆管理界面和本人确认业务写入属于后续能力；复杂长链调查仍受轮次及上下文预算限制，不能保证所有自然语言问题都得到完整答案。
- 旧框架运行代码和阶段脚本已撤除；历史报告保留，包括 M-24 原因未明偶发故障与原始 29/30，未改写为全绿。未启用业务写操作、P17 或 P16-N。
- 清理前的全部 Git 引用、未提交源码备份，以及临时输出、过渡脚本和重规划草稿归档在本机 `C:\Users\Dan\Documents\pump-v1-release-archive\2026-09-07`。冻结验证原始日志已移到该归档目录的 `final-folder-cleanup/output/v1-freeze/`，不进入发布源码。
- 删除 25 个已合并本地分支、27 个已合并远端分支。未合并分支和有未提交修改的工作区保留；清洁工作区保留原文件并解除已删除分支绑定。
- 冻结时尚未批准重启 Legacy；2026-09-07 用户随后明确“调整，重启”，授权本次更新主服务。生产配置、数据库备份、发布与回滚仍须验证；本地构建通过不等同于生产环境验证通过。

### 2026-09-07 V1 修复发布状态：已通过，生产已更新

- 生产运行代码：`d0d6b5cf4cdcf47284ceb5454e20247fec2a9c33`，迁移 80。V1 冻结标签 `pump-ai-v1.0.0` 保持原提交，后续修复通过提交追踪。
- 本地及 Mac Mini 发布检查：测试 **1863/1863**、API 契约 **26/26**、深度 API **437/437**，lint、生产构建、依赖审计与生产环境检查通过。本地深度检查首次外部铜价 fetch failed；保留失败日志，确认来源恢复后复核通过，未改写原结果。
- 本次隔离真实 AI 运行 59 为 **9/9**；生产真实 AI 运行 47（对应本次提交）为 **9/9**，无失败或待确认。公网 ready、登录页、AI 页面及生产 MCP 九个领域只读验收全部通过。
- 从公网登录并实际输入“查一下最近 5 个订单”，新版调用 get_recent_orders，正常返回现有 1 条订单，无查询结果过大或上下文超容提示。
- 已修复：列表模型视图与知识正文重复膨胀、正式金额来源及成本汇总、模板价格含义、目标缺失/空查询反馈、内部协议泄露、无需许可的只读查询提前反问、超出剩余查询次数时未完成最终汇总。模板目录支持多关键词全部匹配，模板结果提供既有 BOM 试算入口，缺省配置交由正式服务处理。真实候选歧义仍需显式选择，未增加查询次数或业务写权限。
- 原 6/9 的三项在本次生产全部通过；报价零记录项为确定性验收规则误判，已补齐等价表达并保留假设、疑问和双重否定拒绝。随后配置成本绕路缺陷也已修复。模型输出仍受预算和正式证据约束，本次 9/9 仅代表所列场景通过，不代表所有开放式问题均可完成。
- 发布前备份：`pump-release-2026-09-07T10-43-44-541Z.db`；启动备份及公网运行版本核对通过，发布耗时 123 秒。生产环境文件与首次发布前逐字节相同。对比 51 个已有表，变化仅涉及迁移、审计/operation、评测、同步和 FTS 内部表，原有业务表内容未变；迁移新增两个个人记忆表。隔离 3402 服务已停止。
- 验收制品：Mac Mini `~/pump-release-staging/d0d6b5c/` 保存本次生产数据库快照、AI/MCP 报告与数据库对比；本机归档的 `deployment-template.log`、`recent-five-orders-production.json`、`d0d6b5c-database-diff.json` 保存完整发布及同问题验证结果。
- 回滚能力已经在此前失败发布中实测：最近 `6d555d0` 失败后使用其发布前备份 `pump-release-2026-09-07T10-30-46-458Z.db` 恢复 `12fee179b607`、迁移 79 与旧 Web 构建，并确认 ready 和启动备份通过。本次成功发布后保留新版，不再人为重复回滚。

#### 本轮修复过程（保留真实结果）

- 隔离运行 56 为 8/9、57 为 7/9；修复未发送草稿引发补充回答与明确拒绝替代来源被误判，配置成本专项运行 58 为 1/1。
- `6d555d0` 生产 8/9，原三项均通过，配置成本因模板多关键词零命中与绕路查询耗尽次数未通过。回滚后修复正式模板目录匹配及既有试算入口，再运行 59 与本次生产验收，分别为 9/9。

#### 失败与回滚证据（保留真实历史）

| 发布提交 | 生产真实结果 | 首要问题 | 回滚制品目录 |
|---|---|---|---|
| `d81ff7e` | 4/9 | 单价来源、目标资料、用途与成本摘要 | `~/pump-release-staging/d81ff7e/` |
| `51e0425` | 8/9 | 模板套件价替代零件目录价 | `~/pump-release-staging/51e0425/` |
| `d553716` | 8/9 | 重复知识资料累积超容 | `~/pump-release-staging/d553716/` |
| `8b54378` | 8/9 | “没有查询到任何报价记录”误判 | `~/pump-release-staging/8b54378/` |
| `5f1fc21` | 6/9 | 提前反问、预算结束不完整、另一零报价表达误判 | `~/pump-release-staging/5f1fc21/` |
| `6d555d0` | 8/9 | 模板多关键词零命中，配置成本绕路耗尽次数 | `~/pump-release-staging/6d555d0/` |

- 每次失败均恢复 `12fee179b607`、迁移 79 和原 Web 构建。各失败数据库可能都有运行 ID 47（恢复旧快照后再次运行），必须连同提交及制品目录识别，不能按 ID 合并或覆盖。
- 隔离真实检查：48=6/9、49=6/9、50=7/9、51=7/9、52=8/9、53=7/9、54=9/9；55 为切割用途单项诊断 1/1。原记录全部保留。51 与 `8b54378` 原生产回执经修正规则后只读复核 9/9，是离线复核，不能写成新的真实模型运行。另保留启动未就绪的 fetch failed。
- 本机全部日志与只读复核结果：`C:\Users\Dan\Documents\pump-v1-release-archive\2026-09-07`。此前 `5f1fc21` 失败日志为 `deployment-zero-quotation.log`，数据库对比为 `5f1fc21-database-diff.json`。这些历史结果保留，不因后续修复通过而改写；本次成功证据见上方当前状态。

在已授权常规主服务发布、且没有上述 Legacy 保护限制时，Windows 项目根目录运行：

```powershell
npm run deploy:macmini
```

该命令只接受已经 push 到 `origin/master` 的提交，并自动完成生产快照、快进拉取、
按需安装依赖、完整发布门禁、无 sudo LaunchDaemon 重启、启动备份验证、真实 AI
回归和公网验收。PowerShell 通过 stdin 把 UTF-8 脚本交给远端 `zsh`，不再拼接
复杂 SSH 命令。重复部署同一 commit 时会复用该 commit 已通过的代码门禁证据，
但仍会重新执行服务重启、ready、启动备份、真实 AI 和公网检查。

本文用于 Mac Mini 生产环境发布前后的固定检查。发布命令以项目根目录为准：

```bash
cd ~/pump-cost-accounting-system
export PATH=/opt/homebrew/bin:$PATH
```

生产运行目录不要放在 `~/Documents`。macOS 的 TCC 隐私保护会阻止 LaunchDaemon 读取该目录，导致服务反复启动失败。

## 1. 发布前

- 确认当前机器上的真实 `.env` 已按 `.env.example` 补齐，真实密钥不得提交到仓库。
- 配置 `DB_BACKUP_MIRROR_DIR` 指向另一块磁盘或备份设备；未配置时明确记录本次发布只有本机备份。
- 生产环境必填：`ACCESS_PASSWORD`、`JWT_SECRET`、`INTERNAL_SECRET`、`CORS_ORIGIN`。
- 如启用 AI 或出图，确认 `DEEPSEEK_API_KEY`、`FREECAD_BIN`、`PYTHONPATH` 按实际环境配置。
- 如启用通用 MCP，设置 `MCP_ENABLED=true`。单 Agent 配置 `MCP_CLIENT_ID + MCP_TOKEN`；多个 Agent 使用 `MCP_SERVICE_TOKENS` JSON 为 Hermes、Codex 等分别分配独立 token。每个 token 至少 32 字符，不得跨 Agent 复用，也不得复用 `INTERNAL_SECRET`、`JWT_SECRET` 或管理密码。公网域名 hostname 会从 `CORS_ORIGIN` 自动加入允许列表，其他入口显式写入 `MCP_ALLOWED_HOSTS`。
- 已进入多 Agent 模式后，日常新增、轮换、撤销和回滚不得手工编辑生产 `.env`；Windows 端使用 `npm run mcp:identity:macmini -- -Action <...>`，Mac Mini 本机使用 `npm run mcp:identity -- <...>`。所有写操作先 dry-run，再显式 `-Apply`/`--apply`；token 只能来自 SSH stdin、命名环境变量或包装器内存生成，不得放入命令行参数、聊天、日志或报告。正式变更必须保留 `backups/config/mcp-identities/` 权限受限备份，并在 API 重启后按身份精确核对由权威 catalog 与实际 allowlist 推导出的完整工具名集合，不得用统一工具数量代替。完整命令和回滚流程见 `docs/mcp-development-guide.md`。
- MCP 写能力保持 `MCP_WRITE_ENABLED=false`，除非本次发布明确批准写入。批准后的初始灰度配置示例为 `MCP_WRITE_CLIENT_IDS=<clientId,...>` 与 `MCP_WRITE_TOOL_ALLOWLISTS={"clientId":["sync_factory_knowledge"]}`；每个身份只获得数组中明确列出的写工具，不再默认看到全部 18 个。缺少映射、空列表、未知身份或未知工具会使 API 启动失败。首次只向支持 2026 form elicitation 的客户端开放一个可回滚工具；2025 无状态客户端只能使用只读工具，写调用会安全拒绝。
- 任何批准生产 MCP 写能力的发布，必须先在待发布 commit 上通过 `npm run verify:mcp-write-local` 并检查 `logs/mcp-write-local-latest.json` 为 `passed`、`toolsCovered=18`、`productionTouched=false`。该本地门禁不授权修改生产 `.env`；启用开关、身份和逐工具 allowlist 仍需本次发布单独明确批准。
- 首次把新的权威写工具加入生产灰度集合，日常增量默认使用 `approve-write`，每次只指定一个身份和一个工具。固定候选集已整体通过代码审计、18/18 localhost 成功路径及逐工具原生拒绝零副作用验收，且输入集合与 `scripts/mcp-write-acceptance-manifest.cjs` 当前候选清单精确一致时，可使用 `approve-write-batch` 对一个身份整批首次批准；列表中任一工具缺失、多余、未知、重复或已灰度都必须整批拒绝。两种入口都先 dry-run，再使用各自独立确认词执行；Mac Mini 批量执行在同一个远端进程和配置锁内只产生一份配置备份、一次原子替换、一次 API 重启和一次全身份精确目录核对，失败时恢复该备份并再次重启核验，达到终态后才释放锁。已进入灰度集合后才可用 `grant-write` 授权给其他身份。禁止手工编辑 `.env` 或用普通配置确认词绕过首次批准门卫。
- 拉取代码前，先把当前数据库快照与当前 commit 绑定并验证：

```bash
PREVIOUS_COMMIT=$(git rev-parse HEAD)
npm run db:backup:release -- --git-commit "$PREVIOUS_COMMIT"
npm run db:backup:verify -- --latest --type release \
  --expect-commit "$PREVIOUS_COMMIT"
```

- 快照通过后再拉取代码并安装依赖：

```bash
git pull --ff-only origin master
npm ci
npm --prefix apps/web-next ci
```

首次部署 Knowledge V6 或更换模型时，联网准备本地模型缓存：

```bash
npm run knowledge:model-prepare
```

成功后在 `.env` 设置 `KNOWLEDGE_MODEL_OFFLINE=true`。后续重启只读取本地缓存，不依赖外网；模型准备失败时不要删除现有 FTS 数据。

## 2. 发布验证

每次重启生产服务前必须执行：

```bash
npm run verify:release
```

该命令会依次执行：

- `npm audit`
- `npm test`
- `npm run test:deep-api`，在临时数据库副本上执行跨模块 API 冒烟测试
- `npm run build`
- `npm run verify:prod-env`

`verify:prod-env` 会检查生产必填环境变量、拒绝开发默认密钥，并校验 `PORT` 与
`INTERNAL_API_TIMEOUT_MS`（允许 1000-120000 毫秒）。任一环节失败都不要继续重启生产服务。

Hermes NAS 的 `~/.hermes/.env` 只保存 MCP 专用 token：

```dotenv
PUMP_FACTORY_MCP_TOKEN=<与 Mac Mini 上 Hermes 身份对应的 MCP service token 相同>
```

`~/.hermes/config.yaml` 使用远程 Streamable HTTP，并明确禁止并行工具调用：

```yaml
mcp_servers:
  pump_factory:
    url: "https://xuxinqi.xin/mcp"
    headers:
      Authorization: "Bearer ${PUMP_FACTORY_MCP_TOKEN}"
    enabled: true
    supports_parallel_tool_calls: false
    timeout: 30
    connect_timeout: 15
```

不要把 Bearer token 直接写入可提交的 Compose、配置模板或日志。Hermes 连接后运行 `hermes mcp test pump_factory`，只读身份应发现 48 个工具；其他 Agent 连接同一 `/mcp` 时按部署策略使用自己的身份。未授权请求应返回 `401`；未列入 `MCP_WRITE_CLIENT_IDS` 的身份看不到任何写工具，已列入的身份也只能看到 `MCP_WRITE_TOOL_ALLOWLISTS` 为其明确授权的子集。当前 service-token 模式只适合同一管理域控制的 Agent/CI；开放第三方多租户前必须增加 MCP OAuth 2.1 Resource Server 流程。回滚写能力只需设 `MCP_WRITE_ENABLED=false` 并重启 API；完全回滚 MCP 则设 `MCP_ENABLED=false`，不涉及数据库迁移。

## 3. 重启服务

日常发布由 `npm run deploy:macmini` 使用现有系统级 LaunchDaemon 的非 sudo
`kickstart` 重启，不再重复安装系统文件。首次部署，或
`com.pumpfactory.*.plist`、守护包装脚本、日志轮转配置发生变化时，才运行一次：

```bash
sudo ./scripts/install-macmini-launchdaemons.sh
```

日常远端手工兜底命令为：

```bash
/bin/zsh ./scripts/deploy-macmini-release.sh
```

不要把手动 `pkill + nohup` 作为常规发布路径。只有 LaunchDaemon 被系统策略阻断或需要临时排障时，才允许短时间手动启动，并在排障结束后回到脚本托管：

```bash
pkill -f 'node api.cjs'
pkill -f 'next start -p 3000'
nohup node api.cjs > logs/api.log 2>&1 &
nohup npm run web-next:start:primary > logs/web.log 2>&1 &
```

## 4. 发布后检查

- 后端健康检查：

```bash
curl http://127.0.0.1:3002/api/health
curl http://127.0.0.1:3002/api/health/live
curl http://127.0.0.1:3002/api/health/ready
```

`live` 仅证明进程还活着；发布验收必须以 `ready` 为准，它会检查数据库、
迁移版本和启动备份。`install-macmini-launchdaemons.sh` 已自动等待两个
LaunchDaemon 进入 running，并验收 API ready 与 Web `/login`；任一失败会
输出最近错误日志并以非零状态退出，不能把脚本开始执行视为发布成功。
健康检查通过后，安装脚本还会自动执行 `npm run verify:ai-release`。真实 AI
回归存在失败、待确认或模型调用错误时，安装命令返回失败，本次发布不能验收；
服务保持运行以便排查，结果保存在 `logs/ai-release-gate-latest.json`，并进入
管理看板“今日待办”的知识健康事项。模型流式连接瞬时中断会自动重试，连续
3 次不能完成才按错误阻止验收。

日常发布在公网 ready、登录页和 AI 页面通过后，还会执行
`npm run verify:mcp-prod-read`。该门禁在单个连接内复用三个正式成本场景，并覆盖 18 个
代表工具及库存、配方、客户/报价、订单/采购、管理/质量、知识、出图历史和统一业务变更；逐次验证
`mcp.verified`、能力 ID 和正式数据源，并交叉核对配方明细/无覆盖试算的当前完整成本、
覆盖试算的 `currentTotalCost` 主字段，以及两项成本对比工具的实时数据模式。最坏 36 个请求，低于每分钟 60 次生产限流。
它不创建缺价、订单或其他测试样本，也不修改任何生产数据。失败会以非零状态阻止发布完成，
脱敏综合报告保存在 `logs/mcp-production-read-latest.json`，成本子报告继续保存在
`logs/mcp-production-cost-latest.json`。

若本次发布包含 MCP 写目录、确认协议或 executor/command 变更，部署前还必须执行
`npm run verify:mcp-write-local`。它通过真实 localhost Streamable HTTP、2025/2026 双客户端和临时
SQLite，让 18/18 写工具逐一经过正式 executor/API、operation/audit 与 Query/数据库回读，并对两种工作流的业务动作与历史命令逐条核对独立业务变更事件，同时覆盖代表性
正式幂等重放、业务失败零副作用和 `accepted_async` 终态。验收清单把当前批次基线 9 项和候选 9 项
做无重复、无遗漏分区；候选按订单与报价转单、文件归档、转子出图三个场景汇总，并逐项验证
原生 decline 后数据库和外部命令零副作用。出图外部命令由跨平台替身隔离，未知命令 fail-closed。
不得为了通过门禁临时打开生产写开关，也不得把本地通过等同于生产写入已授权；生产仍需
`approve-write` 单项首次批准或满足整批前置条件时使用 `approve-write-batch` 原子批准，并继续按身份精确工具名验证和独立人工灰度。生产验收使用专用灰度数据；
`execute_factory_workflow_step` 默认只验拒绝，`archive_factory_file` 只使用专用 canary 文件。
`print_rotor_drawing` 不属于 MCP 目录；发布前必须先用 `revoke-write` 从每个身份的旧 allowlist 移除它，再重启新版本，不得用 MCP 触发任何打印路径。

`npm test` 会为每个测试进程创建独立临时 SQLite，发布门禁不会再运行迁移或
测试写入生产 `pump.db`；真实生产迁移只在 API 服务重启时执行，并由拉取前的
commit 绑定 release 备份保护。
脚本还会安装并校验 `/etc/newsyslog.d/com.pumpfactory.conf`，四个
LaunchDaemon 日志达到 10 MB 后轮转，保留 14 份压缩文件；轮转后对应服务
收到 `SIGTERM` 并由 LaunchDaemon 自动拉起，以确保新日志文件真正生效。

- 打开 Web 前端并验证登录、订单、配方、报价、线圈、转子出图和移动端 `/ai`。
- 本次包含迁移 67 时，在可回滚的隔离数据库先执行一笔业务变更，确认 operation 回执带 `businessChangeEvent`，`GET /api/business-changes` 可按实体查到同一事件，知识条目 `entryType=change_event` 与向量投影完成同步；生产只做已有真实变更的只读查询，不为验收制造数据。
- 查看错误日志：

```bash
tail -n 80 logs/api-launchd.error.log
tail -n 80 logs/web-launchd.error.log
```

- 保存响应头中的 `X-Request-ID`，确认可在 API 日志中定位同一次请求。
- 核对 ready 响应中的 `runtime.gitCommit`、启动时间、内存以及 `background`
  后台任务状态。详细排查步骤见 [operations-runbook.md](./operations-runbook.md)。

- 确认 `backups/startup/` 有最近启动备份、`backups/daily/` 有每日备份；启动备份保留 5 份，每日备份保留 30 份，二者互不挤占。
- 执行 `npm run db:backup:verify -- --latest --type startup`，验证最新真实落盘备份的元数据、SHA-256、完整性、外键、Schema 和核心表数量。
- 执行 `npm run knowledge:backup-check`，确认临时恢复库完整性、外键、向量数量和余弦查询全部正常。
- 执行 `npm run test:knowledge-retrieval`，确认固定检索评测通过；该命令复用已启动 API，不调用外部 AI。
- 在管理看板“知识库”确认向量覆盖率、混合检索模式和待生成数量；模型异常时系统应自动显示 FTS 回退。
- 确认审计保留期：默认 `AUDIT_RETENTION_DAYS=365`，清理只在成功备份后执行；设为 `0` 表示禁用。
- 首次部署知识库版本后，在 `/ai` 输入“同步工厂知识库”并确认执行；核对同步总数、新增/更新/删除数量和 FTS 状态。
- 用真实型号、客户、报价和订单各提问一次，确认 AI 能返回正确来源；知识库同步失败时先检查 API 日志，不要反复清库。

## 5. 回滚

如发布后发现阻断问题，选择上一个已知可用 tag/commit 和与其绑定的
`release` 备份。禁止只切换 Git：数据库迁移版本高于旧代码时，旧代码会
拒绝启动。

```bash
sudo /bin/zsh ./scripts/rollback-macmini-release.sh \
  <target-tag-or-commit> \
  backups/release/<matching-file>.db
```

脚本会验证备份绑定的 commit、停止服务、创建 safety 快照、恢复数据库、
切换代码、重新验证并启动服务。失败时按输出中的 `logs/rollback-*.json`
和 safety 备份处理，不要继续启动版本错配的服务。

完整恢复规则见 [database-backup-recovery.md](./database-backup-recovery.md)。
