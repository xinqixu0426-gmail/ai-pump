import sys
import FreeCAD
import os

base_dir = os.path.dirname(os.path.abspath(__file__))
doc = FreeCAD.openDocument(os.path.join(base_dir, 'rotor_template.FCStd'))

dim = doc.getObject('Dimension')
if dim:
    with open(os.path.join(base_dir, 'dim_props.txt'), 'w', encoding='utf-8') as f:
        f.write("PROPERTIES:\n")
        f.write(str(dim.PropertiesList) + "\n\n")
        for prop in dim.PropertiesList:
            f.write(f"{prop} = {getattr(dim, prop)}\n")
FreeCAD.closeDocument(doc.Name)
