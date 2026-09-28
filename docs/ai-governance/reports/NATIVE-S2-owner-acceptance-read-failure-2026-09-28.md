# AI-Native S2 Owner 验收只读失败调查报告

日期：2026-09-28  
状态：**BLOCKED / 当前不通过 Supervisor 验收**  
范围：Owner 只读 AI-Native 生产形状运行时  
调查性质：只读诊断；本报告未修改代码、配置、数据库或运行服务

## 1. Executive Summary

Owner 人工验收中的两条基础只读请求均返回：

> 该目标当前未能形成可验证的正式结果。

失败请求为：

1. `12-120`
2. `列一下配方`

这不是业务数据缺失、线圈/配方 API 失败或数据库写入失败。两轮请求都完成了 HTTP 200，DeepSeek 各被调用两次，但正式业务工具调用均为 0。失败发生在“模型语义提取 → TaskProposalV1 → 正式工具执行”边界之前。

调查确认两个独立问题：

1. **生产 Provider 返回形状与语义解析器输入契约不一致。** `fetchAiProvider()` 返回原始 WHATWG `Response`，Native Controller 未解码就交给只接受已解析 JSON 对象的 `parseProviderCandidate()`。首次解析和格式修复轮都会得到 `PROVIDER_EMPTY`，随后安全回退为确定性 `OTHER` 目标，最终渲染通用限制句。
2. **“列一下配方”缺少 Native 正式能力登记。** 当前 `GoalKindV2` 没有配方目录查询目标，结构化读取注册表也没有对应 `get_all_recipes` 的目标映射。即使修复 Provider 响应解码，该问法仍没有完整、正式、可验证的 Native 执行路径。

因此，本次结果不能按“偶发模型波动”处理，也不能只替换用户可见兜底文案。当前 Owner 只读切换应保持阻断，直到公共 Provider 边界和配方目录能力同时修复并完成生产形状复验。

## 2. Runtime and Revision Evidence

验收页面实际连接的运行实例不是 Documents 工作区进程，而是：

- API 监听：`:3002`
- Web 监听：`:3000`
- API 进程工作目录：`/Users/dan/pump-cost-accounting-system`
- 数据库：`/Users/dan/pump-cost-accounting-system/pump.db`
- 分支：`ai-native/prod-canary-s2`
- 提交：`a80e60e feat(recipe): freeze legacy technical authority`
- Native 启动状态：`mode=owner`、`authority=owner-scoped-native`、`writeEnabled=true`

Documents 工作区与运行目录检查时处于同一分支和同一提交；三个关键源文件无差异。因此该问题不是“页面仍运行旧代码”造成的版本漂移。

## 3. Reproduction Evidence

生产形状数据库中，会话 `70` 保留了本次人工验收消息：

| 消息 ID | 本地时间（Asia/Shanghai） | 角色 | 内容 |
| --- | --- | --- | --- |
| 410 | 2026-09-28 16:13:43 | user | `12-120` |
| 411 | 2026-09-28 16:13:49 | assistant | `该目标当前未能形成可验证的正式结果。` |
| 412 | 2026-09-28 16:14:02 | user | `列一下配方` |
| 413 | 2026-09-28 16:14:07 | assistant | `该目标当前未能形成可验证的正式结果。` |

两条 assistant 消息的持久化指标如下：

| 请求 | Provider / Model | 总耗时 | modelRequestCount | toolCallCount | toolResults |
| --- | --- | ---: | ---: | ---: | --- |
| `12-120` | DeepSeek / `deepseek-v4-flash` | 4691 ms | 2 | 0 | `[]` |
| `列一下配方` | DeepSeek / `deepseek-v4-flash` | 4330 ms | 2 | 0 | `[]` |

API 日志同时证明两次 `POST /api/ai/chat` 均返回 HTTP 200：

- `2026-09-28T08:13:48.575Z`，4695 ms
- `2026-09-28T08:14:06.932Z`，4330.7 ms

结论：传输请求本身成功，用户看到的是 Native 安全失败答案，不是 HTTP 异常页。两轮均未进入正式业务工具，因此不能把失败归因于 `search_coils`、`get_all_recipes`、SQLite 数据或成本服务。

## 4. Full Failure Chain

实际调用链如下：

