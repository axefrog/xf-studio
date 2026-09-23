"""Validate proposed naming/resource cardinality and serialize a fresh material fixture.

This models the documented/source-inspected contract, not the REDengine runtime.
"""
import itertools
import json
from pathlib import Path
import subprocess

HERE=Path(__file__).resolve().parent
OUT=HERE/'generated'
for name in ['json','binary','roundtrip']: (OUT/name).mkdir(parents=True,exist_ok=True)
designs=[f'xfas_e{i:02}' for i in range(1,10)]+[f'xfas_s{i:02}' for i in range(1,12)]
colours=[f'{i:03}' for i in range(49)]
finishes=['matte','regular','shimmer','glitter']
root='axefrog\\appearance_studio'
def resolve(name):
    material,template=name.split('@',1)
    parts=material.split('+')
    assert len(parts)==3 and template=='makeup'
    design,colour,finish=parts
    assert design in designs and colour in colours and finish in finishes
    return f'{root}\\textures\\{design}.xbm',f'{root}\\materials\\palette\\{colour}_{finish}.mi'
selectors=set(); textures=set(); palettes=set()
for layer,design,colour,finish in itertools.product(range(1,5),designs,colours,finishes):
    material=f'{design}+{colour}+{finish}'
    selector=f'xfas_eye_layer{layer}__{material}'
    assert selector.startswith('xfas_') and material.startswith('xfas_')
    assert selector not in selectors
    selectors.add(selector)
    texture,palette=resolve(material+'@makeup')
    textures.add(texture); palettes.add(palette)
assert len(selectors)==15680 and len(textures)==20 and len(palettes)==196
for invalid in ['xfas_e01+000@makeup','xfas_e01+000+matte@wrong','unknown+000+matte@makeup','xfas_e01++matte@makeup']:
    try: resolve(invalid)
    except (AssertionError,ValueError): pass
    else: raise AssertionError('Invalid name was accepted: '+invalid)
def cname(s): return {'$type':'CName','$storage':'string','$value':s}
def ref(s): return {'DepotPath':{'$type':'ResourcePath','$storage':'string','$value':s},'Flags':'Soft'}
paths={'base':f'*{root}\\materials\\palette\\{{material.2}}_{{material.3}}.mi','diffuse':f'*{root}\\textures\\{{material.1}}.xbm'}
fixture={'Header':{'WolvenKitVersion':'8.17.4','WKitJsonVersion':'0.0.9','GameVersion':2310,'DataType':'CR2W'},'Data':{'Version':195,'BuildVersion':0,'RootChunk':{'$type':'CMaterialInstance','audioTag':cname('None'),'baseMaterial':ref(paths['base']),'cookingPlatform':'PLATFORM_PC','enableMask':0,'resourceVersion':4,'values':[{'$type':'rRef:ITexture','DiffuseTexture':ref(paths['diffuse'])}]},'EmbeddedFiles':[]}}
source=OUT/'json/makeup-template.mi.json'
source.write_text(json.dumps(fixture,indent=2)+'\n',encoding='utf-8')
cli='F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe'
logs=[]
for args in [['convert','deserialize',str(source),'-o',str(OUT/'binary')],['convert','serialize',str(OUT/'binary/makeup-template.mi'),'-o',str(OUT/'roundtrip')]]:
    p=subprocess.run([cli,*args],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
    logs.append(p.stdout+p.stderr)
    if p.returncode: raise RuntimeError(logs[-1])
roundtrip=json.loads((OUT/'roundtrip/makeup-template.mi.json').read_text(encoding='utf-8-sig'))['Data']['RootChunk']
assert roundtrip['baseMaterial']==fixture['Data']['RootChunk']['baseMaterial']
assert roundtrip['values']==fixture['Data']['RootChunk']['values']
(OUT/'cli.log').write_text('\n'.join(logs),encoding='utf-8')
report={'result':'passed','selectors':len(selectors),'texture_paths':len(textures),'palette_material_paths':len(palettes),'authored_layer_app_templates':4,'authored_layer_mesh_templates':4,'material_reference_roundtrip':'both dynamic paths and Soft flags retained by WolvenKit 8.17.4','invalid_name_cases':4,'sample':{'selector':'xfas_eye_layer1__xfas_e01+000+matte','chunk_material':'xfas_e01+000+matte@makeup','resolved_paths':resolve('xfas_e01+000+matte@makeup')},'limits':['Resolver is a source-derived model, not executed ArchiveXL code.','Fixture references are intentionally unresolved; this proves CR2W serialization, not asset existence or rendering.','CCXL dynamic scope/appearance propagation, morph integration and blend order require further checks.']}
(HERE/'result.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2))
