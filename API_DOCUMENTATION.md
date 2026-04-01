# 水泵 BOM 管理系统 API 文档

本文档详细说明了本项目中的所有 API 接口。

## 基础配置

- **NocoDB URL**: `http://localhost:8080`
- **Node.js 后端**: `http://localhost:3002`
- **前端**: `http://localhost:3000` (Vite dev, 通过 proxy 转发 `/api/*` → 3002)
- **数据表 ID**:
  - 零件表: `mzsysnoaq7g36h9`
  - 配方表: `m9pygo8pmn86kbk`
  - 订单表: `md70160vnmyjs4w`
  - 线圈成本表: `m1pbr8kwo3e8un8`
  - system-config: `mjw12hikysa9wlz`

---

## 一、成本计算 API

### 1. 健康检查
- `GET /api/health`
- 返回: `{ status: "ok", message: "...", timestamp: "..." }`

### 2. 基础配方成本计算
- `POST /api/cost/calculate`
- 请求体:
  ```json
  { "parts": [{ "model": "201", "name": "轴承", "supplier": "张记配件", "qty": 2 }] }
  ```
- 返回: `{ success, data: { totalCost, itemCount, details: [{ name, model, price, qty, subtotal, source }] } }`

### 3. 按名称查询配方成本
- `GET /api/cost/recipe/by-name?name=V750`
- 返回: `{ success, data: { recipeId, recipeName, recipeSpec, totalCost, details: [...], missingParts: [...] } }`

### 4. 按 ID 查询配方成本
- `GET /api/cost/recipe/:id`
- 同上格式

### 5. 动态配置附加成本
- `POST /api/cost/dynamic-config`
- 请求体:
  ```json
  {
    "stator": "12-120",
    "hasFloat": true, "floatWire": "0.55",
    "hasCable": true, "cableLength": 8, "cableWire": "0.55",
    "boxType": "纸箱-A"
  }
  ```

### 6. 一站式 BOM 综合计算 (推荐)
- `POST /api/cost/full-calculate`
- 请求体:
  ```json
  {
    "pumphousing_model": "V750",
    "stator": "12-120",
    "cableLength": 10,
    "boxType": "木箱",
    "hasFloat": true
  }
  ```
- 返回: `recipeCost` + `statorCost` + `dynamicCost` → `totalCost`

---

## 二、铜价 API

### 7. 获取实时铜价
- `GET /api/copper-price`
- 返回: `{ success, data: { livePrice, livePricePerKg, dbPrice, lastUpdate } }`

### 8. 手动触发铜价更新
- `POST /api/copper-price/update`
- 抓取最新铜价 → 更新所有线圈记录铜价基数 → 重算成本
- 自动触发: 启动时 + 每天北京时间 15:00

---

## 三、线圈转子 API