```text
POST /api/ai/chat
  → runAiDispatcherV3
  → runAiTaskControllerV2
  → extractTaskSemanticsV2
  → fetchAiProvider(..., toolChoice=required)
  → 原始 HTTP Response
  → parseProviderCandidate(Response)
  → PROVIDER_EMPTY
  → FORMAT_REPAIR_ONLY 再调用一次模型
  → 再次收到原始 HTTP Response
  → 再次解析失败
  → PROPOSAL_VALIDATION_FAILED
  → 回退 deterministic proposal
  → goal kind = OTHER
  → UNSUPPORTED / LIMITATION_V1
  → “该目标当前未能形成可验证的正式结果。”
```

### 4.1 Provider transport mismatch

关键代码边界：

- [`api/services/aiDispatcherV3.cjs`](../../../api/services/aiDispatcherV3.cjs) 将 `fetchAiProvider` 注入 Native Controller。
- [`api/services/aiTaskControllerV2.cjs`](../../../api/services/aiTaskControllerV2.cjs) 第 1242–1247 行把 Provider 返回值直接交给 `extractTaskSemanticsV2`。
- [`api/services/aiProvider.cjs`](../../../api/services/aiProvider.cjs) 第 1037–1049 行成功时返回原始 `Response`。
- [`api/services/aiTaskSemanticsV2.cjs`](../../../api/services/aiTaskSemanticsV2.cjs) 第 298 行只读取 `response.choices[0].message` 或把输入当 message，不会调用 `response.json()`。
- 同文件第 343–359 行在首次解析失败后执行一次格式修复；第二次仍经过相同不兼容边界，最后回退到确定性 proposal。

这解释了持久化指标中的 `modelRequestCount=2`：一次正常语义提取加一次格式修复。它不是两个正式读取步骤。

### 4.2 Deterministic fallback behavior

不带 Provider 运行确定性语义提取时：

- `12-120` 能识别一个 `coil` subject，但目标仍为 `OTHER`。
- `列一下配方` 没有 subject，目标为 `OTHER`。

因此 Provider 解析失败后，两条请求都会稳定进入不支持目标，而不是偶发失败。

### 4.3 Missing recipe-catalog capability

[`api/services/aiTaskContractV2.cjs`](../../../api/services/aiTaskContractV2.cjs) 的 `GoalKindV2` 当前包含 `CURRENT_COST`、`RECIPE_COST_COMPARISON`、`COIL_QUERY` 等，但没有“配方目录查询”目标。

[`api/services/aiTaskStructuredReadsV2.cjs`](../../../api/services/aiTaskStructuredReadsV2.cjs) 也没有“配方目录目标 → get_all_recipes → 完整目录事实”的登记。现有 `get_all_recipes` 只在其他目标的内部解析/绑定流程中使用，不能替代一个用户可见、可验证、覆盖完整性的配方目录能力。

所以 `列一下配方` 是真实能力缺口，不应通过提示词把它勉强映射为当前成本、单配方查询或通用 `OTHER`。

## 5. Why Existing Evidence Did Not Catch It

现有确定性测试和多数 live harness 注入的是已经解析完成的 Provider JSON 对象；例如 live semantics runner 自己执行 `response.json()` 后再传给 `extractTaskSemanticsV2`。这与生产 Dispatcher 注入原始 `fetchAiProvider()` 的形状不同。

已有生产形状验收还存在覆盖偏差：

- 能直接由 deterministic semantics 判定的简单目标不一定触发 Provider 解析边界。
- 既有真实模型证据证明了模型协议在 harness 中可用，但没有证明真实 `/api/ai/chat` Dispatcher 对 `Response` 的解码兼容。
- 配方成本、配方比较已有目标，不等于“列出全部配方”已经登记为独立能力。

因此原有绿灯不能作为这两条人工验收请求的通过证据。

## 6. Impact Assessment

### 6.1 Confirmed impact

- 任何需要 `MODEL_ASSISTED` 语义提取、且走生产 `fetchAiProvider` 注入路径的 Owner 只读请求，都可能在正式工具执行前失败。
- 精确线圈简写 `12-120` 当前受影响。
- 配方目录请求当前无正式 Native 能力，无论 Provider 是否成功都不应宣告支持。
- 用户只能看到泛化限制句，无法区分“能力未登记”和“模型响应适配失败”。

### 6.2 Safety impact

- 本次两轮 `toolCallCount=0`，未执行业务工具。
- 没有业务数据库写入证据。
- 没有成本、库存、配方事实被伪造或错误展示。
- Fail-closed 安全边界生效，但可用性与可诊断性不合格。

### 6.3 Acceptance impact

Owner 只读运行时当前不能通过 Supervisor 验收。基础目录和精确线圈问法属于核心读能力，不应以通用限制句作为可接受降级。

## 7. Required Remediation

### R1. Normalize Provider response at one common boundary

