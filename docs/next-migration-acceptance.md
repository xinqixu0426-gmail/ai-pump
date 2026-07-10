# Next 前端迁移验收清单

> 更新日期：2026-07-09。本文用于判断 `apps/web-next` 是否可以作为主前端替代旧 Vite/MUI 前端。本文只描述验收标准；API 约束见 [api-sop.md](./api-sop.md)，业务边界见 [business-flow.md](./business-flow.md)，状态边界见 [frontend-state-boundary.md](./frontend-state-boundary.md)，UI 规则见 [ui-refactor-guidelines.md](./ui-refactor-guidelines.md)。

## 1. 联调启动

Next 前端依赖 Express API。做人工验收时必须同时启动两个服务：

```bash
npm run web-next:full
```

等价于：

```bash
npm run api
npm run web-next:dev
```

端口约定：

- Next 前端：`http://localhost:3001`
- Express API：`http://localhost:3002`
- Next rewrite：`/api/* -> http://localhost:3002/api/*`

生产试运行使用：

```bash
npm run web-next:clean
npm run web-next:build
npm run web-next:prod
```

`web-next:prod` 会同时启动现有 Express API 和 Next server。正式部署到 Mac Mini 时也可以拆成两个 `nohup` 进程，便于单独回滚 Next 前端。

如果页面出现 `HTTP 500: Internal Server Error` 且 Next 日志包含 `ECONNREFUSED`，优先检查 `3002` 是否启动。

如果页面变成裸 HTML、样式丢失，或 Next 日志出现 `SegmentViewNode`、`vendor-chunks/*.js`、`__webpack_modules__[moduleId] is not a function`，说明 dev/prod 构建缓存被污染。先停掉 `3001`，执行 `npm run web-next:rebuild`，再启动 `npm run web-next:start`。

## 2. 当前覆盖范围

| 旧功能入口 | Next 路由 | 当前状态 | 说明 |
|---|---|---|---|
| 运营看板 | `/dashboard` | 已覆盖 | 使用 `/api/workbench/summary` 权威汇总 |
| 订单列表与创建 | `/orders` | 已覆盖 | 创建订单先生成采购计划，再写订单；订单详情支持采购项勾选、待办勾选、状态流转、采购完成入库确认 |
| 零件管理 | `/parts` | 已覆盖 | 支持 CRUD、分类分组折叠、勾选、CSV 导出、批量删除、分类驱动输入、电容/线径型号生成、电缆/浮球全局配件设置、螺丝参数化计价、泵壳转子备用参数；库存变更仍走标准 API |
| 客户管理 | `/customers` | 已覆盖 | 支持 CRUD、报价统计展示，并可从客户详情带客户上下文新建报价 |
| 配方管理 | `/recipes` | 已覆盖 | 支持 CRUD、配方详情、生产库存预检与扣减、配方对比、BOM 草稿、成本草稿、浮球、电缆、选配、包装；技术参数已改为结构化编辑并兼容 `technicalDataJson` 存储；已恢复泵壳模板结构化管理、常用配置（型号变体）管理入口，以及配方保存后同步沉淀常用配置 |
| 报价单 | `/quotations` | 已覆盖 | 支持 CRUD、状态修改、报价项浮球/电缆/机筒长度/包装覆盖并调用后端试算成本；接受报价转订单前必须展示订单产品和采购计划预览 |
| 采购中心 | `/purchase` | 已覆盖 | 支持按供应商聚合和采购状态标记；不入库 |
| 线圈转子 | `/coils` | 已覆盖 | 支持试算、CRUD、分组查看、实时市场指标、同步铜价/铝线基数/汇率、材质默认单价配置、规格+材质组批量改单价 |
| 转子出图 | `/rotor` | 已覆盖核心闭环 | 支持结构化参数、模板/变体带入、SS 机筒开档计算、暂存、出图、轮询、历史关联、PDF、打印、删除 |
| AI 助手 | `/ai` | 暂未迁移 | 导航保持 disabled，不得使用真实链接 |