### 9. 线圈 CRUD
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/coils` | 获取所有线圈记录 |
| POST | `/api/coils` | 新增(自动计算成本) |
| PATCH | `/api/coils/:id` | 更新(自动重算成本) |
| DELETE | `/api/coils/:id` | 删除 |

**成本公式**: `单价×片数 + 默认线重×铜价基数 + 线圈加工费 + 转子加工费`

### 10. 线圈成本计算 (支持插值)
- `POST /api/coils/calculate`
- 请求体:
  ```json
  { "spec": "12", "sheets": 130, "wireWeight": 0.7, "copperPrice": null }
  ```
- 特性: 精确匹配 / 线性插值 / 外推 / 客户指定线重覆盖

### 11. 获取可用规格列表
- `GET /api/coils/specs`
- 返回: `{ success, data: [{ spec, unitPrice, sheets: [120,140,...], count }] }`

---

## 四、AI 智能助手 API

### 12. AI 对话 (Web 端, SSE)
- `POST /api/ai/chat`
- 请求体: `{ messages: [{ role: "user", content: "V750的成本?" }] }`
- 响应: SSE 流式事件 (`data: {...}\n\n`)

| 事件类型 | 说明 |
|---|---|
| `status` | 状态更新 (thinking/calling tool) |
| `tool_call` | 工具调用信息 |
| `tool_result` | 工具返回结果 |
| `content` | AI 最终文字回答 |
| `done` | 完成 |
| `error` | 错误 |

### 13. System Prompt 管理
- `GET /api/ai/system-prompt` → 获取当前 prompt
- `PUT /api/ai/system-prompt` → 修改 prompt (持久化到 NocoDB)
- 请求体: `{ "prompt": "新内容..." }`

### 14. 语音识别 (Web 端)
- `POST /api/ai/asr`
- Content-Type: `multipart/form-data`
- 字段: `audio` (文件), `format` (默认 pcm), `sampleRate` (默认 16000)
- 返回: `{ success, text: "识别的文字" }`

### AI 工具列表 (Function Calling)

| 工具名 | 功能 | 类型 |
|---|---|---|
| `query_recipe_cost_by_name` | 按名称查配方成本 | 只读 |
| `query_recipe_cost_by_id` | 按 ID 查配方成本 | 只读 |
| `full_calculate` | 一站式 BOM 计算 | 只读 |
| `get_copper_price` | 实时铜价 | 只读 |
| `calculate_coil_cost` | 线圈成本(支持插值) | 只读 |
| `get_coil_specs` | 可用规格列表 | 只读 |
| `get_all_recipes` | 配方列表 | 只读 |
| `get_all_parts` | 零件列表 | 只读 |
| `search_parts` | 按关键词/类别搜索零件 | 只读 |
| `dynamic_config_cost` | 浮球/电缆/包材成本 | 只读 |
| `get_recent_orders` | 最近订单列表 | 只读 |
| `create_part` | 新建零件(含回读验证) | **写入** |
| `update_part` | 修改零件(价格/库存/供应商) | **写入** |
| `delete_part` | 删除零件 | **写入** |
| `batch_update_prices` | 批量调价 | **写入** |
| `get_order_detail` | 订单详情(含利润计算) | 只读 |
| `create_order` | 新建订单 | **写入** |
| `update_order_status` | 修改订单状态 | **写入** |
| `get_dashboard_summary` | 运营数据汇总 | 只读 |
| `compare_recipes` | 配方成本对比 | 只读 |
| `generate_purchase_list` | 生成采购清单 | 只读 |

---

## 五、微信小程序专用 API

### 15. 微信语音识别
- `POST /api/wechat/asr`
- Content-Type: `multipart/form-data`
- 字段: `audio` (文件), `format` (pcm/wav, 可不传会自动检测), `sampleRate`
- **自动格式检测**: 文件名 `.wav` 或 RIFF 文件头 → 用 `wav` 格式调阿里云
- 返回: `{ success, text: "识别的文字" }`

### 16. 微信对话 (标准 JSON)
- `POST /api/wechat/chat`
- **注意**: 不是 SSE，是标准 JSON 请求-响应模式 (微信开发工具不支持 chunked transfer)
- 请求体: `{ messages: [{ role: "user", content: "..." }] }`
- 返回:
  ```json
  {
    "success": true,
    "content": "AI 的文字回复",
    "toolResults": [
      {
        "name": "query_recipe_cost_by_name",
        "view_type": "bom_cost_card",
        "result": { "success": true, "data": { ... } }
      }
    ]
  }
  ```
- `view_type` 映射表:

| view_type | 对应工具 |
|---|---|
| `bom_cost_card` | query_recipe_cost_*, full_calculate, calculate_coil_cost |
| `inventory_table` | search_parts, get_all_parts, get_coil_specs, get_all_recipes |
| `order_detail_card` | get_order_detail, get_order_list |
| `dashboard_card` | get_dashboard_summary |
| `compare_card` | compare_recipes |
| `purchase_list` | generate_purchase_list |
| `action_result` | get_copper_price, create_part, 等 |

---

## 六、NocoDB 数据操作 (前端直连)

前端通过 `src/utils/api.ts` 直接访问 NocoDB 进行 CRUD。

- **通用分页**: `GET /api/v2/tables/{tableId}/records?limit=100&offset={n}`
- **零件**: POST 创建 / PATCH 更新 / DELETE 删除 / `batchAddStock` 批量入库
- **配方**: POST 创建(含 parts_json 快照) / DELETE 删除
- **订单**: POST 创建 / PATCH 更新状态与采购清单

---

*本文档为单点信息源(SSOT)，API 变更请同步更新。*
