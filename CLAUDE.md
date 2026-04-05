# 水泵BOM管理系统

## 项目简介
水泵BOM数据库 + 订单管理 + 成本计算API + AI智能助手。支持零件录入、配方组装、订单采购流转、库存联动，提供 AI Agent 可调用的成本计算后端。语音入口支持 Siri + iOS 快捷指令（推荐）和微信小程序（旧版）。

## 技术栈
- **Web 前端**：React 18 + TypeScript + Vite + Material UI 5 (端口 3000)
- **状态管理**：Zustand (全局 store + stale-while-revalidate 30s 缓存)
- **后端API**：Express.js `api.cjs` (端口 3002)
- **数据库**：SQLite (`pump.db`)，使用 `better-sqlite3` 同步驱动，前端通过后端 API 访问
- **AI**：DeepSeek Chat API + Function Calling (12+ 工具)
- **语音**：Siri + iOS 快捷指令（Apple STT, 推荐） / 阿里云 ASR (REST API) + Web Speech API (Chrome)
- **微信小程序**（旧版，逐步弃用）：原生开发，`wechat/` 目录独立工程
- **启动与数据初始化**：
  1. (可选) 生成/重置演示数据：`node scripts/seed-demo-data.cjs`
  2. 启动服务：`npm start`（并行启动前端 + API）

## 项目结构
```
├── api.cjs                    # Express API 单文件后端 (SQLite 直连)
├── pump.db                    # SQLite 数据库文件 (gitignore)
├── .env                       # DeepSeek + 阿里云连接配置
├── index.html                 # Vite 入口 HTML
├── package.json               # 依赖与脚本
│
├── scripts/
│   ├── migrate-to-sqlite.cjs  # 数据迁移脚本 (JSON → SQLite)
│   └── seed-demo-data.cjs     # 演示数据填充脚本 (执行 node scripts/seed-demo-data.cjs)
│
├── src/                       # React Web 前端
│   ├── main.tsx               # React 入口 + MUI 主题配置
│   ├── App.tsx                # Tab 路由: / /parts /recipes /recipe-form /orders /order-form /coils /ai-chat
│   │
│   ├── types/
│   │   └── index.ts           # 统一类型定义 (Part/Recipe/Order/OrderItem/PurchaseItem)
│   │
│   ├── utils/
│   │   ├── api.ts             # 后端 API 封装 (/api/parts, /api/recipes, /api/orders)
│   │   ├── orderStore.ts      # 订单 CRUD + 采购汇总算法
│   │   ├── costCalculator.ts  # 前端成本计算引擎
│   │   ├── store.ts           # Zustand 全局状态 (Parts/Recipes/Orders + SWR 缓存)
│   │   ├── theme.ts           # 设计 Token 系统 (语义色板/渐变/sx预设/工具函数)
│   │   └── format.ts          # 日期等格式化工具
│   │
│   ├── hooks/
│   │   └── useNotification.tsx  # 通用通知 Hook (Snackbar 封装)
│   │
│   ├── components/
│   │   ├── common/
│   │   │   ├── PageLoading.tsx   # 通用页面加载动画
│   │   │   └── EmptyState.tsx    # 通用空状态占位
│   │   ├── ai/
│   │   │   ├── StructuredResult.tsx  # AI 结构化数据卡片 (20+ 工具渲染)
│   │   │   └── StatusIndicator.tsx   # AI 连接状态指示器
│   │   ├── OrderDetailModal.tsx   # 订单详情弹窗 (采购清单/to-do/入库确认)
│   │   ├── RecipeDetailModal.tsx  # 配方详情弹窗 (成本快照对比)
│   │   ├── PartForm.tsx           # 零件录入表单
│   │   ├── PartList.tsx           # 零件分类列表
│   │   └── RecipePartRow.tsx      # 配方零件行组件
│   │
│   └── pages/
│       ├── DashboardPage.tsx    # 运营看板 (KPI + Kanban + 最近动态)
│       ├── PartsPage.tsx        # 零件管理
│       ├── RecipesPage.tsx      # 配方列表
│       ├── RecipeFormPage.tsx   # 4步向导录入配方
│       ├── OrdersPage.tsx       # 订单列表 (客户筛选/状态/定价汇总)
│       ├── OrderFormPage.tsx    # 4步向导新建订单
│       ├── CoilRotorPage.tsx    # 线圈转子管理 (铜价监控/CRUD/成本试算)
│       └── AIChatPage.tsx       # AI智能助手 (SSE流式 + 语音输入)
│
└── wechat/                    # 微信小程序 (独立工程)
    ├── app.js / app.json / app.wxss    # 小程序入口与全局配置
    ├── project.config.json             # 微信开发者工具配置
    └── pages/chat/
        ├── chat.js            # 核心逻辑: 录音→ASR→对话→卡片渲染
        ├── chat.wxml          # 7种数据卡片模板 + 语音/文字双模式输入
        └── chat.wxss          # 完整样式系统
```

## 架构设计

