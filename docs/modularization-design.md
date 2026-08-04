# 通用内核与定制模块拆分设计

> 状态：保留的未来产品化提案（尚未启动，不代表当前实现）
>
> 初稿日期：2026-07-16；复核日期：2026-08-03
>
> 适用范围：水泵 BOM 管理与出图系统的产品化拆分
>
> 本文只定义目标架构和迁移路径，不改变现有 API、数据库和业务行为。

当前系统继续按单工厂模块化单体运行。近期工程优化、巨型组件瘦身优先级和
验收要求见 [当前技术债与优化清单](./technical-debt.md)；未作出多工厂产品化决定前，
不得仅根据本文引入模块注册器、通用扩展表或动态模块开关。

## 1. 背景与目标

当前系统围绕个人工厂的实际管理方式构建，已经形成从基础资料到生产执行的完整链路：

```text
零件 / 线圈
  -> 泵壳模板 / 常用配置
  -> 产品配方与成本快照
  -> 客户报价
  -> 订单
  -> 采购、入库与生产扣料
  -> 转子出图与历史归档
```

产品化的目标不是删除个人定制能力，而是把系统整理成：

```text
通用业务内核
  + 可选行业模块
  + 工厂方案（启用模块 + 默认配置）
  = 某一家工厂实际使用的完整系统
```

本次拆分需要同时满足：

1. 当前个人版本的业务结果和使用习惯不发生变化。
2. 关闭定制模块后，通用版仍能独立完成 BOM、报价、订单和采购流程。
3. 新工厂可以通过选择模块和配置参数完成落地，不需要复制代码仓库。
4. 成本、库存和历史订单继续由后端统一处理并保留可追溯快照。
5. 第一阶段保持模块化单体，不引入微服务和运行时第三方插件。

## 2. 非目标

本轮拆分暂不解决：

- SaaS 多租户；
- 多用户、组织和复杂角色权限；
- 第三方开发者插件市场；
- 在线计费和订阅；
- 把 SQLite 立即迁移到其他数据库；
- 一次性重写现有页面、API 或成本引擎。

第一版优先采用“一家工厂一个部署实例、一个数据库”的交付方式。多租户应在通用业务模型经过真实用户验证后单独设计。

## 3. 拆分原则

### 3.1 同一代码库，不建立产品分叉

通用版和个人版必须来自同一主干：

```text
base profile（通用版）
dan-factory profile（当前个人版）
pilot-a profile（试点工厂 A）
```

不同方案只允许配置模块开关和默认参数，不允许复制业务文件形成长期分支。

### 3.2 通用数据与计算策略分离

“线圈管理通用”不代表“所有工厂采用同一线圈成本公式”。模块应区分：

- 资料模型：规格、材质、片数、线重、默认电容；
- 计算策略：插值方式、铜价口径、加工费、转子费；
- 工厂配置：可用材质、默认单价、默认规则。

泵壳、包装、工资等业务也采用相同原则。

### 3.3 模块贡献明细，内核统一编排

可选模块不得自行保存一个与系统无关的“总成本”。模块只向统一流程贡献：

- 配方字段或扩展数据；
- BOM 行；
- 成本行；
- 报价覆盖项；
- 采购或生产提示；
- 页面表单区块。

最终 BOM、成本快照、报价成本和订单锁价仍由后端统一编排。

### 3.4 先保持兼容，再迁移数据

现有 `recipes`、`pump_shell_templates` 等结构不在第一阶段删除。新结构先通过适配层兼容旧字段，完成双读验证后再决定是否清理。

### 3.5 模块依赖必须单向

推荐依赖方向：

```text
平台基础
  <- 通用业务内核
      <- 可选行业模块
          <- 工厂方案
```

通用内核不得反向引用某个可选模块。模块之间需要协作时，通过标准上下文、贡献器结果或领域事件协作，避免互相直接读写内部表。

## 4. 当前能力分类

### 4.1 通用内核

