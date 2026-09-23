"""Build isolated decal material inputs; never install or touch shared CLI settings.

First run the authoring tools bake_finish_study.ts and bake_decal_inputs.ts.
"""
import hashlib
import json
import math
import os
import re
from pathlib import Path
import subprocess
import sys
from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
OUT = HERE / 'generated'
STUDY = HERE.parent / '002-flake-material/generated'
CLI = Path('F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe')
DEPOT = 'axefrog/appearance_studio/studies'
ARCHIVE = OUT / 'archive'
TARGET = ARCHIVE / DEPOT
for path in [TARGET, OUT/'json', OUT/'export', OUT/'mi-json', OUT/'logs']:
    path.mkdir(parents=True, exist_ok=True)

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def run(name, args, options=None):
    if '--verify-only' in sys.argv:
        return
    env = os.environ.copy()
    if options:
        for key,value in options.items(): env['XbmImportArgs__'+key] = str(value).lower() if isinstance(value,bool) else value
    p = subprocess.run([str(CLI), *map(str,args)], env=env, capture_output=True, text=True, timeout=180)
    (OUT/'logs'/f'{name}.log').write_text(p.stdout+p.stderr, encoding='utf-8')
    # CLI has commands which log an error while returning zero. Inspect both.
    counts=re.search(r'Imported (\d+)/(\d+) file\(s\)',p.stdout)
    # This CLI's folder import inverts the success bool (ImportTask.cs).
    # Accept only the observed code plus explicit complete count; inspect every result below.
    folder_success=(name.startswith('import-') and p.returncode==3 and counts and counts[1]==counts[2] and int(counts[1])>0)
    if (p.returncode != 0 and not folder_success) or re.search(r'\[.*Error\s*\]',p.stdout+p.stderr):
        raise RuntimeError(f'{name}: exit {p.returncode}; see its log')
    print(name, 'finished', flush=True)

groups = {
    'normal': dict(TextureGroup='TEXG_Generic_Normal', RawFormat='TRF_TrueColor', Compression='TCM_Normalmap'),
    'scalar': dict(TextureGroup='TEXG_Generic_Grayscale', RawFormat='TRF_Grayscale', Compression='TCM_QualityR'),
    'colour': dict(TextureGroup='TEXG_Generic_Color', RawFormat='TRF_TrueColor', Compression='TCM_QualityColor'),
}
for group in groups: (OUT/'input'/group).mkdir(parents=True, exist_ok=True)
for finish in ['shimmer','glitter']:
    normal=Image.open(STUDY/f'xfas_{finish}_normal.png').convert('RGBA')
    normal.save(OUT/'input/normal'/f'xfas_{finish}_normal.png')
    r,g,b,a=normal.split()
    Image.merge('RGBA',(r,ImageOps.invert(g),b,a)).save(OUT/'input/normal'/f'xfas_{finish}_normal_yflip.png')
    for kind in ['roughness','metalness']:
        Image.open(STUDY/f'xfas_{finish}_{kind}.png').save(OUT/'input/scalar'/f'xfas_{finish}_{kind}.png')
coverage=Image.frombytes('RGBA',(1024,1024),(OUT/'shape.rgba').read_bytes()).getchannel('A')
coverage.save(OUT/'input/scalar/xfas_shape_normal_alpha.png')
alpha=coverage.point([round(math.sqrt(i/255)*255) for i in range(256)])
white=Image.new('L',coverage.size,255)
Image.merge('RGBA',(white,white,white,alpha)).save(OUT/'input/colour/xfas_shape_diffuse.png')

for group,options in groups.items():
    options.update(IsGamma=False, GenerateMipMaps=True, IsStreamable=True, PremultiplyAlpha=False)
    run('import-'+group,['import',OUT/'input'/group,'-o',TARGET],options)
run('serialize-textures',['convert','serialize',TARGET,'-o',OUT/'json'])
run('export-textures',['export',TARGET,'-o',OUT/'export','--uext','png','--gamepath','F:/Games/Cyberpunk 2077'])

