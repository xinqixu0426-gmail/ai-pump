# Web UI 组件使用指南

本文是 `apps/web-next` 的组件选型入口。页面开发先选择已有组件，再补业务组合组件；不要在页面内重新实现遮罩、字段状态、列表工具栏或 AI 消息外壳。

## 1. 页面结构

| 场景 | 使用组件 | 说明 |
|---|---|---|
| 页面标题和主操作 | `PageHeader` | 标题、说明、刷新与新建入口保持同一层级 |
| 数据摘要 | `MetricGrid` + `MetricCard` | 只展示能解释当前页面状态的核心指标 |
| 工具容器 | `Panel`、`PanelHeader`、`PanelBody`、`PanelFooter` | 不在业务页面复制圆角、边框和阴影组合 |
| 搜索与筛选 | `ListToolbar` | 自带结果反馈、搜索清空和焦点状态 |
| 空结果 | `EmptyState` | 明确“当前没有什么”和下一步操作 |
| 宽表格 | `TableScrollArea` | 提供键盘焦点与窄屏滑动提示 |

全局导航活动态必须由当前 URL 派生：普通业务入口按 `pathname` 匹配，带查询参数的入口通过 `useSearchParams` 匹配其声明参数并允许附加上下文参数。不得把点击过的 `href` 保存为另一份导航事实，否则同路径页签切换、外部链接及浏览器前进后退会留下错误高亮。

```tsx
<PageHeader
  title="客户"
  description="维护客户资料与联系信息"
  actions={<Button variant="primary">新建客户</Button>}
/>
<Panel>
  <PanelHeader title="客户列表" />
  <PanelBody>
    <ListToolbar searchLabel="搜索客户" />
  </PanelBody>
</Panel>
```

## 2. 表单与反馈

| 场景 | 使用组件 |
|---|---|
| 标签、说明、错误 | `Field` |
| 文本、选择、长文本 | `Input`、`Select`、`Textarea` |
| 复选开关 | `Checkbox` |
| 阻断错误 | `FormError` |
| 页面内提示 | `InlineNotice` |
| 保存状态 | 固定操作栏内的明确文案，不新增独立样式常量 |

字段状态由基础组件维护。业务页面只提供值、变更事件、禁用状态和业务错误，不复制高度、焦点环或错误颜色。

允许自由输入并提供目录候选的字段统一使用 `EditableValueSelect`：焦点或点击展开候选，`ArrowUp` / `ArrowDown` 移动活动项，`Enter` 选中，`Escape` 先关闭候选且不得联动关闭父弹层；连续使用 `Backspace` / `Delete` 编辑时关闭候选但不阻断输入。输入焦点保留在 `combobox` 上，通过 `aria-activedescendant` 关联当前候选，鼠标点击和键盘选择必须走同一个 `onChange` 业务入口。

数字输入按编辑意图显式选择交互：数量、片数、默认工资和目录名义规格等通常整体替换的原子值，使用 `Input selectOnFirstFocus`；暂未迁移到 `Input` 的存量原生控件复用 `selectInputValueOnFocus`。首次鼠标或 Tab 聚焦会选中当前值，保持焦点后的再次点击仍可精确定位。利润率、销售价、采购价、线重和连续测量或按位修订的精密尺寸等字段保留浏览器原生光标行为；只读、禁用以及型号/规格等数字外观文本不得启用整值选择。小数步进本身不能决定分类，例如目录中的螺丝直径是整体替换的名义规格，而拉伸筒基准长度是精密尺寸。该能力必须按字段显式开启，不得根据 `type="number"` 全局套用。

同一种交互只能有一个基础组件入口。业务页面不得直接编写 `type="checkbox"`，也不得维护 `inputClass`、`selectClass`、`controlClass` 等视觉样式常量。确实需要紧凑尺寸、错误态或其他通用变体时，先给 `components/ui/` 中的基础组件增加明确属性，再由所有业务页面复用；页面传入的 `className` 只用于网格跨度、外边距和对齐等布局调整。

原生控件只保留在基础组件内部，或用于文件上传、隐藏字段等浏览器专用能力。存量页面按业务模块逐批迁移，每一批都要增加契约检查，防止已收口区域回退。

## 3. 弹层选择

| 内容 | 使用组件 |
|---|---|
| 短表单、轻量查看 | `Dialog` |
| 单一上下文的辅助详情、历史 | `Drawer` |
| 多页签详情、宽表格、跨分区操作 | `SlideOver size="workspace"`；需要持续操作的大型工作台使用 `size="fullscreen"` |
| 删除、覆盖、重复创建、放弃修改 | `ConfirmDialog` |

所有弹层由统一组件处理 Portal、Escape、焦点循环、焦点恢复、滚动锁定与层级。近全屏工作台必须固定标题和分区导航，只让主内容区独立滚动，并在窄屏限制在可视区域内。业务页面不得手写 `fixed inset-0` 遮罩，也不得使用 `window.confirm()`。

```tsx
<ConfirmDialog
  open={Boolean(deleteTarget)}
  title="删除零件？"
  description="零件将从当前零件目录中移除，历史审计记录仍会保留。"
  confirmLabel="确认删除"
  confirmVariant="danger"
  onConfirm={deletePart}
  onClose={() => setDeleteTarget(null)}
/>
```

删除确认必须按实际持久化语义描述后果：使用 `deleted_at` 的软删除只说明资源会从当前业务列表中移除、历史审计仍保留，不得写成“永久删除”或“无法撤销”，也不得在没有正式恢复入口时承诺用户可自行恢复。只有确实执行物理清理的动作才能使用不可恢复文案，并应明确会被清理的对象。未打开的全局浮动入口必须低于基础 Dialog/Drawer/SlideOver；需要主动覆盖业务弹层的工作区必须通过明确的专用层级实现。

## 4. AI 组件边界

- `AiView` 负责会话状态和工作台编排。
- `AiMessageList` 是唯一消息列表结构。
- `AiComposer` 是唯一消息输入结构。
- `AiConversationSidebars` 负责历史会话。
- `MarkdownContent`、`StreamingText` 位于 `components/ai/ai-text.tsx`，同时供 AI 消息和知识库诊断复用。
- 不再建立 `prompt-kit` 聊天容器、消息气泡或输入外壳；业务结果继续使用 `AiWorkflowResults`、`AiAnswerProcess` 等正式组件。

## 5. 业务组合组件

页面文件负责数据加载、业务状态和流程编排。超过一个完整工作区或弹层组时，拆到对应业务目录：

- `components/recipe/`
- `components/ai/`
- `components/knowledge/`

拆分必须保持 API 调用、确认顺序和刷新规则不变。纯类型、展示映射和格式化函数放入 `*-view-model.ts`，复杂弹层放入独立组合组件。

## 6. 提交前检查

- 没有新增裸 `fetch()`、`window.confirm()` 或页面自制遮罩。
- 没有新增业务页面原生复选框或字段视觉样式常量。
- 整值替换型数字字段显式启用首次聚焦全选；价格微调、连续测量尺寸和规格文本仍可直接定位光标。
- 新增、编辑、删除成功后仍重新拉取正式数据。
- 390px 没有页面级横向溢出。
- Dialog、Drawer 和 SlideOver 可通过 Escape 关闭并恢复焦点；多分区 workspace/fullscreen 固定标题与分区导航，单一长表单固定标题和操作区，两者都只保留一个主滚动区，并在 390px 窄屏内保持弹层不超出可视区域。
- `npm run lint`、相关契约测试、完整测试和 `npm run build` 通过。
