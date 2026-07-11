# 生产巡检与 AI API 调用准备清单

> 更新于 2026-07-11。用于重构版上线后的人工巡检，以及为 AI、Siri、微信小程序等外部入口调用统一业务 API 做准备。

## 1. 巡检目标

- 确认重构版页面没有遗漏旧版关键业务小操作。
- 确认网页、AI 和未来外部入口共享同一套后端业务动作。
- 巡检发现问题时，先判断是 UI 缺口、API 缺口、AI 工具缺口，还是数据问题。
- 不把业务逻辑重新写回前端或 AI executor。

## 2. 巡检记录格式

建议每发现一个问题按下面格式记录：

```text
页面：
操作：
期望结果：
实际结果：
影响范围：UI / API / AI 工具 / 数据 / 部署
是否阻断业务：是 / 否
建议处理：
```

优先级：

- P0：会导致成本错误、库存错误、订单错误、无法保存或误保存。
- P1：核心业务可做但步骤明显缺失、提示不足或需要绕路。
- P2：页面体验、排版、提示文案、移动端适配问题。
- P3：优化项，不影响当前生产使用。

## 3. 页面巡检清单

### Dashboard

- [ ] 能正常加载关键 KPI 和业务摘要。
- [ ] 移动端可以打开导航并进入所有主要页面。
- [ ] 页面没有旧 Vite/MUI 风格残留的明显断层。

### 零件 Parts

- [ ] 新增普通零件后，列表刷新并显示正确型号、分类、供应商、价格、库存。
- [ ] 编辑零件价格后，配方成本预览能读取新价格。
- [ ] 不同零件类别的结构化输入仍然可用，例如电缆配件费、长螺丝参数化配置。
- [ ] 批量调价通过 AI 或后端 API 后，价格变化正确并有审计。
- [ ] 删除零件为软删除，不应影响历史订单快照。

对应 API：

- `GET /api/parts`
- `POST /api/parts`
- `PATCH /api/parts/:id`
- `DELETE /api/parts/:id`
- `PATCH /api/parts/prices`
- `POST /api/parts/batch-stock`

AI 已接入：

- `get_all_parts`
- `search_parts`
- `create_part`
- `update_part`
- `delete_part`
- `batch_update_prices`

### 线圈 Coils

- [ ] 新增同规格线圈时，可以带入同规格字段和材质默认单价。
- [ ] 线圈成本能按规格、材质、片数计算，缺少精确片数时可插值。
- [ ] 默认线径和默认电容能被配方页读取。
- [ ] 铜价更新后线圈成本可刷新。

对应 API：

- `GET /api/coils`
- `POST /api/coils`
- `PATCH /api/coils/:id`
- `DELETE /api/coils/:id`
- `POST /api/coils/calculate`
- `POST /api/coils/spec-draft`
- `PATCH /api/coils/spec/:spec`

AI 已接入：

- `get_coil_specs`
- `calculate_coil_cost`

### 配方 Recipes

- [ ] 选择泵壳模板后，模板固定配件、数量、单价、小计正确展示。
- [ ] 选择型号变体后，线圈、机筒长度、长螺丝、叶轮参考参数正确带入。
- [ ] 模板匹配结果默认展示摘要，查看全部能看到完整 BOM。
- [ ] 线圈规格、片数、材质、客户指定线重能影响线圈成本。
- [ ] 自动关联电容能显示推荐来源。
- [ ] 长螺丝按机筒长度 + 补偿长度计算，公式可见。
- [ ] 浮球、电缆、选配件、包装材料、人工、管理费、表面处理都能计入成本。
- [ ] 成本缺失项会提示，并且存在成本警告时不能保存。
- [ ] 保存配方后，列表显示保存成本快照。
- [ ] 修改零件库价格后，历史配方保存成本不被静默改写。
- [ ] 生产扣库存前有预检，库存不足能提示，确认后库存正确扣减。

对应 API：

- `GET /api/recipes`
- `POST /api/recipes/bom-draft`
- `POST /api/recipes/cost-draft`
- `POST /api/recipes/save-payload-draft`
- `POST /api/recipes`
- `PATCH /api/recipes/:id`
- `DELETE /api/recipes/:id`
- `GET /api/recipes/:id/cost`
- `POST /api/recipes/:id/cost-preview`
- `POST /api/recipes/:id/production-check`
- `POST /api/recipes/:id/produce`
- `POST /api/recipes/model-variant-draft`