def cname(s): return {'$type':'CName','$storage':'string','$value':s}
def ref(s): return {'DepotPath':{'$type':'ResourcePath','$storage':'string','$value':s.replace('/','\\')},'Flags':'Default'}
def texture(key,name): return {'$type':'rRef:ITexture',key:ref(DEPOT+'/'+name+'.xbm')}
def scalar(key,value): return {'$type':'Float',key:value}
variants=[]
for finish in ['matte','regular','shimmer','glitter']:
    for mode in ([0,1] if finish in ['shimmer','glitter'] else [0]):
        for yflip in ([False,True] if finish in ['shimmer','glitter'] else [False]):
            name=f'xfas_{finish}_n{mode}'+('_yflip' if yflip else '')
            values=[texture('DiffuseTexture','xfas_shape_diffuse'),scalar('DiffuseAlpha',1),
                {'$type':'Color','DiffuseColor':{'$type':'Color','Red':144,'Green':87,'Blue':116,'Alpha':255}},
                scalar('AlphaMaskContrast',0),scalar('SecondaryMaskInfluence',0),
                scalar('RoughnessMetalnessAlpha',1),scalar('RoughnessBias',0),scalar('MetalnessBias',0),
                scalar('NormalsBlendingMode',mode),scalar('UseNormalAlphaTex',1),
                texture('NormalAlphaTex','xfas_shape_normal_alpha')]
            if finish in ['shimmer','glitter']:
                values += [texture('NormalTexture',f'xfas_{finish}_normal'+('_yflip' if yflip else '')),
                    scalar('NormalAlpha',1),texture('RoughnessTexture',f'xfas_{finish}_roughness'),
                    texture('MetalnessTexture',f'xfas_{finish}_metalness'),scalar('RoughnessScale',1),scalar('MetalnessScale',1)]
            else:
                values += [scalar('NormalAlpha',0),scalar('MetalnessScale',0),scalar('RoughnessScale',0.88 if finish=='matte' else 0.38)]
            chunk={'$type':'CMaterialInstance','audioTag':cname('None'),'baseMaterial':ref('base/materials/mesh_decal.mt'),
                'cookingPlatform':'PLATFORM_PC','enableMask':0,'resourceVersion':4,'values':values}
            doc={'Header':{'WolvenKitVersion':'8.17.4','WKitJsonVersion':'0.0.9','GameVersion':2310,'DataType':'CR2W'},
                 'Data':{'Version':195,'BuildVersion':0,'RootChunk':chunk,'EmbeddedFiles':[]}}
            (OUT/'mi-json'/f'{name}.mi.json').write_text(json.dumps(doc,indent=2)+'\n')
            variants.append({'name':name,'finish':finish,'normalMode':mode,'greenChannelFlipped':yflip})
run('deserialize-materials',['convert','deserialize',OUT/'mi-json','-o',TARGET])
run('roundtrip-materials',['convert','serialize',TARGET,'-o',OUT/'json'])

textures=[]
for group,options in groups.items():
    for source in sorted((OUT/'input'/group).glob('*.png')):
        name=source.stem
        data=json.loads((OUT/'json'/f'{name}.xbm.json').read_text(encoding='utf-8-sig'))['Data']['RootChunk']
        setup=data['setup']
        assert data['width']==1024 and data['height']==1024
        assert setup['isGamma']==0 and setup['hasMipchain']==1
        assert setup['group']==options['TextureGroup'] and setup['compression']==options['Compression']
        assert (OUT/'export'/f'{name}.png').exists(), name
        textures.append({'name':name,'group':group,'setup':setup,'bytes':(TARGET/f'{name}.xbm').stat().st_size,'sha256':sha(TARGET/f'{name}.xbm')})
for v in variants:
    source=json.loads((OUT/'mi-json'/f"{v['name']}.mi.json").read_text())['Data']['RootChunk']
    result=json.loads((OUT/'json'/f"{v['name']}.mi.json").read_text(encoding='utf-8-sig'))['Data']['RootChunk']
    assert len(source['values'])==len(result['values']) and source['baseMaterial']==result['baseMaterial']
    for a,b in zip(source['values'],result['values']):
        assert a.keys()==b.keys() and a['$type']==b['$type']
        if a['$type']=='Float':
            key=next(k for k in a if k!='$type')
            assert math.isclose(a[key],b[key],rel_tol=1e-6,abs_tol=1e-8)
        else:
            assert a==b
    for value in source['values']:
        for entry in value.values():
            if isinstance(entry,dict) and 'DepotPath' in entry:
                assert (ARCHIVE/entry['DepotPath']['$value'].replace('\\','/')).exists()
report={'textures':textures,'materials':variants,'cliSha256':sha(CLI),'settings':groups,
        'proof':'Metadata, output files, material roundtrip and local material dependencies verified; no runtime proof.',
        'deployment':'None; no mesh, app or CCXL registration is included yet.'}
(HERE/'result.json').write_text(json.dumps(report,indent=2)+'\n')
print(f'Verified {len(textures)} textures and {len(variants)} material instances.',flush=True)
