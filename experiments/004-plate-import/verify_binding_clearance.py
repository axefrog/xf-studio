"""Check bind transforms and corresponding-surface clearance, without game rendering."""
import json
import numpy as np
from verify_roundtrip import Glb, ROOT

def matrix(node):
    if 'matrix' in node:return np.array(node['matrix']).reshape(4,4).T
    x,y,z,w=node.get('rotation',[0,0,0,1])
    out=np.eye(4)
    out[:3,:3]=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
        [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
        [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])@np.diag(node.get('scale',[1,1,1]))
    out[:3,3]=node.get('translation',[0,0,0])
    return out

def transforms(glb):
    parents={c:i for i,n in enumerate(glb.doc['nodes']) for c in n.get('children',[])}
    cache={}
    def world(i):
        if i not in cache:cache[i]=(world(parents[i]) if i in parents else np.eye(4))@matrix(glb.doc['nodes'][i])
        return cache[i]
    skin=glb.doc['skins'][0]
    joint=np.array([world(i) for i in skin['joints']])
    inverse=glb.array(skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
    return joint,inverse

def main():
    source=Glb(ROOT/'generated/raw/xfas_eye_plate.glb')
    output=Glb(ROOT/'generated/roundtrip/xfas_eye_plate.glb.glb')
    head=Glb(ROOT/'generated/roundtrip/vanilla_head.glb')
    sj,si=transforms(source);oj,oi=transforms(output)
    reorder=[output.bones().index(n) for n in source.bones()]
    bind={'maxJointWorldElementError':float(abs(sj-oj[reorder]).max()),
        'maxInverseBindElementError':float(abs(si-oi[reorder]).max()),
        'sourceMaxRestIdentityError':float(abs(sj@si-np.eye(4)).max()),
        'outputMaxRestIdentityError':float(abs(oj@oi-np.eye(4)).max()),
        'note':'Exported orphan rig hierarchy differs; equivalent world/bind transforms are checked by bone name.'}
    assert max(v for v in bind.values() if isinstance(v,float))<1e-6
    mapping=json.loads((ROOT/'head-shading-transfer.json').read_text())['plateToHeadIndices']
    names=source.mesh['extras']['targetNames']
    cases=[('Basis',{})]+[(n,{n:1}) for n in names]
    cases.append(('saved_v',dict.fromkeys(['h091_eyes','h012_nose','h053_mouth','h054_jaw','h145_ear'],1)))
    reports=[]
    for name,weights in cases:
        pp=output.attr('POSITION').copy();hp=head.attr('POSITION')[mapping].copy();hn=head.attr('NORMAL')[mapping].copy()
        for key,weight in weights.items():
            i=names.index(key)
            pp+=output.array(output.p['targets'][i]['POSITION'])*weight
            hp+=head.array(head.p['targets'][i]['POSITION'])[mapping]*weight
            hn+=head.array(head.p['targets'][i]['NORMAL'])[mapping]*weight
        hn/=np.linalg.norm(hn,axis=1)[:,None]
        signed=np.sum((pp-hp)*hn,axis=1)
        reports.append({'case':name,'minSignedDistance':float(signed.min()),'maxSignedDistance':float(signed.max()),
                        'maxVertexDistance':float(np.linalg.norm(pp-hp,axis=1).max()),
                        'verticesBehindCorrespondingHeadPlane':int((signed < -1e-7).sum())})
    report={'bindTransforms':bind,'zeroOffsetClearance':reports,
        'worstSignedDistance':min(r['minSignedDistance'] for r in reports),
        'conclusion':'Neutral cut surface has no intentional clearance. Resource quantization moves some vertices slightly behind the corresponding head plane. Controlled offset variants need separate evidence.',
        'limitations':['Corresponding vertex tangent planes are not full triangle intersection or signed-distance tests.',
            'Single customization shapes plus one saved-V combination do not cover every allowed combination.',
            'No posed eyelid/animation geometry or game draw ordering is tested.']}
    (ROOT/'binding-clearance.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='zeroOffsetClearance'},indent=2))

if __name__=='__main__':main()