| 模块 ID | 中文名称 | 当前能力 | 备注 |
|---|---|---|---|
| `platform` | 平台基础 | 鉴权、审计、设置、备份、API 规范 | 所有方案必选 |
| `catalog` | 零件目录 | 型号、分类、供应商、价格、库存、批量调价 | 第一版保留供应商字符串，后续可升级供应商主数据 |
| `inventory` | 库存 | 批量库存变更、采购入库、生产扣料、库存预检 | 依赖 `catalog` |
| `coil-catalog` | 线圈资料 | 规格、材质、片数、线重、默认线径和电容 | 资料层通用 |
| `product-bom` | 产品与 BOM | 产品配方、BOM 草稿、保存快照、版本兼容 | 由现有 `recipes` 演进 |
| `customer` | 客户 | 客户档案、联系方式、默认利润率 | 可选关闭，但属于通用业务模块 |
| `quotation` | 报价 | 报价草稿、成本覆盖、报价转订单 | 依赖 `product-bom`，可选依赖 `customer` |
| `order` | 订单 | 订单、成本锁定、采购清单、生产待办 | 依赖 `product-bom` |
| `procurement` | 采购 | 采购聚合、采购状态、确认入库 | 依赖 `order`、`inventory` |
| `dashboard` | 经营看板 | 订单、采购、库存和成本摘要 | 根据已启用模块组合展示 |

### 4.2 默认行业模块

| 模块 ID | 中文名称 | 包含能力 | 依赖 |
|---|---|---|---|
| `coil-cost-standard` | 标准线圈成本 | 片数单价、线重、铜价、绕线加工费、转子加工费、片数插值 | `coil-catalog`、`product-bom` |
| `packing` | 包装材料 | 包材 BOM、独立/组合包装、打包工资 | `catalog`、`product-bom` |
| `surface-treatment` | 表面处理 | 无处理、喷漆、电泳、喷塑及成本 | `product-bom` |
| `labor-overhead` | 人工与管理费 | 安装、打包、表面处理、管理费 | `product-bom` |

这些模块可能被多数工厂采用，但具体规则未必完全一致，因此不直接写死在最小内核中。

### 4.3 当前个人定制模块

| 模块 ID | 中文名称 | 当前规则 | 依赖 |
|---|---|---|---|
| `pump-shell` | 泵壳模板 | 泵壳固定配件、壳体组件、整套/分项价格、模板默认工资 | `catalog`、`product-bom` |
| `pump-model-variant` | 常用型号配置 | 模板、线圈、机筒、长螺丝、叶轮组合预设 | `pump-shell`、`coil-catalog` |
| `barrel-long-screw` | 机筒与长螺丝 | 螺丝长度=机筒长度+补偿长度；按长度公式计价；自动沉淀零件 | `catalog`、`product-bom` |
| `float-cable` | 浮球与电缆 | 线径、长度、铜套类型、新界式差价、电缆配件费 | `catalog`、`product-bom` |
| `rotor-drawing` | 转子出图 | 模板参数、FreeCAD 出图、历史、关联与打印 | 可独立启用；启用 `pump-shell` 时可读取模板贡献 |
| `ai-assistant` | AI 助手 | 查询、受控写操作、成本和订单工具 | 按启用模块动态注册工具 |
| `voice-channels` | 语音入口 | PWA、Siri、微信小程序语音入口 | `ai-assistant` |

初始拆分时可以把高度关联的 `pump-shell`、`pump-model-variant`、`barrel-long-screw` 作为一个发布包，但代码边界仍应分别保留，方便后续根据试点反馈重新组合。

## 5. 工厂方案

工厂方案只描述“装配结果”，不实现业务逻辑。

### 5.1 通用方案

```js
{
  id: 'base',
  name: '水泵管理通用版',
  enabledModules: [
    'platform',
    'catalog',
    'inventory',
    'coil-catalog',
    'coil-cost-standard',
    'product-bom',
    'customer',
    'quotation',
    'order',
    'procurement',
    'dashboard'
  ]
}
```

### 5.2 当前个人方案

```js
{
  id: 'dan-factory',
  name: '当前工厂完整方案',
  extends: 'base',
  enabledModules: [
    'pump-shell',
    'pump-model-variant',
    'barrel-long-screw',
    'float-cable',
    'packing',
    'surface-treatment',
    'labor-overhead',
    'rotor-drawing',
    'ai-assistant',
    'voice-channels'
  ]
}
```

### 5.3 方案约束

- 生产环境必须明确指定一个方案，不能依赖隐式猜测。
- 方案启动时校验模块依赖，缺失依赖直接拒绝启动。
- 禁用模块不显示导航、不注册写入口、不参与 BOM 或成本计算。
- 禁用模块的历史快照仍应可读，避免旧订单无法查看。
- 模块启用状态属于实例级配置，不允许在一次请求中临时切换。

## 6. 模块契约

### 6.1 模块清单

