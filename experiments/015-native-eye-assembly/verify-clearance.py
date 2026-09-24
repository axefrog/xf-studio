"""Independent finite-pair witness and optional prior-head-pose verification."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def maximum_axis_gap(a, b):
    """Positive means a separating SAT axis; zero/negative means overlap."""
    ae = np.roll(a, -1, axis=0) - a
    be = np.roll(b, -1, axis=0) - b
    axes = [np.cross(ae[0], ae[1]), np.cross(be[0], be[1])]
    axes.extend(np.cross(x, y) for x in ae for y in be)
    gaps = []
    for axis in axes:
        size = np.linalg.norm(axis)
        if size <= 1e-14:
            continue
        axis /= size
        ap, bp = a @ axis, b @ axis
        gaps.append(max(float(ap.min() - bp.max()), float(bp.min() - ap.max())))
    assert gaps
    return max(gaps)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reference-posed', type=Path,
                        help='Optional prior Experiment 006 posed/ directory for exact saved-head overlap')
    args = parser.parse_args()
    root = HERE / 'generated' / 'clearance'
    manifest = json.loads((root / 'manifest.json').read_text())
    contact = json.loads((root / 'contact-pairs.json').read_text())
    report = json.loads((HERE / 'clearance-evidence.json').read_text())
    assert report['schema'] == 'xfs/native-eye-visible-clearance-1'
    assert report['inputs']['sampleManifestSha256'] == sha(root / 'manifest.json')
    assert report['inputs']['contactPairsSha256'] == sha(root / 'contact-pairs.json')
    assert len(report['rows']) == len(contact['rows']) == 2 * 9 * 3
    assert {key: value['sha256'] for key, value in manifest['inputs'].items()} == {
        'eye': '0e5420a75e5a65eded91bb68338860e119692f0868f78e7ef89c98c0c56eaeba',
        'head': '0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730',
        'body': 'b2f9ee12cbf5f19bffeb43c367439b0710f289ad38b75088943ba15fbdf8a8e8',
        'face': '5a52d9b9e59acc2630336c3a280e179e57ad4ca5815f97d5397cf15748f2b3e7',
        'binding': '72712873bcd65190207c9b83ff44a4a8dd2dd0190b20cea21beb1571deabe568',
    }
    for value in manifest['inputs'].values():
        assert sha(Path(value['path'])) == value['sha256']
    faces = {}
    for name, value in manifest['meshIndices'].items():
        path = root / value['file']
        assert sha(path) == value['sha256']
        faces[name] = np.asarray(json.loads(path.read_text()), dtype=int).reshape(-1, 3)
    cache = {}
    def surface(shape, frame, name):
        key = f'{shape}/{frame}/{name}'
        if key not in cache:
            value = manifest['surfaces'][key]
            path = root / value['file']
            assert sha(path) == value['sha256']
            cache[key] = np.fromfile(path, dtype='<f8').reshape(value['vertices'], 3)
        return cache[key]
    witness_gaps = []
    for row in report['rows']:
        match = next(x for x in contact['rows'] if all(x[k] == row[k] for k in ('shape', 'frame', 'part')))
        assert row['contactPairs'] == match['contactPairs'] == len(match['pairs'])
        assert 0 <= row['allOpaqueSurfaceExposedContactPairs'] <= row['pairwiseExposedContactPairs'] <= row['contactPairs']
        assert row['unresolvedCoplanarOrPointSegments'] <= row['contactPairs']
        witness = row['witness']
        if not witness:
            assert row['allOpaqueSurfaceExposedContactPairs'] == 0
            continue
        assert [witness['partTriangle'], witness['headTriangle']] in match['pairs']
        assert all(abs(witness[k]) <= report['depthToleranceMeters'] for k in
                   ('headDepthGap', 'partDepthGap', 'allSurfaceDepthGap'))
        a = surface(row['shape'], row['frame'], row['part'])[faces[row['part']][witness['partTriangle']]]
        b = surface(row['shape'], row['frame'], 'head')[faces['head'][witness['headTriangle']]]
        gap = maximum_axis_gap(a, b)
        assert gap <= 1e-9, (row['shape'], row['frame'], row['part'], gap)
        witness_gaps.append(gap)
    overlap = {}
    if args.reference_posed:
        prior = json.loads((args.reference_posed / 'manifest.json').read_text())
        assert prior['surfaces'][0]['sha256'] == manifest['inputs']['head']['sha256']
        assert prior['animationHashes']['body'] == manifest['inputs']['body']['sha256']
        assert prior['animationHashes']['facial'] == manifest['inputs']['face']['sha256']
        prior_head = np.memmap(args.reference_posed / 'head.positions.f64', dtype='<f8', mode='r',
                               shape=(len(prior['frames']), manifest['surfaces']['saved-five-morph/0/head']['vertices'], 3))
        for frame in [0, 169, 490]:
            current = surface('saved-five-morph', frame, 'head')
            overlap[str(frame)] = float(np.max(np.abs(current - prior_head[prior['frames'].index(frame)])))
        assert max(overlap.values()) == 0
    print(json.dumps({'visibleWitnessesIndependentlyChecked': len(witness_gaps),
                      'largestWitnessSeparatingAxisGapMeters': max(witness_gaps),
                      'priorHeadPoseMaxComponentErrors': overlap,
                      'evidenceSha256': sha(HERE / 'clearance-evidence.json')}))


if __name__ == '__main__':
    main()
