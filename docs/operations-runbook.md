# 生产运行与故障排查

本文用于 Mac Mini 单机生产环境的日常检查和故障定位。部署与数据库恢复分别
见 [deployment-checklist.md](./deployment-checklist.md) 和
[database-backup-recovery.md](./database-backup-recovery.md)。

## 1. 先判断存活还是未就绪

```bash
curl -i http://127.0.0.1:3002/api/health/live
curl -i http://127.0.0.1:3002/api/health/ready
```

- `live` 失败：API 进程没有正常响应，检查 LaunchDaemon 和错误日志。
- `live` 成功但 `ready` 返回 503：查看 `checks`，确认是数据库、迁移还是启动
  备份未通过。
- `ready` 的 `runtime` 提供代码版本、Git commit、Node 版本、启动时间、运行
  时长和内存；`background` 提供备份、知识同步、向量同步和管理待办任务状态。
- 异机备份设备短时离线只记录告警，不会让本机已验证备份阻断 API 就绪。

## 2. 按请求编号追踪错误

所有 HTTP 响应都包含 `X-Request-ID`。页面或 API 报错时先记录该编号，再在
API 日志中检索：

```bash
grep '请求编号' logs/api-launchd.log logs/api-launchd.error.log
```

访问日志只记录请求编号、方法、路径、状态码和耗时，不记录请求体或查询内容。
调用方传入格式安全的 `X-Request-ID` 时系统会沿用，否则自动生成 UUID。
日志元数据以单行 JSON 输出，密码、Token、Cookie、Secret 和 API Key 字段
会自动脱敏。

## 3. 检查服务与日志

```bash
sudo launchctl print system/com.pumpfactory.api
sudo launchctl print system/com.pumpfactory.web
tail -n 100 logs/api-launchd.log
tail -n 100 logs/api-launchd.error.log
tail -n 100 logs/web-launchd.error.log
```

未捕获异常或未处理 Promise 拒绝会先记录完整错误，然后优雅关闭；LaunchDaemon
负责自动拉起新进程。不要让状态未知的进程继续长期运行。

## 4. 日志保留

`install-macmini-launchdaemons.sh` 会安装
`/etc/newsyslog.d/com.pumpfactory.conf`。API/Web 标准和错误日志达到 10 MB
后轮转，保留 14 份并压缩。轮转完成后会向对应服务发送 `SIGTERM`，API
完成优雅停机后由 LaunchDaemon 自动拉起，使新进程重新打开日志文件。每个
服务使用一条 glob 规则统一处理标准日志和错误日志，只发送一次停止信号。

检查配置：

```bash
sudo newsyslog -n -f /etc/newsyslog.d/com.pumpfactory.conf
ls -lh logs/*launchd*
```

## 5. 最小故障证据

报告问题时至少保留：

1. 发生时间和 `X-Request-ID`；
2. `/api/health/ready` 返回；
3. 两个 LaunchDaemon 状态；
4. 对应时间附近的 API/Web 错误日志；
5. 当前 Git commit。

不要先删除数据库、WAL、备份或日志。数据库恢复必须走正式恢复命令。


## 登录兼容服务的系统自启动

公网登录和身份检查仍经过 `/Users/dan/pump-owner-auth-p16ir2` 的 3104 兼容服务，其他 API/Web 路由不经过它。该目录及生产 `node_modules` 是运行依赖，不属于旧 Candidate 清理范围。

原用户 LaunchAgent 依赖 GUI 登录。新的独立安装入口已准备并通过 zsh 语法、plist 结构和非管理员拒绝检查，但截至 2026-09-08 的本次收尾记录，尚待操作者提供 sudo 执行权限；不得因此宣称系统自启动已生效。

```bash
sudo /bin/zsh /Users/dan/pump-cost-accounting-system/scripts/install-owner-auth-daemon.sh
```

安装只注册 `system/org.pump.owner-authentication`，进程仍以 dan 身份使用原配置和原依赖运行。它归档原 GUI LaunchAgent，避免重复启动；不修改生产 `.env`、公网路由、凭据、写权限，也不重启 API/Web。安装失败恢复原登录进程，原服务文件保存在 `pump-owner-auth-p16ir2/daemon-migration-backup/`。需要恢复原方式时，用同一命令追加 `--rollback`。

安装后须检查系统服务的 running 状态与 UID，主动结束一次该服务进程并确认 KeepAlive 自动启动新 PID，再核对本机与公网登录。当前后台手动进程可用不代表完成这些检查。

## 2026-09-08 服务器目录收尾

- 17 个旧 P16/V5/发布暂存目录已完整归档后清除；压缩归档保留在 `/Users/dan/pump-maintenance-20260908/retired-environments.tar.gz`，同目录 `archive-manifest.json`、`archive-verified.json`、`cleanup-result.json` 保存清单、SHA-256 和删除范围。不能按历史文档中的旧运行路径直接执行；需要追溯时先查此归档。
- 两个旧 V5 用户自启动项已移至同目录 `retired-launchagents/`，避免今后 GUI 登录重新拉起旧框架。当前登录兼容项单独保留，待上述系统服务安装时替换。
- 当前/上一稳定版回滚包在 `/Users/dan/pump-rollback-v1/`。日常 30、启动 5、发布 20 的备份保留策略不变，旧备份归位至 `backups/legacy/`；根目录旧日志移至 `logs/legacy/`。
- 业务代码、数据库、上传文件和当前运行依赖保留；清理期间 API/Web PID 未变，未改变业务写权限。
