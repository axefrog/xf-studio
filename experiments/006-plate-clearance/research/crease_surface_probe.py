"""Diagnostic crease-fan topology probe; does not create a game resource."""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from functools import lru_cache

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
ROOT = EXP.parent.parent
sys.path[:0] = [str(EXP.parent / '004-plate-import'), str(EXP)]
from verify_roundtrip import Glb
from coupled_morph_verify import new_pairs
from triangles import contacts, intersect_pairs


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def cross2(a, b):
    return float(a[0] * b[1] - a[1] * b[0])


def polygon_area(points):
    return .5 * sum(cross2(points[i], points[(i + 1) % len(points)])
                      for i in range(len(points)))


def triangulations(n):
    @lru_cache(None)
    def subdivide(a, b):
        if b == a + 1:
            return ((),)
        return tuple(left + right + ((a, c, b),)
                     for c in range(a + 1, b)
                     for left in subdivide(a, c)
                     for right in subdivide(c, b))
    return subdivide(0, n - 1)


def valid_uv(tess, polygon):
    # A valid nonoverlapping triangulation exactly partitions the UV polygon.
    # Positive triangle signs exclude diagonals outside a concave boundary.
    area = polygon_area(polygon)
    tris = [polygon[list(t)] for t in tess]
    areas = [cross2(t[1] - t[0], t[2] - t[0]) / 2 for t in tris]
    return (all(a * area > 1e-13 for a in areas)
            and abs(sum(areas) - area) < 1e-13)


def patch_pairs(tris, head_positions, mapped_tris, head_faces):
    head_triangles = head_positions[head_faces]
    pairs = np.asarray(contacts(tris, head_triangles)['pairs'], dtype=int).reshape(-1, 2)
    if not len(pairs):
        return pairs
    # The same exclusions as coupled_morph_verify.new_pairs, generalized for
    # changed triangle indices: skip shared source vertices and preexisting
    # native contacts on the new triangulation.
    adjacent = (mapped_tris[pairs[:, 0], :, None]
                == head_faces[pairs[:, 1], None, :]).any(axis=(1, 2))
    pairs = pairs[~adjacent]
    if not len(pairs):
        return pairs
    native = intersect_pairs(head_positions[mapped_tris[pairs[:, 0]]],
                             head_triangles[pairs[:, 1]])
    return pairs[~native]


def uv_surface_samples(uv, original, patch):
    """Barycentric coordinates of the old center and spoke midpoints on new UV triangles."""
    sample_uv = np.concatenate((uv[[119]], (uv[119] + uv[original[1:]]) / 2))
    refs = [((119,), (1.,))] + [((119, int(v)), (.5, .5)) for v in original[1:]]
    found = []
    for point in sample_uv:
        for tri in patch:
            x = uv[tri]
            transform = np.stack((x[0] - x[2], x[1] - x[2]), axis=1)
            if abs(np.linalg.det(transform)) < 1e-15:
                continue
            a, b = np.linalg.solve(transform, point - x[2])
            weights = np.array([a, b, 1 - a - b])
            if weights.min() >= -1e-8:
                found.append((tri, weights))
                break
        else:
            raise AssertionError(f'UV sample not covered: {point}')
    return refs, found


def sample_deviation(positions, refs, found):
    worst = 0.
    for (old, weights), (tri, bary) in zip(refs, found):
        old_pos = sum(float(w) * positions[v] for v, w in zip(old, weights))
        new_pos = bary @ positions[tri]
        worst = max(worst, float(np.linalg.norm(old_pos - new_pos)))
    return worst


