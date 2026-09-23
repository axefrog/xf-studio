import bpy, json
from pathlib import Path
source=Path('F:/Games/RedModding/Projects/xf-eye-artistry-ccxl/v-character-model/v2/xfea_head2.blend')
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
report={'objects':[],'materials':[]}
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    coords=[o.matrix_world @ v.co for v in o.data.vertices]
    report['objects'].append({'name':o.name,'bounds':[[min(c[i] for c in coords) for i in range(3)],[max(c[i] for c in coords) for i in range(3)]], 'hidden':o.hide_get(),'uv':[{ 'name':u.name,'range':[[min(v.uv[i] for v in u.data),max(v.uv[i] for v in u.data)] for i in range(2)]} for u in o.data.uv_layers], 'active_shapes':{k.name:k.value for k in o.data.shape_keys.key_blocks if k.value} if o.data.shape_keys else {}})
for m in bpy.data.materials:
    report['materials'].append({'name':m.name,'nodes':[{'type':n.type,'name':n.name,'image':n.image.filepath if n.type=='TEX_IMAGE' and n.image else None} for n in m.node_tree.nodes] if m.use_nodes else []})
rig=bpy.data.objects['Armature.001']
report['skin_audit']=[]
for name in ['submesh_00_LOD_1.009','submesh_00_LOD_1.010']:
    o=bpy.data.objects[name]
    valid={g.index for g in o.vertex_groups if g.name in rig.data.bones}
    report['skin_audit'].append({'object':name,'non_bone_groups':[g.name for g in o.vertex_groups if g.index not in valid], 'max_bone_influences':max(sum(g.weight>0 and g.group in valid for g in v.groups) for v in o.data.vertices),'max_weight_discarded_at_four_bones':max(sum(sorted([g.weight for g in v.groups if g.group in valid],reverse=True)[4:]) for v in o.data.vertices)})
report['lid_bones']=[{'name':b.name,'head':list(b.head_local),'tail':list(b.tail_local),'parent':b.parent.name if b.parent else None} for b in rig.data.bones if 'eye' in b.name]
out=Path(__file__).resolve().parents[1]/'evidence'
out.mkdir(exist_ok=True)
(out/'scene-inspection.json').write_text(json.dumps(report,indent=2))
print('Scene inspected:',out)
