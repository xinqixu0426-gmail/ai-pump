# 型号变体 API

型号变体用于表达“同一套泵壳模板下，不同型号使用不同线圈、机筒长度和叶轮参数”的规则。

配方录入选择型号变体时，会根据变体中的 `barrelLength + longScrewExtraLength` 自动匹配模板固定配件里的“不锈钢长螺丝”型号。例如模板中原型号为 `6*160`，变体机筒长度为 `145`、固定系数为 `15`，配方生成时长螺丝型号仍为 `6*160`；如果机筒长度变为 `165`，则生成 `6*180`。

## `GET /api/model-variants`

需要登录。

成功：

```json
{ "success": true, "data": [] }
```

## `POST /api/model-variants`

需要登录。

请求体使用 camelCase：

```json
{
  "modelName": "V450",
  "templateId": 1,
  "coilSpec": "12",
  "coilSheets": 100,
  "coilMaterial": "钢带",
  "barrelLength": 150,
  "longScrewExtraLength": 10,
  "impellerModel": "400",
  "impellerThickness": 12,
  "impellerDiameter": 108,
  "impellerBladeCount": 3,
  "note": ""
}
```

成功：

```json
{ "success": true, "data": { "Id": 1, "modelName": "V450" } }
```

失败：

```json
{ "success": false, "error": "型号名称为必填项" }
```

## `PATCH /api/model-variants/:id`

需要登录。请求体字段同新增接口。

## `DELETE /api/model-variants/:id`

需要登录。软删除型号变体，不影响已创建的配方。
