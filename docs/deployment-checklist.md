# 生产发布检查清单

> 更新于 2026-07-29。

本文用于 Mac Mini 生产环境发布前后的固定检查。发布命令以项目根目录为准：

```bash
cd ~/pump-cost-accounting-system
export PATH=/opt/homebrew/bin:$PATH
```

生产运行目录不要放在 `~/Documents`。macOS 的 TCC 隐私保护会阻止 LaunchDaemon 读取该目录，导致服务反复启动失败。

## 1. 发布前

- 确认当前机器上的真实 `.env` 已按 `.env.example` 补齐，真实密钥不得提交到仓库。
- 配置 `DB_BACKUP_MIRROR_DIR` 指向另一块磁盘或备份设备；未配置时明确记录本次发布只有本机备份。
- 生产环境必填：`ACCESS_PASSWORD`、`JWT_SECRET`、`INTERNAL_SECRET`、`CORS_ORIGIN`、`SIRI_API_TOKEN`。
- 如启用 AI、语音或出图，确认 `DEEPSEEK_API_KEY`、`ALI_ACCESS_KEY_ID`、`ALI_ACCESS_KEY_SECRET`、`ALI_ASR_APPKEY`、`FREECAD_BIN`、`PYTHONPATH` 按实际环境配置。
- 确认微信小程序包内没有真实 `INTERNAL_SECRET`；当前小程序鉴权仍是兼容方案，后续应迁移到 OpenID 或服务端会话。
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

## 3. 重启服务

生产环境统一使用 LaunchDaemon 安装脚本重启。该脚本会在安装前再次执行生产环境检查，并安装 API 与 Web 两个服务：

```bash
sudo ./scripts/install-macmini-launchdaemons.sh
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
