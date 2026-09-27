# Ontology V2 Reference Entity Template

> Coil 是第一个 `OWNER_REVIEWED_REFERENCE_PROFILE`。这是开发期、合同期材料：不会读取、写入或改变任何生产业务行为。

## 这套模板解决什么

Ontology V2 把“业务知识怎样被描述”与“运行时怎样执行”分开。Coil 证明后续实体可以主要通过声明资料加入，而不必为每个普通字段、别名或展示规则改 validator 或 AI 运行逻辑。

```text
Entity Profile
├── Identity
├── Designations
├── Facts
│   ├── presentation metadata
│   ├── business roles
│   └── source / provenance
├── Selection Policy (optional)
├── Eligibility Policy (optional)
├── Domain Policy (optional)
└── Relation Bridge (optional)
```

## 哪些是通用 Ontology 概念

- canonical identity、可重复或唯一的 designation，以及 designation 碰撞安全规则；
- Fact 的数据类型、单位、可搜索性、候选选择证据、展示分组和时间语义；
- 受声明式 Role Catalog 约束的多重 business roles；
- 可选的 selection、eligibility、costing 与 relation policy；
- RAW current resource、FORMAL projection、declarative derivation、unresolved semantic gap 等来源形态；
- authority、来源引用和 runtime disabled 的 fail-closed 校验。

这些概念不包含 `coil` 字段名、12-120、或固定实体/字段/关系数量。

## 哪些是 Coil 专属知识

- `coil.id` 为 canonical identity，`spec + sheets` 为 12-120 常用叫法；
- 正常候选证据是 schemeCode、spec、sheets、material、slotType、电压、频率；
- `official/testing/disabled` 生命周期语义，calculated/kit 成本策略；
- 主信息为成本、线重、电容和电缆横截面；绕组资料为按需技术事实；
- `coilRow` 对槽眼、直径和 commonName 的实际投影/回退路径；
- 现有 `coils.is_default` 是局部物理分组标记，而目标 AI fallback default 的正式持久化来源仍未证明。

## 后续实体怎样套用

Part、Recipe、Template 应先声明其自身 canonical identity、Facts、来源和业务角色。它们可选择：

- 无 designation 或一个唯一/非唯一 designation；
- `selectionPolicy = NONE` 或既有的选择 policy；
- `eligibilityPolicy = NONE` 或既有生命周期 policy；
- `costingPolicy = null` 或已有领域 policy；
- `relationBridge = null` 或既有关系桥接机制。

本票的 test-only `future_part` 证明这些可选组合无需修改 validator。它不是 Part 的生产 profile，也不修改 API。

## 可只改 Ontology 定义的普通知识扩展

- 新增普通 Fact、标签、单位、搜索性、展示元数据或来源映射；
- 给 Fact 使用已声明 role，或在 Role Catalog 中声明一个新 role；
- 新增 common designation、唯一业务 designation、别名/碰撞语义；
- 配置已存在的 policy 类型、生命周期值和关系元数据；
- 用既有 source contract 增加 raw resource、formal projection 或 declarative derivation 的来源声明。

这些变更仍须有来源审计和合同测试，但不需改 validator 或 AI/runtime plumbing。

## 合理需要代码的边界

- 新外部数据适配器或新的 source protocol；
- 新业务算法、计算引擎或 policy 执行语义；
- 新写能力、数据库迁移或 API 契约；
- 尚不存在的 runtime Entity Linking、LLM、解析器或 alias learning。

目标不是“永远不写代码”，而是“添加业务知识不必修改 AI/runtime 逻辑”。

## Coil 的未决边界

`coils.is_default` 已有权威的局部业务范围：`official + stator_variant_id + sheets`。它不能证明等同于 Owner 语义中“明确条件筛选后的最终候选集 fallback default”。V2 以 `UNRESOLVED` source 明示这个差距；在其正式来源与执行语义落地前，任何 runtime 都不得把它当作 AI fallback default。

`ESTIMATED_DERIVED` 同样保留为合同能力：如 12-130 的未来估算必须保持估算与来源标记，不能变成正式 Coil 实体。

## 为什么不需要每个实体一个专用 parser

Profile 已声明普通业务知识：字段、designation、选择证据、资格、展示、角色和来源。未来通用消费者可以据此组织查找与说明；只有真正新的解析/执行算法才需要代码。本模板没有实现 parser 或 runtime。
