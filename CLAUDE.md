# 水泵BOM管理系统

## 项目简介
水泵BOM数据库 + 订单管理 + 成本计算API + AI智能助手。支持零件录入、配方组装、订单采购流转、库存联动，提供 AI Agent 可调用的成本计算后端。PWA 语音助手支持麦克风录音+阿里云 ASR+DeepSeek Function Calling。

## 技术栈
- **Web 前端**：React 18 + TypeScript + Vite + Material UI 5 (端口 3000)
- **状态管理**：Zustand (全局 store + stale-while-revalidate 30s 缓存)
- **后端API**：Express.js `api.cjs` (端口 3002)
- **数据库**：SQLite (`pump.db`)，使用 `better-sqlite3` 同步驱动
- **AI**：DeepSeek Chat API + Function Calling (12+ 工具)
- **语音**：PWA 语音助手（浏览器麦克风 + 阿里云 ASR 一句话识别）+ Siri 快捷指令
- **PWA**：`manifest.json` + HTTPS 自签名证书，支持 iOS/Android 添加到主屏幕
- **启动**：`npm start`（并行启动前端 + API）
- **演示数据**：`node scripts/seed-demo-data.cjs`

## 项目结构
```
├── api.cjs                    # Express API 入口及路由挂载
├── api/                       # 后端拆分模块组
│   ├── db.cjs                 # SQLite 初始化、表结构预检及 Row 适配器
│   └── routes/                # 业务路由集合 (ai, coils, cost, orders, parts, recipes, templates)
├── pump.db                    # SQLite 数据库文件 (gitignore)
├── .env                       # API 密钥配置 (gitignore, 勿提交)
├── index.html                 # Vite 入口 HTML
├── package.json               # 依赖与脚本
│
├── scripts/
│   ├── migrate-to-sqlite.cjs  # 数据迁移脚本 (JSON → SQLite)
│   └── seed-demo-data.cjs     # 演示数据填充脚本
│
├── src/                       # React Web 前端
│   ├── main.tsx               # React 入口 + 路由分发 (/voice 独立渲染, /* 走 App 布局)
│   ├── App.tsx                # Tab 主路由: / /parts /recipes /recipe-form /orders /order-form /coils /ai-chat
│   │
│   ├── types/
│   │   └── index.ts           # 统一类型定义 (Part/Recipe/Order/PumpShellTemplate)
│   │
│   ├── utils/
│   │   ├── api.ts             # 后端 API 封装 (/api/parts, /api/recipes, /api/orders, /api/templates)
│   │   ├── orderStore.ts      # 订单 CRUD + 采购汇总算法
│   │   ├── costCalculator.ts  # 前端成本计算引擎
│   │   ├── store.ts           # Zustand 全局状态 (Parts/Recipes/Orders/Templates + SWR 缓存)
│   │   ├── theme.ts           # 设计 Token 系统 (语义色板/渐变/sx预设/工具函数)
│   │   └── format.ts          # 日期等格式化工具
│   │
│   ├── components/
│   │   ├── ai/
│   │   │   ├── StructuredResult.tsx  # AI 结构化数据卡片 (20+ 工具渲染)
│   │   │   └── StatusIndicator.tsx   # AI 连接状态指示器
│   │   ├── PageHeader.tsx         # 通用页面标题组件
│   │   ├── OrderDetailModal.tsx   # 订单详情弹窗
│   │   ├── RecipeDetailModal.tsx  # 配方详情弹窗
│   │   ├── PartForm.tsx           # 零件录入表单
│   │   ├── PartList.tsx           # 零件分类列表
│   │   └── RecipePartRow.tsx      # 配方零件行组件
│   │
│   └── pages/
│       ├── DashboardPage.tsx    # 运营看板 (KPI + Kanban + 最近动态)
│       ├── PartsPage.tsx        # 零件管理
│       ├── RecipesPage.tsx      # 配方列表 (含泵壳模板管理)
│       ├── RecipeFormPage.tsx   # 4步向导录入配方
│       ├── OrdersPage.tsx       # 订单列表
│       ├── OrderFormPage.tsx    # 4步向导新建订单
│       ├── CoilRotorPage.tsx    # 线圈转子管理
│       ├── AIChatPage.tsx       # AI智能助手 (SSE流式 + 语音输入)
│       └── VoiceAssistantPage.tsx # PWA 语音助手 (全屏暗色, 麦克风+ASR+AI)
│
├── public/
│   ├── manifest.json          # PWA manifest (start_url: /voice)
│   ├── icons/                 # PWA 图标
│   └── siri-result.html       # Siri 查询结果展示页
```

