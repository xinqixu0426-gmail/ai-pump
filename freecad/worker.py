"""
FreeCAD TechDraw 渲染 Worker 脚本
==================================
核心流程: 打开模板 -> 注入参数 -> recompute -> TechDraw 导出 SVG -> 转为 PDF -> 退出
"""

import sys
import os
import time
import json
import shutil
import traceback

t_total_start = time.time()

def elapsed():
    return f"{time.time() - t_total_start:.1f}s"

# ============================================================
# 1. 参数解析
# ============================================================
params_str = None
for arg in sys.argv:
    try:
        json.loads(arg)
        params_str = arg
    except (json.JSONDecodeError, ValueError):
        continue

if not params_str:
    print(f"[Worker] ❌ 致命错误: 未能从命令行参数中找到合法的 JSON 参数")
    print(f"[Worker] sys.argv = {sys.argv}")
    try:
        from PySide2.QtWidgets import QApplication
        app = QApplication.instance()
        if app:
            app.quit()
    except Exception:
        pass
    os._exit(1)

params = json.loads(params_str)
job_id = params.pop("_jobId", "drawing")
print(f"[Worker] [{elapsed()}] 🚀 接收到渲染任务, JobId={job_id}: {params}")

# ============================================================
# 2. 文件路径准备
# ============================================================
# worker.py is located at freecad/worker.py
base_dir = os.path.dirname(os.path.abspath(__file__))

template_path = os.path.join(base_dir, "rotor_template.FCStd")
work_path = os.path.join(base_dir, f"work_{job_id}.FCStd")
output_svg = os.path.join(base_dir, f"temp_{job_id}.svg")
output_pdf = os.path.join(base_dir, f"output_{job_id}.pdf")

if not os.path.exists(template_path):
    print(f"[Worker] ❌ 致命错误: 找不到模板文件 {template_path}")
    os._exit(1)

shutil.copy2(template_path, work_path)
print(f"[Worker] [{elapsed()}] 模板已复制到工作区")

# ============================================================
# 3. 初始化 FreeCAD
# ============================================================
exit_code = 1