模块使用代码内静态注册，不允许从任意目录动态执行未知代码。

概念接口如下：

```ts
type BusinessModule = {
  id: string;
  version: string;
  dependsOn?: string[];
  settings?: SettingDefinition[];
  migrations?: Migration[];
  api?: ApiRegistration;
  navigation?: NavigationItem[];
  recipeSections?: RecipeSectionRegistration[];
  bomContributors?: BomContributor[];
  costContributors?: CostContributor[];
  quotationOverrides?: OverrideDefinition[];
  snapshotReaders?: SnapshotReader[];
};
```

模块清单的职责是声明能力；模块注册器负责校验依赖、执行迁移和组装运行时。

### 6.2 BOM 贡献器

统一输入示例：

```ts
type BomContext = {
  product: ProductDefinition;
  moduleData: Record<string, unknown>;
  partsCatalog: Part[];
  currentIndicators: MarketIndicators;
  purpose: 'recipe-save' | 'quotation-preview' | 'order-lock' | 'production';
};
```

统一输出示例：

```ts
type BomContribution = {
  moduleKey: string;
  moduleVersion: string;
  lines: BomLine[];
  warnings: BusinessWarning[];
  metadata?: Record<string, unknown>;
};
```

每条 `BomLine` 至少包含：

- 稳定行标识；
- 型号和名称；
- 供应商；
- 数量和单位；
- 快照单价；
- 成本来源；
- 计算公式说明；
- 来源模块和规则版本。

### 6.3 成本贡献器

成本引擎按稳定顺序执行贡献器：

```text
普通零件
  -> 结构模块
  -> 线圈模块
  -> 动态配置模块
  -> 包装模块
  -> 人工与管理费模块
  -> 汇总、校验和快照
```

成本贡献器返回明细，不直接写配方、报价或订单。编排器负责生成：

- 当前试算结果；
- 配方保存快照；
- 报价覆盖结果；
- 订单锁定快照。

### 6.4 前端区块

配方编辑器提供稳定插槽：

```text
basic              基础信息
structure          产品结构
power-unit         线圈/动力单元
customer-options   客户选配
packing            包装
labor              人工与管理费
technical          技术档案
drawing            出图参数
summary            BOM 与成本汇总
```

每个模块只能向声明的插槽注册区块。表单状态仍保存在配方页面，由统一草稿对象提交给后端，不允许模块组件直接写库。

导航同样由模块注册信息生成，代替当前全部写死的 `navItems`。

### 6.5 模块设置

每项设置必须声明：

- `key`；
- 数据类型；
- 默认值；
- 校验器；
- 是否包含敏感信息；
- 所属模块；
- 设置版本。

设置写入继续使用后端白名单。模块注册器在启动时合并已启用模块的设置定义，不能接受任意 key。

## 7. 数据设计

### 7.1 保留的核心表

第一阶段继续保留：

- `parts`；
- `coils`；
- `recipes`；
- `customers`；
- `quotations`；
- `orders`；
- `system_settings`；
- `audit_log`。

`pump_shell_templates`、`pump_model_variants`、`rotor_drawings` 由对应模块接管，但暂不改名或迁移。

### 7.2 新增模块扩展数据

建议新增：

```text
recipe_module_data
  id
  recipe_id
  module_key
  schema_version
  payload_json
  created_at
  updated_at
  deleted_at
```

约束：

- `(recipe_id, module_key)` 唯一；
- API 对外输出 camelCase；
- `payloadJson` 必须由模块校验器解析和生成；
- 正式写入必须走 `safeInsert` / `safeUpdate` / `softDelete`；
- 模块禁用后保留数据，重新启用时可恢复。

该表承载可选模块的可变字段，减少以后每增加一个工厂规则就给 `recipes` 增加固定列。

### 7.3 成本快照

短期继续使用 `partsJson`、`savedTotalCost`、`savedCostDetails`，同时在 BOM 行中补充：

```json
{
  "moduleKey": "barrel-long-screw",
  "moduleVersion": "1.0.0",
  "ruleVersion": "long-screw-v1",
  "costSource": "screw_formula"
}
```

中期可增加结构化快照表：

```text
cost_snapshots
  id
  owner_type       recipe / quotation / order
  owner_id
  snapshot_type    saved / preview / locked
  total_cost
  engine_version
  created_at

cost_snapshot_lines
  id
  snapshot_id
  module_key
  rule_version
  item_type
  item_key
  label
  quantity
  unit
  unit_cost
  subtotal
  input_json
  formula
```

