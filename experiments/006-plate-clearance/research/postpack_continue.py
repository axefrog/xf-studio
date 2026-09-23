"""One bounded continuation around the serialized h091 crease failure."""
import argparse
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
sys.path[:0] = [str(Path('D:/Dev/cp2077-modding-hq/experiments/006-plate-clearance/generated/fixed_python')),
                str(EXP.parent / '004-plate-import'), str(EXP)]
from scipy.optimize import minimize
from verify_roundtrip import Glb
from roundtrip_crease import write_glb, sha


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--baseline',type=Path,required=True)
    args=parser.parse_args()
    baseline=args.baseline
    build = json.loads((baseline/'build.json').read_text())
    prior = np.load(build['candidate'])
    head = Glb(Path(build['head']))
    names = head.mesh['extras']['targetNames']
    target = names.index('h091_eyes')
    saved = [names.index(n) for n in ('h091_eyes','h012_nose','h053_mouth','h054_jaw','h145_ear')]
    mapping = np.asarray(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'],dtype=int)
    morph = prior['morphChange'].copy()
    morph[target,321,1] += 3e-6
    base = prior['baseChange'].copy()
    field = prior['field'].copy()
    out = EXP/'generated/morph-aware'
    raw0 = out/'postpack-continuation-initial.glb'
    predicted0 = out/'postpack-continuation-initial-predicted.glb'
    write_glb(Path(build['sourceGlb']),raw0,base,morph)
    write_glb(Path(build['roundtrip']),predicted0,np.zeros_like(base),morph-prior['morphChange'])
    stages = [Glb(raw0),Glb(predicted0)]
    faces = stages[0].array(stages[0].p['indices']).astype(int).reshape(-1,3)
    edges = np.unique(np.sort(np.concatenate((faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]])),axis=1),axis=0)
    local = np.asarray([109,121])
    incident = edges[np.isin(edges,local).any(axis=1)]
    lookup = {int(v):i for i,v in enumerate(local)}
    signs = np.zeros((len(incident),len(local)))
    for j,(a,b) in enumerate(incident):
        if int(a) in lookup: signs[j,lookup[int(a)]] += 1
        if int(b) in lookup: signs[j,lookup[int(b)]] -= 1
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    differences, limits = [],[]
    for indices in ([target],saved):
        h = hb+ht[indices].sum(axis=0)
        cap = np.minimum(5e-5,.25*np.linalg.norm(h[mapping[incident[:,0]]]-h[mapping[incident[:,1]]],axis=1))
        for plate in stages:
            pb = plate.attr('POSITION').astype(float)
            pt = np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])
            d = pb+pt[indices].sum(axis=0)-h[mapping]
            differences.append(d[incident[:,0]]-d[incident[:,1]])
            limits.append(cap)
    differences,limits=np.asarray(differences),np.asarray(limits)
    margin=2e-6
    def slack(x):
        delta=signs@x.reshape(len(local),3)
        return (limits-margin-np.linalg.norm(differences+delta[None],axis=2)).ravel()
    result=minimize(lambda x:.5*x@x,np.zeros(len(local)*3),jac=lambda x:x,
                    method='SLSQP',constraints=[{'type':'ineq','fun':slack}],
                    bounds=[(-12e-6,12e-6)]*(len(local)*3),
                    options={'ftol':1e-16,'maxiter':300})
    change=result.x.reshape(len(local),3)
    morph[target,local]+=change
    # The previously imported h171 record has only 0.012 microunit of global
    # predicted edge slack. Fit its two non-contact endpoints to the same
    # explicit margin while retaining all incident edges in both stages.
    write_glb(Path(build['sourceGlb']),raw0,base,morph)
    write_glb(Path(build['roundtrip']),predicted0,np.zeros_like(base),morph-prior['morphChange'])
    stages=[Glb(raw0),Glb(predicted0)]
    h171=names.index('h171_eyes')
    hlocal=np.asarray([31,848])
    hincident=edges[np.isin(edges,hlocal).any(axis=1)]
    hlookup={int(v):i for i,v in enumerate(hlocal)}
    hsigns=np.zeros((len(hincident),len(hlocal)))
    for j,(a,b) in enumerate(hincident):
        if int(a) in hlookup: hsigns[j,hlookup[int(a)]]+=1
        if int(b) in hlookup: hsigns[j,hlookup[int(b)]]-=1
    h=hb+ht[h171]
    hcap=np.minimum(5e-5,.25*np.linalg.norm(h[mapping[hincident[:,0]]]-h[mapping[hincident[:,1]]],axis=1))
    hdifference=[]
    for plate in stages:
        pb=plate.attr('POSITION').astype(float)
        pt=plate.array(plate.p['targets'][h171]['POSITION']).astype(float)
        d=pb+pt-h[mapping]
        hdifference.append(d[hincident[:,0]]-d[hincident[:,1]])
    hdifference=np.asarray(hdifference)
    def hslack(x):
        delta=hsigns@x.reshape(len(hlocal),3)
        return (hcap[None]-2e-6-np.linalg.norm(hdifference+delta[None],axis=2)).ravel()
    hresult=minimize(lambda x:.5*x@x,np.zeros(len(hlocal)*3),jac=lambda x:x,
                     method='SLSQP',constraints=[{'type':'ineq','fun':hslack}],
                     bounds=[(-12e-6,12e-6)]*(len(hlocal)*3),
                     options={'ftol':1e-16,'maxiter':300})
    hchange=hresult.x.reshape(len(hlocal),3)
    morph[h171,hlocal]+=hchange
    candidate=out/'postpack-continuation.npz'
    np.savez_compressed(candidate,field=field,baseChange=base,morphChange=morph,mapping=mapping)
    raw=out/'postpack-continuation.glb'
    predicted=out/'postpack-continuation-predicted.glb'
    write_glb(Path(build['sourceGlb']),raw,base,morph)
    write_glb(Path(build['roundtrip']),predicted,np.zeros_like(base),morph-prior['morphChange'])
    report={'sourceResourceBuild':str(baseline),'sourceResourceCandidateSha256':sha(build['candidate']),
            'face797Correction':{'morph':'h091_eyes','vertex':321,'deltaY':3e-6},
            'edgeCorrection':{'vertices':local.tolist(),'deltas':change.tolist(),
                              'solverStatus':int(result.status),'minimumModeledSlack':float(slack(result.x).min()),
                              'requestedMargin':margin},
            'h171EdgeCorrection':{'vertices':hlocal.tolist(),'deltas':hchange.tolist(),
                                  'solverStatus':int(hresult.status),'minimumModeledSlack':float(hslack(hresult.x).min()),
                                  'requestedMargin':2e-6},
            'candidate':str(candidate),'candidateSha256':sha(candidate),
            'rawGlb':str(raw),'predictedGlb':str(predicted)}
    (EXP/'generated/postpack-continuation-search.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':main()
