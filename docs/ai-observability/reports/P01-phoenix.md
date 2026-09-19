# P01 Self-Hosted Phoenix Infrastructure

审计与部署时间：2026-09-04（Asia/Shanghai）

执行状态：`PASS`

执行边界：P01 只部署独立的 self-hosted Phoenix、SQLite named volume 和 localhost-only Docker 端口。水泵应用仍未连接 Phoenix；本阶段未安装 OpenTelemetry、OpenInference 或 Phoenix Node SDK，未创建应用 span，未修改应用启动路径、AI/业务代码、依赖、schema 或业务数据库。

## 1. Executive Result

- `P01_STATUS=PASS`
- `P02_READY=YES`
- Phoenix `20.6.0` 固定镜像的实际 RepoDigest 与冻结预期完全一致。
- 独立 compose 已部署，Phoenix container 为 `healthy`，`/healthz` 和 UI 均返回 HTTP 200。
- OTLP HTTP 空 protobuf request 返回 200；OTLP gRPC 4317 TCP listener 可连接。没有发送真实或伪造业务 trace，最终 SQLite 中 `spans=0`、`traces=0`。
- Windows 实际监听仅为 `127.0.0.1:6006` 和 `127.0.0.1:4317`，没有 LAN bind。
- SQLite named volume 通过 container restart 和 compose down/up recreate 持久化验证。
- `npm test` 与 P00 基线完全一致：1733 tests、1732 pass、1 fail；唯一失败仍为缺少 `.guardian/config.yaml`。
- 应用依赖、AI/业务源码指纹和 `pump.db` 哈希均保持不变。

P01 最初因宿主机缺少 Docker/WSL 而 BLOCKED。P01A 完成 WSL2 和 Docker Desktop 4.89.0 bootstrap 后，本次 P01-RESUME 解除该基础设施 blocker；此前的阻塞证据保留为审计历史，不代表本次部署前已存在 Phoenix。

## 2. P00 Baseline Reference

```text
V4_CODE_BASELINE_COMMIT=53e918587811aa01aa47acf088331f4b020c6fb7
P00_REPORT_COMMIT=2a100ad7166dc31e3b50e3e4abce996c89e1a076
P01_START_COMMIT=2a100ad7166dc31e3b50e3e4abce996c89e1a076
BRANCH=master
WORKTREE_CLEAN_AT_START=NO
P00_STATUS=PARTIAL_ACCEPTED
FULL_REGRESSION_BASELINE=FAIL_1732_OF_1733
```

P01 开始前已存在的用户工作树：

```text
 M api/services/aiAgentRuntimeV3.cjs
 M api/services/aiEntityResolverV3.cjs
 M api/services/aiEvaluations.cjs
 M api/services/aiPromptComposer.cjs
 M docs/README.md
 M docs/ai-learning-release-gate-guide.md
 M docs/api-contract.md
 M docs/api-reference.md
 M package.json
 M tests/aiDispatcherV2.test.cjs
 M tests/aiEntityResolverV3.test.cjs
 M tests/aiEvaluations.test.cjs
?? api/services/aiAnswerGrounding.cjs
?? api/services/aiShadowComparisonV4.cjs
?? docs/ai-assistant-replanning-brief.md
?? docs/ai-assistant-replanning-prompt.md
?? output/
?? scripts/run-ai-shadow-evaluation.cjs
?? tests/aiShadowComparisonV4.test.cjs
```

这些文件均不是 P01 变更，未被覆盖、reset、stash、clean 或加入 P01 提交。P00 的 R4-B、Real AI Shadow、Exact Entity Identity、`800平刀` 和 Guardian 已知状态保持冻结，本阶段未运行 Real AI，也未修复任何 V4 failure。

## 3. Deployment Location

最终使用独立目录：

```text
ops/observability/phoenix/
├── compose.yml
└── README.md
```

P00 已确认仓库没有其他 Docker/compose infrastructure convention。独立 compose 不改变 Windows 开发启动、Mac Mini LaunchDaemon 或业务应用 runtime，符合 Phoenix 与应用解耦的 P01 边界。

