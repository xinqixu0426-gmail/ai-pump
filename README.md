# 水泵ai管理系统V1

面向水泵工厂的单机部署管理系统，统一管理零件、线圈、泵壳模板、配方、客户、报价、订单、采购、质量检查、转子出图和 AI 工作台。

当前 Web 前端只使用 `apps/web-next`。每家工厂独立部署一套服务和 SQLite 数据库，不是多租户 SaaS。

当前修复发布版本：**水泵ai管理系统 V1.0.2**，标签 `pump-ai-v1.0.2`（2026-09-07）。Mac Mini 自动验收通过，配置成本以在售配方为完整基准，仅覆盖明确变更项并按当前价格重算；支持跨业务只读查询和明确自然语言长期记忆，业务写入未启用。原用户确认的 V1.0.1 冻结标签及 V1.0.0 均保留。验收证据与登录兼容服务自启动限制见 [发布检查清单](docs/deployment-checklist.md)。

## 技术栈

| 层 | 技术 |
|---|---|
| Web | Next.js 15、React 18、Tailwind CSS |
| API | Node.js、Express 5 |
| 数据 | SQLite、better-sqlite3、可选 FTS5、sqlite-vec |
| AI | DeepSeek/Kimi Chat API、SSE、Function Calling、多模态附件 |
| 出图 | FreeCAD Python Worker、PDF |
| 移动入口 | `/ai` PWA |

## 目录

```text
api.cjs                         Express 入口、鉴权和路由挂载
api/db.cjs                      SQLite 建表、迁移、Row Adapter 和安全写入
api/routes/                     业务 API
api/routes/ai/                  AI 对话、工具、会话和评测
api/services/knowledge.cjs      工厂知识条目构建、同步和搜索
api/services/aiConversations.cjs AI 会话持久化
apps/web-next/                  唯一 Web 前端
freecad/                        转子模板和出图 Worker
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
npm run knowledge:vector-check # 检查本机向量扩展与模型运行时，不下载模型
npm run knowledge:model-prepare # 首次下载模型并执行一条真实 embedding
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

AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_MODEL=deepseek-v4-flash

# 可选：切换为支持图片输入的 Kimi 开放平台
# AI_PROVIDER=kimi
# KIMI_API_KEY=sk-xxx
# KIMI_MODEL=kimi-k2.7-code

KNOWLEDGE_VECTOR_ENABLED=true
KNOWLEDGE_VECTOR_AUTO_SYNC_ENABLED=true
KNOWLEDGE_HYBRID_SEARCH_ENABLED=true
KNOWLEDGE_VECTOR_BATCH_SIZE=16
KNOWLEDGE_EMBEDDING_MODEL=Xenova/multilingual-e5-small
KNOWLEDGE_EMBEDDING_DIMENSIONS=384
KNOWLEDGE_EMBEDDING_DTYPE=q8
KNOWLEDGE_MODEL_CACHE_DIR=
KNOWLEDGE_MODEL_OFFLINE=false

FREECAD_BIN=
PYTHONPATH=
```

生产环境必须配置 `ACCESS_PASSWORD`、`JWT_SECRET`、`INTERNAL_SECRET` 和 `CORS_ORIGIN`。

登录后可从顶部导航进入 `/setup` 系统初始化页，维护 AI 提供商、模型、API Key 和知识检索运行参数。网页保存的 API Key 使用 `JWT_SECRET` 派生密钥加密，接口只返回“已配置”状态。管理密码、JWT、CORS、端口等部署安全项保持只读，仍由 `.env` 或进程环境提供。Kimi Coding 会员订阅凭证不能替代 Kimi 开放平台 API Key。

## AI 工作台

桌面端和移动端统一使用 `/ai`：

