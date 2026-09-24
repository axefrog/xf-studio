"""Create the owned neutral plate master and game-import GLB from verified source art.
Run headlessly in Blender. The original file is only read; intake copy is immutable.
"""
import bpy
import hashlib
import json
import shutil
from pathlib import Path
from mathutils import Matrix

PROJECT = Path(__file__).resolve().parents[1]
HQ = PROJECT.parents[1]
SOURCE = Path('F:/Games/RedModding/Projects/xf-eye-artistry-ccxl/v-character-model/v2/xfea_head2.blend')
EXPECTED = 'c7a5fa8a90bcd4c45b78f85ad27b9f4a16056b370c664908bd7940adf3a6995d'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(SOURCE) == EXPECTED, 'Source art changed: repeat audit before intake.'
audit = json.loads((HQ/'research/eye-artistry/evidence/plate-evaluated-comparison.json').read_text())
assert audit['sourceSha256'] == EXPECTED
assert audit['sameTopology'] and audit['boneWeightsEqual'] and max(audit['uvDifferences'].values()) == 0
assert audit['comparisons']['directRelativeShapeMixToStatic']['max'] < 1e-7

imported = PROJECT/'assets/imported/plate-source'
authored = PROJECT/'assets/authored'
out = HQ/'experiments/004-plate-import/generated'
for p in [imported, authored, out/'raw']: p.mkdir(parents=True, exist_ok=True)
preserved = imported/'xfea_head2.blend'
if preserved.exists(): assert sha(preserved) == EXPECTED, 'Do not overwrite a differing intake.'
else: shutil.copy2(SOURCE, preserved)

bpy.ops.wm.open_mainfile(filepath=str(preserved), load_ui=False, use_scripts=False)
plate = bpy.data.objects['submesh_00_LOD_1.010']
rig = plate.parent
assert rig.type == 'ARMATURE' and len(plate.data.vertices) == 1620
assert len(plate.data.shape_keys.key_blocks) == 106
keys = plate.data.shape_keys.key_blocks
saved = {k.name:k.value for k in keys if k.value}
for key in keys: key.value = 0
for modifier in list(plate.modifiers):
    if modifier.type != 'ARMATURE': plate.modifiers.remove(modifier)
for o in [plate, rig]:
    o.animation_data_clear()
    o.hide_set(False); o.hide_viewport=False; o.hide_render=False
for bone in rig.pose.bones: bone.matrix_basis = Matrix.Identity(4)
nonbone = [g.name for g in plate.vertex_groups if g.name not in rig.data.bones]
for name in nonbone: plate.vertex_groups.remove(plate.vertex_groups[name])
plate.data.materials.clear()
mat = bpy.data.materials.new('xfas_plate_reference')
mat.diffuse_color = (0.5,0.4,0.35,1)
plate.data.materials.append(mat)
plate.name = 'submesh_00_LOD_1'
plate.data.name = 'xfas_eye_plate'
rig.name = 'xfas_face_rig'
for o in list(bpy.data.objects):
    if o not in {plate,rig}: bpy.data.objects.remove(o, do_unlink=True)
plate.name = 'submesh_00_LOD_1'
collection = bpy.data.collections.new('XFAS Eye Plate')
bpy.context.scene.collection.children.link(collection)
for o in [rig,plate]:
    for old in list(o.users_collection): old.objects.unlink(o)
    collection.objects.link(o)
for old in list(bpy.data.collections):
    if old != collection: bpy.data.collections.remove(old)
bpy.data.orphans_purge(do_recursive=True)
for o in bpy.context.view_layer.objects: o.select_set(False)
rig.select_set(True);plate.select_set(True)
bpy.context.view_layer.objects.active=plate
bpy.context.view_layer.update()
master = authored/'xfas_eye_plate.blend'
# Regeneration must not silently replace subsequent manual edits to the owned master.
manifest = PROJECT/'data/plate-intake.json'
if master.exists():
    assert manifest.exists() and sha(master) == json.loads(manifest.read_text())['master']['sha256'], 'Owned master edited: preserve it.'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(master), compress=True)
glb = out/'raw/xfas_eye_plate.glb'
bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_selection=True,
    export_animations=False, export_skins=True, export_morph=True, export_morph_normal=True,
    export_morph_tangent=True, export_tangents=True, export_all_influences=True,
    export_try_sparse_sk=False, export_try_omit_sparse_sk=False,
    export_materials='EXPORT', export_extras=True, export_yup=True)
report={
    'source':str(SOURCE),'sourceSha256':EXPECTED,'preserved':str(preserved),
    'blender':bpy.app.version_string,'sourceObject':'submesh_00_LOD_1.010',
    'master':{'path':str(master),'sha256':sha(master),'bytes':master.stat().st_size},
    'glb':{'path':str(glb),'sha256':sha(glb),'bytes':glb.stat().st_size},
    'vertices':len(plate.data.vertices),'polygons':len(plate.data.polygons),
    'morphNames':[k.name for k in list(keys)[1:]],'sourceActiveMorphsReset':saved,
    'nonBoneGroupsRemoved':nonbone,'maxBoneInfluences':max(sum(g.weight>0 for g in v.groups) for v in plate.data.vertices),
    'decisions':['Neutral Basis master retains all 105 relative customization shapes.',
        'Static .011 equals saved shape mix; no nearest-surface deformation transfer needed.',
        'Original Displace removed; no layer offset baked into neutral master.',
        'Source art, rig and shapes reused with provenance; no legacy generator/material matrix retained.'],
    'gameImportVerified':False,
}
assert sha(SOURCE)==EXPECTED and sha(preserved)==EXPECTED
manifest.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'master':report['master'],'glb':report['glb'],'morphs':len(report['morphNames']),'maxBoneInfluences':report['maxBoneInfluences']},indent=2))
