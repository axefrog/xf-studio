"""Two-tier fixed-plane diagnostic. Produces certificates, never geometry."""
import hashlib
import json
from pathlib import Path
import sys
HERE = Path(__file__).resolve().parent
EXP = HERE.parent
sys.path.insert(0, str(EXP/'generated/fixed_python'))
import numpy as np
import scipy
from scipy.optimize import minimize, linprog, nnls
sys.path.insert(0, str(EXP.parent/'004-plate-import'))
from verify_roundtrip import Glb

UNIT, BOUND = .00005, .00025
RADIUS = BOUND/UNIT


def sparse(lam):
    ids = np.flatnonzero(lam > 0)
    return {'indices': ids.tolist(), 'weights': lam[ids].tolist()}


def certificate(a, b, lam):
    lam = np.maximum(lam, 0)
    # Unit L1 normalization keeps absolute verification tolerance meaningful.
    if lam.sum() <= 0:
        return None
    lam /= lam.sum()
    required = float(b @ lam)
    reachable = float(RADIUS*np.linalg.norm(a.T @ lam))
    if required <= reachable + 1e-8:
        return None
    return {**sparse(lam), 'required': required, 'reachable': reachable, 'separation': required-reachable}


def solve(a, b):
    fit = minimize(lambda q: .5*q@q, np.zeros(3), jac=lambda q: q,
                   constraints={'type': 'ineq', 'fun': lambda q: a@q-b, 'jac': lambda q: a},
                   method='SLSQP', options={'ftol': 1e-11, 'maxiter': 300})
    q, slack = fit.x, a@fit.x-b
    result = {'optimizerSuccess': bool(fit.success), 'norm': float(np.linalg.norm(q)),
              'minimumSlack': float(slack.min()), 'q': q.tolist()}
    if slack.min() >= -1e-7 and np.linalg.norm(q) <= RADIUS+1e-7:
        return {**result, 'status': 'feasible'}
    cert = None
    if slack.min() >= -1e-7:
        active = np.flatnonzero(slack < 1e-5)
        lam_active, _ = nnls(a[active].T, q, maxiter=1000)
        lam = np.zeros(len(a)); lam[active] = lam_active
        cert = certificate(a, b, lam)
    if cert is None:
        # Bounded contradiction remains valid despite nonzero numerical cancellation.
        lp = linprog(np.zeros(len(a)), A_eq=np.vstack([a.T, b]), b_eq=[0, 0, 0, 1],
                     bounds=(0, None), method='highs')
        if lp.success:
            cert = certificate(a, b, lp.x)
    if cert is None:
        # Max common positive-margin scale; hidden constraints retain zero RHS.
        relaxed = minimize(lambda x: -x[3], np.zeros(4), jac=lambda x: np.array([0., 0, 0, -1]),
            constraints=[{'type': 'ineq', 'fun': lambda x: a@x[:3]-b*x[3],
                          'jac': lambda x: np.column_stack([a, -b])},
                         {'type': 'ineq', 'fun': lambda x: RADIUS**2-x[:3]@x[:3],
                          'jac': lambda x: np.r_[-2*x[:3], 0]}],
            method='SLSQP', options={'ftol': 1e-11, 'maxiter': 300})
        cert = certificate(a, b, relaxed.multipliers[:len(a)])
    return {**result, 'status': 'bounded-failure-certified' if cert else 'unresolved', 'certificate': cert}


def self_test():
    fixtures = [(np.eye(3), np.array([1., 1, 0]), 'feasible'),
                (np.array([[1., 0, 0], [-1, 0, 0]]), np.array([1., 0]), 'bounded-failure-certified'),
                (np.array([[1., 0, .1], [-1, 0, .1]]), np.array([1., 1]), 'bounded-failure-certified'),
                (np.array([[1., 0, .1], [-1, 0, .1]]), np.array([.4, .4]), 'feasible'),
                (np.eye(3), np.zeros(3), 'feasible')]
    for a, b, expected in fixtures:
        result = solve(a, b)
        assert result['status'] == expected, result
        if expected == 'feasible':
            q = np.array(result['q']); assert np.min(a@q-b) >= -1e-7 and np.linalg.norm(q) <= 5+1e-7
        else:
            c = result['certificate']; w = np.array(c['weights']); ids = c['indices']
            assert b[ids]@w > 5*np.linalg.norm(a[ids].T@w)+1e-8


