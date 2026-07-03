# 水泵 BOM 订单及生产管理系统

> 当前版本说明，更新于 2026-06-24。本文只描述现行功能与规则；安装、启动和部署命令见项目根目录 [README.md](../README.md)，完整 API 总表见 [api-reference.md](./api-reference.md)，API 开发约束见 [api-sop.md](./api-sop.md)。

## 1. 系统用途

系统以水泵 BOM 为核心，统一管理：

- 零件、供应商、库存和实时价格；
- 线圈规格、材质、片数和铜价成本；
- 泵壳模板、型号变体和产品配方；
- 客户、报价、订单、采购清单和生产待办；
- 转子参数、自动出图、历史归档和打印；
- AI、语音和 Siri 查询及受控写操作。

核心目标是让配方成本、报价、订单和采购都引用同一套基础数据，减少重复录入和口径差异。

## 2. 业务流程

```text
维护零件与线圈
  -> 建立泵壳模板
  -> 可选：建立型号变体
  -> 创建产品配方并保存成本快照
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

### 泵壳模板与型号变体

泵壳模板定义一套壳体的固定结构，包括：

- 固定配件或壳体组件；
- `components` 分项计价或 `bundle` 整套计价；
- 安装工资、打包工资和默认喷漆工资；
- 转子出图默认参数。

型号变体用于表达同一模板下不同产品型号的差异，包括线圈规格/片数/材质、机筒长度、长螺丝补偿长度和叶轮参数。长螺丝默认按“实际机筒长度 + 25mm”并向上取到 5mm 档；零件库可维护一个参数化基础螺丝，由基准长度单价和每档加价自动算出目标长度单价。创建配方时选择变体会自动带入对应模板和技术参数；配方保存的是快照，后续修改变体不会反向改变历史配方。

### 产品配方

配方是一台产品的完整 BOM 与成本快照，包含：

- 模板固定配件、额外配件；
- 线圈规格、片数和材质；
- 浮球线径/铜套类型、电缆长度/线径/铜套类型；
- 包装材料；
- 安装、打包、表面处理和管理费；
- 机筒长度、叶轮参数和技术档案。

表面处理支持：无、喷漆、电泳、喷塑。旧 `paintingWage` 字段只用于历史数据兼容，新逻辑使用 `surfaceTreatmentMode + surfaceTreatmentCost`。

### 报价、订单与采购

- 客户可设置默认利润率；系统默认报价倍率为 `1.10`。
- 报价可以基于配方临时覆盖线圈、浮球、电缆和包材配置，不修改原配方。
- “报价中”超过一个月的报价在列表读取时自动标记为“已过时”。
- 订单保存产品、数量、单位成本、售价、采购清单和待办快照。
- 采购清单按 BOM × 数量汇总，再扣除当前库存；入库和生产领料通过批量库存接口更新。
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
- 铜价每天 15:00 BJT 自动更新，并刷新线圈成本。

### 电缆与包装

- 浮球铜套类型为 `standard` 或 `xinjie`；新界式成本在基础浮球价上增加全局 `float_accessory_delta`。
- 电缆成本：`线缆单价 × 长度 + 铜套费`。
- 铜套类型为 `standard` 或 `xinjie`，名称和价格统一存于 `system_settings.cable_accessories`。
- 旧零件备注中的铜套 JSON 仅用于历史数据迁移和回退。
- 包装按配方配置，支持 `standalone`（独立包装）和 `grouped`（组合包装）两种业务方式；材料明细存于 `packingPartsJson`，每项包含型号、供应商和数量。旧 `boxType` 只作为兼容回退。

### 工资与管理费

- 安装、打包、喷漆默认值来自泵壳模板，配方可以覆盖。
- 表面处理成本按配方选择的处理方式计入。
- 管理费优先使用配方值；未设置时回退到全局 `management_fee`。

### 成本接口如何选择

| 场景 | 接口 | 说明 |
|---|---|---|
| 前端单次配件计算 | `POST /api/cost/calculate` | 当前 Web 主入口，只计算传入配件 |
| 规范的配件计算入口 | `POST /api/cost/parts` | 与上一接口共用 handler |
| 配方保存成本快照 | `POST /api/recipes/cost-draft` | 新建/编辑配方保存前生成 `savedTotalCost`、`savedCostDetails` 和标准化配件，并应用长螺丝长度和参数化计价规则；不写库 |
| 配方当前配件价 | `GET /api/recipes/:id/cost` | 只重算 `partsJson`，不保证包含独立工资/管理费字段 |
| 报价覆盖试算 | `POST /api/recipes/:id/cost-preview` | 以配方快照为基线，重算被覆盖的动态项 |
| AI/N8N 组合估算 | `POST /api/cost/full-estimate` | 分别叠加配方配件、线圈和动态配置 |

`full-estimate` 的基础配方若已经包含相同线圈或动态项，不应再次传入，否则会重复计价。后端权威成本入口为 `api/services/costEngine.cjs`，前端不再保留独立成本计算口径。

## 4. API 与鉴权

### 请求与响应

- Web 请求统一使用 `src/utils/api.ts` 中的 `proxyRequest()`、`proxyFetch()` 或 `proxyFormRequest()`。
- 前后端字段使用 camelCase；数据库列使用 snake_case。
- 标准成功响应：`{ "success": true, "data": {} }`。
- 标准失败响应：`{ "success": false, "error": "错误信息" }`。
- `Id`、`CreatedAt`、`UpdatedAt` 是现存历史命名，新字段不得继续仿照。

### 鉴权边界

- 公开：`POST /api/auth/login`、`GET /api/auth/check`、`GET /api/health`。
- 常规接口：JWT Cookie。
- 内部服务：`x-internal-secret`，服务端必须配置 `INTERNAL_SECRET`。
- AI、System Prompt、语音：JWT Cookie 或内部 Secret。
- Siri：`x-siri-token`；生产环境必须配置 `SIRI_API_TOKEN`。
- 登录限流：每个 IP 每分钟最多 5 次。

### 核心接口

完整方法、入参、返回和兼容入口见 [API 接口总表](./api-reference.md)。

| 模块 | 主要路径 | 说明 |
|---|---|---|
| 零件 | `/api/parts`、`/api/parts/batch-stock` | CRUD、批量库存变更 |
| 线圈 | `/api/coils`、`/api/coils/calculate` | CRUD、材质配置、成本计算 |
| 市场指标 | `/api/market-indicators` | 查询铜价、铝价、美元汇率或手动同步 |
| 模板 | `/api/templates` | CRUD、应用模板、默认配方、模板成本 |
| 型号变体 | `/api/model-variants` | CRUD |
| 配方 | `/api/recipes` | CRUD、BOM 草稿、保存成本快照、成本与覆盖试算 |
| 客户/报价 | `/api/customers`、`/api/quotations` | CRUD |
| 订单 | `/api/orders` | CRUD、历史售价、采购清单生成 |
| 工作台 | `/api/workbench/summary` | 经营、库存和采购汇总 |
| 转子 | `/api/rotor` | 出图、状态、历史、关联、打印 |
| 设置 | `/api/settings/:key` | 白名单设置读取和修改 |
| AI/语音/Siri | `/api/ai`、`/api/voice`、`/api/siri` | 对话、工具调用、ASR |

### 兼容入口

以下旧入口仍服务于 Web、AI、小程序或外部自动化，确认所有调用方迁移前不能删除：

| 当前入口 | 兼容入口 |
|---|---|
| `/api/cost/parts` | `/api/cost/calculate` |
| `/api/recipes/:id/cost` | `/api/cost/recipe/:id` |
| `/api/recipes/:id/cost-preview` | `/api/cost/dynamic-calculate` |
| `/api/cost/dynamic` | `/api/cost/dynamic-config` |
| `/api/cost/full-estimate` | `/api/cost/full-calculate` |
| `/api/cost/coil` | `/api/coils/calculate` |

配方、订单、模板和型号变体的写接口仍接受部分旧 snake_case 入参，但所有新调用必须使用 camelCase。转子历史接口仍直接返回 snake_case 数据库字段，属于待迁移兼容接口。

## 5. 数据安全与自动任务

- 所有动态 UPDATE 必须走 `safeUpdate()`：表名白名单、列名校验、参数化 SQL、更新时间和审计日志。
- 订单、配方、零件、客户、报价和型号变体使用软删除。
- 线圈、模板和转子历史没有软删除列，使用 `hardDelete()` 并记录审计。
- 固定 SQL INSERT 和 `setSetting()` 当前不自动写审计，这是现有审计覆盖边界。
- 零件索引缓存 10 秒；零件变更后必须主动失效。
- Zustand 增删改后必须执行对应 `fetchXxx(true)` 硬刷新。
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
```

