# 电缆铜套规格

电缆线成本公式：

```text
电缆线单价 * 米数 + 铜套配件费
```

## 全局配置

铜套名称和价格统一存于 `system_settings.cable_accessories`：

```json
{
  "standard": { "name": "普通铜套", "fee": 3.3 },
  "xinjie": { "name": "新界式", "fee": 5.2 }
}
```

录入任意电缆线零件时都可以维护这组全局值。新增其他线径时会自动带出，无需重复输入。成本计算优先使用全局配置。

设置接口：

- `GET /api/settings/cable_accessories`
- `PUT /api/settings/cable_accessories`

`PUT` 请求体示例：

```json
{
  "value": {
    "standard": { "name": "普通铜套", "fee": 3.3 },
    "xinjie": { "name": "新界式", "fee": 5.2 }
  }
}
```

## 零件元数据兼容

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

`cableAccessoryFee`、`cableAccessoryFees` 和 `cableAccessoryNames` 保留用于旧数据兼容和快照回退。旧数据首次升级时会自动提取为全局配置。

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
