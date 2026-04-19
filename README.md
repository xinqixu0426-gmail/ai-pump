# 水泵 BOM 管理与出图系统

集成订单/配方/库存/成本核算、DeepSeek AI Agent、企业微信助手和 FreeCAD 参数化出图的水泵生产管理系统。

## 技术栈

| 层     | 技术                                                         |
| ------ | ------------------------------------------------------------ |
| 前端   | React 18 + TypeScript + Vite + MUI 5 + Zustand               |
| 后端   | Node.js Express 5 + better-sqlite3                            |
| AI     | DeepSeek Chat (Function Calling) + 阿里云 ASR 语音识别        |
| 出图   | FreeCAD TechDraw 2D 投影自动化（独立子进程调度）               |
| 部署   | PM2 守护进程 + Cloudflare Tunnel 外网暴露                     |

---

## 项目结构

```
├── api.cjs                 # Express 入口（挂载路由 + 静态托管）
├── api/
│   ├── db.cjs              # SQLite 数据层
│   ├── authMiddleware.cjs  # JWT 认证中间件
│   ├── routes/
│   │   ├── ai.cjs          # AI 路由入口（拆分到 ai/ 子目录）
│   │   ├── ai/             # AI 子模块（chat/prompt/voice/siri/tools/executor）
│   │   ├── auth.cjs        # 登录/登出/状态检查
│   │   ├── parts.cjs       # 零件 CRUD
│   │   ├── recipes.cjs     # 配方 CRUD
│   │   ├── orders.cjs      # 订单 CRUD
│   │   ├── templates.cjs   # 泵壳模板 CRUD
│   │   ├── coils.cjs       # 线圈记录 + 成本计算
│   │   ├── cost.cjs        # 成本精算（含铜价更新）
│   │   ├── rotor.cjs       # 转子出图（NL + 结构化参数）
│   │   ├── settings.cjs    # 系统全局配置
│   │   └── wecom.cjs       # 企业微信 Webhook
│   └── __tests__/          # 后端测试
├── src/                    # React 前端源码
│   ├── pages/              # 页面组件
│   ├── components/         # UI 组件
│   ├── utils/              # API 封装、Store、主题
│   └── types/              # TypeScript 类型定义
├── freecad/                # FreeCAD worker.py 脚本
├── scripts/                # 种子数据 / 数据库备份脚本
├── docs/                   # 补充文档
└── public/                 # 静态资源
```

---

## 开发环境（Windows / Mac）

### 1. 前置条件

- Node.js ≥ 18
- npm

### 2. 环境变量

在项目根目录创建 `.env`（已 gitignore）：

```env
ACCESS_PASSWORD=你的登录密码
JWT_SECRET=随机长字符串

# AI 引擎
DEEPSEEK_API_KEY=sk-...
ALIYUN_APP_KEY=阿里云ASR的AppKey
ALIYUN_AK_ID=阿里云AccessKey
ALIYUN_AK_SECRET=阿里云Secret

# 企业微信（可选）
WECOM_CORP_ID=ww...
WECOM_AGENT_ID=1000xxx
WECOM_SECRET=...
WECOM_TOKEN=...
WECOM_ENCODING_AES_KEY=...

# FreeCAD 路径（可选，仅出图功能需要）
# Windows:
FREECAD_BIN=C:\Program Files\FreeCAD 1.1\bin\freecad.exe
# macOS:
# FREECAD_BIN=/Applications/FreeCAD.app/Contents/MacOS/FreeCAD
```

### 3. 启动

```bash
npm install
npm start          # 同时启动 Vite (https://localhost:3000) + Express API (:3002)
```

前端通过 Vite proxy 将 `/api/*` 转发到 `localhost:3002`，无需额外配置。

---

## 生产环境（Mac Mini + Cloudflare Tunnel）

### 1. 首次部署

```bash
# 安装依赖
npm install

# 构建前端静态文件
npm run build

# 全局安装 PM2
npm install -g pm2

# 启动 API（Express 自动托管 dist/ 静态文件）
pm2 start api.cjs --name pump-api

# 设置开机自启
pm2 startup
pm2 save
```

### 2. .env 补充配置

生产环境 `.env` 中额外添加：

```env
BEHIND_PROXY=true
```

