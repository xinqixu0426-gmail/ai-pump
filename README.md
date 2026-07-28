# 水泵 BOM 订单及生产管理系统

面向水泵工厂的单机部署管理系统，统一管理零件、线圈、泵壳模板、配方、客户、报价、订单、采购、质量检查、转子出图和 AI 工作台。

当前 Web 前端只使用 `apps/web-next`。每家工厂独立部署一套服务和 SQLite 数据库，不是多租户 SaaS。

## 技术栈

| 层 | 技术 |
|---|---|
| Web | Next.js 15、React 18、Tailwind CSS |
| API | Node.js、Express 5 |
| 数据 | SQLite、better-sqlite3、可选 FTS5 |
| AI | DeepSeek Chat API、SSE、Function Calling |
| 出图 | FreeCAD Python Worker、PDF |
| 移动入口 | `/ai` PWA、微信小程序、Siri 快捷指令 |

## 目录

```text
api.cjs                         Express 入口、鉴权和路由挂载
api/db.cjs                      SQLite 建表、迁移、Row Adapter 和安全写入
api/routes/                     业务 API
api/routes/ai/                  AI 对话、工具、会话、Siri 和 ASR
api/services/knowledge.cjs      工厂知识条目构建、同步和搜索
api/services/aiConversations.cjs AI 会话持久化
apps/web-next/                  唯一 Web 前端
freecad/                        转子模板和出图 Worker
wechat-miniprogram/             微信小程序
scripts/                        本地重启、生产校验和 LaunchDaemon 安装
tests/                          Node 测试与架构契约
docs/                           业务、API、前端和部署文档
```

## 本地启动

```powershell
npm install
npm --prefix apps/web-next install
npm start
```

服务端口：

- Next 主前端：`http://localhost:3000`
- Next 并行预览：`http://localhost:3001`
- Express API：`http://localhost:3002`

常用命令：

```powershell
npm run restart:local       # 重启 :3000 和 :3002，日志写入 logs/
npm run api                 # 仅启动 API
npm run web-next:full       # API + :3001 并行预览
npm test                    # 运行全部测试
npm run build               # 构建 Next
npm run verify:release      # 发布前完整校验
```

## 环境变量

复制 `.env.example` 并填写真实值。`.env` 已忽略，禁止提交密钥。

```env
ACCESS_PASSWORD=change-me
JWT_SECRET=replace-with-random-hex
INTERNAL_SECRET=replace-with-random-hex
CORS_ORIGIN=https://your.domain

NODE_ENV=development
PORT=3002
NEXT_ORIGIN=

DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_MODEL=deepseek-v4-flash

ALI_ACCESS_KEY_ID=xxx
ALI_ACCESS_KEY_SECRET=xxx
ALI_ASR_APPKEY=xxx
SIRI_API_TOKEN=xxx
FREECAD_BIN=
PYTHONPATH=
```

生产环境必须配置 `ACCESS_PASSWORD`、`JWT_SECRET`、`INTERNAL_SECRET`、`CORS_ORIGIN` 和 `SIRI_API_TOKEN`。

## AI 工作台

桌面端和移动端统一使用 `/ai`：

- 上下文最多发送最近 10 条用户/助手消息。
- 完整会话保存在 SQLite，可查看、继续和删除历史记录。
- 系统提示词可以在工作台内读取和编辑。
- 查询工具可以直接执行；业务写工具必须显示确认卡片后才能执行。
- 询问订单能否生产或是否齐料时，AI 会只读串联订单状态、BOM、零件库存、线圈库存、采购进度和成本价格，区分可生产、待补料、待复核与数据阻塞。
- 询问“哪些订单不能生产”或“全部订单准备情况”时，AI 会实时汇总全部活动订单；管理看板的“订单准备”页签提供相同口径的分类、主要问题和下一步。
- 从订单准备总览可直接打开指定订单的“生产准备”详情，查看完整六步依据、实时缺料和依赖处理方案；确认、采购和入库仍使用订单详情原有明确动作。
- 打开订单详情后，右侧 AI 会显示当前订单和页签，可直接问“这个订单为什么不能生产”或“下一步怎么处理”；它只用页面上下文解析指代，状态、库存和方案仍实时查询。
- 继续询问“怎么处理”或“下一步做什么”时，AI 会生成按依赖排序的处理方案，标明 AI 可发起确认、人工处理、需要业务决定和等待跟进；方案本身不执行写操作。
- 对方案中当前可执行的 AI 步骤，可以继续要求执行并在确认卡片中批准。服务端会重新生成实时方案，只执行仍为 `confirmable + available` 的步骤，完成后返回新的检查结果；不会自动执行生产或扣减库存。
- 手机端使用全屏会话、历史抽屉和安全区输入框。