运行环境：Docker Desktop 4.89.0、Docker Engine 29.7.2、Compose v5.5.0、WSL2 Linux/amd64 backend、context `desktop-linux`。

## 4. Phoenix Version / Image / Digest

```text
PHOENIX_IMAGE=arizephoenix/phoenix:version-20.6.0
PHOENIX_VERSION=20.6.0
PHOENIX_IMAGE_DIGEST=sha256:fead8aabb0de1e766bffdbccb5d73b035b1f4c90addc18a320d3167b8989f4a4
PHOENIX_AMD64_MANIFEST_DIGEST=sha256:d5a939a78e164ddaa4c841ef7d751d9f95a5d537ed1802dafd9485694a0538a2
EXPECTED_DIGEST_MATCH=YES
SOURCE_RELEASE=https://github.com/Arize-ai/phoenix/releases/tag/arize-phoenix-v20.6.0
SOURCE_IMAGE=https://hub.docker.com/r/arizephoenix/phoenix/tags
SOURCE_DEPLOYMENT=https://arize.com/docs/phoenix/self-hosting/deployment-options/docker
```

`docker pull` 输出 digest 为冻结预期值。本地 `docker image inspect` 的 RepoDigest 为：

```text
arizephoenix/phoenix@sha256:fead8aabb0de1e766bffdbccb5d73b035b1f4c90addc18a320d3167b8989f4a4
```

镜像平台为 Linux/amd64，entrypoint 是 `/usr/bin/python3.13`，Phoenix image version tag 未使用 `latest`。

## 5. Docker Compose Design

compose 仅包含一个 `phoenix` service：

- 固定镜像 `arizephoenix/phoenix:version-20.6.0`。
- `PHOENIX_WORKING_DIR=/mnt/data`。
- `PHOENIX_TELEMETRY_ENABLED=false`。
- `127.0.0.1:6006:6006` 和 `127.0.0.1:4317:4317`。
- named volume `pump_phoenix_data` 挂载到 `/mnt/data`。
- `restart: unless-stopped`。
- 不包含应用、OTel Collector、PostgreSQL、Prometheus、Grafana、Loki、Kubernetes 或外部数据库。
- 镜像 metadata 声明 9090，但 compose 没有 publish 9090。

执行结果：

```text
docker compose config=PASS
docker compose pull=PASS
docker compose up -d=PASS
docker compose ps=HEALTHY
```

## 6. Storage / Persistence

```text
STORAGE=SQLITE
PHOENIX_WORKING_DIR=/mnt/data
VOLUME_NAME=pump_phoenix_data
VOLUME_DRIVER=local
VOLUME_SCOPE=local
VOLUME_MOUNT=/mnt/data
DOCKER_MOUNTPOINT=/var/lib/docker/volumes/pump_phoenix_data/_data
```

Phoenix 创建了 `phoenix.db` 及运行中的 WAL/SHM 文件。所有 runtime 数据均位于 Docker named volume，不写入仓库。

持久化验证使用不含业务信息的临时 marker `P01-PERSISTENCE-20260904`：写入 `/mnt/data` 后，container restart 可读取；执行不带 `-v` 的 `docker compose down` 后 volume 仍可 inspect；重新 `up -d` 得到不同 container ID，仍可读取同一 marker。验证完成后 marker 已删除。

未执行任何 `docker compose down -v` 或 volume 删除。

## 7. Network Exposure

compose 和实际 runtime 均确认：

```text
127.0.0.1:6006 -> container 6006/tcp
127.0.0.1:4317 -> container 4317/tcp
BIND_SCOPE=LOCALHOST
```

最终 `Get-NetTCPConnection -State Listen`：

```text
127.0.0.1  6006  LISTEN
127.0.0.1  4317  LISTEN
```

未出现 `0.0.0.0`、`::` 或其他 LAN address 的 6006/4317 listener，未修改 Windows Firewall，未 publish 9090。

## 8. Privacy / Telemetry

运行中 container inspect 确认：

