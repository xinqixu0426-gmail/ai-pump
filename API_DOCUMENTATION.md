# 水泵 BOM 管理系统 API 文档

**后端**: `http://localhost:3002` | **前端**: `https://localhost:3000` (Vite HTTPS + proxy `/api/*` → 3002)

---

## 一、数据 CRUD

前端通过 `/api/*` 操作数据，不直连 SQLite。

| 资源 | GET | POST | PATCH | DELETE |
|---|---|---|---|---|
| `/api/parts[/:id]` | 全部零件 | 新建 | 更新 | 删除 |
| `/api/recipes[/:id]` | 全部配方 | 新建(含快照) | 更新 | 删除 |
| `/api/orders[/:id]` | 全部订单 | 新建 | 更新(状态/定价) | 删除 |
| `/api/templates[/:id]` | 泵壳模板 | 新建 | 更新 | 删除 |
| `/api/coils[/:id]` | 线圈记录 | 新建(自动算) | 更新(自动重算) | 删除 |

---

## 二、成本计算

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/cost/calculate` | 按零件数组计算成本 |
| GET | `/api/cost/recipe/:id` | 按配方ID查成本 |
| GET | `/api/cost/recipe/by-name?name=xxx` | 按名称查配方成本 |
| POST | `/api/cost/dynamic-config` | 动态配置成本(浮球/电缆/包材) |
| POST | `/api/cost/full-calculate` | **一站式BOM计算(推荐)** |

### 一站式计算请求示例
```json
{
  "pumphousing_model": "V750",
  "stator": "12-120",
  "cableLength": 10,
  "boxType": "木箱",
  "hasFloat": true
}
```

---

## 三、铜价 & 线圈

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/copper-price` | 实时铜价 |
| POST | `/api/copper-price/update` | 手动触发铜价更新 |
| POST | `/api/coils/calculate` | 线圈成本(支持插值) |
| GET | `/api/coils/specs` | 可用规格列表 |

**线圈成本公式**: `单价×片数 + 线重×铜价基数 + 线圈加工费 + 转子加工费`

---

## 四、AI 智能助手

### Web 端 (SSE)
- `POST /api/ai/chat` — 请求体: `{ messages: [{ role, content }] }`
- SSE 事件: `status` / `tool_call` / `tool_result` / `content` / `done` / `error`

### Siri 快捷指令
- `POST /api/siri/chat` — 请求体: `{ text, project: "pump" }`
- 返回: `{ success, speech, content, toolResults }`
- 鉴权: `.env` 中 `SIRI_API_TOKEN` 留空则跳过

### System Prompt
- `GET /PUT /api/ai/system-prompt`

---

## 五、语音识别 (ASR)

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/voice/asr` | 阿里云一句话识别（自动获取/缓存 NLS Token）|

### 请求
- `Content-Type: multipart/form-data`
- `audio`: WAV 文件 (16kHz, 16bit, mono)
- `format`: `wav` (default)
- `sampleRate`: `16000` (default)

### 响应
```json
{ "success": true, "text": "识别的文字" }
```

### 环境变量
- `ALI_ASR_APPKEY`: NLS 项目 AppKey
- `ALI_ACCESS_KEY_ID` / `ALI_ACCESS_KEY_SECRET`: AK/SK，用于自动获取 NLS Token

---

## 六、PWA 语音助手

- **前端路由**: `/voice` （独立全屏渲染，不走 App 布局）
- **录音**: AudioContext + ScriptProcessorNode 采集原始 PCM，下采样到 16kHz，编码为 WAV
- **流程**: 麦克风 → WAV → `/api/voice/asr` → 文字 → `/api/ai/chat` (SSE) → 结构化卡片
- **卡片白名单**: 仅精确查询工具渲染卡片，批量列表工具只显示 AI 文字总结（防止信息泄露）

### Function Calling 工具 (20+)

| 工具 | 类型 |
|---|---|
| `query_recipe_cost_by_name/id` | 只读 |
| `full_calculate` | 只读 |
| `get_copper_price`, `calculate_coil_cost`, `get_coil_specs` | 只读 |
| `get_all_recipes`, `get_all_parts`, `search_parts` | 只读 |
| `dynamic_config_cost` | 只读 |
| `get_recent_orders`, `get_order_detail`, `get_dashboard_summary` | 只读 |
| `compare_recipes`, `generate_purchase_list` | 只读 |
| `create_part`, `update_part`, `delete_part`, `batch_update_prices` | **写入** |
| `create_order`, `update_order_status` | **写入** |

---

*本文档为单点信息源(SSOT)，API 变更请同步更新。*

