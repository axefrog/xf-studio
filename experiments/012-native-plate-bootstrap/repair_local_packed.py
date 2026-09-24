"""Fit a local h091_eyes correction against the measured packed plate.

The optimization predicts packed geometry from the previous readback; only a
new WolvenKit mesh+morph round trip and verify_repair.py can accept a trial.
"""
import argparse
import hashlib
import itertools
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / '004-plate-import'), str(HERE.parent / '006-plate-clearance')]
from verify_roundtrip import Glb  # noqa: E402
from verify_crease_roundtrip import new_pairs  # noqa: E402
from roundtrip_crease import write_glb  # noqa: E402


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def edges_of(faces):
    return np.unique(np.sort(np.concatenate((faces[:, [0, 1]], faces[:, [1, 2]],
                                             faces[:, [2, 0]])), axis=1), axis=0)


def axes(a, b):
    ae = np.roll(a, -1, axis=0) - a
    be = np.roll(b, -1, axis=0) - b
    raw = [np.cross(ae[0], ae[1]), np.cross(be[0], be[1])]
    raw += [np.cross(x, y) for x in ae for y in be]
    out = []
    for v in raw:
        length = np.linalg.norm(v)
        if length < 1e-14:
            continue
        for sign in (1, -1):
            axis = sign * v / length
            needed = float(np.max(b @ axis) - np.min(a @ axis))
            out.append((needed, axis))
    return sorted(out, key=lambda item: item[0])


