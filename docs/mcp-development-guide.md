# 通用 MCP 开发与发布流程

本文是本项目 MCP 层的实施基线。协议事实以 MCP 官方规范和官方 TypeScript SDK 为准；业务事实仍以 capability registry、正式 API 和 `docs/api-contract.md` 为准。

## 1. 兼容目标

| 客户端类型 | 协议路径 | 服务端行为 |
|---|---|---|
| 2026-07-28 及后续兼容客户端 | 先 `server/discover`，每个请求携带协议/客户端/能力 `_meta` | 官方 SDK v2 modern 无状态处理；校验标准 MCP 头与信封 |
| Hermes 等 2025 Streamable HTTP 客户端 | `initialize` → `notifications/initialized` → 普通请求 | 同一 server factory 的 `legacy: stateless` 回退；可使用全部只读工具，因无交互回路而安全拒绝写确认 |
| 不受控第三方多租户 | 暂不支持 | 先实现 MCP OAuth 2.1 Resource Server、Protected Resource Metadata、audience/scope，再开放 |

`serverInfo` 和客户端自报名称仅用于兼容/日志显示，不能决定授权身份。授权身份只来自服务端验证过的 service token。

## 2. 标准开发流程

1. **规范与影响面**：确认目标协议版本、旧客户端兼容期、调用方和传输方式；先读 `docs/api-contract.md`、`docs/api-sop.md`。
2. **能力登记**：工具必须先存在于 AI capability registry 和唯一 `AI_TOOLS` schema。MCP 只维护显式允许列表，不复制业务实现。
3. **Schema**：`inputSchema` 直接复用唯一 AI schema；公开 `outputSchema`；结果同时返回 `structuredContent` 和等价文本 JSON。
4. **执行链**：`tools/call` 只委托统一 executor → internal API client → 正式 API；没有 `aiExecutionEvidence` 不得返回业务事实。
5. **安全**：默认关闭；Host/Origin 校验、每 Agent 独立 token、恒定时间比较、限流、结果大小上限、脱敏日志。写能力还必须默认关闭，同时按服务身份和工具名授予最小权限；目录与执行层分别校验同一逐工具 allowlist，再使用 MCP 原生 form elicitation，并以 HMAC 状态绑定主体、工具、参数和有效期。禁止 token passthrough，禁止使用 `INTERNAL_SECRET`。
6. **协议实现**：使用官方 SDK；一个 server factory 同时服务 modern/legacy，避免能力漂移；无状态服务不签发 `Mcp-Session-Id`。
7. **测试**：目录安全单测、输入/输出 schema、读写 scope、确认拒绝/篡改/过期/重放、证据门、认证/限流/Origin、超大结果；再用旧版客户端和当前客户端各做一次真实 HTTP 发现与调用。
8. **一致性**：运行官方 conformance 中与本服务声明能力相符的 `server-initialize`、`ping`、`tools-list`、`dns-rebinding-protection`。完整 active suite需要测试专用图片/音频/资源/Prompt 夹具，不得把缺少未声明能力误判为产品失败，也不得因 CLI 返回码为 0 把失败摘要误判为通过。
9. **文档与发布**：同步 `api-reference`、部署清单、`.env.example`；先保持默认关闭。发布后先验收每个身份的发现、只读调用、401 和审计身份。只有明确接受写风险后才设置 `MCP_WRITE_ENABLED=true`、`MCP_WRITE_CLIENT_IDS` 和 `MCP_WRITE_TOOL_ALLOWLISTS`，并使用支持 form elicitation 的 2026 客户端做一笔白名单内、可回滚的写入验收。

## 3. 本项目门禁

日常开发先运行本地 MCP 专项门禁：

```bash
npm run verify:mcp-local
```

该命令依次执行 MCP 协议/安全单测、官方 conformance 场景，并从本地
`pump.db` 只读备份出临时数据库，启动隔离 API 后通过真实 HTTP 让 Hermes
兼容的 2025 客户端和通用 2026 客户端分别发现并调用全部 48 个只读工具。
隔离验收同时覆盖未授权请求、畸形 JSON、请求体上限、已验证业务负结果、
数据库完整性和外键检查；2026 客户端还使用独立测试身份完成一次
`sync_factory_knowledge` 正式 Preview → form elicitation → Command → operation/audit
回执闭环。所有写入只发生在临时数据库副本，完成后停止子进程并清理临时目录，
不修改源数据库。
为容纳两个客户端在一分钟内连续执行 90 次只读工具调用及写验收，隔离进程把测试限流设为
600；该值不会写入环境文件，也不改变生产默认的每分钟 60 次限制。

