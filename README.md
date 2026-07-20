# 水泵 BOM 成本管理系统

集成订单 / 配方 / 库存 / 成本核算 + DeepSeek AI Agent + 企微助手 + 微信小程序语音助手 + FreeCAD 转子出图的水泵生产管理系统。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Next.js + Tailwind CSS 主业务前端 |
| 后端 | Node.js + Express 5 + better-sqlite3 |
| AI | DeepSeek Chat API (SSE) + 阿里云 ASR |
| 出图 | FreeCAD Python 脚本 + PDF 生成 |
| 通讯 | 企业微信 Webhook + Siri 快捷指令 |
| 移动端 | iPhone PWA（AI 调度入口）+ 微信小程序（语音助手 + Server-Driven UI） |

## 项目结构

```
├── api.cjs                  # Express 入口 — 路由挂载 + 中间件 + 静态托管
├── api/
│   ├── db.cjs               # SQLite 初始化 + 建表 + Row Adapter + 工具函数
│   ├── authMiddleware.cjs    # JWT 认证中间件
│   └── routes/
│       ├── parts.cjs         # 零件 CRUD
│       ├── recipes.cjs       # 配方 CRUD（含包装配置）
│       ├── orders.cjs        # 订单 CRUD + 历史价格查询
│       ├── coils.cjs         # 线圈 CRUD + 成本插值计算
│       ├── templates.cjs     # 泵壳模板 CRUD
│       ├── cost.cjs          # 成本计算 + 铜价定时更新
│       ├── rotor.cjs         # FreeCAD 转子出图调度
│       ├── auth.cjs          # JWT 认证 + 登录限流
│       ├── settings.cjs      # 系统设置（管理费等）
│       ├── wecom.cjs         # 企业微信消息接收
│       └── ai/               # AI 对话 + 语音 + Siri
│           ├── chat.cjs      # DeepSeek SSE 对话
│           ├── voice.cjs     # 阿里云 ASR 语音识别
│           ├── siri.cjs      # Siri 快捷指令入口
│           └── executor.cjs  # AI Function Calling 执行器
├── apps/web-next/
│   ├── app/                  # Next App Router 页面入口
│   │   └── voice/            # iPhone PWA AI 调度入口
│   ├── components/           # Next 业务组件与基础 UI
│   └── lib/                  # Next 统一 API client 与页面规则
├── freecad/                  # FreeCAD 转子出图模板与 Python 脚本
├── wechat-miniprogram/       # 微信小程序语音助手
│   ├── pages/voice/          # 语音对话主页面
│   └── components/           # detail-panel 等组件
├── scripts/
│   └── migrate-add-packing.cjs  # 包装字段迁移脚本
└── docs/                     # 技术文档
```

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（Next 主前端 :3000 + 后端 :3002）
npm start

# 干净重启本地开发服务，并把 API / Web 日志写入 logs/local-*.log
npm run restart:local

# Next 并行预览版（Next :3001 + 后端 :3002）
npm run web-next:full

# 仅启动后端
npm run api

# 主前端生产构建（Next）
npm run build
```

### Next 主业务入口

`apps/web-next/` 是 Next.js + Tailwind CSS 的唯一 Web 前端。默认业务入口运行在 `http://localhost:3000`，并行预览入口运行在 `http://localhost:3001`，通过 rewrites 将 `/api/*` 转发到现有 Express API `http://localhost:3002`。它不接管业务 API，也不改变数据库。

当前 Next 版已覆盖订单、零件、客户、配方、报价、采购、线圈、转子出图、看板和 AI 助手，作为唯一 Web 前端和日常主业务入口。

### iPhone PWA 入口

移动端 PWA 位于 `http://localhost:3000/voice`，生产环境同域访问 `/voice`。`public/manifest.json` 的 `start_url` 已指向该入口，显示模式为 `standalone`，适合添加到 iPhone 主屏幕后独立启动。

安装方式：

1. 用 iPhone Safari 打开生产环境 `/voice`。
2. 点击分享按钮。
3. 选择“添加到主屏幕”。
4. 从主屏幕打开“水泵助手”。

