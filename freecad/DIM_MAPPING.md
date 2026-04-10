# FreeCAD TechDraw 尺寸标注映射文档

> 最后更新: 2026-04-10  
> 模板文件: `freecad/rotor_template.FCStd`  
> 使用脚本: `freecad/worker.py`

## 映射机制

`worker.py` 使用 **自动检测** 方式：扫描文档中所有 `TechDraw::DrawViewDimension` 类型的对象，
按 `Name` 字母排序后，与 `dim_param_order` 数组按索引一一对应。

**也就是说**：Dimension 的 `Name` 编号无关紧要（014 还是 100 都行），
关键是它们排序后的 **第几个** 对应数组里的 **第几项**。

## 当前映射关系（已校准 ✅）

| 序号 | FreeCAD 对象名 | 参数 Key                | 中文含义       | 标注类型   |
|------|---------------|------------------------|---------------|-----------|
| 0    | Dimension014  | `_core_length`         | 铁芯长度（片数×0.5） | DistanceX |
| 1    | Dimension015  | `stack_offset`         | 定位/叠片定位   | DistanceX |
| 2    | Dimension016  | `lower_bearing_depth`  | 下轴承深度     | DistanceX |
| 3    | Dimension017  | `upper_bearing_depth`  | 上轴承深度     | DistanceX |
| 4    | Dimension018  | `upper_bearing_dia`    | 上轴承直径     | DistanceY |
| 5    | Dimension019  | `bearing_span`         | 开档/轴承间距   | Distance  |
| 6    | Dimension020  | `bearing_to_impeller`  | 叶轮开档       | Distance  |
| 7    | Dimension021  | `impeller_depth`       | 叶轮厚度       | DistanceX |
| 8    | Dimension022  | `thread_length`        | 螺纹长度       | DistanceX |
| 9    | Dimension023  | `lower_bearing_dia`    | 下轴承直径     | Distance  |
| 10   | Dimension024  | `oil_seal_dia`         | 油封直径       | Distance  |
| 11   | Dimension025  | `impeller_dia`         | 叶轮直径       | Distance  |
| 12   | Dimension026  | `thread_dia`           | 螺纹直径       | Distance  |
| 13   | Dimension027  | `_total_length`        | 总长度（派生）   | Distance  |

## 派生参数

以下参数不由用户直接输入，由系统自动计算：

| 参数 Key         | 公式                                                                    |
|-----------------|-------------------------------------------------------------------------|
| `_core_length`  | `piece_count × 0.5`                                                     |
| `_total_length` | `upper_bearing_depth + bearing_span + bearing_to_impeller + impeller_depth + thread_length` |

## 轴承查表

轴承型号由 API 层 (`api/routes/rotor.cjs` 中的 `BEARING_DB`) 查表转换为直径和深度：

| 型号   | 直径 (dia) | 深度 (depth) |
|--------|-----------|-------------|
| 6201   | 12.0 mm   | 10.0 mm     |
| 6202   | 15.0 mm   | 11.0 mm     |
| 6203   | 17.0 mm   | 12.0 mm     |
| 6204   | 20.0 mm   | 14.0 mm     |
| 6205   | 25.0 mm   | 15.0 mm     |

## Spreadsheet 注入

`worker.py` 自动检测文档中 **最后一个** `Spreadsheet::Sheet` 对象进行参数注入。
当前模板中为 `Spreadsheet001`。

## 如何重新校准映射

当更换 TechDraw 模板或重新添加尺寸标注后：

1. 用已知参数发起一次出图请求
2. 查看终端日志中的映射表输出：
   ```
   [Worker] 自动检测到 14 个 Dimension 对象, 映射表:
     Dimension014 -> _core_length
     Dimension015 -> stack_offset
     ...
   ```
3. 打开生成的 PDF，逐个对比图纸上标注数字是否出现在正确位置
4. 如有错位，修改 `worker.py` 中 `dim_param_order` 数组的顺序
5. 更新本文档