def split_center_probe(data, names, mapping, pf, hf, hb, ht, pb, pt,
                       pose, frames, mat, source_faces):
    """Can each old fan triangle avoid critical contacts using its own 119 clone?"""
    vertex = 119
    incident = np.unique(pf[(pf == vertex).any(axis=1)].ravel())
    incident = incident[incident != vertex]
    rng = np.random.default_rng(20260924)
    best = np.asarray(json.loads((HERE / 'six_contact_probe_summary.json').read_text())
                      ['oneVertexSufficientRepair']['bestDelta'])
    fractions = np.linspace(0, 1.25, 126)
    samples = np.vstack((fractions[:, None] * best,
                         rng.uniform(0, 1.1, (20000, 1)) * best
                         + rng.normal(0, 4e-6, (20000, 3))))
    legal = np.ones(len(samples), dtype=bool)
    slack = np.full(len(samples), np.inf)
    saved = [names.index(n) for n in ['h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear']]
    for indices in ([names.index('h091_eyes')], saved):
        h = hb + ht[indices].sum(axis=0)
        p = pb + data['baseChange'] + (pt[indices] + data['morphChange'][indices]).sum(axis=0)
        d = p - h[mapping]
        displacement_slack = .00025 - np.linalg.norm(d[vertex] + samples, axis=1)
        legal &= displacement_slack >= -1e-10
        slack = np.minimum(slack, displacement_slack)
        cap = np.minimum(5e-5, .25 * np.linalg.norm(h[mapping[incident]] - h[mapping[vertex]], axis=1))
        differences = d[vertex][None, None] + samples[:, None] - d[incident][None]
        edge_slack = cap[None] - np.linalg.norm(differences, axis=2)
        legal &= (edge_slack >= -1e-10).all(axis=1)
        slack = np.minimum(slack, edge_slack.min(axis=1))
    deltas = samples[legal]
    slack = slack[legal]
    result = {'testedDeltas': len(samples), 'legalDeltas': len(deltas),
              'faceResults': []}
    coverage = np.zeros(len(deltas), dtype=np.uint8)
    # The target set includes every head triangle touched by either the
    # original field or the prior one-vertex trial at these frames.
    target_head_faces = [722, 1987, 1988, 1989]
    fan_faces = np.where((pf == vertex).any(axis=1))[0]
    for fi in fan_faces:
        missed = np.zeros(len(deltas), dtype=bool)
        for frame in (25, 120, 169, 170):
            p, h = pose[frame]
            j = frames.index(frame)
            for hi in target_head_faces:
                if np.isin(mapping[pf[fi]], hf[hi]).any():
                    continue
                if intersect_pairs(h[mapping[pf[fi]]][None], h[hf[hi]][None])[0]:
                    continue
                tri = np.repeat(p[pf[fi]][None], len(deltas), axis=0)
                tri[:, np.where(pf[fi] == vertex)[0][0]] += deltas @ mat[j, vertex].T
                head_tri = np.broadcast_to(h[hf[hi]], tri.shape)
                missed |= intersect_pairs(tri, head_tri)
        valid_deltas = deltas[~missed]
        coverage[~missed] |= np.uint8(1 << len(result['faceResults']))
        result['faceResults'].append({'face': int(fi),
                                      'legalAndClearCriticalDeltas': len(valid_deltas),
                                      'minimumDelta': (valid_deltas[np.argmin(np.linalg.norm(valid_deltas, axis=1))].tolist()
                                                      if len(valid_deltas) else None)})
    bits = np.unpackbits(coverage[:, None], axis=1).sum(axis=1)
    maximum = int(bits.max())
    near = np.where(bits == maximum)[0]
    closest = near[np.argmin(np.linalg.norm(deltas[near], axis=1))]
    result['maximumSimultaneouslyClearFaces'] = maximum
    result['allEightClearCount'] = int((bits == 8).sum())
    result['bestSharedDelta'] = deltas[closest].tolist()
    result['bestSharedFaces'] = [int(fan_faces[i]) for i in range(8)
                                 if coverage[closest] & (1 << i)]
    if result['allEightClearCount']:
        interior = np.where(bits == 8)[0]
        best_interior = interior[np.argmax(slack[interior])]
        result['bestInteriorDelta'] = deltas[best_interior].tolist()
        result['bestInteriorMinimumShapeSlack'] = float(slack[best_interior])
    return result


