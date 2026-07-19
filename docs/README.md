# 水泵 BOM 订单及生产管理系统

> 当前版本说明，更新于 2026-07-12。本文只描述现行功能与规则；安装、启动和部署命令见项目根目录 [README.md](../README.md)，完整 API 总表见 [api-reference.md](./api-reference.md)，API 开发约束见 [api-sop.md](./api-sop.md)，业务流程基准见 [business-flow.md](./business-flow.md)，前端状态边界见 [frontend-state-boundary.md](./frontend-state-boundary.md)，UI/交互约束见 [ui-refactor-guidelines.md](./ui-refactor-guidelines.md)，历史兼容收口见 [legacy-compatibility-retirement.md](./legacy-compatibility-retirement.md)。

## 1. 系统用途

系统以水泵 BOM 为核心，统一管理：

- 零件、供应商、库存和实时价格；
- 线圈规格、材质、片数和铜价成本；
- 泵壳模板、产品配方和历史常用配置预设；
- 客户、报价、订单、采购清单和生产待办；
- 转子参数、自动出图、历史归档和打印；
- AI、语音和 Siri 查询及受控写操作。

核心目标是让配方成本、报价、订单和采购都引用同一套基础数据，减少重复录入和口径差异。

## 2. 业务流程

新增业务、拆页面或调整状态管理前，必须先对照 [业务流程说明](./business-flow.md)、[前端状态边界](./frontend-state-boundary.md) 和 [UI/交互约束](./ui-refactor-guidelines.md)。本节只保留业务主线概览。

```text
维护零件与线圈
  -> 建立泵壳模板
  -> 创建产品配方并保存成本快照
  -> 复制相近配方快速生成同泵壳的其他功率型号
  -> 客户报价
  -> 报价转订单 / 直接创建订单
  -> 展开 BOM 生成采购清单和生产待办
  -> 采购入库、生产领料、订单状态流转
  -> 按模板或订单型号生成转子图纸
```

### 基础数据

- **零件**：按型号、分类、供应商记录价格和库存。同型号可以有多个供应商。
- **线圈**：按规格、材质、片数记录铁芯单价、铜重、加工费和默认线径/电容。
- **系统设置**：白名单配置包括管理费、线圈材质单价、电缆铜套、浮球新界式差价、铝线价格基数和美元兑人民币汇率。

### 泵壳模板与历史常用配置

泵壳模板定义一套壳体的固定结构，包括：

- 固定配件或壳体组件；
- `components` 分项计价或 `bundle` 整套计价；
- 安装工资、打包工资和默认表面处理工艺；
- 转子出图默认参数。

新建模板时必须先从零件库“泵壳”分类选择型号，不能在模板中另造一个脱离零件库的型号。计价方式通过“泵壳套件 / 自由搭配”切换：泵壳套件默认带入该型号在零件库中的最低有效参考价并允许模板覆盖，同时可填写套件计价备注；自由搭配只展示组件清单并按计入的组件逐项汇总。两种模式的数据分别保存，不在同一界面混合编辑。模板可预设喷漆、电泳、电泳+喷塑或整体喷塑并录入费用，创建配方时自动带入该表面处理工艺和成本。

常用配置是历史兼容能力，用于保存同一模板下的高频线圈、机筒、长螺丝和叶轮组合；已有数据及 `POST /api/recipes/model-variant-draft` 接口继续保留，但不再作为日常新建配方的必经步骤。新流程直接选择泵壳模板和线圈，再完成浮球、电缆、包装、人工及费用配置；同泵壳的其他功率型号通过复制相近配方后修改线圈生成。长螺丝仍与不锈钢机筒绑定，目标长度 = 机筒长度 + 补偿长度；只有零件库泵壳勾选“不锈钢机筒”后，配方表单才显示并提交这两个参数。

### 产品配方

配方是一台产品的完整 BOM 与成本快照，包含：

- 模板固定配件、额外配件；
- 线圈规格、片数和材质；
- 浮球线径/铜套类型、电缆长度/线径/铜套类型；
- 包装材料；
- 安装、打包、表面处理和管理费；
- 机筒长度、叶轮参数和技术档案。

配方页以“泵壳模板 + 线圈配置 + 客户选配”为唯一可见主流程：泵壳模板提供结构成本包，线圈配置联动电容、电缆/浮球线径和叶轮参考，客户选配再覆盖电缆长度、浮球、包装材料、接轴和表面处理等 OEM 差异。需要复用时直接复制已有配方，不要求用户理解或维护额外的常用配置层级。

