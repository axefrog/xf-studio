"""Independent finite-contact gate for native plate at decoded idle subframes.

The source clips are sampled by sample_plate_subframes.ts. This verifier uses
the unchanged finite-triangle new_pairs checker and requires exact 30 Hz
overlap with the earlier 664-frame bake. Sampled times are not a mathematical
continuous-time certificate or a REDengine runtime test.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / '004-plate-import'), str(HERE.parent / '006-plate-clearance')]
from verify_roundtrip import Glb  # noqa: E402
from verify_crease_roundtrip import new_pairs  # noqa: E402
from triangles import self_test  # noqa: E402

PACKED_SHA = '8e9c76b445ec746904bd8d24bfdf93f78f09d7627ffc8b3d4b337d8b524c6499'
HEAD_SHA = '0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730'
NATIVE_SHA = '0571c4da09595009dbc7e4e305518e95f18a58ba4c59bf51e97e7d56d0f060ea'
WITNESSES = ((792, 2421), (800, 1987), (799, 1989), (793, 2421))


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def maximum_axis_gap(a, b):
    """Positive means a separating interval exists on a finite triangle SAT axis."""
    ae = np.roll(a, -1, axis=0) - a
    be = np.roll(b, -1, axis=0) - b
    axes = [np.cross(ae[0], ae[1]), np.cross(be[0], be[1])]
    axes.extend(np.cross(x, y) for x in ae for y in be)
    gaps = []
    for axis in axes:
        size = np.linalg.norm(axis)
        if size <= 1e-14:
            continue
        ap, bp = a @ (axis / size), b @ (axis / size)
        gaps.append(max(float(ap.min() - bp.max()), float(bp.min() - ap.max())))
    assert gaps
    return max(gaps)


def main():
    parser = argparse.ArgumentParser()
    for name in ('head', 'native', 'native-map', 'prior-map', 'packed',
                 'roundtrip-report', 'packed-verification', 'dense', 'subframes', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    self_test()
    assert sha(args.head) == HEAD_SHA and sha(args.native) == NATIVE_SHA
    assert sha(args.packed) == PACKED_SHA
    proof = json.loads(args.roundtrip_report.read_text())
    prior = json.loads(args.packed_verification.read_text())
    assert proof['roundtripGlbSha256'] == prior['inputSha256']['packedGlb'] == PACKED_SHA
    assert prior['gate'] == 'PACKED_SAMPLED_PASS' and prior['staticCases'] == 107
    assert prior['staticContactPairs'] == prior['staticNeighborViolations'] == 0
    assert prior['minimumStaticNeighborSlack'] > 0
    assert prior['posedSamples'] == 73 and prior['denseSamples'] == 664
    assert not prior['posedContactFrames'] and not prior['denseContactFrames']
    assert all(proof['checks'][key] for key in ('exactNativeSkinBytesMesh',
        'exactNativeSkinBytesMorphBase', 'meshMorphSkinRowsEqual',
        'triangleIndicesEqual', 'serializedResourceProof'))
    for name, digest in proof['resources'].items():
        assert sha(args.roundtrip_report.parent / 'archive/axefrog/appearance_studio/studies' / name) == digest
    head, native, packed = map(Glb, (args.head, args.native, args.packed))
    mapping = np.asarray(json.loads(args.native_map.read_text())['plateToHeadIndices'], dtype=int)
    old_map = np.asarray(json.loads(args.prior_map.read_text())['plateToHeadIndices'], dtype=int)
    old_first = {}
    for j, h in enumerate(old_map):
        old_first.setdefault(int(h), j)
    old_indices = np.asarray([old_first[int(h)] for h in mapping])
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    pb = packed.attr('POSITION').astype(float)
    pt = np.stack([packed.array(t['POSITION']).astype(float) for t in packed.p['targets']])
    names = head.mesh['extras']['targetNames']
    assert names == native.mesh['extras']['targetNames'] == packed.mesh['extras']['targetNames']
    saved = [names.index(name) for name in ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')]
    residual = pb - hb[mapping] + (pt[saved] - ht[saved][:, mapping]).sum(axis=0)
    pf = native.array(native.p['indices']).astype(int).reshape(-1, 3)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    np.testing.assert_array_equal(pf, packed.array(packed.p['indices']).astype(int).reshape(-1, 3))
    face_lookup = {tuple(sorted(face)): i for i, face in enumerate(hf)}
    source_faces = np.asarray([face_lookup[tuple(sorted(face))] for face in mapping[pf]])

    manifest = json.loads((args.subframes / 'manifest.json').read_text())
    dense_manifest = json.loads((args.dense / 'manifest.json').read_text())
    assert manifest['schema'] == 'xfs/native-plate-subframe-samples-1'
    assert manifest['rate'] > 30 and manifest['rate'] % 30 == 0
    assert manifest['sampleCount'] == manifest['lastTick'] - manifest['firstTick'] + 1
    assert manifest['firstTick'] == manifest['firstFrame'] * manifest['rate'] // 30
    assert manifest['lastTick'] == manifest['lastFrame'] * manifest['rate'] // 30
    assert manifest['headVertices'] == len(hb) == 7186 and manifest['mappedPlateVertices'] == len(mapping) == 1620
    assert manifest['mappedBones'] == 254 and not manifest['unmappedBones']
    assert manifest['reconstructionError'] < 1e-10
    assert manifest['inputHashes']['head'] == dense_manifest['inputHashes']['head'] == HEAD_SHA
    assert manifest['inputHashes']['body'] == dense_manifest['inputHashes']['body']
    assert manifest['inputHashes']['face'] == dense_manifest['inputHashes']['face']
    assert manifest['inputHashes']['nativeMap'] == sha(args.native_map)
    count, rate = manifest['sampleCount'], manifest['rate']
    hp = np.memmap(args.subframes / 'head.positions.f64', dtype='<f8', mode='r', shape=(count, len(hb), 3))
    linear = np.memmap(args.subframes / 'fixed_linear.f64', dtype='<f8', mode='r', shape=(count, len(mapping), 3, 3))
    dense_hp = np.memmap(args.dense / 'head.positions.f64', dtype='<f8', mode='r', shape=(664, len(hb), 3))
    dense_linear = np.memmap(args.dense / 'fixed_linear.f64', dtype='<f8', mode='r', shape=(664, len(old_map), 3, 3))
    overlap_head = overlap_linear = 0.0
    overlaps = 0
    hits = []
    witness_min = {f'{a}:{b}': {'gap': float('inf'), 'tick': None} for a, b in WITNESSES}
    for j in range(count):
        tick = manifest['firstTick'] + j
        if tick % (rate // 30) == 0:
            frame = tick // (rate // 30)
            overlap_head = max(overlap_head, float(np.max(np.abs(hp[j] - dense_hp[frame]))))
            overlap_linear = max(overlap_linear, float(np.max(np.abs(linear[j] - dense_linear[frame, old_indices]))))
            overlaps += 1
        p = hp[j, mapping] + np.einsum('vij,vj->vi', linear[j], residual)
        pairs = new_pairs(p[pf], hp[j, hf], source_faces, hf)
        if len(pairs):
            detailed = []
            for a, b in pairs:
                candidate_gap = maximum_axis_gap(p[pf[a]], hp[j, hf[b]])
                native_gap = maximum_axis_gap(hp[j, hf[source_faces[a]]], hp[j, hf[b]])
                assert candidate_gap <= 1e-10 and native_gap > 0
                detailed.append({'plateFace': int(a), 'headFace': int(b),
                                 'plateVertices': pf[a].tolist(), 'headVertices': hf[b].tolist(),
                                 'sourceHeadFace': int(source_faces[a]),
                                 'candidateMaximumAxisGap': candidate_gap,
                                 'nativeMaximumAxisGap': native_gap})
            hits.append({'tick': tick, 'seconds': tick / rate, 'pairs': detailed})
        # These finite witnesses drove the earlier corrective fits. Track
        # positive SAT interval separation in their original 295..303 region.
        if 295 <= tick / rate * 30 <= 303:
            for a, b in WITNESSES:
                native_gap = maximum_axis_gap(hp[j, hf[source_faces[a]]], hp[j, hf[b]])
                if native_gap <= 0:
                    continue
                gap = maximum_axis_gap(p[pf[a]], hp[j, hf[b]])
                item = witness_min[f'{a}:{b}']
                if gap < item['gap']:
                    item.update(gap=gap, tick=tick, nativeGap=native_gap)
        if j % 200 == 0:
            print(f'Checked {j}/{count-1} subframe samples', flush=True)
    assert overlaps == manifest['lastFrame'] - manifest['firstFrame'] + 1
    assert overlap_head < 1e-10 and overlap_linear < 1e-10
    report = {
        'schema': 'xfs/native-plate-subframe-verification-1',
        'packedGlbSha256': PACKED_SHA,
        'meshSha256': proof['resources']['xfs_bootstrap_eye_plate.mesh'],
        'morphSha256': proof['resources']['xfs_bootstrap_eye_plate.morphtarget'],
        'inputSha256': {name: sha(path) for name, path in (
            ('subframeManifest', args.subframes / 'manifest.json'),
            ('subframeHead', args.subframes / 'head.positions.f64'),
            ('subframeLinear', args.subframes / 'fixed_linear.f64'),
            ('denseManifest', args.dense / 'manifest.json'),
            ('denseHead', args.dense / 'head.positions.f64'),
            ('denseLinear', args.dense / 'fixed_linear.f64'),
            ('packedVerification', args.packed_verification))},
        'sampleRateHz': rate, 'firstTick': manifest['firstTick'], 'lastTick': manifest['lastTick'],
        'sampleCount': count, 'overlap30HzSamples': overlaps,
        'overlapMaximumHeadComponentError': overlap_head,
        'overlapMaximumLinearComponentError': overlap_linear,
        'staticGateFromExactPackedResource': {
            'cases': prior['staticCases'], 'newPairs': prior['staticContactPairs'],
            'neighborViolations': prior['staticNeighborViolations'],
            'minimumNeighborSlack': prior['minimumStaticNeighborSlack'],
            'maximumDisplacement': prior['maximumStaticDisplacement']},
        'newContactingTimes': hits, 'newContactOccurrences': sum(len(row['pairs']) for row in hits),
        'witnessMargins': {key: {'minimumAxisGap': row['gap'] if row['tick'] is not None else None,
                                  'tick': row['tick'],
                                  'seconds': row['tick'] / rate if row['tick'] is not None else None,
                                  'nativeAxisGap': row.get('nativeGap')}
                           for key, row in witness_min.items()},
        'gate': 'SAMPLED_SUBFRAME_PASS' if not hits else 'FAIL',
        'limit': 'Decoded Three.js animation/skin adapter sampled at finite times. No continuous-time guarantee, live REDengine graph, combined-scene visual acceptance, or game rendering proof.',
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'samples': count, 'contacts': report['newContactOccurrences'],
                      'overlaps': overlaps, 'headError': overlap_head,
                      'linearError': overlap_linear, 'gate': report['gate']}))


if __name__ == '__main__':
    main()
