"""Bounded numerical search using finite triangle separating axes.

All output is diagnostic. No game resource is written or selected for use.
"""
import argparse
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


def new_pairs(plate, head, source_faces, head_faces):
    pairs = np.asarray(contacts(plate, head)['pairs'], dtype=int).reshape(-1, 2)
    if not len(pairs):
        return pairs
    mapped = head_faces[source_faces[pairs[:, 0]]]
    other = head_faces[pairs[:, 1]]
    adjacent = (mapped[:, :, None] == other[:, None, :]).any(axis=(1, 2))
    pairs = pairs[~adjacent]
    if not len(pairs):
        return pairs
    native = intersect_pairs(head[source_faces[pairs[:, 0]]], head[pairs[:, 1]])
    return pairs[~native]


def finite_separation(a, b, margin=2e-6):
    """Smallest signed translation of triangle A on finite SAT candidate axes."""
    ae = np.roll(a, -1, axis=0) - a
    be = np.roll(b, -1, axis=0) - b
    axes = [np.cross(ae[0], ae[1]), np.cross(be[0], be[1])]
    axes.extend(np.cross(x, y) for x in ae for y in be)
    best = None
    for axis in axes:
        length = np.linalg.norm(axis)
        if length < 1e-14:
            continue
        axis = axis / length
        ap, bp = a @ axis, b @ axis
        # Either endpoint of a separating interval is a valid direction.
        for shift in (bp.max() - ap.min() + margin, bp.min() - ap.max() - margin):
            if best is None or abs(shift) < np.linalg.norm(best):
                best = shift * axis
    if best is None:
        raise AssertionError('No nondegenerate separating axis')
    return best


