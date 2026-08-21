# 生产发布检查清单

> 更新于 2026-08-16。

日常发布优先在 Windows 项目根目录运行：

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
- 已进入多 Agent 模式后，日常新增、轮换、撤销和回滚不得手工编辑生产 `.env`；Windows 端使用 `npm run mcp:identity:macmini -- -Action <...>`，Mac Mini 本机使用 `npm run mcp:identity -- <...>`。所有写操作先 dry-run，再显式 `-Apply`/`--apply`；token 只能来自 SSH stdin、命名环境变量或包装器内存生成，不得放入命令行参数、聊天、日志或报告。正式变更必须保留 `backups/config/mcp-identities/` 权限受限备份，并在 API 重启后逐身份执行在线目录验证。完整命令和回滚流程见 `docs/mcp-development-guide.md`。
- MCP 写能力保持 `MCP_WRITE_ENABLED=false`，除非本次发布明确批准写入。批准后还必须同时设置 `MCP_WRITE_CLIENT_IDS=<clientId,...>` 与 `MCP_WRITE_TOOL_ALLOWLISTS={"clientId":["sync_factory_knowledge"]}`；每个身份只获得数组中明确列出的写工具，不再默认看到全部 17 个。缺少映射、空列表、未知身份或未知工具会使 API 启动失败。首次只向支持 2026 form elicitation 的客户端开放一个可回滚工具；2025 无状态客户端只能使用只读工具，写调用会安全拒绝。
- 任何批准生产 MCP 写能力的发布，必须先在待发布 commit 上通过 `npm run verify:mcp-write-local` 并检查 `logs/mcp-write-local-latest.json` 为 `passed`、`toolsCovered=17`、`productionTouched=false`。该本地门禁不授权修改生产 `.env`；启用开关、身份和逐工具 allowlist 仍需本次发布单独明确批准。
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

不要把 Bearer token 直接写入可提交的 Compose、配置模板或日志。Hermes 连接后运行 `hermes mcp test pump_factory`，只读身份应发现 47 个工具；其他 Agent 连接同一 `/mcp` 时按部署策略使用自己的身份。未授权请求应返回 `401`；未列入 `MCP_WRITE_CLIENT_IDS` 的身份看不到任何写工具，已列入的身份也只能看到 `MCP_WRITE_TOOL_ALLOWLISTS` 为其明确授权的子集。当前 service-token 模式只适合同一管理域控制的 Agent/CI；开放第三方多租户前必须增加 MCP OAuth 2.1 Resource Server 流程。回滚写能力只需设 `MCP_WRITE_ENABLED=false` 并重启 API；完全回滚 MCP 则设 `MCP_ENABLED=false`，不涉及数据库迁移。

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
`npm run verify:mcp-prod-read`。该门禁在单个连接内复用三个正式成本场景，并以 18 次调用覆盖 17 个
代表工具及库存、配方、客户/报价、订单/采购、管理/质量、知识和出图历史；逐次验证
`mcp.verified`、能力 ID 和正式数据源，并交叉核对配方明细/无覆盖试算的当前完整成本、
覆盖试算的 `currentTotalCost` 主字段，以及两项成本对比工具的实时数据模式。最坏 35 个请求，低于每分钟 60 次生产限流。
它不创建缺价、订单或其他测试样本，也不修改任何生产数据。失败会以非零状态阻止发布完成，
脱敏综合报告保存在 `logs/mcp-production-read-latest.json`，成本子报告继续保存在
`logs/mcp-production-cost-latest.json`。

若本次发布包含 MCP 写目录、确认协议或 executor/command 变更，部署前还必须执行
`npm run verify:mcp-write-local`。它只在内存数据库、临时文件和外部命令替身中覆盖 17/17 写工具；
不得为了通过门禁临时打开生产写开关，也不得把本地通过等同于生产写入已授权。

`npm test` 会为每个测试进程创建独立临时 SQLite，发布门禁不会再运行迁移或
测试写入生产 `pump.db`；真实生产迁移只在 API 服务重启时执行，并由拉取前的
commit 绑定 release 备份保护。
脚本还会安装并校验 `/etc/newsyslog.d/com.pumpfactory.conf`，四个
LaunchDaemon 日志达到 10 MB 后轮转，保留 14 份压缩文件；轮转后对应服务
收到 `SIGTERM` 并由 LaunchDaemon 自动拉起，以确保新日志文件真正生效。

- 打开 Web 前端并验证登录、订单、配方、报价、线圈、转子出图和移动端 `/ai`。
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
