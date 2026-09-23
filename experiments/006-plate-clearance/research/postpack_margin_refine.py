"""Try to widen the two thinnest packed edge margins without touching contact faces."""
import argparse
import json
from pathlib import Path
import sys

import numpy as np

HERE=Path(__file__).resolve().parent
EXP=HERE.parent
sys.path[:0]=[str(Path('D:/Dev/cp2077-modding-hq/experiments/006-plate-clearance/generated/fixed_python')),
              str(EXP.parent/'004-plate-import'),str(EXP)]
from scipy.optimize import minimize
from verify_roundtrip import Glb
from roundtrip_crease import write_glb,sha


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--baseline',type=Path,required=True)
    args=parser.parse_args()
    root=args.baseline
    build=json.loads((root/'build.json').read_text())
    source=np.load(build['candidate'])
    head=Glb(Path(build['head']))
    raw,packed=Glb(Path(build['raw'])),Glb(Path(build['roundtrip']))
    names=head.mesh['extras']['targetNames']
    mapping=np.asarray(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'],dtype=int)
    faces=raw.array(raw.p['indices']).astype(int).reshape(-1,3)
    edges=np.unique(np.sort(np.concatenate((faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]])),axis=1),axis=0)
    hb=head.attr('POSITION').astype(float)
    morph=source['morphChange'].copy()
    updates=[]
    for name,vertex in [('h171_eyes',848),('h101_eyes',807)]:
        target=names.index(name)
        h=hb+head.array(head.p['targets'][target]['POSITION']).astype(float)
        incident=edges[np.isin(edges,[vertex]).any(axis=1)]
        limits=np.minimum(5e-5,.25*np.linalg.norm(h[mapping[incident[:,0]]]-h[mapping[incident[:,1]]],axis=1))
        sign=np.where(incident[:,0]==vertex,1.,-1.)
        base=[]
        for plate in (raw,packed):
            p=plate.attr('POSITION').astype(float)+plate.array(plate.p['targets'][target]['POSITION']).astype(float)
            d=p-h[mapping]
            base.append(d[incident[:,0]]-d[incident[:,1]])
        base=np.asarray(base)
        margin=2e-6
        def slacks(x):
            return (limits[None]-margin-np.linalg.norm(base+sign[None,:,None]*x[None,None,:],axis=2)).ravel()
        opt=minimize(lambda x:.5*x@x,np.zeros(3),jac=lambda x:x,method='SLSQP',
                     constraints=[{'type':'ineq','fun':slacks}],bounds=[(-12e-6,12e-6)]*3,
                     options={'ftol':1e-16,'maxiter':300})
        morph[target,vertex]+=opt.x
        updates.append({'morph':name,'vertex':vertex,'delta':opt.x.tolist(),
                        'status':int(opt.status),'minimumModeledSlack':float(slacks(opt.x).min()),
                        'requestedMargin':margin})
    out=EXP/'generated/morph-aware'
    candidate=out/'postpack-margin-refined.npz'
    np.savez_compressed(candidate,field=source['field'],baseChange=source['baseChange'],
                        morphChange=morph,mapping=mapping)
    raw_path=out/'postpack-margin-refined.glb'
    predicted_path=out/'postpack-margin-refined-predicted.glb'
    write_glb(Path(build['sourceGlb']),raw_path,source['baseChange'],morph)
    write_glb(Path(build['roundtrip']),predicted_path,np.zeros_like(source['baseChange']),
              morph-source['morphChange'])
    report={'sourceResourceBuild':str(root),'sourceCandidateSha256':sha(build['candidate']),
            'updates':updates,'candidate':str(candidate),'candidateSha256':sha(candidate),
            'raw':str(raw_path),'predicted':str(predicted_path)}
    (EXP/'generated/postpack-margin-refine-search.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':main()