- `/draw` 接收结构化参数，至少提供一项；缺失参数可以由泵壳模板补全。
- `/chat` 接收自然语言，可能返回 `need_params` 或安全警告；确认后再出图。
- `/draw` 和 `/chat` 可接收 `drawingName` 作为图纸名称，写入 `rotor_drawings.drawing_name`；前端下载 PDF 时用该名称作为文件名。
- `/draw` 和 `/chat` 可接收 `drawingText` / `drawing_text` 作为图纸显示文字，生成 PDF 时写入转子图纸底部区域。
- `PATCH /api/rotor/history/:id/name` 用于重命名历史图纸，请求体 `{ "drawingName": "..." }`，成功返回 `{ "success": true, "data": { "drawingName": "..." } }`。
- 出图历史可通过 `GET /api/rotor/link-targets` 选择关联订单型号、型号变体或配方，保存时仍写入 `linked_pump_model` 文本字段。
- FreeCAD 默认最多同时执行 2 个任务。
- 图纸和状态写入 `rotor_drawings`，PDF 位于 `public/drawings/`。
- 删除历史记录时同时删除对应 PDF。
- 常用轴承输入如 `201/6201`、`202/6202`、`203/6203` 会自动标准化。

## 7. AI 与移动端

- AI 只允许执行 `tools.cjs` 中已注册的工具。
- 写操作还必须位于 `WRITE_TOOLS` 白名单，并通过确认流程；查询工具不能借机写库。
- 微信小程序代码位于 `wechat-miniprogram/`，当前通过 `INTERNAL_SECRET` 认证。
- Siri 使用文字输入，不经过 ASR；结果临时保存在内存中，5 分钟后失效。
- Web 语音使用阿里云 ASR；AI 对话使用 DeepSeek SSE。

## 8. 当前已知边界

- 部分旧接口尚未完全统一 `{ success, data/error }` 响应格式。
- 转子历史仍输出 snake_case；配方等写接口仍保留旧入参兼容。
- 关键写接口的 ID、金额、非负数和 JSON 校验尚未完全统一。
- 审计日志目前主要覆盖 UPDATE 和 DELETE，不覆盖所有 INSERT/UPSERT。
- `GET /api/recipes/:id/cost` 不是完整配方总成本接口，报价应使用 `cost-preview`。

这些属于后续收口项，不应成为新代码继续扩散旧格式的理由。
