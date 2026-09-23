"""Stress the weakest packed edge with a nearby h171 input variation."""
import argparse
import json
from pathlib import Path
import sys

import numpy as np

HERE=Path(__file__).resolve().parent
EXP=HERE.parent
sys.path[:0]=[str(EXP.parent/'004-plate-import'),str(EXP)]
from verify_roundtrip import Glb
from roundtrip_crease import write_glb,sha


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--offset-microunits',type=float,default=-.5)
    parser.add_argument('--baseline',type=Path,required=True)
    args=parser.parse_args()
    root=args.baseline
    build=json.loads((root/'build.json').read_text())
    source=np.load(build['candidate'])
    names=Glb(Path(build['head'])).mesh['extras']['targetNames']
    morph=source['morphChange'].copy()
    direction=np.array([-8.777811372039013e-07,-1.4797398625943338e-06,9.948094594651036e-07])
    direction/=np.linalg.norm(direction)
    delta=args.offset_microunits*1e-6*direction
    morph[names.index('h171_eyes'),848]+=delta
    out=EXP/'generated/morph-aware'
    label=('plus' if args.offset_microunits>=0 else 'minus')+str(abs(args.offset_microunits)).replace('.','p')+'um'
    candidate=out/f'postpack-nearby-h171-{label}.npz'
    np.savez_compressed(candidate,field=source['field'],baseChange=source['baseChange'],
                        morphChange=morph,mapping=source['mapping'])
    raw=out/f'postpack-nearby-h171-{label}.glb'
    predicted=out/f'postpack-nearby-h171-{label}-predicted.glb'
    write_glb(Path(build['sourceGlb']),raw,source['baseChange'],morph)
    write_glb(Path(build['roundtrip']),predicted,np.zeros_like(source['baseChange']),
              morph-source['morphChange'])
    report={'sourceCandidateSha256':sha(build['candidate']),'morph':'h171_eyes','vertex':848,
            'delta':delta.tolist(),'candidate':str(candidate),'sha256':sha(candidate),
            'raw':str(raw),'predicted':str(predicted)}
    (EXP/f'generated/postpack-nearby-variant-{label}.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':main()
