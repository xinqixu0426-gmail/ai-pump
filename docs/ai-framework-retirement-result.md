# V5 框架撤除结果

日期：2026-09-07。本记录描述旧框架撤除阶段；后续新版助理已实现并获用户本地人工验收通过，当前状态见 [实施计划](ai-assistant-implementation-plan.md)。撤除操作本身是删除旧框架和撤下其生产接入，不是发布新版助手。

## 本地代码

- 删除 225 个框架专用文件：80 个 `api/services/ai-v5` 模块，以及 Candidate 数据库/风险/会话/网关适配、专用运行脚本和测试。空的 `ai-v5` 目录也已删除。
- 从聊天路由移除 canary preview 和 authority mux；从原调度器、工具校验和观测模块移除 V5 shadow 接线。
- 撤除只供 Candidate 使用的 `read_collection`、`read_relation` 工具及其分派，保留正式集合/关系/实体业务 service 和 API 契约测试。关系 router 当前仍未在主 `api.cjs` 挂载，不能宣称生产已有此接口。
- `.guardian` 在本次开始前已不存在，未重建。历史报告仍保留原始通过率及失败原因；新增档案入口说明它们不再是当前框架指令。
- 原来的 24 个未提交文件已复制到独立临时目录并记录 SHA-256。22 个文件保持字节完全相同；另外两个是本任务需同步的 `docs/README.md`、`docs/api-reference.md`，其中用户原有新增行仍完整保留。旧 `output/` 未清理。
- 撤除阶段保留了用户未提交的 `scripts/prepare-p16m-release.cjs`。随后用户授权 V1 发布前清理，该失效的历史单次脚本已随临时产物归档到项目外；正式启动和发布流程不依赖它。
- 本次未提交、未推送，也未运行常规发布脚本；当前工作区包含本任务删除及用户原有修改。

## 真实本地验证

| 检查 | 结果及边界 |
|---|---|
| API 契约 | 26/26，通过 |
| 完整自动测试 | 1816/1816，通过；退役专用测试随框架删除，不能与旧 2313 等计数直接比较 |
| 最后观测清理的聚焦回归 | 28/28，通过；覆盖正常结果、异常传播、旧 shadow 开关无效、正式客户关键词分页零写入 |
| 任务改动范围 ESLint | 18 个文件，通过 |
| Next 构建 | 通过 |
| 原始深度 API 命令 | **未通过**：真实外部铜价请求 `fetch failed`，运行在 MCP `get_copper_price` 处中止 |
| 明确替换外部铜价的隔离深度 API | 437/437，通过；只在临时测试副本中为该外部 URL 提供铜价数据，正式 API、成本服务、SQLite 事务和断言均未跳过。此结果不证明真实行情网络可用 |

完整测试首次为 1810/1812：旧内部 canary 文档行及 AI 工具总数未同步，修正文档后再验证为 1816/1816（另新增四项撤除/保留能力测试）。首次记录保留。局部 lint 曾发现删除 shadow 采样后留下的无用变量，已删除并完成相应聚焦回归。

本地证据：`output/framework-retirement/` 下的 `snapshot.json`、`delete-manifest.json`、`api-contract-final.log`、`tests.log`、`tests-final.log`、`focused.log`、`observability-final.log`、`lint-final.log`、`build.log`、`deep-api.log`、`deep-api-offline-copper.log`。删除清单最初包含 224 个文件，后另删除依赖已退役 Candidate 的 `certify-owner-authentication.cjs`，合计 225 个。

## Mac Mini

已删除 Cloudflare 上本站的两条精确 AI 转发规则：普通 chat 和内部 owner-read-canary。其他转发规则保留。普通 `/api/ai/chat` 现在通过既有兜底规则进入 Legacy。

已停止 `org.pump.v5-owner-candidate` 和 `org.pump.v5-owner-gateway` 两个用户级服务，并禁用二者自启动；其独立 `runtime.json` 的 enabled 设为 false，owner-default 开关关闭。3102、3103 已验证不可连接。

生产核验：