在最低正确公共层建立明确的非流式 Provider 响应契约：

- 接受生产 `fetchAiProvider()` 返回的 WHATWG `Response` 并只消费一次 body；
- 解码为标准 Provider payload 后再进入 `parseProviderCandidate()`；
- 保持测试注入的已解析对象兼容；
- HTTP 非 2xx、非法 JSON、空 choices、错误 tool name 和 schema 错误继续分别 fail closed；
- 初次提取和 format-repair 必须共用同一归一化路径，禁止只修首次调用。

不建议让多个业务解析器各自猜测 `Response` 形状，也不建议用兜底文案掩盖 transport mismatch。

### R2. Add a formal recipe-catalog goal

按项目 API SOP 完整登记配方目录能力，至少包含：

1. Goal/能力登记；
2. schema 与 validation；
3. 正式 `get_all_recipes` service/tool 执行；
4. 完整性与空结果语义；
5. receipt → fact → answer 投影；
6. 自动化契约测试；
7. `docs/api-reference.md`，必要时同步 `docs/README.md`。

目录结果必须明确区分：完整空目录、有限结果、读取失败和不支持请求。不能把目录摘要冒充单一配方的当前完整成本。

### R3. Make exact coil shorthand deterministic where safe

对于完整匹配 `规格-片数` 形状的线圈简称，可在服务器确定性语义层生成 `COIL_QUERY`，再由正式目录处理唯一、多候选和零命中。这样基础目录入口不依赖模型可用性，同时不绕过正式实体绑定。

### R4. Improve user-visible limitation precision

保留 fail-closed，但至少区分：

- 语义提取技术失败；
- 正式能力尚未开放；
- 对象未找到；
- 正式读取失败或结果不完整。

用户文案不得暴露内部错误码，但 detail/telemetry 应保留稳定 reason code 供验收和运维定位。

## 8. Mandatory Regression and Acceptance Matrix

### 8.1 Deterministic tests

必须新增以下测试：

1. Provider 返回已解析 JSON 对象：正常通过。
2. Provider 返回真实 WHATWG `Response`：正常解码并执行。
3. 首次非法、repair 返回 `Response`：repair 正常解码。
4. body 非 JSON、空 choices、错误工具名、无 tool call：分别安全失败且 reason code 稳定。
5. Response body 不得被重复消费。
6. `12-120`：进入正式线圈目录，零写入。
7. `列一下配方`：进入正式配方目录，返回完整列表或正式空结果。
8. 不存在的线圈/配方：给范围受限的正式负结果，不给通用限制句。

### 8.2 Production-shaped HTTP acceptance

必须通过真实 `POST /api/ai/chat`，不能只调用内部 semantics 函数：

| 输入 | 最低通过条件 |
| --- | --- |
| `12-120` | 至少一次正式 `search_coils` 回执；答案含正确候选或范围受限负结果；不能是通用限制句 |
| `列一下配方` | 至少一次正式 `get_all_recipes` 回执；答案覆盖正式目录；不能是通用限制句 |
| 一个需要 model-assisted 的复合只读问法 | Provider payload 被正确解码，正式工具执行，answer contract 通过 |
| Provider 返回非法 payload | 零工具误执行、零写入、detail 含稳定技术失败分类 |

每条均检查：HTTP/SSE 完整结束、model request 次数、tool call/result、正式 receipt/fact、最终正文、零业务写入。

### 8.3 Project gates

由于修复将触达 Provider/Native 调度边界并新增或修改 AI/API 能力，完成前至少运行：

```bash
npm run verify:api-contract
npm test
npm run test:deep-api
npm run build
```

此外应执行针对上述三类真实问法的生产形状 DeepSeek 验收，保留原始失败记录，不用成功重跑覆盖本报告证据。

## 9. Supervisor Decision Requested

建议 Supervisor 作出以下决定：

1. **当前 Owner 只读验收判定为 BLOCKED。**
2. 授权以 R1–R4 为一个完整修复包实施，不接受只改提示词或兜底文案。
3. 修复后以第 8 节矩阵重新验收；在真实 `/api/ai/chat` 证据完成前，不宣告基础只读能力通过。
4. 本报告不构成部署、推送、生产重启、扩大写权限或切换更多用户流量的授权。

## 10. Final Verdict

**VERDICT: FAIL / BLOCKED**

安全降级本身有效，但正式只读能力没有形成可验证结果。直接根因是生产 Provider transport 与语义解析契约断裂；同时存在未登记的配方目录能力。两者都必须修复并经生产形状 HTTP 验收后，才能重新提交 Supervisor 审核。