AI 已接入：

- `get_all_recipes`
- `query_recipe_cost_by_id`
- `query_recipe_cost_by_name`
- `create_recipe`
- `update_recipe`
- `delete_recipe`
- `compare_recipes`

需重点人工验证：

- AI 创建/修改配方目前接收的是简化零件参数，不等同于完整 Recipe Workspace。复杂配方仍建议先从网页创建，再让 AI 查询、修改少量字段或复制业务动作。

### 模板与常用配置

- [ ] 新建泵壳模板后，配方页可以选择并带入工资、表面处理和模板配件。
- [ ] 模板变体按钮、复制、删除、应用仍可用。
- [ ] 保存为常用配置后，后续配方可以重新应用。
- [ ] 变体使用到的新长度长螺丝能沉淀到零件库。

对应 API：

- `GET /api/templates`
- `POST /api/templates`
- `PATCH /api/templates/:id`
- `DELETE /api/templates/:id`
- `GET /api/templates/:id/default-recipe`
- `GET /api/model-variants`
- `POST /api/model-variants`
- `PATCH /api/model-variants/:id`
- `DELETE /api/model-variants/:id`
- `POST /api/recipes/model-variant-draft`

AI 状态：

- 目前 AI 没有专门的模板/变体写工具。若巡检确认需要语音创建常用配置，应先补标准 API 动作和工具 schema。

### 报价 Quotations

- [ ] 客户默认利润率可以带入报价。
- [ ] 报价项能覆盖线圈、浮球、电缆、包装等配置，并通过后端 `cost-preview` 试算。
- [ ] 保存报价前走后端保存草稿，成本、价格和状态正确。
- [ ] 报价转订单前有预览，确认后订单产品、成本快照、采购清单正确。
- [ ] 过期报价状态显示合理。

对应 API：

- `GET /api/quotations`
- `POST /api/quotations/save-payload-draft`
- `POST /api/quotations`
- `PATCH /api/quotations/:id`
- `DELETE /api/quotations/:id`
- `POST /api/quotations/:id/order-draft`
- `POST /api/recipes/:id/cost-preview`

AI 状态：

- 目前 AI 没有报价专用写工具。若需要 AI 报价，应优先补“报价草稿预览”和“确认保存报价”标准工具，而不是直接复用订单工具。

### 订单 Orders

- [ ] 新建订单必须至少包含一个产品。
- [ ] 添加产品时优先使用配方保存成本锁价；没有保存成本时才后端兜底试算。
- [ ] 修改数量、利润率、手输出厂价后，总成本、总价、利润正确联动。
- [ ] 保存订单后，采购清单和待办由后端生成。
- [ ] 订单状态流转通过动作 API。
- [ ] 采购项勾选、待办勾选、确认采购完成并入库都能正常执行。
- [ ] 采购完成入库只增加需要采购的数量，不重复入库。

对应 API：

- `GET /api/orders`
- `POST /api/orders/save-payload-draft`
- `POST /api/orders/purchase-plan`
- `POST /api/orders`
- `PATCH /api/orders/:id`
- `DELETE /api/orders/:id`
- `POST /api/orders/:id/status`
- `POST /api/orders/:id/purchase-items/toggle`
- `POST /api/orders/:id/todos/toggle`
- `POST /api/orders/:id/complete-purchase`

AI 已接入：

- `get_recent_orders`
- `create_order`
- `get_order_detail`
- `add_recipe_to_order`
- `remove_recipe_from_order`
- `update_order_item`
- `update_order_status`
- `generate_purchase_list`
- `delete_order`

待补 AI 工具候选：

- 采购项勾选：复用 `POST /api/orders/:id/purchase-items/toggle`
- 待办勾选：复用 `POST /api/orders/:id/todos/toggle`
- 确认采购完成并入库：复用 `POST /api/orders/:id/complete-purchase`

这些属于高风险库存动作，必须保留确认卡片。

### 采购 Purchase

