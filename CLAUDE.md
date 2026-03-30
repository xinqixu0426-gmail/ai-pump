# 水泵BOM管理系统

## 项目简介
水泵BOM数据库 + 订单管理 + 成本计算API。支持零件录入、配方组装、订单采购流转、库存联动，并提供 N8N / AI Agent 可调用的成本计算后端。

## 技术栈
- **前端**：React 18 + TypeScript + Vite + Material UI 5 (端口 3000)
- **后端API**：Express.js `api.cjs` (端口 3002)
- **数据库**：NocoDB REST API (端口 8080)
- **NocoDB 配置**：通过 `.env` 文件注入（`VITE_NOCO_BASE_URL`, `VITE_NOCO_API_TOKEN`, `VITE_NOCO_PARTS_TABLE`, `VITE_NOCO_RECIPES_TABLE`, `VITE_NOCO_ORDERS_TABLE`, `VITE_NOCO_COILS_TABLE`）
- **启动**：`npm start`（并行启动前端 + API）

## 项目结构
```
├── api.cjs                    # Express API (成本计算+铜价抓取+线圈CRUD，供 N8N/外部调用)
├── .env                       # NocoDB 连接配置
└── src/
    ├── main.tsx               # React 入口 + MUI 主题
    ├── App.tsx                # 路由: / /parts /recipes /recipe-form /orders /order-form /coils
    ├── types/index.ts         # 全部 TypeScript 类型 (Part/Recipe/Order/OrderItem/PurchaseItem 等)
    ├── utils/
    │   ├── api.ts             # NocoDB 前端 API 封装 (getAllParts/getAllRecipes/batchAddStock)
    │   ├── costCalculator.ts  # 前端成本计算引擎
    │   └── orderStore.ts      # 订单 NocoDB CRUD + 采购汇总算法 + 历史价格查询
    ├── components/
    │   ├── OrderDetailModal   # 订单详情弹窗 (采购清单/to-do/入库确认)
    │   ├── RecipeDetailModal  # 配方详情弹窗 (成本快照对比)
    │   ├── PartForm / PartList / RecipePartRow
    └── pages/
        ├── DashboardPage      # 运营看板 (KPI统计 + Kanban看板 + 最近动态)
        ├── PartsPage          # 零件管理 (搜索/折叠分类/分页)
        ├── RecipesPage        # 配方列表 (复制/删除/详情)
        ├── RecipeFormPage     # 4步向导录入配方
        ├── OrdersPage         # 订单列表 (客户筛选/状态/定价汇总)
        ├── OrderFormPage      # 4步向导新建订单
        ├── CoilRotorPage      # 线圈转子管理 (铜价监控/CRUD/成本试算)
```

## 核心业务逻辑

### 1. 配方系统
- **4步向导**：基本信息 → 必配配件(6项) → 选配 & 动态配置(浮球/电缆/包材) → 预览保存
- **动态配置特性**：线径从定子规格自动推导、电缆按米计价、包材模糊匹配最低价
- **成本快照**：保存时锁定 `snapshotPrice` 到 `parts_json`，后续可对比最新涨跌

### 2. 订单与定价
- **4步向导**：基本信息(客户/合同号) → 添加型号 & 定价 → 预览采购清单 → 确认提交
- **利润率系统**：每个型号独立设利润率(默认10%)，成本×利润率=出厂价，出厂价可手动覆盖后反算利润率
- **历史价格对比**：添加型号时自动查历史订单同名配方的最近出厂价，红/绿 Chip 标注涨跌
- **采购汇总**：跨型号按 `model` 为唯一 Key 合并零件需求量，对比库存算缺口
- **状态流转**：待采购 → 采购中 → 已完成(触发 `batchAddStock` 自动入库)

### 3. 运营看板 (首页)
- KPI 统计卡片：订单总数、配方数、零件种类(含低库存预警)、总营收、总利润(含利润率)
- Kanban 三列看板(待采购/采购中/已完成)，点击卡片直接打开订单详情
- 最近动态列表(最近8单)

### 4. 成本计算引擎
前端 `costCalculator.ts` 和后端 `api.cjs` 共用同一套匹配逻辑：
1. 优先 `(model + supplier)` 精确匹配查最新单价
2. 匹配失败回退到仅 `model`，多供应商中取**最低价**兜底

