"""Sweep narrow h091 crease corrections at the known packed failure frames."""
import json
import argparse
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
sys.path[:0] = [str(EXP.parent / '004-plate-import'), str(EXP)]
from verify_roundtrip import Glb
from verify_crease_roundtrip import new_pairs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    args = parser.parse_args()
    baseline = args.baseline
    build = json.loads((baseline / 'build.json').read_text())
    head = Glb(Path(build['head']))
    mapping = np.asarray(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'], dtype=int)
    raw = Glb(Path(build['raw']))
    packed = Glb(Path(build['roundtrip']))
    names = head.mesh['extras']['targetNames']
    index = names.index('h091_eyes')
    saved = [names.index(n) for n in ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')]
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    pf = raw.array(raw.p['indices']).astype(int).reshape(-1, 3)
    lookup = {tuple(sorted(face)): i for i, face in enumerate(hf)}
    source_faces = np.asarray([lookup[tuple(sorted(face))] for face in mapping[pf]])
    edges = np.unique(np.sort(np.concatenate((pf[:, [0, 1]], pf[:, [1, 2]], pf[:, [2, 0]])), axis=1), axis=0)
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    root = Path(build['sourceBuild'])
    frames = json.loads((root / 'posed/manifest.json').read_text())['frames']
    hp = np.fromfile(root / 'posed/head.positions.f64', dtype='<f8').reshape(len(frames), -1, 3)
    matrices = np.fromfile(root / 'fixed_linear.f64', dtype='<f8').reshape(len(frames), len(mapping), 3, 3)
    shapes = {
        'whole': [118,119,120,156,159,321,622],
        'triangles': [118,156,159,622],
        'outer': [120,159,622],
        'inner': [118,119,156,321],
        'single118': [118],
        'single622': [622],
        'face797': [119,120,321],
        'single120': [120],
        'single119': [119],
        'single321': [321],
        'pair119321': [119,321],
    }
    rows = []
    for label, plate in [('raw',raw), ('predictedPacked',packed)]:
        pb = plate.attr('POSITION').astype(float)
        pt = np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])
        for shape, verts in shapes.items():
            for microunits in (0.,2.,3.,4.,5.,6.,7.,8.):
                altered = pt.copy()
                altered[index, verts, 1] += microunits*1e-6
                h = hb + ht[index]
                p = pb + altered[index]
                d = p-h[mapping]
                cap = np.minimum(5e-5,.25*np.linalg.norm(h[mapping[edges[:,0]]]-h[mapping[edges[:,1]]],axis=1))
                gap = np.linalg.norm(d[edges[:,0]]-d[edges[:,1]],axis=1)
                residual = pb-hb[mapping]+(altered[saved]-ht[saved][:,mapping]).sum(axis=0)
                contacts = []
                for frame in (25,169,170):
                    i = frames.index(frame)
                    points = hp[i,mapping]+np.einsum('vij,vj->vi',matrices[i],residual)
                    pairs = new_pairs(points[pf],hp[i,hf],source_faces,hf)
                    contacts.append({'frame':frame,'pairs':[[int(a),int(b)] for a,b in pairs]})
                rows.append({'stage':label,'shape':shape,'microunits':float(microunits),
                             'neighborViolations':int((gap>cap+1e-10).sum()),
                             'minNeighborSlack':float(np.min(cap-gap)),
                             'contacts':contacts,
                             'contactCount':sum(len(x['pairs']) for x in contacts)})
    out = EXP/'generated/postpack-sweep.json'
    out.write_text(json.dumps(rows,indent=2)+'\n')
    survivors=[r for r in rows if r['contactCount']==0 and r['neighborViolations']==0]
    print(json.dumps({'tested':len(rows),'localContactFreeAndEdgeClear':len(survivors),
                      'byStage':{stage:sum(r['stage']==stage for r in survivors)
                                 for stage in ('raw','predictedPacked')}}))


if __name__ == '__main__':
    main()
