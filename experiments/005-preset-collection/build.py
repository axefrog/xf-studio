"""Compile a local authored collection into an isolated CCXL archive fixture. Never installs.

Uses the built-in expanded eye plate that the Studio host derives from the installed game
(or a developer override directory), fresh resource definitions, and the pure studio
material compiler. Old Eye Artistry code/resources are not build inputs.
"""
import shutil
import hashlib
import argparse
import itertools
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from PIL import Image
from mip_maps import dds_bytes, mip_levels
from archive_inventory import inventory

HERE=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--collection',type=Path,default=HERE/'collection.json')
parser.add_argument('--output',type=Path,help='Fresh isolated intermediate build directory')
parser.add_argument('--plate',type=Path,default=HERE.parent/'004-plate-import/generated/archive/axefrog/appearance_studio/studies',
    help='Directory holding one plate pair: derived xfs_eye_plate.* or a legacy xfas_eye_plate.* override')
parser.add_argument('--wolvenkit',type=Path,default=Path('F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe'))
parser.add_argument('--bun',type=Path,default=Path(shutil.which('bun') or 'bun'))
parser.add_argument('--gamepath',type=Path,default=Path('F:/Games/Cyberpunk 2077'))
parser.add_argument('--app-root',type=Path,help='Studio authoring source root')
parser.add_argument('--work-root',type=Path,help='Working directory for child tools')
parser.add_argument('--bake-script',type=Path,help='Shared TypeScript bake entry; defaults under app root')
parser.add_argument('--no-latest',action='store_true',help='Do not change the experiment fixture pointer')
args=parser.parse_args()
HQ=args.work_root.resolve() if args.work_root else HERE.parents[1]
APP=args.app_root.resolve() if args.app_root else HQ/'projects/xf-studio/authoring'
BAKE=args.bake_script.resolve() if args.bake_script else APP/'tools/bake_collection.ts'
WK=args.wolvenkit.resolve()
BUN=args.bun.resolve()
PLATE=args.plate.resolve()
GAME=args.gamepath.resolve()
OUT=args.output.resolve() if args.output else HERE/'generated'/f'build-{time.time_ns()}'
if OUT.exists(): parser.error(f'Output already exists: {OUT}')
if not args.collection.is_file(): parser.error(f'Collection file is missing: {args.collection}')
if not HQ.is_dir() or not APP.is_dir() or not BAKE.is_file():
    parser.error('Work root, app root and bake script must exist.')
# The host-derived plate uses the xfs_ stem; earlier private inputs keep their historical name.
stems=[stem for stem in ('xfs_eye_plate','xfas_eye_plate') if (PLATE/(stem+'.mesh')).is_file() and (PLATE/(stem+'.morphtarget')).is_file()]
if len(stems)!=1: parser.error(f'Plate directory must contain exactly one mesh/morphtarget pair: {PLATE}')
PLATE_STEM=stems[0]
for label,path in [('WolvenKit',WK),('Bun',BUN)]:
    if not path.is_file(): parser.error(f'{label} is missing: {path}')
if not GAME.is_dir(): parser.error(f'Game path is missing: {GAME}')
for folder in ['logs','baked','source-json','models-json','app-json','cc-json','roundtrip','export','export-dds','input/colour','input/scalar','input/dds-colour','input/dds-scalar','archive','package/archive/pc/mod']:
    (OUT/folder).mkdir(parents=True,exist_ok=True)
steps=[]

def run(name,args,settings=None):
    env=os.environ.copy()
    for key,value in (settings or {}).items(): env['XbmImportArgs__'+key]=str(value).lower() if isinstance(value,bool) else str(value)
    p=subprocess.run([str(a) for a in args],cwd=HQ,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=240)
    log=p.stdout+'\n'+p.stderr;(OUT/'logs'/f'{name}.log').write_text(log,encoding='utf-8')
    counts=re.search(r'Imported (\d+)/(\d+) file\(s\)',log)
    folder_success=name.startswith('import-') and p.returncode==3 and counts and counts[1]==counts[2] and int(counts[1])>0
    if (p.returncode and not folder_success) or re.search(r'\bError\s*\]|Unhandled exception|Traceback \(',log):
        raise RuntimeError(f'{name} failed ({p.returncode}): {log[-3000:]}')
    steps.append({'name':name,'exitCode':p.returncode});print(name,'complete',flush=True)

