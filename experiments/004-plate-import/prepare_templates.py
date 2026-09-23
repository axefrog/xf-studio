"""Reduce freshly serialized game resource structure before importing owned geometry.
No old generator is run. No material-matrix entries survive this transformation.
"""
import hashlib
import json
import struct
from pathlib import Path

HERE=Path(__file__).resolve().parent
OUT=HERE/'generated'
GAME_JSON=HERE.parents[1]/'research/consumers/eye-plate/json'
DEPOT='axefrog\\appearance_studio\\studies\\xfas_eye_plate.mesh'
def cname(value): return {'$type':'CName','$storage':'string','$value':value}
def ref(value): return {'DepotPath':{'$type':'ResourcePath','$storage':'string','$value':value},'Flags':'Default'}
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
for p in ['templates','archive/axefrog/appearance_studio/studies','roundtrip','logs']: (OUT/p).mkdir(parents=True,exist_ok=True)
b=(OUT/'raw/xfas_eye_plate.glb').read_bytes();length=struct.unpack_from('<I',b,12)[0]
gltf=json.loads(b[20:20+length]);names=gltf['meshes'][0]['extras']['targetNames']
report={'source':'Fresh vanilla full-head resource scaffolding; geometry replaced by the owned plate import','resources':[]}
for kind in ['mesh','morphtarget']:
    source=GAME_JSON/('h0_000_pwa_c__basehead.mesh.json' if kind=='mesh' else 'h0_000_pwa__morphs.morphtarget.json')
    document=json.loads(source.read_text(encoding='utf-8-sig'));root=document['Data']['RootChunk']
    if kind=='mesh':
        original_entries=len(root['materialEntries'])
        root['appearances']=[{'HandleId':'0','Data':{'$type':'meshMeshAppearance','name':cname('xfas_plate_reference'),'chunkMaterials':[cname('xfas_plate_reference')],'tags':[]}}]
        root['materialEntries']=[{'$type':'CMeshMaterialEntry','index':0,'isLocalInstance':1,'name':cname('xfas_plate_reference')}]
        root['localMaterialBuffer']['materials']=[{'$type':'CMaterialInstance','audioTag':cname('None'),
            'baseMaterial':ref('base\\materials\\mesh_decal.mt'),'cookingPlatform':'PLATFORM_PC','enableMask':1,
            'metadata':None,'resourceVersion':4,'values':[]}]
        root['localMaterialBuffer']['rawData']=None
        root['localMaterialBuffer']['rawDataHeaders']=[]
        root['parameters']=[]
        root['inplaceResources']=[]
        # Stale parallel material arrays may otherwise retain the original catalogue.
        for key in ['externalMaterials','preloadExternalMaterials','preloadLocalMaterialInstances','localMaterialInstances']:
            if key in root: root[key]=[]
        bones=[v['$value'] for v in root['boneNames']]
        incoming=[gltf['nodes'][i]['name'] for i in gltf['skins'][0]['joints']]
        assert set(bones)==set(incoming), 'Base resource and owned GLB must have identical bone-name sets.'
        extra={'removedMaterialEntries':original_entries-1,'boneCount':len(bones)}
    else:
        targets={t['name']['$value']+'_'+t['regionName']['$value']:t for t in root['targets']}
        assert set(targets)==set(names) and len(names)==105
        root['targets']=[targets[name] for name in names]
        root['baseMesh']=ref(DEPOT)
        root['baseMeshAppearance']=cname('xfas_plate_reference')
        # Cosmetic plate needs geometric morphs, not the full head's skin-normal atlas deltas.
        root['baseTexture']=ref('engine\\textures\\editor\\normal.xbm')
        root['blob']['Data']['textureDiffsBuffer']=None
        root['blob']['Data']['header']['targetTextureDiffsData']=[{
            '$type':'rendRenderMorphTargetMeshBlobTextureData',
            **{k:{'Elements':[]} for k in ['targetDiffOffset','targetDiffScale','targetDiffsDataOffset','targetDiffsDataSize','targetDiffsMipLevelCounts','targetDiffsWidth']}
        } for _ in names]
        extra={'morphCount':len(names),'targetOrderMatchesGLB':True}
    target=OUT/'templates'/f'xfas_eye_plate.{kind}.json'
    target.write_text(json.dumps(document,separators=(',',':')))
    report['resources'].append({'source':str(source),'sourceSha256':sha(source),'output':str(target),'sha256':sha(target),'bytes':target.stat().st_size,**extra})
(HERE/'template-preparation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
