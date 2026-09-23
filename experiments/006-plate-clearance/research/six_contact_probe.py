"""Localize the six residual posed contacts without modifying plate resources.

This is a diagnostic companion to coupled_morph_verify.py. The existing
107-shape/73-pose verifier remains the acceptance gate for any new candidate.
"""
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
WORKSPACE = EXP.parent.parent
sys.path[:0] = [str(EXP / 'generated/python-deps'),
                str(EXP.parent / '004-plate-import'), str(EXP)]
import numpy as np
from scipy.optimize import minimize
from verify_roundtrip import Glb
from coupled_morph_verify import new_pairs
from finite_pair_search import finite_separation


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def unit(v):
    length = np.linalg.norm(v)
    return v / length if length else v


def main():
    trial = json.loads((HERE / 'coupled_morph_opt_summary.json').read_text())
    candidate_path = WORKSPACE / trial['combinedNumericResult']
    assert sha(candidate_path) == trial['combinedNumericSha256']
    data = np.load(candidate_path)
    prior = json.loads((HERE / 'morph_aware_rescue_summary.json').read_text())
    source_root = Path(prior['sourceBuild'])
    build = json.loads((source_root / 'build.json').read_text())
    source = next(c for c in build['candidates'] if c['name'] == prior['sourceCandidate'])
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
    uv = plate.attr('TEXCOORD_0').astype(float)
    field, morph = data['field'], data['morphChange']
    saved = [names.index(n) for n in ['h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear']]
    frames = json.loads((source_root / 'posed/manifest.json').read_text())['frames']
    hp = np.fromfile(source_root / 'posed/head.positions.f64', dtype='<f8').reshape(len(frames), -1, 3)
    matrices = np.fromfile(source_root / 'fixed_linear.f64', dtype='<f8').reshape(len(frames), len(mapping), 3, 3)
    residual = (pt[saved] + morph[saved] - ht[saved][:, mapping]).sum(axis=0)

    rows = []
    affected = set()
    for frame in (120, 170):
        j = frames.index(frame)
        p = hp[j, mapping] + np.einsum('vij,vj->vi', matrices[j], field + residual)
        h = hp[j]
        pairs = new_pairs(p[pf], h[hf], source_faces, hf)
        for pi, hi in pairs:
            tri = p[pf[pi]]
            head_tri = h[hf[hi]]
            normal = unit(np.cross(head_tri[1] - head_tri[0], head_tri[2] - head_tri[0]))
            plate_to_head_plane = (tri - head_tri[0]) @ normal
            head_to_plate_plane = (head_tri - tri[0]) @ unit(np.cross(tri[1]-tri[0], tri[2]-tri[0]))
            shift = finite_separation(tri, head_tri)
            affected.update(map(int, pf[pi]))
            rows.append({
                'frame': int(frame), 'plateFace': int(pi), 'headFace': int(hi),
                'sourceHeadFace': int(source_faces[pi]),
                'plateVertices': pf[pi].tolist(), 'mappedHeadVertices': mapping[pf[pi]].tolist(),
                'headVertices': hf[hi].tolist(),
                'plateUV': uv[pf[pi]].tolist(),
                'plateCentroid': tri.mean(axis=0).tolist(),
                'headCentroid': head_tri.mean(axis=0).tolist(),
                'plateVertexDistanceToHeadPlane': plate_to_head_plane.tolist(),
                'headVertexDistanceToPlatePlane': head_to_plate_plane.tolist(),
                'minimumRigidPairSeparation': float(np.linalg.norm(shift)),
                'minimumRigidPairShift': shift.tolist(),
                'plateFaceArea': float(np.linalg.norm(np.cross(tri[1]-tri[0],tri[2]-tri[0]))*.5),
            })

    affected = sorted(affected)
    nearby_edges = edges[np.isin(edges, affected).any(axis=1)]
    shapes = []
    for name, indices in [('Basis', []), ('h091_eyes', [names.index('h091_eyes')]), ('saved_v', saved)]:
        h = hb + ht[indices].sum(axis=0) if indices else hb
        p = pb + data['baseChange'] + (pt[indices] + morph[indices]).sum(axis=0) if indices else pb + data['baseChange']
        displacement = p - h[mapping]
        total = np.linalg.norm(displacement[affected], axis=1)
        gap = np.linalg.norm(displacement[nearby_edges[:,0]]-displacement[nearby_edges[:,1]], axis=1)
        cap = np.minimum(5e-5, .25*np.linalg.norm(h[mapping[nearby_edges[:,0]]]-h[mapping[nearby_edges[:,1]]], axis=1))
        shapes.append({'case': name,
                       'maximumAffectedDisplacement': float(total.max()),
                       'minimumAffectedDisplacementSlack': float((.00025-total).min()),
                       'minimumNearbyNeighborSlack': float((cap-gap).min()),
                       'nearbyEdgesAtCap1e9': int(((cap-gap)<1e-9).sum())})

    # Test the narrowest repair: moving only the common crease vertex in
    # h091_eyes, while putting it wholly on the same side of both head planes
    # as its neighboring plate vertices. This is a sufficient local condition,
    # not a necessary condition for every possible triangle deformation.
    crease = 119
    incident = edges[(edges == crease).any(axis=1)]
    plane_rows = []
    for frame, face in [(120, 1989), (170, 1987)]:
        j = frames.index(frame)
        p119 = hp[j, mapping[crease]] + matrices[j, crease] @ (field[crease] + residual[crease])
        tri = hp[j, hf[face]]
        normal = unit(np.cross(tri[1]-tri[0], tri[2]-tri[0]))
        if (p119-tri[0]) @ normal > 0: normal = -normal
        plane_rows.append((frame, face, normal @ matrices[j, crease],
                           float((p119-tri[0]) @ normal)))

    local_shapes = []
    for name, indices in [('h091_eyes', [names.index('h091_eyes')]), ('saved_v', saved)]:
        h = hb + ht[indices].sum(axis=0)
        p = pb + data['baseChange'] + (pt[indices] + morph[indices]).sum(axis=0)
        displacement = p - h[mapping]
        cap = np.minimum(5e-5, .25*np.linalg.norm(h[mapping[incident[:,0]]]-h[mapping[incident[:,1]]], axis=1))
        edge_disp = displacement[incident[:,0]]-displacement[incident[:,1]]
        sign = np.where(incident[:,0] == crease, 1., -1.)
        local_shapes.append((name, displacement[crease], edge_disp, sign, cap))

    scale = 1e-5
    def slacks(x):
        delta = x * scale
        result = [(distance + row @ delta - 2e-6)/scale for _,_,row,distance in plane_rows]
        for _, d, edge_disp, sign, caps in local_shapes:
            result.append((.00025-np.linalg.norm(d+delta))/scale)
            result.extend(((caps-np.linalg.norm(edge_disp+sign[:,None]*delta,axis=1))/scale).tolist())
        return np.array(result)

    starts = [np.zeros(3)]
    for _,_,row,distance in plane_rows:
        starts.append(row * max(0,(2e-6-distance)/(row@row))/scale)
    results = [minimize(lambda x: .5*x@x, start, method='SLSQP',
                        constraints=[{'type':'ineq','fun':slacks}],
                        options={'ftol':1e-11,'maxiter':300}) for start in starts]
    best = max(results,key=lambda r: float(slacks(r.x).min()))
    one_vertex = {'criterion':'Put vertex 119 on plate-neighbor side of head face 1989 at frame 120 and head face 1987 at frame 170, with 2e-6 clearance, changing only h091_eyes.',
                  'solverStatuses':[{'status':int(r.status),'success':bool(r.success),'minimumScaledSlack':float(slacks(r.x).min())} for r in results],
                  'bestDelta':(best.x*scale).tolist(), 'bestMinimumScaledSlack':float(slacks(best.x).min()),
                  'posePlanes':[{'frame':frame,'headFace':face,'startingSignedDistance':distance,
                                 'linearResponse':row.tolist()} for frame,face,row,distance in plane_rows]}
    if one_vertex['bestMinimumScaledSlack'] >= -1e-8:
        variant = morph.copy()
        variant[names.index('h091_eyes'),crease] += best.x*scale
        variant_path = EXP / 'generated/morph-aware/six-contact-one-vertex.npz'
        variant_path.parent.mkdir(parents=True,exist_ok=True)
        np.savez_compressed(variant_path,field=field,baseChange=data['baseChange'],
                            morphChange=variant,mapping=mapping)
        one_vertex['numericCandidate'] = variant_path.relative_to(WORKSPACE).as_posix()
        one_vertex['numericSha256'] = sha(variant_path)

    unique_faces = sorted({row['plateFace'] for row in rows})
    out = {'candidateSha256': sha(candidate_path), 'sourceBuild': str(source_root),
           'residualContactPairs': rows, 'affectedPlateVertices': affected,
           'uniquePlateFaces': unique_faces, 'shapeBudget': shapes,
           'faceCount': len(pf),
           'uniqueContactFaceFraction': len(unique_faces)/len(pf),
           'bounds': {'uvMin':uv[affected].min(axis=0).tolist(), 'uvMax':uv[affected].max(axis=0).tolist()},
           'oneVertexSufficientRepair': one_vertex,
           'limits': ['Minimum rigid-pair shift is a local diagnostic, not a deformable-mesh solution.',
                      'Plane distance signs alone do not determine visibility or valid trim coverage.',
                      'No master, mesh, morph or archive was changed.']}
    path = HERE / 'six_contact_probe_summary.json'
    path.write_text(json.dumps(out, indent=2) + '\n')
    print(json.dumps({'contacts': len(rows), 'uniquePlateFaces': unique_faces,
                      'affectedPlateVertices': affected, 'shapeBudget': shapes,
                      'uvBounds': out['bounds'], 'oneVertex': one_vertex}))


if __name__ == '__main__':
    main()