def main():
    parser = argparse.ArgumentParser()
    for name in ('derived', 'head', 'packed', 'prior-import', 'native-map',
                 'prior-map', 'dense', 'scipy-path', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--edge-margin-um', type=float, default=4.0)
    parser.add_argument('--contact-margin-um', type=float, default=4.0)
    args = parser.parse_args()
    assert args.edge_margin_um > 0 and args.contact_margin_um > 0
    assert not args.output.exists() or not any(args.output.iterdir())
    sys.path.insert(0, str(args.scipy_path))
    from scipy.optimize import minimize

    native_path = args.derived / 'xfs_bootstrap_eye_plate.glb'
    native, head, packed, prior_import = map(Glb, (native_path, args.head, args.packed, args.prior_import))
    assert sha(native_path) == '0571c4da09595009dbc7e4e305518e95f18a58ba4c59bf51e97e7d56d0f060ea'
    mapping = np.asarray(json.loads(args.native_map.read_text())['plateToHeadIndices'], dtype=int)
    old_mapping = np.asarray(json.loads(args.prior_map.read_text())['plateToHeadIndices'], dtype=int)
    old_first = {}
    for index, vertex in enumerate(old_mapping):
        old_first.setdefault(int(vertex), index)
    old_indices = np.asarray([old_first[int(vertex)] for vertex in mapping])
    names = head.mesh['extras']['targetNames']
    assert names == native.mesh['extras']['targetNames'] == packed.mesh['extras']['targetNames']
    eye = names.index('h091_eyes')
    saved = [names.index(name) for name in ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')]
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    pb = packed.attr('POSITION').astype(float) - hb[mapping]
    pm = np.stack([packed.array(t['POSITION']).astype(float) for t in packed.p['targets']]) - ht[:, mapping]
    ib = prior_import.attr('POSITION').astype(float) - hb[mapping]
    im = np.stack([prior_import.array(t['POSITION']).astype(float) for t in prior_import.p['targets']]) - ht[:, mapping]
    pf = native.array(native.p['indices']).astype(int).reshape(-1, 3)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    edges = edges_of(pf)
    lookup = {tuple(sorted(face)): i for i, face in enumerate(hf)}
    source_faces = np.asarray([lookup[tuple(sorted(face))] for face in mapping[pf]])

    cases = []
    for label, ids in [('h091_eyes', [eye]), ('saved_v', saved)]:
        h = hb[mapping] + ht[ids][:, mapping].sum(axis=0)
        d = pb + pm[ids].sum(axis=0)
        cap = np.minimum(5e-5, .25 * np.linalg.norm(h[edges[:, 0]] - h[edges[:, 1]], axis=1))
        gap = np.linalg.norm(d[edges[:, 0]] - d[edges[:, 1]], axis=1)
        cases.append((label, h, d, cap, gap))
    failed = np.flatnonzero(np.any(np.stack([gap > cap + 1e-10 for _, _, _, cap, gap in cases]), axis=0))
    assert len(failed) == 1, f'Expected one packed failed edge, got {len(failed)}'
    failed_edge = edges[failed[0]]
    assert set(mapping[failed_edge]) == {275, 278}, mapping[failed_edge]

    frame = 299
    hp = np.memmap(args.dense / 'head.positions.f64', dtype='<f8', mode='r', shape=(664, len(hb), 3))
    linear = np.memmap(args.dense / 'fixed_linear.f64', dtype='<f8', mode='r', shape=(664, len(old_mapping), 3, 3))
    residual = pb + pm[saved].sum(axis=0)

    def pose(frame_number, update):
        return hp[frame_number, mapping] + np.einsum(
            'vij,vj->vi', linear[frame_number, old_indices], residual + update)

    initial_pairs = new_pairs(pose(frame, np.zeros_like(pb))[pf], hp[frame, hf], source_faces, hf)
    assert initial_pairs.tolist() == [[799, 1989]], initial_pairs.tolist()
    plate_face, head_face = map(int, initial_pairs[0])
    witnesses = [(299, plate_face, head_face), (298, 800, 1987)]
    vertices = set(map(int, failed_edge)) | set(int(v) for _, f, _ in witnesses for v in pf[f])
    frontier = vertices.copy()
    vertices.update(int(v) for a, b in edges if a in frontier or b in frontier for v in (a, b))
    vertices = np.asarray(sorted(vertices), dtype=int)
    local = {int(vertex): j for j, vertex in enumerate(vertices)}
    local_edges = np.flatnonzero(np.isin(edges, vertices).any(axis=1))
    edge_rows = edges[local_edges]
    incidence = np.zeros((len(edge_rows), len(vertices)))
    for j, (a, b) in enumerate(edge_rows):
        if int(a) in local:
            incidence[j, local[int(a)]] += 1
        if int(b) in local:
            incidence[j, local[int(b)]] -= 1
    edge_data = [((d[edge_rows[:, 0]] - d[edge_rows[:, 1]]) * 1e6,
                  cap[local_edges] * 1e6) for _, _, d, cap, _ in cases]
    option_sets = []
    for frame_number, witness_face, witness_head_face in witnesses:
        p = pose(frame_number, np.zeros_like(pb))
        option_sets.append(axes(p[pf[witness_face]], hp[frame_number, hf[witness_head_face]])[:5])
    print('failed head edge', mapping[failed_edge].tolist(), 'local vertices', len(vertices),
          'contact axis needs (um)', [[round(option[0]*1e6, 3) for option in choices]
                                      for choices in option_sets], flush=True)

    def unpack(x):
        update = np.zeros_like(pb)
        update[vertices] = x.reshape(-1, 3) / 1e6
        return update

    def edge_values(x):
        return [difference + incidence @ x.reshape(-1, 3) for difference, _ in edge_data]

    def edge_fun(x):
        return np.concatenate([cap - np.linalg.norm(value, axis=1) - args.edge_margin_um
                               for value, (_, cap) in zip(edge_values(x), edge_data)])

    def edge_jac(x):
        rows = []
        for value in edge_values(x):
            unit = value / np.maximum(np.linalg.norm(value, axis=1)[:, None], 1e-20)
            rows.append(-(incidence[:, :, None] * unit[:, None, :]).reshape(len(edge_rows), -1))
        return np.vstack(rows)

    accepted = None
    attempts = []
    for choice in itertools.product(*option_sets):
        rows = []
        bounds = []
        for (frame_number, witness_face, witness_head_face), (_, axis) in zip(witnesses, choice):
            face = pf[witness_face]
            p = pose(frame_number, np.zeros_like(pb))
            bound = np.max(hp[frame_number, hf[witness_head_face]] @ axis) + args.contact_margin_um / 1e6
            rhs = (bound - p[face] @ axis) * 1e6
            separating_rows = np.zeros((3, len(vertices), 3))
            for j, v in enumerate(face):
                separating_rows[j, local[int(v)]] = linear[frame_number, old_indices[v]].T @ axis
            rows.extend(separating_rows.reshape(3, -1))
            bounds.extend(rhs)
        separating_rows = np.asarray(rows)
        rhs = np.asarray(bounds)
        result = minimize(lambda x: .5 * x @ x, np.zeros(len(vertices)*3),
                          jac=lambda x: x, method='SLSQP',
                          bounds=[(-40, 40)]*(len(vertices)*3),
                          constraints=[{'type': 'ineq', 'fun': edge_fun, 'jac': edge_jac},
                                       {'type': 'ineq', 'fun': lambda x: separating_rows @ x - rhs,
                                        'jac': lambda x: separating_rows}],
                          options={'maxiter': 250, 'ftol': 1e-8})
        update = unpack(result.x)
        static_bad = []
        for label, h, d, cap, _ in cases:
            shifted = d + update
            gap = np.linalg.norm(shifted[edges[:, 0]] - shifted[edges[:, 1]], axis=1)
            pairs = new_pairs((h + shifted)[pf],
                              (hb + ht[[eye] if label == 'h091_eyes' else saved].sum(axis=0))[hf],
                              source_faces, hf)
            static_bad.append((label, int(np.count_nonzero(gap > cap + 1e-10)), pairs.tolist(),
                               float(np.min(cap[local_edges] - gap[local_edges]))))
        pose_pairs = {f: new_pairs(pose(f, update)[pf], hp[f, hf], source_faces, hf).tolist()
                      for f in range(295, 304)}
        max_displacement = max(float(np.linalg.norm(pb + pm[eye] + update, axis=1).max()),
                               float(np.linalg.norm(pb + pm[saved].sum(axis=0) + update, axis=1).max()))
        record = {'axisNeededUm': [item[0]*1e6 for item in choice], 'optimizerSuccess': bool(result.success),
                  'minimumEdgeConstraintUm': float(edge_fun(result.x).min()),
                  'minimumContactConstraintUm': float((separating_rows@result.x-rhs).min()),
                  'static': static_bad, 'nearFrames': pose_pairs,
                  'maxUpdateUm': float(np.linalg.norm(update, axis=1).max()*1e6),
                  'maximumDisplacement': max_displacement}
        attempts.append(record)
        print(json.dumps(record), flush=True)
        if result.success and edge_fun(result.x).min() > -1e-6 and all(bad == 0 and not pairs for _, bad, pairs, _ in static_bad) and not any(pose_pairs.values()) and max_displacement < .00025:
            accepted = update
            break
    if accepted is None:
        raise RuntimeError('No local axis fit passed the predicted local static and near-frame checks')

    # Apply the predicted packed-space update to the previous *input*. The
    # readback must be independently measured; it need not equal this target.
    args.output.mkdir(parents=True, exist_ok=True)
    predicted_morph = pm.copy()
    predicted_morph[eye] += accepted
    np.savez_compressed(args.output / 'predicted-packed-field.npz',
                        base=pb, morph=predicted_morph, mapping=mapping)
    im[eye] += accepted
    output_glb = args.output / native_path.name
    write_glb(native_path, output_glb, ib, im)
    glb = Glb(output_glb)
    np.testing.assert_array_equal(native.array(native.p['indices']), glb.array(glb.p['indices']))
    for attribute in native.p['attributes']:
        if attribute != 'POSITION':
            np.testing.assert_array_equal(native.attr(attribute), glb.attr(attribute))
    for before, after in zip(native.p['targets'], glb.p['targets']):
        for attribute in ('NORMAL', 'TANGENT'):
            np.testing.assert_array_equal(native.array(before[attribute]), glb.array(after[attribute]))
    manifest = json.loads((args.derived / 'derivation.json').read_text())
    manifest.update({'schema': 'xfs/native-plate-local-packed-trial-1',
                     'neutralDerivedSha256': sha(native_path),
                     'priorImportSha256': sha(args.prior_import),
                     'priorPackedSha256': sha(args.packed),
                     'targetMorph': 'h091_eyes',
                     'selectedHeadEdge': mapping[failed_edge].tolist(),
                     'selectedContact': [frame, plate_face, head_face],
                     'packedSpaceEdgeMarginUm': args.edge_margin_um,
                     'packedSpaceContactMarginUm': args.contact_margin_um,
                     'allMorphAccessorsExact': False})
    manifest['output']['sha256'] = sha(output_glb)
    (args.output / 'derivation.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (args.output / 'vertex-map.json').write_bytes(args.native_map.read_bytes())
    (args.output / 'local-fit.json').write_text(json.dumps({
        'schema': 'xfs/native-plate-local-fit-1', 'importGlbSha256': sha(output_glb),
        'selectedNativeVertices': vertices.tolist(), 'selectedHeadVertices': mapping[vertices].tolist(),
        'attempts': attempts, 'limit': 'Predicted packed-space fit only; actual readback requires independent verification.'
    }, indent=2) + '\n')
    print(json.dumps({'importGlbSha256': sha(output_glb),
                      'selectedVertices': len(vertices),
                      'maximumUpdateUm': float(np.linalg.norm(accepted, axis=1).max()*1e6)}))


if __name__ == '__main__':
    main()