历史订单读取快照，不用当前模块规则反算历史成本。

### 7.4 模块迁移记录

建议新增：

```text
module_migrations
  module_key
  migration_id
  applied_at
  checksum
```

每个模块只管理自己拥有的表或扩展数据。共享核心表的迁移必须由核心模块负责，禁止两个模块同时修改同一列。

## 8. API 兼容设计

### 8.1 第一阶段保持现有路径

以下标准入口继续作为稳定外部契约：

- `POST /api/recipes/bom-draft`；
- `POST /api/recipes/cost-draft`；
- `POST /api/recipes/save-payload-draft`；
- `POST /api/recipes/:id/cost-preview`；
- `POST /api/quotations/save-payload-draft`；
- `POST /api/quotations/:id/order-draft`；
- `POST /api/orders/save-payload-draft`。

路由内部从直接调用固定规则，逐步改成调用模块编排器。前端和 AI 不需要同时迁移。

### 8.2 模块 API

资源型模块可以保留业务名称，例如：

```text
/api/templates
/api/model-variants
/api/rotor
```

不建议把所有业务 API 改成 `/api/modules/:moduleId/*`，否则业务语义变差。模块身份用于内部注册、设置和快照追踪，不替代清晰的资源路径。

### 8.3 兼容适配器

在迁移期间：

- 旧配方字段读取后转换成模块草稿；
- 新模块数据保存时按需要同步现有兼容字段；
- Row Adapter 继续输出当前 camelCase 契约；
- 清理旧字段必须等到没有旧版本客户端、历史数据已迁移且契约测试更新后进行。

任何 API 新增或调整都必须遵守 `docs/api-contract.md`、执行 `docs/api-sop.md` 并同步 `docs/api-reference.md`；本文本身不授权直接改变 API。

## 9. 目标目录结构

第一阶段建议在现有结构内渐进演进：

```text
api/
  core/
    moduleRegistry.cjs
    profileLoader.cjs
    bomOrchestrator.cjs
    costOrchestrator.cjs
    migrationRunner.cjs
  modules/
    catalog/
    inventory/
    coilCatalog/
    coilCostStandard/
    productBom/
    pumpShell/
    barrelLongScrew/
    floatCable/
    packing/
    laborOverhead/
    rotorDrawing/
  profiles/
    base.cjs
    danFactory.cjs

apps/web-next/
  modules/
    registry.ts
    catalog/
    coil/
    product-bom/
    pump-shell/
    barrel-long-screw/
    float-cable/
    packing/
    rotor-drawing/
  profiles/
    base.ts
    dan-factory.ts
```

现有 `api/routes/*` 和 `apps/web-next/lib/*` 在迁移期继续作为稳定入口或 facade，不做一次性搬迁。

## 10. 分阶段实施

### 阶段 0：冻结当前行为基线

目标：确保拆分过程中个人版本不回退。

工作项：

- 保存现有 133 项测试作为最低基线；
- 为当前真实配方增加脱敏黄金样本；
- 固化 BOM、成本草稿、报价覆盖和订单锁价结果；
- 记录当前个人方案启用的全部能力。

验收：同一输入在拆分前后生成相同 BOM、成本和订单快照。

### 阶段 1：模块注册器与工厂方案

目标：建立模块开关，但暂不搬业务规则。

工作项：

- 建立模块注册表和依赖校验；
- 建立 `base` 与 `dan-factory` 方案；
- 导航根据启用模块生成；
- 设置白名单按启用模块合并；
- 后端启动时输出启用模块清单。

验收：`dan-factory` 方案行为不变；`base` 方案不显示定制入口。

### 阶段 2：后端贡献器拆分

建议顺序：

1. `barrel-long-screw`；
2. `float-cable`；
3. `packing`；
4. `labor-overhead` 与 `surface-treatment`；
5. `pump-shell`；
6. `coil-cost-standard`。

每拆一个模块：

- 原有 API 路径不变；
- 新旧结果做黄金样本对比；
- 新规则增加服务层单元测试；
- 禁用模块时确认其不贡献 BOM 或成本。

验收：成本引擎只负责编排和汇总，具体规则由模块贡献器提供。

### 阶段 3：配方前端模块化

目标：把当前大型配方页面拆成通用编辑器与模块区块。

工作项：

