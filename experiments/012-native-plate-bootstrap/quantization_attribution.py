"""Attribute a packed native plate failure to base and/or morph readback.

The crossed geometries are diagnostic arrays, not importable resources. Full
acceptance is always rechecked on the actual serialized resource separately.
"""
import argparse
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / '004-plate-import'), str(HERE.parent / '006-plate-clearance')]
from verify_roundtrip import Glb  # noqa: E402
from verify_crease_roundtrip import new_pairs  # noqa: E402
from triangles import self_test  # noqa: E402

SAVED = ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def edges_of(faces):
    return np.unique(np.sort(np.concatenate((faces[:, [0, 1]], faces[:, [1, 2]],
                                             faces[:, [2, 0]])), axis=1), axis=0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--head', type=Path, required=True)
    parser.add_argument('--native-map', type=Path, required=True)
    parser.add_argument('--prior-map', type=Path, required=True)
    parser.add_argument('--float32', type=Path, required=True)
    parser.add_argument('--packed', type=Path, required=True)
    parser.add_argument('--poses', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    self_test()
    head, before, after = Glb(args.head), Glb(args.float32), Glb(args.packed)
    mapping = np.asarray(json.loads(args.native_map.read_text())['plateToHeadIndices'], dtype=int)
    old_mapping = np.asarray(json.loads(args.prior_map.read_text())['plateToHeadIndices'], dtype=int)
    names = head.mesh['extras']['targetNames']
    assert names == before.mesh['extras']['targetNames'] == after.mesh['extras']['targetNames']
    pf = before.array(before.p['indices']).astype(int).reshape(-1, 3)
    np.testing.assert_array_equal(pf, after.array(after.p['indices']).astype(int).reshape(-1, 3))
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    lookup = {tuple(sorted(face)): i for i, face in enumerate(hf)}
    source_faces = np.asarray([lookup[tuple(sorted(face))] for face in mapping[pf]])
    edges = edges_of(pf)
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    bb, ab = before.attr('POSITION').astype(float), after.attr('POSITION').astype(float)
    bt = np.stack([before.array(t['POSITION']).astype(float) for t in before.p['targets']])
    at = np.stack([after.array(t['POSITION']).astype(float) for t in after.p['targets']])
    assert bb.shape == ab.shape == (1620, 3) and bt.shape == at.shape == (105, 1620, 3)
    saved = [names.index(name) for name in SAVED]
    cases = [('Basis', [])] + [(name, [i]) for i, name in enumerate(names)] + [('saved_v', saved)]
    first = {}
    for index, vertex in enumerate(old_mapping):
        first.setdefault(int(vertex), index)
    old_indices = np.asarray([first[int(vertex)] for vertex in mapping])
    manifest = json.loads((args.poses / 'posed/manifest.json').read_text())
    frames = manifest['frames']
    assert len(frames) == 73
    hp = np.memmap(args.poses / 'posed/head.positions.f64', dtype='<f8', mode='r',
                   shape=(73, len(hb), 3))
    linear = np.memmap(args.poses / 'fixed_linear.f64', dtype='<f8', mode='r',
                       shape=(73, len(old_mapping), 3, 3))
    variants = {
        'float32_input': (bb, bt),
        'packed_base_only': (ab, bt),
        'packed_morph_only': (bb, at),
        'packed_both': (ab, at),
    }
    result = {}
    for label, (base, targets) in variants.items():
        static_hits = []
        edge_violations = 0
        minimum_slack = float('inf')
        for case, ids in cases:
            h = hb + ht[ids].sum(axis=0) if ids else hb
            p = base + targets[ids].sum(axis=0) if ids else base
            d = p - h[mapping]
            cap = np.minimum(5e-5, .25 * np.linalg.norm(
                h[mapping[edges[:, 0]]] - h[mapping[edges[:, 1]]], axis=1))
            gap = np.linalg.norm(d[edges[:, 0]] - d[edges[:, 1]], axis=1)
            edge_violations += int(np.count_nonzero(gap > cap + 1e-10))
            minimum_slack = min(minimum_slack, float(np.min(cap - gap)))
            pairs = new_pairs(p[pf], h[hf], source_faces, hf)
            if len(pairs):
                static_hits.append({'case': case, 'pairs': pairs.tolist()})
        residual = base - hb[mapping] + (targets[saved] - ht[saved][:, mapping]).sum(axis=0)
        posed = []
        for j, frame in enumerate(frames):
            p = hp[j, mapping] + np.einsum('vij,vj->vi', linear[j, old_indices], residual)
            pairs = new_pairs(p[pf], hp[j, hf], source_faces, hf)
            if len(pairs):
                posed.append({'frame': frame, 'pairs': pairs.tolist()})
        pair_counts = Counter(tuple(pair) for row in posed for pair in row['pairs'])
        result[label] = {
            'staticContactPairs': sum(len(row['pairs']) for row in static_hits),
            'staticContacts': static_hits,
            'staticNeighborViolations': edge_violations,
            'minimumStaticNeighborSlack': minimum_slack,
            'posedContactingFrames': [row['frame'] for row in posed],
            'posedContactPairOccurrences': sum(pair_counts.values()),
            'posedUniquePairs': [{'plateFace': a, 'headFace': b, 'occurrences': count}
                                 for (a, b), count in sorted(pair_counts.items())],
        }
        print(label, json.dumps({k: result[label][k] for k in (
            'staticContactPairs', 'staticNeighborViolations', 'posedContactPairOccurrences')}), flush=True)
    increases = []
    packed_failures = []
    for case, ids in cases:
        h = hb[mapping] + ht[ids][:, mapping].sum(axis=0) if ids else hb[mapping]
        input_d = bb + bt[ids].sum(axis=0) - h if ids else bb - h
        packed_d = ab + at[ids].sum(axis=0) - h if ids else ab - h
        input_gap = np.linalg.norm(input_d[edges[:, 0]] - input_d[edges[:, 1]], axis=1)
        packed_gap = np.linalg.norm(packed_d[edges[:, 0]] - packed_d[edges[:, 1]], axis=1)
        cap = np.minimum(5e-5, .25 * np.linalg.norm(h[edges[:, 0]] - h[edges[:, 1]], axis=1))
        index = int(np.argmax(packed_gap - input_gap))
        increases.append({'case': case, 'headEdge': mapping[edges[index]].tolist(),
                          'gapIncrease': float(packed_gap[index] - input_gap[index]),
                          'inputSlack': float(cap[index] - input_gap[index]),
                          'packedSlack': float(cap[index] - packed_gap[index])})
        for index in np.flatnonzero(packed_gap > cap + 1e-10):
            packed_failures.append({'case': case, 'headEdge': mapping[edges[index]].tolist(),
                                    'gapIncrease': float(packed_gap[index] - input_gap[index]),
                                    'inputSlack': float(cap[index] - input_gap[index]),
                                    'packedSlack': float(cap[index] - packed_gap[index])})
    report = {
        'schema': 'xfs/native-plate-quantization-attribution-1',
        'inputSha256': {key: sha(path) for key, path in (
            ('head', args.head), ('nativeMap', args.native_map), ('priorMap', args.prior_map),
            ('float32', args.float32), ('packed', args.packed),
            ('posedManifest', args.poses / 'posed/manifest.json'),
            ('posedHead', args.poses / 'posed/head.positions.f64'),
            ('posedLinear', args.poses / 'fixed_linear.f64'))},
        'maximumBasePositionComponentReadbackDifference': float(np.max(np.abs(ab - bb))),
        'maximumMorphPositionComponentReadbackDifference': float(np.max(np.abs(at - bt))),
        'maximumObservedNeighborGapIncrease': max(increases, key=lambda row: row['gapIncrease']),
        'worstPackedNeighborFailure': min(packed_failures, key=lambda row: row['packedSlack']),
        'minimumInputSlackAmongPackedFailures': min(row['inputSlack'] for row in packed_failures),
        'packedNeighborFailureCount': len(packed_failures),
        'variants': result,
        'limit': 'Crossed base/morph arrays are causal diagnostics for the 107 static cases and 73 preserved poses only; they are not real serialized resources or a dense-animation acceptance test.',
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