try:
    print(f"[Worker] [{elapsed()}] 加载 FreeCAD 模块...")
    import FreeCAD
    import FreeCADGui
    print(f"[Worker] [{elapsed()}] FreeCAD 模块加载完毕")

    print(f"[Worker] [{elapsed()}] 打开文档副本...")
    doc = FreeCAD.openDocument(work_path)
    doc_name = doc.Name
    FreeCAD.setActiveDocument(doc_name)
    print(f"[Worker] [{elapsed()}] 文档已打开")

    # ============================================================
    # 4. 参数注入到 Spreadsheet（自动检测最后一个 Spreadsheet 对象）
    # ============================================================
    sheets = [obj for obj in doc.Objects if obj.TypeId == "Spreadsheet::Sheet"]
    if not sheets:
        raise ValueError("文档中找不到 Spreadsheet 对象！")
    sheet = sheets[-1]  # 取最后一个（新模板追加的）
    print(f"[Worker] [{elapsed()}] 使用 Spreadsheet: {sheet.Name}")

    # 注入用户参数到 Spreadsheet（跳过 _ 前缀的派生参数）
    for key, val in params.items():
        if key.startswith("_"):
            continue
        try:
            if key == "piece_count":
                sheet.set(key, str(val))
            else:
                sheet.set(key, f"{val} mm")
        except Exception as e:
            print(f"[Worker]   ⚠️ 跳过参数 {key}: {e}")

    print(f"[Worker] [{elapsed()}] 参数注入完毕")

    # ============================================================
    # 4.5. Fake Parametric / DIM Dimension Text Overrides
    # ============================================================
    # 参数映射顺序 — 与 FreeCAD rotor_template.FCStd 中 Dimension 的创建顺序一致
    # ⚠️ 如果更换模板或重新标注，需重新校准此顺序（参考 freecad/DIM_MAPPING.md）
    dim_param_order = [
        "rotor_dia",              # Dimension  — 转子直径 (新增)
        "_core_length",           # Dimension014 — 铁芯长度 (片数×0.5)
        "stack_offset",           # Dimension015 — 定位/叠片定位
        "lower_bearing_depth",    # Dimension016 — 下轴承深度
        "upper_bearing_depth",    # Dimension017 — 上轴承深度
        "upper_bearing_dia",      # Dimension018 — 上轴承直径
        "bearing_span",           # Dimension019 — 开档/轴承间距
        "bearing_to_impeller",    # Dimension020 — 叶轮开档
        "impeller_depth",         # Dimension021 — 叶轮厚度
        "thread_length",          # Dimension022 — 螺纹长度
        "lower_bearing_dia",      # Dimension023 — 下轴承直径
        "oil_seal_dia",           # Dimension024 — 油封直径
        "impeller_dia",           # Dimension025 — 叶轮直径
        "thread_dia",             # Dimension026 — 螺纹直径
        "_total_length",          # Dimension027 — 总长度 (派生)
    ]

    # 自动检测所有 Dimension 对象，按名字排序后顺序绑定
    dim_objects = sorted(
        [obj for obj in doc.Objects if obj.TypeId == "TechDraw::DrawViewDimension"],
        key=lambda o: o.Name
    )
    dim_map = {}
    for i, obj in enumerate(dim_objects):
        if i < len(dim_param_order):
            dim_map[obj.Name] = dim_param_order[i]

    print(f"[Worker] [{elapsed()}] 自动检测到 {len(dim_objects)} 个 Dimension 对象, 映射表:")
    for name, param in dim_map.items():
        print(f"[Worker]   {name} -> {param}")

    # Pre-calculate derived variables
    if "piece_count" in params:
        try:
            params["_core_length"] = float(params["piece_count"]) * 0.5
        except (ValueError, TypeError):
            pass

    # _total_length 已在 api/routes/rotor.cjs 层进行完整性校验并计算
    # worker 层不再使用 0 兜底计算，直接使用 params 里传过来的 _total_length (如果不全则不覆盖图纸初始值)
    print(f"[Worker] [{elapsed()}] 开始替换图纸维度数字...")
    for obj in doc.Objects:
        if obj.Name in dim_map:
            param_key = dim_map[obj.Name]
            if param_key in params:
                val = params[param_key]
                print(f"[Worker]   DIM {obj.Name} -> {param_key} = {val}")
                try:
                    obj.Arbitrary = True
                    # In FreeCAD, if Arbitrary is True, FormatSpec takes the exact custom text
                    obj.FormatSpec = str(val)
                except Exception as e:
                    print(f"[Worker] ⚠️ 无法修改维度 {obj.Name}: {e}")
            else:
                print(f"[Worker]   DIM {obj.Name} -> NO MAPPING (param_key={param_key})")

    # ============================================================
    # 5. 第一次 recompute：更新 3D 模型
    # ============================================================

    sheet.touch()
    doc.recompute()
    print(f"[Worker] [{elapsed()}] 3D 模型 recompute 完毕")

    # ============================================================
    # 6. 找到图纸页
    # ============================================================
    page = None
    for obj in doc.Objects:
        if obj.TypeId == "TechDraw::DrawPage":
            page = obj
            break

    if not page:
        raise ValueError("找不到 TechDraw::DrawPage 图纸页！")

    print(f"[Worker] [{elapsed()}] 命中图纸页: {page.Name}")

    # ============================================================
    # 7. 切换 GUI 到图纸页
    # ============================================================
    try:
        FreeCADGui.activeDocument().setEdit(page.Name)
    except Exception as e:
        print(f"[Worker] [{elapsed()}] setEdit 警告: {e}")

    # ============================================================
    # 8. TechDraw 刷新 & 优化
    # ============================================================
    print(f"[Worker] [{elapsed()}] 开始 TechDraw 刷新...")
    for obj in doc.Objects:
        if obj.TypeId.startswith("TechDraw::"):
            obj.touch()
    doc.recompute()
    for _ in range(5):
        FreeCADGui.updateGui()
        time.sleep(0.1)
    print(f"[Worker] [{elapsed()}] TechDraw 刷新完毕")

    # ============================================================
    # 9. TechDraw 导出 SVG
    # ============================================================
    import TechDrawGui

    if os.path.exists(output_svg):
        os.remove(output_svg)

    print(f"[Worker] [{elapsed()}] 导出 SVG...")
    TechDrawGui.exportPageAsSvg(page, output_svg)

    if not os.path.exists(output_svg) or os.path.getsize(output_svg) < 100:
        raise RuntimeError("SVG 导出失败或文件为空")

    print(f"[Worker] [{elapsed()}] SVG 导出成功 ({os.path.getsize(output_svg)} bytes)")

    # 替换 osifont 为 Helvetica（中文会显示方块，但数字标注正常）
    try:
        with open(output_svg, 'r', encoding='utf-8') as f:
            svg_content = f.read()
        svg_content = svg_content.replace('font-family="osifont"', 'font-family="Helvetica"')
        svg_content = svg_content.replace('font-family:osifont', 'font-family:Helvetica')
        with open(output_svg, 'w', encoding='utf-8') as f:
            f.write(svg_content)
    except Exception:
        pass

    # ============================================================
    # 10. 关闭文档
    # ============================================================
    FreeCAD.closeDocument(doc_name)
    print(f"[Worker] [{elapsed()}] 文档已关闭")

    # ============================================================
    # 11. SVG → PDF（含中文字体修补）
    # ============================================================
    print(f"[Worker] [{elapsed()}] SVG → PDF 转换中...")
    import re
    from svglib.svglib import svg2rlg
    from reportlab.graphics import renderPDF
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    # 注册中文字体
    CHINESE_FONT_REGISTERED = False
    CHINESE_FONT_NAME = 'MSYH'
    for font_path in [r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simsun.ttc']:
        if os.path.exists(font_path):
            try:
                pdfmetrics.registerFont(TTFont(CHINESE_FONT_NAME, font_path, subfontIndex=0))
                CHINESE_FONT_REGISTERED = True
                print(f"[Worker] [{elapsed()}] 已注册中文字体: {font_path}")
                break
            except Exception as e:
                print(f"[Worker] [{elapsed()}] ⚠️ 注册字体失败 {font_path}: {e}")

    drawing = svg2rlg(output_svg)
    if drawing is None:
        raise RuntimeError("svg2rlg 返回 None")

    # 遍历 Drawing 树，将含中文的文本节点字体替换为已注册的中文字体
    if CHINESE_FONT_REGISTERED:
        chinese_re = re.compile(r'[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]')
        counter = [0]
        def patch_chinese_fonts(node):
            if hasattr(node, 'contents'):
                for child in node.contents:
                    patch_chinese_fonts(child)
            if hasattr(node, 'text') and isinstance(getattr(node, 'text', None), str):
                if chinese_re.search(node.text):
                    node.fontName = CHINESE_FONT_NAME
                    counter[0] += 1
        patch_chinese_fonts(drawing)
        print(f"[Worker] [{elapsed()}] 已修补 {counter[0]} 个中文文本节点")

    renderPDF.drawToFile(drawing, output_pdf)
    print(f"[Worker] [{elapsed()}] 📄 PDF 生成完毕: {os.path.getsize(output_pdf)} bytes")

    # ============================================================
    # 11. 清理临时文件
    # ============================================================
    for tmp_file in [work_path, output_svg]:
        if os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
            except Exception:
                pass

    exit_code = 0

except Exception as e:
    print(f"[Worker] [{elapsed()}] ❌ 严重异常:")
    traceback.print_exc()
    exit_code = 1

finally:
    print(f"[Worker] [{elapsed()}] 最终退出码: {exit_code}")
    try:
        FreeCADGui.updateGui()
    except Exception:
        pass
    print(f"[Worker] [{elapsed()}] 💥 os._exit({exit_code})")
    os._exit(exit_code)