## 3. 暂留差异

这些差异不阻塞 Next 作为主业务前端，但切换前必须明确告知使用者：

- AI 助手：暂不迁移，仍可在旧前端保留或作为后续独立工作。
- 旧 Vite/MUI 前端仅保留作为回滚备用，不再作为新增功能入口；新增业务 UI 优先在 Next 前端实现。

## 4. 自动验收

每次改动 Next 前端或迁移相关规则后必须执行：

```bash
npm test
npm run web-next:build
npm run build
```

当前契约测试必须覆盖：

- 前端不得新增裸 `fetch()`；
- Next 不得引入 MUI / Emotion；
- Next 页面和组件不得直接请求 API，必须通过 `apps/web-next/lib/*` client；
- 启用的 Next 导航必须存在真实页面；
- 只有 `NavItem` 可以直接使用 `next/link`，并且 `prefetch={false}`。

## 5. 浏览器验收

在完整双服务和登录态下，逐页打开：

```text
/dashboard
/orders
/parts
/customers
/recipes
/quotations
/purchase
/coils
/rotor
```

每页必须满足：

- 页面能打开，`h1` 与路由业务一致；
- 无 `Runtime Error`、`Application error`、`Internal Server Error`、未授权跳转；
- 浏览器控制台无错误；
- 桌面宽度无横向溢出；
- 移动宽度下侧边栏隐藏，页面主内容仍可读；
- 启用导航项点击不频闪、不触发 layout shift；
- 未实现页面只显示 disabled，不使用真实链接。

## 6. 关键交互验收

以下入口必须能打开表单或抽屉，并且不出现运行时错误：

| 页面 | 操作 |
|---|---|
| `/orders` | 新建订单；打开订单详情；切换采购项和待办；采购完成入库前必须展示入库预览并二次确认 |
| `/parts` | 新建零件；切换电容、电缆线、浮球、螺丝、泵壳时必须出现对应结构化字段；分类分组可折叠；勾选后可导出 CSV 或批量删除 |
| `/customers` | 新建客户 |
| `/recipes` | 新建配方；打开配方详情并查看 BOM/技术参数；执行生产库存预检和确认扣减；勾选两个配方后可打开配方对比，查看基础参数与 BOM 差异；保存配方时可同步沉淀为常用配置；存在成本完整性 warning 时必须阻止保存 |
| `/recipes` | 切换到泵壳模板并打开新建/编辑模板；切换到常用配置并打开新建配置 |
| `/quotations` | 新建报价；已接受报价转订单前必须展示订单产品和采购计划预览并二次确认 |
| `/coils` | 新增记录；刷新和同步市场指标；保存材质默认单价；在规格+材质组头部批量修改单片价 |

转子出图页需额外检查：

- `/rotor` 历史记录能加载；
- 选择泵壳模板能带入模板参数；
- 选择型号变体能带入模板并按机筒长度计算开档；
- SS 机筒长度修改后能更新开档和图纸备注；
- 暂存参数能写入历史；
- 出图任务能返回 `jobId` 并进入轮询；
- 历史记录能关联到订单型号、型号变体或配方；
- 成功记录能打开 PDF；
- 打印按钮只对成功记录可用。

## 7. 切换判定

满足以下条件后，Next 版可作为默认前端入口：

- 本文第 4 节自动验收全部通过；
- 本文第 5、6 节浏览器验收全部通过；
- 暂留差异已被业务使用者接受；
- 生产部署脚本明确选择 Next 前端或保留旧前端备用路径；
- 新增功能承诺优先在 Next 前端实现，旧前端只做必要维护。

本轮明确不迁移 AI，满足切换判定时 `/ai` 仍必须保持 disabled；不能为了“页面覆盖率”临时加空页面或真实链接。

切换后仍不得删除旧前端，除非另开一次删除评审并确认：

- 所有生产功能已在 Next 覆盖；
- 旧前端没有独有数据维护入口；
- 部署、回滚和使用说明已更新。
