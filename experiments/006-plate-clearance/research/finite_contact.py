"""Read-only finite head-triangle diagnostic around the fixed-shell failures.

The exhaustive query is intentional: it checks the AABB shortlist and avoids
mistaking a nearby supporting plane for a nearby *finite* face. The sign is
strictly local to the nearest face's winding, not an inside/outside test.
"""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
sys.path.insert(0, str(EXP.parent / '004-plate-import'))
from verify_roundtrip import Glb
sys.path.insert(0, str(EXP))
from triangles import contacts, intersect_pairs

VERTICES = (266, 275, 277, 805, 5981)
FRAMES = (25, 120, 169, 170, 300, 410, 490, 590)
BOUND = 0.00025
EPS = 1e-12


def closest_many(point, triangles):
    """Exact Euclidean closest point on each closed triangle, in batches."""
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    ab, ac = b-a, c-a
    n = np.cross(ab, ac)
    norm2 = np.einsum('ij,ij->i', n, n)
    assert np.all(norm2 > 1e-32), 'Degenerate head face requires an explicit policy'
    projected = point - (np.einsum('ij,ij->i', point-a, n)/norm2)[:, None]*n
    v = projected-a
    d00 = np.einsum('ij,ij->i', ab, ab)
    d01 = np.einsum('ij,ij->i', ab, ac)
    d11 = np.einsum('ij,ij->i', ac, ac)
    d20 = np.einsum('ij,ij->i', v, ab)
    d21 = np.einsum('ij,ij->i', v, ac)
    denom = d00*d11-d01*d01
    u = (d11*d20-d01*d21)/denom
    w = (d00*d21-d01*d20)/denom
    inside = (u >= 0) & (w >= 0) & (u+w <= 1)
    nearest = np.empty_like(projected)
    nearest[inside] = projected[inside]
    outside = np.flatnonzero(~inside)
    if len(outside):
        t = triangles[outside]
        starts = t
        ends = t[:, [1, 2, 0]]
        edge = ends-starts
        frac = np.clip(np.einsum('ijk,ijk->ij', point-starts, edge) /
                       np.einsum('ijk,ijk->ij', edge, edge), 0, 1)
        candidates = starts + frac[:, :, None]*edge
        dsq = np.sum((candidates-point)**2, axis=2)
        nearest[outside] = candidates[np.arange(len(outside)), np.argmin(dsq, axis=1)]
    return nearest, np.linalg.norm(nearest-point, axis=1), inside


def scalar_oracle(point, triangle):
    """Independent active-set enumeration over face, three edges and vertices."""
    a, b, c = triangle
    ab, ac = b-a, c-a
    gram = np.array([[ab@ab, ab@ac], [ab@ac, ac@ac]])
    uv = np.linalg.solve(gram, np.array([ab@(point-a), ac@(point-a)]))
    choices = [a, b, c]
    if uv.min() >= 0 and uv.sum() <= 1:
        choices.append(a + uv[0]*ab + uv[1]*ac)
    for start, end in ((a,b), (b,c), (c,a)):
        edge = end-start
        choices.append(start + np.clip((point-start)@edge/(edge@edge), 0, 1)*edge)
    return min(choices, key=lambda x: np.sum((x-point)**2))


def self_test():
    tri = np.array([[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]])
    points = [([.2,.2,1], [.2,.2,0]), ([.8,.8,1], [.5,.5,0]),
              ([-1,-1,0], [0,0,0]), ([.5,-.1,0], [.5,0,0])]
    for p, expected in points:
        got, _, _ = closest_many(np.array(p), tri[None])
        np.testing.assert_allclose(got[0], expected, atol=1e-14)
    rng = np.random.default_rng(606)
    triangles = rng.normal(size=(300,3,3))
    for point in rng.normal(size=(12,3)):
        nearest, distance, _ = closest_many(point, triangles)
        for i, tri in enumerate(triangles):
            oracle = scalar_oracle(point, tri)
            assert abs(distance[i]-np.linalg.norm(point-oracle)) < 1e-12
            assert np.linalg.norm(nearest[i]-oracle) < 1e-10


