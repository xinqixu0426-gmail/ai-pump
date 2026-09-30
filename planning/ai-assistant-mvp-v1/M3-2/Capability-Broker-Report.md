# M3-2 — Ontology + Capability Broker

状态：实现候选（以本阶段测试和发布门结果为准）。

## 运行时边界

普通 Assistant 请求现在采用下列有界链路：

```text
Judge domains + 已验证实体上下文
  -> Ontology Agent resolver
  -> Capability Broker
  -> Base identity tools + selected formal READ/PREVIEW tools
  -> formal Executor
```

`api/ontology/agentResolver.cjs` 是 Agent-facing adapter，复用正式
`/api/entity-lookup` 和 Executor；它不会读取业务数据库、计算成本或猜测 ID。
每个解析结果都明确为 `RESOLVED`、`AMBIGUOUS`、`NOT_FOUND` 或 `INCOMPLETE`。
只有 `RESOLVED` 的 `canonicalId` 可以绑定给后续实体型 capability。页面 `resourceId`
只是候选，必须再经正式 detail capability 验证。

`api/services/ai-assistant/capabilityBroker.cjs` 从正式
`api/capabilities/registry.cjs` 选择能力。它只接受 registry 的 `query` / `preview`
记录，最多选择 10 个动态工具；加上两个 identity tools，每轮最多向普通 Main Agent
暴露 12 个工具。写能力不经 Broker；库存写仍是受保护 Proposal flow。

## 覆盖口径

- AI registry capability 总数：84
- registry 的 READ/PREVIEW capability 总数：55
- 当前 Broker profiles：`recipe`、`coil`、`part`、`catalog`、`cost`、`inventory`、
  `order`、`quotation`、`customer`、`procurement`、`technical_profile`、
  `business_history`、`knowledge`、`file`、`template`、`general`
- 固定 base tools：`resolve_entity`、`resolve_page_context_entity`
- 动态 tools：由 Judge 的 1–4 个 domain tags 和已验证实体类型选择，均须存在于
  正式 registry 与 Executor adapter。

这不是“registry 覆盖率”声明：profile 未列出的正式 capability 不会因模型知道名字而
获得执行权。被选择之外、未知、写入或无已验证实体 ID 的调用都在执行前拒绝。

## M3-0 基线处理

`M3-0/Baseline-V1-cases.json` 保留为 24-case Before 证据，未改写历史预期。
本阶段关闭 M3B-02（固定 12-tool allowlist）；M3B-04、M3B-05、M3B-06 仍未处理。
真实模型验收只能在隔离 production-shaped DB 上进行，且不得执行业务写。

## 业务逻辑边界

新增 adapter 仅作：正式 identity binding、schema translation、capability selection、
结果投影和内部字段脱敏。成本、库存、毛利、订单状态与采购结论仍由现有 Executor /
Business API / costEngine 产生；本阶段没有新增业务算法或持久化写能力。
