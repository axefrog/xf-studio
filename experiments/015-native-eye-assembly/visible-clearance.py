"""Blender BVH visibility and unsigned vertex clearance for finite native-eye contacts.

Run with Blender 5 in background mode after sample-clearance.ts and
analyze-clearance.py. All source geometry lives in ignored generated/.
"""
import hashlib
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / '006-plate-clearance'))
from contact_visibility import segment_points, self_test

VIEWS = {
    'front': [0., 0., -1.],
    'left30': [-.5, 0., -.866025403784],
    'right30': [.5, 0., -.866025403784],
    'above20': [0., .342020143326, -.939692620786],
    'below20': [0., -.342020143326, -.939692620786],
}
DEPTH_TOLERANCE = 2e-6
HEAD_FACING_TOLERANCE = 1e-5
POINT_SAMPLE_IDS = (0, 4, 8)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_vertices(root, manifest, shape, frame, name):
    row = manifest['surfaces'][f'{shape}/{frame}/{name}']
    path = root / row['file']
    assert sha(path) == row['sha256']
    values = np.fromfile(path, dtype='<f8').reshape(-1, 3)
    assert values.shape == (row['vertices'], 3) and np.isfinite(values).all()
    return values


def ray_gap(tree, camera, point):
    direction = point - camera
    distance = float(np.linalg.norm(direction))
    if distance <= 0:
        return None
    hit, _, _, depth = tree.ray_cast(Vector(camera), Vector(direction / distance), distance + .01)
    return None if hit is None else distance - depth


def make_tree(vertices, faces):
    return BVHTree.FromPolygons(vertices.tolist(), faces.tolist(), all_triangles=True)


def main():
    self_test()
    root = HERE / 'generated' / 'clearance'
    manifest = json.loads((root / 'manifest.json').read_text())
    contact_path = root / 'contact-pairs.json'
    contact = json.loads(contact_path.read_text())
    assert manifest['schema'] == 'xfs/native-eye-finite-samples-1'
    assert contact['schema'] == 'xfs/native-eye-finite-contact-1'
    assert contact['sampleManifestSha256'] == sha(root / 'manifest.json')
    faces = {}
    for name, row in manifest['meshIndices'].items():
        path = root / row['file']
        assert sha(path) == row['sha256']
        faces[name] = np.asarray(json.loads(path.read_text()), dtype=int).reshape(-1, 3)
    reports = []
    for shape in manifest['shapes']:
        for frame in manifest['frames']:
            vertices = {name: load_vertices(root, manifest, shape, frame, name)
                        for name in ['head', 'native-eye', 'native-lash', 'native-wetness']}
            trees = {name: make_tree(vertices[name], faces[name]) for name in vertices}
            # A second opaque-geometry proxy includes the other two native chunks.
            all_vertices = np.concatenate([vertices[name] for name in vertices])
            all_faces = []
            offset = 0
            for name in vertices:
                all_faces.append(faces[name] + offset)
                offset += len(vertices[name])
            combined = make_tree(all_vertices, np.concatenate(all_faces))
            centre = vertices['native-eye'].mean(axis=0)
            cameras = {name: centre + np.asarray(direction) * .35 for name, direction in VIEWS.items()}
            for name in ['native-eye', 'native-lash', 'native-wetness']:
                row = next(r for r in contact['rows'] if r['shape'] == shape and r['frame'] == frame and r['part'] == name)
                distances = []
                for point in vertices[name]:
                    hit = trees['head'].find_nearest(Vector(point), .05)
                    if hit[0] is None:
                        raise AssertionError(f'No head surface within 5 cm of {name} vertex')
                    distances.append(float(hit[3]))
                distances = np.asarray(distances)
                visible_pair = visible_all = unresolved_segments = 0
                witness = None
                for part_face, head_face in row['pairs']:
                    part_tri = vertices[name][faces[name][part_face]]
                    head_tri = vertices['head'][faces['head'][head_face]]
                    normal = np.cross(head_tri[1] - head_tri[0], head_tri[2] - head_tri[0])
                    normal /= np.linalg.norm(normal)
                    samples = segment_points(part_tri, head_tri)
                    if samples is None:
                        unresolved_segments += 1
                        continue
                    pair_hit = all_hit = False
                    for view, camera in cameras.items():
                        for sample_index in POINT_SAMPLE_IDS:
                            point = samples[sample_index]
                            camera_direction = camera - point
                            if float(normal @ (camera_direction / np.linalg.norm(camera_direction))) <= HEAD_FACING_TOLERANCE:
                                continue
                            head_gap = ray_gap(trees['head'], camera, point)
                            part_gap = ray_gap(trees[name], camera, point)
                            if head_gap is None or part_gap is None:
                                continue
                            if abs(head_gap) <= DEPTH_TOLERANCE and abs(part_gap) <= DEPTH_TOLERANCE:
                                pair_hit = True
                                full_gap = ray_gap(combined, camera, point)
                                if full_gap is not None and abs(full_gap) <= DEPTH_TOLERANCE:
                                    all_hit = True
                                    if witness is None:
                                        witness = {'view': view, 'partTriangle': part_face, 'headTriangle': head_face,
                                                   'sampleIndex': sample_index, 'headDepthGap': head_gap,
                                                   'partDepthGap': part_gap, 'allSurfaceDepthGap': full_gap}
                                    break
                        if all_hit:
                            break
                    visible_pair += int(pair_hit)
                    visible_all += int(all_hit)
                reports.append({'shape': shape, 'frame': frame, 'part': name,
                                'contactPairs': row['contactPairs'],
                                'pairwiseExposedContactPairs': visible_pair,
                                'allOpaqueSurfaceExposedContactPairs': visible_all,
                                'unresolvedCoplanarOrPointSegments': unresolved_segments,
                                'minimumVertexToHeadMeters': float(distances.min()),
                                'p10VertexToHeadMeters': float(np.percentile(distances, 10)),
                                'medianVertexToHeadMeters': float(np.median(distances)),
                                'maximumVertexToHeadMeters': float(distances.max()),
                                'witness': witness})
                print(shape, frame, name, row['contactPairs'], visible_pair, visible_all, flush=True)
    report = {'schema': 'xfs/native-eye-visible-clearance-1',
              'inputs': {'sampleManifestSha256': sha(root / 'manifest.json'),
                         'contactPairsSha256': sha(contact_path)},
              'blender': bpy.app.version_string,
              'views': VIEWS, 'segmentSampleIds': POINT_SAMPLE_IDS,
              'depthToleranceMeters': DEPTH_TOLERANCE,
              'headFacingDotTolerance': HEAD_FACING_TOLERANCE,
              'rows': reports,
              'limits': 'Finite sampled phases and triangle/vertex geometry only. Five head-relative cameras, front-facing head triangles and three actual intersection-segment samples per pair. Opaque BVH proxy ignores alpha, material, refraction, game depth policy and between-frame motion. No visible witness means unresolved, not hidden.'}
    output = HERE / 'clearance-evidence.json'
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'evidence': str(output), 'sha256': sha(output),
                      'exposedRows': sum(r['allOpaqueSurfaceExposedContactPairs'] > 0 for r in reports)}))


if __name__ == '__main__':
    main()
