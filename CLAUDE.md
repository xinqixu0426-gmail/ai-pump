# 水泵BOM管理系统

## 项目简介
水泵简易BOM数据库管理工具，支持零件录入、配方组装、成本自动计算。

## 技术栈
- 前端：React 18 + TypeScript + Vite + Material UI 5
- 后端：Express.js (API服务器)
- 数据库：NocoDB (REST API)
- 部署：Vite 构建 + Node.js API服务

## 项目结构

```
.
├── index.html              # Vite 入口 HTML
├── package.json            # 项目依赖
├── tsconfig.json           # TypeScript 配置
├── tsconfig.node.json      # Node 端 TypeScript 配置
├── vite.config.ts          # Vite 配置
├── api.cjs                 # Express API服务器
├── CLAUDE.md               # 项目文档
└── src/
    ├── main.tsx            # React 入口
    ├── App.tsx             # 主应用组件
    ├── types/
    │   └── index.ts        # TypeScript 类型定义
    ├── utils/
    │   ├── api.ts          # NocoDB API 工具
    │   └── costCalculator.ts # 成本计算工具
    ├── components/
    │   ├── PartForm.tsx    # 零件表单组件
    │   ├── PartList.tsx    # 零件列表组件（支持搜索/折叠/分页）
    │   ├── RecipePartRow.tsx      # 配方配件行组件（支持型号搜索）
    │   └── RecipeDetailModal.tsx  # 配方详情弹窗
    └── pages/
        ├── PartsPage.tsx       # 零件管理页面
        ├── RecipesPage.tsx     # 配方管理页面
        └── RecipeFormPage.tsx  # 录入配方页面
```

## 页面结构

### 1. 零件管理
- 左侧：录入零件表单（型号、类别、单价、供应商）
- 右侧：零件列表（按类别分组显示）
- **优化功能**：
  - 搜索框：支持按型号、供应商、类别实时搜索
  - 折叠/展开：每个类别可独立折叠，支持一键展开/折叠全部
  - 分页：单类别超过20条自动分页显示
- 支持：新增、修改、删除

### 2. 配方管理
- 配方列表（整页显示）
- 显示：配方名称、规格、配件概览、总成本
- **操作按钮**：
  - 录入配方：跳转到录入页面
  - 刷新：重新加载配方列表
  - 详情：查看配方零件明细和成本明细
  - 删除：删除配方
- 支持：查看详情、删除

### 3. 录入配方
- 独立录入页面（从配方管理页进入）
- 填写：配方名称、规格
- 必备配件（6项）：泵壳、花板轴承、油缸轴承、机械油封、骨架油封、线圈转子
- 选配配件：动态添加/删除，**支持型号搜索**
- **水泵动态配置区 (BOM Configurator)**：
  - 勾选式配置：带浮球（线径可选）、定制长度电缆（自动计费）、包材项（支持按数据库里的【包装】类别手拼混输或下拉查找）。
  - 这些项会自动在后端转化解耦为标准 BOM JSON。
- 选件时即时在侧边提示并**实时小计成本预览**。

## 数据库结构

### 表1：零件表 (Parts)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | ID | 自增主键 |
| model | 文本 | **型号，如：201** |
| category | 文本 | 类别：轴承/油封/螺丝/泵壳/线圈转子/配件/包装等（动态，NocoDB 单选项） |
| price | 数字 | 单价（电缆类零件此值为 **每米** 单价） |
| supplier | 文本 | 供应商名称，如：张记配件（系统预设项供应商为"系统预设"） |
| 库存 | 数字 | 当前零件库存数量 |

### 表2：配方表 (Recipes)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | ID | 自增主键 |
| name | 文本 | 配方名称，如：人民款370w-90机筒 |
| power | 文本 | 功率（已弃用） |
| spec | 文本 | 规格，如：90-100 |
| parts_json | 长文本 | 配件清单JSON，含型号、名称、供应商、数量、快照单价 |
| saved_total_cost | 数字 | 保存时总成本快照（用于快速展示对比） |
| saved_cost_details | 长文本 | 保存时的每个配件的成本明细（可读文本） |
| CreatedAt | 日期 | 创建时间 |
| UpdatedAt | 日期 | 更新时间 |

## parts_json 格式

```json
[
  {"model": "201", "name": "轴承", "supplier": "张记配件", "qty": 2, "snapshotPrice": 5.5},
  {"model": "12双面", "name": "油封", "supplier": "李记五金", "qty": 1, "snapshotPrice": 3.2}
]
```

## 成本计算逻辑