def main():
    report = json.loads((HERE / 'coupled_morph_opt_summary.json').read_text())
    candidate = ROOT / report['combinedNumericResult']
    assert sha(candidate) == report['combinedNumericSha256']
    data = np.load(candidate)
    prior = json.loads((HERE / 'morph_aware_rescue_summary.json').read_text())
    build_root = Path(prior['sourceBuild'])
    build = json.loads((build_root / 'build.json').read_text())
    source = next(c for c in build['candidates'] if c['name'] == prior['sourceCandidate'])
    head, plate = Glb(Path(build['head'])), Glb(Path(source['roundtrip']))
    mapping = np.array(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'], dtype=int)
    np.testing.assert_array_equal(data['mapping'], mapping)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    pf = plate.array(plate.p['indices']).astype(int).reshape(-1, 3)
    uv = plate.attr('TEXCOORD_0').astype(float)
    fan = np.where((pf == 119).any(axis=1))[0]
    ring = np.array([118, 120, 321, 322, 525, 130, 128, 121], dtype=int)
    assert len(fan) == len(ring) == 8
    assert {tuple(sorted(t[t != 119])) for t in pf[fan]} == {
        tuple(sorted((ring[i], ring[(i + 1) % len(ring)])))
        for i in range(len(ring))}
    uv_area = polygon_area(uv[ring])
    valid = [t for t in triangulations(len(ring)) if valid_uv(t, uv[ring])]
    print('fan', fan.tolist(), 'ring', ring.tolist(), 'UV area', uv_area,
          'UV-valid retessellations', len(valid))
    names = head.mesh['extras']['targetNames']
    saved = [names.index(n) for n in ['h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear']]
    hp = np.fromfile(build_root / 'posed/head.positions.f64', dtype='<f8')
    frames = json.loads((build_root / 'posed/manifest.json').read_text())['frames']
    hp = hp.reshape(len(frames), -1, 3)
    mat = np.fromfile(build_root / 'fixed_linear.f64', dtype='<f8').reshape(len(frames), len(mapping), 3, 3)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    pt = np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])
    residual = (pt[saved] + data['morphChange'][saved] - ht[saved][:, mapping]).sum(axis=0)
    lookup = {tuple(sorted(t)): i for i, t in enumerate(hf)}
    source_faces = np.array([lookup[tuple(sorted(t))] for t in mapping[pf]])
    pose = {}
    for frame in [25, 120, 169, 170]:
        j = frames.index(frame)
        p = hp[j, mapping] + np.einsum('vij,vj->vi', mat[j], data['field'] + residual)
        pairs = new_pairs(p[pf], hp[j, hf], source_faces, hf)
        print('frame', frame, 'contacts', [(int(a), int(b)) for a, b in pairs])
        pose[frame] = (p, hp[j])
    ranked = []
    hb, pb = head.attr('POSITION').astype(float), plate.attr('POSITION').astype(float)
    static_positions = []
    for indices in [[], *[[i] for i in range(105)], saved]:
        h = hb + ht[indices].sum(axis=0) if indices else hb
        p = pb + data['baseChange'] + (pt[indices] + data['morphChange'][indices]).sum(axis=0) if indices else pb + data['baseChange']
        static_positions.append((p, h))
    all_poses = [(hp[j, mapping] + np.einsum('vij,vj->vi', mat[j], data['field'] + residual), hp[j])
                 for j in range(len(frames))]
    for tess in valid:
        # ring order is opposite the source face winding.
        patch = np.array([[ring[k], ring[j], ring[i]] for i, j, k in tess], dtype=int)
        frame_contacts = {}
        for frame, (p, h) in pose.items():
            pairs = patch_pairs(p[patch], h, mapping[patch], hf)
            frame_contacts[frame] = [(int(a), int(b)) for a, b in pairs]
        score = sum(len(x) for x in frame_contacts.values())
        if score:
            ranked.append({'criticalContacts': score, 'patch': patch.tolist(),
                           'criticalFrameCounts': {str(k): len(v) for k, v in frame_contacts.items()}})
            continue
        refs, found = uv_surface_samples(uv, np.r_[119, ring], patch)
        static_contacts = []
        max_dev = 0.
        for case, (p, h) in enumerate(static_positions):
            pairs = patch_pairs(p[patch], h, mapping[patch], hf)
            if len(pairs): static_contacts.append(case)
            max_dev = max(max_dev, sample_deviation(p, refs, found))
        posed_contacts = []
        for j, (p, h) in enumerate(all_poses):
            pairs = patch_pairs(p[patch], h, mapping[patch], hf)
            if len(pairs): posed_contacts.append(frames[j])
            max_dev = max(max_dev, sample_deviation(p, refs, found))
        ranked.append({'criticalContacts': score, 'patch': patch.tolist(),
                       'staticContacts': static_contacts,
                       'posedContacts': posed_contacts,
                       'maxUVSamplePositionDelta': max_dev})
    ranked.sort(key=lambda r: (r['criticalContacts'],
                               len(r.get('staticContacts', [])) + len(r.get('posedContacts', [])),
                               r.get('maxUVSamplePositionDelta', 1e9)))
    out = {'inputSha256': sha(candidate), 'sourceBuild': str(build_root),
           'ring': ring.tolist(), 'fanFaces': fan.tolist(),
           'uvPolygonArea': uv_area, 'candidateCount': len(ranked),
           'noNewContactCandidates': sum(not r['criticalContacts'] and not r.get('staticContacts')
                                         and not r.get('posedContacts') for r in ranked),
           'candidates': ranked,
           'note': 'Topology-only numeric probe; no resource roundtrip, native skin-byte, UV shading, continuous pose, or game check.'}
    (HERE / 'crease_surface_probe_summary.json').write_text(json.dumps(out, indent=2) + '\n')
    for r in ranked[:10]:
        print('rank', r['criticalContacts'], len(r.get('staticContacts', [])),
              len(r.get('posedContacts', [])), r.get('maxUVSamplePositionDelta'), r['patch'])
    split = split_center_probe(data, names, mapping, pf, hf, hb, ht, pb, pt,
                               pose, frames, mat, source_faces)
    if split['allEightClearCount']:
        variant = data['morphChange'].copy()
        variant[names.index('h091_eyes'), 119] += split['bestSharedDelta']
        variant_path = EXP / 'generated/morph-aware/crease-shallow-center.npz'
        variant_path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(variant_path, field=data['field'],
                            baseChange=data['baseChange'], morphChange=variant,
                            mapping=mapping)
        split['numericCandidate'] = variant_path.relative_to(ROOT).as_posix()
        split['numericSha256'] = sha(variant_path)
        variant[names.index('h091_eyes'), 119] += (np.asarray(split['bestInteriorDelta'])
                                                   - np.asarray(split['bestSharedDelta']))
        interior_path = EXP / 'generated/morph-aware/crease-interior-center.npz'
        np.savez_compressed(interior_path, field=data['field'],
                            baseChange=data['baseChange'], morphChange=variant,
                            mapping=mapping)
        split['interiorNumericCandidate'] = interior_path.relative_to(ROOT).as_posix()
        split['interiorNumericSha256'] = sha(interior_path)
    (HERE / 'crease_split_center_summary.json').write_text(json.dumps(split, indent=2) + '\n')
    print('split-center legal', split['legalDeltas'], 'of', split['testedDeltas'])
    print('split-center face counts', [(r['face'], r['legalAndClearCriticalDeltas'])
                                       for r in split['faceResults']])


if __name__ == '__main__':
    main()
