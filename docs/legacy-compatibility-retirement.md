# 历史兼容收口计划

本文记录当前仍保留的兼容字段和接口边界。目标不是立即删除兼容层，而是阻止新代码继续扩散旧约定，并给后续清理留下明确路径。

## 1. 当前允许保留的兼容层

- 核心资源响应中临时保留 `Id`、`CreatedAt`、`UpdatedAt`，仅用于旧调用兼容。
- 配方、订单、模板和型号变体的部分写接口仍接受历史 snake_case 入参，但 Web 前端必须提交 camelCase。
- 转子出图请求在后端边界可兼容 FreeCAD 参数命名；Next 页面表单和类型必须保持 camelCase。
- `GET /api/recipes/:id/cost` 保留为当前配件价参考接口，不升级为完整成本口径。
- `paintingWage`、`boxType` 等历史业务字段只允许作为数据迁移、读取回退或旧记录展示来源。

## 2. 新代码禁止事项

- 不得在 `apps/web-next/app/` 或 `apps/web-next/components/` 中新增 `Id`、`CreatedAt`、`UpdatedAt` 依赖。
- 不得在 Next 页面组件类型里新增 snake_case 字段；历史字段兼容只能封装在 `apps/web-next/lib/` API client 或后端 adapter 内。
- 不得新增返回中文字段名的业务 API。
- 不得新增 `paintingWage`、`boxType` 作为正式业务输入；新逻辑使用 `surfaceTreatmentMode`、`surfaceTreatmentCost` 和 `packingPartsJson`。
- 不得新增旧路径 alias；新增 API 必须按 `docs/api-sop.md` 更新接口文档。

## 3. 收口顺序

1. 先通过测试确认 Web 前端只消费 camelCase 标准字段。
2. 在 API reference 中标注仍兼容的旧字段，并注明“仅旧调用兼容”。
3. 服务端对旧字段读取加日志或审计标记，观察生产中是否仍有调用。
4. 连续一个发布周期没有旧字段调用后，先移除前端兼容读取，再移除后端兼容入参。
5. 删除兼容层时同步更新 `docs/api-reference.md`、`docs/README.md` 和相关契约测试。

## 4. 删除前检查

删除任何历史兼容字段前，必须通过：

```bash
npm test
npm run verify:release
```

同时手动验证订单、配方、报价、线圈、转子出图和移动端 `/ai`。如果生产仍有外部调用依赖旧字段，先保留兼容层并把调用方迁移到标准 camelCase。
