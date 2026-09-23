"""Blender diagnostic: camera visibility of actual plate/head intersection segments.

Uses generated sampled geometry only. No source art is opened or changed. Occlusion
is geometric and opaque, not an assertion about game alpha/depth/material behavior.
"""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / '004-plate-import'))
from triangles import contacts, intersect_pairs
from verify_roundtrip import Glb


def segment_points(a, b):
    """Find transverse intersection endpoints from both sets of triangle edges.

    Coplanar cases remain unresolved instead of being classified as hidden.
    """
    points = []
    for edges, triangle in [(a, b), (b, a)]:
        e1, e2 = triangle[1] - triangle[0], triangle[2] - triangle[0]
        for i in range(3):
            origin, direction = edges[i], edges[(i + 1) % 3] - edges[i]
            h = np.cross(direction, e2)
            det = np.dot(e1, h)
            if abs(det) <= 1e-18:
                continue
            s = origin - triangle[0]
            u = np.dot(s, h) / det
            q = np.cross(s, e1)
            v, t = np.dot(direction, q) / det, np.dot(e2, q) / det
            if u >= -1e-8 and v >= -1e-8 and u + v <= 1 + 1e-8 and -1e-8 <= t <= 1 + 1e-8:
                point = origin + np.clip(t, 0, 1) * direction
                if all(np.linalg.norm(point - existing) > 1e-10 for existing in points):
                    points.append(point)
    if not points:
        return None
    points = np.array(points)
    distance = np.linalg.norm(points[:, None] - points[None], axis=2)
    i, j = np.unravel_index(distance.argmax(), distance.shape)
    # Include both endpoints and seven interior samples, even for short contacts.
    weights = np.linspace(0, 1, 9)[:, None]
    return points[i] * (1 - weights) + points[j] * weights


def bvh(vertices, faces):
    return BVHTree.FromPolygons(vertices.tolist(), faces.tolist(), all_triangles=True)


def gap_to_surface(tree, camera, point):
    delta = point - camera
    distance = np.linalg.norm(delta)
    hit, normal, face, depth = tree.ray_cast(Vector(camera), Vector(delta / distance), float(distance + .01))
    if hit is None:
        return None
    return float(distance - depth)


def self_test():
    a = np.array([[0., 0, 0], [1, 0, 0], [0, 1, 0]])
    b = np.array([[.2, .2, -1], [.2, .2, 1], [.8, .2, 0]])
    for scale in [1, .001]:
        points = segment_points(a * scale, b * scale)
        assert points is not None and np.max(abs(points[:, 2])) < 1e-12
        assert np.allclose(points[:, 1], .2 * scale)
        assert abs(np.ptp(points[:, 0]) - .6 * scale) < 1e-12
        assert segment_points(a * scale, (a + [0, 0, .1]) * scale) is None
        assert segment_points(a * scale, a * scale) is None
    tree = bvh(a, np.array([[0, 1, 2]]))
    camera = np.array([.2, .2, -1.])
    assert abs(gap_to_surface(tree, camera, np.array([.2, .2, 0]))) < 1e-7
    assert abs(gap_to_surface(tree, camera, np.array([.2, .2, .1])) - .1) < 1e-7
    assert abs(gap_to_surface(tree, camera, np.array([.2, .2, -.00005])) + .00005) < 1e-7


