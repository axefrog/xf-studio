"""Bounded packed-space fit for the subframe contacts of the retained plate.

This is a proposal generator, not an acceptance verifier. It fits an h091_eyes
field against measured readback and leaves all WolvenKit/gate checks to the
independent roundtrip and verification scripts.
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
from repair_local_packed import axes, edges_of  # noqa: E402

PACKED_SHA = '8e9c76b445ec746904bd8d24bfdf93f78f09d7627ffc8b3d4b337d8b524c6499'
HEAD_SHA = '0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730'
NATIVE_SHA = '0571c4da09595009dbc7e4e305518e95f18a58ba4c59bf51e97e7d56d0f060ea'
IMPORT_SHA = 'fb38f67a325506aa6bcdc5dfa4ed034594468e5f74db5a3d0d8e4e95a5f3c603'
MAP_SHA = '5a6a592c1162e03b140b1a1202e3d025c872f95695cf3b95d731338348d096f3'
ORIGINAL = {
    479: [(794, 1993), (794, 1994), (795, 2421), (795, 1993),
          (795, 1994), (795, 1995), (795, 1997)],
    1193: [(795, 2421), (795, 1997)],
    1961: [(2017, 3668), (2017, 3670), (2017, 3672)],
    1962: [(2017, 3668), (2017, 3670), (2017, 3672)],
}
MIGRATED = {
    477: [(1227, 1987)],
    479: [(799, 1989), (800, 1989), (801, 1989), (803, 1989), (1227, 1989)],
    1192: [(794, 1993), (795, 2421), (795, 1993), (795, 1997), (1227, 1986)],
    1194: [(801, 1987), (803, 1987)],
    1196: [(1227, 1987)],
}
ORIGINAL_CONTACTS = {
    (tick, plate_face, head_face)
    for tick, pairs in ORIGINAL.items() for plate_face, head_face in pairs
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    for name in ('derived', 'head', 'packed', 'prior-import', 'native-map',
                 'subframes', 'scipy-path', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--edge-margin-um', type=float, default=0.35)
    parser.add_argument('--contact-margin-um', type=float, default=2.0)
    parser.add_argument('--axis-rank', type=int, default=0)
    parser.add_argument('--include-migrated', action='store_true')
    parser.add_argument('--axis-policy', choices=('raw', 'coherent-all', 'coherent-original'), default='raw')
    args = parser.parse_args()
    contacts = {tick: pairs.copy() for tick, pairs in ORIGINAL.items()}
    if args.include_migrated:
        for tick, pairs in MIGRATED.items():
            contacts.setdefault(tick, []).extend(pairs)
    assert args.edge_margin_um > 0 and args.contact_margin_um > 0
    assert not args.output.exists() or not any(args.output.iterdir())
    sys.path.insert(0, str(args.scipy_path))
    from scipy.optimize import minimize

    native_path = args.derived / 'xfs_bootstrap_eye_plate.glb'
    assert sha(args.head) == HEAD_SHA and sha(native_path) == NATIVE_SHA
    assert sha(args.packed) == PACKED_SHA and sha(args.prior_import) == IMPORT_SHA
    assert sha(args.native_map) == MAP_SHA
    native, head, packed, imported = map(Glb, (native_path, args.head, args.packed, args.prior_import))
    mapping = np.asarray(json.loads(args.native_map.read_text())['plateToHeadIndices'], dtype=int)
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    names = head.mesh['extras']['targetNames']
    assert names == native.mesh['extras']['targetNames'] == packed.mesh['extras']['targetNames']
    eye = names.index('h091_eyes')
    saved = [names.index(name) for name in ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')]
    pb = packed.attr('POSITION').astype(float) - hb[mapping]
    pm = np.stack([packed.array(t['POSITION']).astype(float) for t in packed.p['targets']]) - ht[:, mapping]
    ib = imported.attr('POSITION').astype(float) - hb[mapping]
    im = np.stack([imported.array(t['POSITION']).astype(float) for t in imported.p['targets']]) - ht[:, mapping]
    pf = native.array(native.p['indices']).astype(int).reshape(-1, 3)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    edges = edges_of(pf)
    source_lookup = {tuple(sorted(face)): i for i, face in enumerate(hf)}
    source_faces = np.asarray([source_lookup[tuple(sorted(face))] for face in mapping[pf]])
    manifest = json.loads((args.subframes / 'manifest.json').read_text())
    assert manifest['rate'] == 120 and manifest['firstTick'] == 0 and manifest['sampleCount'] == 2653
    hp = np.memmap(args.subframes / 'head.positions.f64', dtype='<f8', mode='r', shape=(2653, len(hb), 3))
    linear = np.memmap(args.subframes / 'fixed_linear.f64', dtype='<f8', mode='r', shape=(2653, len(mapping), 3, 3))
    residual = pb + pm[saved].sum(axis=0)

    def pose(tick, update):
        return hp[tick, mapping] + np.einsum('vij,vj->vi', linear[tick], residual + update)

    cases = []
    for label, ids in [('h091_eyes', [eye]), ('saved_v', saved)]:
        h = hb[mapping] + ht[ids][:, mapping].sum(axis=0)
        d = pb + pm[ids].sum(axis=0)
        cap = np.minimum(5e-5, .25 * np.linalg.norm(h[edges[:, 0]] - h[edges[:, 1]], axis=1))
        cases.append((label, h, d, cap))

    # Two disjoint face clusters plus their one-ring vertices. Only h091_eyes
    # changes; every other morph remains byte-for-byte the previous input.
    seed = set(int(v) for pairs in contacts.values() for face, _ in pairs for v in pf[face])
    vertices = seed.copy()
    vertices.update(int(v) for a, b in edges if a in seed or b in seed for v in (a, b))
    vertices = np.asarray(sorted(vertices), dtype=int)
    local = {int(v): j for j, v in enumerate(vertices)}
    edge_ids = np.flatnonzero(np.isin(edges, vertices).any(axis=1))
    edge_rows = edges[edge_ids]
    incidence = np.zeros((len(edge_rows), len(vertices)))
    for j, (a, b) in enumerate(edge_rows):
        if int(a) in local:
            incidence[j, local[int(a)]] += 1
        if int(b) in local:
            incidence[j, local[int(b)]] -= 1
    edge_data = [((d[edge_rows[:, 0]] - d[edge_rows[:, 1]]) * 1e6,
                  cap[edge_ids] * 1e6) for _, _, d, cap in cases]

    rows, rhs, axis_records = [], [], []
    anchor = {0: np.array([-0.059, 0.987, -0.147]),
              1: np.array([0.535, 0.579, -0.615])}
    for tick, pairs in sorted(contacts.items()):
        p = pose(tick, np.zeros_like(pb))
        for plate_face, head_face in pairs:
            face, other = pf[plate_face], hp[tick, hf[head_face]]
            choices = axes(p[face], other)
            # A contact can be separated on either side of any SAT axis.
            # Prefer axes requiring the smallest packed-space movement.
            cluster = 0 if plate_face != 2017 else 1
            if cluster not in anchor:
                anchor[cluster] = choices[args.axis_rank][1]
            use_coherent = (args.axis_policy == 'coherent-all' or
                            (args.axis_policy == 'coherent-original' and
                             (tick, plate_face, head_face) in ORIGINAL_CONTACTS))
            coherent = ([item for item in choices if float(item[1] @ anchor[cluster]) > .9]
                        if use_coherent else [])
            needed, axis = coherent[args.axis_rank] if coherent else choices[args.axis_rank]
            bound = np.max(other @ axis) + args.contact_margin_um / 1e6
            for v in face:
                row = np.zeros((len(vertices), 3))
                row[local[int(v)]] = linear[tick, v].T @ axis
                rows.append(row.ravel())
                rhs.append((bound - p[v] @ axis) * 1e6)
            axis_records.append({'tick': tick, 'plateFace': plate_face, 'headFace': head_face,
                                 'neededUm': needed * 1e6, 'axis': axis.tolist(),
                                 'anchorDot': float(axis @ anchor[cluster])})
    A, b = np.asarray(rows), np.asarray(rhs)

    def edge_values(x):
        return [difference + incidence @ x.reshape(-1, 3) for difference, _ in edge_data]

    def edge_fun(x):
        return np.concatenate([cap - np.linalg.norm(value, axis=1) - args.edge_margin_um
                               for value, (_, cap) in zip(edge_values(x), edge_data)])

    def edge_jac(x):
        result = []
        for value in edge_values(x):
            unit = value / np.maximum(np.linalg.norm(value, axis=1)[:, None], 1e-20)
            result.append(-(incidence[:, :, None] * unit[:, None, :]).reshape(len(edge_rows), -1))
        return np.vstack(result)

    x0 = np.zeros(len(vertices) * 3)
    print(f'Fitting {len(vertices)} vertices, {len(edge_rows)} local edges, {len(axis_records)} contacts', flush=True)
    result = minimize(lambda x: .5 * x @ x, x0, jac=lambda x: x, method='SLSQP',
                      bounds=[(-75, 75)] * len(x0),
                      constraints=[{'type': 'ineq', 'fun': edge_fun, 'jac': edge_jac},
                                   {'type': 'ineq', 'fun': lambda x: A @ x - b, 'jac': lambda x: A}],
                      options={'maxiter': 400, 'ftol': 1e-8})
    update = np.zeros_like(pb)
    update[vertices] = result.x.reshape(-1, 3) / 1e6
    static = []
    for label, h, d, cap in cases:
        shifted = d + update
        gaps = np.linalg.norm(shifted[edges[:, 0]] - shifted[edges[:, 1]], axis=1)
        head_case = hb + ht[[eye] if label == 'h091_eyes' else saved].sum(axis=0)
        pairs = new_pairs((h + shifted)[pf], head_case[hf], source_faces, hf)
        static.append({'case': label, 'badEdges': int(np.count_nonzero(gaps > cap + 1e-10)),
                       'contactPairs': pairs.tolist(), 'minEdgeSlackUm': float(np.min((cap-gaps)*1e6))})
    neighborhood = {}
    for tick in sorted(set(range(475, 484)) | set(range(1189, 1198)) | set(range(1957, 1967))):
        neighborhood[tick] = new_pairs(pose(tick, update)[pf], hp[tick, hf], source_faces, hf).tolist()
    maximum_displacement = max(float(np.linalg.norm(pb + pm[eye] + update, axis=1).max()),
                               float(np.linalg.norm(pb + pm[saved].sum(axis=0) + update, axis=1).max()))
    report = {'schema': 'xfs/native-plate-subframe-fit-1', 'packedSha256': PACKED_SHA,
              'selectedNativeVertices': vertices.tolist(), 'selectedHeadVertices': mapping[vertices].tolist(),
              'edgeMarginUm': args.edge_margin_um, 'contactMarginUm': args.contact_margin_um,
              'axisRank': args.axis_rank, 'axisPolicy': args.axis_policy,
              'includeMigrated': args.include_migrated,
              'axes': axis_records, 'optimizerSuccess': bool(result.success),
              'optimizerMessage': str(result.message), 'iterations': int(result.nit),
              'minimumEdgeConstraintUm': float(edge_fun(result.x).min()),
              'minimumContactConstraintUm': float((A @ result.x - b).min()),
              'maxUpdateUm': float(np.linalg.norm(update, axis=1).max()*1e6),
              'maximumDisplacement': maximum_displacement,
              'static': static, 'nearContactTicks': neighborhood}
    args.output.mkdir(parents=True)
    (args.output / 'local-fit.json').write_text(json.dumps(report, indent=2) + '\n')
    acceptable = (result.success and report['minimumEdgeConstraintUm'] > -1e-5 and
                  report['minimumContactConstraintUm'] > -1e-5 and
                  all(item['badEdges'] == 0 and not item['contactPairs'] for item in static) and
                  not any(neighborhood.values()) and maximum_displacement < .00025)
    print(json.dumps({k: report[k] for k in ('optimizerSuccess', 'optimizerMessage', 'iterations',
        'minimumEdgeConstraintUm', 'minimumContactConstraintUm', 'maxUpdateUm',
        'maximumDisplacement', 'static')}, indent=2), flush=True)
    print('near contact ticks', {k: v for k, v in neighborhood.items() if v}, flush=True)
    if not acceptable:
        print('REJECTED_NUMERIC_LOCAL_FIT', flush=True)
        return

    predicted = pm.copy()
    predicted[eye] += update
    np.savez_compressed(args.output / 'predicted-packed-field.npz', base=pb, morph=predicted, mapping=mapping)
    im[eye] += update
    output_glb = args.output / native_path.name
    write_glb(native_path, output_glb, ib, im)
    original = json.loads((args.derived / 'derivation.json').read_text())
    original.update({'schema': 'xfs/native-plate-subframe-trial-1',
                     'neutralDerivedSha256': sha(native_path), 'priorImportSha256': sha(args.prior_import),
                     'priorPackedSha256': PACKED_SHA, 'targetMorph': 'h091_eyes',
                     'packedSpaceEdgeMarginUm': args.edge_margin_um,
                     'packedSpaceContactMarginUm': args.contact_margin_um,
                     'allMorphAccessorsExact': False})
    original['output']['sha256'] = sha(output_glb)
    (args.output / 'derivation.json').write_text(json.dumps(original, indent=2) + '\n')
    (args.output / 'vertex-map.json').write_bytes(args.native_map.read_bytes())
    print(json.dumps({'gate': 'NUMERIC_LOCAL_PROPOSAL', 'importGlbSha256': sha(output_glb)}), flush=True)


if __name__ == '__main__':
    main()
