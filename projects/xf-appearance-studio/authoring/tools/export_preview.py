"""Derive a local preview from the untouched Blender master. Never saves the .blend.
Run with Blender --background --factory-startup --disable-autoexec --python.
"""
import bpy, hashlib, json
import numpy as np
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path('F:/Games/RedModding/Projects/xf-eye-artistry-ccxl/v-character-model/v2/xfea_head2.blend')
OUT=ROOT/'public'/'assets'
OUT.mkdir(parents=True,exist_ok=True)
def digest(p):
    with p.open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()
before=digest(SOURCE)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False,use_scripts=False)
selection={'submesh_00_LOD_1.009':'head','submesh_00_LOD_1.010':'makeup_plate','submesh_01_LOD_1':'eyes'}
report={'source':str(SOURCE),'source_sha256':before,'blender':bpy.app.version_string,'objects':[],'textures':[], 'limitations':['Preview uses UV0, omits the separate high-detail eye-skin overlay, brows, lashes and hair.','Plate Displace omitted; browser uses a preview-only normal offset.','Existing facial customization morph defaults retained. No game blink animation present.','Material adaptation is a PBR approximation, not REDengine shader execution.']}
for o in bpy.context.view_layer.objects: o.select_set(False)
rig=bpy.data.objects['Armature.001']
rig.hide_set(False); rig.hide_viewport=False; rig.select_set(True)
for src,name in selection.items():
    o=bpy.data.objects[src]
    report['objects'].append({'source_object':src,'export_name':name,'vertices':len(o.data.vertices),'morphs':len(o.data.shape_keys.key_blocks)-1 if o.data.shape_keys else 0,'max_nonzero_influences':max(sum(g.weight>0 for g in v.groups) for v in o.data.vertices),'max_weight_discarded_at_four':max(sum(sorted([g.weight for g in v.groups],reverse=True)[4:]) for v in o.data.vertices),'saved_morph_weights':{k.name:k.value for k in o.data.shape_keys.key_blocks if k.value} if o.data.shape_keys else {}})
    row=report['objects'][-1]
    row['max_nonzero_vertex_group_memberships']=row.pop('max_nonzero_influences')
    row.pop('max_weight_discarded_at_four')
    valid={g.index for g in o.vertex_groups if g.name in rig.data.bones}
    row['max_bone_influences']=max(sum(g.weight>0 and g.group in valid for g in v.groups) for v in o.data.vertices)
    row['non_bone_groups']=[g.name for g in o.vertex_groups if g.index not in valid]
    o.name=name
    o.hide_set(False); o.hide_viewport=False; o.hide_render=False; o.select_set(True)
    for m in list(o.modifiers):
        if m.type != 'ARMATURE': o.modifiers.remove(m)
    o.data.materials.clear()
    mat=bpy.data.materials.new(name+'_preview'); mat.diffuse_color=(0.5,0.4,0.35,1)
    o.data.materials.append(mat)
    if name=='eyes':
        for loop in o.data.uv_layers[0].data: loop.uv-=__import__('mathutils').Vector((1,1))
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'head.glb'),export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_morph=True,export_morph_normal=True,export_all_influences=True,export_materials='EXPORT',export_extras=True,export_yup=True)
# The historical UDIM atlas is a 3x3 texture. Crop exact tiles before reducing resolution.
for filename,tiles in [('UDIM_d.png',[('head-color',0,0),('eye-color',1,1)]),('UDIM_n.png',[('head-normal',0,0)]),('UDIM_r.png',[('head-roughness',0,0)])]:
    path=SOURCE.parent/filename
    im=bpy.data.images.load(str(path),check_existing=False)
    w,h=im.size; pix=np.empty(w*h*4,dtype=np.float32); im.pixels.foreach_get(pix); pix=pix.reshape((h,w,4)); side=w//3
    for label,x,y in tiles:
        target=bpy.data.images.new(label,width=side,height=side,alpha=True)
        target.colorspace_settings.name=im.colorspace_settings.name
        tile=pix[y*side:(y+1)*side,x*side:(x+1)*side].copy()
        target.pixels.foreach_set(tile.ravel()); target.scale(2048,2048)
        target.filepath_raw=str(OUT/(label+'.png')); target.file_format='PNG'; target.save()
        report['textures'].append({'source':str(path),'source_sha256':digest(path),'tile':[x,y],'output':label+'.png','size':[2048,2048],'source_colorspace':im.colorspace_settings.name})
        bpy.data.images.remove(target)
    bpy.data.images.remove(im)
report['outputs']=[{'file':p.name,'sha256':digest(p),'bytes':p.stat().st_size} for p in OUT.iterdir() if p.is_file()]
assert digest(SOURCE)==before,'Source changed during preview export'
(ROOT/'evidence'/'asset-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'outputs':report['outputs'],'objects':report['objects']}))
