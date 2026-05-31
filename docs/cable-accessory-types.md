# 电缆铜套规格

电缆线成本公式：

```text
电缆线单价 * 米数 + 铜套配件费
```

## 零件元数据

`parts.remark` 中的 JSON 支持：

```json
{
  "cableAccessoryFee": 3.3,
  "cableAccessoryFees": {
    "standard": 3.3,
    "xinjie": 5.2
  },
  "cableAccessoryNames": {
    "standard": "普通铜套",
    "xinjie": "新界式"
  }
}
```

`cableAccessoryFee` 保留为旧数据兼容字段，等同于普通铜套价格。
`cableAccessoryNames` 可在零件录入页面自定义。旧数据未设置名称时，默认显示“普通铜套”和“新界式”。

## 配方字段

配方使用 `cableAccessoryType` 选择铜套规格：

- `standard`：普通铜套，默认值
- `xinjie`：新界式

数据库列为 `recipes.cable_accessory_type`，Row Adapter 和前端 API 统一使用 camelCase。

## 成本接口

以下接口支持可选请求字段 `cableAccessoryType`：

- `POST /api/cost/dynamic-config`
- `POST /api/cost/dynamic-calculate` 的 `overrides`
- `POST /api/cost/full-calculate`

这些接口沿用现有 JWT Cookie 鉴权规则，响应格式保持 `{ "success": true, "data": {} }` 或 `{ "success": false, "error": "错误信息" }`。