涉及 MCP 写目录、确认协议、executor 或正式 command 时，还必须运行完整的 17 工具写入矩阵：

```bash
npm run verify:mcp-write-local
```

该门禁把 `api/mcp/catalog.cjs` 的 17 个正式写工具与验收清单做严格集合比对，逐工具验证
`mcp:write` scope、逐工具 allowlist、只预览不写、HMAC 状态及主体/参数绑定、form elicitation 明确接受、
正式执行证据、幂等重放、拒绝后无副作用。业务层复用正式 executor 和 command service 测试：
数据库写入使用独立内存 SQLite，文件归档使用临时文件，出图和打印停在外部命令替身，
不会读取生产 MCP token、连接 Mac Mini、修改正式数据库或调用物理打印机。脱敏结果写入
`logs/mcp-write-local-latest.json`。该结果证明本地协议和业务组合链路，不等于批准生产写入；
生产 `MCP_WRITE_ENABLED` 仍保持关闭，直到负责人明确批准并另做一笔可回滚的生产验收。

Windows Node 24 当前可能在官方 conformance CLI 已完整输出“0 failed、0 warnings”
后，于进程退出阶段触发 `UV_HANDLE_CLOSING` 断言。测试脚本只在 Windows、
成功摘要完整、没有 `FAILURE`、且断言是输出末尾唯一退出异常时将其记为明确的
CLI 兼容警告；任何场景失败、摘要缺失或其他非零退出仍使门禁失败。该问题对应
Node.js 的 Windows `fetch`/强制退出竞态，而不是放宽 MCP 场景判定。

生产性能排查以 API 日志中的 `MCP 工具调用完成.durationMs` 为服务端耗时依据。
如果 Agent 界面显示 20–40 秒，而相同 `requestId/toolName` 的服务端耗时只有数毫秒，
延迟发生在客户端模型规划、连续多工具选择或最终回答生成阶段，不应通过缓存或改写
正式业务 Query 掩盖。只有服务端 `durationMs` 本身持续超标时，才进入 MCP/API 性能优化。

生产发布在公网 ready 通过后自动运行：

```bash
npm run verify:mcp-prod-read
```

该命令从进程环境的 `MCP_VERIFY_TOKEN` 或正式 `.env` 中已有的
`MCP_SERVICE_TOKENS` 选取凭证，不输出或写入 token。它在同一个 MCP 连接中先复用
三个正式成本场景，再覆盖库存/物料、配方/模板、客户/报价、订单/采购、
管理/质量、工厂知识、转子出图历史和统一业务变更的 18 个代表性只读工具，其中 `preview_recipe_cost`
分别执行无覆盖和覆盖两次，因此共 18 次代表调用。每次调用都必须返回
`mcp.verified=true`、能力 ID、正式数据源和数据模式；`get_recipe_detail` 还必须没有
大小写不敏感的重复键，且 `currentCost.currentTotalCost` 与 `compare_recipes` 同一配方的
`currentFullCost` 一致；无覆盖的 `preview_recipe_cost` 也必须返回同一口径，覆盖试算必须返回
`currentTotalCost/costBasis=overridePreview`、等值 `unitCost` 废弃别名及迁移说明；
`compare_recipes` 和 `explain_cost_change` 都必须是 `dataMode=live`。目录验收固定要求 48 个只读工具完整且
`readOnlyHint=true`；若验收身份已获得生产写灰度，只允许额外出现该 `clientId` 在
`MCP_WRITE_TOOL_ALLOWLISTS` 中的写工具，并要求 `readOnlyHint=false`，任何未知或越权工具都会使门禁失败。
使用显式 `MCP_VERIFY_TOKEN` 时必须同步设置其真实 `MCP_VERIFY_CLIENT_ID`，否则不能核对逐工具授权。最坏 36 个请求，低于生产默认
每分钟 60 次限制。综合结果写入 `logs/mcp-production-read-latest.json`，成本子报告仍同步到
`logs/mcp-production-cost-latest.json`；两份报告仅记录客户端 round-trip，服务端耗时仍只以
API 日志 `durationMs` 为准。空订单/报价/出图历史是允许的正式业务状态，不为覆盖详情而
制造生产数据；全部 48 个只读工具和缺价失败路径继续由隔离套件覆盖。

