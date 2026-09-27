# Coil Ontology Review Matrix

> 状态：字段级审核草稿，等待 Owner + Supervisor 确认。本文只描述当前代码与数据事实，不启用 AI 运行时，不改变线圈选择、成本、库存或任何写入行为。

## 老板先看这四条

1. 一套具体线圈方案仍只由数据库 `coil.id` 作为最终身份；方案编码可以帮助直接查找，但不能替代资源 ID。
2. “12-120”只是由“规格俗称 12 + 片数 120”组成的常用叫法，允许多套方案同名，不能据此直接认定唯一方案。
3. 用户明确说出的材质、槽眼、电压等条件必须先筛选；仍有多套时才看默认标记。只有一个默认才可兜底，零个或多个默认都必须判为歧义。
4. `coils.cost` 暂不认定为 Ontology 可直接展示的权威成本。现有代码会保存和维护它，但它与唯一正式成本权威 `costEngine` 的边界需逐字段审核；本票没有复制公式或计算成本。

## 字段审核矩阵

“决定唯一身份”只表示能否单独成为最终身份。除 `coil.id` 外，当前答案均为“否”。“缩小候选”表示未来通用 Entity Linking 可以把用户明确给出的值作为筛选证据，不表示本票已经启用运行时。

| 业务字段 | 当前系统字段 | 我们把它当成什么 | 为什么 | 搜索 | 缩小候选 | 决定唯一身份 | 默认展示 | 数据来源 | 还有没有疑问 |
|---|---|---|---|---|---|---|---|---|---|
| 具体方案 ID | `coils.id` | Canonical Identity | 正式资源主键 | 否 | 否 | 是 | 否 | coils / coilRow | 无 |
| 定子组合引用 | `coils.stator_variant_id` | 来源/技术元数据 | 指向正式定子组合，不是线圈身份本身 | 否 | 否 | 否 | 否 | coils → stator_variants | 无 |
| 规格俗称 | `coils.spec` | Selection Fact | “12”等工厂叫法可能重复 | 是 | 是 | 否 | 是 | coils / coilRow | 无 |
| 材质 | `coils.material` | Selection Fact | 区分钢带、冷轧等具体设计 | 是 | 是 | 否 | 是 | coils / coilRow | 无 |
| 槽眼 | `coils.slot_type` | Selection Fact | 区分小眼、国标眼等具体设计 | 是 | 是 | 否 | 是 | coils / coilRow | 无 |
| 片数 | `coils.sheets` | Selection Fact | 与规格共同组成常用叫法 | 是 | 是 | 否 | 是 | coils / coilRow | 无 |
| 方案编码 | `coils.scheme_code` | Identity Metadata / 查找证据 | 当前文档和命令保证稳定、不可变；仍不替代 `coil.id` | 是 | 是 | 否 | 是 | coils / coilRow | 请确认老板是否把它视作日常可见编号 |
| 方案名称 | `coils.scheme_name` | 展示 Fact | 人可读名称可以变化或重复 | 是 | 否 | 否 | 是 | coils / coilRow | 无 |
| 方案状态 | `coils.scheme_status` | Selection Fact | 正式、测试、停用影响候选资格 | 是 | 是 | 否 | 是 | coils / coilRow | 无 |
| 默认方案 | `coils.is_default` | Selection Policy | 只在明确条件筛选后仍多候选时兜底 | 否 | 只作最后兜底 | 否 | 否 | coils / coilRow | 数据库当前默认范围是“定子组合 + 片数”，未来 AI 是否需要更细 scope 待后续票决定 |
| 额定电压 | `coils.rated_voltage_v` | Selection Fact | 可区分具体方案 | 是 | 是 | 否 | 是 | coils / coilRow | 空值表示未记录，不表示任意电压 |
| 额定频率 | `coils.rated_frequency_hz` | Selection Fact | 可区分具体方案 | 是 | 是 | 否 | 是 | coils / coilRow | 空值表示未记录，不表示任意频率 |
| 市场 | `coils.market` | Selection Fact | 可区分市场版本 | 是 | 是 | 否 | 是 | coils / coilRow | 空值表示未记录 |
| 方案系列 | `coils.scheme_family_code` | Selection Fact / 技术元数据 | 限定计算方案插值或外推系列 | 是 | 是 | 否 | 否 | coils / persistedCoilSelection | 老板是否需要在普通摘要中看到系列编码 |
| 计价方式 | `coils.pricing_mode` | Selection Fact | 区分计算计价与供应商套件价 | 否 | 是 | 否 | 是 | coils / coilRow | 无 |
| 供应商套件价 | `coils.kit_price` | Technical Fact | 只对 kit 方案有业务含义 | 否 | 否 | 否 | 否 | coils / coilRow | 无 |
| 定子单片价 | `coils.unit_price` | Technical Fact | 计算方案的成本输入之一 | 否 | 否 | 否 | 否 | coils / coilRow | 无 |
| 线重 | `coils.wire_weight` | Primary Fact | 老板优先关心，且具体方案可不同 | 是 | 是 | 否 | 是 | coils / coilRow | 单位按现有成本代码视为 kg，建议 Owner 确认页面口径 |
| 铜价基数 | `coils.copper_base` | Technical Fact | 会随正式铜价维护而变化 | 否 | 否 | 否 | 否 | coils / copperPriceUpdate | 无 |
| 线圈加工费 | `coils.coil_fee` | Technical Fact | 当前成本输入字段 | 否 | 否 | 否 | 否 | coils / coilRow | 无 |
| 转子加工费 | `coils.rotor_fee` | Technical Fact | 当前成本输入字段 | 否 | 否 | 否 | 否 | coils / coilRow | 无 |
| 当前总成本 | `coils.cost` | Primary Fact（来源未决） | 现有 DTO 有值且会维护，但不能绕过 `costEngine` 建第二权威 | 否 | 否 | 否 | 否 | coils / coilRow；权威边界待审 | **未决：应通过哪个正式成本读取入口、它表示当前值还是保存快照** |
| 默认搭配电缆横截面积 | `coils.default_wire_gauge` | Primary Fact | UI、知识投影、配方带入均明确为电缆横截面积 mm² | 是 | 是 | 否 | 是 | coils / coilRow | 字段旧名含 gauge，但业务含义已有多处一致证据 |
| 默认电容 | `coils.default_capacitor` | Primary Fact | UI 和知识投影均明确为默认电容 μF | 是 | 是 | 否 | 是 | coils / coilRow | 当前为文本字段，格式是否需要后续标准化不在本票范围 |
| 主线漆包线线径 | `coils.main_wire_gauge` | Technical Fact | 具体方案绕组数据 | 是 | 否 | 否 | 否 | coils / coilRow | 无 |
| 主线绕组数据 | `coils.main_wire_data` | Technical Fact | 匝数、绕法等备忘 | 是 | 否 | 否 | 否 | coils / coilRow | 当前自由文本，不自动解析 |
| 副线漆包线线径 | `coils.aux_wire_gauge` | Technical Fact | 具体方案绕组数据 | 是 | 否 | 否 | 否 | coils / coilRow | 无 |
| 副线绕组数据 | `coils.aux_wire_data` | Technical Fact | 匝数、绕法等备忘 | 是 | 否 | 否 | 否 | coils / coilRow | 当前自由文本，不自动解析 |
| 线圈转子库存 | `coils.stock` | Current Fact | 正式表保存成品套数，库存流水单独记录 | 否 | 否 | 否 | 否 | coils / coil_stock_movements | 是否纳入老板默认详情需后续展示票决定 |
| 创建时间 | `coils.created_at` | 来源/技术元数据 | 用于追溯，不描述方案设计 | 否 | 否 | 否 | 否 | coils / coilRow | 无 |
| 更新时间 | `coils.updated_at` | 来源/技术元数据 | 标识当前资源更新时间 | 否 | 否 | 否 | 否 | coils / coilRow | 无 |