```text
PHOENIX_TELEMETRY_ENABLED=false
APPLICATION_CONNECTED=NO
TRACES_SENT=NO
PROMPTS_SENT=NO
USER_MESSAGES_SENT=NO
TOOL_ARGUMENTS_SENT=NO
TOOL_RESULTS_SENT=NO
BUSINESS_DATA_SENT=NO
CUSTOMER_DATA_SENT=NO
```

唯一 OTLP HTTP 验证是零字节 protobuf request，不含 ResourceSpan、Span 或业务字段。验证后直接读取 SQLite，`spans=0`、`traces=0`。

没有安装应用侧 OpenTelemetry、OpenInference 或 Phoenix SDK，没有修改任何应用 env 或启动命令。

## 9. Authentication Mode

```text
AUTH_MODE=LOCALHOST_NO_AUTH
```

没有设置或启用 `PHOENIX_ENABLE_AUTH`。未认证访问 localhost UI 返回 200，符合单用户本地诊断 baseline。该模式不得用于 NAS、LAN 或 public host；任何扩大网络可达性的部署都必须重新进入 security phase。

## 10. Health Verification

官方镜像没有内置 healthcheck，也没有 `/bin/sh`；实际验证发现：

```text
curl=NOT_FOUND
wget=NOT_FOUND
/bin/sh=NOT_FOUND
python=Python 3.13.5
```

因此 compose 使用镜像中真实存在的 Python，通过 `urllib.request` 请求容器内 `http://127.0.0.1:6006/healthz`，只接受 2xx。该命令先在临时 probe container 中验证成功，probe 随后删除。

首次正式启动约 20 秒后转为 healthy。最终结果：

```text
PHOENIX_CONTAINER=HEALTHY
PHOENIX_HTTP_HEALTH=200 OK
PHOENIX_UI=200 text/html
PHOENIX_UI_TITLE=Phoenix
```

启动期 healthcheck 的 connection refused 是服务尚未监听时的预期状态；后续 exit code 为 0、failing streak 为 0。

## 11. OTLP Endpoint Verification

```text
OTLP_HTTP_URL=http://127.0.0.1:6006/v1/traces
OTLP_HTTP_EMPTY_PROTOBUF_POST=200 application/x-protobuf
OTLP_GRPC_ADDRESS=127.0.0.1:4317
OTLP_GRPC_TCP_CONNECT=PASS
```

普通 GET `/v1/traces` 会被 Phoenix SPA fallback 返回 UI HTML 200，因此没有将 GET 结果误作 OTLP ingestion 证据。零字节、`application/x-protobuf` POST 返回 200 且 response body 为零字节；随后 SQLite `spans=0`、`traces=0`，证明 endpoint 可用且没有创建 trace。gRPC 仅进行 TCP connect 后立即关闭，没有发送 OTLP payload。

## 12. Persistence Verification

```text
PERSISTENT_VOLUME=PASS
RESTART_PERSISTENCE=PASS
RECREATE_PERSISTENCE=PASS
VOLUME_SURVIVES_COMPOSE_DOWN=PASS
```

restart：

- `docker compose restart` 成功。
- container ID 保持 `8c59f330...`。
- 恢复后为 healthy，`healthz=200 OK`。
- 临时 marker 内容保持一致。

recreate：

- 使用 `docker compose down`，明确未带 `-v`。
- down 后 `pump_phoenix_data` 仍存在，创建时间保持 `2026-09-04T03:11:58Z`。
- `docker compose up -d` 后 container ID 变为 `e47ed7df...`，证明 container 已重建。
- 新 container 为 healthy、`healthz=200 OK`，临时 marker 内容保持一致。
- marker 已清理，SQLite 文件保留。

## 13. Application Isolation Verification

P01 开始和最终 gate 的哈希完全一致：

```text
pump.db SHA256=09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E
package.json SHA256=246AF85DB0467B4E8976FE95970D9A289D58406C1ABF134FEB69187A2C3FC622
package-lock.json SHA256=F5AA5BE431AA12D421110310DC3C76821F22E264235E04BD28469A9B06DEC1C1
AI_BUSINESS_DIFF_HASH=a69d7913b4d204552d37f3467605e37b62ef7c92
```

