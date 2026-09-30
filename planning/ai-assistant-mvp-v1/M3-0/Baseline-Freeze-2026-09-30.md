# M3-0 — AI Assistant 当前基线冻结与代码审计

日期：2026-09-30（Asia/Shanghai）
审计对象：`d330888` 的生产运行实例与对应源码
源码基线：`d3308883abde014c59a7b47b19adcf9bfd6ef09c`（`ai-native/prod-canary-s2`）
冻结状态：**PASS — 已记录静态架构、生产运行状态、真实 DeepSeek 只读样本与端到端延迟；未修改 AI 产品行为。**

## 1. 范围与证据等级

本阶段只审计和冻结，没有修改 API、schema、运行逻辑、生产配置或生产服务。生产工作树在审计时干净，运行提交为 `d3308883abde`；开发工作区已有的 `docs/` 与 `planning/` 改动保持不动。历史计划和旧运行报告仅作历史证据；当前事实以本次基线 commit 的源码和下面标出的生产样本为准。

证据标签：

- **源码确认**：从当前调用链和能力表直接核实。
- **确定性测试通过**：当前仓库测试通过，不代表真实模型问答通过。
- **历史运行证据**：来自不同 commit/时期的 Owner 或 production-shaped 记录，不可冒充当前基线。
- **真实生产样本**：以 Owner 身份通过实际 `POST /api/ai/chat` 调用已配置的 DeepSeek，未提交任何确认，且每轮 SSE 均返回 `provider / content / done`。
- **未测 / BLOCKED**：没有可用或被授权的证据；不得以推测替代。

## 2. 当前实际架构

```text
Web（提交 messages）
  -> Owner-only POST /api/ai/chat（SSE 包装）
  -> runAiAssistant
       -> Judge（DeepSeek，结构化 JSON，最多一次格式修复）
       -> 固定 Domain Policy 文本
       -> Main Agent（DeepSeek，固定只读工具集）
            -> Agent Tool 参数/本轮身份绑定
            -> 正式 AI executor -> Formal API / service
       -> Main Agent 自然语言答案
  -> SSE provider / content / done（写提案时另有 write_proposal）

写请求：Judge 分类 -> 服务器写开关 -> 仅库存调整提案工具
  -> Owner 在模型外确认 opaque token -> 正式 executor -> audit/readback
```

入口与执行位置：`api/routes/ai/chat.cjs` → `api/services/ai-assistant/runtime.cjs` → `judge.cjs` / `mainAgent.cjs` → `agentTools.cjs` → `api/routes/ai/executor.cjs`。旧 Task V2 / dispatcher 路径在当前 public chat 中已硬切；`npm run verify:ai-assistant-release` 通过。

该实现不是用户给出的后续 M3 目标架构的完整实现：Judge 是受限意图分类器；工具集静态枚举；没有动态 Capability Broker、运行时可编辑策略、跨类型 Ontology 解析层、持久 Fact Ledger，或独立 Answer Validator。

## 3. 能力覆盖冻结

### 3.1 当前 Main Agent 可用的 12 个只读/预览工具

| 工具 | 当前正式能力 |
| --- | --- |
| `find_recipe`, `list_recipes` | `get_all_recipes`，配方身份查询/有界目录 |
| `recipe_current_cost` | `preview_recipe_cost` |
| `compare_recipe_costs` | `compare_recipes` |
| `find_coils` | `search_coils` |
| `coil_inventory` | `search_coils` 当前库存投影 |
| `coil_cost` | `calculate_coil_cost` |
| `find_part` | `search_parts` |
| `part_inventory` | 本轮唯一正式零件候选库存 |
| `preview_part_stock_change` | 本地纯预览，未执行写入 |
| `preview_profitability` | `preview_profitability` |
| `preview_virtual_readiness` | `preview_virtual_readiness` |

### 3.2 单独的受保护写路径

提案模式另外只开放 `find_part` 与 `prepare_part_stock_adjustment`。当前可准备的持久化业务变更只有**单项零件库存调整**；正式执行须满足 Owner 身份、服务器写开关、冻结确认 token、正式命令回执与读回。普通只读工具目录不包含写工具。

### 3.3 当前未覆盖的 M3 目标能力面

