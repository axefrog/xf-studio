"""Read-only comparison of authoring plate versions, including evaluated modifiers."""
import bpy, hashlib, json
import numpy as np
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
SOURCE=Path('F:/Games/RedModding/Projects/xf-eye-artistry-ccxl/v-character-model/v2/xfea_head2.blend')
before=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False,use_scripts=False)
a=bpy.data.objects['submesh_00_LOD_1.010']; b=bpy.data.objects['submesh_00_LOD_1.011']
def coordinates(mesh): return np.array([v.co[:] for v in mesh.vertices],dtype=float)
def stats(x):
 d=np.linalg.norm(x,axis=1)
 return {'max':float(d.max()),'mean':float(d.mean()),'p95':float(np.percentile(d,95))}
def evaluated(o):
 o.update_tag(refresh={'OBJECT','DATA'})
 bpy.context.view_layer.update()
 deps=bpy.context.evaluated_depsgraph_get();deps.update()
 e=o.evaluated_get(deps);m=e.to_mesh()
 try:return coordinates(m)
 finally:e.to_mesh_clear()
keys=a.data.shape_keys.key_blocks
saved={k.name:k.value for k in keys if k.value!=0}
target=coordinates(b.data)
report={'source':str(SOURCE),'sourceSha256':before,'blender':bpy.app.version_string,
 'sceneUnitScale':bpy.context.scene.unit_settings.scale_length,'activeMorphs':saved,
 'sameTopology':[list(p.vertices) for p in a.data.polygons]==[list(p.vertices) for p in b.data.polygons],
 'worldTransformsEqual':np.allclose(a.matrix_world,b.matrix_world),'comparisons':{}}
report['originalModifiers']=[{'name':m.name,'type':m.type,'viewport':m.show_viewport,'render':m.show_render,
 'strength':getattr(m,'strength',None),'midLevel':getattr(m,'mid_level',None),'direction':getattr(m,'direction',None)} for m in a.modifiers]
report['hidden']={o.name:{'hideGet':o.hide_get(),'hideViewport':o.hide_viewport,'hideRender':o.hide_render} for o in [a,b]}
mixed=coordinates(a.data).copy()
for k in list(keys)[1:]:
 if k.value: mixed+=(np.array([v.co[:] for v in k.data])-np.array([v.co[:] for v in k.relative_key.data]))*k.value
report['comparisons']['directRelativeShapeMixToStatic']=stats(mixed-target)
report['comparisons']['basisToStatic']=stats(coordinates(a.data)-target)
report['comparisons']['evaluatedToStatic']=stats(evaluated(a)-target)
report['comparisons']['evaluatedToEvaluated']=stats(evaluated(a)-evaluated(b))
for m in a.modifiers:
 if m.type=='ARMATURE':m.show_viewport=False
 if m.type=='DISPLACE':m.show_viewport=True
report['comparisons']['activeMorphsAndDisplaceToStatic']=stats(evaluated(a)-target)
for m in a.modifiers:
 if m.type=='DISPLACE':m.show_viewport=False
report['comparisons']['activeMorphsToStatic']=stats(evaluated(a)-target)
for k in keys:k.value=0
report['comparisons']['basisNoModifiersToStatic']=stats(evaluated(a)-target)
for m in a.modifiers:
 if m.type=='DISPLACE':m.show_viewport=True
report['comparisons']['basisAndDisplaceToStatic']=stats(evaluated(a)-target)
single=[]
for k in list(keys)[1:]:
 k.value=1
 single.append({'key':k.name,**stats(evaluated(a)-target)})
 k.value=0
report['closestSingleMorphAndDisplace']=sorted(single,key=lambda x:x['mean'])[:5]
report['uvDifferences']={}
for i,(u,v) in enumerate(zip(a.data.uv_layers,b.data.uv_layers)):
 report['uvDifferences'][str(i)]=float(np.max(np.abs(np.array([x.uv[:] for x in u.data])-np.array([x.uv[:] for x in v.data]))))
def weights(o):
 return [{o.vertex_groups[g.group].name:float(g.weight) for g in v.groups if g.weight>0 and o.vertex_groups[g.group].name in o.parent.data.bones} for v in o.data.vertices]
wa,wb=weights(a),weights(b)
report['boneWeightsEqual']=wa==wb
report['maxBoneInfluences']=max(map(len,wa))
report['maxWeightSumDeviation']=max(abs(sum(v.values())-1) for v in wa)
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==before
out=ROOT/'research/eye-artistry/evidence/plate-evaluated-comparison.json'
out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