AI/business diff hash 由开始与结束时相同的 `git diff -- api api.cjs shared` 计算，证明 P01 没有改变这些既有用户 diff。最终 staged 区在提交前为空。

```text
APPLICATION_DEPENDENCIES_CHANGED=NO
BUSINESS_CODE_CHANGED=NO
AI_CODE_CHANGED=NO
AI_BEHAVIOR_CHANGED=NO
BUSINESS_DATABASE_CHANGED=NO
```

## 14. Regression Comparison

执行：

```text
npm test
```

结果：

```text
tests=1733
pass=1732
fail=1
duration_ms=11325.1564
EXPECTED_BASELINE=FAIL_1732_OF_1733
SAME_KNOWN_FAILURE=YES
NEW_REGRESSION_INTRODUCED=NO
```

唯一失败仍为：

```text
tests/businessTerminologyContract.test.cjs
ENOENT: .guardian/config.yaml
```

该 failure 与 P00 完全一致。测试使用既有临时测试数据库机制；仓库 `pump.db` 哈希未变化。未运行 Real AI Shadow、全量 R4-B real model 或 Repeat Stability。

## 15. Files Changed

P01 自己产生且允许提交的文件只有：

```text
ops/observability/phoenix/compose.yml
ops/observability/phoenix/README.md
docs/ai-observability/reports/P01-phoenix.md
```

Phoenix SQLite、WAL/SHM、volume、日志、trace、临时 marker 和凭据均未写入仓库。

## 16. Known Limitations

- 当前部署是 Windows Docker Desktop 上的 localhost 单用户 diagnostic baseline，不是生产、NAS、LAN 或公网部署。
- Authentication 关闭，仅由 loopback bind 提供访问边界；扩大网络可达性前必须完成 security phase。
- SQLite named volume 已验证持久化，但本阶段未设计备份、恢复、容量、retention 或长期升级策略。
- Phoenix image metadata 暴露 9090，但 compose 没有 publish 该端口。
- GET `/v1/traces` 命中 SPA fallback；未来 OTLP 检查必须使用正确 protocol/method，不能依赖浏览器 GET。
- Phoenix 与水泵应用尚未连接；没有 instrumentation，也没有真实 trace。P02 才可设计应用 bootstrap。
- P00 的 V4 correctness、R4-B、Exact Entity Identity、`800平刀` 和 Guardian 已知失败仍原样保留。
- 首次 P01 BLOCKED 审计的宿主机缺失结论只描述 P01A 之前的历史状态；本次通过 Docker 29.7.2/Compose v5.5.0 实测后已解除。

## 17. P02 Preconditions

```text
P02_READY=YES
```

YES 只表示 Phoenix infrastructure 已足以支持安全设计下一阶段 instrumentation，不表示 V4 AI 正确或已接入 tracing。

进入 P02 前仍必须：

1. 由 Supervisor 明确下发 P02；P01 不得自行继续。
2. 继续保留 `V4_CODE_BASELINE_COMMIT`、P00/P01 报告和当前用户 dirty worktree 边界。
3. bootstrap 必须在 Express、HTTP/fetch 和 provider modules 之前加载，且 exporter fail-open。
4. 默认测试 tracing off，Phoenix 不得成为应用 readiness、AI response、verifier 或业务 API 的依赖。
5. centralized redaction 与 diagnostic-content flag 必须在发送任何 AI/业务内容前设计和验证。
6. 手动 span 只能映射 P00 已确认的真实执行边界，不得为 trace 假造业务阶段。
7. Phoenix endpoint 仅使用 localhost，并保持 `PHOENIX_TELEMETRY_ENABLED=false`；P02 不得隐式扩大 bind 或 authentication scope。

P01 在此停止：不安装应用 tracing 依赖、不修改 `api.cjs`、不连接 AI runtime、不发送 AI trace、不开始 P02。
