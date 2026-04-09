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
    # 4. 参数注入到 Spreadsheet
    # ============================================================
    sheet = doc.getObject("Spreadsheet")
    if not sheet:
        raise ValueError("文档中找不到名为 'Spreadsheet' 的对象！")

    for key, val in params.items():
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
    dim_map = {
        "Dimension": "upper_bearing_depth",
        "Dimension001": "_core_length",
        "Dimension002": "stack_offset",
        "Dimension003": "lower_bearing_depth",
        "Dimension004": "impeller_depth",
        "Dimension005": "thread_length",
        "Dimension006": "upper_bearing_dia",
        "Dimension007": "lower_bearing_dia",
        "Dimension008": "oil_seal_dia",
        "Dimension009": "impeller_dia",
        "Dimension010": "thread_dia",
        "Dimension011": "bearing_span",
        "Dimension012": "bearing_to_impeller",
        "Dimension013": "_total_length",
    }
    
    # Pre-calculate derived variables if piece_count exists
    if "piece_count" in params:
        try:
            params["_core_length"] = float(params["piece_count"]) * 0.5
        except:
            pass

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
    print(f"[Worker] [{elapsed()}] TechDraw 刷新完毕")

    # ============================================================
    # 9. TechDraw 导出 SVG
    # ============================================================
    if os.path.exists(output_svg):
        os.remove(output_svg)

    print(f"[Worker] [{elapsed()}] 导出 SVG...")
    import TechDrawGui
    TechDrawGui.exportPageAsSvg(page, output_svg)

    if not os.path.exists(output_svg) or os.path.getsize(output_svg) < 100:
        raise RuntimeError(f"SVG 导出失败或文件为空")

    print(f"[Worker] [{elapsed()}] SVG 导出成功 ({os.path.getsize(output_svg)} bytes)")

    # ============================================================
    # 10. 关闭文档
    # ============================================================
    FreeCAD.closeDocument(doc_name)
    print(f"[Worker] [{elapsed()}] 文档已关闭")

    # ============================================================
    # 11. SVG 转 PDF
    # ============================================================
    print(f"[Worker] [{elapsed()}] SVG → PDF 转换中...")
    from svglib.svglib import svg2rlg
    from reportlab.graphics import renderPDF

    drawing = svg2rlg(output_svg)
    if drawing is None:
        raise RuntimeError("svg2rlg 返回 None")

    renderPDF.drawToFile(drawing, output_pdf)
    print(f"[Worker] [{elapsed()}] 📄 PDF 生成完毕: {os.path.getsize(output_pdf)} bytes")

    # ============================================================
    # 12. 清理临时文件
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
        from PySide2.QtWidgets import QApplication
        from PySide2.QtCore import QTimer
        app = QApplication.instance()
        if app:
            QTimer.singleShot(200, lambda: os._exit(exit_code))
            FreeCADGui.updateGui()
            time.sleep(0.5)
    except Exception:
        pass
    print(f"[Worker] [{elapsed()}] 💥 os._exit({exit_code})")
    os._exit(exit_code)