BOM 草稿由 `POST /api/recipes/bom-draft` 统一生成。前端展示零件时必须使用草稿中的 `snapshotPrice`、`costSource/source` 和 `formula` 标注成本价与计算来源；不得在页面里另写正式成本公式。客户指定线重使用配方字段 `coilWireWeight` 进入 BOM 草稿，由后端线圈服务重算成本并自动关联电容。叶轮参数只属于技术档案和出图参考，不参与成本计算。

表面处理支持：无、喷漆、电泳、喷塑。旧 `paintingWage` 字段只用于历史数据兼容，新逻辑使用 `surfaceTreatmentMode + surfaceTreatmentCost`。

### 报价、订单与采购

- 客户可设置默认利润率；系统默认报价倍率为 `1.10`。
- 报价可以基于配方临时覆盖线圈、浮球、电缆和包材配置，不修改原配方。
- 报价保存前通过 `POST /api/quotations/save-payload-draft` 统一生成 `itemsJson`、`totalCost` 和 `totalPrice`。
- “报价中”超过一个月的报价在列表读取时自动标记为“已过时”。
- 报价转订单先通过 `POST /api/quotations/:id/order-draft` 生成订单草稿、采购清单和待办，再创建订单并把报价标记为“已转订单”。
- 订单保存前通过 `POST /api/orders/save-payload-draft` 统一生成 `itemsJson`、`purchaseListJson` 和 `todosJson`。
- 订单状态、采购项勾选、待办勾选和“确认采购完成并入库”必须通过订单动作 API 执行；确认入库在后端事务内同时更新库存和订单。
- 采购中心按供应商和型号聚合后，通过 `POST /api/orders/purchase-items/batch` 批量标记未完成订单的采购项；采购中心不入库。
- 订单保存产品、数量、单位成本、售价、采购清单和待办快照。
- 采购清单按 BOM × 数量汇总，再扣除当前库存；入库和生产领料通过批量库存接口更新。
- 生产扣库存必须通过 `POST /api/recipes/:id/produce` 执行，后端会重新预检并在事务内扣减库存。
- 当前订单状态：`待采购`、`采购中`、`已完成`。

## 3. 成本口径

完整成本目标口径：

```text
配件 + 线圈 + 动态配置 + 人工工资 + 包装材料 + 管理费
```

### 配件价格

1. 模板手动价或明确快照价优先；
2. 型号和供应商精确匹配；
3. 没有精确供应商时，回退到同型号最低价；
4. 线圈、电容等非普通零件可使用保存的快照价格；
5. 没有任何匹配时按 0 计入，并返回缺失型号。

### 线圈成本

```text
材质单价 × 片数 + 铜重 × 当前铜价 + 绕线加工费 + 转子加工费
```

- 有精确片数时使用该记录；无精确片数时在相邻记录间插值。
- 规格存在但材质记录不足时，可使用该材质的全局单价推算。
- 线圈页提供实时市场指标、材质默认单价配置、同规格同材质自动带入和规格组批量改单价。
- 铜价每天 15:00 BJT 自动更新，并刷新线圈成本；铝线价格基数和美元汇率可在市场指标中手动同步。

### 电缆与包装

- 浮球铜套类型为 `standard` 或 `xinjie`；新界式成本在基础浮球价上增加全局 `float_accessory_delta`。
- 电缆成本：`线缆单价 × 长度 + 铜套费`。
- 铜套类型为 `standard` 或 `xinjie`，名称和价格统一存于 `system_settings.cable_accessories`。
- 旧零件备注中的铜套 JSON 仅用于历史数据迁移和回退。
- 包装按配方配置，支持 `standalone`（独立包装）和 `grouped`（组合包装）两种业务方式；材料明细存于 `packingPartsJson`，每项包含型号、供应商、数量和包材类型。包材类型可覆盖纸箱、木箱、泡沫、商标、说明书、珍珠棉等。旧 `boxType` 只作为兼容回退。

### 工资与管理费

- 安装、打包、喷漆默认值来自泵壳模板，配方可以覆盖。
- 表面处理成本按配方选择的处理方式计入。
- 管理费优先使用配方值；未设置时回退到全局 `management_fee`。

### 成本接口如何选择