- 原密码登录及身份检查通过。
- 直接 Legacy 与公网聊天均完成 `search_customers` 只读工具和完整 SSE `done`，包括携带 `conversationId` 的现有请求形态；没有调用写工具。
- Legacy PID 始终为 **59155**，revision 为 `12fee179b6074215cf359bcc1a789ce1a345b9ba`，服务就绪。
- Legacy Git diff、前端 build ID、数据库 SHA-256/大小/修改时间、备份清单和 `.env` 哈希在本次操作前后一致；未修改或重启 Legacy，没有生产业务数据写入。

第一次撤除在检查 launchd 退出状态时过早判断失败，执行了自动恢复；随后实际检查确认原 c98dd7e Candidate 可用、网关重新运行、owner-default 恢复。修复为先禁用自启动并等待服务退出（有期限），第二次撤除成功。不是忽略发布失败继续操作，也没有改写首次失败。恢复后的 Candidate PID 为 83313，网关 PID 为 83898；Legacy 仍为 59155。

生产证据与恢复材料保存在 `/Users/dan/pump-framework-retirement-20260907/`；旧稳定 Candidate 制品保留为回滚档案，不在运行。独立 helper 仅操作上述两个服务及本站两条精确 AI 转发规则，禁止覆盖并发修改的其他 ingress。恢复命令只在明确要求回滚时使用：

```text
node /Users/dan/pump-framework-retirement-20260907/retire-production.cjs restore
```

自动恢复路径已经在本次首次失败中实际走过并核验；新增的手动 restore 子命令已提供，但没有为演练再度把已撤除框架启用。不能将其表述为手动恢复命令已实测。

## 保留事项

1. 独立登录兼容服务仍运行在 3104，现有凭据未修改。新版实施时再合并登录入口，避免现在使已有密码失效。
2. 原生产 V3、本地 V4 实验与用户未提交的调查/回答改动仍保留。本次删除的是新建 V5 Candidate 框架，不是清空所有 AI 功能。生产 revision 不含本地 V4 调查运行器，不应把本地实验当成已部署能力。
3. 真实外部铜价网络失败仍是验证限制；测试数据结果不能替代该依赖的真实可用性。
4. 新版个人记忆、轻量工具循环、全新候选交互及统一业务写确认尚未实现，也没有启用新的业务写权限。

## 第二次复核

按用户“再次检查是否移除干净”的要求重新读取实际源码和 Mac Mini 状态：

- 对 509 个仍存在的受版本管理 `.cjs` 文件进行语法树扫描，没有指向已删除 V5/网关/会话模块的实际 `require`，没有缺失的相对 `.cjs/.json` 字面导入。此扫描不把测试中的源码断言字符串误认为导入，也不声称能枚举所有动态路径。
- `api/services/ai-v5`、`.guardian` 均不存在。保留的 22 个原有代码/文档/脚本文件仍与撤除前快照逐字节一致；另外两个已合并的权威文档在上次检查中确认保留用户原有新增行。
- 当前执行入口/工具目录相关检查 30/30 通过。本轮没有重复真实 AI 或外部铜价测试；上一轮真实铜价网络失败限制仍保留。
- Mac Mini 的 candidate/gateway 均未注册，两个自启动项目均 disabled，3102/3103 不可连接；runtime.enabled 和 owner-default 均为 false；两条 V5 AI ingress 均不存在，其余 ingress 与撤除时相同。
- Legacy 仍就绪，PID 59155、原 revision 不变；源码 diff、数据库和 `.env` 哈希与撤除前一致。生产配置中的三个 V4 实验开关均未启用。

结论：**V5 的业务执行链和自动启动接入已清理干净；不是所有相关文件及配置都已物理删除。**仍有现有凭据依赖的 3104 登录兼容、已禁用的 launchd 定义/运维状态、回滚制品、历史报告，以及用户未提交的旧单次发布脚本。它们均已明确列出，不作为“零残留”宣称；不能仅因文本包含 V5 就删除现有凭据或用户文件。下一步可进入新版方案审核，尚未授权实现新版。

证据：`output/framework-retirement/recheck-local.json`、`recheck-production.json`、`recheck-tests.log`。本次只增加复核记录、细化实施计划和只读运维检查能力，未改变生产路由、服务配置或业务数据。