def query(point, triangles, face_ids, visibility, frame):
    # AABB lower bound shortlist; exhaustive all-pairs verification follows.
    lo, hi = triangles.min(axis=1), triangles.max(axis=1)
    lower = np.linalg.norm(np.maximum(np.maximum(lo-point, point-hi), 0), axis=1)
    order = np.argsort(lower)
    best = float('inf')
    chosen = None
    for i in order:
        if lower[i] > best + EPS:
            break
        candidate, distance, inside = closest_many(point, triangles[i:i+1])
        if distance[0] < best-EPS or (abs(distance[0]-best) <= EPS and (chosen is None or face_ids[i] < chosen[0])):
            best = float(distance[0])
            chosen = (int(face_ids[i]), candidate[0], bool(inside[0]))
    # This is the independent all-pairs cross-check, including distant faces.
    all_points, all_distances, all_inside = closest_many(point, triangles)
    j = min(range(len(face_ids)), key=lambda k: (all_distances[k], int(face_ids[k])))
    assert abs(best-all_distances[j]) <= 2e-12
    assert np.linalg.norm(chosen[1]-all_points[j]) <= 2e-12
    face = chosen[0]
    normal = np.cross(triangles[face,1]-triangles[face,0], triangles[face,2]-triangles[face,0])
    normal /= np.linalg.norm(normal)
    signed = float(np.sign((point-chosen[1])@normal)*best)
    category = visibility.get((frame, face), 'unclassified')
    return {'headTriangle': face, 'closestPoint': chosen[1].tolist(),
            'unsignedDistance': best, 'localSignedDistance': signed,
            'closestRegion': 'face' if chosen[2] else 'edge-or-vertex',
            'faceExposure': category, 'contactAt1e-9': best <= 1e-9}