## “12-120”怎样表达

Ontology V2 只声明如下组合规则：

```text
commonDesignation = join("-", coil.spec, coil.sheets)
searchable = true
unique = false
collisionPolicy = ALLOWED
canonicalIdentity = false
```

因此两套甚至更多具体线圈都可以显示“12-120”。本票没有增加正则、模糊匹配、自然语言解析或自动绑定。

## 默认选择怎样表达

```text
先应用全部明确条件
  → 剩 1 套：EXPLICIT_UNIQUE
  → 剩多套且恰好 1 套 default：DEFAULT_SELECTED
  → 剩多套且 default 为 0 套或多于 1 套：AMBIGUOUS
```

该规则目前只是声明式合同，`runtimeEnabled=false`。数据库现有 `is_default` 约束和线上行为未迁移、未重定义。

## 机器可读审核来源

- V2 合同：`api/ontology/v2/contract.cjs`
- Coil profile：`api/ontology/v2/entities/coil.cjs`
- Coil Source Audit：`api/ontology/v2/entities/coilSourceAudit.cjs`
- Generic validator：`api/ontology/v2/validator.cjs`

`Coil Source Audit` 明确区分 discovery 与 acceptance：系统字段被发现并不代表已经由 Owner 接受为正式 Ontology Fact。
