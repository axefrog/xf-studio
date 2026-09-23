"""Run with Blender --background --factory-startup --disable-autoexec --python.
Read source .blend files without saving them; persist mesh evidence in HQ only.
"""
import bpy
import hashlib
import json
from pathlib import Path

HQ = Path(__file__).resolve().parents[2]
source = Path('F:/Games/RedModding/Projects/xf-eye-artistry-ccxl/v-character-model/v2/xfea_head2.blend')
bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
report = {'source': str(source), 'sha256': hashlib.file_digest(source.open('rb'), 'sha256').hexdigest(), 'blender_version': bpy.app.version_string, 'objects': []}
for obj in bpy.data.objects:
    row = {'name': obj.name, 'type': obj.type, 'parent': obj.parent.name if obj.parent else None, 'location': list(obj.location), 'scale': list(obj.scale), 'dimensions': list(obj.dimensions), 'hidden_render': obj.hide_render, 'modifiers': [{'name': m.name, 'type': m.type, **({'strength':m.strength,'mid_level':m.mid_level,'direction':m.direction,'vertex_group':m.vertex_group,'texture':m.texture.name if m.texture else None} if m.type=='DISPLACE' else {})} for m in obj.modifiers]}
    if obj.type == 'MESH':
        mesh = obj.data
        row.update(vertices=len(mesh.vertices), edges=len(mesh.edges), polygons=len(mesh.polygons), uv_layers=[u.name for u in mesh.uv_layers], vertex_groups=[g.name for g in obj.vertex_groups], materials=[m.name if m else None for m in mesh.materials], shape_keys=[k.name for k in mesh.shape_keys.key_blocks] if mesh.shape_keys else [])
        row['geometry_sha256'] = hashlib.sha256(b''.join(__import__('struct').pack('<3f', *v.co) for v in mesh.vertices)).hexdigest()
    report['objects'].append(row)
report['images'] = [{'name': i.name, 'filepath': i.filepath, 'packed': bool(i.packed_file)} for i in bpy.data.images]
plate=bpy.data.objects['submesh_00_LOD_1.010']
export_plate=bpy.data.objects['submesh_00_LOD_1.011']
report['plate_comparison']={'same_polygon_vertex_indices':[list(p.vertices) for p in plate.data.polygons]==[list(p.vertices) for p in export_plate.data.polygons], 'max_indexed_position_distance':max((a.co-b.co).length for a,b in zip(plate.data.vertices,export_plate.data.vertices)),'shape_key_deltas':{k.name:max((v.co-base.co).length for v,base in zip(k.data,plate.data.shape_keys.key_blocks[0].data)) for k in plate.data.shape_keys.key_blocks[1:]},'unweighted_vertices':sum(not v.groups for v in plate.data.vertices)}
dest = HQ / 'research' / 'eye-artistry' / 'evidence' / 'blender-head2-inspection.json'
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'output': str(dest), 'objects':len(report['objects']), 'plate_comparison':report['plate_comparison']}))
