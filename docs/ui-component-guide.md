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
| 阻断错误 | `FormError` |
| 页面内提示 | `InlineNotice` |
| 保存状态 | 固定操作栏内的明确文案，不新增独立样式常量 |

字段状态由基础组件维护。业务页面只提供值、变更事件、禁用状态和业务错误，不复制高度、焦点环或错误颜色。

## 3. 弹层选择

| 内容 | 使用组件 |
|---|---|
| 短表单、轻量查看 | `Dialog` |
| 详情、历史、较长编辑 | `Drawer` |
| 删除、覆盖、重复创建、放弃修改 | `ConfirmDialog` |

所有弹层由统一组件处理 Portal、Escape、焦点循环、焦点恢复、滚动锁定与层级。业务页面不得手写 `fixed inset-0` 遮罩，也不得使用 `window.confirm()`。

```tsx
<ConfirmDialog
  open={Boolean(deleteTarget)}
  title="删除客户？"
  description="客户资料将被永久删除，此操作不可撤销。"
  confirmLabel="确认删除"
  confirmVariant="danger"
  onConfirm={deleteCustomer}
  onClose={() => setDeleteTarget(null)}
/>
```

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
- 新增、编辑、删除成功后仍重新拉取正式数据。
- 390px 没有页面级横向溢出。
- Dialog/Drawer 可通过 Escape 关闭并恢复焦点。
- `npm run lint`、相关契约测试、完整测试和 `npm run build` 通过。