def load(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,value): p.write_text(json.dumps(value,separators=(',',':'))+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def cname(s): return {'$type':'CName','$storage':'string','$value':s}
def ref(s,soft=False): return {'DepotPath':{'$type':'ResourcePath','$storage':'string','$value':s.replace('/','\\')},'Flags':'Soft' if soft else 'Default'}
def document(root): return {'Header':{'WolvenKitVersion':'8.17.4','WKitJsonVersion':'0.0.9','GameVersion':2310,'DataType':'CR2W'},'Data':{'Version':195,'BuildVersion':0,'RootChunk':root,'EmbeddedFiles':[]}}
handles=itertools.count(10000) # Avoid the preserved mesh/morph buffer handles in the imported plate.
def handle(data): return {'HandleId':str(next(handles)),'Data':data}

run('bake',[BUN,BAKE,args.collection.resolve(),OUT/'baked'])
plan=load(OUT/'baked/plan.json');compiled=load(OUT/'baked/compiled.json')
# The mod's selector label comes from the Studio's mod-branding module through the plan.
if not isinstance(plan.get('selectorLabel'),str) or not plan['selectorLabel'].startswith('XF '):
    raise ValueError('Export plan lacks an XF-branded selectorLabel; rebake with the current Studio.')
depot=plan['depot'];archive=OUT/'archive';modeldir=archive/Path(plan['mesh']).parent
appdir=archive/Path(plan['app']).parent;texturedir=archive/depot/'textures'
for path in [modeldir,appdir,texturedir]: path.mkdir(parents=True,exist_ok=True)
for preset,record in zip(plan['presets'],compiled):
    assert preset['id']==record['id']
    raw_maps={}
    for m in record['maps']:
        colour=m['channel']=='diffuse';raw=OUT/'baked'/m['file'];assert sha(raw)==m['sha256']
        raw_maps[m['channel']]=raw.read_bytes()
        image=Image.frombytes('RGBA' if colour else 'L',(record['size'],record['size']),raw_maps[m['channel']])
        image.save(OUT/'input'/('colour' if colour else 'scalar')/(raw.stem+'.png'))
    colour_levels,rough_levels,metal_levels=mip_levels(raw_maps['diffuse'],raw_maps['roughness'],raw_maps['metalness'],record['size'])
    for channel,levels in [('diffuse',colour_levels),('roughness',rough_levels),('metalness',metal_levels)]:
        group='dds-colour' if channel=='diffuse' else 'dds-scalar'
        (OUT/'input'/group/f"{preset['appearance']}_{channel}.dds").write_bytes(dds_bytes(levels,record['size'],channel))
for group,gamma,texture_group,raw_format,compression in [
    ('dds-colour',True,'TEXG_Generic_Color','TRF_TrueColor','TCM_QualityColor'),
    ('dds-scalar',False,'TEXG_Generic_Grayscale','TRF_Grayscale','TCM_QualityR')]:
    run('import-'+group,[WK,'import',OUT/'input'/group,'-o',texturedir],
        dict(IsGamma=gamma,TextureGroup=texture_group,RawFormat=raw_format,Compression=compression,GenerateMipMaps=False,IsStreamable=True,PremultiplyAlpha=False))

plate=PLATE
run('serialize-owned-models',[WK,'convert','serialize',plate,'-o',OUT/'source-json'])
seed=plan['presets'][0]['appearance']
mesh=load(OUT/'source-json'/(PLATE_STEM+'.mesh.json'));root=mesh['Data']['RootChunk']
root['appearances']=[handle({'$type':'meshMeshAppearance','name':cname(p['appearance']),
    'chunkMaterials':[cname(seed+'@preset')] if i==0 else [],'tags':[]}) for i,p in enumerate(plan['presets'])]
root['materialEntries']=[{'$type':'CMeshMaterialEntry','index':0,'isLocalInstance':1,'name':cname('@preset')}]
values=[{'$type':'rRef:ITexture',name:ref('*'+depot+'/textures/{material}_'+channel+'.xbm',True)} for name,channel in [('DiffuseTexture','diffuse'),('RoughnessTexture','roughness'),('MetalnessTexture','metalness')]]
values += [{'$type':'Float',name:value} for name,value in {'DiffuseAlpha':1,'NormalAlpha':0,'RoughnessMetalnessAlpha':1,'AlphaMaskContrast':0,'SecondaryMaskInfluence':0,'RoughnessScale':1,'MetalnessScale':1,'RoughnessBias':0,'MetalnessBias':0}.items()]
values.append({'$type':'Color','DiffuseColor':{'$type':'Color','Red':255,'Green':255,'Blue':255,'Alpha':255}})
root['localMaterialBuffer']['materials']=[{'$type':'CMaterialInstance','audioTag':cname('None'),'baseMaterial':ref('base/materials/mesh_decal.mt'),'cookingPlatform':'PLATFORM_PC','enableMask':0,'resourceVersion':4,'values':values}]
root['localMaterialBuffer']['rawData']=None;root['localMaterialBuffer']['rawDataHeaders']=[]
write(OUT/'models-json'/(Path(plan['mesh']).name+'.json'),mesh)
morph=load(OUT/'source-json'/(PLATE_STEM+'.morphtarget.json'));mr=morph['Data']['RootChunk']
mr['baseMesh']=ref(plan['mesh']);mr['baseMeshAppearance']=cname(seed)
write(OUT/'models-json'/(Path(plan['morph']).name+'.json'),morph)
run('deserialize-models',[WK,'convert','deserialize',OUT/'models-json','-o',modeldir])

component_id=int.from_bytes(hashlib.sha256(('xfs:component:'+plan['component']).encode('utf-8')).digest()[:8],'little') or 1
component={'$type':'entMorphTargetSkinnedMeshComponent','name':cname(plan['component']),'id':str(component_id),'isEnabled':1,'version':1,
    'autoHideDistance':50,'chunkMask':'9223372036854775807','forceLODLevel':-1,
    'meshAppearance':cname(seed),'morphResource':ref(plan['morph']),
    'parentTransform':handle({'$type':'entHardTransformBinding','bindName':cname('root'),'enabled':1}),
    'skinning':handle({'$type':'entSkinningBinding','bindName':cname('root'),'enabled':1})}
def overrides(items): return [{'$type':'appearanceAppearancePartOverrides','componentsOverrides':items}]
off={'$type':'appearanceAppearanceDefinition','name':cname(plan['offAppearance']),'components':[],
    'partsOverrides':overrides([])}
template={'$type':'appearanceAppearanceDefinition','name':cname(plan['templateAppearance']),'components':[component],
    'partsOverrides':overrides([{'$type':'appearancePartComponentOverrides','componentName':cname(plan['component']),
        'meshAppearance':cname(seed),'chunkMask':'9223372036854775807','visualScale':{'$type':'Vector3','X':1,'Y':1,'Z':1}}]),
    'resolvedDependencies':[ref(plan['morph'],True)],'visualTags':{'$type':'redTagList','tags':[cname('Female')]}}
app=document({'$type':'appearanceAppearanceResource','cookingPlatform':'PLATFORM_PC','appearances':[handle(off),handle(template)]})
write(OUT/'app-json'/(Path(plan['app']).name+'.json'),app)
definitions=[{'$type':'gameuiIndexedAppearanceDefinition','name':cname(plan['offAppearance']),'index':0,'localizedName':'Common-Off'}]
definitions += [{'$type':'gameuiIndexedAppearanceDefinition','name':cname(p['appAppearance']),'index':p['index'],'localizedName':p['name']} for p in plan['presets']]
option={'$type':'gameuiAppearanceInfo','name':cname(plan['selector']),'uiSlot':cname(plan['selector']),
    'localizedName':plan['selectorLabel'],'enabled':1,'hidden':0,'index':311,'defaultIndex':0,
    'editTags':['NewGame','HairDresser','Ripperdoc'],'randomizeCategory':'Makeup','useThumbnails':0,
    'resource':ref(plan['app'],True),'definitions':definitions}
cc=document({'$type':'gameuiCharacterCustomizationInfoResource','cookingPlatform':'PLATFORM_PC',
    'headCustomizationOptions':[handle(option)],'headGroups':[{'$type':'gameuiOptionsGroup','name':cname('character_customization'),'options':[cname(plan['selector'])]}]})
write(OUT/'cc-json'/(Path(plan['customization']).name+'.json'),cc)
run('deserialize-app',[WK,'convert','deserialize',OUT/'app-json','-o',appdir])
run('deserialize-customization',[WK,'convert','deserialize',OUT/'cc-json','-o',appdir])
run('roundtrip',[WK,'convert','serialize',archive,'-o',OUT/'roundtrip'])
run('export-textures',[WK,'export',texturedir,'-o',OUT/'export','--uext','png','--gamepath',GAME])
run('export-texture-mips',[WK,'export',texturedir,'-o',OUT/'export-dds','--uext','dds','--gamepath',GAME])

package=OUT/'package/archive/pc/mod';filename=plan['namespace']
artifacts=inventory(archive,plan)
run('pack',[WK,'pack',archive,'-o',package])
(package/'archive.archive').rename(package/(filename+'.archive'))
xl='customizations:\n  female: '+plan['customization'].replace('/','\\')+'\nresource:\n  scope:\n    player_customization.app:\n      - '+plan['app'].replace('/','\\')+'\n'
(package/(filename+'.archive.xl')).write_text(xl,encoding='utf-8')
write(OUT/'build.json',{'plan':plan,'compiled':compiled,'steps':steps,
    'plateStem':PLATE_STEM,'plateInputs':[{'path':str(p),'sha256':sha(p)} for p in sorted(plate.glob(PLATE_STEM+'.*'))],
    'artifacts':artifacts,
    'archiveSha256':sha(package/(filename+'.archive')),'installed':False,'gameRenderingVerified':False})
print('BUILD',OUT,flush=True)
# Written only after all expected operations succeeded; validator is a separate step.
if not args.no_latest: write(HERE/'latest-build.json',{'build':str(OUT),'validated':False})