### 5. 线圈转子成本
- **铜价自动更新**：项目启动时 + 每天北京时间15:00，从曲合期货网(`quheqihuo.com`) AJAX接口获取1#铜最新价，更新所有线圈记录的铜价基数并重算成本
- **成本公式**：`单价×片数 + 默认线重×铜价基数 + 线圈加工费 + 转子加工费`
- **线性插值**：当客户输入的片数不在数据库中时（如 DB 有120/140，客户要130），自动按相邻片数线性插值默认线重和加工费
- **客户指定线重**：可选覆盖默认线重，直接代入公式
- **管理页面**：`/coils` 路由，含铜价实时监控卡片、按规格分组的数据列表、成本试算计算器

## 数据库表结构 (NocoDB)

| 表 | 关键字段 |
|---|---|
| **Parts** (零件) | `Id`, `型号`/model, `类别`/category, `单价`/price (电缆=每米), `供应商`/supplier, `库存` |
| **Recipes** (配方) | `Id`, `配方名称`, `规格`, `配件JSON` (RecipePart[] JSON), `保存时总成本`, `保存时成本明细` |
| **Orders** (订单) | `Id`, `客户名称`, `合同号`, `备注`, `订单状态`, `型号列表JSON`, `采购清单JSON`, `采购TodoJSON` |
| **线圈成本表** | `规格`, `片数`, `成本`, `默认线径`, `单价`, `线重`, `铜价基数`, `线圈加工费用`, `转子加工费用` |

> **字段名注意**：NocoDB 表字段为中文。代码中做了双重兼容：`r.saved_total_cost || r.保存时总成本 || 0`。

> **OrderItem 内嵌定价**：`型号列表JSON` 中每条 OrderItem 包含 `unitCost`、`profitMargin`(1.10=10%)、`unitPrice`，无需额外 NocoDB 列。

## API 端点 (api.cjs, 端口 3002)

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/cost/calculate` | 传入 parts 数组计算成本 |
| GET | `/api/cost/recipe/:id` | 按配方ID查成本 |
| GET | `/api/cost/recipe/by-name?name=xxx` | 按名称模糊匹配配方成本 |
| POST | `/api/cost/dynamic-config` | 动态配置成本(浮球/电缆/包材) |
| **POST** | **`/api/cost/full-calculate`** | **一站式计算(推荐)**：配方+线圈+动态配置一次搞定 |
| GET | `/api/copper-price` | 获取实时铜价(元/吨) + DB铜价基数 |
| POST | `/api/copper-price/update` | 手动触发铜价更新(抓取→更新所有线圈记录) |
| GET | `/api/coils` | 获取所有线圈记录 |
| POST | `/api/coils` | 新增线圈记录(自动计算成本) |
| PATCH | `/api/coils/:id` | 更新线圈记录(自动重算成本) |
| DELETE | `/api/coils/:id` | 删除线圈记录 |
| POST | `/api/coils/calculate` | 线圈成本计算(支持插值+客户线重) |
| GET | `/api/coils/specs` | 获取可用规格列表 |

**一站式计算参数**：`pumphousing_model`(泵壳型号), `stator`("规格-片数"格式,如"12-120"), `cableLength`, `hasFloat`, `boxType`(支持模糊匹配), `floatWire`/`cableWire`(可选,不传则自动推导)

**线圈计算参数**：`spec`(规格, 如"12"), `sheets`(片数, 支持非数据库值), `wireWeight`(可选, 客户指定线重覆盖默认值), `copperPrice`(可选, 铜价基数覆盖)


## 开发避坑

1. **PowerShell + NocoDB 中文 = 灾难**：`Invoke-RestMethod` 会把中文字段名变乱码，永远用 Node.js 或 `curl.exe`。
2. **MUI DOM 嵌套**：`<Chip>`/`<div>` 不能放在 `<Typography>`(p标签) 内，加 `component="div"` 解决。
3. **NocoDB 中文字段兼容**：Recipes 表字段是中文(`配方名称`、`保存时总成本`)，代码中需 `r.saved_total_cost || r.保存时总成本 || 0` 双重兜底。
4. **旧配方无成本快照**：`保存时总成本=0` 的旧配方，订单添加型号时会实时调 `calculateRecipeCost()` 补算。
5. **NocoDB 分页限制**：默认返回25条，已封装递归分页函数 `fetchAllRecords()` 解决。
