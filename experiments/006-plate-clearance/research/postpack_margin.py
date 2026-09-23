"""Measure edge slack and finite separating-axis gap for former failure pairs."""
import argparse
import json
from pathlib import Path
import sys

import numpy as np

HERE=Path(__file__).resolve().parent
EXP=HERE.parent
sys.path[:0]=[str(EXP.parent/'004-plate-import')]
from verify_roundtrip import Glb


def gap(a,b):
    ae=np.roll(a,-1,axis=0)-a
    be=np.roll(b,-1,axis=0)-b
    axes=[np.cross(ae[0],ae[1]),np.cross(be[0],be[1])]
    axes.extend(np.cross(x,y) for x in ae for y in be)
    best=-np.inf
    for axis in axes:
        length=np.linalg.norm(axis)
        if length<1e-14: continue
        axis/=length
        ap,bp=a@axis,b@axis
        best=max(best,float(bp.min()-ap.max()),float(ap.min()-bp.max()))
    return best


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--build',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    build=json.loads((args.build/'build.json').read_text())
    head=Glb(Path(build['head']))
    mapping=np.asarray(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'],dtype=int)
    hf=head.array(head.p['indices']).astype(int).reshape(-1,3)
    hb=head.attr('POSITION').astype(float)
    ht=np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    names=head.mesh['extras']['targetNames']
    saved=[names.index(n) for n in ('h091_eyes','h012_nose','h053_mouth','h054_jaw','h145_ear')]
    source_root=Path(build['sourceBuild'])
    frames=json.loads((source_root/'posed/manifest.json').read_text())['frames']
    hp=np.fromfile(source_root/'posed/head.positions.f64',dtype='<f8').reshape(len(frames),-1,3)
    linear=np.fromfile(source_root/'fixed_linear.f64',dtype='<f8').reshape(len(frames),len(mapping),3,3)
    static_pairs=[(711,2312),(711,2313)]
    posed_pairs={25:[(792,2419),(792,2420),(792,2423),(797,722)],
                 169:[(792,2423)],170:[(793,2421)]}
    stages=[]
    for label,path in [('preImportFloat32',build['raw']),('postWolvenKit',build['roundtrip'])]:
        plate=Glb(Path(path))
        pf=plate.array(plate.p['indices']).astype(int).reshape(-1,3)
        pb=plate.attr('POSITION').astype(float)
        pt=np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])
        edges=np.unique(np.sort(np.concatenate((pf[:,[0,1]],pf[:,[1,2]],pf[:,[2,0]])),axis=1),axis=0)
        rows=[]
        for name,indices in [('Basis',[])]+[(n,[i]) for i,n in enumerate(names)]+[('saved_v',saved)]:
            h=hb+ht[indices].sum(axis=0) if indices else hb
            p=pb+pt[indices].sum(axis=0) if indices else pb
            d=p-h[mapping]
            cap=np.minimum(5e-5,.25*np.linalg.norm(h[mapping[edges[:,0]]]-h[mapping[edges[:,1]]],axis=1))
            slack=cap-np.linalg.norm(d[edges[:,0]]-d[edges[:,1]],axis=1)
            i=int(np.argmin(slack))
            rows.append({'case':name,'edge':edges[i].tolist(),'minimumSlack':float(slack[i])})
        static_h=hb+ht[names.index('h201_eyes')]
        static_p=pb+pt[names.index('h201_eyes')]
        critical=[{'context':'h201_eyes','plateFace':pi,'headFace':hi,
                   'separatingAxisGap':gap(static_p[pf[pi]],static_h[hf[hi]])}
                  for pi,hi in static_pairs]
        residual=pb-hb[mapping]+(pt[saved]-ht[saved][:,mapping]).sum(axis=0)
        for frame,pairs in posed_pairs.items():
            i=frames.index(frame)
            p=hp[i,mapping]+np.einsum('vij,vj->vi',linear[i],residual)
            critical.extend({'context':f'frame-{frame}','plateFace':pi,'headFace':hi,
                             'separatingAxisGap':gap(p[pf[pi]],hp[i,hf[hi]])}
                            for pi,hi in pairs)
        stages.append({'stage':label,'minimumNeighborSlack':min(r['minimumSlack'] for r in rows),
                       'worstNeighborCases':sorted(rows,key=lambda r:r['minimumSlack'])[:8],
                       'criticalPairs':critical,'minimumCriticalPairGap':min(r['separatingAxisGap'] for r in critical)})
    report={'candidateSha256':build['candidateSha256'],'stages':stages,
            'contactGapMeaning':'Maximum interval separation over normalized triangle SAT axes; positive is a finite separation certificate for the named pair, not an exact Euclidean distance.',
            'scope':'Previously failing pairs only; all-pair zero-contact gates are in independent verification.json.'}
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps([{'stage':r['stage'],'minimumNeighborSlack':r['minimumNeighborSlack'],
                       'minimumCriticalPairGap':r['minimumCriticalPairGap']} for r in stages]))


if __name__=='__main__':main()
