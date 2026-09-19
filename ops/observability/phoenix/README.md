# Phoenix 本地诊断服务

该目录只运行独立的 self-hosted Phoenix。它使用 SQLite 和 Docker named volume，不连接水泵应用，也不包含 OpenTelemetry、OpenInference、Collector、PostgreSQL 或其他监控服务。

## 固定边界

- 镜像：`arizephoenix/phoenix:version-20.6.0`
- Phoenix UI / OTLP HTTP：`http://127.0.0.1:6006`
- OTLP gRPC：`127.0.0.1:4317`
- SQLite 工作目录：`/mnt/data`
- Docker volume：`pump_phoenix_data`
- Phoenix telemetry：关闭
- Authentication：`LOCALHOST_NO_AUTH`

端口只绑定到 Windows loopback。不要改为 `0.0.0.0`；如需从 NAS、LAN 或公网访问，必须先进入独立 security phase。

## 运维命令

从项目根目录执行：

```powershell
docker compose -f ops/observability/phoenix/compose.yml config
docker compose -f ops/observability/phoenix/compose.yml pull
docker compose -f ops/observability/phoenix/compose.yml up -d
docker compose -f ops/observability/phoenix/compose.yml ps
```

健康检查：

```powershell
Invoke-WebRequest http://127.0.0.1:6006/healthz -UseBasicParsing
```

重启服务：

```powershell
docker compose -f ops/observability/phoenix/compose.yml restart
```

停止并删除 container/network，但保留 SQLite volume：

```powershell
docker compose -f ops/observability/phoenix/compose.yml down
```

禁止在日常停止或重建时添加 `-v`；`down -v` 会删除持久化的 `pump_phoenix_data`。

## 数据与隐私

本阶段没有应用 instrumentation，Phoenix 不应收到 prompt、用户消息、tool 参数、tool 结果、客户信息或业务数据。`PHOENIX_TELEMETRY_ENABLED=false` 关闭 Phoenix 自身 telemetry。

SQLite 数据仅保存在 Docker named volume 中，不写入或提交到仓库。可用以下命令只读检查 volume：

```powershell
docker volume inspect pump_phoenix_data
```

## 镜像来源

- 官方 release：<https://github.com/Arize-ai/phoenix/releases/tag/arize-phoenix-v20.6.0>
- 官方 Docker 部署文档：<https://arize.com/docs/phoenix/self-hosting/deployment-options/docker>
- 固定 multi-arch digest：`sha256:fead8aabb0de1e766bffdbccb5d73b035b1f4c90addc18a320d3167b8989f4a4`

升级镜像前必须重新审查官方 release、resolved digest、healthcheck、端口与 SQLite migration，并单独验证回滚；不要改用 `latest`。