- 工具曝光是上述固定 12-tool allowlist，不按意图/实体/页面上下文动态开放能力。
- Agent 没有模板/泵壳、报价、订单、采购、客户历史、经营概览、知识库/文件、技术档案、一般关系读取等工具；这些领域的旧系统/API 存在，不等于当前 Assistant 可调用。
- Agent tools 直接用目录 API 解析配方、线圈和零件；未接入正式 Ontology resolver 作为通用身份、别名及关系层。
- `domain-policy.md` 每轮从部署文件读取，是静态规则文本；没有 Owner 可编辑的产品内策略管理面。
- 当前前端请求可包含附件与 `pageContext`，但服务端 `plainMessages()` 只保留 role/content；`handleAiChat()` 没有把附件或页面对象送入 runtime。故当前 Assistant 主链不消费附件/PDF/Excel/图片或页面对象上下文。
- 服务器运行时只从请求消息中取最近 4 条前序 user/assistant 消息，每条截断 2,000 字符；Judge 和 Main Agent 再各自做同样有界化。请求中的 `conversationId` 不用于 runtime 历史检索；跨轮事实应重新查正式 API，但对话连续性依赖客户端消息列表。
- 正式工具投影及 `toolResults` 仅留在本轮 runtime 记忆中；未形成带“回答声明 ↔ 正式证据字段”映射的 Fact Ledger。
- 最终答案由 Main Agent 自由生成。运行时检查有非通用请求至少产生过一个 tool result、提案模式须有提案，并有一个针对毛利试算失败与金额文案的特殊保护；没有覆盖所有结果失败、事实引用、金额、完整性/多问题义务的通用回答验证器。

## 4. 已知缺陷与风险登记

以下为可由当前代码确认的结构性缺口，不等同于已实测用户事故；影响和复现条件需后续 M3 验收确认。

| ID | 现状 / 证据 | 用户影响 / 边界 |
| --- | --- | --- |
| M3B-01 | Web `streamAiChat()` 发送 `pageContext` 与带 `attachments` 的 messages；chat route 的 `plainMessages()` 仅映射 role/content，且 runtime 输入不含 pageContext/attachments。 | 页面/附件内容不能作为当前 AI chat 的上下文；当前代码未报错指出被忽略。 |
| M3B-02 | `AGENT_TOOLS` 是 12 项固定 allowlist；未按语义动态选取注册能力。 | 可用覆盖显著窄于旧系统 84 项 AI capability 目录及已有正式业务 API；跨域问题和多数业务域不可完成。 |
| M3B-03 | Policy 从源码 Markdown 文件读取；不存在运行时可编辑的 Domain Policy 管理能力。 | 工厂规则改动需更改部署资产，无法由 Owner 在产品内维护。 |
| M3B-04 | Main Agent 的形式证据要求以 `toolResults.length > 0` 为门槛；普通失败结果也计入长度。 | 从代码看，存在“工具执行失败但模型仍返回结论”的路径；只有毛利工具失败且答案包含金额时有专门兜底。尚未通过真实模型复现。 |
| M3B-05 | 没有 claim-level Fact Ledger / 通用 Validator；`toolResults` 和模型答复同在本轮内存，路由只向 SSE 发 answer content。 | 无法在发送前对每个业务声明与证据字段做系统性校验；当前主要依赖提示和 Tool 执行证据门。 |
| M3B-06 | route 只在执行结束后发送 `provider`、单个 `content`、`done`（及提案事件）；未发送 `status`、`tool_call`、`tool_result`、`metrics`。Main Agent 非流式调用；`runtime.durationMs` 只测 Main 阶段且未由路由输出。 | 用户端不能获得本轮阶段、工具过程或可靠总延迟/首字节/Token 性能指标；无法由当前通道冻结 P50/P95。 |
| M3B-07 | 自带 `verify-personal-assistant-local.cjs --focused` 仅用 `x-internal-secret` 调 Owner-only `/api/ai/chat`，不带 Owner JWT。该脚本不记录 HTTP 状态/非 SSE 正文，将非 SSE 错误解析为空事件，形成 11ms/3ms/2ms 的 `done=false`“答案”。 | 现有真实 AI 验收入口不能证明请求到达 Assistant，也不能作为回答或延迟证据。见 §6。 |
| M3B-08 | 真实样本中，模型在配方成本与技术档案拒答时写出了正式配方内部 ID。 | 该 ID 不是 Owner 需要的业务解释；答案投影/验证层应阻止内部标识泄漏。 |

## 5. 与前一 Owner 验收冻结的差异

`planning/ai-native-v1/release/S2-owner-baseline-2026-09-28.md` 记载的是较早产品基线 `d56de80` 的 Owner 生产验收，不是本次源码 commit。其能力含 canonical technical profile、订单/经营、客户历史、同会话连续查询等更宽覆盖。本次 `d330888` 的 Main Agent 工具面只有 §3.1 的 12 项；这些前序能力在当前 Assistant 主链中未开放，构成**能力面缩减**，即使对应正式服务/API仍存在。