- 上下文最多发送最近 10 条用户/助手消息。
- 完整会话保存在 SQLite，可查看、继续和删除历史记录。
- 系统提示词可以在工作台内读取和编辑。
- 查询工具可以直接执行；业务写工具必须显示确认卡片后才能执行。
- 询问订单能否生产或是否齐料时，AI 会只读串联订单状态、BOM、零件库存、线圈库存、采购进度和成本价格，区分可生产、待补料、待复核与数据阻塞。
- 询问“哪些订单不能生产”或“全部订单准备情况”时，AI 会实时汇总全部活动订单；管理看板的“订单准备”页签提供相同口径的分类、主要问题和下一步。
- 从订单准备总览可直接打开指定订单的“生产准备”详情，查看完整六步依据、实时缺料和依赖处理方案；确认、采购和入库仍使用订单详情原有明确动作。
- 管理看板“今日待办”统一汇总订单准备、经营风险、数据质量、规则学习和知识库健康；AI 可直接询问“今天最先需要处理什么”，回答与看板使用同一实时只读结果。
- 打开订单详情后，右侧 AI 会显示当前订单和页签，可直接问“这个订单为什么不能生产”或“下一步怎么处理”；它只用页面上下文解析指代，状态、库存和方案仍实时查询。
- 继续询问“怎么处理”或“下一步做什么”时，AI 会生成按依赖排序的处理方案，标明 AI 可发起确认、人工处理、需要业务决定和等待跟进；方案本身不执行写操作。
- 对方案中当前可执行的 AI 步骤，可以继续要求执行并在确认卡片中批准。服务端会重新生成实时方案，只执行仍为 `confirmable + available` 的步骤，完成后返回新的检查结果；不会自动执行生产或扣减库存。
- 手机端使用全屏会话、历史抽屉和安全区输入框。
- 输入框可附加 PDF、Excel、CSV、文本和图片；文件分析、业务附件关联与知识入库是三个不同动作，具体见 [业务流程：统一文件与知识边界](./docs/business-flow.md#81-统一文件与知识边界)。

PWA Manifest 位于 `apps/web-next/public/manifest.json`，主屏幕入口为 `/ai`。

## 工厂知识库

知识库使用 SQLite `knowledge_entries` 保存派生知识条目，并在当前 SQLite 支持 FTS5 时使用全文索引。V6 使用本地 `sqlite-vec`、`knowledge_embeddings` 和 `multilingual-e5-small` 在文字知识提交后自动增量生成向量，并默认启用 FTS/BM25 + 向量混合检索，仍不依赖外部向量服务；扩展或模型异常时自动回退 FTS/LIKE。V5 支持把独立技术说明、文本、Excel、性能测试报告和 PDF 图纸原件保存为工厂资料。

同步来源：

- 零件、泵壳模板、配方和线圈
- 客户、报价和订单
- 数据质量问题
- 当前系统业务规则
- 独立工厂资料

文字知识同步采用按 `sourceTable + sourceId` 的增量更新，保留既有知识条目 ID，并删除已经失效的来源；业务条目和 FTS 在同一事务中更新。提交成功后，后台向量队列按 `contentHash` 只生成新增或变化条目，失败不会回滚文字知识或业务数据，并会自动重试。

核心业务变化和服务启动都会自动核对文字知识及向量。AI 的“同步工厂知识库”保留为故障恢复和人工全量核对入口，不需要日常执行。

可以通过 AI 使用：

- “在知识库里查一下 V750。”
- “查某个客户最近的报价和订单。”
- “读取刚才第 1 条知识的详细内容。”
- “查一下工厂资料里的 V750 泵壳图纸。”
- “知识库现在正常吗？”
- “同步工厂知识库。”

对应工具：`search_factory_knowledge`、`get_factory_knowledge_detail`、`get_factory_knowledge_health`、`sync_factory_knowledge`。

独立资料从管理看板“知识库”视图导入。`.txt/.md/.csv/.xls/.xlsx` 会提取可检索文本；该知识资料入口的 PDF 仍只检索标题、说明、标签和文件信息，AI 不得声称已经读取图纸正文。AI 聊天直接上传的文字型 PDF 按页解析，图片和扫描 PDF 使用随项目安装的中英文离线 OCR；OCR 参数只作为带来源位置和置信度的候选，聊天附件不会自动成为知识条目。

AI 聊天直接上传的 Excel/CSV 由 V9.3 保存工作表、行列和单元格定位。询问“分析这份报价”时，AI 使用 `inspect_quotation_file` 对照当前客户和配方生成只读映射草稿；只有全部精确匹配时才可继续生成标准报价草稿，任何文件解析步骤都不会自动创建客户、配方或正式报价。

V9.4 为 AI 聊天附件增加本地图片 OCR 和扫描 PDF OCR。DeepSeek 可读取 OCR 文字但不直接接收图片二进制；配置支持视觉输入的 Kimi 开放平台模型时，会同时传入原图。图纸中的直径、尺寸、螺纹、轴承、电压、频率、功率、电流和转速仅生成候选值，低置信度必须复核，系统不会自动写入配方或技术档案。

V9 已完成业务入口收口：客户详情、报价详情和数据质量页可直接维护对应附件，知识管理页的 AI 回答反馈可保存问题证据。业务附件不会自动进入长期知识检索；需要以后由 AI 查到的文件，必须明确归档到知识库。

`GET /api/knowledge/vector-health` 可检查向量扩展、模型、后台队列、覆盖率和最近记录，`GET /api/knowledge/vector-sync-runs` 读取持久化运行历史。V6.3 默认将 FTS/BM25 与向量结果做稳定融合，型号、规格、客户名和合同号等精确命中优先；模型或扩展异常时自动回退 FTS/LIKE。模型默认按需下载到用户目录下的 `.cache/pump-knowledge-models`；生产机联网时先运行 `npm run knowledge:model-prepare` 完成缓存和真实 embedding 检查，再设置 `KNOWLEDGE_MODEL_OFFLINE=true` 并重启服务。`KNOWLEDGE_VECTOR_AUTO_SYNC_ENABLED=false` 可只关闭后台生成，`KNOWLEDGE_HYBRID_SEARCH_ENABLED=false` 可临时关闭混合检索。

V6.4 提供不依赖外部 AI 的固定检索验收：服务运行时执行 `npm run test:knowledge-retrieval`，自动对比 FTS、纯向量和混合检索 Top 1/Top 3；执行 `npm run knowledge:backup-check` 可验证 SQLite 在线备份恢复后的知识向量和检索能力。知识库看板直接展示当前向量覆盖率、混合/回退模式、待生成数量及模型异常。

AI 回答中明确报告错误并保存正确做法后，系统会同步生成唯一的纠错回归候选。所有候选无论置信度高低都先以待审核、停用状态进入知识管理页；只有人工批准且关联纠正规则仍有效时才会启用。`npm run test:knowledge-live` 会把这些已批准案例与内置案例一起通过真实 AI 对话流无人值守复测。Mac Mini 重启验收会运行 `npm run verify:ai-release`，失败结果进入管理待办并写入机器报告。完整说明见 [AI 纠错学习与发布回归使用报告](./docs/ai-learning-release-gate-guide.md)。

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

- 启动时执行 WAL checkpoint，并生成独立 `startup` 备份（保留 5 份）。
- 每天 03:00 BJT 生成 `daily` 备份（保留 30 份）。
- 发布前使用 `npm run db:backup:release` 生成与 Git commit、Schema 版本绑定的可验证快照；可通过 `DB_BACKUP_MIRROR_DIR` 同步已完成备份到异机目录。
- 启动时更新铜价，此后每天 15:00 BJT 更新。

## 生产发布

生产环境为 Mac Mini：

日常发布在 Windows 项目根目录执行：

```powershell
npm run deploy:macmini
```

该入口只部署已 push 的 `origin/master`，自动完成 commit 绑定备份、远端门禁、
LaunchDaemon 重启、真实 AI 回归和公网验收。测试使用隔离临时数据库，不会迁移
或写入生产 `pump.db`。

首次安装系统级 LaunchDaemon 或服务定义发生变化时，才登录 Mac Mini 执行：

```bash
ssh dan@192.168.31.216
cd ~/pump-cost-accounting-system
export PATH=/opt/homebrew/bin:$PATH

PREVIOUS_COMMIT=$(git rev-parse HEAD)
npm run db:backup:release -- --git-commit "$PREVIOUS_COMMIT"
npm run db:backup:verify -- --latest --type release --expect-commit "$PREVIOUS_COMMIT"
git pull --ff-only origin master
npm ci
npm --prefix apps/web-next ci
npm run knowledge:model-prepare
npm run verify:release
sudo ./scripts/install-macmini-launchdaemons.sh
npm run knowledge:backup-check
npm run test:knowledge-retrieval
```

拉取新版本前先生成发布快照；数据库恢复和联合回滚必须按
[数据库备份与恢复](docs/database-backup-recovery.md) 执行，禁止只回滚 Git。

发布后检查：

```bash
curl http://127.0.0.1:3002/api/health
curl http://127.0.0.1:3002/api/health/ready
tail -n 80 logs/api-launchd.error.log
tail -n 80 logs/web-launchd.error.log
```

安装脚本会自动完成 LaunchDaemon 状态、API 就绪和 Web 登录页检查；只有脚本
以 0 退出才表示本机服务启动验收通过。

完整清单见 [docs/deployment-checklist.md](docs/deployment-checklist.md)。

## 文档入口

- [当前功能与架构](docs/README.md)
- [业务流程](docs/business-flow.md)
- [API 接口总表](docs/api-reference.md)
- [API 统一契约](docs/api-contract.md)
- [API 变更 SOP](docs/api-sop.md)
- [当前技术债与优化清单](docs/technical-debt.md)
- [生产运行与故障排查](docs/operations-runbook.md)
- [生产发布清单](docs/deployment-checklist.md)
- [前端状态边界](docs/frontend-state-boundary.md)
- [UI/交互约束](docs/ui-refactor-guidelines.md)
- [FreeCAD 尺寸映射](freecad/DIM_MAPPING.md)

所有 API 必须遵守 `docs/api-contract.md`；新增、修改或废弃按 `docs/api-sop.md` 执行并同步更新 `docs/api-reference.md`，涉及业务概览时同时更新 `docs/README.md`。
