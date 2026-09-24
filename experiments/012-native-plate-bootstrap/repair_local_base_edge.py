"""Fit a tiny packed-space base correction after the local morph contact repair.

All 107 static neighbor cases constrain the local base field. The resulting
import remains a proposal until WolvenKit readback and independent gates pass.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / '004-plate-import'), str(HERE.parent / '006-plate-clearance')]
from verify_roundtrip import Glb  # noqa: E402
from verify_crease_roundtrip import new_pairs  # noqa: E402
from roundtrip_crease import write_glb  # noqa: E402
from repair_local_packed import axes  # noqa: E402


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    for name in ('derived', 'head', 'packed', 'prior-import', 'native-map',
                 'scipy-path', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--target-margin-um', type=float, default=4.0)
    parser.add_argument('--contact-margin-um', type=float)
    parser.add_argument('--dense', type=Path)
    parser.add_argument('--prior-map', type=Path)
    parser.add_argument('--all-failed', action='store_true')
    parser.add_argument('--freeze-head', type=int, nargs='*', default=[])
    args = parser.parse_args()
    assert args.target_margin_um > 0
    assert not args.output.exists() or not any(args.output.iterdir())
    assert bool(args.contact_margin_um) == bool(args.dense) == bool(args.prior_map)
    sys.path.insert(0, str(args.scipy_path))
    from scipy.optimize import minimize

    native_path = args.derived / 'xfs_bootstrap_eye_plate.glb'
    native, head, packed, prior_import = map(Glb, (native_path, args.head, args.packed, args.prior_import))
    mapping = np.asarray(json.loads(args.native_map.read_text())['plateToHeadIndices'], dtype=int)
    names = head.mesh['extras']['targetNames']
    assert names == native.mesh['extras']['targetNames'] == packed.mesh['extras']['targetNames']
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    pb = packed.attr('POSITION').astype(float) - hb[mapping]
    pm = np.stack([packed.array(t['POSITION']).astype(float) for t in packed.p['targets']]) - ht[:, mapping]
    ib = prior_import.attr('POSITION').astype(float) - hb[mapping]
    im = np.stack([prior_import.array(t['POSITION']).astype(float) for t in prior_import.p['targets']]) - ht[:, mapping]
    pf = native.array(native.p['indices']).astype(int).reshape(-1, 3)
    edges = np.unique(np.sort(np.concatenate((pf[:, [0, 1]], pf[:, [1, 2]],
                                              pf[:, [2, 0]])), axis=1), axis=0)
    edge_index = np.flatnonzero(np.all(edges == np.array([118, 121]), axis=1))
    assert len(edge_index) == 1 and set(mapping[edges[edge_index[0]]]) == {275, 278}
    saved = [names.index(name) for name in ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')]
    cases = [('Basis', [])] + [(name, [i]) for i, name in enumerate(names)] + [('saved_v', saved)]
    failed_by_case = {}
    if args.all_failed:
        for label, ids in cases:
            h = hb[mapping] + ht[ids][:, mapping].sum(axis=0) if ids else hb[mapping]
            d = pb + pm[ids].sum(axis=0) if ids else pb
            cap = np.minimum(5e-5, .25 * np.linalg.norm(h[edges[:,0]]-h[edges[:,1]], axis=1))
            gap = np.linalg.norm(d[edges[:,0]]-d[edges[:,1]], axis=1)
            failed = np.flatnonzero(gap > cap + 1e-10)
            if len(failed):
                failed_by_case[label] = failed.tolist()
        assert failed_by_case and sum(map(len,failed_by_case.values())) <= 6, failed_by_case
        target_edges = sorted(set(j for indices in failed_by_case.values() for j in indices))
    else:
        target_edges = [int(edge_index[0])]
    vertices = set(map(int, edges[target_edges].ravel()))
    contact = (298, 792, 2421) if args.contact_margin_um else None
    if contact:
        vertices.update(map(int, pf[contact[1]]))
    frontier = vertices.copy()
    vertices.update(int(v) for a, b in edges if a in frontier or b in frontier for v in (a, b))
    vertices.difference_update(int(np.flatnonzero(mapping == h)[0]) for h in args.freeze_head)
    vertices = np.asarray(sorted(vertices), dtype=int)
    local = {int(v): j for j, v in enumerate(vertices)}
    local_edges = np.flatnonzero(np.isin(edges, vertices).any(axis=1))
    edge_rows = edges[local_edges]
    incidence = np.zeros((len(edge_rows), len(vertices)))
    for j, (a, b) in enumerate(edge_rows):
        if int(a) in local:
            incidence[j, local[int(a)]] += 1
        if int(b) in local:
            incidence[j, local[int(b)]] -= 1
    differences = []
    caps = []
    margins = []
    for label, ids in cases:
        h = hb[mapping] + ht[ids][:, mapping].sum(axis=0) if ids else hb[mapping]
        d = pb + pm[ids].sum(axis=0) if ids else pb
        differences.append((d[edge_rows[:, 0]] - d[edge_rows[:, 1]]) * 1e6)
        caps.append(np.minimum(5e-5, .25 * np.linalg.norm(
            h[edge_rows[:, 0]] - h[edge_rows[:, 1]], axis=1)) * 1e6)
        row = np.full(len(edge_rows), .1)
        if args.all_failed and label in failed_by_case:
            row[np.isin(local_edges, failed_by_case[label])] = args.target_margin_um
        elif label == 'h091_eyes':
            row[np.flatnonzero(local_edges == edge_index[0])] = args.target_margin_um
        margins.append(row)
    differences, caps, margins = map(np.asarray, (differences, caps, margins))
    print('local vertices/edges', len(vertices), len(edge_rows),
          'initial constraint um', float(np.min(caps-np.linalg.norm(differences, axis=2)-margins)),
          'failed', failed_by_case, 'frozen', args.freeze_head, flush=True)

    def values(x):
        return differences + (incidence @ x.reshape(-1, 3))[None]

    def fun(x):
        return (caps - np.linalg.norm(values(x), axis=2) - margins).ravel()

    def jac(x):
        value = values(x)
        unit = value / np.maximum(np.linalg.norm(value, axis=2)[:, :, None], 1e-20)
        return -(incidence[None, :, :, None] * unit[:, :, None, :]).reshape(-1, len(vertices)*3)

    contact_choices = [None]
    if contact:
        old_mapping = np.asarray(json.loads(args.prior_map.read_text())['plateToHeadIndices'], dtype=int)
        old_first = {}
        for index, vertex in enumerate(old_mapping):
            old_first.setdefault(int(vertex), index)
        old_indices = np.asarray([old_first[int(vertex)] for vertex in mapping])
        hp = np.memmap(args.dense / 'head.positions.f64', dtype='<f8', mode='r', shape=(664, len(hb), 3))
        linear = np.memmap(args.dense / 'fixed_linear.f64', dtype='<f8', mode='r',
                           shape=(664, len(old_mapping), 3, 3))
        residual = pb + pm[saved].sum(axis=0)
        def pose(frame, shift):
            return hp[frame, mapping] + np.einsum('vij,vj->vi', linear[frame, old_indices], residual+shift)
        frame, plate_face, head_face = contact
        hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
        lookup = {tuple(sorted(face)): i for i, face in enumerate(hf)}
        source_faces = np.asarray([lookup[tuple(sorted(face))] for face in mapping[pf]])
        starting_pairs = new_pairs(pose(frame, np.zeros_like(pb))[pf], hp[frame, hf], source_faces, hf)
        assert [plate_face, head_face] in starting_pairs.tolist()
        contact_choices = axes(pose(frame, np.zeros_like(pb))[pf[plate_face]], hp[frame, hf[head_face]])[:5]
        print('contact axis needs um', [round(item[0]*1e6, 3) for item in contact_choices], flush=True)
    result = None
    records = []
    for option in contact_choices:
        constraints = [{'type': 'ineq', 'fun': fun, 'jac': jac}]
        if option:
            _, axis = option
            frame, plate_face, head_face = contact
            face = pf[plate_face]
            p = pose(frame, np.zeros_like(pb))
            bound = np.max(hp[frame, hf[head_face]]@axis) + args.contact_margin_um/1e6
            rhs = (bound-p[face]@axis)*1e6
            rows = np.zeros((3,len(vertices),3))
            for j,v in enumerate(face):
                rows[j,local[int(v)]] = linear[frame,old_indices[v]].T@axis
            rows = rows.reshape(3,-1)
            constraints.append({'type':'ineq','fun':lambda x:rows@x-rhs,'jac':lambda x:rows})
        trial = minimize(lambda x: .5*x@x, np.zeros(len(vertices)*3), jac=lambda x: x,
                         method='SLSQP', bounds=[(-25, 25)]*(len(vertices)*3),
                         constraints=constraints,
                         options={'maxiter': 250, 'ftol': 1e-8})
        trial_update = np.zeros_like(pb)
        trial_update[vertices] = trial.x.reshape(-1,3)/1e6
        near_hits = {}
        if contact:
            near_hits = {f:new_pairs(pose(f, trial_update)[pf],hp[f,hf],source_faces,hf).tolist()
                         for f in range(295,304)}
        record = {'axisNeedUm': option[0]*1e6 if option else None,
                  'optimizerSuccess':bool(trial.success), 'minimumConstraintUm':float(fun(trial.x).min()),
                  'nearHits':near_hits, 'maximumUpdateUm':float(np.linalg.norm(trial_update,axis=1).max()*1e6)}
        records.append(record)
        print(json.dumps(record),flush=True)
        if trial.success and fun(trial.x).min() > -1e-6 and not any(near_hits.values()):
            result = trial
            break
    if result is None:
        raise RuntimeError('Local base correction did not satisfy packed-space neighbor and contact constraints')
    update = np.zeros_like(pb)
    update[vertices] = result.x.reshape(-1, 3) / 1e6
    print(json.dumps({'optimizerSuccess': bool(result.success),
                      'minimumConstraintUm': float(fun(result.x).min()),
                      'maximumUpdateUm': float(np.linalg.norm(update, axis=1).max()*1e6)}), flush=True)
    args.output.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.output / 'predicted-packed-field.npz',
                        base=pb+update, morph=pm, mapping=mapping)
    output_glb = args.output / native_path.name
    write_glb(native_path, output_glb, ib+update, im)
    glb = Glb(output_glb)
    np.testing.assert_array_equal(native.array(native.p['indices']), glb.array(glb.p['indices']))
    for attribute in native.p['attributes']:
        if attribute != 'POSITION':
            np.testing.assert_array_equal(native.attr(attribute), glb.attr(attribute))
    for before, after in zip(native.p['targets'], glb.p['targets']):
        for attribute in ('NORMAL', 'TANGENT'):
            np.testing.assert_array_equal(native.array(before[attribute]), glb.array(after[attribute]))
    manifest = json.loads((args.derived / 'derivation.json').read_text())
    manifest.update({'schema': 'xfs/native-plate-local-base-trial-1',
                     'neutralDerivedSha256': sha(native_path),
                     'priorImportSha256': sha(args.prior_import),
                     'priorPackedSha256': sha(args.packed),
                     'targetHeadEdge': [275, 278],
                     'allFailedPackedEdges': {label: mapping[edges[indices]].tolist()
                                              for label, indices in failed_by_case.items()},
                     'frozenHeadVertices': args.freeze_head,
                     'packedSpaceTargetMarginUm': args.target_margin_um,
                     'packedSpaceContactMarginUm': args.contact_margin_um,
                     'allMorphAccessorsExact': False})
    manifest['output']['sha256'] = sha(output_glb)
    (args.output / 'derivation.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (args.output / 'vertex-map.json').write_bytes(args.native_map.read_bytes())
    (args.output / 'local-fit.json').write_text(json.dumps({
        'schema': 'xfs/native-plate-local-base-fit-1', 'importGlbSha256': sha(output_glb),
        'selectedNativeVertices': vertices.tolist(), 'selectedHeadVertices': mapping[vertices].tolist(),
        'minimumPredictedConstraintUm': float(fun(result.x).min()),
        'maximumUpdateUm': float(np.linalg.norm(update, axis=1).max()*1e6),
        'axisAttempts': records,
        'limit': 'Predicted packed-space fit only; actual readback requires independent verification.'
    }, indent=2) + '\n')
    print(json.dumps({'importGlbSha256': sha(output_glb)}))


if __name__ == '__main__':
    main()
