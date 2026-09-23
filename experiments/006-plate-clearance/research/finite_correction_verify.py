"""Independent static smoothness incompatibility check; imports no optimizer."""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

HERE=Path(__file__).resolve().parent
EXP=HERE.parent
sys.path.insert(0,str(EXP.parent/'004-plate-import'))
from verify_roundtrip import Glb


def main():
    report=json.loads((HERE/'finite_correction_summary.json').read_text(encoding='utf-8'))
    for item in report['inputs']:
        assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest()==item['sha256']
    root=Path(report['build'])
    build=json.loads((root/'build.json').read_text(encoding='utf-8'))
    source=next(c for c in build['candidates'] if c['name']==report['candidateSource'])
    head=Glb(Path(build['head']))
    plate=Glb(Path(source['roundtrip']))
    mapping=np.array(json.loads(Path(build['mapping']).read_text(encoding='utf-8'))['plateToHeadIndices'])
    faces=plate.array(plate.p['indices']).astype(int).reshape(-1,3)
    edges=np.unique(np.sort(np.concatenate([faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]]]),axis=1),axis=0)
    names=head.mesh['extras']['targetNames']
    assert names==plate.mesh['extras']['targetNames'] and len(names)==105
    saved=[names.index(x) for x in ['h091_eyes','h012_nose','h053_mouth','h054_jaw','h145_ear']]
    cases=[('Basis',[])]+[(name,[i]) for i,name in enumerate(names)]+[('saved_v',saved)]
    vectors=[]
    limits=[]
    for _,indices in cases:
        h=head.attr('POSITION').astype(float).copy()
        p=plate.attr('POSITION').astype(float).copy()
        for i in indices:
            h+=head.array(head.p['targets'][i]['POSITION'])
            p+=plate.array(plate.p['targets'][i]['POSITION'])
        d=p-h[mapping]
        vectors.append(d[edges[:,0]]-d[edges[:,1]])
        hp=h[mapping]
        limits.append(np.minimum(.00005,.25*np.linalg.norm(hp[edges[:,0]]-hp[edges[:,1]],axis=1)))
    vectors=np.stack(vectors)
    limits=np.stack(limits)
    incompatible=0
    worst=(-float('inf'),None,None,None)
    for e in range(len(edges)):
        # A common base-position change adds the same vector to every case.
        # Pairwise distances therefore remain unchanged by *any* such field.
        distance=np.linalg.norm(vectors[:,e,None,:]-vectors[None,:,e,:],axis=2)
        separation=distance-limits[:,e,None]-limits[None,:,e]
        np.fill_diagonal(separation,-np.inf)
        a,b=np.unravel_index(np.argmax(separation),separation.shape)
        value=float(separation[a,b])
        if value>1e-10:
            incompatible+=1
            if value>worst[0]:
                worst=(value,e,a,b)
    claim=report['staticNeighborPairwiseNecessaryCondition']
    assert incompatible==claim['certifiedIncompatibleEdges']
    value,e,a,b=worst
    witness=claim['worstCertificate']
    assert e==witness['edgeIndex']
    assert edges[e].tolist()==witness['plateVertices']
    assert mapping[edges[e]].tolist()==witness['headVertices']
    assert [cases[a][0],cases[b][0]]==witness['cases']
    assert abs(value-witness['excessDistance'])<1e-12
    assert abs(float(np.linalg.norm(vectors[a,e]-vectors[b,e]))-witness['caseVectorDistance'])<1e-12
    assert abs(float(limits[a,e]+limits[b,e])-witness['sumAllowedRadii'])<1e-12
    assert not any(m=='scipy.optimize' or m.startswith('scipy.optimize.') for m in sys.modules)
    print(json.dumps({'passed':True,'optimizerImported':False,'cases':len(cases),'edges':len(edges),
        'certifiedIncompatibleEdges':incompatible,'worstExcess':value,'witness':witness}),flush=True)


if __name__=='__main__':main()
