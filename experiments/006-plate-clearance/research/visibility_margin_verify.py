"""Independent two-tier certificate verification: no optimizer imported."""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
sys.path.insert(0, str(EXP.parent/'004-plate-import'))
from verify_roundtrip import Glb


def main():
    root = Path(json.loads((EXP/'fixed_summary.json').read_text(encoding='utf-8'))['build'])
    report_path = root/'visibility_margin_solutions.json'
    report = json.loads(report_path.read_text(encoding='utf-8'))
    for item in report['inputs']:
        assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest() == item['sha256']
    fixed = json.loads((root/'fixed_feasibility.json').read_text(encoding='utf-8'))
    samples = json.loads((root/'visibility_margin_samples.json').read_text(encoding='utf-8'))
    build = json.loads((root/'build.json').read_text(encoding='utf-8'))
    head = Glb(Path(build['head']))
    faces = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    positions = np.fromfile(root/'posed/head.positions.f64', dtype='<f8').reshape(len(report['frames']), -1, 3)
    matrices = np.fromfile(root/'fixed_linear.f64', dtype='<f8').reshape(len(positions), fixed['vertices'], 3, 3)
    observations = {(r['frame'], r['headTriangle']): r for r in samples['rows']}
    original = {r['headVertex']: r for r in fixed['verticesReport']}
    radius = report['bound']/report['unit']
    verified, counts, worst_slack, smallest_separation = [], {}, 0., float('inf')
    for row in report['rows']:
        ids = np.flatnonzero((faces == row['headVertex']).any(axis=1)).tolist()
        assert ids == row['incidentFaces'] == original[row['headVertex']]['incidentTriangles']
        assert row['plateVertex'] == original[row['headVertex']]['plateVertex']
        a, b = [], []
        for s, frame in enumerate(report['frames']):
            for fid in ids:
                tri = positions[s, faces[fid]]
                normal = np.cross(tri[1]-tri[0], tri[2]-tri[0])
                normal /= np.linalg.norm(normal)
                a.append(normal @ matrices[s, row['plateVertex']])
                observation = observations[(frame, fid)]
                expected_positive = observation['category'] != 'sampled-hidden'
                assert expected_positive == observation['positiveMargin']
                b.append(row['margin']/report['unit'] if expected_positive else 0.)
        a, b = np.array(a), np.array(b)
        status = row['status']; counts[status] = counts.get(status, 0)+1
        kept = {k: row[k] for k in ['headVertex', 'plateVertex', 'margin', 'status', 'positiveConstraints', 'zeroConstraints']}
        if status == 'feasible':
            q = np.array(row['q'])
            slack = a@q-b
            assert slack.min() >= -1e-7 and np.linalg.norm(q) <= radius+1e-7
            worst_slack = min(worst_slack, float(slack.min()))
            kept['displacementNorm'] = float(np.linalg.norm(q)*report['unit'])
            kept['minimumSlackUnits'] = float(slack.min()*report['unit'])
        elif status == 'bounded-failure-certified':
            cert = row['certificate']
            lam, indexes = np.array(cert['weights']), cert['indices']
            assert lam.min() >= 0 and abs(lam.sum()-1) < 1e-8
            required = float(b[indexes]@lam)
            reachable = float(radius*np.linalg.norm(a[indexes].T@lam))
            assert required > reachable+1e-8
            assert abs(required-cert['required']) < 1e-8 and abs(reachable-cert['reachable']) < 1e-8
            smallest_separation = min(smallest_separation, required-reachable)
            kept['verifiedCertificateSeparation'] = required-reachable
            kept['activePlanes'] = [{**plane, 'weight': float(weight)} for plane, weight in zip(row['activePlanes'], lam)]
        else:
            raise AssertionError('Unresolved numerical case')
        verified.append(kept)
    negative_controls = []
    for control in report['negativeControls']:
        old = original[control['headVertex']]
        cert = old.get('opposedDualCertificate', old.get('normDualCertificate'))
        weights = np.array(cert['weights']); weights /= weights.sum()
        combined, required = np.zeros(3), 0.
        for i, weight in zip(cert['indices'], weights):
            s, local = divmod(i, len(old['incidentTriangles']))
            fid = old['incidentTriangles'][local]
            tri = positions[s, faces[fid]]
            normal = np.cross(tri[1]-tri[0], tri[2]-tri[0]); normal /= np.linalg.norm(normal)
            combined += weight*(normal@matrices[s, old['plateVertex']])
            required += weight*observations[(report['frames'][s], fid)]['positiveMargin']
        separated = required > radius*np.linalg.norm(combined)+1e-8
        assert separated == control['retainedCertificateRejectsOriginalMargin']
        if separated:
            negative_controls.append(control['headVertex'])
    assert {5631, 5981, 6471} <= set(negative_controls)
    # The 1,625 previously verified all-positive feasible vertices remain feasible
    # under lower RHS constraints; no new whole-field displacement is synthesized.
    baseline = json.loads((root/'fixed_verification.json').read_text(encoding='utf-8'))
    assert baseline['passed'] and baseline['reportSha256'] == hashlib.sha256((root/'fixed_feasibility.json').read_bytes()).hexdigest()
    old_delta = np.fromfile(root/'fixed_displacement_diagnostic.f64', dtype='<f8').reshape(-1, 3)
    rechecked = 0
    for row in fixed['verticesReport']:
        if row['status'] != 'feasible':
            continue
        ids = np.flatnonzero((faces == row['headVertex']).any(axis=1))
        tri = positions[:, faces[ids]]
        normal = np.cross(tri[:, :, 1]-tri[:, :, 0], tri[:, :, 2]-tri[:, :, 0])
        normal /= np.linalg.norm(normal, axis=2)[:, :, None]
        a = np.vstack([normal[s] @ matrices[s, row['plateVertex']] for s in range(len(positions))])
        q = old_delta[row['plateVertex']]/report['unit']
        assert np.min(a@q) >= 1-1e-7 and np.linalg.norm(q) <= radius+1e-7
        rechecked += 1
    assert rechecked == baseline['verifiedStatuses']['feasible']
    assert not any(m == 'scipy.optimize' or m.startswith('scipy.optimize.') for m in sys.modules)
    margins = []
    for margin in [.00005, .00004, .000025]:
        subset = [r for r in verified if r['margin'] == margin]
        feasible = sum(r['status'] == 'feasible' for r in subset)
        margins.append({'margin': margin, 'newlyFeasibleOfTen': feasible,
                        'totalIndependentFeasibleByMonotonicity': baseline['verifiedStatuses']['feasible']+feasible,
                        'remainingFailedVertices': [r['headVertex'] for r in subset if r['status'] != 'feasible']})
    metadata = {'build': str(root), 'passed': True, 'optimizerImported': False,
                'verification': counts, 'worstAcceptedSlackRatio': worst_slack,
                'smallestCertificateSeparation': smallest_separation,
                'negativeControlOriginalCertificatesRetained': negative_controls,
                'originalFeasibleVectorsIndependentlyRechecked': rechecked,
                'visibility': {'frames': len(samples['frames']), 'views': len(samples['viewDirections']),
                               'strictInteriorSamplesPerFaceView': len(samples['barycentricSamples']),
                               'faces': len(samples['headFaces']), 'counts': samples['counts'],
                               'newPositiveFacePoses': samples['newPositiveFacePoses']},
                'newPositiveFacePoses': [{k: r[k] for k in ['frame', 'headTriangle', 'category', 'visibleRayCount', 'witness']}
                                         for r in samples['rows'] if r['positiveMargin'] and not r['previouslyExposed']],
                'sampledHiddenFacePoses': [{'frame': r['frame'], 'headTriangle': r['headTriangle']}
                                          for r in samples['rows'] if not r['positiveMargin']],
                'margins': margins, 'vertices': verified,
                'inputs': report['inputs']+[{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                                           for p in [report_path, root/'fixed_displacement_diagnostic.f64']],
                'limits': ['Finite views/poses, saved-V shape only. Hidden is sampled-hidden, never proven invisible.',
                           'Infinite incident-plane constraints remain more restrictive than finite-surface collision avoidance.',
                           'No full field, smoothness/contact/morph/import check or game-render evidence is created.',
                           'No geometry or original experimental output was modified.'],
                'scripts': [{'path': str(HERE/name), 'sha256': hashlib.sha256((HERE/name).read_bytes()).hexdigest()}
                            for name in ['visibility_margin_sample.py', 'visibility_margin_solve.py', 'visibility_margin_verify.py']]}
    (HERE/'visibility_margin_summary.json').write_text(json.dumps(metadata, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: metadata[k] for k in ['passed', 'verification', 'worstAcceptedSlackRatio', 'smallestCertificateSeparation', 'margins']}))


if __name__ == '__main__':
    main()
