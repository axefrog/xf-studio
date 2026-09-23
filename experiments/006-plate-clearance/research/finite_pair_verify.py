"""Independent exhaustive geometry check of the finite-pair numeric trial."""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
WORKSPACE = EXP.parent.parent
sys.path[:0] = [str(EXP.parent / '004-plate-import'), str(EXP)]
from verify_roundtrip import Glb
from triangles import contacts, intersect_pairs, self_test


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def count_new(plate, head, source_faces, head_faces):
    pairs = np.asarray(contacts(plate, head)['pairs'], dtype=int).reshape(-1, 2)
    if not len(pairs): return 0
    mapped = head_faces[source_faces[pairs[:, 0]]]
    other = head_faces[pairs[:, 1]]
    pairs = pairs[~(mapped[:, :, None] == other[:, None, :]).any(axis=(1, 2))]
    if not len(pairs): return 0
    original = intersect_pairs(head[source_faces[pairs[:, 0]]], head[pairs[:, 1]])
    return int((~original).sum())


def main():
    self_test()
    trial = json.loads((HERE / 'finite_pair_search_summary.json').read_text())
    previous_path = HERE / 'morph_aware_rescue_summary.json'
    assert sha(previous_path) == trial['sourceReportSha256']
    previous = json.loads(previous_path.read_text())
    for item in previous['inputs']:
        path = Path(item['path'])
        if not path.is_absolute(): path = WORKSPACE / path
        assert sha(path) == item['sha256'], path
    source_numeric = WORKSPACE / previous['numericCandidate']
    if not source_numeric.is_file():
        source_numeric = Path('D:/Dev/cp2077-modding-hq') / previous['numericCandidate']
    assert sha(source_numeric) == previous['numericCandidateSha256'] == trial['sourceNumericSha256']
    candidate_path = WORKSPACE / trial['numericResult']
    assert sha(candidate_path) == trial['numericResultSha256']
    data = np.load(candidate_path)
    root = Path(previous['sourceBuild'])
    build = json.loads((root / 'build.json').read_text())
    source = next(c for c in build['candidates'] if c['name'] == previous['sourceCandidate'])
    assert source['weightTransfer']['binaryRoundtripSkinBufferExact']
    assert source['weightTransfer']['morphBaseBuffer']['binaryRoundtripSkinBufferExact']
    head, plate = Glb(Path(build['head'])), Glb(Path(source['roundtrip']))
    mapping = np.array(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'], dtype=int)
    np.testing.assert_array_equal(data['mapping'], mapping)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    pf = plate.array(plate.p['indices']).astype(int).reshape(-1, 3)
    lookup = {tuple(sorted(t)): i for i, t in enumerate(hf)}
    source_faces = np.array([lookup[tuple(sorted(t))] for t in mapping[pf]])
    edges = np.unique(np.sort(np.concatenate([pf[:, [0, 1]], pf[:, [1, 2]], pf[:, [2, 0]]]), axis=1), axis=0)
    names = head.mesh['extras']['targetNames']
    assert len(names) == 105 and names == plate.mesh['extras']['targetNames']
    hb, pb = head.attr('POSITION').astype(float), plate.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    pt = np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])
    field, base, morph = data['field'], data['baseChange'], data['morphChange']
    assert field.shape == base.shape == (len(mapping), 3)
    assert morph.shape == (105, len(mapping), 3)
    np.testing.assert_allclose(pb + base, hb[mapping] + field, rtol=0, atol=1e-14)
    prior_morph = np.load(source_numeric)['morphChange']
    changed_names = [names[i] for i in range(105)
                     if np.linalg.norm(morph[i] - prior_morph[i], axis=1).max() > 1e-12]
    assert all(name.endswith('_eyes') for name in changed_names), changed_names
    saved = [names.index(n) for n in ['h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear']]
    cases = [('Basis', [])] + [(n, [i]) for i, n in enumerate(names)] + [('saved_v', saved)]
    static = []
    max_displacement = 0.
    max_neighbor_gap = 0.
    for name, indices in cases:
        h = hb + ht[indices].sum(axis=0) if indices else hb
        p = pb + base + (pt[indices] + morph[indices]).sum(axis=0) if indices else pb + base
        d = p - h[mapping]
        limits = np.minimum(5e-5, .25 * np.linalg.norm(h[mapping[edges[:, 0]]] - h[mapping[edges[:, 1]]], axis=1))
        gap = np.linalg.norm(d[edges[:, 0]] - d[edges[:, 1]], axis=1)
        max_displacement = max(max_displacement, float(np.linalg.norm(d, axis=1).max()))
        max_neighbor_gap = max(max_neighbor_gap, float(gap.max()))
        static.append({'case': name, 'newNonadjacent': count_new(p[pf], h[hf], source_faces, hf),
                       'overDisplacement': int((np.linalg.norm(d, axis=1) > .00025 + 1e-10).sum()),
                       'overNeighborLimit': int((gap > limits + 1e-10).sum())})
    frames = json.loads((root / 'posed/manifest.json').read_text())['frames']
    hp = np.fromfile(root / 'posed/head.positions.f64', dtype='<f8').reshape(len(frames), -1, 3)
    matrices = np.fromfile(root / 'fixed_linear.f64', dtype='<f8').reshape(len(frames), len(mapping), 3, 3)
    residual = (pt[saved] + morph[saved] - ht[saved][:, mapping]).sum(axis=0)
    posed = []
    for index, frame in enumerate(frames):
        p = hp[index, mapping] + np.einsum('vij,vj->vi', matrices[index], field + residual)
        posed.append({'frame': frame, 'newNonadjacent': count_new(p[pf], hp[index, hf], source_faces, hf)})
    gates = {'static107': len(static) == 107, 'posed73': len(posed) == 73,
             'allStaticDisplacementsWithinBound': not any(r['overDisplacement'] for r in static),
             'allStaticNeighborsWithinLimit': not any(r['overNeighborLimit'] for r in static),
             'allStaticNewNonadjacentFree': not any(r['newNonadjacent'] for r in static),
             'allPosedNewNonadjacentFree': not any(r['newNonadjacent'] for r in posed),
             'candidateResourceRoundtripAndNativeSkinBytes': False}
    result = {'numericCandidate': trial['numericResult'], 'sha256': trial['numericResultSha256'],
              'staticCases': static, 'poseCases': posed, 'gates': gates,
              'summary': {'staticNewNonadjacent': sum(r['newNonadjacent'] for r in static),
                          'posedNewNonadjacent': sum(r['newNonadjacent'] for r in posed),
                          'staticNeighborViolations': sum(r['overNeighborLimit'] for r in static),
                          'staticDisplacementViolations': sum(r['overDisplacement'] for r in static),
                          'maxStaticDisplacement': max_displacement,
                          'maxStaticNeighborGap': max_neighbor_gap,
                          'morphRecordsChangedFromPrior': changed_names},
              'acceptedForImport': all(v for k, v in gates.items() if k != 'candidateResourceRoundtripAndNativeSkinBytes'),
              'limits': ['Numeric arrays only; no candidate resource or native-skin audit exists.',
                         'Sampled contact checks do not prove continuous animation or game rendering.']}
    (HERE / 'finite_pair_verify_summary.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'gates': gates, 'summary': result['summary']}))


if __name__ == '__main__': main()
