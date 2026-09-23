"""Contact-check the packed crease candidate at every baked facial frame."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent.parent / '004-plate-import'), str(HERE.parent)]
from verify_roundtrip import Glb
from verify_crease_roundtrip import new_pairs
from triangles import self_test


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def maximum_axis_gap(a, b):
    """Largest signed interval gap on finite triangle SAT axes (positive = separated)."""
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
    parser.add_argument('--source-build', type=Path, required=True)
    parser.add_argument('--candidate-build', type=Path, required=True)
    parser.add_argument('--dense', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    self_test()
    source = json.loads((args.source_build / 'build.json').read_text())
    candidate = json.loads((args.candidate_build / 'build.json').read_text())
    manifest = json.loads((args.dense / 'manifest.json').read_text())
    old = json.loads((args.source_build / 'posed/manifest.json').read_text())
    assert source['preserveHeadWeights'] and Path(candidate['sourceBuild']).resolve() == args.source_build.resolve()
    assert manifest['inputHashes']['head'] == old['surfaces'][0]['sha256'] == sha(source['head'])
    assert manifest['inputHashes']['body'] == old['animationHashes']['body']
    assert manifest['inputHashes']['face'] == old['animationHashes']['facial']
    # The older sampler loaded four surfaces, each with the same 254 head bindings.
    assert manifest['mappedBones'] == 254 and old['mappedBones'] == 4 * manifest['mappedBones']
    assert not manifest['unmappedBones']
    assert len(manifest['frames']) == 664 and manifest['frames'] == list(range(664))
    assert manifest['rate'] == old['rate'] == 30
    assert sha(candidate['roundtrip']) == '8f37b8a91f0a502ba8d586b5077c70dfce58f16fd76cc5593bef74aa460c6646'
    assert [r['sha256'] for r in candidate['resources']] == [
        'b0b316f55ec9e16b7c0a15a3155404c2b6d41e537ab9a221fdbd23c1a810e0bb',
        '19edf3d8e16486958997ccfdc7b88d55ab7b60a8ab90056d0113b7623115a927',
    ]
    assert all(sha(row['path']) == row['sha256'] for row in candidate['resources'])
    head, packed = Glb(Path(source['head'])), Glb(Path(candidate['roundtrip']))
    mapping = np.asarray(json.loads(Path(source['mapping']).read_text())['plateToHeadIndices'], dtype=int)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    pf = packed.array(packed.p['indices']).astype(int).reshape(-1, 3)
    face_lookup = {tuple(sorted(face)): i for i, face in enumerate(hf)}
    source_faces = np.asarray([face_lookup[tuple(sorted(face))] for face in mapping[pf]])
    names = head.mesh['extras']['targetNames']
    saved = [names.index(name) for name in ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')]
    hb = head.attr('POSITION').astype(float)
    pb = packed.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    pt = np.stack([packed.array(t['POSITION']).astype(float) for t in packed.p['targets']])
    residual = pb - hb[mapping] + (pt[saved] - ht[saved][:, mapping]).sum(axis=0)
    frames = manifest['frames']
    hp = np.memmap(args.dense / 'head.positions.f64', dtype='<f8', mode='r', shape=(len(frames), len(hb), 3))
    linear = np.memmap(args.dense / 'fixed_linear.f64', dtype='<f8', mode='r', shape=(len(frames), len(mapping), 3, 3))
    old_hp = np.memmap(args.source_build / 'posed/head.positions.f64', dtype='<f8', mode='r', shape=(len(old['frames']), len(hb), 3))
    old_linear = np.memmap(args.source_build / 'fixed_linear.f64', dtype='<f8', mode='r', shape=(len(old['frames']), len(mapping), 3, 3))
    head_error = max(float(np.max(np.abs(hp[f] - old_hp[j]))) for j, f in enumerate(old['frames']))
    linear_error = max(float(np.max(np.abs(linear[f] - old_linear[j]))) for j, f in enumerate(old['frames']))
    assert head_error <= 1e-10 and linear_error <= 1e-10
    rows = []
    for frame in frames:
        p = hp[frame, mapping] + np.einsum('vij,vj->vi', linear[frame], residual)
        pairs = new_pairs(p[pf], hp[frame, hf], source_faces, hf)
        rows.append({'frame': frame, 'newNonadjacent': len(pairs),
                     'newPairs': [{
                         'plateFace': int(a), 'headFace': int(b),
                         'plateVertices': pf[a].tolist(), 'headVertices': hf[b].tolist(),
                         'sourceHeadFace': int(source_faces[a]),
                         'maximumSeparatingAxisGap': maximum_axis_gap(p[pf[a]], hp[frame, hf[b]]),
                         'nativeMaximumSeparatingAxisGap': maximum_axis_gap(
                             hp[frame, hf[source_faces[a]]], hp[frame, hf[b]]),
                     } for a, b in pairs]})
        if frame % 100 == 0:
            print(f'Contact checked {frame}/{frames[-1]}', flush=True)
    hits = [row for row in rows if row['newNonadjacent']]
    assert all(pair['maximumSeparatingAxisGap'] <= 1e-10 and
               pair['nativeMaximumSeparatingAxisGap'] > 0
               for row in hits for pair in row['newPairs'])
    report = {
        'candidateSha256': candidate['candidateSha256'],
        'packedGlbSha256': sha(candidate['roundtrip']),
        'meshSha256': candidate['resources'][0]['sha256'],
        'morphSha256': candidate['resources'][1]['sha256'],
        'denseInputs': {name: sha(args.dense / name) for name in ('manifest.json', 'head.positions.f64', 'fixed_linear.f64')},
        'sampleCount': len(frames), 'sampleRateHz': manifest['rate'],
        'lastSampleSeconds': frames[-1] / manifest['rate'],
        'original73Overlap': {'headPositionMaxComponentError': head_error,
                              'skinLinearMaxComponentError': linear_error},
        'contactingFrameCount': len(hits),
        'newNonadjacentPairOccurrences': sum(row['newNonadjacent'] for row in rows),
        'maximumPairsInOneFrame': max(row['newNonadjacent'] for row in rows),
        'contactingFrames': hits,
        'perFrameNewContactCounts': [row['newNonadjacent'] for row in rows],
        'gate': 'PASS' if not hits else 'FAIL',
        'limit': 'Every baked 30 Hz facial sample in the decoded idle adapter, one saved five-morph combination. Between-frame motion, REDengine graph and rendering are untested.',
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ('sampleCount', 'contactingFrameCount',
        'newNonadjacentPairOccurrences', 'maximumPairsInOneFrame', 'gate')}))


if __name__ == '__main__':
    main()
