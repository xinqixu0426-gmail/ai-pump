# 水泵BOM管理系统

## 项目简介
水泵简易BOM数据库及订单管理工具，支持基础零件录入、复杂动态配方组装、订单分发、采购入库流转，并提供供 N8N 自动化流调用的成本计算 API。

## 技术栈与服务
- **前端网页**：React 18 + TypeScript + Vite + Material UI 5 (端口: 3000)
- **后端API**：Express.js (用于提供 N8N 成本计算节点，端口: 3002)
- **数据库**：NocoDB REST API (端口: 8080，Token见代码库或前后台配置)
- **启动命令**：`npm install`，然后 `npm start`（并行启动前端和 API）。构建用 `npm run build`。

## 核心功能模块与页面分布
### 1. 零件管理 (`/parts` - `PartsPage.tsx` / `PartList.tsx` / `PartForm.tsx`)
- 录入零件（型号、类别、单价、供应商），支持查询、折叠分类、列表自动分页。
- 解决 NocoDB 默认 25 条分页限制，已封装递归函数拉取全量。

### 2. 配方管理 (`/recipes` - `RecipesPage.tsx` / `RecipeFormPage.tsx` / `RecipeDetailModal.tsx`)
- **4步向导式录入**：基本信息 → 必配配件 → 选配配件（带有搜索/动态扩展、线径推导、长度计价、模糊包材匹配）→ 预览与保存。
- **成本快照机制**：保存时会锁定当前零件的 `snapshotPrice` 写入 `parts_json` 字段，以供后续订单对比最新涨跌幅。
- 配方支持列表页“一键复制”创建副本。

### 3. 订单管理与采购流转 (`/orders` - `OrdersPage.tsx` / `OrderFormPage.tsx` / `OrderDetailModal.tsx` / `orderStore.ts`)
- **4步向导新建订单**：填基础信息（客户/合同号）→ 添加型号 & 定价（利润率/出厂价）→ 预览采购清单 → 确认提交。
- **利润率与定价系统**：
  - 每个型号单独设置利润率（默认 10%），成本 × 利润率 = 不含税出厂价
  - 出厂价可手动覆盖，修改后自动反算利润率
  - 订单级汇总：总成本 / 总出厂价 / 总利润（列表页和详情页均展示）
  - **历史价格对比**：添加型号时自动查询历史订单中同名配方的最近出厂价，红/绿 Chip 标注涨跌
- **客户筛选**：订单列表支持按客户名称下拉筛选
- **多型号清单合并**：订单中各类不同配方、不同供应商的同一型号零件，按 `model` 合并统计缺口
- **状态流转**：待采购 → 采购中 → 已完成
- **采购确认与入库**：确认完成后触发 `batchAddStock` API 自动把缺口数量写入 NocoDB 库存

## 数据库核心实体结构 (NocoDB)
- **Parts (零件)**: `id`, `model` (核心关联键), `category`, `price` (单价/或线缆每米), `supplier`, `库存`
- **Recipes (配方)**: `id`, `配方名称`, `规格`, `配件JSON` (长文本 JSON快照), `保存时总成本`, `保存时成本明细`
- **Orders (订单**, 表ID `md70160vnmyjs4w`): `Id`, `客户名称`, `合同号`, `备注`, `订单状态`, `型号列表JSON`, `采购清单JSON`, `采购TodoJSON`

> 型号列表JSON 内的 OrderItem 包含定价字段：`unitCost`、`profitMargin`(1.10=10%)、`unitPrice`（无需额外 NocoDB 列）

## 成本计算匹配引擎
实时计算当前成本时涉及的合并查询规则（位于 `costCalculator.ts` 及 API端）：
1. 优先使用 `(model + supplier)` 进行精确组合匹配查表锁定最新单价。
2. 若供应商停产或变更匹配失败，引擎会自动回退降级，仅对比 `model` 字段，并在多供应商中挑选**最低价**进行兜底计算。

## N8N 可用 API 端点 (localhost:3002)
- **一站式计算 (推荐)**: `POST /api/cost/full-calculate`。传入 `pumphousing_model`, `stator` (支持"定子型号-片数"识别动态匹配线径), `cableLength`, `hasFloat`, `boxType` 等配置参数。单一请求即返回包含了 配方基础件 + 转子线圈件 + 差异化动态配置件 的聚合成本和拆解明细。
- **快捷名匹配**: `GET /api/cost/recipe/by-name?name={name}`。模糊匹配配方并返回该套配置独立成本。
- **动态独立件计算**: `POST /api/cost/dynamic-config`。仅用特征参数计算浮球/电缆/包材的专项差价。

## 常用开发避坑点
1. **PowerShell 命令行 JSON 中文乱码损毁表结构**：向 NocoDB 通过命令行操作中文字段/数据，绝对不要用 PowerShell 的 `Invoke-RestMethod`。一律用 Node.js (`http.request`) 或原生 `curl.exe`。
2. **React 标签嵌套报错**：MUI 中 `<Chip>` / `<div>` 不能套在 `<Typography>`(p标签) 内。需加 `component="div"`。
3. **NocoDB 中文字段名映射**：Recipes 表实际字段名是中文（`配方名称`、`保存时总成本`），不是英文 `name`、`saved_total_cost`。Recipe 类型已加中文别名，读取时必须双重兆底：`r.saved_total_cost || r.保存时总成本 || 0`。
4. **配方成本为 0 的兑底**：旧配方没有保存成本快照（`保存时总成本=0`），订单添加型号时会自动调用 `calculateRecipeCost()` 从零件表实时计算。

