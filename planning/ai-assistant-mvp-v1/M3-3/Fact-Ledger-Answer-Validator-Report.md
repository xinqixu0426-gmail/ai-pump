# M3-3 — Fact Ledger + Answer Validator

状态：实现候选（以本阶段完整门禁与 Supervisor 验收为准）。

## 请求内事实链路

```text
Formal tool result
  -> request-scoped Fact Ledger
  -> Main Agent draft envelope (claims + goals + factRefs)
  -> Answer Validator
  -> bounded verified answer
```

`api/services/ai-assistant/factLedger.cjs` 只在单个 Assistant 请求内存在，
不新增 SQLite 表或长期记忆。它为每次工具观察生成 append-only 记录；只有
`success=true` 且 `verified=true` 的正式工具结果可产生正式事实。正式 Ontology
的 `AMBIGUOUS`、`NOT_FOUND` 也分别保留为可核验的身份事实；技术失败只作为
`technicalFailure` observation，绝不转化为“不存在”或完成结论。

事实包含稳定的本轮 `factId`、已知实体 identity、predicate、value/unit、basis、
`FORMAL_API` authority、capability/tool provenance 与 verified 标记。通用字段投影
受边界限制，不执行成本、库存、毛利或订单算法；这些数值仍仅由正式 Executor /
Business API / costEngine 产生。附件与 Page Context 不会被写入事实账本，除非其
候选已经由正式 identity tool 另行验证。

## 最终回答边界

Main Agent 的最终模型消息是内部 JSON envelope，而用户仅收到其中通过校验的
自然语言 `answer`。每个 Judge question 必须有一个 `goals` 状态：
`COMPLETED`、`PARTIAL`、`UNAVAILABLE` 或 `CLARIFICATION`。在 READ / ANALYZE /
PERSIST_MUTATION 中，`COMPLETED` 必须引用至少一个 verified fact。每个业务 claim
也必须引用 verified fact；金额与百分比还会与 ledger 中的正式数值按安全舍入规则
核对。

无法解析 envelope、缺失 goal、引用未知/未核验 fact、无依据金额、无依据不存在
结论或内部 ID 泄露时，`answerValidator.cjs` 不会发送模型草稿，而返回受限的
“无法验证回答中的业务事实”提示。此 fail-safe 不会重试工具或触发写入。

受保护库存 proposal 仍是原有 Proposal → Owner confirmation → formal readback
链路；其给模型的投影不包含 confirmation token、internal part ID 或 operation
identity，M3-3 未增加任何写 capability。

## 基线缺口状态

- **M3B-04：CLOSED** — 普通请求不再以 `toolResults.length` 判断正式完成；
  failed formal tool 不能生成完成所需的 verified fact，验证器会 fail-safe。
- **M3B-05：CLOSED** — 每轮具备 Fact Ledger、claim-to-fact refs、金额/负结论
  边界与每目标状态验证。
- **M3B-06：OPEN** — 本阶段没有改变 SSE 分段、首字节或性能观测。

M3-0 的 24-case Baseline V1 保留未改写；M3-3 新增确定性账本/验证器测试而不是
删除历史失败证据。所有测试和任何真实模型验收须在 development / isolated 环境中
运行，业务写为零；本阶段不部署生产。
