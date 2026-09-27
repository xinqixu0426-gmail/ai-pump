# Coil Ontology Review Matrix

> 状态：R1 Owner + Supervisor 字段审核结论已写入 V2 草稿。本文是合同审核材料，不接入 AI Runtime，不改变线圈选择、成本、库存或写入行为。

## 一句话规则

具体线圈只由 `coil.id` 唯一确定。老板说“12-120”时，它是可重复的常用叫法；先在正式方案中按“12-120 + 可选材质/槽眼/电压/频率”缩小候选，唯一则选中，否则只在剩余候选恰有一个默认方案时兜底，其他情况必须歧义。

## 字段审核矩阵

“缩小候选”仅描述未来通用消费者可使用的显式条件；本票没有启用任何解析或运行时筛选。

| 业务字段 | 当前系统字段 | 我们把它当成什么 | 为什么 | 搜索 | 缩小候选 | 决定唯一身份 | 默认展示 | 数据来源 | 还有没有疑问 |
|---|---|---|---|---|---|---|---|---|---|
| 具体方案 ID | `coils.id` | Canonical Identity | 正式资源主键 | 否 | 否 | 是 | 否 | coils / coilRow | 无 |
| 常用叫法 | `spec + sheets` | Common Designation | 例如 12-120；可重复、可碰撞 | 是 | 是 | 否 | 是（作为名称） | coils / 派生合同 | 无 |
| 方案编码 | `coils.scheme_code` | 内部直接查找证据 | 稳定键，可精确查找；老板不常说 | 是 | 仅内部强查找 | 否 | 否 | coils / coilRow | 无 |
| 方案名称 | `coils.scheme_name` | Display / Human-readable Fact | 供人阅读和文本搜索，不要求整串身份匹配 | 是 | 否 | 否 | 是（名称） | coils / coilRow | 无 |
| 规格俗称 | `coils.spec` | Selection Evidence | 与片数组成普通叫法 | 是 | 是 | 否 | 否 | coils / coilRow | 无 |
| 片数 | `coils.sheets` | Selection Evidence | 与规格一起区分常用叫法 | 是 | 是 | 否 | 否 | coils / coilRow | 无 |
| 材质 | `coils.material` | Selection Evidence | 老板可明确给出 | 是 | 是 | 否 | 否 | coils / coilRow | 无 |
| 槽眼 | `coilRow.slotType` | Selection Evidence | 老板可明确给出；DTO 优先定子组合槽眼 | 是 | 是 | 否 | 否 | stator_variants.slot_type → fallback coils.slot_type | 无 |
| 额定电压 | `coils.rated_voltage_v` | Selection Evidence | 老板可明确给出 | 是 | 是 | 否 | 否 | coils / coilRow | 空值只表示未记录 |
| 额定频率 | `coils.rated_frequency_hz` | Selection Evidence | 老板可明确给出 | 是 | 是 | 否 | 否 | coils / coilRow | 空值只表示未记录 |
| 方案状态 | `coils.scheme_status` | Lifecycle / Eligibility Policy | `official` 普通候选；`testing` 仅明确试验请求；`disabled` 仅历史/明确停用查询 | 是 | 不作为普通条件 | 否 | 否 | coils / coilCost | 无 |
| 默认方案 | `coils.is_default` | Selection Policy | 多个已合格候选中恰一个默认才兜底 | 否 | 最后兜底 | 否 | 否 | coils / coilRow | 无 |
| 市场 | `coils.market` | Descriptive Fact | 仅描述备注，老板不以它选线圈 | 是 | 否 | 否 | 否 | coils / coilRow | 无 |
| 方案系列 | `coils.scheme_family_code` | Internal Calculation Metadata | 只限定插值/外推链路 | 否 | 否 | 否 | 否 | coils / coilCost | 无 |
| 计价方式 | `coils.pricing_mode` | Costing Policy | `calculated` 用正式成本输入；`kit` 用供应商整套价 | 否 | 否 | 否 | 否 | coils / coilRow | 无 |
| 当前总成本 | `calculateCoilCost` / `coils.cost` | Primary Current Business Fact | 正式成本服务给当前结果；表字段是维护型物化当前值 | 否 | 否 | 否 | 是 | coilCost / recipeBomEngine / coils | 无 |
| 线重 | `coils.wire_weight` | Primary Fact + Cost Input | 老板主信息，也是计算输入 | 是 | 否 | 否 | 是 | coils / coilRow | 无 |
| 默认电容 | `coils.default_capacitor` | Primary Fact + BOM Input | BOM 可自动继承，不用于选实体 | 是 | 否 | 否 | 是 | coils / recipeBomEngine | 无 |
| 默认电缆横截面积 | `coils.default_wire_gauge` | Primary Fact + BOM Input | BOM 可自动继承，不用于选实体 | 是 | 否 | 否 | 是 | coils / recipeBomEngine | 无 |
| 主/副线径与绕组数据 | `main_*` / `aux_*` | Technical Facts | 仅在询问绕组技术数据时展示 | 是 | 否 | 否 | 否 | coils / coilRow | 无 |
| 单片价、套件价、铜价、加工费 | `unit_price/kit_price/copper_base/coil_fee/rotor_fee` | Cost Inputs | 用于成本解释，不是实体识别条件 | 否 | 否 | 否 | 否 | coils / coilCost | 无 |
| 库存 | `coils.stock` | Current Business Fact | 线圈转子成品套数；正式 schema 为整数 | 否 | 否 | 否 | 否 | coils / coilInventory | 无 |
| 标准直径 | `coilRow.diameterMm` | Derived Technical Fact | 优先定子组合直径，历史时按 spec 推导 | 否 | 否 | 否 | 否 | stator_variants / coilRow | 无 |
| 定子组合 ID、时间戳 | `statorVariantId/createdAt/updatedAt` | Provenance / Technical Metadata | 追溯和来源，不是业务选择条件 | 否 | 否 | 否 | 否 | coilRow | 无 |
| commonName 与兼容别名 | `coilRow.commonName/Id/CreatedAt/UpdatedAt` | Redundant Projection | 与正式字段重叠或仅为历史兼容 | 否 | 否 | 否 | 否 | coilRow | 无 |

