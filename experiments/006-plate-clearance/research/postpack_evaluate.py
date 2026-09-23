"""Run 107/73 numeric gates for a float32 GLB candidate before resource import."""
import argparse
import json
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
    parser.add_argument('--glb', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    args = parser.parse_args()
    baseline = args.baseline
    build = json.loads((baseline / 'build.json').read_text())
    head, plate = Glb(Path(build['head'])), Glb(args.glb)
    mapping = np.asarray(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'], dtype=int)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    pf = plate.array(plate.p['indices']).astype(int).reshape(-1, 3)
    lookup = {tuple(sorted(face)): i for i, face in enumerate(hf)}
    source_faces = np.asarray([lookup[tuple(sorted(face))] for face in mapping[pf]])
    edges = np.unique(np.sort(np.concatenate((pf[:, [0, 1]], pf[:, [1, 2]], pf[:, [2, 0]])), axis=1), axis=0)
    names = head.mesh['extras']['targetNames']
    assert names == plate.mesh['extras']['targetNames'] and len(names) == 105
    hb, pb = head.attr('POSITION').astype(float), plate.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    pt = np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])
    saved = [names.index(n) for n in ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')]
    cases = [('Basis', [])] + [(name, [i]) for i, name in enumerate(names)] + [('saved_v', saved)]
    static = []
    for name, indices in cases:
        h = hb + ht[indices].sum(axis=0) if indices else hb
        p = pb + pt[indices].sum(axis=0) if indices else pb
        d = p - h[mapping]
        cap = np.minimum(5e-5, .25*np.linalg.norm(h[mapping[edges[:, 0]]] - h[mapping[edges[:, 1]]], axis=1))
        gap = np.linalg.norm(d[edges[:, 0]] - d[edges[:, 1]], axis=1)
        pairs = new_pairs(p[pf], h[hf], source_faces, hf)
        static.append({'name': name, 'contacts': len(pairs), 'neighbor': int((gap > cap + 1e-10).sum()),
                       'minimumNeighborSlack': float(np.min(cap-gap)),
                       'maxDisplacement': float(np.linalg.norm(d, axis=1).max()),
                       'pairs': [[int(a), int(b)] for a,b in pairs]})
    root = Path(build['sourceBuild'])
    frames = json.loads((root / 'posed/manifest.json').read_text())['frames']
    hp = np.fromfile(root / 'posed/head.positions.f64', dtype='<f8').reshape(len(frames), -1, 3)
    matrices = np.fromfile(root / 'fixed_linear.f64', dtype='<f8').reshape(len(frames), len(mapping), 3, 3)
    residual = pb - hb[mapping] + (pt[saved] - ht[saved][:, mapping]).sum(axis=0)
    posed = []
    for i, frame in enumerate(frames):
        p = hp[i,mapping] + np.einsum('vij,vj->vi', matrices[i], residual)
        pairs = new_pairs(p[pf], hp[i,hf], source_faces, hf)
        posed.append({'frame': frame, 'contacts': len(pairs), 'pairs': [[int(a),int(b)] for a,b in pairs]})
    report = {'glb': str(args.glb), 'static': static, 'posed': posed,
              'summary': {'staticContacts': sum(r['contacts'] for r in static),
                          'posedContacts': sum(r['contacts'] for r in posed),
                          'neighborViolations': sum(r['neighbor'] for r in static),
                          'minimumNeighborSlack': min(r['minimumNeighborSlack'] for r in static),
                          'maximumStaticDisplacement': max(r['maxDisplacement'] for r in static)}}
    args.output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report['summary']))


if __name__ == '__main__':
    main()