### 数据流
```
SQLite (pump.db)
    ↕ (better-sqlite3 同步查询)
api.cjs (3002)
    ↕ (/api/* 代理 + 成本计算 + AI + 微信)
React 前端 (3000)
    ↕ (Zustand store, 30s SWR 缓存)
页面组件 (useAppStore)
```

### 全局状态管理 (Zustand)
- **store.ts** — 统一管理 Parts / Recipes / Orders 三大数据集
- **缓存策略**：stale-while-revalidate，TTL 30 秒
  - 首次请求：fetch → 写入 store → 返回数据
  - 30s 内再次请求：直接返回缓存，不发请求
  - 超过 30s：返回旧数据同时后台刷新
  - `fetchXxx(true)` 强制绕过缓存（用于 CRUD 后刷新）
- **防并发**：loading flag 阻止同一数据集同时发起多次请求

### 设计 Token 系统 (theme.ts)
- **语义色板** `colors.blue/green/red/amber/purple/slate`：bg / border / main / dark / text / deepText
- **渐变集合** `gradients.orders/recipes/parts/revenue/profit/brand/copper/...`
- **sx 预设** `sxInfoPanel/sxSuccessPanel/sxErrorPanel/sxPurplePanel/sxWarningPanel`
- **工具函数** `profitColor(value)` / `costDiffColor(diff)`

### 安全架构
- 数据库文件 `pump.db` 仅后端访问，前端零暴露
- 前端所有数据操作走 `/api/parts`、`/api/recipes`、`/api/orders` 后端代理
- 后端 row adapter 函数统一转换 SQLite 列名，确保前端接口一致

## 核心业务逻辑

### 1. 配方系统
- **4步向导**：基本信息 → 线圈转子 + 必配配件(6项) → 选配 & 动态配置(浮球/电缆/包材) → 预览保存
- **动态配置特性**：线径从定子规格自动推导、电缆按米计价、包材模糊匹配最低价
- **成本快照**：保存时锁定 `snapshotPrice` 到 `parts_json`，后续可对比最新涨跌

### 2. 订单与定价
- **4步向导**：基本信息(客户/合同号) → 添加型号 & 定价 → 预览采购清单 → 确认提交
- **利润率系统**：每个型号独立设利润率(默认10%)，成本×利润率=出厂价，可手动覆盖后反算
- **历史价格对比**：添加型号时自动查历史订单同名配方的最近出厂价
- **采购汇总**：跨型号按 `model` 合并零件需求量，对比库存算缺口
- **状态流转**：待采购 → 采购中 → 已完成(触发 `batchAddStock` 自动入库)

### 3. 运营看板 (首页)
- KPI 统计卡片：订单总数、配方数、零件种类(含低库存预警)、总营收、总利润(含利润率)
- Kanban 三列看板(待采购/采购中/已完成)
- 最近动态列表(最近8单)

### 4. 成本计算引擎
前端 `costCalculator.ts` 和后端 `api.cjs` 共用同一套匹配逻辑：
1. 优先 `(model + supplier)` 精确匹配查最新单价
2. 匹配失败回退到仅 `model`，多供应商中取**最低价**兜底

### 5. 线圈转子成本
- **铜价自动更新**：启动时 + 每天15:00，从曲合期货网抓取1#铜最新价
- **成本公式**：`单价×片数 + 默认线重×铜价基数 + 线圈加工费 + 转子加工费`
- **线性插值**：片数不在DB中时自动按相邻值插值
- **管理页面**：`/coils` 路由，含铜价实时监控、按规格分组列表、成本试算计算器

### 6. AI 智能助手
- **Siri + 快捷指令**（推荐）: Apple STT 免费转写 → `POST /api/siri/chat` → DeepSeek Function Calling → Siri 朗读结果
- **Web 端** (`/ai-chat`): SSE 流式输出，支持 Chrome Web Speech API 语音输入
- **微信小程序**（旧版）: 标准 JSON 请求模式，阿里云 ASR 语音识别，7种结构化数据卡片渲染
- **Function Calling**: 12+ 工具覆盖配方查询、零件管理、订单操作、成本计算等
- **view_type 映射**: 后端根据工具名返回 `view_type` 字段，前端动态匹配渲染组件

## 数据库表结构 (SQLite)

| 表 | 关键字段 |
|---|---|
| **parts** (零件) | `id`, `model`, `category`, `price`(电缆=每米), `supplier`, `stock`, `remark` |
| **recipes** (配方) | `id`, `name`, `spec`, `parts_json`, `saved_total_cost`, `saved_cost_details` |
| **orders** (订单) | `id`, `customer_name`, `contract_no`, `remark`, `status`, `items_json`, `purchase_list_json`, `todos_json` |
| **coils** (线圈) | `id`, `spec`, `sheets`, `cost`, `default_wire_gauge`, `unit_price`, `wire_weight`, `copper_base`, `coil_fee`, `rotor_fee` |
| **config** (系统配置) | `id`, `key`, `value` — AI System Prompt 等键值对存储 |

> 所有表统一使用英文列名。后端 row adapter 函数同时返回中文别名以兼容旧代码。

## API 端点概览 (api.cjs, 端口 3002)