旧 M0 审计（`planning/ai-assistant-mvp-v1/M0-audit/`）的代码基线是 `bc9f7ed`，记录了 Task V2；这条架构路径已在当前分支硬切，不能把其描述当作现在的 runtime。旧报告中提到的生产状态限制也不代表本次已验证的生产状态。

## 6. 真实回答与性能基线

### 真实生产样本：已冻结

生产 API 的运行提交为 `d3308883abde`，`ready=true`，API/Web LaunchDaemon 均为 `running`，已配置 Provider 为 `DeepSeek / deepseek-chat`。以下 9 次请求均以 Owner 身份通过实际生产 `POST /api/ai/chat` 发送；每次均得到 HTTP 200 与 `provider=deepseek, content, done`，没有 `write_proposal` 事件或持久化写入。

| 样本 | 结果 | 端到端耗时 |
| --- | --- | ---: |
| V550 当前正式成本 | PASS，268.49 CNY/台 | 5.250s |
| V550 成本 + 12-120 库存 | PASS，两个目标均答复 | 5.752s |
| V750 当前配置、售价 360 的毛利 | PASS，成本 288.76、毛利 71.24、毛利率 19.79% | 5.669s |
| O 型圈库存 +10 的不保存试算 | PASS，当前 1、试算 11、无提案 | 4.940s |
| 最近 5 个订单 | 安全拒答：当前无订单工具，不编造 | 3.930s |
| V550 技术参数 | 安全拒答：当前无技术档案工具；同时暴露内部配方 ID，见 M3B-08 | 4.241s |
| 连续对话：V550 成本 | PASS | 5.672s |
| 连续对话：那 V750 呢 | PASS | 4.697s |
| 连续对话：这两个差多少 | PASS，20.27 CNY/台 | 6.881s |

9 个样本的端到端均值为 **5.23s**，中位数为 **5.25s**，最小/最大为 **3.93s / 6.88s**。这是 HTTP 请求到完整 SSE `done` 的测量；当前传输只在最终完成时发送单个 `content`，没有 TTFT、模型 token、Judge/Main 分段或工具耗时事件。因此不应把这些数据误称为流式首字节或模型 P95。

这些样本证明已覆盖的能力可在真实 Provider 上工作，也客观确认固定工具面外的订单与技术档案请求会被拒绝。后续 M3 需用相同问题集、同一正式环境和相同完整 SSE 口径比较；若要比较模型、Judge、工具或首字节阶段，必须先新增可验证的受控观测，而不能从当前 SSE 推断。

## 7. 本次确定性验证

| 验证 | 结果 | 解释 |
| --- | --- | --- |
| `npm run test:ai-architecture` | 历史 PASS，9/9 | d330 发布验收记录中的统一执行证据门与写入证据门。 |
| `npm run verify:ai-assistant-release` | PASS（本次复跑） | public cutover 静态发布门。 |
| M1/M2-A/M2-B/HTTP cutover/runtime telemetry 定向测试 | PASS，31/31 | 使用沙箱批准的 localhost 测试监听后通过；真实 Provider 未调用。 |
| 真实模型 `verify-personal-assistant-local.cjs --focused` | INVALID HARNESS RESULT | 历史脚本仍缺 Owner JWT，不能用作 Assistant 回答或性能样本。 |
| Owner 生产 HTTP 真实样本 | PASS，9/9 | 见 §6；所有请求只读、无提案、无确认、无写入。 |
| 全量 `npm test` / build / deep API | 未运行 | 本阶段未改 API 或产品代码；与本次代码/确定性基线结论无关。 |

## 8. Supervisor 验收事项

## 9. Baseline V1 case 清单

`Baseline-V1-cases.json` 是本报告的机器可读 case 清单。它严格包含 24 条：9 条 `REAL_MODEL`、8 条 `DETERMINISTIC` 和 7 条 `STATIC_AUDIT`。每条都注明当前 d330 的预期边界和证据来源；它不驱动 runtime、不会改变工具选择或业务路由。

M3-0 的静态架构、能力、缺口、生产运行状态和真实 DeepSeek 只读样本已冻结在本报告。阶段状态为 **PASS**：这不表示当前能力面已经满足后续 M3 目标，而是说明 `d330888` 的可用能力、明确缺口、失败边界与可比较的端到端性能口径已被客观记录。完成本阶段后不实施 M3 优化。