def main():
    self_test()
    comparison = json.loads((HERE / 'comparison.json').read_text())
    roots = sorted({r['build'] for r in comparison['candidates']})
    reports = []
    inputs = []
    tolerance = 1e-6
    views = {'front': [0, 0, -1], 'left30': [-.5, 0, -.8660254],
             'right30': [.5, 0, -.8660254], 'above20': [0, .3420201, -.9396926],
             'below20': [0, -.3420201, -.9396926]}
    for location in roots:
        root = Path(location)
        build = json.loads((root / 'build.json').read_text())
        manifest = json.loads((root / 'posed/manifest.json').read_text())
        analysis = json.loads((root / 'contact-analysis.json').read_text())
        assert Path(analysis['build']) == root
        expected_hashes = {surface['name']: surface['sha256'] for surface in manifest['surfaces']}
        assert hashlib.sha256(Path(build['head']).read_bytes()).hexdigest() == expected_hashes['head']
        head = Glb(Path(build['head']))
        ht = head.array(head.p['indices']).astype(int).reshape(-1, 3)
        hp = np.fromfile(root / 'posed/head.positions.f64', dtype='<f8').reshape(len(manifest['frames']), -1, 3)
        mapping = np.array(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'])
        source_faces = {tuple(sorted(t)): i for i, t in enumerate(ht)}
        paths = [root / 'build.json', root / 'posed/manifest.json', Path(build['head']), Path(build['mapping']), root / 'posed/head.positions.f64']
        details = []
        for candidate in build['candidates']:
            assert hashlib.sha256(Path(candidate['roundtrip']).read_bytes()).hexdigest() == expected_hashes[candidate['name']]
            plate = Glb(Path(candidate['roundtrip']))
            pt = plate.array(plate.p['indices']).astype(int).reshape(-1, 3)
            source = np.array([source_faces[tuple(sorted(t))] for t in mapping[pt]])
            posed_path = root / f'posed/{candidate["name"]}.positions.f64'
            paths.extend([Path(candidate['roundtrip']), posed_path])
            pp = np.fromfile(posed_path, dtype='<f8').reshape(len(manifest['frames']), -1, 3)
            # Fixed cameras across the animated samples, centred on the first plate pose.
            centre = pp[0].mean(axis=0)
            cameras = {name: centre + np.array(direction) * .35 for name, direction in views.items()}
            frames = sorted({r['frame'] for r in analysis['reports'] if r['candidate'] == candidate['name']})
            for frame in frames:
                index = manifest['frames'].index(frame)
                h, p = hp[index], pp[index]
                # Recenter before float32 BVH construction to reduce precision loss.
                origin = h.mean(axis=0)
                h, p = h - origin, p - origin
                head_tree = bvh(h, ht)
                combined_tree = bvh(np.concatenate([h, p]), np.concatenate([ht, pt + len(h)]))
                pairs = np.array(contacts(p[pt], h[ht])['pairs'], dtype=int).reshape(-1, 2)
                rows = []
                for plate_id, head_id in pairs:
                    a, b = p[pt[plate_id]], h[ht[head_id]]
                    points = segment_points(a, b)
                    row = {'plateTriangle': int(plate_id), 'headTriangle': int(head_id),
                           'sharedSourceVertices': len(set(ht[source[plate_id]]) & set(ht[head_id])),
                           'alreadyIntersectsInHead': bool(intersect_pairs(h[ht[source[plate_id]]][None], b[None])[0]),
                           'resolvedSegment': points is not None, 'views': {}}
                    if points is not None:
                        normal = np.cross(a[1] - a[0], a[2] - a[0])
                        for view, camera in cameras.items():
                            camera = camera - origin
                            front = float(np.dot(normal, camera - a.mean(axis=0))) > 0
                            head_gaps = [gap_to_surface(head_tree, camera, q) for q in points]
                            combined_gaps = [gap_to_surface(combined_tree, camera, q) for q in points]
                            valid = [gap for gap in combined_gaps if gap is not None]
                            row['views'][view] = {'plateFrontFacing': front,
                                'headVisibleSamples': sum(g is not None and abs(g) <= tolerance for g in head_gaps),
                                'combinedVisibleSamples': sum(g is not None and abs(g) <= tolerance for g in combined_gaps),
                                'missingRayHits': sum(g is None for g in combined_gaps),
                                'minOcclusionDepth': min(valid) if valid else None,
                                'visibleAtTolerances': {str(e): sum(abs(g) <= e for g in valid) for e in [1e-7, 1e-6, 1e-5]}}
                    rows.append(row)
                exposed = [r for r in rows if any(v['plateFrontFacing'] and v['combinedVisibleSamples'] for v in r['views'].values())]
                entry = {'build': str(root), 'preserveHeadWeights': build.get('preserveHeadWeights', False), 'candidate': candidate['name'], 'frame': frame, 'pairs': len(rows),
                         'unresolvedPairs': sum(not r['resolvedSegment'] for r in rows),
                         'exposedPairs': len(exposed), 'exposedPlateTriangles': sorted({r['plateTriangle'] for r in exposed}),
                         'exposedNewNonAdjacentPairs': sum(r['sharedSourceVertices'] == 0 and not r['alreadyIntersectsInHead'] for r in exposed),
                         'byView': {name: sum(r['views'].get(name, {}).get('plateFrontFacing', False) and r['views'][name]['combinedVisibleSamples'] > 0 for r in rows) for name in views},
                         'toleranceSensitivity': {str(e): sum(any(v['plateFrontFacing'] and v['visibleAtTolerances'][str(e)] for v in r['views'].values()) for r in rows) for e in [1e-7, 1e-6, 1e-5]}}
                details.append({**entry, 'contacts': rows})
                reports.append(entry)
                print(json.dumps({k: v for k, v in entry.items() if k not in ['contacts', 'build', 'exposedPlateTriangles']}), flush=True)
        detailed = root / 'contact-visibility-details.json'
        detailed.write_text(json.dumps(details, separators=(',', ':')) + '\n', encoding='utf-8')
        paths.append(detailed)
        inputs.extend({'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in paths)
    report = {'blender': bpy.app.version_string, 'method': 'Nine samples per actual intersection segment, five fixed perspective viewpoints, opaque head plus plate BVH',
              'tolerance': tolerance, 'viewDirections': views, 'cameraDistance': .35, 'inputs': inputs,
              'reports': reports, 'releaseCandidateSelected': False,
              'limitations': ['Only the representative neutral/closed/worst-contact sampled frames, not every animation frame or custom morph.',
                             'Finite segment samples and cameras cannot prove invisibility from every view.',
                             'Coplanar/unresolved segments are not considered hidden.',
                             'Head-only and head+plate occlusion are reported separately; actual makeup coverage and game blending are not simulated.',
                             'Front-facing classification uses triangle winding; game culling settings may differ.',
                             'Visibility is a geometric diagnostic, not a game rendering claim.']}
    (HERE / 'contact-visibility.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