| 分类 | 方法 | 路径 | 用途 |
|---|---|---|---|
| **数据** | GET/POST/PATCH/DELETE | `/api/parts[/:id]` | 零件 CRUD |
| | GET/POST/PATCH/DELETE | `/api/recipes[/:id]` | 配方 CRUD |
| | GET/POST/PATCH/DELETE | `/api/orders[/:id]` | 订单 CRUD |
| **成本** | POST | `/api/cost/calculate` | 按零件数组计算成本 |
| | GET | `/api/cost/recipe/:id` | 按配方ID查成本 |
| | GET | `/api/cost/recipe/by-name?name=xxx` | 按名称查配方成本 |
| | POST | `/api/cost/dynamic-config` | 动态配置成本(浮球/电缆/包材) |
| | POST | `/api/cost/full-calculate` | **一站式BOM计算(推荐)** |
| **铜价** | GET | `/api/copper-price` | 获取实时铜价 |
| | POST | `/api/copper-price/update` | 手动触发铜价更新 |
| **线圈** | GET/POST/PATCH/DELETE | `/api/coils[/:id]` | 线圈CRUD(自动计算成本) |
| | POST | `/api/coils/calculate` | 线圈成本计算(支持插值) |
| | GET | `/api/coils/specs` | 可用规格列表 |
| **AI** | POST | `/api/ai/chat` | AI对话(SSE流式, Web端) |
| | GET/PUT | `/api/ai/system-prompt` | System Prompt 读写 |
| **Siri** | POST | `/api/siri/chat` | Siri快捷指令对话(含 speech 字段) |
| **微信** | POST | `/api/wechat/asr` | 微信语音识别 |
| | POST | `/api/wechat/chat` | 微信对话(标准JSON, 带view_type) |

> 详细接口文档见 `API_DOCUMENTATION.md`

## Siri + 快捷指令集成（推荐语音入口）

### 架构
```
🎙 Siri (Apple STT) → 快捷指令 POST 文字 → /api/siri/chat → DeepSeek + Function Calling → speech 朗读
```

### iOS 快捷指令配置
1. 新建快捷指令，命名为「查水泵」
2. 添加「听写文本」动作 → 存入变量 `userInput`
3. 添加「获取 URL 内容」动作:
   - URL: `https://你的域名/api/siri/chat`
   - 方法: POST
   - Headers: `Content-Type: application/json`（如配置了 token 则加 `X-Siri-Token: <token>`）
   - Body: `{ "text": userInput, "project": "pump" }`
4. 获取词典值-从URL的内容-speech
5. 添加「朗读文本」动作 → 朗读响应中的 `speech` 字段
6. 唤醒: “嘿 Siri，查水泵”

### 鉴权
- `.env` 中 `SIRI_API_TOKEN` 留空则跳过鉴权（开发模式）
- 设置 token 后，请求头需携带 `X-Siri-Token`

### 多项目路由
- `project=pump` → 本地 PumpDB 处理
- `project=cad` → 转发到 FreeCAD Python API (`CAD_API_URL`)

## 微信小程序开发指南（旧版，逐步弃用）

### 环境配置
1. 微信开发者工具打开 `wechat/` 目录
2. 勾选「不校验合法域名」
3. 修改 `app.js` 中 `baseUrl` 为你的局域网 IP + 端口 3002
4. 基础库版本 ≥ 2.20.2

### 数据卡片 (view_type)
| view_type | 对应工具 | UI 组件 |
|---|---|---|
| `bom_cost_card` | query_recipe_cost, full_calculate | 成本卡片(可展开明细) |
| `inventory_table` | search_parts, get_all_parts | 零件列表 |
| `order_detail_card` | get_order_detail | 订单详情(状态/利润) |
| `dashboard_card` | get_dashboard_summary | 运营看板 |
| `compare_card` | compare_recipes | 配方对比 |
| `purchase_list` | generate_purchase_list | 采购清单 |
| `action_result` | 通用 | 操作成功/失败提示 |

## 开发避坑

1. **前端不可直连数据库**：所有数据通过 `/api/*` 后端代理，`pump.db` 仅后端访问。
2. **Zustand 缓存刷新**：CRUD 操作后必须调 `fetchParts(true)` / `fetchRecipes(true)` 强制刷新 store 缓存。
3. **MUI DOM 嵌套**：`<Chip>`/`<div>` 不能放在 `<Typography>`(p标签) 内，加 `component="div"` 解决。
4. **旧配方无成本快照**：`saved_total_cost=0` 的旧配方，订单添加型号时会实时调 `calculateRecipeCost()` 补算。
5. **微信 SSE 不可靠**：小程序端已改用标准 JSON 请求。
6. **微信录音格式**：开发者工具录 `.wav`，真机录 `.pcm`，后端需自动检测格式。
7. **设计 Token**：新增颜色/渐变优先添加到 `theme.ts`，避免在组件中硬编码 hex 值。
8. **SQLite WAL 模式**：`pump.db` 启用了 WAL 模式以提升并发性能，会生成 `-wal` 和 `-shm` 辅助文件。