def main():
    self_test()
    root = Path(json.loads((EXP/'fixed_summary.json').read_text(encoding='utf-8'))['build'])
    fixed_path, samples_path = root/'fixed_feasibility.json', root/'visibility_margin_samples.json'
    fixed = json.loads(fixed_path.read_text(encoding='utf-8'))
    samples = json.loads(samples_path.read_text(encoding='utf-8'))
    for record in fixed['inputs'] + samples['inputs']:
        assert hashlib.sha256(Path(record['path']).read_bytes()).hexdigest() == record['sha256']
    build = json.loads((root/'build.json').read_text(encoding='utf-8'))
    head = Glb(Path(build['head']))
    faces = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    hp = np.fromfile(root/'posed/head.positions.f64', dtype='<f8').reshape(len(fixed['frames']), -1, 3)
    matrices = np.fromfile(root/'fixed_linear.f64', dtype='<f8').reshape(len(hp), fixed['vertices'], 3, 3)
    observations = {(r['frame'], r['headTriangle']): r for r in samples['rows']}
    results, controls = [], []
    for failed in fixed['verticesReport']:
        if failed['status'] == 'feasible':
            continue
        ids, p = failed['incidentTriangles'], failed['plateVertex']
        tri = hp[:, faces[ids]]
        normals = np.cross(tri[:, :, 1]-tri[:, :, 0], tri[:, :, 2]-tri[:, :, 0])
        normals /= np.linalg.norm(normals, axis=2)[:, :, None]
        a = np.einsum('ski,sij->skj', normals, matrices[:, p]).reshape(-1, 3)
        positive = np.array([observations[(f, i)]['positiveMargin'] for f in fixed['frames'] for i in ids])
        original = failed.get('opposedDualCertificate', failed.get('normDualCertificate'))
        lam = np.zeros(len(a)); lam[original['indices']] = original['weights']
        control = certificate(a, positive.astype(float), lam)
        controls.append({'headVertex': failed['headVertex'], 'retainedCertificateRejectsOriginalMargin': control is not None,
                         'certificate': control})
        for margin in [.00005, .00004, .000025]:
            b = positive.astype(float)*(margin/UNIT)
            result = solve(a, b)
            if result.get('certificate'):
                result['activePlanes'] = [{'frame': fixed['frames'][i//len(ids)], 'headTriangle': ids[i%len(ids)],
                                           'category': observations[(fixed['frames'][i//len(ids)], ids[i%len(ids)])]['category']}
                                          for i in result['certificate']['indices']]
            result.update(headVertex=failed['headVertex'], plateVertex=p, margin=margin,
                          incidentFaces=ids, positiveConstraints=int(positive.sum()), zeroConstraints=int((~positive).sum()))
            results.append(result)
        print(json.dumps({'headVertex': failed['headVertex'], 'outcomes': [r['status'] for r in results[-3:]]}), flush=True)
    assert {5631, 5981, 6471} <= {r['headVertex'] for r in controls if r['retainedCertificateRejectsOriginalMargin']}
    report = {'build': str(root), 'bound': BOUND, 'unit': UNIT, 'frames': fixed['frames'],
              'numpy': np.__version__, 'scipy': scipy.__version__, 'rows': results, 'negativeControls': controls,
              'inputs': [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in
                        [fixed_path, samples_path, root/'fixed_linear.f64', root/'posed/head.positions.f64', Path(build['head'])]],
              'visibilityCounts': samples['counts'], 'newPositiveFacePoses': samples['newPositiveFacePoses']}
    (root/'visibility_margin_solutions.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    assert all(r['status'] != 'unresolved' for r in results), 'Unresolved numerical case must be investigated explicitly.'


if __name__ == '__main__':
    main()