旧 `/voice` 页面只保留跳转到 `/ai`。旧 Web 语音组件已经删除；`POST /api/voice/asr` 仍供微信小程序兼容使用。

PWA Manifest 位于 `apps/web-next/public/manifest.json`，主屏幕入口为 `/ai`。

## 工厂知识库

知识库使用 SQLite `knowledge_entries` 保存派生知识条目，并在当前 SQLite 支持 FTS5 时使用全文索引。当前不依赖外部向量库；V5 支持把独立技术说明、文本、Excel、性能测试报告和 PDF 图纸原件保存为工厂资料。

同步来源：

- 零件、泵壳模板、配方和线圈
- 客户、报价和订单
- 数据质量问题
- 当前系统业务规则
- 独立工厂资料

同步采用按 `sourceTable + sourceId` 的增量更新，保留既有知识条目 ID，并删除已经失效的来源；业务条目和 FTS 在同一事务中更新。

首次部署后，在 AI 工作台输入“同步工厂知识库”，核对确认卡片后执行。以后在基础业务数据有较大变化、需要重新测试 AI 检索时再同步。

可以通过 AI 使用：

- “在知识库里查一下 V750。”
- “查某个客户最近的报价和订单。”
- “读取刚才第 1 条知识的详细内容。”
- “查一下工厂资料里的 V750 泵壳图纸。”
- “知识库现在正常吗？”
- “同步工厂知识库。”

对应工具：`search_factory_knowledge`、`get_factory_knowledge_detail`、`get_factory_knowledge_health`、`sync_factory_knowledge`。

独立资料从管理看板“知识库”视图导入。`.txt/.md/.csv/.xls/.xlsx` 会提取可检索文本；PDF 在 V5.1 仅检索标题、说明、标签和文件信息，AI 不得声称已经读取图纸正文。

## 核心规则

### 数据与 API

- 前端 API 请求统一走 `apps/web-next/lib/api.ts` 的 `proxyRequest()` 或封装函数。
- 前后端业务字段使用 camelCase，数据库字段使用 snake_case。
- 动态更新统一使用 `safeUpdate()`；正式资源新增使用 `safeInsert()`。
- 前端写操作完成后重新拉取对应资源。

### 成本

```text
总成本 = 配件 + 线圈 + 动态配置 + 人工工资 + 包装材料 + 管理费
```

权威成本入口：

- 配件数组：`POST /api/cost/parts`
- 配方保存快照：`POST /api/recipes/cost-draft`
- 报价/订单覆盖试算：`POST /api/recipes/:id/cost-preview`
- AI/N8N 组合估算：`POST /api/cost/full-estimate`

### 自动任务

- 启动时执行 WAL checkpoint 和数据库备份。
- 每天 03:00 BJT 备份数据库，保留最近 7 份。
- 启动时更新铜价，此后每天 15:00 BJT 更新。

## 生产发布

生产环境为 Mac Mini：

```bash
ssh dan@192.168.31.216
cd ~/Documents/pump-cost-accounting-system
export PATH=/opt/homebrew/bin:$PATH

git pull origin master
npm install
npm --prefix apps/web-next install
npm run verify:release
sudo ./scripts/install-macmini-launchdaemons.sh
```

发布后检查：

```bash
curl http://127.0.0.1:3002/api/health
tail -n 80 logs/api-launchd.error.log
tail -n 80 logs/web-launchd.error.log
```

完整清单见 [docs/deployment-checklist.md](docs/deployment-checklist.md)。

## 文档入口

- [当前功能与架构](docs/README.md)
- [业务流程](docs/business-flow.md)
- [API 接口总表](docs/api-reference.md)
- [API 开发 SOP](docs/api-sop.md)
- [生产发布清单](docs/deployment-checklist.md)
- [前端状态边界](docs/frontend-state-boundary.md)
- [UI/交互约束](docs/ui-refactor-guidelines.md)
- [FreeCAD 尺寸映射](freecad/DIM_MAPPING.md)

API 新增、修改或废弃后，必须同步更新 `docs/api-reference.md`；涉及业务概览时同时更新 `docs/README.md`。