需要单独复核三个成本场景时仍可运行 `npm run verify:mcp-prod-cost`。

专项门禁通过后，提交/发布前继续运行项目级门禁：

```bash
npm run verify:api-contract
npm test
npm run test:deep-api
```

MCP tool、executor 或 AI 证据门变化还必须运行：

```bash
npm run verify:ai-release
```

Guardian 继续按项目阶段运行 focused/commit/push；它只观察，不替代上述 MCP 专项检查。

## 4. 变更边界

- V1 白名单覆盖注册表中全部已登记、无需确认的安全 Query/Preview；目录测试保证新增安全读能力不会静默遗漏，写工具、资源和 Prompt 不因客户端支持而自动开放。
- V2 可授权写目录当前显式审核 17 个同时声明 `access=write`、`operation=command`、`supportsPreview=true` 和 `requiresConfirmation=true` 的能力。配置未启用、身份不在 `MCP_WRITE_CLIENT_IDS` 或工具未列入该身份的 `MCP_WRITE_TOOL_ALLOWLISTS` 时，该工具不会出现在 `tools/list`，直接调用也由执行层拒绝。
- 写调用第一轮只执行正式 Preview 并签发主体绑定的短时确认；2026 客户端通过 `input_required`/form elicitation 展示给用户，明确接受后才由共享确认执行 service 调用正式 API。Agent 的文字、第二个“确认工具”或客户端自报名称都不能授权执行。
- 多轮 `requestState` 使用官方 SDK HMAC codec，并绑定已验证服务身份和方法；客户端篡改、换身份、换参数、过期或并发重放都会拒绝。状态密钥为单进程临时密钥，服务重启后未完成确认自动失效，符合当前 Mac Mini 单进程部署；改为多实例前必须配置共享持久状态。
- 2025 无状态客户端没有服务端到客户端 elicitation 回路，因此只读兼容不变，写工具不进入其 `tools/list`，直接调用也返回安全错误且不会执行。不能用普通 tool 参数或 Agent 文字降级绕过确认。
- 新增工具必须同时补 capability/schema、白名单审查、正式 API 证据测试、文档和两代客户端发现测试。
- 新增、删除或调整 MCP 写工具时必须同步更新 `scripts/mcp-write-acceptance-manifest.cjs`；清单与正式目录不一致会使 `verify:mcp-write-local` 失败，禁止只增加工具而没有隔离业务证据。
- `MCP_SERVICE_TOKENS` 中每个 clientId/token 必须唯一。轮换某一 Agent token 不应影响其他 Agent。
- `HERMES_MCP_*` 仅为一个兼容周期的部署别名；新部署统一使用 `MCP_*`。

## 5. 身份与凭证运维

MCP 身份不得再通过手工编辑生产 `.env` 维护。正式命令为：

```bash
npm run mcp:identity -- status --env-file .env
npm run mcp:identity -- verify --env-file .env
npm run mcp:identity -- list-backups --env-file .env
```

`add`、`rotate`、`revoke`、`grant-write`、`revoke-write` 和 `rollback` 默认只生成脱敏计划，不修改文件。新增或轮换
只能通过 stdin 或命名环境变量取得 token，命令显式拒绝 `--token <明文>`：

```bash
# 预览，不写文件
node scripts/manage-mcp-identities.cjs rotate \
  --env-file .env --client-id codex --token-stdin

# 正式写入
node scripts/manage-mcp-identities.cjs rotate \
  --env-file .env --client-id codex --token-stdin \
  --apply --confirm APPLY_MCP_IDENTITY_CHANGE
```

每次正式变更先在 `backups/config/mcp-identities/` 创建完整 `.env` 安全备份；Unix/macOS
目录权限为 `700`、文件权限为 `600`，不生成含 token、token 指纹或 token 哈希的备份元数据。
新配置先复用 `validateMcpConfiguration()` 验证，再以同目录临时文件原子替换。撤销身份会同时
删除它的 `MCP_WRITE_CLIENT_IDS` 和 `MCP_WRITE_TOOL_ALLOWLISTS` 投影；撤销最后一个写身份时
自动关闭 `MCP_WRITE_ENABLED`，不会留下悬空写权限。

