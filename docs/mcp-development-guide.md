# 通用 MCP 开发与发布流程

本文是本项目 MCP 层的实施基线。协议事实以 MCP 官方规范和官方 TypeScript SDK 为准；业务事实仍以 capability registry、正式 API 和 `docs/api-contract.md` 为准。

## 1. 兼容目标

| 客户端类型 | 协议路径 | 服务端行为 |
|---|---|---|
| 2026-07-28 及后续兼容客户端 | 先 `server/discover`，每个请求携带协议/客户端/能力 `_meta` | 官方 SDK v2 modern 无状态处理；校验标准 MCP 头与信封 |
| Hermes 等 2025 Streamable HTTP 客户端 | `initialize` → `notifications/initialized` → 普通请求 | 同一 server factory 的 `legacy: stateless` 回退，不维护第二套工具目录 |
| 不受控第三方多租户 | 暂不支持 | 先实现 MCP OAuth 2.1 Resource Server、Protected Resource Metadata、audience/scope，再开放 |

`serverInfo` 和客户端自报名称仅用于兼容/日志显示，不能决定授权身份。授权身份只来自服务端验证过的 service token。

## 2. 标准开发流程

1. **规范与影响面**：确认目标协议版本、旧客户端兼容期、调用方和传输方式；先读 `docs/api-contract.md`、`docs/api-sop.md`。
2. **能力登记**：工具必须先存在于 AI capability registry 和唯一 `AI_TOOLS` schema。MCP 只维护显式允许列表，不复制业务实现。
3. **Schema**：`inputSchema` 直接复用唯一 AI schema；公开 `outputSchema`；结果同时返回 `structuredContent` 和等价文本 JSON。
4. **执行链**：`tools/call` 只委托统一 executor → internal API client → 正式 API；没有 `aiExecutionEvidence` 不得返回业务事实。
5. **安全**：默认关闭；Host/Origin 校验、每 Agent 独立 token、恒定时间比较、限流、结果大小上限、脱敏日志。禁止 token passthrough，禁止使用 `INTERNAL_SECRET`。
6. **协议实现**：使用官方 SDK；一个 server factory 同时服务 modern/legacy，避免能力漂移；无状态服务不签发 `Mcp-Session-Id`。
7. **测试**：目录安全单测、输入/输出 schema、拒绝写能力、证据门、认证/限流/Origin、超大结果；再用旧版客户端和当前客户端各做一次真实 HTTP 发现与调用。
8. **一致性**：运行官方 conformance 中与本服务声明能力相符的 `server-initialize`、`ping`、`tools-list`、`dns-rebinding-protection`。完整 active suite需要测试专用图片/音频/资源/Prompt 夹具，不得把缺少未声明能力误判为产品失败，也不得因 CLI 返回码为 0 把失败摘要误判为通过。
9. **文档与发布**：同步 `api-reference`、部署清单、`.env.example`；先保持默认关闭。发布后用每个 Agent 自己的 token 验收发现、只读调用、401、审计身份和写工具不可见。

## 3. 本项目门禁

日常开发先运行本地 MCP 专项门禁：

```bash
npm run verify:mcp-local
```

该命令依次执行 MCP 协议/安全单测、官方 conformance 场景，并从本地
`pump.db` 只读备份出临时数据库，启动隔离 API 后通过真实 HTTP 让 Hermes
兼容的 2025 客户端和通用 2026 客户端分别发现并调用全部 12 个只读工具。
隔离验收同时覆盖未授权请求、畸形 JSON、请求体上限、已验证业务负结果、
数据库完整性和外键检查；完成后停止子进程并清理临时目录，不修改源数据库。

Windows Node 24 当前可能在官方 conformance CLI 已完整输出“0 failed、0 warnings”
后，于进程退出阶段触发 `UV_HANDLE_CLOSING` 断言。测试脚本只在 Windows、
成功摘要完整、没有 `FAILURE`、且断言是输出末尾唯一退出异常时将其记为明确的
CLI 兼容警告；任何场景失败、摘要缺失或其他非零退出仍使门禁失败。该问题对应
Node.js 的 Windows `fetch`/强制退出竞态，而不是放宽 MCP 场景判定。

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

- V1 只开放固定的 Query/Preview；写工具、资源和 Prompt 不因客户端支持而自动开放。
- 新增工具必须同时补 capability/schema、白名单审查、正式 API 证据测试、文档和两代客户端发现测试。
- `MCP_SERVICE_TOKENS` 中每个 clientId/token 必须唯一。轮换某一 Agent token 不应影响其他 Agent。
- `HERMES_MCP_*` 仅为一个兼容周期的部署别名；新部署统一使用 `MCP_*`。

## 5. 官方依据

- [MCP 2026-07-28 规范](https://modelcontextprotocol.io/specification/2026-07-28)
- [MCP 2025-06-18 Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [TypeScript SDK v2 迁移与双协议兼容](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)
- [官方 Conformance Suite](https://github.com/modelcontextprotocol/conformance)
- [Node.js Windows fetch 退出阶段 libuv 断言](https://github.com/nodejs/node/issues/58091)
