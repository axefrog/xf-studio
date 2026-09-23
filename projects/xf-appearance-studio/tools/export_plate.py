"""Export the owned master with dense morph accessors for WolvenKit compatibility."""
import bpy
import hashlib
import json
from pathlib import Path

PROJECT=Path(__file__).resolve().parents[1]
OUT=PROJECT.parents[1]/'experiments/004-plate-import/generated/raw'
MASTER=PROJECT/'assets/authored/xfas_eye_plate.blend'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
before=sha(MASTER)
bpy.ops.wm.open_mainfile(filepath=str(MASTER),load_ui=False,use_scripts=False)
matches=[o for o in bpy.data.objects if o.type=='MESH' and o.data.name=='xfas_eye_plate']
assert len(matches)==1
plate=matches[0];plate.name='submesh_00_LOD_1';rig=plate.parent
for key in plate.data.shape_keys.key_blocks: key.value=0
for o in bpy.context.view_layer.objects: o.select_set(False)
for o in [plate,rig]: o.hide_set(False);o.hide_viewport=False;o.select_set(True)
bpy.context.view_layer.objects.active=plate
OUT.mkdir(parents=True,exist_ok=True)
glb=OUT/'xfas_eye_plate.blender.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,
    export_animations=False,export_skins=True,export_morph=True,export_morph_normal=True,
    export_morph_tangent=True,export_tangents=True,export_all_influences=True,
    export_try_sparse_sk=False,export_try_omit_sparse_sk=False,
    export_materials='EXPORT',export_extras=True,export_yup=True)
assert sha(MASTER)==before
report={'master':str(MASTER),'masterSha256':before,'glb':str(glb),'glbSha256':sha(glb),
        'bytes':glb.stat().st_size,'blender':bpy.app.version_string,
        'denseMorphAccessors':True,'reason':'Installed SharpGLTF path in WolvenKit 8.17.4 throws on sparse-only morph POSITION accessors.'}
(OUT.parent.parent/'plate-export.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
