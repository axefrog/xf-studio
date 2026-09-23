"""Check sampled animated clearance against the full game head surface."""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np
from triangles import contacts, self_test

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'004-plate-import'))
from verify_roundtrip import Glb

def main():
    self_test()
    root=Path(json.loads((HERE/'latest-build.json').read_text())['root'])
    build=json.loads((root/'build.json').read_text())
    posed=root/'posed'
    manifest=json.loads((posed/'manifest.json').read_text())
    mapping=json.loads(Path(build['mapping']).read_text())['plateToHeadIndices']
    frames=manifest['frames'];count=len(frames)
    vertices={s['name']:s['vertices'] for s in manifest['surfaces']}
    paths={'head':build['head'],'zero':build['zeroControl'],**{c['name']:c['roundtrip'] for c in build['candidates']}}
    for surface in manifest['surfaces']:
        assert hashlib.sha256(Path(paths[surface['name']]).read_bytes()).hexdigest()==surface['sha256']
    def points(name):return np.fromfile(posed/f'{name}.positions.f64',dtype='<f8').reshape(count,vertices[name],3)
    head=Glb(Path(build['head']))
    triangles=head.array(head.p['indices']).astype(int).reshape(-1,3)
    hp=points('head')
    hn=np.fromfile(posed/'head.normals.f64',dtype='<f8').reshape(hp.shape)
    assert np.max(np.linalg.norm(hp-hp[0],axis=2))>.001, 'Idle fixture is static'
    results=[]
    for name in [n for n in vertices if n!='head']:
        plate=Glb(Path(paths[name]));pt=plate.array(plate.p['indices']).astype(int).reshape(-1,3)
        pp=points(name)
        signed=np.sum((pp-hp[:,mapping])*hn[:,mapping],axis=2)
        rows=[]
        print(f'{name}: worst corresponding-plane clearance {signed.min():.9g}',flush=True)
        for i,frame in enumerate(frames):
            contact=contacts(pp[i][pt],hp[i][triangles])
            contact.pop('pairs') # Detailed face IDs are retained for representative cases by analyze_contacts.py.
            rows.append({'frame':frame,'seconds':frame/30,'minSignedDistance':float(signed[i].min()),
                'verticesBehindHeadPlane':int((signed[i]<-1e-7).sum()),**contact})
            if i%10==0:print(f'{name}: pose {i+1}/{count}, {contact["plateTrianglesInContact"]} contacting plate triangles',flush=True)
        results.append({'name':name,'worstSignedDistance':float(signed.min()),
            'maxContactPairs':max(x['contactPairs'] for x in rows),
            'posesWithContact':sum(x['contactPairs']>0 for x in rows),
            'maxDegeneratePlateTriangles':max(x['degeneratePlateTriangles'] for x in rows),
            'maxDegenerateHeadTriangles':max(x['degenerateHeadTriangles'] for x in rows),'samples':rows})
    report={'build':str(root),'method':'Full eight-influence skinned positions, corresponding vertex planes and full-head triangle contact query',
        'sampling':manifest,'results':results,'triangleTests':'Synthetic transversal, separated, coplanar, touching and degenerate cases; broad phase compared with all-pairs query.',
        'limitations':manifest['limitations']+['Triangle contact tolerances: 1e-9 units for broad-phase/plane distance; degenerate triangles reported separately.',
            'Open surfaces: positive corresponding-plane distances plus no sampled contacts are not a global signed-volume proof.',
            'Offset amount is not release-approved and no game rendering is claimed.']}
    (HERE/'posed-clearance.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps([{k:r[k] for k in ['name','worstSignedDistance','maxContactPairs','posesWithContact']} for r in results],indent=2))

if __name__=='__main__':main()
