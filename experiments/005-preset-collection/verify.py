"""Verify actual converted resources, decoded texture pixels and archive payloads.

Dynamic expansion checks model inspected ArchiveXL rules; they do not run the game.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
WK=Path('F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe')
def load(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
out=Path(load(HERE/'latest-build.json')['build'])
build=load(out/'build.json');plan=build['plan'];rt=out/'roundtrip';archive=out/'archive'
def root(name): return load(rt/name)['Data']['RootChunk']
def value(x): return x['$value']
def dep(x): return value(x['DepotPath']).replace('\\','/')
def normalized(x):
    if isinstance(x,dict): return {k:normalized(v) for k,v in x.items() if k not in ['HandleId','BufferId','HandleRefId']}
    if isinstance(x,list): return [normalized(v) for v in x]
    return x
def stats(x): return {'mean':float(x.mean()),'p95':float(np.percentile(x,95)),'max':float(x.max())}
def pixels(p): return np.asarray(Image.open(p).convert('RGBA'),dtype=np.float64)/255
def linear(x): return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)

mesh=root('xfas_eye_plate.mesh.json');morph=root('xfas_eye_plate.morphtarget.json');app=root('xfas_collection.app.json');cc=root('xfas_collection.inkcharcustomization.json')
source_mesh=load(out/'source-json/xfas_eye_plate.mesh.json')['Data']['RootChunk']
source_morph=load(out/'source-json/xfas_eye_plate.morphtarget.json')['Data']['RootChunk']
for field in ['renderResourceBlob','boneNames','boneRigMatrices','boundingBox']:
    assert field in mesh and normalized(mesh[field])==normalized(source_mesh[field]),field
for field in ['blob','targets']:
    assert normalized(morph[field])==normalized(source_morph[field]),field
assert dep(morph['baseMesh'])==plan['mesh']
assert len(morph['targets'])==105 and len(mesh['materialEntries'])==1
assert value(mesh['materialEntries'][0]['name'])=='@preset'
materials=mesh['localMaterialBuffer']['materials'];assert len(materials)==1
material=materials[0];assert dep(material['baseMaterial'])=='base/materials/mesh_decal.mt'
params={key:v for item in material['values'] for key,v in item.items() if key!='$type'}
assert params['NormalAlpha']==0 and params['AlphaMaskContrast']==0 and params['SecondaryMaskInfluence']==0
assert params['DiffuseAlpha']==params['RoughnessMetalnessAlpha']==params['RoughnessScale']==params['MetalnessScale']==1
assert params['DiffuseColor']=={'$type':'Color','Red':255,'Green':255,'Blue':255,'Alpha':255}
assert params['RoughnessBias']==params['MetalnessBias']==0
assert [value(a['Data']['name']) for a in mesh['appearances']]==[p['appearance'] for p in plan['presets']]
seed=mesh['appearances'][0]['Data'];assert [value(x) for x in seed['chunkMaterials']]==[plan['presets'][0]['appearance']+'@preset']
assert all(not a['Data']['chunkMaterials'] for a in mesh['appearances'][1:])
off,template=[a['Data'] for a in app['appearances']]
assert value(off['name'])==plan['offAppearance'] and not off['components']
assert off['partsOverrides'][0]['componentsOverrides']==[]
assert value(template['name'])==plan['templateAppearance'] and len(template['components'])==1
component=template['components'][0];assert component['$type']=='entMorphTargetSkinnedMeshComponent'
assert value(component['name'])==plan['component'] and dep(component['morphResource'])==plan['morph']
assert value(component['meshAppearance'])==plan['presets'][0]['appearance']
assert template['compiledData']['Data']['Chunks'], 'Component was not compiled into its binary package'
override=template['partsOverrides'][0]['componentsOverrides'];assert len(override)==1 and value(override[0]['componentName'])==plan['component']
# Handles may serialize as references after the compiled package is expanded.
handle_data={}
def collect(x):
    if isinstance(x,dict):
        if 'HandleId' in x: handle_data[x['HandleId']]=x['Data']
        for v in x.values(): collect(v)
    elif isinstance(x,list):
        for v in x: collect(v)
collect(app)
for field,kind in [('parentTransform','entHardTransformBinding'),('skinning','entSkinningBinding')]:
    h=component[field];binding=h.get('Data') or handle_data[h['HandleRefId']]
    assert binding['$type']==kind and value(binding['bindName'])=='root' and binding['enabled']==1
orientation=component['localTransform']['Orientation'];assert [orientation[k] for k in ['i','j','k','r']]==[0,0,0,1]
assert component['isEnabled']==1
assert len(cc['headCustomizationOptions'])==1
option=cc['headCustomizationOptions'][0]['Data']
assert option['$type']=='gameuiAppearanceInfo' and option['enabled']==1 and option['hidden']==0
assert value(option['name'])==plan['selector']==value(option['uiSlot']) and dep(option['resource'])==plan['app']
assert len(option['definitions'])==len(plan['presets'])+1
assert value(option['definitions'][0]['name'])==plan['offAppearance'] and option['defaultIndex']==0
assert [value(x) for x in cc['headGroups'][0]['options']]==[plan['selector']]

resolved=[];pixel_results=[]
for preset,definition,record in zip(plan['presets'],option['definitions'][1:],build['compiled']):
    assert value(definition['name'])==preset['appAppearance'] and definition['index']==preset['index']
    assert definition['localizedName']==preset['name']
    # Source-derived expansion model: app suffix -> mesh stub -> shared @preset template.
    suffix=value(definition['name']).rsplit('__',1)[1];assert suffix==preset['appearance']
    assert suffix.startswith('xfas_')
    expanded={}
    for parameter,channel in [('DiffuseTexture','diffuse'),('RoughnessTexture','roughness'),('MetalnessTexture','metalness')]:
        reference=params[parameter];assert reference['Flags']=='Soft'
        pattern=dep(reference);assert pattern.startswith('*')
        path=pattern[1:].replace('{material}',suffix)
        assert path==preset['textures'][channel] and (archive/path).is_file()
        expanded[channel]=path
        metadata=root(Path(path).name+'.json');setup=metadata['setup']
        assert metadata['width']==metadata['height']==record['size']
        assert setup['hasMipchain']==1 and setup['isGamma']==int(channel=='diffuse')
        assert setup['compression']==('TCM_QualityColor' if channel=='diffuse' else 'TCM_QualityR')
    resolved.append({'appearance':preset['appAppearance'],'chunkMaterial':suffix+'@preset','textures':expanded})
    name=preset['appearance'];source=pixels(out/'input/colour'/f'{name}_diffuse.png');decoded=pixels(out/'export'/f'{name}_diffuse.png')
    coverage=source[:,:,3]**2;actual_coverage=decoded[:,:,3]**2;active=coverage>1e-5
    expected=np.sqrt(linear(source[:,:,:3]))*coverage[:,:,None]
    actual=np.sqrt(linear(decoded[:,:,:3]))*actual_coverage[:,:,None]
    colour=stats(abs(expected-actual)[active]);alpha=stats(abs(coverage-actual_coverage)[active])
    assert colour['mean']<.015 and colour['p95']<.05 and alpha['p95']<.05,(colour,alpha)
    assert abs(expected-actual).mean()<abs(expected-actual[::-1]).mean(),'Unexpected texture row orientation'
    scalar={}
    for channel in ['roughness','metalness']:
        original=pixels(out/'input/scalar'/f'{name}_{channel}.png')[:,:,0]
        result=pixels(out/'export'/f'{name}_{channel}.png')[:,:,0]
        error=stats(abs(original*coverage-result*actual_coverage)[active]);assert error['p95']<.05,error
        scalar[channel]=error
    pixel_results.append({'preset':preset['name'],'coveredTexels':int(active.sum()),'coverageError':alpha,'premultipliedEncodedColourError':colour,'premultipliedSurfaceError':scalar})

package=out/'package/archive/pc/mod';packed=package/(plan['namespace']+'.archive')
assert sha(packed)==build['archiveSha256']
xl=(package/(plan['namespace']+'.archive.xl')).read_text()
assert plan['customization'].replace('/','\\') in xl and plan['app'].replace('/','\\') in xl
unpacked=out/'unpacked';unpacked.mkdir(exist_ok=True)
p=subprocess.run([str(WK),'unbundle',str(packed),'-o',str(unpacked)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
(out/'logs/unpack-verify.log').write_text(p.stdout+p.stderr,encoding='utf-8')
assert p.returncode==0 and 'Error' not in p.stdout,p.stdout[-2000:]
files=list(unpacked.rglob('*'));files=[x for x in files if x.is_file()]
assert len(files)==len(build['artifacts']),(len(files),len(build['artifacts']))
for artifact in build['artifacts']:
    result=unpacked/artifact['path']
    assert result.is_file(),str(result)
    assert sha(result)==artifact['sha256']
report={'build':str(out),'presetCount':len(plan['presets']),'selectorCount':1,'selectorOptionCount':len(option['definitions']),
    'appDefinitions':2,'compiledComponentTemplates':1,'meshAppearances':len(mesh['appearances']),'materialTemplates':len(materials),
    'textureCount':len(plan['presets'])*3,'archiveBytes':packed.stat().st_size,'archiveSha256':sha(packed),
    'unpackedFilesVerified':len(files),'preservedMorphs':105,'modelBuffersUnchanged':True,
    'resolvedDynamicPaths':resolved,'decodedPixelChecks':pixel_results,'installed':False,'gameRenderingVerified':False,
    'limits':['Dynamic resolution is a source-derived model, not executed ArchiveXL.',
        'A/B/Off component clearing and save persistence need runtime evidence.',
        'Base-mip compression checked; lower mip filtering not yet compared.',
        'Zero-offset plate control; outward clearance candidate still required.',
        'Flat matte/satin/metallic adapter only; other optical finishes remain required work.']}
(HERE/'result.json').write_text(json.dumps(report,indent=2)+'\n')
(HERE/'latest-build.json').write_text(json.dumps({'build':str(out),'validated':True},indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ['resolvedDynamicPaths','decodedPixelChecks','limits']},indent=2))