- 提取统一 `RecipeDraft`；
- 建立页面插槽；
- 迁移泵壳、线圈、浮球电缆、包装、工资和技术档案区块；
- 模块区块只修改页面草稿，不直接调用写 API；
- 保存仍调用标准草稿和配方 API。

验收：关闭某模块后，其字段和入口不出现；保存结果仍由后端生成。

### 阶段 4：扩展数据与版本化快照

目标：停止继续向 `recipes` 表增加定制列。

工作项：

- 引入 `recipe_module_data`；
- 为已拆模块定义 schema version；
- 建立旧字段到模块数据的迁移和回退读取；
- 在快照行中写入模块和规则版本。

验收：新增定制模块无需修改 `recipes` 表；历史订单仍能独立展示。

### 阶段 5：通用版试点

目标：验证真正的行业共性。

工作项：

- 准备空白初始化和 Excel/CSV 导入；
- 提供通用方案的首次设置向导；
- 邀请 2～3 家不同管理方式的水泵工厂试用；
- 记录他们的型号、BOM、成本、包装、采购和订单差异；
- 根据共性调整内核，根据差异新增配置或模块。

验收：试点工厂不修改代码即可完成基础资料、BOM、报价、订单和采购主流程。

## 11. 风险与控制

| 风险 | 表现 | 控制措施 |
|---|---|---|
| 伪模块化 | 只分目录，规则仍互相调用内部实现 | 使用贡献器契约和依赖检查 |
| 个人版回退 | 拆分后成本结果与当前使用习惯不同 | 黄金样本、快照对比、默认 `dan-factory` 方案 |
| 历史成本失真 | 新规则重新计算旧订单 | 历史快照保存模块和规则版本，禁止自动反算 |
| 数据字段继续膨胀 | 每个客户需求都给 `recipes` 加列 | 可选字段进入 `recipe_module_data` |
| 前端隐藏但后端仍执行 | 模块关闭后仍计入成本 | 后端注册器是唯一模块启用依据 |
| 模块顺序影响结果 | 多个模块修改同一 BOM 行 | 稳定贡献顺序、稳定行 ID、冲突检测 |
| 过早抽象 | 没有真实用户证据就设计万能规则 | 先保留默认模块，通过试点验证共性 |
| 多租户扩大风险 | 所有表和鉴权同时重构 | 第一版保持单实例单数据库 |

## 12. 验收标准

拆分完成至少满足：

### 当前个人方案

- 现有功能入口全部保留；
- 现有测试全部通过；
- 黄金样本 BOM 和成本一致；
- 报价转订单、采购入库和生产扣料语义不变；
- 转子出图仍可读取模板和型号配置。

### 通用方案

- 不显示泵壳、长螺丝、浮球电缆和出图等未启用模块；
- 能独立维护零件、线圈和产品 BOM；
- 能保存成本快照；
- 能完成客户、报价、订单和采购主流程；
- 禁用模块不会产生隐藏成本项或写入副作用。

### 开发约束

- 前端 API 请求继续统一走 `proxyRequest()` / `proxyFetch()`；
- 动态更新继续统一走 `safeUpdate()`；
- 新业务写入使用 `safeInsert()`；
- API 对外保持 camelCase；
- 成本计算继续以后端为权威来源；
- 所有 API 变更同步 API 文档和契约测试。

## 13. 需要确认的产品决策

开始实施前需要明确以下选择：

1. 第一版通用产品是否包含客户、报价、订单和采购，还是只发布“零件 + 线圈 + BOM”。
2. 包装、人工工资和管理费应作为通用版默认模块，还是只在需要时开启。
3. 通用版是否允许用户自定义零件单位、库存单位和产品字段。
4. 第一批试点工厂采用本地部署、远程代部署，还是统一部署在独立云实例。
5. 是否把当前个人方案作为系统默认方案，待通用版完成后再调整默认值。

## 14. 推荐结论

推荐采用以下决策作为第一阶段默认方案：

- 架构：模块化单体；
- 代码：单仓库、单主干；
- 交付：一家工厂一个实例和数据库；
- 通用版范围：零件、库存、线圈、产品/BOM、客户、报价、订单、采购；
- 定制方式：静态注册模块 + 工厂方案；
- 兼容策略：保留现有 API 和字段，通过 facade 与适配器渐进迁移；
- 第一实施目标：完成阶段 0 和阶段 1，不改变任何成本结果。

该方案既能保护当前个人版本，也能为其他水泵管理者提供可逐步扩展的通用底座。