成本展示分三类，不能混用：

- 保存成本快照：配方保存时锁定的成本，用于查看历史配方和订单来源。
- 当前重算参考：按今天的零件、线圈、铜价等基础数据重新估算，用于发现铜价或零件价大幅变化后的复核风险。
- 订单锁定成本：订单创建或确认生产时写入订单明细，后续基础价格变化不应反向改写历史订单。

| 场景 | 接口 | 说明 |
|---|---|---|
| 应用常用配置 | `POST /api/recipes/model-variant-draft` | 根据常用配置和关联泵壳模板生成配方表单草稿；不写库 |
| 新增线圈同规格带入 | `POST /api/coils/spec-draft` | 根据规格和材质生成录入草稿，统一带入同规格的线重、铜价基数、加工费、默认线径和电容；不写库 |
| 前端单次配件计算 | `POST /api/cost/parts` | Web 当前主入口，只计算传入配件 |
| 配方保存成本快照 | `POST /api/recipes/cost-draft` | 新建/编辑配方保存前生成 `savedTotalCost`、`savedCostDetails` 和标准化配件，并应用长螺丝长度和参数化计价规则；不写库 |
| 配方保存 payload | `POST /api/recipes/save-payload-draft` | 保存前统一序列化 JSON、数字、ID、表面处理和技术参数；不写库 |
| 配方当前配件价 | `GET /api/recipes/:id/cost` | 只重算 `partsJson` 的当前配件参考价；不是保存成本，也不保证包含完整人工/管理费 |
| 配方当日完整成本 | `GET /api/recipes/current-costs` | 批量按当前零件价格和当前铜价重算配方 BOM，再叠加人工、表面处理和管理费；用于配方列表展示当日成本及其与保存成本的差额 |
| 报价覆盖试算 | `POST /api/recipes/:id/cost-preview` | 以配方快照为基线，重算被覆盖的动态项 |
| AI/N8N 组合估算 | `POST /api/cost/full-estimate` | 分别叠加配方配件、线圈和动态配置 |

`full-estimate` 的基础配方若已经包含相同线圈或动态项，不应再次传入，否则会重复计价。后端权威成本入口为 `api/services/costEngine.cjs`，前端不再保留独立成本计算口径。

## 4. API 与鉴权

### 请求与响应

- Web 请求统一使用 `apps/web-next/lib/api.ts` 中的 `proxyRequest()`、`proxyFetch()` 或 `proxyFormRequest()`。
- Web 新调用必须使用当前标准 API 入口；历史字段兼容只允许封装在 API client 内，不得继续扩散到页面组件。
- 前后端字段使用 camelCase；数据库列使用 snake_case。
- 标准成功响应：`{ "success": true, "data": {} }`。
- 标准失败响应：`{ "success": false, "error": "错误信息" }`。
- 核心资源标准输出 `id`、`createdAt`、`updatedAt`。
- `Id`、`CreatedAt`、`UpdatedAt` 是现存历史命名，仅作为临时兼容字段保留，新字段不得继续仿照。

### 鉴权边界

- 公开：`POST /api/auth/login`、`GET /api/auth/check`、`GET /api/health`。
- 常规接口：JWT Cookie。
- 内部服务：`x-internal-secret`，服务端必须配置 `INTERNAL_SECRET`。
- AI、System Prompt、语音：JWT Cookie 或内部 Secret。
- Siri：`x-siri-token`；生产环境必须配置 `SIRI_API_TOKEN`。
- 登录限流：每个 IP 每分钟最多 5 次。

### 核心接口

完整方法、入参和返回见 [API 接口总表](./api-reference.md)。

| 模块 | 主要路径 | 说明 |
|---|---|---|
| 零件 | `/api/parts`、`/api/parts/prices`、`/api/parts/batch-stock` | CRUD、批量调价、批量库存变更 |
| 线圈 | `/api/coils`、`/api/coils/calculate` | CRUD、材质配置、成本计算 |
| 市场指标 | `/api/market-indicators` | 查询铜价、铝价、美元汇率或手动同步 |
| 模板 | `/api/templates` | CRUD、应用模板、默认配方、模板成本 |
| 型号变体 | `/api/model-variants` | CRUD；保存时可自动沉淀变体使用到的长螺丝规格到零件库 |
| 配方 | `/api/recipes` | CRUD、BOM 草稿、保存成本快照、成本与覆盖试算 |
| 客户/报价 | `/api/customers`、`/api/quotations` | CRUD |
| 订单 | `/api/orders` | CRUD、历史售价、采购清单生成 |
| 工作台 | `/api/workbench/summary` | 经营、库存和采购汇总 |
| 转子 | `/api/rotor` | 模板草稿、出图、参数暂存、状态、历史、关联、打印 |
| 设置 | `/api/settings/:key` | 白名单设置读取和修改 |
| AI/语音/Siri | `/api/ai`、`/api/voice`、`/api/siri` | 对话、工具调用、ASR |

