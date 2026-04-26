# 水泵 BOM 成本管理系统

集成订单 / 配方 / 库存 / 成本核算 + DeepSeek AI Agent + 企微助手 + FreeCAD 转子出图的水泵生产管理系统。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18 + TypeScript + Vite + MUI 5 + Zustand |
| 后端 | Node.js + Express 5 + better-sqlite3 |
| AI | DeepSeek Chat API (SSE) + 阿里云 ASR |
| 出图 | FreeCAD Python 脚本 + PDF 生成 |
| 通讯 | 企业微信 Webhook + Siri 快捷指令 |

## 项目结构

```
├── api.cjs                  # Express 入口 — 路由挂载 + 中间件 + 静态托管
├── api/
│   ├── db.cjs               # SQLite 初始化 + 建表 + Row Adapter + 工具函数
│   └── routes/
│       ├── parts.cjs         # 零件 CRUD
│       ├── recipes.cjs       # 配方 CRUD
│       ├── orders.cjs        # 订单 CRUD + 历史价格查询
│       ├── coils.cjs         # 线圈 CRUD + 成本插值计算
│       ├── templates.cjs     # 泵壳模板 CRUD
│       ├── cost.cjs          # 成本计算 + 铜价定时更新
│       ├── rotor.cjs         # FreeCAD 转子出图调度
│       ├── auth.cjs          # JWT 认证
│       ├── settings.cjs      # 系统设置
│       ├── wecom.cjs         # 企业微信消息接收
│       └── ai/               # AI 对话 + 语音 + Siri
├── src/
│   ├── main.tsx              # React 入口 + AuthGuard
│   ├── App.tsx               # 路由 + 导航布局
│   ├── pages/                # 页面组件
│   ├── components/           # 通用 + 业务组件
│   └── utils/
│       ├── api.ts            # proxyRequest 统一请求层
│       ├── store.ts          # Zustand 全局状态
│       ├── orderStore.ts     # 订单业务逻辑
│       ├── costCalculator.ts # 前端成本计算（与 db.cjs 同步）
│       └── theme.ts          # MUI 主题 + 设计 Token
├── freecad/                  # FreeCAD 出图模板与脚本
├── wechat-miniprogram/       # 微信小程序语音助手
├── scripts/
│   └── seed-demo-data.cjs    # 演示数据播种
└── docs/                     # 技术文档
```

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（前端 :3000 + 后端 :3002）
npm start

# 仅启动后端
npm run server

# 生产构建
npm run build
```

### 环境变量 (.env)

```env
ACCESS_PASSWORD=xxx           # 登录密码
JWT_SECRET=xxx                # JWT 签名密钥
DEEPSEEK_API_KEY=sk-xxx       # DeepSeek API Key
ALI_ACCESS_KEY_ID=xxx         # 阿里云 ASR
ALI_ACCESS_KEY_SECRET=xxx
SIRI_API_TOKEN=xxx            # Siri 快捷指令 Token
WECOM_TOKEN=xxx               # 企微回调 Token
WECOM_ENCODING_AES_KEY=xxx    # 企微消息加密密钥
WECOM_CORPID=xxx              # 企微企业 ID
WECOM_CORPSECRET=xxx          # 企微应用 Secret
CORS_ORIGIN=https://xxx       # 生产环境 CORS 域名（可选）
```

## 架构要点

### 数据流

```
前端 (proxyRequest) → Vite Proxy → Express API → better-sqlite3 → pump.db
```

- 所有前端请求通过 `proxyRequest()` 统一处理，自动携带 Cookie、处理 401 跳转登录
- 后端所有动态 UPDATE 操作通过 `safeUpdate()` 执行，列名正则校验 + 表名白名单防 SQL 注入
- Row Adapter（`partRow` / `recipeRow` 等）统一输出 camelCase 字段

### 成本计算公式

```
总成本 = 配件成本 + 线圈成本 + 动态配置 + 人工工资 + 管理费
```

- **配件成本**：精确匹配（型号+供应商）→ 型号回退（最低价）
- **线圈成本**：`单价×片数 + 线重×铜价 + 线圈加工费 + 转子加工费`（支持片数插值）
- **人工工资**：安装 / 打包 / 喷漆，绑定泵壳模板，配方可覆盖
- **管理费**：全局默认值存 `system_settings` 表

### 定时任务

| 任务 | 时间 | 机制 |
|------|------|------|
| 铜价更新 | 每天 15:00 BJT | setTimeout 链式调度 |
| 数据库备份 | 每天 03:00 BJT | VACUUM INTO + 保留最近 7 份 |
| 启动时 | 服务启动 | WAL Checkpoint + 立即备份一次 |

### 审计日志

所有通过 `safeUpdate()` 的写操作自动记录到 `audit_log` 表：

```
(action, table_name, record_id, old_value, new_value, user, created_at)
```

## API 端点

### 公开接口
- `POST /api/auth/login` — 登录（附限流 5次/分钟）
- `GET /api/health` — 健康检查

### 认证接口（需 Cookie）
- `GET/POST/PATCH/DELETE /api/parts` — 零件管理
- `GET/POST/PATCH/DELETE /api/recipes` — 配方管理
- `GET/POST/PATCH/DELETE /api/orders` — 订单管理
- `GET /api/orders/history-price/:recipeName` — 历史价格查询
- `GET/POST/PATCH/DELETE /api/coils` — 线圈管理
- `POST /api/coils/calculate` — 线圈成本计算（支持插值）
- `GET/POST/PATCH/DELETE /api/templates` — 泵壳模板
- `POST /api/cost/calculate` — 成本计算
- `POST /api/cost/full-calculate` — 一站式成本计算
- `GET/POST /api/copper-price` — 铜价查询/更新

### 独立认证接口
- `POST /api/ai/chat` — AI 对话 (SSE)
- `POST /api/siri/chat` — Siri 快捷指令（Token 认证）
- `POST /api/voice/asr` — 语音识别
- `GET/POST /api/wecom/webhook` — 企微消息
