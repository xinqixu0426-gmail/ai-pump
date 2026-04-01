# 水泵BOM管理系统

## 项目简介
水泵BOM数据库 + 订单管理 + 成本计算API + AI智能助手。支持零件录入、配方组装、订单采购流转、库存联动，提供 N8N / AI Agent 可调用的成本计算后端，以及微信小程序语音交互入口。

## 技术栈
- **Web 前端**：React 18 + TypeScript + Vite + Material UI 5 (端口 3000)
- **后端API**：Express.js `api.cjs` (端口 3002)
- **数据库**：NocoDB REST API (端口 8080)
- **AI**：DeepSeek Chat API + Function Calling (12+ 工具)
- **语音**：阿里云 ASR (REST API) + Web Speech API (Chrome)
- **微信小程序**：原生开发，`wechat/` 目录独立工程
- **NocoDB 配置**：`.env` 文件注入
- **启动**：`npm start`（并行启动前端 + API）

## 项目结构
```
├── api.cjs                    # Express API 单文件后端 (成本计算/铜价/线圈/AI/微信接口)
├── .env                       # NocoDB + DeepSeek + 阿里云 连接配置
├── index.html                 # Vite 入口 HTML
├── package.json               # 依赖与脚本
│
├── src/                       # React Web 前端
│   ├── main.tsx               # React 入口 + MUI 主题
│   ├── App.tsx                # 路由: / /parts /recipes /recipe-form /orders /order-form /coils /ai-chat
│   ├── types/index.ts         # TypeScript 类型 (Part/Recipe/Order/OrderItem/PurchaseItem 等)
│   ├── utils/
│   │   ├── api.ts             # NocoDB 前端 API 封装
│   │   ├── costCalculator.ts  # 前端成本计算引擎
│   │   └── orderStore.ts      # 订单 NocoDB CRUD + 采购汇总算法
│   ├── components/
│   │   ├── OrderDetailModal   # 订单详情弹窗 (采购清单/to-do/入库确认)
│   │   ├── RecipeDetailModal  # 配方详情弹窗 (成本快照对比)
│   │   ├── PartForm / PartList / RecipePartRow
│   └── pages/
│       ├── DashboardPage      # 运营看板 (KPI统计 + Kanban + 最近动态)
│       ├── PartsPage          # 零件管理
│       ├── RecipesPage        # 配方列表
│       ├── RecipeFormPage     # 4步向导录入配方
│       ├── OrdersPage         # 订单列表 (客户筛选/状态/定价汇总)
│       ├── OrderFormPage      # 4步向导新建订单
│       ├── CoilRotorPage      # 线圈转子管理 (铜价监控/CRUD/成本试算)
│       └── AIChatPage         # AI智能助手 (Web端, SSE流式, 语音输入)
│
└── wechat/                    # 微信小程序 (独立工程)
    ├── app.js / app.json / app.wxss    # 小程序入口与全局配置
    ├── project.config.json             # 微信开发者工具配置 (AppID: wx2eb01189c87a322e)
    └── pages/chat/
        ├── chat.js            # 核心逻辑: 录音→ASR→对话→卡片渲染
        ├── chat.wxml          # 7种数据卡片模板 + 语音/文字双模式输入
        └── chat.wxss          # 完整样式系统
```

## 核心业务逻辑

### 1. 配方系统
- **4步向导**：基本信息 → 必配配件(6项) → 选配 & 动态配置(浮球/电缆/包材) → 预览保存
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
- **Web 端** (`/ai-chat`): SSE 流式输出，支持 Chrome Web Speech API 语音输入
- **微信小程序**: 标准 JSON 请求模式，阿里云 ASR 语音识别，7种结构化数据卡片渲染
- **Function Calling**: 12+ 工具覆盖配方查询、零件管理、订单操作、成本计算等
- **view_type 映射**: 后端根据工具名返回 `view_type` 字段，前端动态匹配渲染组件

## 数据库表结构 (NocoDB)

| 表 | 关键字段 |
|---|---|
| **Parts** (零件) | `Id`, `型号`, `类别`, `单价`(电缆=每米), `供应商`, `库存` |
| **Recipes** (配方) | `Id`, `配方名称`, `规格`, `配件JSON`, `保存时总成本`, `保存时成本明细` |
| **Orders** (订单) | `Id`, `客户名称`, `合同号`, `备注`, `订单状态`, `型号列表JSON`, `采购清单JSON`, `采购TodoJSON` |
| **线圈成本表** | `规格`, `片数`, `成本`, `默认线径`, `单价`, `线重`, `铜价基数`, `线圈加工费用`, `转子加工费用` |
| **system-config** | AI System Prompt 持久化存储 |

> **字段名注意**：NocoDB 表字段为中文。代码中做了双重兼容：`r.saved_total_cost || r.保存时总成本 || 0`。

## API 端点概览 (api.cjs, 端口 3002)

| 分类 | 方法 | 路径 | 用途 |
|---|---|---|---|
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
| | POST | `/api/ai/asr` | 语音识别(Web端, 阿里云ASR) |
| **微信** | POST | `/api/wechat/asr` | 微信语音识别(自动检测wav/pcm格式) |
| | POST | `/api/wechat/chat` | 微信对话(标准JSON, 带view_type) |

> 详细接口文档见 `API_DOCUMENTATION.md`

## 微信小程序开发指南

### 环境配置
1. 微信开发者工具打开 `wechat/` 目录
2. 勾选「不校验合法域名」
3. 修改 `app.js` 中 `baseUrl` 为你的局域网 IP + 端口 3002
4. 基础库版本 ≥ 2.20.2

### 语音识别注意事项
- **开发者工具录音**：输出 `.wav` 格式，后端自动检测 RIFF 头并用 `wav` 格式调阿里云 ASR
- **真机录音**：输出 raw `pcm`，直接传 pcm 格式
- 录音参数：`sampleRate: 16000`, `numberOfChannels: 1`

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

1. **PowerShell + NocoDB 中文 = 灾难**：`Invoke-RestMethod` 会把中文字段名变乱码，永远用 Node.js 或 `curl.exe`。
2. **MUI DOM 嵌套**：`<Chip>`/`<div>` 不能放在 `<Typography>`(p标签) 内，加 `component="div"` 解决。
3. **NocoDB 中文字段兼容**：代码中 `r.saved_total_cost || r.保存时总成本 || 0` 双重兜底。
4. **旧配方无成本快照**：`保存时总成本=0` 的旧配方，订单添加型号时会实时调 `calculateRecipeCost()` 补算。
5. **NocoDB 分页限制**：默认返回25条，已封装递归分页函数 `fetchAllRecords()` 解决。
6. **微信 SSE 不可靠**：`enableChunkedTransfer` 在开发者工具上频繁 timeout，小程序端已改用标准 JSON 请求。
7. **微信录音格式**：开发者工具录 `.wav`，真机录 `.pcm`，后端需自动检测格式。
8. **WXSS 不支持中文选择器**：CSS class 名不能用中文，需要映射为英文。
