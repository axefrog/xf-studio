"""Minimum-length displacement outside each incident triangle plane.

An experimental local shell construction, not a global collision solution. Solves
min ||d|| subject to N d >= 1 by enumerating up to three active constraints in 3D.
Infeasible/numerically unresolved vertices remain NaN and are never silently capped.
"""
from itertools import combinations
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / '004-plate-import'))
from verify_roundtrip import Glb


def solve(normals):
    """Batched unit-distance half-space intersection; normals shape (batch,k,3)."""
    n = np.asarray(normals, dtype=np.float64)
    assert n.ndim == 3 and n.shape[2] == 3 and n.shape[1] > 0
    assert np.isfinite(n).all() and np.allclose(np.linalg.norm(n, axis=2), 1)
    result = np.full((len(n), 3), np.nan)
    best = np.full(len(n), np.inf)
    for count in range(1, min(3, n.shape[1]) + 1):
        for selected in combinations(range(n.shape[1]), count):
            active = n[:, selected, :]
            gram = active @ active.transpose(0, 2, 1)
            valid = np.linalg.det(gram) > 1e-12
            if not valid.any():
                continue
            ids = np.flatnonzero(valid)
            # Column RHS avoids NumPy 2.x solve's interpretation of batched 2D RHS.
            lam = np.linalg.solve(gram[ids], np.ones((len(ids), count, 1)))[:, :, 0]
            direction = np.einsum('nki,nk->ni', active[ids], lam)
            feasible = (lam >= -1e-8).all(axis=1) & (np.einsum('nki,ni->nk', n[ids], direction) >= 1 - 1e-8).all(axis=1)
            length = np.sum(direction * direction, axis=1)
            improve = feasible & (length < best[ids])
            target = ids[improve]
            result[target], best[target] = direction[improve], length[improve]
    return result


def adjacency(faces, vertices):
    incident = [[] for _ in range(vertices)]
    for i, triangle in enumerate(faces):
        for v in triangle:
            incident[v].append(i)
    return incident


def displacement(points, faces, mapping, incident):
    triangles = points[faces]
    normal = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    lengths = np.linalg.norm(normal, axis=1)
    normal /= np.maximum(lengths, 1e-30)[:, None]
    groups = {}
    result = np.full((len(mapping), 3), np.nan)
    for p, h in enumerate(mapping):
        ids = [i for i in incident[h] if lengths[i] > 1e-16]
        if ids:
            groups.setdefault(len(ids), []).append((p, ids))
    for items in groups.values():
        ids = [p for p, _ in items]
        result[ids] = solve(normal[[indices for _, indices in items]])
    return result


def self_test():
    np.testing.assert_allclose(solve(np.array([[[0., 0, 1]]])), [[0, 0, 1]])
    np.testing.assert_allclose(solve(np.array([[[1., 0, 0], [0, 1, 0]]])), [[1, 1, 0]])
    np.testing.assert_allclose(solve(np.eye(3)[None]), [[1, 1, 1]])
    assert np.isnan(solve(np.array([[[1., 0, 0], [-1, 0, 0]]]))).all()
    n = np.array([[[1., 0, 0], [0, 1, 0], [1, 1, 0]]])
    n /= np.linalg.norm(n, axis=2)[:, :, None]
    np.testing.assert_allclose(solve(n), [[1, 1, 0]])
    np.testing.assert_allclose(solve(np.repeat(n, 7, axis=0)), np.tile([1, 1, 0], (7, 1)))
    # Rotations preserve minimum length and rotate the unique solution.
    q, _ = np.linalg.qr(np.random.default_rng(42).normal(size=(3, 3)))
    np.testing.assert_allclose(solve(n @ q), np.array([[1, 1, 0]]) @ q, atol=1e-10)


def main():
    self_test()
    root = Path(json.loads((HERE / 'latest-build.json').read_text())['root'])
    build = json.loads((root / 'build.json').read_text())
    head = Glb(Path(build['head']))
    mapping = np.array(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'])
    faces = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    incident = adjacency(faces, len(head.attr('POSITION')))
    names = head.doc['meshes'][0]['extras']['targetNames']
    base = head.attr('POSITION').astype(float)
    shapes = [('Basis', base)] + [(name, base + head.array(target['POSITION'])) for name, target in zip(names, head.p['targets'])]
    selected = ['h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear']
    saved = base.copy()
    for name in selected:
        index = names.index(name)
        saved += head.array(head.p['targets'][index]['POSITION'])
    shapes.append(('saved-five', saved))
    rows = []
    for name, points in shapes:
        d = displacement(points, faces, mapping, incident)
        length = np.linalg.norm(d, axis=1)
        valid = np.isfinite(length)
        row = {'shape': name, 'unresolvedVertices': int((~valid).sum()),
               'overFourTimesOffset': int((length[valid] > 4).sum()),
               'maxDisplacementMultiplier': float(length[valid].max()) if valid.any() else None,
               'p99DisplacementMultiplier': float(np.percentile(length[valid], 99)) if valid.any() else None,
               'problemHeadVertices': sorted(set(mapping[(~valid) | (length > 4)].tolist()))}
        rows.append(row)
        if name == 'Basis' or row['unresolvedVertices'] or row['overFourTimesOffset']:
            print(json.dumps(row), flush=True)
    report = {'build': str(root), 'method': 'Minimum-norm per-vertex displacement against all incident head triangle planes',
              'inputs': [{'path': path, 'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest()} for path in [build['head'], build['mapping']]],
              'cases': len(rows), 'verticesPerCase': len(mapping), 'results': rows,
              'limits': ['Local half-space constraints do not clear non-adjacent folds or animated contacts.',
                         'Uses existing head vertex adjacency; coincident but independently indexed seams are not welded.',
                         'A numerical failure is reported unresolved, not asserted mathematically infeasible.',
                         'Four-times displacement is an experimental distortion budget, not a release standard.',
                         'No mesh/morph resources were changed or imported by this audit.']}
    (HERE / 'constrained-offset-audit.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
