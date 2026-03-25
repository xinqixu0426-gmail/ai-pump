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
    ├── App.css             # 全局样式
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
- 型号选择后联动显示供应商及价格
- 实时成本预览

## 数据库结构

### 表1：零件表 (Parts)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | ID | 自增主键 |
| model | 文本 | **型号，如：201** |
| category | 文本 | 类别：轴承/油封/螺丝/泵壳/线圈转子等（动态） |
| price | 数字 | 单价 |
| supplier | 文本 | 供应商名称，如：张记配件 |
| 库存 | 数字 | 当前零件库存数量 |

### 表2：配方表 (Recipes)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | ID | 自增主键 |
| name | 文本 | 配方名称，如：人民款370w-90机筒 |
| power | 文本 | 功率（已弃用） |
| spec | 文本 | 规格，如：90-100 |
| parts_json | 长文本 | 配件清单JSON，含型号、名称、供应商、数量 |

## parts_json 格式

```json
[
  {"model": "201", "name": "轴承", "supplier": "张记配件", "qty": 2, "snapshotPrice": 5.5},
  {"model": "12双面", "name": "油封", "supplier": "李记五金", "qty": 1, "snapshotPrice": 3.2}
]
```

## 成本计算逻辑

1. 读取配方的 parts_json
2. 对每个配件：
   - 用 (model + supplier) 去零件表精确匹配**当前最新单价**
   - 匹配失败则回退到 model 默认价格
   - 读取保存时的 **快照单价（snapshotPrice）**
   - 计算：单价 × qty = 小计（当前与快照同时计算并对比）
3. 汇总所有配件小计 = 总成本（当前成本与保存时成本对比计算）

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

### 2026-03-25
- **NocoDB 分页修复**：封装递归抓取函数彻底解决25条分页限制。
- **成本快照功能**：在配方保存时锁定配件单价，详情页支持实时价格与历史快照的比对（突出涨跌幅）。
- **配方复制**：在一键操作下跳转预填并新建副本，极大减少手工录入工作量。
- **库存联动与生产扣减**：支持在 UI 展示、编辑库存，详情页支持输入生产数量进行即时查料，确保充足后批量扣除配件表库存。
- 配方详情页支持展示 NocoDB 创建时间和最后更新时间。

### 2024-03-24
- 零件列表添加搜索、折叠、分页功能
- 录入配方可选配件支持型号搜索
- 录入配方按钮整合到配方管理页面
- 优化导航栏结构