PWA 当前是基础 AI 助手，支持文字输入和轻量语音输入。语音只负责把录音提交到后端 `/api/voice/asr` 转成文字，之后仍复用 `/api/ai/chat` SSE 和 `/api/ai/confirm-tool` 写操作确认，不新增业务 API，也不暴露 DeepSeek 或 ASR 密钥。

生产构建和启动：

```bash
npm run build
npm run preview
```

当前业务流程、API、状态和 UI 规则见 [`docs/README.md`](docs/README.md)。

### Windows 转子出图依赖

转子出图会先由 FreeCAD 导出 SVG，再使用 `svglib` 和 `reportlab` 转换为 PDF。Windows 版 FreeCAD 1.1 自带独立的 Python 3.11 环境，不能假设系统 Python 或项目 npm 依赖中已经包含这些库。

如果终端出现以下报错：

```text
ModuleNotFoundError: No module named 'svglib'
```

使用 FreeCAD 自带的 Python 将依赖安装到当前用户的 FreeCAD 专用目录：

```powershell
$target = Join-Path $env:APPDATA 'FreeCAD\python-packages'
New-Item -ItemType Directory -Force -Path $target | Out-Null
& 'C:\Program Files\FreeCAD 1.1\bin\python.exe' -m pip install `
  --target $target `
  --index-url https://pypi.tuna.tsinghua.edu.cn/simple `
  svglib reportlab
```

注意：直接设置 `PYTHONPATH` 并不一定有效。FreeCAD 的嵌入式解释器可能忽略用户级 Python 包目录，因此 `worker.py` 启动时会显式加载：

```text
%APPDATA%\FreeCAD\python-packages
```

安装完成后，重新启动 Node.js 后端服务，再发起一次转子出图请求验证 PDF 是否正常生成。

### 环境变量 (.env)

可从 `.env.example` 复制后填写真实值；真实 `.env` 已被 `.gitignore` 忽略，不要提交。

```env
ACCESS_PASSWORD=xxx           # 登录密码
JWT_SECRET=xxx                # JWT 签名密钥
DEEPSEEK_API_KEY=sk-xxx       # DeepSeek API Key
DEEPSEEK_MODEL=deepseek-v4-flash # DeepSeek 模型
ALI_ACCESS_KEY_ID=xxx         # 阿里云 ASR
ALI_ACCESS_KEY_SECRET=xxx
ALI_ASR_APPKEY=xxx            # 阿里云 ASR AppKey
SIRI_API_TOKEN=xxx            # Siri 快捷指令 Token
WECOM_TOKEN=xxx               # 企微回调 Token
WECOM_ENCODING_AES_KEY=xxx    # 企微消息加密密钥
WECOM_CORP_ID=xxx             # 企微企业 ID
WECOM_SECRET=xxx              # 企微应用 Secret
WECOM_AGENT_ID=xxx            # 企微应用 AgentID
INTERNAL_SECRET=xxx           # 内部 API 鉴权密钥
CORS_ORIGIN=https://your.domain # 生产环境允许的前端源
PORT=3002                     # 后端 Express 端口
NEXT_ORIGIN=http://127.0.0.1:3000 # API 端口代理页面请求到 Next
```

微信小程序当前仍通过 `INTERNAL_SECRET` 兼容鉴权，但小程序包会分发到客户端，不能在仓库中提交真实密钥。`wechat-miniprogram/config.js` 只保留开发占位；生产应迁移到 OpenID 或服务端会话鉴权。

## 架构要点

### 数据流

```
Next 前端 (proxyRequest/proxyFetch) → Next rewrites → Express API → better-sqlite3 → pump.db
```

- 所有前端请求通过 `proxyRequest()` 统一处理，自动携带 Cookie、处理 401 跳转登录
- 后端所有动态 UPDATE 操作通过 `safeUpdate()` 执行，列名正则校验 + 表名白名单防 SQL 注入
- Row Adapter（`partRow` / `recipeRow` 等）统一输出 camelCase 字段

### 成本计算公式

```
总成本 = 配件成本 + 线圈成本 + 动态配置 + 人工工资 + 包装材料 + 管理费
```

- **配件成本**：精确匹配（型号+供应商）→ 型号回退（最低价）
- **线圈成本**：`单价×片数 + 线重×铜价 + 线圈加工费 + 转子加工费`（支持片数插值）
- **人工工资**：安装 / 打包 / 喷漆，绑定泵壳模板，配方可覆盖
- **包装材料**：支持 standalone 和 grouped 两种模式，配方级配置
- **管理费**：全局默认值存 `system_settings` 表

### 定时任务

| 任务 | 时间 | 机制 |
|------|------|------|
| 铜价更新 | 每天 15:00 BJT | setTimeout 链式调度 |
| 数据库备份 | 每天 03:00 BJT | better-sqlite3 backup() + 保留最近 7 份 |
| 启动时 | 服务启动 | WAL Checkpoint + 立即备份一次 |

### 审计日志

所有通过 `safeUpdate()` 的写操作自动记录到 `audit_log` 表：

```
(action, table_name, record_id, old_value, new_value, user, created_at)
```

## 部署

### 生产环境（Mac Mini）

完整发布前后检查见 [docs/deployment-checklist.md](docs/deployment-checklist.md)。生产重启前必须先通过 `npm run verify:release`。

```bash
# SSH 到服务器
ssh dan@192.168.31.216
cd ~/Documents/pump-cost-accounting-system

