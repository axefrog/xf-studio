"""Diagnose local post-packing plate contact and edge failures."""
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
from finite_pair_search import finite_separation


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage', type=Path)
    parser.add_argument('--raw-stage', type=Path)
    parser.add_argument('--baseline', type=Path, required=True)
    args = parser.parse_args()
    root = args.baseline
    build = json.loads((root / 'build.json').read_text())
    head, raw, packed = [Glb(Path(build[key])) for key in ('head', 'raw', 'roundtrip')]
    if args.stage:
        packed = Glb(args.stage)
    if args.raw_stage:
        raw = Glb(args.raw_stage)
    mapping = np.asarray(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'], dtype=int)
    names = head.mesh['extras']['targetNames']
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    pf = packed.array(packed.p['indices']).astype(int).reshape(-1, 3)
    lookup = {tuple(sorted(face)): i for i, face in enumerate(hf)}
    source_faces = np.asarray([lookup[tuple(sorted(face))] for face in mapping[pf]])
    edges = np.unique(np.sort(np.concatenate((pf[:, [0, 1]], pf[:, [1, 2]], pf[:, [2, 0]])), axis=1), axis=0)
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    saved = [names.index(n) for n in ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')]
    cases = [('Basis', [])] + [(name, [i]) for i, name in enumerate(names)] + [('saved_v', saved)]
    report = {'edgeViolations': [], 'contactContexts': []}
    for name, indices in cases:
        h = hb + ht[indices].sum(axis=0) if indices else hb
        cap = np.minimum(5e-5, .25 * np.linalg.norm(h[mapping[edges[:, 0]]] - h[mapping[edges[:, 1]]], axis=1))
        record = {'case': name, 'violations': []}
        for label, plate in [('raw', raw), ('packed', packed)]:
            p = plate.attr('POSITION').astype(float)
            if indices:
                p += np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])[indices].sum(axis=0)
            d = p - h[mapping]
            gap = np.linalg.norm(d[edges[:, 0]] - d[edges[:, 1]], axis=1)
            for ei in np.where(gap > cap + 1e-10)[0]:
                record['violations'].append({'stage': label, 'edge': edges[ei].tolist(),
                                             'gap': float(gap[ei]), 'cap': float(cap[ei]),
                                             'excess': float(gap[ei] - cap[ei])})
        if record['violations']:
            report['edgeViolations'].append(record)
        if name == 'h201_eyes':
            for label, plate in [('raw', raw), ('packed', packed)]:
                p = plate.attr('POSITION').astype(float) + plate.array(plate.p['targets'][names.index(name)]['POSITION']).astype(float)
                pairs = new_pairs(p[pf], h[hf], source_faces, hf)
                report['contactContexts'].append({'context': name, 'stage': label,
                    'pairs': [{'plateFace': int(pi), 'headFace': int(hi), 'plateVertices': pf[pi].tolist(),
                               'pairShift': finite_separation(p[pf[pi]], h[hf[hi]], 4e-6).tolist()}
                              for pi, hi in pairs]})
    frames = json.loads((Path(build['sourceBuild']) / 'posed/manifest.json').read_text())['frames']
    hp = np.fromfile(Path(build['sourceBuild']) / 'posed/head.positions.f64', dtype='<f8').reshape(len(frames), -1, 3)
    linear = np.fromfile(Path(build['sourceBuild']) / 'fixed_linear.f64', dtype='<f8').reshape(len(frames), len(mapping), 3, 3)
    for frame in (25, 169, 170):
        j = frames.index(frame)
        for label, plate in [('raw', raw), ('packed', packed)]:
            pb = plate.attr('POSITION').astype(float)
            pt = np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])
            residual = pb - hb[mapping] + (pt[saved] - ht[saved][:, mapping]).sum(axis=0)
            p = hp[j, mapping] + np.einsum('vij,vj->vi', linear[j], residual)
            pairs = new_pairs(p[pf], hp[j, hf], source_faces, hf)
            report['contactContexts'].append({'context': f'frame-{frame}', 'stage': label,
                'pairs': [{'plateFace': int(pi), 'headFace': int(hi), 'plateVertices': pf[pi].tolist(),
                           'pairShift': finite_separation(p[pf[pi]], hp[j,hf[hi]], 4e-6).tolist()}
                          for pi, hi in pairs]})
    out = EXP / 'generated/postpack-diagnosis.json'
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'edgeViolations': report['edgeViolations'], 'contactContexts': report['contactContexts']}))


if __name__ == '__main__':
    main()