配方、订单、模板和型号变体的写接口仍接受部分历史 snake_case 入参，但所有 Web 调用必须使用 camelCase。转子历史接口标准输出 camelCase。

## 5. 数据安全与自动任务

- 所有动态 UPDATE 必须走 `safeUpdate()`：表名白名单、列名校验、参数化 SQL、更新时间和审计日志。
- 正式业务资源 INSERT 必须走 `safeInsert()`：表名白名单、列名校验、参数化 SQL和审计日志。
- 订单、配方、零件、客户、报价和型号变体使用软删除。
- 线圈、模板和转子历史没有软删除列，使用 `hardDelete()` 并记录审计。
- 系统初始化、`system_settings` / `config` 的 UPSERT 仍是基础设施边界；新增业务资源表不得绕过 `safeInsert()`。
- 零件索引缓存 10 秒；零件变更后必须主动失效。
- 前端增删改后必须重新拉取对应资源，避免只改本地派生状态。
- SQLite 使用 WAL；启动时执行 `wal_checkpoint(TRUNCATE)`。
- 数据库启动时立即备份，此后每天 03:00 BJT 备份，保留最近 7 份。
- 铜价启动时立即更新，此后每天 15:00 BJT 更新。
- 铝线价格基数和美元汇率可通过市场指标同步接口手动写入系统设置；当前定时任务只自动同步铜价。

## 6. 转子出图

```text
POST /api/rotor/draw 或 /chat
  -> 返回 jobId
  -> GET /api/rotor/status/:jobId 轮询
  -> 成功后下载 fileUrl 或 POST /api/rotor/print/:jobId

POST /api/rotor/save
  -> 保存暂定参数到 rotor_drawings(status=saved)
```

- `/draw` 接收结构化参数，至少提供一项；缺失参数可以由泵壳模板补全。
- `/template-draft` 根据泵壳模板和可选型号变体生成出图表单草稿，不写库；用于统一带入轴承、油封、泵壳 notes 默认参数、不锈钢机筒开档和图纸备注。
- `/save` 接收同一套结构化参数，仅保存到历史，不启动 FreeCAD。
- `/chat` 接收自然语言，可能返回 `need_params` 或安全警告；确认后再出图。
- `/draw`、`/save` 和 `/chat` 可接收 `drawingName` 作为图纸名称，写入 `rotor_drawings.drawing_name`；前端下载 PDF 时用该名称作为文件名。
- `/draw`、`/save` 和 `/chat` 可接收 `drawingText` / `drawing_text` 作为图纸显示文字，生成 PDF 时写入转子图纸底部区域。
- `GET /api/rotor/history` 历史列表标准输出 camelCase 字段，包括 `jobId`、`drawingName`、`fcParamsJson`、`fileUrl`、`linkedPumpModel`、`createdAt`。
- `PATCH /api/rotor/history/:id/name` 用于重命名历史图纸，请求体 `{ "drawingName": "..." }`，成功返回 `{ "success": true, "data": { "drawingName": "..." } }`。
- 出图历史可通过 `GET /api/rotor/link-targets` 选择关联订单型号、型号变体或配方，保存时仍写入 `linked_pump_model` 文本字段。
- FreeCAD 默认最多同时执行 2 个任务。
- 图纸和状态写入 `rotor_drawings`，PDF 位于 `public/drawings/`。
- 删除历史记录时同时删除对应 PDF。
- 常用轴承输入如 `201/6201`、`202/6202`、`203/6203` 会自动标准化。

## 7. AI 与移动端