# 拉取 + 构建 + 重启
export PATH=/opt/homebrew/bin:$PATH
git pull origin master
npm install
npm --prefix apps/web-next install
npm run verify:release
./scripts/install-macmini-launchdaemons.sh
```

### Next 并行预览入口

如需不占用 `3000`，可以使用 `3001` 并行预览入口：

```bash
export PATH=/opt/homebrew/bin:$PATH
git pull origin master
npm run web-next:build
pkill -f 'node api.cjs'
pkill -f 'next start -p 3001'
nohup node api.cjs > api.out.log 2>&1 &
nohup npm run web-next:start > web-next.out.log 2>&1 &
```

## API 端点

当前业务、成本、接口与运维说明见 [`docs/README.md`](docs/README.md)。API 修改必须遵守 [`docs/api-sop.md`](docs/api-sop.md)。

### 公开接口
- `POST /api/auth/login` — 登录（附限流 5次/分钟）
- `GET /api/health` — 健康检查

### 认证接口（需 Cookie）
- `GET/POST/PATCH/DELETE /api/parts` — 零件管理
- `GET/POST/PATCH/DELETE /api/recipes` — 配方管理
- `GET/POST/PATCH/DELETE /api/orders` — 订单管理
- `GET /api/orders/history-price/:recipeName` — 历史价格查询
- `GET/POST/PATCH/DELETE /api/coils` — 线圈管理
- `GET /api/coils/specs` — 线圈规格列表，`materials` 合并已配置材质与已使用材质
- `POST /api/coils/calculate` — 线圈成本计算（支持插值；规格下没有该材质记录时，可用材质配置单价兜底）
- `GET/POST/PATCH/DELETE /api/templates` — 泵壳模板
- `POST /api/cost/parts` — 配件数组成本计算
- `POST /api/recipes/cost-draft` — 配方保存成本快照草稿
- `POST /api/recipes/:id/cost-preview` — 报价/订单覆盖试算
- `POST /api/cost/full-estimate` — AI/N8N 一站式成本估算
- `GET/POST /api/market-indicators` — 市场指标查询/同步（铜价、铝线价格、人民币兑美元汇率）
- `GET/POST /api/copper-price` — 铜价查询/更新（兼容旧调用）
- `GET/PUT /api/settings` — 系统设置

### 独立认证接口
- `POST /api/ai/chat` — AI 对话 (SSE)
- `POST /api/siri/chat` — Siri 快捷指令统一入口（Token 认证，只传自然语言）
- `POST /api/siri/confirm` — Siri 写操作二次确认入口
- `POST /api/voice/asr` — 语音识别
- `GET/POST /api/wecom/webhook` — 企微消息
