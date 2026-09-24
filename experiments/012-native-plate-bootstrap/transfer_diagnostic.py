"""Diagnose transfer of a prior morph-aware plate field to the exact native cut.

Read-only with respect to game resources: all plate positions below exist only as
NumPy arrays. The old seam-expanded plate is a *rejected* research input. A
passing result here would still need optimization, import and independent audit.
"""
import argparse
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / '004-plate-import'), str(HERE.parent / '006-plate-clearance')]
from verify_roundtrip import Glb  # noqa: E402
from verify_crease_roundtrip import new_pairs  # noqa: E402
from triangles import self_test  # noqa: E402

HEAD_SHA = '0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730'
NATIVE_SHA = '0571c4da09595009dbc7e4e305518e95f18a58ba4c59bf51e97e7d56d0f060ea'
PRIOR_SHA = '8f37b8a91f0a502ba8d586b5077c70dfce58f16fd76cc5593bef74aa460c6646'
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
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--native-map', type=Path, required=True)
    parser.add_argument('--prior-packed', type=Path, required=True)
    parser.add_argument('--prior-map', type=Path, required=True)
    parser.add_argument('--poses', type=Path, required=True,
                        help='73-pose source build with posed/head.positions.f64 and fixed_linear.f64')
    parser.add_argument('--dense', type=Path, help='Optional independent 664-frame bake')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--summary-output', type=Path, help='Asset-free tracked evidence')
    args = parser.parse_args()
    self_test()
    assert sha(args.head) == HEAD_SHA
    assert sha(args.native) == NATIVE_SHA
    assert sha(args.prior_packed) == PRIOR_SHA
    head, native, prior = (Glb(p) for p in (args.head, args.native, args.prior_packed))
    mapping = np.asarray(json.loads(args.native_map.read_text())['plateToHeadIndices'], dtype=int)
    old_mapping = np.asarray(json.loads(args.prior_map.read_text())['plateToHeadIndices'], dtype=int)
    assert len(mapping) == 1620 and len(set(mapping)) == 1620
    assert len(old_mapping) == 1635 and set(mapping) == set(old_mapping)
    names = head.mesh['extras']['targetNames']
    assert names == native.mesh['extras']['targetNames'] == prior.mesh['extras']['targetNames']
    assert len(names) == 105
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    nb = native.attr('POSITION').astype(float)
    nt = np.stack([native.array(t['POSITION']).astype(float) for t in native.p['targets']])
    assert np.array_equal(nb, hb[mapping]) and np.array_equal(nt, ht[:, mapping])
    pb = prior.attr('POSITION').astype(float)
    pt = np.stack([prior.array(t['POSITION']).astype(float) for t in prior.p['targets']])
    old_base = pb - hb[old_mapping]
    old_morph = pt - ht[:, old_mapping]
    groups = defaultdict(list)
    for i, h in enumerate(old_mapping):
        groups[int(h)].append(i)
    base = np.stack([old_base[groups[int(h)]].mean(axis=0) for h in mapping])
    morph = np.stack([old_morph[:, groups[int(h)]].mean(axis=1) for h in mapping], axis=1)
    duplicate_spread = sorted((float(np.max(np.linalg.norm(
        old_base[rows][:, None] - old_base[rows][None], axis=2))), int(h))
        for h, rows in groups.items() if len(rows) > 1)
    duplicate_morph_spread = sorted((float(np.max(np.linalg.norm(
        old_morph[:, rows, None] - old_morph[:, None, rows], axis=3))), int(h))
        for h, rows in groups.items() if len(rows) > 1)
    pf = native.array(native.p['indices']).astype(int).reshape(-1, 3)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    old_pf = prior.array(prior.p['indices']).astype(int).reshape(-1, 3)
    assert {tuple(sorted(row)) for row in mapping[pf]} == {
        tuple(sorted(row)) for row in old_mapping[old_pf]}
    face_lookup = {tuple(sorted(row)): i for i, row in enumerate(hf)}
    source_faces = np.asarray([face_lookup[tuple(sorted(row))] for row in mapping[pf]])
    edges = edges_of(pf)
    saved = [names.index(name) for name in SAVED]
    cases = [('Basis', [])] + [(name, [i]) for i, name in enumerate(names)] + [('saved_v', saved)]
    static = []
    edge_vectors = []
    edge_caps = []
    failing_edge_ids = set()
    for label, indices in cases:
        h = hb + ht[indices].sum(axis=0) if indices else hb
        d = base + morph[indices].sum(axis=0) if indices else base
        plate = h[mapping] + d
        caps = np.minimum(5e-5, .25 * np.linalg.norm(
            h[mapping[edges[:, 0]]] - h[mapping[edges[:, 1]]], axis=1))
        gaps = np.linalg.norm(d[edges[:, 0]] - d[edges[:, 1]], axis=1)
        hits = new_pairs(plate[pf], h[hf], source_faces, hf)
        over = np.flatnonzero(gaps > caps + 1e-10)
        failing_edge_ids.update(int(e) for e in over)
        edge_vectors.append(d[edges[:, 0]] - d[edges[:, 1]])
        edge_caps.append(caps)
        static.append({'case': label, 'newNonadjacent': int(len(hits)),
                       'neighborViolations': int(len(over)),
                       'minimumNeighborSlack': float(np.min(caps - gaps)),
                       'maximumDisplacement': float(np.max(np.linalg.norm(d, axis=1))),
                       'pairs': [{'plateFace': int(a), 'headFace': int(b),
                                  'plateVertices': pf[a].tolist(),
                                  'nativeHeadVertices': mapping[pf[a]].tolist()}
                                 for a, b in hits],
                       'violatingEdges': [{'nativeHeadVertices': mapping[edges[e]].tolist(),
                                           'excess': float(gaps[e] - caps[e])}
                                          for e in over]})
    edge_vectors = np.stack(edge_vectors)
    edge_caps = np.stack(edge_caps)
    certificates = []
    for edge in sorted(failing_edge_ids):
        vectors = edge_vectors[:, edge]
        distance = np.linalg.norm(vectors[:, None] - vectors[None], axis=2)
        cap = edge_caps[:, edge]
        excess = distance - cap[:, None] - cap[None]
        np.fill_diagonal(excess, -np.inf)
        a, b = np.unravel_index(np.argmax(excess), excess.shape)
        if excess[a, b] > 1e-10:
            certificates.append({'nativeHeadVertices': mapping[edges[edge]].tolist(),
                                 'cases': [cases[a][0], cases[b][0]],
                                 'pairwiseExcess': float(excess[a, b])})
    old_manifest = json.loads((args.poses / 'posed/manifest.json').read_text())
    frames = old_manifest['frames']
    assert len(frames) == 73 and old_manifest['surfaces'][0]['sha256'] == HEAD_SHA
    indices = np.asarray([groups[int(h)][0] for h in mapping])
    hp = np.memmap(args.poses / 'posed/head.positions.f64', dtype='<f8', mode='r',
                   shape=(73, len(hb), 3))
    old_linear = np.memmap(args.poses / 'fixed_linear.f64', dtype='<f8', mode='r',
                           shape=(73, len(old_mapping), 3, 3))
    duplicate_rows = [rows for rows in groups.values() if len(rows) > 1]
    pose_duplicate_error = max(float(np.max(np.abs(
        old_linear[:, rows] - old_linear[:, rows[0], None]))) for rows in duplicate_rows)
    assert pose_duplicate_error < 1e-10, 'Prior seam copies have different 73-pose skin matrices'
    saved_residual = base + morph[saved].sum(axis=0)
    posed = []
    for j, frame in enumerate(frames):
        plate = hp[j, mapping] + np.einsum('vij,vj->vi', old_linear[j, indices], saved_residual)
        hits = new_pairs(plate[pf], hp[j, hf], source_faces, hf)
        if len(hits):
            posed.append({'frame': frame, 'pairs': hits.tolist()})
    dense_hits = []
    if args.dense:
        manifest = json.loads((args.dense / 'manifest.json').read_text())
        assert manifest['inputHashes']['head'] == HEAD_SHA and manifest['frames'] == list(range(664))
        dense_hp = np.memmap(args.dense / 'head.positions.f64', dtype='<f8', mode='r',
                             shape=(664, len(hb), 3))
        dense_linear = np.memmap(args.dense / 'fixed_linear.f64', dtype='<f8', mode='r',
                                 shape=(664, len(old_mapping), 3, 3))
        dense_duplicate_error = max(float(np.max(np.abs(
            dense_linear[:, rows] - dense_linear[:, rows[0], None]))) for rows in duplicate_rows)
        assert dense_duplicate_error < 1e-10, 'Prior seam copies have different dense skin matrices'
        assert max(float(np.max(np.abs(dense_hp[f] - hp[j]))) for j, f in enumerate(frames)) < 1e-10
        assert max(float(np.max(np.abs(dense_linear[f, indices] - old_linear[j, indices])))
                   for j, f in enumerate(frames)) < 1e-10
        for frame in manifest['frames']:
            plate = dense_hp[frame, mapping] + np.einsum(
                'vij,vj->vi', dense_linear[frame, indices], saved_residual)
            hits = new_pairs(plate[pf], dense_hp[frame, hf], source_faces, hf)
            if len(hits):
                dense_hits.append({'frame': frame, 'pairs': hits.tolist()})
            if frame % 100 == 0:
                print(f'Dense contact frame {frame}/663', flush=True)
    report = {
        'schema': 'xfs/native-plate-transfer-diagnostic-1',
        'inputSha256': {key: sha(path) for key, path in (
            ('head', args.head), ('native', args.native), ('nativeMap', args.native_map),
            ('priorPacked', args.prior_packed), ('priorMap', args.prior_map))},
        'sampleSha256': {key: sha(path) for key, path in (
            ('posedManifest', args.poses / 'posed/manifest.json'),
            ('posedHead', args.poses / 'posed/head.positions.f64'),
            ('posedSkinLinear', args.poses / 'fixed_linear.f64'),
            *([('denseManifest', args.dense / 'manifest.json'),
               ('denseHead', args.dense / 'head.positions.f64'),
               ('denseSkinLinear', args.dense / 'fixed_linear.f64')] if args.dense else []))},
        'source': 'Rejected, seam-expanded postpack morph-aware correction collapsed by arithmetic mean per native head vertex',
        'duplicateHeadVertices': len(duplicate_spread),
        'maximumDuplicateBaseOffsetDifference': duplicate_spread[-1][0],
        'worstDuplicateHeadVertex': duplicate_spread[-1][1],
        'maximumDuplicateMorphOffsetDifference': duplicate_morph_spread[-1][0],
        'worstDuplicateMorphHeadVertex': duplicate_morph_spread[-1][1],
        'staticCases': len(static), 'staticNewNonadjacent': sum(r['newNonadjacent'] for r in static),
        'staticCasesWithContacts': [r['case'] for r in static if r['newNonadjacent']],
        'staticNeighborViolations': sum(r['neighborViolations'] for r in static),
        'distinctFailingEdges': len(failing_edge_ids),
        'baseOnlyIncompatibleEdges': len(certificates),
        'baseOnlyIncompatibilityWitnesses': certificates,
        'staticCasesWithNeighborViolations': [r['case'] for r in static if r['neighborViolations']],
        'staticFailureDetails': [r for r in static if r['newNonadjacent'] or r['neighborViolations']],
        'minimumStaticNeighborSlack': min(r['minimumNeighborSlack'] for r in static),
        'maximumStaticDisplacement': max(r['maximumDisplacement'] for r in static),
        'posedSamples': len(frames), 'posedNewContactFrames': posed,
        'maximumDuplicatePoseSkinMatrixError': pose_duplicate_error,
        'denseSamples': 664 if args.dense else None, 'denseNewContactFrames': dense_hits,
        'maximumDuplicateDenseSkinMatrixError': dense_duplicate_error if args.dense else None,
        'gate': 'FAIL' if (sum(r['newNonadjacent'] + r['neighborViolations'] for r in static)
                           or max(r['maximumDisplacement'] for r in static) > .00025 + 1e-10
                           or posed or dense_hits) else 'NUMERIC_ONLY',
        'limits': 'No numeric candidate GLB or resource was created. A numeric pass would still require native topology/skin-preserving import, resource readback, visibility, continuous pose and game validation.',
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    if args.summary_output:
        summary = {key: report[key] for key in (
            'schema', 'inputSha256', 'sampleSha256', 'source', 'duplicateHeadVertices',
            'maximumDuplicateBaseOffsetDifference', 'worstDuplicateHeadVertex',
            'maximumDuplicateMorphOffsetDifference', 'worstDuplicateMorphHeadVertex',
            'staticCases', 'staticNewNonadjacent', 'staticCasesWithContacts',
            'staticNeighborViolations', 'distinctFailingEdges', 'baseOnlyIncompatibleEdges',
            'baseOnlyIncompatibilityWitnesses', 'minimumStaticNeighborSlack',
            'maximumStaticDisplacement', 'posedSamples', 'posedNewContactFrames',
            'maximumDuplicatePoseSkinMatrixError', 'denseSamples',
            'denseNewContactFrames', 'maximumDuplicateDenseSkinMatrixError', 'gate', 'limits')}
        summary['staticContactWitnesses'] = [
            {'case': row['case'], 'pairs': row['pairs']}
            for row in static if row['newNonadjacent']]
        summary['worstNeighborWitnesses'] = sorted((
            {'case': row['case'], **edge} for row in static
            for edge in row['violatingEdges']),
            key=lambda row: row['excess'], reverse=True)[:8]
        args.summary_output.parent.mkdir(parents=True, exist_ok=True)
        args.summary_output.write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('staticNewNonadjacent', 'staticNeighborViolations',
        'minimumStaticNeighborSlack', 'maximumStaticDisplacement', 'posedNewContactFrames',
        'denseNewContactFrames', 'gate')}))


if __name__ == '__main__':
    main()
