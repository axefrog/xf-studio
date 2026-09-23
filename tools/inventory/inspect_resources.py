"""Summarize resource exports and hash provenance without executing legacy code."""
import collections
import hashlib
import json
from pathlib import Path
import struct
import zipfile

HQ=Path(__file__).resolve().parents[2]
out=HQ/'research/eye-artistry/evidence'
out.mkdir(parents=True,exist_ok=True)
legacy=Path('F:/Games/RedModding/Projects/xf-eye-artistry-ccxl')
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def value(v): return v.get('$value',v) if isinstance(v,dict) else v
def walk(obj):
    if isinstance(obj,dict):
        yield obj
        for v in obj.values(): yield from walk(v)
    elif isinstance(obj,list):
        for v in obj: yield from walk(v)

reports=[]
for p in sorted((HQ/'research/consumers').rglob('*.json')):
    if 'json' not in p.parts: continue
    data=read(p); root=data['Data']['RootChunk']
    types=collections.Counter(x.get('$type') for x in walk(root) if '$type' in x)
    dyn=[]
    for node in walk(root):
        for key,val in node.items():
            if key in {'DepotPath','name','meshAppearance'}:
                v=value(val)
                if isinstance(v,str) and (v.startswith(('*','@')) or '{' in v or '__' in v):
                    if v not in dyn: dyn.append(v)
    reports.append({'path':str(p.relative_to(HQ)),'root_type':root['$type'],'types':dict(types),'appearances':len(root.get('appearances',[])),'material_entries':len(root.get('materialEntries',[])),'dynamic_samples':dyn[:16]})
(HQ/'research/consumers/inspection.json').write_text(json.dumps(reports,indent=2)+'\n',encoding='utf-8')

raw=legacy/'source/raw/base/axefrog/xf-eye-artistry-ccxl'
mesh=read(raw/'xfea.mesh.json')['Data']['RootChunk']
ink=read(raw/'xfea.inkcharcustomization.json')['Data']['RootChunk']
appearances=[x for x in walk(ink) if x.get('$type')=='gameuiAppearanceInfo']
switchers=[x for x in walk(ink) if x.get('$type')=='gameuiSwitcherInfo']
counts={'source':str(raw),'mesh_appearances':len(mesh.get('appearances',[])),'mesh_material_entries':len(mesh.get('materialEntries',[])),'mesh_local_materials':len(mesh.get('localMaterialBuffer',{}).get('materials',[])),'ccxl_switchers':len(switchers),'ccxl_appearance_infos':len(appearances),'ccxl_definitions':sum(len(x.get('definitions',[])) for x in appearances),'app_json_files':len(list((raw/'variants').glob('*.app.json'))),'switchers':[{'name':value(x.get('name')),'option_count':len(x.get('options',[])),'indexes':[o.get('index') for o in x.get('options',[])]} for x in switchers]}
(out/'legacy-counts.json').write_text(json.dumps(counts,indent=2)+'\n',encoding='utf-8')

paths=[legacy/'assets/project.yaml',Path('D:/Dev/xf-omega/assets/xf-eye-artistry-ccxl/assets/project.yaml'),legacy/'v-character-model/v2/xfea_head2.blend',legacy/'v-character-model/v2/eye_makeup_plates.glb',Path('F:/Games/RedModding/Projects/xfea backup 2026-01-22.zip'),Path('F:/Games/MO2/mods/XF Eye Artistry CCXL - Dev/archive/pc/mod/xf-eye-artistry-ccxl.archive'),Path('F:/Games/RedModding/Projects/xf-eye-artistry-ccxl.archive')]
hashes=[]
for p in paths:
    with p.open('rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()
    row={'path':str(p),'bytes':p.stat().st_size,'sha256':digest}
    if p.suffix=='.zip':
        with zipfile.ZipFile(p) as z:
            row['members']=[{'name':i.filename,'bytes':i.file_size,'zip_timestamp':i.date_time,'sha256':hashlib.sha256(z.read(i)).hexdigest()} for i in z.infolist()]
    hashes.append(row)
(out/'provenance.json').write_text(json.dumps(hashes,indent=2)+'\n',encoding='utf-8')
b=(legacy/'v-character-model/v2/eye_makeup_plates.glb').read_bytes()
n=struct.unpack_from('<I',b,12)[0]; glb=json.loads(b[20:20+n])
(out/'eye-plates-gltf-metadata.json').write_text(json.dumps(glb,indent=2)+'\n',encoding='utf-8')
print(json.dumps(counts,indent=2))
print(json.dumps(reports,indent=2))