def separation_self_test():
    a = np.array([[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]])
    cases = [np.array([[.2, .2, -.2], [.2, .2, .2], [.8, .2, 0.]]),
             np.array([[.1, .1, 0.], [.4, .1, 0.], [.1, .4, 0.]])]
    for b in cases:
        assert intersect_pairs(a[None], b[None])[0]
        move = finite_separation(a, b, 1e-5)
        assert not intersect_pairs((a + move)[None], b[None])[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--passes', type=int, default=8)
    parser.add_argument('--pairwise', action='store_true')
    parser.add_argument('--resume', action='store_true', help='Continue from the prior local numeric result')
    parser.add_argument('--vertexwise', action='store_true', help='Try individual face-vertex movements for residual static contacts')
    args = parser.parse_args()
    self_test()
    separation_self_test()
    previous = json.loads((HERE / 'morph_aware_rescue_summary.json').read_text())
    source_root = Path(previous['sourceBuild'])
    build = json.loads((source_root / 'build.json').read_text())
    source = next(c for c in build['candidates'] if c['name'] == previous['sourceCandidate'])
    assert source['weightTransfer']['binaryRoundtripSkinBufferExact']
    assert source['weightTransfer']['morphBaseBuffer']['binaryRoundtripSkinBufferExact']
    candidate_path = WORKSPACE / previous['numericCandidate']
    if not candidate_path.is_file():
        candidate_path = Path('D:/Dev/cp2077-modding-hq') / previous['numericCandidate']
    assert hashlib.sha256(candidate_path.read_bytes()).hexdigest() == previous['numericCandidateSha256']
    source_numeric_sha = hashlib.sha256(candidate_path.read_bytes()).hexdigest()
    if args.resume:
        prior_trial = json.loads((HERE / 'finite_pair_search_summary.json').read_text())
        candidate_path = WORKSPACE / prior_trial['numericResult']
        assert hashlib.sha256(candidate_path.read_bytes()).hexdigest() == prior_trial['numericResultSha256']
    data = np.load(candidate_path)
    head, plate = Glb(Path(build['head'])), Glb(Path(source['roundtrip']))
    mapping = np.array(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'], dtype=int)
    assert np.array_equal(data['mapping'], mapping)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    pf = plate.array(plate.p['indices']).astype(int).reshape(-1, 3)
    lookup = {tuple(sorted(t)): i for i, t in enumerate(hf)}
    source_faces = np.array([lookup[tuple(sorted(t))] for t in mapping[pf]])
    edges = np.unique(np.sort(np.concatenate([pf[:, [0, 1]], pf[:, [1, 2]], pf[:, [2, 0]]]), axis=1), axis=0)
    names = head.mesh['extras']['targetNames']
    assert len(names) == 105 and names == plate.mesh['extras']['targetNames']
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    pt = np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])
    base = data['field'].copy()
    morph = data['morphChange'].copy()
    residual = pt + morph - ht[:, mapping]
    frames = json.loads((source_root / 'posed/manifest.json').read_text())['frames']
    hp = np.fromfile(source_root / 'posed/head.positions.f64', dtype='<f8').reshape(len(frames), -1, 3)
    matrices = np.fromfile(source_root / 'fixed_linear.f64', dtype='<f8').reshape(len(frames), len(mapping), 3, 3)
    saved = [names.index(n) for n in ['h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear']]
    cases = [('Basis', [])] + [(n, [i]) for i, n in enumerate(names)] + [('saved_v', saved)]
    caps = {}
    for name, ids in cases:
        h = hb[mapping] + ht[ids][:, mapping].sum(axis=0) if ids else hb[mapping]
        caps[name] = np.minimum(5e-5, .25 * np.linalg.norm(h[edges[:, 0]] - h[edges[:, 1]], axis=1))
    case_residuals = {name: residual[ids].sum(axis=0) if ids else np.zeros_like(base) for name, ids in cases}
    static_names = [r['case'] for r in previous['staticCases'] if r['newNonadjacent']]
    pose_indices = [i for i, r in enumerate(previous['poseCases']) if r['newNonadjacent']]
    # Eye-specific static corrections do not change the five-morph posed input.
    assert all(n.endswith('_eyes') and names.index(n) not in saved for n in static_names)

    def shape_ok(field, adjustment=None, name=None):
        for case_name, case_residual in case_residuals.items():
            combined = field + (adjustment if case_name == name else case_residual)
            if np.linalg.norm(combined, axis=1).max() > .00025 + 1e-10:
                return False
            gap = np.linalg.norm(combined[edges[:, 0]] - combined[edges[:, 1]], axis=1)
            if np.any(gap > caps[case_name] + 1e-10):
                return False
        return True

    def static_context(name, field, corrections):
        i = names.index(name)
        h = hb + ht[i]
        p = h[mapping] + field + residual[i] + corrections[i]
        pairs = new_pairs(p[pf], h[hf], source_faces, hf)
        return pairs, p, h, np.broadcast_to(np.eye(3), (len(mapping), 3, 3))

    def pose_context(index, field):
        h = hp[index]
        d = field + residual[saved].sum(axis=0)
        p = h[mapping] + np.einsum('vij,vj->vi', matrices[index], d)
        pairs = new_pairs(p[pf], h[hf], source_faces, hf)
        return pairs, p, h, matrices[index]

    def proposals(pairs, p, h, linear):
        delta = np.zeros_like(base)
        count = np.zeros(len(base))
        sizes = []
        for pi, hi in pairs:
            vector = finite_separation(p[pf[pi]], h[hf[hi]])
            sizes.append(float(np.linalg.norm(vector)))
            for v in pf[pi]:
                delta[v] += np.linalg.solve(linear[v], vector)
                count[v] += 1
        active = count > 0
        delta[active] /= count[active, None]
        # One-ring taper keeps the shared triangular surface coherent.
        outer = np.zeros_like(delta)
        weights = np.zeros(len(base))
        for v, w in edges:
            if active[v] and not active[w]:
                outer[w] += delta[v] * .35; weights[w] += 1
            if active[w] and not active[v]:
                outer[v] += delta[w] * .35; weights[v] += 1
        mask = weights > 0
        delta[mask] = outer[mask] / weights[mask, None]
        return delta, sizes

    corrections = np.zeros_like(morph)
    history = []
    for step in range(args.passes):
        improved = False
        for name in static_names:
            i = names.index(name)
            pairs, p, h, linear = static_context(name, base, corrections)
            if not len(pairs):
                continue
            delta, sizes = proposals(pairs, p, h, linear)
            best = None
            for scale in (.25, .5, 1., 1.5, 2., 3.):
                trial = corrections[i] + scale * delta
                if not shape_ok(base, residual[i] + trial, name):
                    continue
                trial_corrections = corrections.copy()
                trial_corrections[i] = trial
                next_pairs = static_context(name, base, trial_corrections)[0]
                if len(next_pairs) < len(pairs) and (best is None or len(next_pairs) < best[0]):
                    best = (len(next_pairs), trial, scale)
            if best:
                corrections[i] = best[1]; improved = True
                case_residuals[name] = residual[i] + corrections[i]
                history.append({'pass': step, 'case': name, 'before': len(pairs), 'after': best[0], 'scale': best[2], 'maxSatTranslation': max(sizes)})
                print(json.dumps(history[-1]), flush=True)
        pose_rows = [(index, pose_context(index, base)) for index in pose_indices]
        pose_score = sum(len(row[0]) for _, row in pose_rows)
        if pose_score:
            delta = np.zeros_like(base)
            weights = np.zeros(len(base))
            for index, (pairs, p, h, linear) in pose_rows:
                if not len(pairs):
                    continue
                proposal, _ = proposals(pairs, p, h, linear)
                active = np.linalg.norm(proposal, axis=1) > 0
                delta[active] += proposal[active]
                weights[active] += 1
            active = weights > 0
            delta[active] /= weights[active, None]
            best = None
            for scale in (.25, .5, 1., 1.5, 2., 3.):
                trial = base + scale * delta
                if not shape_ok(trial):
                    continue
                score = sum(len(pose_context(index, trial)[0]) for index in pose_indices)
                if score < pose_score and (best is None or score < best[0]):
                    best = (score, trial, scale)
            if best:
                base = best[1]; improved = True
                history.append({'pass': step, 'case': 'sampled_poses', 'before': pose_score, 'after': best[0], 'scale': best[2]})
                print(json.dumps(history[-1]), flush=True)
        if not improved:
            break
    if args.pairwise:
        # Resolve a single measured finite pair at a time when averaged
        # translations for nearby folds cancel one another.
        for step in range(3):
            improved = False
            for name in static_names:
                i = names.index(name)
                pairs, p, h, linear = static_context(name, base, corrections)
                for pi, hi in pairs:
                    delta, _ = proposals(np.array([[pi, hi]]), p, h, linear)
                    best = None
                    for scale in (.5, 1., 2., 3., -1., -2.):
                        trial = corrections[i] + scale * delta
                        if not shape_ok(base, residual[i] + trial, name):
                            continue
                        trial_corrections = corrections.copy(); trial_corrections[i] = trial
                        score = len(static_context(name, base, trial_corrections)[0])
                        if score < len(pairs) and (best is None or score < best[0]):
                            best = score, trial, scale
                    if best:
                        corrections[i] = best[1]; improved = True
                        case_residuals[name] = residual[i] + corrections[i]
                        history.append({'pass': f'pairwise-{step}', 'case': name, 'before': len(pairs), 'after': best[0], 'scale': best[2]})
                        print(json.dumps(history[-1]), flush=True)
                        break
            pose_rows = [(index, pose_context(index, base)) for index in pose_indices]
            pose_score = sum(len(row[0]) for _, row in pose_rows)
            best = None
            for index, (pairs, p, h, linear) in pose_rows:
                for pi, hi in pairs:
                    delta, _ = proposals(np.array([[pi, hi]]), p, h, linear)
                    for scale in (.5, 1., 2., 3., -1., -2.):
                        trial = base + scale * delta
                        if not shape_ok(trial):
                            continue
                        score = sum(len(pose_context(j, trial)[0]) for j in pose_indices)
                        if score < pose_score and (best is None or score < best[0]):
                            best = score, trial, scale, int(frames[index]), int(pi), int(hi)
            if best:
                base = best[1]; improved = True
                history.append({'pass': f'pairwise-{step}', 'case': 'sampled_poses', 'before': pose_score,
                                'after': best[0], 'scale': best[2], 'sourceFrame': best[3],
                                'plateFace': best[4], 'headFace': best[5]})
                print(json.dumps(history[-1]), flush=True)
            if not improved:
                break
    if args.vertexwise:
        for name in static_names:
            i = names.index(name)
            while True:
                pairs, p, h, _ = static_context(name, base, corrections)
                best = None
                for pi, hi in pairs:
                    vector = finite_separation(p[pf[pi]], h[hf[hi]])
                    for vertex in pf[pi]:
                        for scale in (.5, 1., 2., 3., -1., -2.):
                            trial = corrections[i].copy()
                            trial[vertex] += scale * vector
                            if not shape_ok(base, residual[i] + trial, name):
                                continue
                            trial_corrections = corrections.copy(); trial_corrections[i] = trial
                            score = len(static_context(name, base, trial_corrections)[0])
                            if score < len(pairs) and (best is None or score < best[0]):
                                best = (score, trial, int(pi), int(hi), int(vertex), scale)
                if best is None:
                    break
                corrections[i] = best[1]
                case_residuals[name] = residual[i] + corrections[i]
                history.append({'pass': 'vertexwise', 'case': name, 'before': len(pairs), 'after': best[0],
                                'plateFace': best[2], 'headFace': best[3], 'vertex': best[4], 'scale': best[5]})
                print(json.dumps(history[-1]), flush=True)
    output = EXP / 'generated/morph-aware/finite-pair-search.npz'
    output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(output, field=base, baseChange=hb[mapping] + base - plate.attr('POSITION').astype(float),
                        morphChange=morph + corrections, mapping=mapping)
    counts = {'static': {name: len(static_context(name, base, corrections)[0]) for name in static_names},
              'poses': {str(frames[i]): len(pose_context(i, base)[0]) for i in pose_indices}}
    remaining = []
    for label, row in ([(name, static_context(name, base, corrections)) for name in static_names] +
                       [(f'frame-{frames[i]}', pose_context(i, base)) for i in pose_indices]):
        pairs, p, h, _ = row
        for pi, hi in pairs:
            shift = finite_separation(p[pf[pi]], h[hf[hi]])
            remaining.append({'case': label, 'plateFace': int(pi), 'headFace': int(hi),
                              'plateVertices': pf[pi].tolist(), 'satMove': shift.tolist(),
                              'satMoveLength': float(np.linalg.norm(shift))})
    result = {'sourceReportSha256': hashlib.sha256((HERE / 'morph_aware_rescue_summary.json').read_bytes()).hexdigest(),
              'sourceNumericSha256': previous['numericCandidateSha256'],
              'resumedFromSha256': source_numeric_sha if not args.resume else prior_trial['numericResultSha256'],
              'numericResult': output.relative_to(WORKSPACE).as_posix(),
              'numericResultSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
              'method': 'finite triangle separating-axis translations with local one-ring taper and bounded exact-contact line search',
              'history': history, 'criticalContactCounts': counts, 'remainingFinitePairs': remaining,
              'warning': 'Diagnostic numeric search only. Full static, posed, resource, and skin gates remain independent.'}
    (HERE / 'finite_pair_search_summary.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(counts), flush=True)


if __name__ == '__main__':
    main()
