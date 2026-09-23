"""Locate residual contacts and distinguish adjacent faces from pre-existing head folds."""
import json
from pathlib import Path
import sys
import numpy as np
from triangles import contacts, intersect_pairs

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'004-plate-import'))
from verify_roundtrip import Glb

def main():
    root=Path(json.loads((HERE/'latest-build.json').read_text())['root'])
    build=json.loads((root/'build.json').read_text())
    manifest=json.loads((root/'posed/manifest.json').read_text())
    result=json.loads((HERE/'posed-clearance.json').read_text())
    mapping=np.array(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'])
    head=Glb(Path(build['head']));ht=head.array(head.p['indices']).astype(int).reshape(-1,3)
    hp=np.fromfile(root/'posed/head.positions.f64',dtype='<f8').reshape(len(manifest['frames']),-1,3)
    reports=[]
    for c in build['candidates']:
        plate=Glb(Path(c['roundtrip']));pt=plate.array(plate.p['indices']).astype(int).reshape(-1,3)
        match={tuple(sorted(t)):i for i,t in enumerate(ht)}
        source_faces=np.array([match[tuple(sorted(t))] for t in mapping[pt]])
        assert len(source_faces)==3010
        pp=np.fromfile(root/f'posed/{c["name"]}.positions.f64',dtype='<f8').reshape(len(manifest['frames']),-1,3)
        samples=next(r for r in result['results'] if r['name']==c['name'])['samples']
        worst=max(samples,key=lambda r:r['contactPairs'])['frame']
        for frame in sorted({0,25,worst}):
            index=manifest['frames'].index(frame)
            hit=contacts(pp[index][pt],hp[index][ht])
            pairs=np.array(hit['pairs'],dtype=int)
            original=ht[source_faces[pairs[:,0]]];other=ht[pairs[:,1]]
            shared=np.array([len(set(a)&set(b)) for a,b in zip(original,other)])
            original_hit=intersect_pairs(hp[index][original],hp[index][other])
            plate_ids=np.unique(pairs[:,0]);points=hp[index][mapping[pt[plate_ids]]].mean(axis=1)
            neutral_centers=head.attr('POSITION')[mapping[pt[plate_ids]]].mean(axis=1)
            normal=np.cross(hp[index][original[:,1]]-hp[index][original[:,0]],hp[index][original[:,2]]-hp[index][original[:,0]])
            normal/=np.linalg.norm(normal,axis=1)[:,None]
            # Signed distance to the original triangle's geometric plane, distinct from the smooth shading normal.
            position=pp[index][pt[pairs[:,0]]]
            distances=np.sum((position-hp[index][original[:,0],None])*normal[:,None],axis=2)
            entry={'candidate':c['name'],'frame':frame,'pairs':len(pairs),'sharedVertices':{str(i):int((shared==i).sum()) for i in range(4)},
                'nonAdjacentAlreadyIntersectInHead':int(((shared==0)&original_hit).sum()),
                'nonAdjacentNewIntersections':int(((shared==0)&~original_hit).sum()),
                'contactRegionNeutralMin':neutral_centers.min(axis=0).tolist(),'contactRegionNeutralMax':neutral_centers.max(axis=0).tolist(),
                'minSignedGeometricPlane':float(distances.min()),'maxSignedGeometricPlane':float(distances.max()),
                'plateTriangles':plate_ids.tolist(),'originalHeadTriangles':source_faces[plate_ids].tolist()}
            reports.append(entry)
            print(json.dumps({k:v for k,v in entry.items() if k not in ['plateTriangles','originalHeadTriangles']}),flush=True)
    (HERE/'contact-analysis.json').write_text(json.dumps({'build':str(root),'reports':reports,
        'limitations':['Includes adjacency and exact source-face mapping; classification is numerical, not a game visibility assessment.']},indent=2)+'\n')

if __name__=='__main__':main()