1. 读取配方的 parts_json 或是从配置区拿到的实时组合集
2. 对每个配件：
   - 首先用 `(model + supplier)` 去零件表精确匹配**当前最新单价**
   - 匹配失败则回退到 `model`，获取这一个型号的所有供应商数据进行筛选，自动取出**单价最低**的那一项作为默认底本。
   - 读取保存时的 **快照单价（snapshotPrice）**
   - 计算：单价 × qty = 小计（当前与快照同时计算并比对差异）
3. 汇总所有配件小计 = 总成本（附带浮球、长度计算等转换件金额）

## NocoDB API 配置

- 地址：http://localhost:8080/
- API Key：***REMOVED***

## 成本查询API（供N8N调用）

### 启动API服务器

```bash
# 启动API服务器（端口3002）
npm run api

# 或
node api.cjs
```

API地址：`http://localhost:3002`

### 可用端点

#### 1. 健康检查
```
GET http://localhost:3002/api/health
```
返回：
```json
{
  "status": "ok",
  "message": "水泵BOM成本查询API运行中",
  "timestamp": "2026-03-22T08:16:55.694Z"
}
```

#### 2. 计算成本（传入配件清单）
```
POST http://localhost:3002/api/cost/calculate
Content-Type: application/json
```

请求体：
```json
{
  "parts": [
    {"model": "201", "name": "轴承", "supplier": "张记配件", "qty": 2},
    {"model": "12双面", "name": "油封", "supplier": "李记五金", "qty": 1}
  ]
}
```

返回：
```json
{
  "success": true,
  "data": {
    "totalCost": "45.50",
    "itemCount": 2,
    "details": [
      {
        "name": "轴承",
        "model": "201",
        "supplier": "张记配件",
        "price": "5.50",
        "qty": 2,
        "subtotal": "11.00",
        "source": "精确匹配"
      }
    ],
    "missingParts": []
  }
}
```

#### 3. 按配方ID查询成本
```
GET http://localhost:3002/api/cost/recipe/{id}
```

示例：`GET http://localhost:3002/api/cost/recipe/1`

返回：
```json
{
  "success": true,
  "data": {
    "recipeId": "1",
    "recipeName": "人民款370w-90机筒",
    "recipeSpec": "90-100",
    "totalCost": "128.50",
    "itemCount": 6,
    "details": [...],
    "missingParts": []
  }
}
```

#### 4. 按配方名称查询成本（推荐用于N8N）
```
GET http://localhost:3002/api/cost/recipe/by-name?name={配方名称}
```

示例：`GET http://localhost:3002/api/cost/recipe/by-name?name=人民款`

说明：
- 支持部分匹配，如 `name=人民款` 会匹配 "人民款370w-90机筒"
- 返回第一个匹配的配方成本详情

返回：
```json
{
  "success": true,
  "data": {
    "recipeId": 1,
    "recipeName": "人民款370w-90机筒",
    "recipeSpec": "90-100",
    "totalCost": "101.75",
    "itemCount": 11,
    "details": [
      {
        "name": "泵壳",
        "model": "人民款370w-90机筒",
        "supplier": "-",
        "price": "25.40",
        "qty": 1,
        "subtotal": "25.40",
        "source": "型号回退"
      }
    ],
    "missingParts": []
  }
}
```

### N8N配置步骤

1. 确保API服务器已启动（`npm run api`）
2. 在N8N中添加 **HTTP Request** 节点
3. 配置方式：

**方式一：按配方名称查询（推荐）**
- Method: `GET`
- URL: `http://192.168.31.60:3002/api/cost/recipe/by-name?name=人民款`
- 支持部分匹配，如 `name=人民款` 会匹配 "人民款370w-90机筒"

**方式二：按配方ID查询**
- Method: `GET`
- URL: `http://192.168.31.60:3002/api/cost/recipe/1`

**方式三：传入配件清单计算成本**
- Method: `POST`
- URL: `http://192.168.31.60:3002/api/cost/calculate`
- Headers: `Content-Type: application/json`
- Body: 选择 `JSON` 类型，填入配件数组

**方式四：动态配置成本（浮球/电缆/包材）**
- Method: `POST`
- URL: `http://192.168.31.60:3002/api/cost/dynamic-config`
- Headers: `Content-Type: application/json`
- Body:
```json
{
  "stator": "12-120",
  "hasFloat": true,
  "cableLength": 8,
  "boxType": "纸箱"
}
```
- 参数说明：
  - `stator`: 定子规格-片数（如 "12-120"），API 自动拆分并查线圈成本表推导线径
  - `hasFloat`: 带浮球（可选，默认 false）
  - `floatWire`/`cableWire`: 显式指定线径，不传则由 stator 自动推导
  - `cableLength`: 电缆长度（米），传了就自动算电缆成本
  - `boxType`: 包材型号，支持模糊匹配（传 "纸箱" 自动查找包装类别下含“纸箱”的最低价型号）
