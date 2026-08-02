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
完成优雅停机后由 LaunchDaemon 自动拉起，使新进程重新打开日志文件。同一
服务 60 秒内只触发一次，避免标准日志和错误日志同时轮转造成重复重启。

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