`grant-write` 只能把已经存在于当前生产灰度集合中的写工具授予另一个已登记身份，不能借此
引入新的写工具。`revoke-write` 按身份撤销单个工具，撤销该身份最后一个写工具时同时把身份
移出 `MCP_WRITE_CLIENT_IDS`：

```bash
node scripts/manage-mcp-identities.cjs grant-write \
  --env-file .env --client-id codex --tool sync_factory_knowledge
node scripts/manage-mcp-identities.cjs grant-write \
  --env-file .env --client-id codex --tool sync_factory_knowledge \
  --apply --confirm APPLY_MCP_IDENTITY_CHANGE
node scripts/manage-mcp-identities.cjs revoke-write \
  --env-file .env --client-id codex --tool sync_factory_knowledge \
  --apply --confirm APPLY_MCP_IDENTITY_CHANGE
```

回滚同样默认预览，并在正式恢复前再创建一份当前状态安全备份：

```bash
node scripts/manage-mcp-identities.cjs rollback \
  --env-file .env --latest \
  --apply --confirm ROLLBACK_MCP_IDENTITY_CHANGE
```

Windows 日常维护 Mac Mini 使用包装命令；它在内存生成 48 字节随机 token，通过 SSH stdin
传给服务端，不把 token 放入参数或输出。远端写入成功后才更新指定的 Windows User 环境变量，
随后重启 API 并以 2025 兼容协议逐身份执行 `initialize + tools/list`。重启或在线验证失败时，
命令自动恢复服务端备份和原客户端环境变量：

```powershell
# 查询和在线验证
npm run mcp:identity:macmini -- -Action status
npm run mcp:identity:macmini -- -Action verify

# 将当前已灰度的写工具授权给另一个身份；同样先预览，再 Apply
npm run mcp:identity:macmini -- -Action grant-write `
  -ClientId codex -Tool sync_factory_knowledge
npm run mcp:identity:macmini -- -Action grant-write `
  -ClientId codex -Tool sync_factory_knowledge -Apply

# 轮换：先预览，再显式 Apply
npm run mcp:identity:macmini -- -Action rotate `
  -ClientId codex `
  -ClientTokenEnvVar PUMP_FACTORY_MCP_CODEX_TOKEN
npm run mcp:identity:macmini -- -Action rotate `
  -ClientId codex `
  -ClientTokenEnvVar PUMP_FACTORY_MCP_CODEX_TOKEN `
  -Apply

# 已存在于客户端环境变量的 token 可用 -UseExistingToken 登记；仍不输出 token
npm run mcp:identity:macmini -- -Action add `
  -ClientId new-agent `
  -ClientTokenEnvVar PUMP_FACTORY_MCP_NEW_AGENT_TOKEN `
  -UseExistingToken -Apply

# 撤销身份；提供 ClientTokenEnvVar 时同步删除 Windows User 环境变量
npm run mcp:identity:macmini -- -Action revoke `
  -ClientId new-agent `
  -ClientTokenEnvVar PUMP_FACTORY_MCP_NEW_AGENT_TOKEN `
  -Apply
```

正式回滚必须指定对应 `ClientId` 与 `ClientTokenEnvVar`。包装器从已恢复的 Mac Mini `.env`
经 SSH 内存通道取回该身份 token，并同步恢复 Windows User 环境变量，不在终端显示凭证：

```powershell
npm run mcp:identity:macmini -- -Action list-backups
npm run mcp:identity:macmini -- -Action rollback `
  -BackupFile /Users/dan/pump-cost-accounting-system/backups/config/mcp-identities/<backup> `
  -ClientId codex `
  -ClientTokenEnvVar PUMP_FACTORY_MCP_CODEX_TOKEN `
  -Apply
```

身份命令只管理认证映射和现有写权限投影，不负责扩大写工具集合。新增写工具仍必须走本指南
第 3、4 节的 capability、确认、隔离验收和单独生产授权流程。

## 6. 官方依据

- [MCP 2026-07-28 规范](https://modelcontextprotocol.io/specification/2026-07-28)
- [MCP 2025-06-18 Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)
- [TypeScript SDK v2 迁移与双协议兼容](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)
- [官方 Conformance Suite](https://github.com/modelcontextprotocol/conformance)
- [Node.js Windows fetch 退出阶段 libuv 断言](https://github.com/nodejs/node/issues/58091)
