# 水泵 BOM 管理系统 API 文档

本文档详细说明了本项目中的所有 API 接口，包括前端直接调用的 NocoDB 数据接口，以及由 `api.cjs` 提供的用于成本计算和工作流集成的 Node.js 后端接口。

## 目录

1. [基础配置](#基础配置)
2. [后端计算 API (Node.js / Express)](#后端计算-api-nodejs--express)
   - [健康检查](#1-健康检查)
   - [基础配方成本计算](#2-基础配方成本计算)
   - [按名称查询配方成本](#3-按名称查询配方成本)
   - [按 ID 查询配方成本](#4-按-id-查询配方成本)
   - [动态配置附加成本计算](#5-动态配置附加成本计算)
   - [一站式 BOM 综合计算 (推荐 N8N 使用)](#6-一站式-bom-综合计算-推荐-n8n-使用)
   - [获取实时铜价](#7-获取实时铜价)
   - [手动触发铜价更新](#8-手动触发铜价更新)
   - [线圈转子 CRUD](#9-线圈转子-crud)
   - [线圈成本计算 (支持插值)](#10-线圈成本计算-支持插值)
   - [获取可用规格列表](#11-获取可用规格列表)
3. [NocoDB 数据操作 API](#nocodb-数据操作-api)

---

## 基础配置

- **NocoDB 基础 URL**: `http://localhost:8080`
- **NocoDB Token (`xc-token`)**: `***REMOVED***`
- **数据表映射**:
  - 零件表 (Parts): `mzsysnoaq7g36h9`
  - 配方表 (Recipes): `m9pygo8pmn86kbk`
  - 订单表 (Orders): `md70160vnmyjs4w`
  - 线圈成本表 (Coils): `m1pbr8kwo3e8un8`
- **Node.js 后端 API URL**: `http://localhost:3002` (前端通过 Vite proxy 到 `/api/cost/...` 调用)

---

## 后端计算 API (Node.js / Express)

主要用于给前端和 N8N 等自动化工具提供复杂的成本计算能力。所有响应都遵循标准的 JSON 格式：`{ success: boolean, data?: any, error?: string }`。

### 1. 健康检查
- **接口:** `GET /api/health`
- **说明:** 验证 API 服务器是否正常运行。
- **响应示例:**
  ```json
  {
      "status": "ok",
      "message": "水泵BOM成本查询API运行中",
      "timestamp": "2026-03-30T12:00:00.000Z"
  }
  ```

### 2. 基础配方成本计算
- **接口:** `POST /api/cost/calculate`
- **说明:** 传入指定的配件列表，从 NocoDB 实时拉取最新单价并计算总成本。处理同一型号的回退（选取最低价）。
- **请求体 (Body):**
  ```json
  {
    "parts": [
      { "model": "201", "name": "轴承", "supplier": "张记配件", "qty": 2 },
      { "model": "12双面", "name": "油封", "supplier": "", "qty": 1 }
    ]
  }
  ```
- **响应体:**
  包含总成本、项目数以及带 `source` (如 "精确匹配" 或 "型号回退") 和小计的明细列表。

### 3. 按名称查询配方成本
- **接口:** `GET /api/cost/recipe/by-name`
- **说明:** 根据名称（或名称的包含关系）在 NocoDB 中查找配方并实时计算其成本。
- **查询参数 (Query):**
  - `name`: 配方名称（如：`人民款370w-90机筒`）
- **响应示例:**
  返回 `recipeId`、`recipeName`、`recipeSpec` 及经过 `calculateRecipeCost` 处理的成本明细。

### 4. 按 ID 查询配方成本
- **接口:** `GET /api/cost/recipe/:id`
- **说明:** 根据 NocoDB 的配方记录 ID 查找配方并实时计算成本。
- **路径参数:** `id` (例如: `1`)

### 5. 动态配置附加成本计算
- **接口:** `POST /api/cost/dynamic-config`
- **说明:** 计算浮球、电缆、包材等动态配件成本，并具有根据定子规格智能推导线径的功能。
- **请求体 (Body):**
  ```json
  {
    "stator": "12-120",       // 定子规格-片数（简写形式，用于推导默认线径）
    "hasFloat": true,         // 是否含浮球
    "floatWire": "0.55",      // 浮球线径（可选，不传则使用 stator 自动推导的线径）
    "hasCable": true,         // 是否含电缆（若不传但 cableLength > 0，也会被视为 true）
    "cableLength": 8,         // 电缆长度(米)
    "cableWire": "0.55",      // 电缆线径（可选）
    "boxType": "纸箱-A"       // 包装箱型号（支持"木箱"等关键词模糊匹配）
  }
  ```

### 6. 一站式 BOM 综合计算 (推荐 N8N 使用)
- **接口:** `POST /api/cost/full-calculate`
- **说明:** 一次调用完成配方查找、线圈成本查询和动态配置成本的分步核算与汇总，极大简化外部工作流调用节点。
- **请求体 (Body):**
  ```json
  {
    "pumphousing_model": "V750",   // 泵壳型号（用于查基础配方成本）
    "stator": "12-120",            // 定子规格（用于查线圈成本及时推导线径）
    "cableLength": 10,             // 电缆长度
    "boxType": "木箱",              // 包装包材类型
    "hasFloat": true               // 是否含浮球
  }
  ```
- **响应体:** 返回 `recipeCost`（水泵基础配方成本块）、`statorCost`（转子线圈成本及其来源）、`dynamicCost`（浮球/电缆等），以及 `totalCost` 最终汇总。

### 7. 获取实时铜价
- **接口:** `GET /api/copper-price`
- **说明:** 从曲合期货网 AJAX 接口实时获取 1#铜最新价格，同时返回数据库中当前存储的铜价基数以便对比。
- **响应示例:**
  ```json
  {
    "success": true,
    "data": {
      "livePrice": 95250,          // 实时铜价 (元/吨)
      "livePricePerKg": "95.25",   // 实时铜价 (元/千克)
      "dbPrice": "95.25",          // 数据库中的铜价基数 (元/千克)
      "lastUpdate": "2026-03-30 13:51:44+00:00"
    }
  }
  ```

### 8. 手动触发铜价更新
- **接口:** `POST /api/copper-price/update`
- **说明:** 手动触发铜价抓取，获取最新铜价后更新所有线圈记录的铜价基数并重新计算成本。系统也会在**项目启动时**和**每天北京时间 15:00** 自动执行此操作。
- **请求体:** 无
- **响应示例:**
  ```json
  {
    "success": true,
    "data": {
      "copperPricePerTon": 95250,
      "copperPricePerKg": "95.25",
      "updatedCount": 12
    }
  }
  ```

### 9. 线圈转子 CRUD

#### 9a. 获取所有线圈记录
- **接口:** `GET /api/coils`
- **说明:** 获取线圈成本表的所有记录。
- **响应体:** `data` 为线圈记录数组，每条包含 `Id`, `规格`, `单价`, `片数`, `默认线重`, `铜价基数`, `线圈加工费`, `转子加工费`, `成本`, `默认电容_uf`, `默认线径`。

#### 9b. 新增线圈记录
- **接口:** `POST /api/coils`
- **说明:** 创建一条新的线圈记录，成本会根据公式自动计算。
- **请求体 (Body):**
  ```json
  {
    "规格": "12",
    "单价": "0.210",
    "片数": "280",
    "默认线重": "1.1",
    "铜价基数": "95.25",
    "线圈加工费": "12",
    "转子加工费": "9",
    "默认电容_uf": "50",
    "默认线径": "1.5"
  }
  ```
- **自动计算:** `成本 = 单价×片数 + 默认线重×铜价基数 + 线圈加工费 + 转子加工费`

#### 9c. 更新线圈记录
- **接口:** `PATCH /api/coils/:id`
- **说明:** 更新指定线圈记录的字段。若更新了影响成本的字段（单价/片数/默认线重/铜价基数/加工费），会自动重新计算成本。
- **路径参数:** `id` — 线圈记录 ID
- **请求体:** 需要更新的字段（仅传有变化的字段即可）。

#### 9d. 删除线圈记录
- **接口:** `DELETE /api/coils/:id`
- **路径参数:** `id` — 线圈记录 ID

### 10. 线圈成本计算 (支持插值)
- **接口:** `POST /api/coils/calculate`
- **说明:** 根据定子规格和片数计算线圈转子成本。核心特性：
  - **精确匹配**: 片数在数据库中 → 直接返回
  - **线性插值**: 片数不在数据库中（如 DB 有 120/140，输入 130），自动按相邻记录插值默认线重和加工费
  - **外推**: 片数超出数据库范围 → 使用最近记录参数
  - **客户指定线重**: 传入 `wireWeight` 覆盖默认/插值线重
- **请求体 (Body):**
  ```json
  {
    "spec": "12",            // 定子规格 (必填)
    "sheets": 130,           // 片数 (必填，支持非数据库中的值)
    "wireWeight": 0.7,       // 客户指定线重 (可选，不传则用默认/插值)
    "copperPrice": null      // 铜价基数覆盖 (可选，不传则用数据库中的)
  }
  ```
- **响应示例 (插值场景):**
  ```json
  {
    "success": true,
    "data": {
      "spec": "12",
      "sheets": 130,
      "unitPrice": 0.21,
      "wireWeight": 0.618,
      "copperBase": 95.25,
      "coilFee": 8,
      "rotorFee": 5,
      "wireGauge": "0.55",
      "capacitor": null,
      "totalCost": 99.16,
      "formula": "0.21×130 + 0.618×95.25 + 8.00 + 5.00",
      "source": "插值(120片↔140片, ratio=0.500)",
      "isCustomWireWeight": false
    }
  }
  ```

### 11. 获取可用规格列表
- **接口:** `GET /api/coils/specs`
- **说明:** 获取数据库中已有的所有定子规格及其可用片数，方便前端构建选择器。
- **响应示例:**
  ```json
  {
    "success": true,
    "data": [
      { "spec": "12", "unitPrice": "0.210", "sheets": [120, 140, 160, 180, 200, 220, 240, 260], "count": 8 },
      { "spec": "13.5", "unitPrice": "0.310", "sheets": [200], "count": 1 },
      { "spec": "90", "unitPrice": "0.150", "sheets": [100, 120, 140], "count": 3 }
    ]
  }
  ```

---

## NocoDB 数据操作 API

前端通过 `src/utils/api.ts` 直接使用 `fetch` 访问 NocoDB 进行基础数据的 CRUD 操作。
这些请求目标为 `http://localhost:8080/api/v2/tables/{表ID}/records`。

### 通用分页查询
- 接口形式为：`GET /api/v2/tables/{tableId}/records?limit=100&offset={offset}`
- **零件获取 / 配方获取** 都基于此进行了循环递归获取全部记录。

### 零件管理 (Table: `mzsysnoaq7g36h9`)
- **创建零件 (POST)**: 建立新的零件及其基本信息、单价与库存。
- **更新零件 (PATCH)**: 根据记录 Id 修改型号、类别、价格等。
- **删除零件 (DELETE)**: 传递 `[{ Id: id }]` 删除指定零件。
- **库存管理**:
  - **批量扣减 (`batchDeductStock`)**: 发起带有当前计算扣减逻辑的多个 HTTP PATCH 更新以完成生产出库减库存操作。
  - **批量增加 (`batchAddStock`)**: 发起 HTTP PATCH 实现采购入库增加库存。

### 配方管理 (Table: `m9pygo8pmn86kbk`)
- **获取单个配方 (GET)**: 添加 `where=(Id,eq,{id})` 筛选器。
- **创建配方 (POST)**: 将在前端排查和验证后的带快照信息的 `parts_json` 持久化到表中。
- **删除配方 (DELETE)**: 删除指定配方。

### 订单管理 (Table: `md70160vnmyjs4w`)
- 前端将订单记录（客户名、成本利润、采购清单结构存储至对应的数据列中），这属于上游直接写入/更新逻辑的一部分（通过类似的 `POST/PATCH` 发送）。

---

## AI 智能助手 API

### POST `/api/ai/chat` — AI 对话（SSE 流式响应）

**请求体:**
```json
{
  "messages": [
    { "role": "user", "content": "V750的成本是多少？" }
  ]
}
```

**响应:** SSE 流式事件，每行格式 `data: {...}\n\n`

| 事件类型 | 说明 | 示例 |
|---|---|---|
| `status` | AI 状态更新 | `{"type":"status","status":"thinking","message":"正在理解您的问题..."}` |
| `tool_call` | 正在调用的工具 | `{"type":"tool_call","name":"query_recipe_cost_by_name","args":{"name":"V750"}}` |
| `tool_result` | 工具返回结果 | `{"type":"tool_result","name":"query_recipe_cost_by_name","result":{...}}` |
| `content` | AI 最终文字回答 | `{"type":"content","content":"V750的总成本为..."}` |
| `done` | 完成 | `{"type":"done"}` |
| `error` | 错误 | `{"type":"error","message":"..."}` |

**支持的 AI Tools（12个）:**
| Tool 名称 | 内部调用 | 用途 |
|---|---|---|
| `query_recipe_cost_by_name` | `/api/cost/recipe/by-name` | 按名称查配方成本 |
| `query_recipe_cost_by_id` | `/api/cost/recipe/:id` | 按 ID 查配方成本 |
| `full_calculate` | `/api/cost/full-calculate` | 一站式 BOM 计算 |
| `get_copper_price` | `/api/copper-price` | 实时铜价 |
| `calculate_coil_cost` | `/api/coils/calculate` | 线圈成本（支持插值，支持"12-140"简写） |
| `get_coil_specs` | `/api/coils/specs` | 可用规格列表 |
| `get_all_recipes` | NocoDB recipes 表 | 配方列表 |
| `get_all_parts` | NocoDB parts 表 | 零件列表 |
| `dynamic_config_cost` | `/api/cost/dynamic-config` | 浮球/电缆/包材成本 |
| `get_recent_orders` | NocoDB orders 表 | 订单列表查询 |
| `create_part` | NocoDB parts 表 (POST) | **新建/录入零件（写操作）** |

---

### GET `/api/ai/system-prompt` — 获取 System Prompt

**响应:**
```json
{
  "success": true,
  "data": "你是水泵BOM管理系统的智能助手..."
}
```

### PUT `/api/ai/system-prompt` — 修改 System Prompt

修改后持久化到 NocoDB `system-config` 表（`mjw12hikysa9wlz`），重启服务自动加载。

**请求体:**
```json
{
  "prompt": "新的 system prompt 内容..."
}
```

---

*这份文档能够作为日后联调测试、工作流配置及应用维护的单点真实信息源（SSOT）。如果对 API 结构进行修改，请务必同步更新本文件。*