> `BEHIND_PROXY=true` 会让 Cookie 设置为 `secure: true` + `sameSite: none`，
> 确保通过 Cloudflare Tunnel (HTTPS) 访问时认证正常。

### 3. Cloudflare Tunnel 配置

```bash
# Mac Mini 上安装 cloudflared
brew install cloudflare/cloudflare/cloudflared

# 使用 Dashboard 生成的 token 注册为系统服务
sudo cloudflared service install <TOKEN>
```

Dashboard 设置：
- **Public Hostname**: 你的域名
- **Service**: `HTTP` → `localhost:3002`

### 4. 防休眠

Mac Mini 必须关闭自动休眠，否则 tunnel 会断连：

```bash
sudo pmset -a sleep 0 disksleep 0
```

### 5. 日常更新部署

```bash
ssh dan@192.168.31.216
cd ~/Documents/pump-cost-accounting-system
git pull && npm run build && pm2 restart pump-api
```

---

## API 端点一览

所有业务接口（除标注外）均需 JWT 认证（HttpOnly Cookie）。

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 密码登录，设置 Cookie |
| POST | `/api/auth/logout` | 清除 Cookie |
| GET  | `/api/auth/check` | 检查登录状态 |

### 数据 CRUD

| 资源 | GET | POST | PATCH | DELETE |
|------|-----|------|-------|--------|
| `/api/parts[/:id]` | 全部零件 | 新增 | 更新 | 删除 |
| `/api/recipes[/:id]` | 全部配方 | 新增(含快照) | 更新 | 删除 |
| `/api/orders[/:id]` | 全部订单 | 新增 | 更新 | 删除 |
| `/api/templates[/:id]` | 泵壳模板 | 新增 | 更新 | 删除 |
| `/api/coils[/:id]` | 线圈记录 | 新增(自动算) | 更新(自动重算) | 删除 |

### 成本计算

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/cost/calculate` | 按零件数组算成本 |
| GET  | `/api/cost/recipe/:id` | 按配方 ID 查成本 |
| GET  | `/api/cost/recipe/by-name?name=xxx` | 按名称查成本 |
| POST | `/api/cost/dynamic-config` | 动态配置成本(浮球/电缆/包材) |
| POST | `/api/cost/full-calculate` | **一站式 BOM 计算(推荐)** |
| GET  | `/api/copper-price` | 实时铜价 |
| POST | `/api/copper-price/update` | 手动触发铜价更新 |

### AI 智能助手

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/chat` | AI 对话 (SSE 流式) |
| GET/PUT | `/api/ai/system-prompt` | 管理 System Prompt |
| POST | `/api/voice/asr` | 语音识别 (阿里云 ASR) |
| POST | `/api/siri/chat` | Siri 快捷指令对话 (公开) |

### 转子出图

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/rotor/chat` | 自然语言出图 |
| POST | `/api/rotor/draw` | 结构化参数出图 |
| GET  | `/api/rotor/status/:jobId` | 查询出图任务状态 |
| GET  | `/api/rotor/history` | 出图历史记录 |

### 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/health` | 健康检查 (公开) |
| GET/POST | `/api/wecom/webhook` | 企微回调 (公开) |
| GET/PUT | `/api/settings/:key` | 系统全局配置 |

### 成本计算公式

```
总成本 = 配件成本 + 线圈成本 + 动态配置(浮球/电缆/包材) + 人工工资(安装+打包+喷漆) + 管理费
```

---

## 踩坑记录

1. **Express 5 通配符路由** — `'*'` 和 `'{*path}'` 在不同版本 path-to-regexp 下都可能报 `PathError`，SPA fallback 请直接用正则 `/(.*)/`。
2. **Cloudflare Tunnel 502/1033** — 99% 是 Mac Mini 自动休眠断网导致，用 `pmset -a sleep 0` 关闭。
3. **HTTPS 认证失败 (401)** — 当 Express 跑在反向代理后面，Cookie 需要 `secure: true` + `sameSite: 'none'`，通过 `BEHIND_PROXY=true` 环境变量启用，同时 `app.set('trust proxy', 1)` 已内置。
4. **企微 60020/42028 错误** — 需在企微后台绑定可信 IP；`.env` 粘贴 AES Key 时注意清除 Windows 回车符。
5. **前端更新不生效** — `git pull` 后必须 `npm run build` 重新构建前端产物，仅重启后端不够。