- AI 只允许执行 `tools.cjs` 中已注册的工具。
- 写操作还必须位于 `WRITE_TOOLS` 白名单，并通过确认流程；查询工具不能借机写库。
- iPhone PWA 入口为 Next 页面 `/voice`，面向主屏幕 standalone 使用；桌面业务入口和 `/ai` 工作台不受影响。
- PWA 当前是基础 AI 助手，支持文字输入和轻量语音输入；语音输入只通过 `apps/web-next/lib/voice.ts` 调用 `/api/voice/asr` 转文字，之后仍使用 `streamAiChat()` 调用 `/api/ai/chat`。
- PWA 不启用语音播报、Voice Orb、音频可视化或复杂语音聊天 UI；语音失败时必须回退到文字输入。
- PWA 状态流使用单一状态枚举：`idle`、`thinking`、`calling`、`answering`、`confirming`、`done`、`error`、`cancelled`，顶部状态和消息状态都由该状态驱动。
- PWA 当前优先接入成熟 AI 工具：经营概况、最近订单、订单详情、配方成本、零件搜索、线圈成本、铜价、配方对比和出图历史；新建订单、修改订单状态、改零件、生成采购清单、配方/零件写操作必须确认后执行。
- PWA 历史记录第一版保存在浏览器 `localStorage`，只用于本机快速回看，不作为审计来源；正式写操作审计仍由后端 `safeInsert` / `safeUpdate` / delete helper 处理。
- 微信小程序代码位于 `wechat-miniprogram/`，当前通过 `INTERNAL_SECRET` 兼容认证；真实密钥不得提交到仓库，小程序生产鉴权应迁移到 OpenID 或服务端会话。
- Siri 使用快捷指令文字输入，不经过 ASR；统一调用 `POST /api/siri/chat`，由 AI tools 决定业务动作，Siri 不直接访问库存、BOM、采购等内部 API。
- Siri 返回 `speech` 供朗读，内容保持简短；结构化结果通过 `resultUrl` 查看，结果临时保存在内存中，5 分钟后失效。
- Siri 写操作返回 `confirmation_required`、`confirmationId` 和确认摘要；用户明确确认后再调用 `POST /api/siri/confirm`，后端仍复用现有写工具确认、标准 API 和审计路径。
- Web/PWA 语音识别使用后端阿里云 ASR；AI 对话使用 DeepSeek SSE。

### PWA 调试与限制

- 本地调试：同时启动 Express `:3002` 和 Next `:3000`，访问 `/voice`。
- iPhone 主屏幕安装需要 Safari 和 HTTPS 生产地址；本地 HTTP 可用于页面调试，但不能完整验证主屏幕体验。
- 当前 PWA 语音输入依赖浏览器 `MediaRecorder` 和后端 `/api/voice/asr`；iPhone 需要授予麦克风权限，识别失败时可继续使用文字输入。
- `/voice` 不新增业务 API，不改变现有权限、确认、审计和成本计算口径。

## 8. 当前已知边界

- `apps/web-next/` 是 Next.js + Tailwind + motion 风格的唯一 Web 前端，默认业务入口跑在 `:3000`，并行预览入口跑在 `:3001`，通过 rewrites 将 `/api/*` 代理到现有 Express `:3002`。Next 前端不接管业务 API。
- AI executor 已通过内部 API client 调用标准 API，不再直接访问数据库 helper；后续新增 AI 自动化能力时，应先确认是否能复用现有标准业务动作 API。
- 业务 API 已统一使用 `{ success, data/error }` 响应格式；健康检查等监控入口可保留非业务格式。
- 核心资源响应中仍可能带有 `Id/CreatedAt/UpdatedAt` 历史兼容字段；Web 调用必须使用标准 camelCase。
- 配方等写接口仍保留少量历史入参兼容，但资源更新和删除已统一为 `/:id` 路径入口。
- 历史兼容字段和旧入参的收口顺序见 [历史兼容收口计划](./legacy-compatibility-retirement.md)；新增功能不得再扩大旧字段使用面。
- 关键写接口的路由 ID、成本基础资料数字字段、模板/变体 JSON 字段，以及订单/报价/配方保存草稿的金额和数量字段已统一走 `api/services/validation.cjs`。
- 审计日志覆盖正式业务资源的 INSERT、动态 UPDATE 和 DELETE；系统初始化与 settings/config UPSERT 仍属于基础设施边界。
- `GET /api/recipes/:id/cost` 不是完整配方总成本接口，报价应使用 `cost-preview`。

这些属于历史兼容边界，不应成为新代码继续扩散兼容写法的理由。