def main():
    self_test()
    summary = json.loads((EXP/'fixed_summary.json').read_text(encoding='utf-8'))
    root = Path(summary['build'])
    fixed_path = root/'fixed_feasibility.json'
    assert hashlib.sha256(fixed_path.read_bytes()).hexdigest() == summary['verification']['reportSha256']
    fixed = json.loads(fixed_path.read_text(encoding='utf-8'))
    for record in fixed['inputs']:
        assert hashlib.sha256(Path(record['path']).read_bytes()).hexdigest() == record['sha256']
    samples = json.loads((root/'visibility_margin_samples.json').read_text(encoding='utf-8'))
    build = json.loads((root/'build.json').read_text(encoding='utf-8'))
    manifest = json.loads((root/'posed/manifest.json').read_text(encoding='utf-8'))
    assert set(FRAMES) <= set(manifest['frames'])
    head = Glb(Path(build['head']))
    faces = head.array(head.p['indices']).astype(int).reshape(-1,3)
    mapping = np.array(json.loads(Path(build['mapping']).read_text(encoding='utf-8'))['plateToHeadIndices'])
    hp = np.fromfile(root/'posed/head.positions.f64', dtype='<f8').reshape(len(manifest['frames']),-1,3)
    assert faces.max() < hp.shape[1]
    vis = {(r['frame'],r['headTriangle']):r['category'] for r in samples['rows']}
    by_head = {r['headVertex']:r for r in fixed['verticesReport']}
    solutions = json.loads((root/'visibility_margin_solutions.json').read_text(encoding='utf-8'))
    active_by_vertex_frame = {}
    for solution in solutions['rows']:
        if solution['headVertex'] in VERTICES and solution['margin'] in (.00005, .000025):
            for plane in solution.get('activePlanes', []):
                active_by_vertex_frame.setdefault((solution['headVertex'],plane['frame']),set()).add(plane['headTriangle'])
    candidates = {'source':hp[:,mapping]}
    plate_faces = {}
    expected_surfaces = {surface['name']:surface['sha256'] for surface in manifest['surfaces']}
    assert hashlib.sha256(Path(build['head']).read_bytes()).hexdigest() == expected_surfaces['head']
    for c in build['candidates']:
        assert c['offset'] <= BOUND
        assert hashlib.sha256(Path(c['roundtrip']).read_bytes()).hexdigest() == expected_surfaces[c['name']]
        candidates[c['name']] = np.fromfile(root/f'posed/{c["name"]}.positions.f64',dtype='<f8').reshape(len(manifest['frames']),len(mapping),3)
        plate = Glb(Path(c['roundtrip']))
        plate_faces[c['name']] = plate.array(plate.p['indices']).astype(int).reshape(-1,3)
    assert np.array_equal(*plate_faces.values())
    plate_faces['source'] = next(iter(plate_faces.values()))
    source_by_face = {tuple(sorted(t)):i for i,t in enumerate(faces)}
    mapped_plate_faces = mapping[plate_faces['source']]
    source_face_ids = np.array([source_by_face[tuple(sorted(t))] for t in mapped_plate_faces])
    local_plate = {v:np.flatnonzero((mapped_plate_faces==v).any(axis=1)) for v in VERTICES}
    selected_plate_faces = sorted(set(np.concatenate(list(local_plate.values()))))
    result = []
    for frame in FRAMES:
        s = manifest['frames'].index(frame)
        triangles = hp[s,faces]
        contact_by_candidate = {}
        for candidate, positions in candidates.items():
            local = positions[s,plate_faces[candidate][selected_plate_faces]]
            hit = contacts(local, triangles)
            pairs = [(selected_plate_faces[i],j) for i,j in hit['pairs']]
            contact_by_candidate[candidate] = pairs
        for vertex in VERTICES:
            row = by_head[vertex]
            p = row['plateVertex']
            assert mapping[p] == vertex
            active = active_by_vertex_frame.get((vertex,frame),set())
            for candidate, positions in candidates.items():
                point = positions[s,p]
                nearest = query(point,triangles,np.arange(len(faces)),vis,frame)
                contact_pairs = [(i,j) for i,j in contact_by_candidate[candidate] if i in local_plate[vertex]]
                new_nonadjacent = []
                for i,j in contact_pairs:
                    original = source_face_ids[i]
                    if len(set(faces[original]) & set(faces[j])):
                        continue
                    if not intersect_pairs(triangles[original:original+1],triangles[j:j+1])[0]:
                        new_nonadjacent.append([int(i),int(j)])
                details = []
                for face in sorted(active):
                    cp, dist, inside = closest_many(point, triangles[face:face+1])
                    n = np.cross(triangles[face,1]-triangles[face,0],triangles[face,2]-triangles[face,0]); n /= np.linalg.norm(n)
                    plane = float((point-triangles[face,0])@n)
                    details.append({'headTriangle':face,'faceExposure':vis.get((frame,face),'unclassified'),
                        'closestPoint':cp[0].tolist(),'unsignedDistance':float(dist[0]),
                        'localSignedDistance':float(np.sign((point-cp[0])@n)*dist[0]),
                        'signedInfinitePlaneDistance':plane,'projectionInsideFace':bool(inside[0]),
                        'planeOverconstraintAtZero':plane < -1e-9 and dist[0] > 1e-9 and not inside[0]})
                result.append({'frame':frame,'headVertex':vertex,'plateVertex':p,'candidate':candidate,
                    'point':point.tolist(),'nearestHead':nearest,'activeCertificateFaces':details,
                    'incidentPlateHeadContactPairs':len(contact_pairs),
                    'newNonadjacentContactPairs':new_nonadjacent})
        print(f'Finite query frame {frame} complete',flush=True)
    inputs = [fixed_path, root/'visibility_margin_samples.json', root/'visibility_margin_solutions.json',
              root/'posed/manifest.json', root/'posed/head.positions.f64', Path(build['head']), Path(build['mapping'])]
    inputs += [root/f'posed/{c["name"]}.positions.f64' for c in build['candidates']]
    report = {'build':str(root),'bound':BOUND,'frames':FRAMES,'vertices':VERTICES,
              'candidateOffsets':{'source':0,**{c['name']:c['offset'] for c in build['candidates']}},
              'queries':result,'inputs':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in inputs],
              'limits':['Local signed distance follows nearest head triangle winding; an open, folded head has no global inside sign.',
                        'Exposure inherits sampled head-only face classification; unclassified nearest faces are unresolved.',
                        'Local triangle pairs are checked, but other plate faces, neighboring-vertex smoothness and a viable correction are unresolved.',
                        'No full 73-pose or 107-static candidate gate is implied by these selected samples.']}
    output = HERE/'finite_contact_summary.json'
    output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'queries':len(result),'unclassifiedNearest':sum(r['nearestHead']['faceExposure']=='unclassified' for r in result),
                      'planeOverconstraints':sum(d['planeOverconstraintAtZero'] for r in result for d in r['activeCertificateFaces'])}),flush=True)


if __name__ == '__main__':
    main()
