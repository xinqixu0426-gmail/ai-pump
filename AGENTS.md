# AI 开发规约 (Agent Directives)

本项目为「水泵工厂管理系统」。以下为开发铁律。

## 0. ADF 协作边界

- 项目代码、SQLite schema、API 契约、测试和 `docs/` 权威文档保存业务事实。
- 非简单任务统一使用仓库内 `.agents/skills/adf-workflow/`；L2/L3 在实现前形成被 Git ignore 的 Task Contract。
- 纯回答、只读审计、解释、诊断和状态查询不进入 delivery workflow：不创建
  Task Contract 或 Guardian session，不运行独立交付 review 或 gate；只在状态相关时
  运行 `doctor` 和最少的只读证据命令。
- Main Codex 默认是唯一业务代码写入者；按风险使用只读 Explorer 和独立 Architecture/Test/Docs Reviewer，整改后重跑受影响 review。
- Subagent 模型按 `.agents/skills/adf-workflow/references/model-routing.md` 分层，Main Codex 对 L3 风险判断和最终交付负责。
- Bugfix 必须追踪完整调用链和同类模式，在最低正确公共层修复，并覆盖缺陷家族、失败路径和边界。
- L2/L3 Bugfix 在 `guardian start` 前先完成只读同类盘点，并在 Task Contract
  记录 `Defect Family` 与 `Systemic Scope Decision`；用户举例不是默认范围边界。
- 文档描述当前事实：更新原权威章节，删除过时说明并合并重复内容；触达 Markdown 不等于完成整理。
- 项目 tests、API 契约、deep API、build、真实 AI 或生产验收按风险提供证据；AI review 不能替代确定性验证。
- 不覆盖用户已有修改，不做无关重构；contract、review、gate 和 lifecycle 未满足前不宣告完成。
- 用户已提供或明确授权的现有凭据可用于当前任务内的可逆登录和验收，不因
  “使用密码”重复询问或自动升级 L3；不得在回复、仓库、文档、合同、Guardian
  evidence 或长期记忆中复述或持久化。凭据创建、修改、轮换、删除、撤销或提权
  仍需风险边界确认，MFA/CAPTCHA/系统安全确认仍由用户完成。

详细分类、Ready、Systemic Diagnosis、review loop 和 delivery SOP 只维护在 `adf-workflow` Skill，不在本文件复制第二套流程。

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

# ADF v0.3 开发工作流

Guardian 只观察、映射和执行确定性验证，不定义水泵业务事实、不调用 AI，也不修改项目。Codex 负责理解、实现、审阅和文档归纳；Stop Hook 只检查 lifecycle 是否完整，不执行开发、commit、push 或部署。

当前继续保持 `policy.reportOnly: true`。failure 必须处理或解释，但在真实任务校准完成前不切换为强制退出码。commit、push、PR、staging 和 production 均为 manual；production、破坏性数据库操作、不可逆数据写入和 secret 变化始终需要当前人工确认。

Guardian Core 只保留在 Framework 仓库。每台机器通过 `AI_DEV_FRAMEWORK_ROOT` 指向已构建的 ADF clone：

```powershell
$guardian = Join-Path $env:AI_DEV_FRAMEWORK_ROOT "scripts\guardian.ps1"
& $guardian --version
& $guardian doctor --root (Get-Location)
```

禁止把 Framework 源码、`guardian/dist`、依赖、绝对机器路径或运行报告复制进本项目。

## 生命周期

- 恢复任务先只读运行 `doctor`；active session 不得静默 replace。
- 新任务在 Ready 后由 `adf-workflow` 用显式 `task-type`、`risk`、`required-gate` 和适用 Task Contract 运行 `start`。
- 重要变化后运行 focused；完成前运行 commit；当前任务要求 push、PR 或 staging 时再运行 push。focused 不代表可提交，commit 不代表可 push。
- L2/L3 的 commit/push 记录独立 architecture 和 tests review；项目事实或权威文档受影响时再记录 docs review，否则提供明确的 `no-doc-impact`。API 变化提供分类归纳后的 `api-review`，bugfix 提供系统性 `root-cause-review`。
- 交付完成且当前报告仍有效后运行 `guardian complete`。它验证 effective gate；gate 至少为 commit 时再验证完整 commit，gate 为 push 时还验证本地 push tracking evidence，然后归档并清除 active lifecycle。
- 项目级 `.codex/hooks.json` 只有在 Codex 中 review/trust 后才生效；首次设置用户级 `AI_DEV_FRAMEWORK_ROOT` 后需要重启 Codex，让 Hook 子进程继承环境变量。Hook 文件存在不等于已经启用。

`.guardian/config.yaml` 中的验证按阶段和任务模块共同选择：治理/文档使用轻量静态契约，API 任务运行 API 契约，业务 commit 保留 lint 与完整测试；API、`shared/**` 及根工具链 push 同时运行 deep API 与 Web build，Web-only push 运行 Web build。纯仓库契约使用 repository evidence；lint 和隔离测试绑定仓库、Node 运行时、依赖指纹与 30 分钟 TTL；deep API 和 build 保持 live、每次执行。仅无共享写状态的相邻命令成对并发，结果仍按配置顺序记录。涉及 AI tool、executor、知识检索或 AI 发布门禁时，仍按 `docs/ai-learning-release-gate-guide.md` 单独运行 `npm run verify:ai-release`，不得用普通 push gate 冒充真实 AI 验收。

Guardian session、历史报告和 Task Contract 属于本地执行证据并由 ignore 规则保护。最终报告必须分别说明 implemented、tested、built、documented、committed、pushed、deployed、verified；未运行不能描述为通过，push 不能描述为部署。