- 返回示例:
```json
{
  "success": true,
  "data": {
    "totalCost": "25.40",
    "itemCount": 4,
    "resolvedWire": "0.55",
    "details": [
      { "name": "浮球", "model": "浮球-线径0.55", "price": "8.00", "qty": 1, "subtotal": "8.00" },
      { "name": "电缆线", "model": "电缆-线径0.55", "price": "1.45", "qty": 8, "subtotal": "11.60" },
      { "name": "电缆接头配件", "model": "电缆配件费", "price": "3.30", "qty": 1, "subtotal": "3.30" },
      { "name": "纸箱", "model": "纸箱-A款", "price": "2.50", "qty": 1, "subtotal": "2.50" }
    ]
  }
}
```
- **所有参数均可选**，不传则不计算。N8N 中可将此接口的 totalCost 与 by-name 的 totalCost 相加得到最终成本。

**方式五：一站式成本计算（推荐）**
- Method: `POST`
- URL: `http://192.168.31.60:3002/api/cost/full-calculate`
- Headers: `Content-Type: application/json`
- Body:
```json
{
  "pumphousing_model": "V750",
  "stator": "12-120",
  "cableLength": 10,
  "boxType": "木箱",
  "hasFloat": true
}
```
- 一次调用完成三步计算：配方成本 + 线圈转子成本 + 动态配置成本（浮球/电缆/包材）
- 参数说明：
  - `pumphousing_model`: 泵壳型号（用于查配方），支持部分匹配
  - `stator`: 定子规格-片数（用于查线圈成本+推导线径）
  - `cableLength`: 电缆长度（米），可选
  - `boxType`: 包材型号，可选，支持模糊匹配
  - `hasFloat`: 是否带浮球，可选
  - `floatWire`/`cableWire`: 显式指定线径，可选
- 返回结果包含 `totalCost`（总成本）和 `breakdown`（配方/线圈/动态分项明细）
- **推荐 N8N 使用此端点**，可将工作流从 11 节点简化为 4 节点（Chat Trigger → LLM 解析 → HTTP 一站式计算 → 格式化输出）

## 运行方式

```bash
# 安装依赖
npm install

# 启动开发服务器（同时启动前端和API）
npm start

# 或分别启动
npm run dev      # 启动前端（端口3000）
npm run api      # 启动API服务器（端口3002）

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

## 开发端口说明

- 前端开发服务器：3000（自动递增）
- API服务器：3002
- NocoDB：8080

## 环境要求

- Node.js 18+
- NocoDB 服务运行在 http://localhost:8080

## 更新记录

### 2026-03-28 (晚间更新)
- **一站式成本API** (`POST /api/cost/full-calculate`)：新增一站式端点，一次调用完成配方+线圈+动态配置三步成本计算，推荐 N8N 使用。
- **N8N 工作流优化**：修复 prompt/schema 字段名不一致、AI Agent 硬编码片数、动态配置 JSON 空值保护、Merge 后添加成本汇总 Code 节点。

### 2026-03-28 (日间)
- **动态配置 API** (`POST /api/cost/dynamic-config`)：新增独立端点，供 N8N 计算浮球/电缆/包材动态成本。
- **线径智能推导**：支持传入 `stator: "12-120"` 自动查线圈成本表 (`m1pbr8kwo3e8un8`) 的默认线径字段，无需手动指定。
- **包材模糊匹配**：`boxType` 传 "纸箱" 或 "木箱" 自动在包装类别中查找最低价型号（前端+API 同步）。
- **线径选项动态化**：前端浮球/电缆线径下拉菜单改为从 Parts 表动态读取，新增线径无需改代码。
- **UI 主题升级**：渐变导航栏 + Inter 字体 + 精致圆角系统 + 无阴影 Paper。
- **BUG 修复**：handleSubmit 遗漏动态配置器数据、PartForm 类别列表缺失、来源标签颜色误匹配。

### 2026-03-25
- **NocoDB 分页修复**：封装递归抓取函数彻底解决25条分页限制。
- **成本快照功能**：在配方保存时锁定配件单价，详情页支持实时价格与历史快照的比对（突出涨跌幅）。
- **配方复制**：在一键操作下跳转预填并新建副本，极大减少手工录入工作量。
- **库存联动与生产扣减**：支持在 UI 展示、编辑库存，详情页支持输入生产数量进行即时查料，确保充足后批量扣除配件表库存。
- 配方详情页支持展示 NocoDB 创建时间和最后更新时间。

### 2026-03-24
- 零件列表添加搜索、折叠、分页功能
- 录入配方可选配件支持型号搜索
- 录入配方按钮整合到配方管理页面
- 优化导航栏结构