## 数据流架构
```
SQLite (pump.db) ↕ better-sqlite3 → api.cjs (3002) ↕ /api/* → React (3000) ↕ Zustand store → 页面组件
```

## 核心业务逻辑

### 配方系统
- **泵壳模板驱动**：选泵壳型号 → 自动填充固定配件清单
- **4步向导**：泵壳模板 + 基本信息 → 线圈转子 + 必配配件 → 选配(浮球/电缆/包材) → 预览保存
- **成本快照**：保存时锁定 `snapshotPrice`，后续可对比最新涨跌

### 订单与定价
- **4步向导**：基本信息 → 添加型号 & 定价 → 预览采购清单 → 确认提交
- **利润率系统**：每个型号独立设利润率(默认10%)
- **采购汇总**：跨型号按 `model` 合并零件需求量，对比库存算缺口
- **状态流转**：待采购 → 采购中 → 已完成(自动入库)

### 成本计算引擎
前端 `costCalculator.ts` 和后端 `api.cjs` 共用逻辑：
1. 优先 `(model + supplier)` 精确匹配
2. 回退到仅 `model`，多供应商取最低价

### 线圈转子
- **铜价自动更新**：启动时 + 每天15:00
- **成本公式**：`单价×片数 + 线重×铜价基数 + 线圈加工费 + 转子加工费`
- 支持线性插值

### AI 智能助手
- **PWA 语音助手** (`/voice`): 浏览器麦克风 → PCM WAV → 阿里云 ASR → DeepSeek Function Calling → 结构化卡片
  - 全屏暗色沉浸式 UI，支持 iOS/Android 添加到主屏幕
  - SSE 流式显示 DeepSeek 状态（思考/调用API/整理结果）
  - 卡片白名单过滤：仅精确查询渲染卡片，批量数据只输出文字总结
- **Siri 快捷指令**: Apple STT → `POST /api/siri/chat` → DeepSeek → 朗读
- **Web 端 AI Chat**: SSE 流式输出 + 语音输入
- **Function Calling**: 20+ 工具覆盖配方/零件/订单/成本查询与操作

## 数据库表结构 (SQLite)

| 表 | 关键字段 |
|---|---|
| **parts** | `id, model, category, price, supplier, stock, remark` <br>*(注：前端扩展属性存入 remark 作为 JSON)* |
| **recipes** | `id, name, spec, parts_json, saved_total_cost, template_id, coil_spec, coil_sheets, ...` |
| **orders** | `id, customer_name, contract_no, status, items_json, purchase_list_json, todos_json` |
| **coils** | `id, spec, sheets, cost, unit_price, wire_weight, copper_base, coil_fee, rotor_fee` |
| **pump_shell_templates** | `id, shell_model, description, parts_json` |
| **config** | `id, key, value` |

## API 端点概览 (端口 3002)

| 分类 | 路径 | 用途 |
|---|---|---|
| **零件** | `/api/parts[/:id]` | CRUD |
| **配方** | `/api/recipes[/:id]` | CRUD |
| **订单** | `/api/orders[/:id]` | CRUD |
| **模板** | `/api/templates[/:id]` | 泵壳模板 CRUD |
| **成本** | `/api/cost/calculate`, `/api/cost/full-calculate` | BOM 成本计算 |
| **铜价** | `/api/copper-price` | 实时铜价 |
| **线圈** | `/api/coils[/:id]`, `/api/coils/calculate` | 线圈 CRUD + 插值计算 |
| **AI** | `/api/ai/chat`, `/api/siri/chat` | AI 对话 (SSE/JSON) |
| **语音** | `/api/voice/asr` | 阿里云 ASR 语音识别 (自动获取 NLS Token) |

> 详细接口文档见 `API_DOCUMENTATION.md`

## 开发避坑

1. **前端不可直连数据库**：所有数据通过 `/api/*` 后端代理。
2. **Zustand 缓存刷新**：CRUD 后必须 `fetchXxx(true)` 强制刷新。
3. **MUI DOM 嵌套**：`<Chip>` 不能放在 `<Typography>`(p标签) 内，加 `component="div"`。
4. **设计 Token**：新增颜色/渐变优先添加到 `theme.ts`，避免硬编码 hex。
5. **`.env` 不提交**：含 API 密钥，已在 `.gitignore` 中。
