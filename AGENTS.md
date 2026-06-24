# AI 开发规约 (Agent Directives)

本项目为「水泵 BOM 管理与出图系统」。以下为开发铁律。

## 1. 架构红线

### 数据库写操作
- **所有动态 UPDATE 必须使用 `safeUpdate(table, id, updates)`**，禁止任何形式的 SQL 模板拼接
- `safeUpdate` 位于 `api/db.cjs`，内置表名白名单（`SAFE_TABLES`）和列名正则校验（`SAFE_COL_RE`）
- 写操作自动写入 `audit_log` 表，无需手动调用

### 前端请求
- **所有 API 请求必须走 `proxyRequest()`**（`src/utils/api.ts`），禁止裸 `fetch()`
- `proxyRequest` 自动处理 Cookie 携带、401 跳转登录、错误信息透传
- Zustand Store 执行增删改后必须调 `fetchXxx(true)` 硬刷新

### 数据适配
- 后端 Row Adapter（`partRow` / `recipeRow` / `orderRow` 等）统一输出 **camelCase**
- 前后端交互强制 camelCase，不允许中文字段名或 snake_case 出现在前端类型定义中
- 数据库列名保持 snake_case

### 成本架构
- 成本公式：`配件 + 线圈 + 动态配置 + 人工工资 + 包装材料 + 管理费`
- 人工工资（安装/打包/喷漆）绑定 `pump_shell_templates` 表，选模板自动带入，配方可覆盖
- 包装材料支持 standalone 和 grouped 两种模式，配方级配置
- 管理费全局默认值存于 `system_settings` 表
- 前端 `costCalculator.ts` 与后端 `db.cjs:calculateRecipeCost` 逻辑必须同步
- 单次成本计算优先调后端 API `POST /api/cost/calculate`；批量场景可用前端版本

## 2. 安全约束

- CORS：开发环境放行全部 origin，生产环境读 `CORS_ORIGIN` 环境变量
- 登录限流：5 次/分钟 per IP
- JWT Cookie：生产环境 `secure: true` + `sameSite: strict`
- AI 工具调用：`tools.cjs` 中的 `WRITE_TOOLS` 白名单控制写操作权限
- 微信小程序鉴权：通过 `INTERNAL_SECRET` header 认证（后续迁移至 OpenID）

## 3. 定时任务

- 铜价更新：每天 15:00 BJT，setTimeout 链式调度，启动时立即执行一次
- 数据库备份：每天 03:00 BJT，`VACUUM INTO` 到 `backups/`，保留最近 7 份
- WAL Checkpoint：启动时执行 `PRAGMA wal_checkpoint(TRUNCATE)`

## 4. 组件规范

- 全局样式在 `src/utils/theme.ts` 中固化为 Token，`main.tsx` 只引用 `muiTheme`
- MUI 中不要将 `<Chip>` / `<div>` 等块级元素嵌套在 `<Typography>` 内
- 如需搭配块级元素，指定 `component="div"`
- 微信小程序组件放在 `wechat-miniprogram/components/` 下，使用组件化开发

## 5. 服务端口

- 前端 Vite Dev：`:3000`（HMR over WSS）
- 后端 Express：`:3002`
- Vite Proxy：`/api/*` → `http://localhost:3002`

## 6. 部署

- 生产服务器：Mac Mini (192.168.31.216)
- 路径：`~/Documents/pump-cost-accounting-system`
- 进程管理：裸 node 进程（`nohup node api.cjs &`）
- SSH 需要手动 export PATH 才能用 npm：`export PATH=/opt/homebrew/bin:$PATH`

## 7. 代码风格

- 最小改动原则，不重构无关代码
- 不解释基础框架知识，直接给代码
- 后端路由：同步操作（better-sqlite3）不加 `async`，仅外部 API 调用保留 `async`
# API SOP

- API 新增和修改必须遵守 `docs/api-sop.md`。
- API 新增、修改、废弃或兼容层调整后，必须同步更新 `docs/api-reference.md`；涉及业务/API 概览时同时更新 `docs/README.md`。
- 未更新 docs 的 API 变更不视为完成。
