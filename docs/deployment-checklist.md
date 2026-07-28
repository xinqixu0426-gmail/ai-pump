# 生产发布检查清单

> 更新于 2026-07-28。

本文用于 Mac Mini 生产环境发布前后的固定检查。发布命令以项目根目录为准：

```bash
cd ~/pump-cost-accounting-system
export PATH=/opt/homebrew/bin:$PATH
```

生产运行目录不要放在 `~/Documents`。macOS 的 TCC 隐私保护会阻止 LaunchDaemon 读取该目录，导致服务反复启动失败。

## 1. 发布前

- 确认当前机器上的真实 `.env` 已按 `.env.example` 补齐，真实密钥不得提交到仓库。
- 生产环境必填：`ACCESS_PASSWORD`、`JWT_SECRET`、`INTERNAL_SECRET`、`CORS_ORIGIN`、`SIRI_API_TOKEN`。
- 如启用 AI、语音或出图，确认 `DEEPSEEK_API_KEY`、`ALI_ACCESS_KEY_ID`、`ALI_ACCESS_KEY_SECRET`、`ALI_ASR_APPKEY`、`FREECAD_BIN`、`PYTHONPATH` 按实际环境配置。
- 确认微信小程序包内没有真实 `INTERNAL_SECRET`；当前小程序鉴权仍是兼容方案，后续应迁移到 OpenID 或服务端会话。
- 拉取代码后安装依赖：

```bash
git pull --ff-only origin master
npm install
npm --prefix apps/web-next install
```

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

`verify:prod-env` 会检查生产必填环境变量、拒绝开发默认密钥，并校验 `PORT`。任一环节失败都不要继续重启生产服务。

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
```

- 打开 Web 前端并验证登录、订单、配方、报价、线圈、转子出图和移动端 `/ai`。
- 查看错误日志：

```bash
tail -n 80 logs/api-launchd.error.log
tail -n 80 logs/web-launchd.error.log
```

- 确认 `backups/` 目录有数据库备份；服务启动时会立即备份一次，之后每天 03:00 BJT 自动备份。
- 确认审计保留期：默认 `AUDIT_RETENTION_DAYS=365`，清理只在成功备份后执行；设为 `0` 表示禁用。
- 首次部署知识库版本后，在 `/ai` 输入“同步工厂知识库”并确认执行；核对同步总数、新增/更新/删除数量和 FTS 状态。
- 用真实型号、客户、报价和订单各提问一次，确认 AI 能返回正确来源；知识库同步失败时先检查 API 日志，不要反复清库。

## 5. 回滚

如发布后发现阻断问题：

```bash
git log --oneline -5
git switch master
git pull --ff-only origin master
```

选择上一个已知可用提交或标签后，再执行：

```bash
npm install
npm --prefix apps/web-next install
npm run verify:release
sudo ./scripts/install-macmini-launchdaemons.sh
```

回滚后仍必须完成健康检查、关键页面检查和日志检查。