- [ ] 按供应商和型号聚合未完成订单采购需求。
- [ ] 批量标记已采购只更新订单采购项状态，不入库。
- [ ] 入库必须回到订单详情执行“确认采购完成并入库”。

对应 API：

- `POST /api/orders/purchase-items/batch`
- `POST /api/orders/:id/complete-purchase`

AI 状态：

- 暂未暴露采购中心批量标记工具。若要补，必须明确“不入库”的语义。

### 客户 Customers

- [ ] 新增、编辑、删除客户正常。
- [ ] 客户默认利润率能被报价或订单流程读取。
- [ ] 从客户详情发起报价时能带客户上下文。

对应 API：

- `GET /api/customers`
- `POST /api/customers`
- `PATCH /api/customers/:id`
- `DELETE /api/customers/:id`

AI 状态：

- 暂无客户写工具。可先保留网页维护。

### 转子 Rotor

- [ ] 可以选择模板/变体带入出图参数。
- [ ] 参数修改后能生成出图任务。
- [ ] 状态查询、历史记录、关联配方/订单、打印入口正常。
- [ ] 模板默认轴承、油封、开档、定位等能自动提取。

对应 API：

- `POST /api/rotor/draft`
- `POST /api/rotor/draw`
- `GET /api/rotor/status/:jobId`
- `POST /api/rotor/print/:jobId`
- `GET /api/rotor/history`

AI 已接入：

- `generate_rotor_drawing`
- `print_rotor_drawing`
- `get_rotor_drawing_history`

## 4. AI 可调用业务动作清单

### 当前可放心巡检的 AI 动作

查询类：

- 查询配方列表、零件列表、最近订单。
- 查询配方成本。
- 查询铜价、线圈规格、线圈成本。
- 查询转子出图历史。

成本类：

- 完整成本估算：`POST /api/cost/full-estimate`
- 动态配置成本：`POST /api/cost/dynamic`
- 线圈成本：`POST /api/coils/calculate`

写操作：

- 零件新增、修改、删除、批量调价。
- 配方新增、修改、删除。
- 订单新增、追加产品、移除产品、修改订单项、改状态、生成采购清单、删除订单。
- 转子出图和打印。

### 暂不建议开放给 AI 的动作

- 客户写操作。
- 报价创建、修改、报价转订单。
- 模板和常用配置写操作。
- 采购中心批量标记。
- 订单确认采购完成并入库。
- 配方生产扣库存。

原因：

- 这些动作要么还没有 AI 工具 schema，要么涉及库存、报价和客户上下文，误操作成本高。
- 可以先通过网页巡检确认业务动作足够稳定，再逐个补 AI 工具和确认卡片。

## 5. 问题归类规则

### UI 缺口

现象：

- API 已经存在，网页没有入口或入口难用。
- 旧版小操作没有迁移到 Next 页面。
- 页面提示、布局、移动端导航不清楚。

处理：

- 只改 Next UI 和前端调用，不新增业务口径。

### API 缺口

现象：

- 网页或 AI 都需要同一个动作，但现有 API 只能让前端自己拼逻辑。
- 需要事务、库存、成本快照、采购清单等后端一致性。

处理：

- 先新增标准 API。
- 同步更新 `docs/api-reference.md`、`docs/README.md`。
- 加契约测试。
- 再让网页和 AI 复用。

### AI 工具缺口

现象：

- API 已存在，网页可用，但 AI 没有工具 schema 或 executor。

处理：

- 只补 `tools.cjs` schema 和 executor 调用。
- 高风险写操作加入 `WRITE_TOOLS`，必须确认后执行。

### 数据问题

现象：

- 公式和页面正常，但某个模板、零件、供应商、线圈或历史 JSON 数据不完整。

处理：

- 优先修数据或补迁移脚本，不在 UI 里隐藏问题。

## 6. 下一步建议

1. 先按本清单巡检生产站点。
2. 把发现的问题按 P0/P1/P2/P3 分类。
3. P0/P1 优先修业务逻辑和 API 缺口。
4. 等核心流程稳定后，再补 AI 的报价、采购入库、生产扣库存、模板/常用配置工具。
5. 最后整理外部调用文档，给 Siri、微信小程序和自动化入口使用。
