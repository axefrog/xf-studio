"""Counterfactual posed-shell diagnosis; never writes game resources or master art.

Recomputing displacement after skinning is an oracle, not an available game feature.
Reports whether direction construction can fix contacts before investing in a new
resource candidate. All output is local/ignored under the preserved input build.
"""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / '004-plate-import'))
from verify_roundtrip import Glb
from triangles import contacts, intersect_pairs, self_test as triangle_test
from constrained_offset import adjacency, displacement, self_test as constraint_test


def geometric(points, faces, mapping):
    t = points[faces]
    n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    n /= np.maximum(np.linalg.norm(n, axis=1), 1e-30)[:, None]
    total = np.zeros_like(points)
    for k in range(3):
        a, b = t[:, (k + 1) % 3] - t[:, k], t[:, (k + 2) % 3] - t[:, k]
        angle = np.arctan2(np.linalg.norm(np.cross(a, b), axis=1), np.sum(a * b, axis=1))
        np.add.at(total, faces[:, k], n * angle[:, None])
    chosen = total[mapping]
    length = np.linalg.norm(chosen, axis=1)
    assert length.min() > 1e-8
    return chosen / length[:, None]


def classify(p, h, pt, ht, source):
    hit = contacts(p[pt], h[ht])
    pairs = np.array(hit['pairs'], dtype=int).reshape(-1, 2)
    original = ht[source[pairs[:, 0]]]
    other = ht[pairs[:, 1]]
    shared = np.array([len(set(a) & set(b)) for a, b in zip(original, other)])
    previous = intersect_pairs(h[original], h[other])
    n = np.cross(h[ht[source, 1]] - h[ht[source, 0]], h[ht[source, 2]] - h[ht[source, 0]])
    n /= np.linalg.norm(n, axis=1)[:, None]
    plane = np.sum((p[pt] - h[ht[source, 0], None]) * n[:, None], axis=2)
    return {'pairs': len(pairs), 'plateTriangles': hit['plateTrianglesInContact'],
            'sharedSourceVertices': {str(i): int((shared == i).sum()) for i in range(4)},
            'existingNonAdjacentFoldPairs': int(((shared == 0) & previous).sum()),
            'newNonAdjacentPairs': int(((shared == 0) & ~previous).sum()),
            'minOwnFacePlaneDistance': float(plane.min()),
            'ownFacesWithVertexBehind': int((plane.min(axis=1) < -1e-9).sum()),
            'contactPairs': pairs.tolist()}


def main():
    triangle_test()
    constraint_test()
    root = Path(json.loads((HERE / 'latest-build.json').read_text(encoding='utf-8'))['root'])
    build = json.loads((root / 'build.json').read_text(encoding='utf-8'))
    assert build['preserveHeadWeights']
    manifest = json.loads((root / 'posed/manifest.json').read_text(encoding='utf-8'))
    analysis = json.loads((root / 'contact-analysis.json').read_text(encoding='utf-8'))
    mapping = np.array(json.loads(Path(build['mapping']).read_text(encoding='utf-8'))['plateToHeadIndices'])
    head = Glb(Path(build['head']))
    ht = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    hp_path = root / 'posed/head.positions.f64'
    hp = np.fromfile(hp_path, dtype='<f8').reshape(len(manifest['frames']), -1, 3)
    incident = adjacency(ht, len(hp[0]))
    lookup = {tuple(sorted(f)): i for i, f in enumerate(ht)}
    inputs = [root / 'build.json', root / 'posed/manifest.json', Path(build['mapping']), Path(build['head']), hp_path]
    rows = []
    for c in build['candidates']:
        plate = Glb(Path(c['roundtrip']))
        pt = plate.array(plate.p['indices']).astype(int).reshape(-1, 3)
        source = np.array([lookup[tuple(sorted(f))] for f in mapping[pt]])
        pp_path = root / f'posed/{c["name"]}.positions.f64'
        inputs.extend([Path(c['roundtrip']), pp_path])
        pp = np.fromfile(pp_path, dtype='<f8').reshape(len(manifest['frames']), -1, 3)
        for frame in sorted({r['frame'] for r in analysis['reports'] if r['candidate'] == c['name']}):
            idx = manifest['frames'].index(frame)
            h, actual = hp[idx], pp[idx]
            normal = geometric(h, ht, mapping)
            exact = h[mapping] + c['offset'] * normal
            solved = displacement(h, ht, mapping, incident)
            lengths = np.linalg.norm(solved, axis=1)
            variants = [('actual', actual), ('posed-normal-oracle', exact)]
            for budget in [4, 5, 8]:
                usable = np.isfinite(lengths) & (lengths <= budget)
                # No hidden cap: unsupported vertices explicitly retain the posed-normal oracle.
                bounded = exact.copy()
                bounded[usable] = h[mapping[usable]] + c['offset'] * solved[usable]
                variants.append((f'posed-constrained-{budget}x-oracle', bounded))
            transport = actual - h[mapping]
            cosine = np.sum(transport * normal, axis=1) / np.linalg.norm(transport, axis=1)
            summary = {'candidate': c['name'], 'frame': frame,
                       'posedConstraintUnresolved': int((~np.isfinite(lengths)).sum()),
                       'posedConstraintOver4': int((np.isfinite(lengths) & (lengths > 4)).sum()),
                       'maxFiniteConstraintMultiplier': float(lengths[np.isfinite(lengths)].max()),
                       'actualDisplacementOpposesPosedNormal': int((cosine < 0).sum()),
                       'actualToPosedNormalAngleMaxDegrees': float(np.rad2deg(np.arccos(np.clip(cosine, -1, 1))).max()),
                       'variants': {}}
            for name, p in variants:
                report = classify(p, h, pt, ht, source)
                summary['variants'][name] = report
                print(json.dumps({'candidate': c['name'], 'frame': frame, 'variant': name,
                                  **{k: v for k, v in report.items() if k != 'contactPairs'}}), flush=True)
            rows.append(summary)
    out = root / 'posed-correction-probe.json'
    result = {'inputs': [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in inputs],
              'results': rows, 'limitations': [
                  'Posed normal and half-space offsets are diagnostic oracles, not baked/implementable game resources.',
                  'Unresolved/over-budget constrained vertices fall back explicitly to posed geometric normals.',
                  'Only representative existing first/closed/worst frames and the saved five-morph shape.',
                  'No new visibility test or runtime shader/animation-graph evidence.']}
    out.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(str(out), flush=True)


if __name__ == '__main__':
    main()
