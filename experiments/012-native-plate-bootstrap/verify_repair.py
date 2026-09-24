"""Independent numeric gates for an exact-native-topology plate correction.

This imports no optimizer. A numeric pass is not a resource or game approval.
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

HEAD_SHA = '0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730'
NATIVE_SHA = '0571c4da09595009dbc7e4e305518e95f18a58ba4c59bf51e97e7d56d0f060ea'
SAVED = ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def edges_of(faces):
    return np.unique(np.sort(np.concatenate((faces[:, [0, 1]], faces[:, [1, 2]],
                                             faces[:, [2, 0]])), axis=1), axis=0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--head', type=Path, required=True)
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--native-map', type=Path, required=True)
    parser.add_argument('--candidate', type=Path)
    parser.add_argument('--geometry-glb', type=Path, help='Float32 import geometry before resource packing')
    parser.add_argument('--packed-glb', type=Path)
    parser.add_argument('--roundtrip-report', type=Path)
    parser.add_argument('--prior-map', type=Path, required=True)
    parser.add_argument('--poses', type=Path, required=True)
    parser.add_argument('--dense', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--summary-output', type=Path)
    args = parser.parse_args()
    assert sum(bool(x) for x in (args.candidate, args.geometry_glb, args.packed_glb)) == 1
    assert bool(args.packed_glb) == bool(args.roundtrip_report)
    self_test()
    assert sha(args.head) == HEAD_SHA and sha(args.native) == NATIVE_SHA
    head, native = Glb(args.head), Glb(args.native)
    mapping = np.asarray(json.loads(args.native_map.read_text())['plateToHeadIndices'], dtype=int)
    old_mapping = np.asarray(json.loads(args.prior_map.read_text())['plateToHeadIndices'], dtype=int)
    assert set(mapping) == set(old_mapping) and len(set(mapping)) == len(mapping)
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    nb = native.attr('POSITION').astype(float)
    nt = np.stack([native.array(t['POSITION']).astype(float) for t in native.p['targets']])
    assert np.array_equal(nb, hb[mapping]) and np.array_equal(nt, ht[:, mapping])
    names = head.mesh['extras']['targetNames']
    assert names == native.mesh['extras']['targetNames'] and len(names) == 105
    if args.candidate:
        candidate = np.load(args.candidate)
        assert set(candidate.files) == {'base', 'morph', 'mapping'}
        assert np.array_equal(candidate['mapping'], mapping)
        base = np.asarray(candidate['base'], dtype=float)
        morph = np.asarray(candidate['morph'], dtype=float)
        proof = None
    else:
        geometry_path = args.packed_glb or args.geometry_glb
        packed = Glb(geometry_path)
        assert packed.mesh['extras']['targetNames'] == names
        np.testing.assert_array_equal(native.array(native.p['indices']), packed.array(packed.p['indices']))
        for attribute in ('TEXCOORD_0', 'TEXCOORD_1'):
            np.testing.assert_array_equal(native.attr(attribute), packed.attr(attribute))
        base = packed.attr('POSITION').astype(float) - hb[mapping]
        morph = np.stack([packed.array(t['POSITION']).astype(float) for t in packed.p['targets']]) - ht[:, mapping]
        proof = json.loads(args.roundtrip_report.read_text()) if args.roundtrip_report else None
        if proof:
            assert proof['roundtripGlbSha256'] == sha(args.packed_glb)
            assert all(proof['checks'][key] for key in ('exactNativeSkinBytesMesh',
                'exactNativeSkinBytesMorphBase', 'meshMorphSkinRowsEqual', 'triangleIndicesEqual',
                'serializedResourceProof'))
            resource_dir = args.roundtrip_report.parent / 'archive/axefrog/appearance_studio/studies'
            assert all(sha(resource_dir / name) == digest for name, digest in proof['resources'].items())
    assert base.shape == (1620, 3) and morph.shape == (105, 1620, 3)
    assert np.all(np.isfinite(base)) and np.all(np.isfinite(morph))
    saved = [names.index(name) for name in SAVED]
    pf = native.array(native.p['indices']).astype(int).reshape(-1, 3)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    lookup = {tuple(sorted(face)): i for i, face in enumerate(hf)}
    source_faces = np.asarray([lookup[tuple(sorted(face))] for face in mapping[pf]])
    edges = edges_of(pf)
    cases = [('Basis', [])] + [(name, [i]) for i, name in enumerate(names)] + [('saved_v', saved)]
    static = []
    for label, targets in cases:
        h = hb + ht[targets].sum(axis=0) if targets else hb
        d = base + morph[targets].sum(axis=0) if targets else base
        p = h[mapping] + d
        cap = np.minimum(5e-5, .25 * np.linalg.norm(
            h[mapping[edges[:, 0]]] - h[mapping[edges[:, 1]]], axis=1))
        gap = np.linalg.norm(d[edges[:, 0]] - d[edges[:, 1]], axis=1)
        area = .5 * np.linalg.norm(np.cross(
            p[pf[:, 1]] - p[pf[:, 0]], p[pf[:, 2]] - p[pf[:, 0]]), axis=1)
        pairs = new_pairs(p[pf], h[hf], source_faces, hf)
        static.append({'case': label, 'contacts': pairs.tolist(),
                       'neighborViolationCount': int(np.count_nonzero(gap > cap + 1e-10)),
                       'maximumDisplacement': float(np.linalg.norm(d, axis=1).max()),
                       'minimumNeighborSlack': float(np.min(cap - gap)),
                       'minimumTriangleArea': float(np.min(area))})
    old_index = {}
    for i, vertex in enumerate(old_mapping):
        old_index.setdefault(int(vertex), i)
    old_indices = np.asarray([old_index[int(vertex)] for vertex in mapping])
    posed_manifest = json.loads((args.poses / 'posed/manifest.json').read_text())
    dense_manifest = json.loads((args.dense / 'manifest.json').read_text())
    frames = posed_manifest['frames']
    assert len(frames) == 73 and dense_manifest['frames'] == list(range(664))
    assert posed_manifest['surfaces'][0]['sha256'] == dense_manifest['inputHashes']['head'] == HEAD_SHA
    hp = np.memmap(args.poses / 'posed/head.positions.f64', dtype='<f8', mode='r',
                   shape=(73, len(hb), 3))
    old_linear = np.memmap(args.poses / 'fixed_linear.f64', dtype='<f8', mode='r',
                           shape=(73, len(old_mapping), 3, 3))
    dense_hp = np.memmap(args.dense / 'head.positions.f64', dtype='<f8', mode='r',
                         shape=(664, len(hb), 3))
    dense_linear = np.memmap(args.dense / 'fixed_linear.f64', dtype='<f8', mode='r',
                             shape=(664, len(old_mapping), 3, 3))
    overlap_head = max(float(np.max(np.abs(dense_hp[frame] - hp[j])))
                       for j, frame in enumerate(frames))
    overlap_linear = max(float(np.max(np.abs(dense_linear[frame, old_indices] - old_linear[j, old_indices])))
                         for j, frame in enumerate(frames))
    assert overlap_head < 1e-10 and overlap_linear < 1e-10
    residual = base + morph[saved].sum(axis=0)

    def check_frame(frame, head_position, linear):
        p = head_position[mapping] + np.einsum('vij,vj->vi', linear[old_indices], residual)
        return new_pairs(p[pf], head_position[hf], source_faces, hf).tolist()

    posed_hits = [{'frame': frame, 'contacts': pairs} for j, frame in enumerate(frames)
                  if (pairs := check_frame(frame, hp[j], old_linear[j]))]
    dense_hits = []
    for frame in dense_manifest['frames']:
        pairs = check_frame(frame, dense_hp[frame], dense_linear[frame])
        if pairs:
            dense_hits.append({'frame': frame, 'contacts': pairs})
        if frame % 100 == 0:
            print(f'Verified dense frame {frame}/663', flush=True)
    failures = sum(len(row['contacts']) + row['neighborViolationCount'] +
                   int(row['maximumDisplacement'] > .00025 + 1e-10) +
                   int(row['minimumTriangleArea'] <= 1e-12) for row in static)
    failures += sum(len(row['contacts']) for row in posed_hits + dense_hits)
    report = {
        'schema': 'xfs/native-plate-repair-numeric-verification-1',
        'inputSha256': {name: sha(path) for name, path in (
            ('head', args.head), ('native', args.native), ('nativeMap', args.native_map),
            ('candidate' if args.candidate else 'packedGlb' if args.packed_glb else 'geometryGlb',
             args.candidate or args.packed_glb or args.geometry_glb),
            ('priorMap', args.prior_map),
            *([('roundtripReport', args.roundtrip_report)] if args.roundtrip_report else []),
            ('posedManifest', args.poses / 'posed/manifest.json'),
            ('posedHead', args.poses / 'posed/head.positions.f64'),
            ('posedLinear', args.poses / 'fixed_linear.f64'),
            ('denseManifest', args.dense / 'manifest.json'),
            ('denseHead', args.dense / 'head.positions.f64'),
            ('denseLinear', args.dense / 'fixed_linear.f64'))},
        'nativeVertices': len(mapping), 'nativeTriangles': len(pf),
        'morphNamesAndOrderExact': True, 'sourceBaseAnd105MorphAccessorsExact': True,
        'serializedNativeSkinBothBuffersExact': bool(proof),
        'resourceSha256': proof['resources'] if proof else None,
        'staticCases': len(static), 'staticContactPairs': sum(len(row['contacts']) for row in static),
        'staticNeighborViolations': sum(row['neighborViolationCount'] for row in static),
        'maximumStaticDisplacement': max(row['maximumDisplacement'] for row in static),
        'minimumStaticNeighborSlack': min(row['minimumNeighborSlack'] for row in static),
        'minimumStaticTriangleArea': min(row['minimumTriangleArea'] for row in static),
        'staticFailures': [row for row in static if row['contacts'] or row['neighborViolationCount'] or
                           row['maximumDisplacement'] > .00025 + 1e-10 or row['minimumTriangleArea'] <= 1e-12],
        'posedSamples': len(frames), 'posedContactFrames': posed_hits,
        'denseSamples': 664, 'denseContactFrames': dense_hits,
        'sampleOverlapMaximumHeadError': overlap_head,
        'sampleOverlapMaximumLinearError': overlap_linear,
        'gate': ('PACKED_SAMPLED_PASS' if proof else 'FLOAT32_PASS' if args.geometry_glb else 'NUMERIC_PASS') if failures == 0 else 'FAIL',
        'limit': ('Serialized resource and sampled geometry only. Combined-scene visibility, continuous animation and game rendering are unproven.'
                  if proof else 'Numeric array candidate only. No WolvenKit serialization, native skin-byte readback, combined-scene visibility, continuous animation or game rendering is proven.'),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    if args.summary_output:
        summary = {key: report[key] for key in report if key not in (
            'staticFailures', 'posedContactFrames', 'denseContactFrames')}
        summary['staticFailureCases'] = [{
            'case': row['case'], 'contactPairs': row['contacts'],
            'neighborViolationCount': row['neighborViolationCount'],
            'minimumNeighborSlack': row['minimumNeighborSlack']}
            for row in report['staticFailures']]
        for label, rows in [('posed', posed_hits), ('dense', dense_hits)]:
            pairs = Counter(tuple(pair) for row in rows for pair in row['contacts'])
            summary[f'{label}ContactingFrameCount'] = len(rows)
            summary[f'{label}ContactPairOccurrences'] = sum(pairs.values())
            summary[f'{label}UniqueContactPairs'] = [
                {'plateFace': a, 'headFace': b, 'occurrences': count}
                for (a, b), count in sorted(pairs.items())]
            summary[f'{label}ContactFrames'] = [row['frame'] for row in rows]
        args.summary_output.write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'staticContactPairs': report['staticContactPairs'],
                      'staticNeighborViolations': report['staticNeighborViolations'],
                      'minimumStaticNeighborSlack': report['minimumStaticNeighborSlack'],
                      'posedContactingFrames': len(posed_hits),
                      'denseContactingFrames': len(dense_hits), 'gate': report['gate']}))


if __name__ == '__main__':
    main()
