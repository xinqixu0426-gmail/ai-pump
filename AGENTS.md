# AI 开发规约 (Agent Directives)

本项目为「水泵工厂管理系统」。以下为开发铁律。

## 0. 协作边界

- 项目代码、SQLite schema、API 契约、测试和 `docs/` 权威文档保存业务事实。
- Bugfix 必须追踪完整调用链和同类模式，在最低正确公共层修复，并覆盖缺陷家族、失败路径和边界。
- 文档描述当前事实：更新原权威章节，删除过时说明并合并重复内容；触达 Markdown 不等于完成整理。
- 项目 tests、API 契约、deep API、build、真实 AI 或生产验收按风险提供证据。
- 不覆盖用户已有修改，不做无关重构；未完成实现与验证前不宣告完成。
- 用户已提供或明确授权的现有凭据可用于当前任务内的可逆登录和验收，不因
  “使用密码”重复询问或自动升级 L3；不得在回复、仓库、文档、合同、验收证据或
  长期记忆中复述或持久化。凭据创建、修改、轮换、删除、撤销或提权
  仍需风险边界确认，MFA/CAPTCHA/系统安全确认仍由用户完成。

## 1. 架构红线

### 数据库写操作
- **所有动态 UPDATE 必须使用 `safeUpdate(table, id, updates)`**，禁止任何形式的 SQL 模板拼接
- `safeUpdate` 位于 `api/db.cjs`，内置表名白名单（`SAFE_TABLES`）和列名正则校验（`SAFE_COL_RE`）
- 写操作自动写入 `audit_log` 表，无需手动调用

### 前端请求
- **所有 API 请求必须走 `proxyRequest()`**（`apps/web-next/lib/api.ts`），禁止裸 `fetch()`
- `proxyRequest` 自动处理 Cookie 携带、401 跳转登录、错误信息透传
- 前端增删改后必须重新拉取对应资源，避免只改本地派生状态

### 数据适配
- 后端 Row Adapter（`partRow` / `recipeRow` / `orderRow` 等）统一输出 **camelCase**
- 前后端交互强制 camelCase，不允许中文字段名或 snake_case 出现在前端类型定义中
- 数据库列名保持 snake_case

### 成本架构
- 成本公式：`配件 + 线圈 + 动态配置 + 人工工资 + 包装材料 + 管理费`
- 人工工资（安装/打包/喷漆）绑定 `pump_shell_templates` 表，选模板自动带入，配方可覆盖
- 包装材料支持 standalone 和 grouped 两种模式，配方级配置
- 管理费全局默认值存于 `system_settings` 表
- 通用成本规则集中在 `api/services/costEngine.cjs`，`api/db.cjs:calculateRecipeCost` 仅保留兼容导出
- 前端不得新增正式成本计算口径；成本计算必须按场景调用当前标准 API：
  - 配件数组成本：`POST /api/cost/parts`
  - 配方保存成本快照：`POST /api/recipes/cost-draft`
  - 报价/订单覆盖试算：`POST /api/recipes/:id/cost-preview`
  - AI/N8N 组合估算：`POST /api/cost/full-estimate`

## 2. 安全约束

- CORS：开发环境放行全部 origin，生产环境读 `CORS_ORIGIN` 环境变量
- 登录限流：5 次/分钟 per IP
- JWT Cookie：生产环境 `secure: true` + `sameSite: strict`
- AI 工具调用：`tools.cjs` 中的 `WRITE_TOOLS` 白名单控制写操作权限

## 3. 定时任务

- 铜价更新：每天 15:00 BJT，setTimeout 链式调度，启动时立即执行一次
- 数据库备份：每天 03:00 BJT，`VACUUM INTO` 到 `backups/`，保留最近 7 份
- WAL Checkpoint：启动时执行 `PRAGMA wal_checkpoint(TRUNCATE)`

## 4. 组件规范

- Web 前端只使用 `apps/web-next`，当前技术栈为 Next.js + Tailwind CSS + 本地基础组件
- 不得重新引入 MUI / Emotion / 旧 Vite 前端依赖
- 全局样式与设计 Token 以 `apps/web-next/app/globals.css` 和本地 UI 组件为准

## 5. 服务端口

- Next 主前端：`:3000`
- Next 并行预览：`:3001`
- 后端 Express：`:3002`
- Next rewrite：`/api/*` → `http://localhost:3002`

## 6. 部署

- 生产服务器：Mac Mini (192.168.31.216)
- 路径：`~/pump-cost-accounting-system`（不要放在 `Documents`，避免 macOS 后台服务被 TCC 权限拦截）
- 日常发布：Windows 项目根目录运行 `npm run deploy:macmini`，自动完成备份、快进拉取、发布门禁、无 sudo 重启、AI 回归和公网验收
- 进程管理：系统级 LaunchDaemon；仅首次安装或服务定义变化时运行 `sudo ./scripts/install-macmini-launchdaemons.sh`
- SSH 需要手动 export PATH 才能用 npm：`export PATH=/opt/homebrew/bin:$PATH`

## 7. 代码风格

- 最小改动原则，不重构无关代码
- 不解释基础框架知识，直接给代码
- 后端路由：同步操作（better-sqlite3）不加 `async`，仅外部 API 调用保留 `async`

### 编码与中文文件
- 项目包含大量中文业务文案，所有源码、文档和配置文件必须按 UTF-8 读取和写入
- 在 PowerShell 中读取中文文件时，默认使用 UTF-8；若出现乱码、问号、替换字符或疑似“编码噪音”，必须立即停下排查编码设置，不能继续基于乱码内容判断或修改代码
- 禁止把中文乱码视为可忽略的终端噪音；修复编码显示或改用明确 UTF-8 的读取方式后，才能继续开发

# API 契约与 SOP

- 这是项目默认工作流，无须用户在每次需求中重复提醒。任何新增/修改 HTTP 路由、AI tool、内部 maintenance、API client、请求字段、响应字段、兼容层或废弃入口的任务，都必须自动判定为 API 变更。
- 开始 API 变更前必须完整阅读 `docs/api-contract.md` 和 `docs/api-sop.md`，并把“能力登记 → schema/validation → service → route/调用方 → 测试 → 文档”纳入当前实施范围；不能把 API 当作业务功能的附带实现而跳过契约。
- 所有 API 必须遵守 `docs/api-contract.md`；API 新增和修改同时必须执行 `docs/api-sop.md`。
- API 新增、修改、废弃或兼容层调整后，必须同步更新 `docs/api-reference.md`；涉及业务/API 概览时同时更新 `docs/README.md`。
- API 变更至少必须运行 `npm run verify:api-contract` 和 `npm test`；准备 push 时，API、`shared/**` 及根工具链变更同时运行 `npm run test:deep-api` 和 `npm run build`，仅 Web 变更运行 `npm run build`。
- 能力登记、实现、文档和自动化契约测试任一缺失，API 变更不视为完成。
