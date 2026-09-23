"""Offline morph-aware shell candidate; never imports or promotes a game resource.

The original cut plate inherits the head morph deltas. A converted normal-offset
trial changed some of those deltas, leaving the shell thickness shape-dependent.
This trial restores each mapped head position delta exactly and finds one smooth,
bounded rest-space separation field. It tests the 107 static shapes and 73 sampled
idle poses against finite triangles before any resource conversion is attempted.
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
sys.path.insert(0, str(EXP.parent / '004-plate-import'))
sys.path.insert(0, str(EXP))
from verify_roundtrip import Glb
from triangles import contacts, intersect_pairs, self_test as triangle_self_test
from finite_correction_probe import construct, edges_of, classify_pairs, BOUND, NEIGHBOR_CAP, MORPHS


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def report_path(path):
    path=Path(path).resolve()
    return path.relative_to(WORKSPACE).as_posix() if path.is_relative_to(WORKSPACE) else str(path)


def resolve_report_path(path):
    path=Path(path)
    return path if path.is_absolute() else WORKSPACE/path


def smooth_to_all_case_caps(field, edges, caps, source_root):
    sys.path.insert(0, str(source_root.parent / 'fixed_python'))
    from scipy.sparse import coo_matrix, eye, diags
    from scipy.sparse.linalg import spsolve
    n = len(field)
    degree = np.bincount(edges.ravel(), minlength=n)
    lap = diags(degree.astype(float)) + coo_matrix(
        (np.full(2 * len(edges), -1.),
         (np.r_[edges[:, 0], edges[:, 1]], np.r_[edges[:, 1], edges[:, 0]])),
        shape=(n, n))
    attempts = []
    for lam in [0, .1, .3, 1, 3, 10, 30, 100, 300, 1000]:
        result = field if lam == 0 else np.column_stack([
            spsolve(eye(n, format='csc') + lam * lap.tocsc(), field[:, k])
            for k in range(3)])
        gap = np.linalg.norm(result[edges[:, 0]] - result[edges[:, 1]], axis=1)
        over = int((gap > caps + 1e-10).sum())
        attempts.append({'lambda': lam, 'overLimit': over,
                         'maximumGap': float(gap.max()),
                         'maximumDisplacement': float(np.linalg.norm(result, axis=1).max())})
        if over == 0 and np.linalg.norm(result, axis=1).max() <= BOUND + 1e-10:
            return result, attempts
    raise AssertionError('No bounded all-case-smooth field found')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--rescue', action='store_true', help='Verify the separately generated contact-guided field')
    args = parser.parse_args()
    triangle_self_test()
    prior = json.loads((HERE / 'finite_correction_summary.json').read_text(encoding='utf-8'))
    root = Path(prior['build'])
    build = json.loads((root / 'build.json').read_text(encoding='utf-8'))
    manifest = json.loads((root / 'posed/manifest.json').read_text(encoding='utf-8'))
    source = next(c for c in build['candidates'] if c['name'] == prior['candidateSource'])
    assert source['weightTransfer']['binaryRoundtripSkinBufferExact']
    assert source['weightTransfer']['morphBaseBuffer']['binaryRoundtripSkinBufferExact']
    paths = [Path(build['head']), Path(source['roundtrip']), Path(build['mapping']),
             root / 'posed/head.positions.f64', root / 'fixed_linear.f64',
             HERE / 'finite_contact_summary.json']
    source_hashes = {row['name']: row['sha256'] for row in manifest['surfaces']}
    assert digest(build['head']) == source_hashes['head']
    assert digest(source['roundtrip']) == source_hashes[source['name']]
    head, plate = Glb(Path(build['head'])), Glb(Path(source['roundtrip']))
    mapping = np.asarray(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'], dtype=int)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    pf = plate.array(plate.p['indices']).astype(int).reshape(-1, 3)
    assert len(mapping) == len(plate.attr('POSITION'))
    source_faces = {tuple(sorted(row)): i for i, row in enumerate(hf)}
    source_face_ids = np.array([source_faces[tuple(sorted(row))] for row in mapping[pf]])
    names = head.mesh['extras']['targetNames']
    assert names == plate.mesh['extras']['targetNames'] and len(names) == 105
    frames = manifest['frames']
    assert len(frames) == 73
    hp = np.fromfile(root / 'posed/head.positions.f64', dtype='<f8').reshape(len(frames), -1, 3)
    matrices = np.fromfile(root / 'fixed_linear.f64', dtype='<f8').reshape(len(frames), len(mapping), 3, 3)
    saved_indices = [names.index(name) for name in MORPHS]
    head_base = head.attr('POSITION').astype(float)
    plate_base = plate.attr('POSITION').astype(float)
    head_morph = np.stack([head.array(row['POSITION'])[mapping].astype(float) for row in head.p['targets']])
    plate_morph = np.stack([plate.array(row['POSITION']).astype(float) for row in plate.p['targets']])
    assert head_morph.shape == plate_morph.shape == (105, len(mapping), 3)
    head_saved = head_base[mapping] + head_morph[saved_indices].sum(axis=0)
    plate_saved = plate_base + plate_morph[saved_indices].sum(axis=0)
    seed_field, edges, _, seeds, original_attempts = construct(
        plate_saved - head_saved, head_saved, pf, mapping, hp, hf, matrices,
        frames, json.loads((HERE / 'finite_contact_summary.json').read_text()))
    cases = [('Basis', [])] + [(name, [i]) for i, name in enumerate(names)] + [('saved_v', saved_indices)]
    caps = []
    for _, morphs in cases:
        positions = head_base[mapping] + head_morph[morphs].sum(axis=0) if morphs else head_base[mapping]
        caps.append(np.minimum(NEIGHBOR_CAP, .25 * np.linalg.norm(
            positions[edges[:, 0]] - positions[edges[:, 1]], axis=1)))
    min_caps = np.min(np.stack(caps), axis=0)
    field, attempts = smooth_to_all_case_caps(seed_field, edges, min_caps, root)
    if args.rescue:
        rescue = json.loads((HERE/'morph_contact_rescue_summary.json').read_text())
        result_path = resolve_report_path(rescue['numericResult'])
        assert digest(result_path) == rescue['numericResultSha256']
        field = np.load(result_path)['field']
    base_change = head_base[mapping] + field - plate_base
    morph_residual = plate_morph - head_morph
    preserved_morph_audit = []
    for blend in [0., .25, .5, .75, 1.]:
        trial = (1-blend)*field + blend*field.mean(axis=0)
        rows = []
        for index, (case_name, morphs) in enumerate(cases):
            displacement = trial + morph_residual[morphs].sum(axis=0) if morphs else trial
            gap = np.linalg.norm(displacement[edges[:, 0]]-displacement[edges[:, 1]], axis=1)
            over = int((gap>caps[index]+1e-10).sum())
            if over: rows.append({'case':case_name,'edges':over})
        preserved_morph_audit.append({'uniformBlend':blend,'failingCases':len(rows),
                                      'failingNonEyeCases':sum('eyes' not in r['case'] for r in rows),
                                      'cases':rows})
    # Edit only target records whose static edge field fails. The saved-V
    # combination is checked separately; add its remaining five contributors
    # only if the combined edge field still fails after individual corrections.
    morph_change = np.zeros_like(morph_residual)
    newly_failing = [r['case'] for r in preserved_morph_audit[0]['cases'] if r['case'] != 'saved_v']
    corrected_names = (list(dict.fromkeys(json.loads((HERE/'morph_aware_summary.json').read_text())['field']['correctedMorphNames']
                                      + newly_failing)) if args.rescue else newly_failing)
    for name in corrected_names:
        assert name.endswith('_eyes'), name
        i = names.index(name)
        morph_change[i] = -morph_residual[i]
    saved_displacement = field + (morph_residual[saved_indices]+morph_change[saved_indices]).sum(axis=0)
    saved_gap = np.linalg.norm(saved_displacement[edges[:,0]]-saved_displacement[edges[:,1]],axis=1)
    if not args.rescue and np.any(saved_gap>caps[-1]+1e-10):
        for i in saved_indices:
            morph_change[i] = -morph_residual[i]
            if names[i] not in corrected_names: corrected_names.append(names[i])
    assert np.max(np.linalg.norm(plate_base + base_change - head_base[mapping] - field, axis=1)) < 1e-14
    corrected = [names.index(name) for name in corrected_names]
    assert np.max(np.abs(plate_morph[corrected] + morph_change[corrected] - head_morph[corrected])) < 1e-14
    untouched = [i for i in range(len(names)) if i not in corrected]
    assert np.count_nonzero(morph_change[untouched]) == 0
    generated = EXP / 'generated/morph-aware'
    generated.mkdir(parents=True, exist_ok=True)
    output = generated / ('numeric-contact-rescue.npz' if args.rescue else 'numeric-candidate.npz')
    np.savez_compressed(output, field=field, baseChange=base_change,
                        morphChange=morph_change, mapping=mapping)
    print('Constructed static-consistent morph-aware field; checking 107 shapes', flush=True)
    static_rows = []
    for index, (name, morphs) in enumerate(cases):
        h = head_base.copy()
        p = plate_base + base_change
        if morphs:
            h = head_base + np.stack([head.array(head.p['targets'][i]['POSITION']).astype(float) for i in morphs]).sum(axis=0)
            p += (plate_morph[morphs] + morph_change[morphs]).sum(axis=0)
        d = p - h[mapping]
        gap = np.linalg.norm(d[edges[:, 0]] - d[edges[:, 1]], axis=1)
        limits = caps[index]
        hits = contacts(p[pf], h[hf])
        row = classify_pairs(hits, hf, source_face_ids, h[hf])
        row.update(case=name, maximumDisplacement=float(np.linalg.norm(d, axis=1).max()),
                   overDisplacement=int((np.linalg.norm(d, axis=1) > BOUND + 1e-10).sum()),
                   overNeighborLimit=int((gap > limits + 1e-10).sum()))
        static_rows.append(row)
        if (index + 1) % 20 == 0:
            print(f'Static {index + 1}/{len(cases)}', flush=True)
    print('Checking 73 posed samples', flush=True)
    saved_field = field + (morph_residual[saved_indices]+morph_change[saved_indices]).sum(axis=0)
    posed = hp[:, mapping] + np.einsum('svij,vj->svi', matrices, saved_field)
    pose_rows = []
    for index, frame in enumerate(frames):
        triangles = hp[index, hf]
        hits = contacts(posed[index, pf], triangles)
        row = classify_pairs(hits, hf, source_face_ids, triangles)
        row['frame'] = frame
        pose_rows.append(row)
        if (index + 1) % 10 == 0:
            print(f'Pose {index + 1}/{len(frames)}', flush=True)
    report = {
        'purpose': ('Finite-contact-guided morph-aware numeric field' if args.rescue else 'Numeric morph-aware field') +
                   ', rejected unless every independent static and posed gate passes.',
        'sourceCandidate': source['name'], 'sourceBuild': str(root),
        'numericCandidate': report_path(output), 'numericCandidateSha256': digest(output),
        'field': {'maximumDisplacement': float(np.linalg.norm(field, axis=1).max()),
                  'maximumNeighborGap': float(np.linalg.norm(field[edges[:, 0]]-field[edges[:, 1]], axis=1).max()),
                  'maximumBaseCorrection': float(np.linalg.norm(base_change, axis=1).max()),
                  'maximumMorphCorrection': float(np.linalg.norm(morph_change, axis=2).max()),
                  'morphRecordsWithAnyChange': int((np.linalg.norm(morph_change, axis=2).max(axis=1)>1e-12).sum()),
                  'correctedMorphNames': corrected_names,
                  'vertices': len(mapping), 'triangles': len(pf), 'morphs': len(names),
                  'neutralTopologyAndUVUnchanged': True,
                  'skinBytesInheritedFromVerifiedSource': True},
        'seeds': seeds, 'seedSmoothing': original_attempts, 'allCaseSmoothing': attempts,
        'preservedMorphAudit': preserved_morph_audit,
        'staticCases': static_rows, 'poseCases': pose_rows,
        'gates': {'static107Checked': len(static_rows)==107, 'posed73Checked': len(pose_rows)==73,
                  'allStaticDisplacementsWithinBound': not any(r['overDisplacement'] for r in static_rows),
                  'allStaticNeighborsWithinLimit': not any(r['overNeighborLimit'] for r in static_rows),
                  'allStaticNewNonadjacentFree': not any(r['newNonadjacent'] for r in static_rows),
                  'allPosedNewNonadjacentFree': not any(r['newNonadjacent'] for r in pose_rows),
                  'sourceMeshAndMorphBaseSkinExact': True,
                  'candidateRoundtripAndSkinExact': False},
        'inputs': [{'path': report_path(p), 'sha256': digest(p)} for p in paths],
        'limits': ['Numeric counterfactual only: no candidate mesh or morph binary imported or audited.',
                   'Finite sampled triangle contacts do not prove game rendering or continuous animation.']}
    report['acceptedForImport'] = all(report['gates'].values())
    summary_path = HERE / ('morph_aware_rescue_summary.json' if args.rescue else 'morph_aware_summary.json')
    summary_path.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'field': report['field'], 'gates': report['gates'],
                      'staticNewNonadjacent': sum(r['newNonadjacent'] for r in static_rows),
                      'posedNewNonadjacent': sum(r['newNonadjacent'] for r in pose_rows)}), flush=True)


if __name__ == '__main__':
    main()
