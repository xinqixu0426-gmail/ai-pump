# 成本计算 API

除 `/api/health` 外，以下接口均沿用系统 JWT Cookie 鉴权。内部服务调用需使用现有 `x-internal-secret` 机制。

成功响应统一为：

```json
{ "success": true, "data": {} }
```

失败响应统一为：

```json
{ "success": false, "error": "错误信息" }
```

## 配件数组成本

`POST /api/cost/parts`

```json
{
  "parts": [
    { "model": "202", "name": "轴承", "supplier": "万佳轴承", "qty": 2 }
  ]
}
```

返回配件成本合计、逐项明细和缺失型号。旧接口 `POST /api/cost/calculate` 保留兼容。

## 线圈转子成本

`POST /api/cost/coil`

```json
{
  "spec": "12",
  "sheets": 120,
  "material": "钢带",
  "wireWeight": 0.8,
  "copperPrice": 104.78
}
```

`wireWeight` 和 `copperPrice` 可选。返回线圈公式、线径、电容和合计。旧接口 `POST /api/coils/calculate` 保留兼容。

## 浮球成本

`POST /api/cost/float`

```json
{
  "wire": "0.55",
  "qty": 1
}
```

也可直接传 `model` 和 `supplier`。返回匹配型号、单价和合计。

## 电缆线成本

`POST /api/cost/cable`

```json
{
  "wire": "0.55",
  "length": 2,
  "cableAccessoryType": "standard"
}
```

`cableAccessoryType` 可选值：

- `standard`：第一种配件费
- `xinjie`：第二种配件费

返回电缆线单价、米数小计、自定义配件费名称、配件费和总价。

## 包装材料成本

`POST /api/cost/packing`

```json
{
  "parts": [
    { "model": "纸箱-示例型号", "supplier": "系统预设", "qty": 1 }
  ]
}
```

返回每项包材价格和合计。每项可传 `snapshotPrice` 覆盖当前零件价格。

## 人工与管理费

`POST /api/cost/overhead`

```json
{
  "assemblyWage": 3,
  "packingWage": 2,
  "surfaceTreatmentCost": 0,
  "managementFee": 1
}
```

返回安装工资、打包工资、表面处理、管理费和合计。

## 动态配置成本

`POST /api/cost/dynamic`

```json
{
  "statorSpec": "12",
  "statorSheets": 120,
  "hasFloat": true,
  "floatWire": "0.55",
  "hasCable": true,
  "cableWire": "0.55",
  "cableLength": 2,
  "cableAccessoryType": "standard",
  "boxType": "纸箱-示例型号"
}
```

返回浮球、电缆线和包装材料的逐项明细。旧接口 `POST /api/cost/dynamic-config` 保留兼容。

## 配方成本

`GET /api/recipes/:id/cost`

返回指定配方当前成本和逐项明细。旧接口 `GET /api/cost/recipe/:id` 保留兼容。

## 配方覆盖试算

`POST /api/recipes/:id/cost-preview`

```json
{
  "overrides": {
    "hasCable": true,
    "cableLength": 3,
    "cableWire": "0.55",
    "cableAccessoryType": "xinjie"
  }
}
```

用于报价前临时覆盖配方参数。旧接口 `POST /api/cost/dynamic-calculate` 保留兼容，该旧接口仍使用请求体字段 `baseRecipeId`。

## 完整估算

`POST /api/cost/full-estimate`

```json
{
  "pumphousing_model": "人民款370w",
  "stator": "12-120",
  "hasFloat": true,
  "floatWire": "0.55",
  "cableWire": "0.55",
  "cableLength": 2,
  "cableAccessoryType": "standard",
  "boxType": "纸箱-示例型号"
}
```

适用于 AI、N8N 和外部自动化的一站式估算。旧接口 `POST /api/cost/full-calculate` 保留兼容。