## 选择与生命周期合同

```text
普通请求
  → 仅 official 进入候选池
  → 应用 common designation / 材质 / 槽眼 / 电压 / 频率等明确条件
  → 剩 1 套：EXPLICIT_UNIQUE
  → 剩多套且恰 1 套 default：DEFAULT_SELECTED
  → 否则：AMBIGUOUS

testing：仅用户明确请求试验方案才可加入
disabled：仅历史或明确停用查询才可访问
```

`is_default` 不覆盖用户明确条件；它与 `defaultCapacitor` 没有任何相同语义。

## 成本与估算边界

- 精确 `calculated` 方案：既有 `coilCost.calculateCoilCost` 使用正式成本输入得到当前结果。
- 精确 `kit` 方案：同一既有服务直接采用有效 `kitPrice`。
- `coils.cost`：由线圈命令和铜价同步维护的物化当前总成本；精确绑定方案的采购参考价读取它。
- BOM：`recipeBomEngine.calculateCoilSnapshot` 调用既有 `calculateCoilCost`，再由既有 `costEngine` 处理完整 BOM 成本边界。
- 非正式如 12-130 的插值/外推结果是 `ESTIMATED_DERIVED`，不是新的 Coil 实体，未来必须标为估算并保留来源。

V2 只记录上述来源和语义，绝不复制或执行成本公式。

## 最终 Owner 语义摘要

老板平时用“12-120”，可加材质、槽眼、电压、频率来说明具体方案。选中具体方案后，默认主信息是：成本、线重、电容、电缆横截面积；绕组主副线径/数据只在明确询问技术资料时展示。市场、线重、电容、电缆、计价方式、方案系列、成本拆分和库存都不是正常实体选择证据。

## 机器可读审核来源

- V2 合同：`api/ontology/v2/contract.cjs`
- Coil profile：`api/ontology/v2/entities/coil.cjs`
- Coil Source Audit：`api/ontology/v2/entities/coilSourceAudit.cjs`
- Generic validator：`api/ontology/v2/validator.cjs`
