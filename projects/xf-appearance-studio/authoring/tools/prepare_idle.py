"""Prepare local, nonredistributed UI idle and rig ancestry from WolvenKit exports."""
import hashlib
import json
import struct
from pathlib import Path

APP=Path(__file__).resolve().parents[1]
HQ=APP.parents[2]
RAW=HQ/'research/consumers/cc-idle/raw'
def read(path):
    b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0]
    return json.loads(b[20:20+n]),b[20+n:]
body,tail=read(RAW/'idle-body.glb')
face,_=read(RAW/'idle-face.glb')
parents={c:i for i,n in enumerate(face['nodes']) for c in n.get('children',[])}
ancestry={n['name']:face['nodes'][parents[i]]['name'] if i in parents else None for i,n in enumerate(face['nodes'])}
face_extra=face['animations'][0]['extras']
tracks=face['skins'][0]['extras']['trackNames']
ranges={}
for key in face_extra['trackKeys']:
    name=tracks[key['trackIndex']]
    lo,hi=ranges.get(name,(key['value'],key['value']))
    ranges[name]=(min(lo,key['value']),max(hi,key['value']))
variable={k:v for k,v in ranges.items() if v[1]-v[0]>1e-5}
# Float facial-controller tracks are not GLTF joint animation; retain only metadata in the browser.
for a in body['animations']:a['extras']={'sourceClip':a['name'],'animationType':a['extras']['animationType']}
encoded=json.dumps(body,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
payload=struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+tail
out=APP/'public/assets';out.mkdir(parents=True,exist_ok=True)
(out/'cc-idle-body.glb').write_bytes(payload)
(out/'cc-idle-binding.json').write_text(json.dumps({'clip':'ui_closeup_shot','ancestry':ancestry,
    'facialClip':'ui_closeup_shot_face','facialAsset':'cc-idle-face.glb'})+'\n')
report={'clip':'ui_closeup_shot','bodyResource':'base\\animations\\ui\\female\\ui_female.anims',
    'faceResource':'base\\animations\\ui\\female\\ui_female_face.anims',
    'facialVariableControlCount':len(variable),'facialVariableControls':variable,
    'sourceHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [RAW/'idle-body.glb',RAW/'idle-face.glb']},
    'outputBytes':len(payload),'outputSha256':hashlib.sha256(payload).hexdigest(),
    'limitations':['Body motion is decoded game data; runtime animation graph selection remains to be traced.',
        'Facial float tracks are baked separately with the external IO Suite solver; see idle-face-bake.json.',
        'Only female close-up idle is prepared. Game/mod assets remain local.']}
(APP/'evidence/idle-intake.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='facialVariableControls'},indent=2))
