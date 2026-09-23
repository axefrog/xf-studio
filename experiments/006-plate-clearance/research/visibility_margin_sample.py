"""Dense, conservative local visibility sampling; Blender Python, read-only inputs."""
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
sys.path.insert(0, str(EXP))
from contact_visibility import bvh, self_test
from verify_roundtrip import Glb

# Retain the original exact five directions, then expand horizontal/vertical views.
VIEWS = [[0, 0, -1], [-.5, 0, -.8660254], [.5, 0, -.8660254],
         [0, .3420201, -.9396926], [0, -.3420201, -.9396926]]
for pitch in [-30, -15, 0, 15, 30]:
    for yaw in [-60, -45, -30, -15, 0, 15, 30, 45, 60]:
        p, y = math.radians(pitch), math.radians(yaw)
        VIEWS.append([math.sin(y)*math.cos(p), math.sin(p), -math.cos(y)*math.cos(p)])
BARY = np.array([[1/3]*3, [.6, .2, .2], [.2, .6, .2], [.2, .2, .6]] +
                [[i/8, j/8, (8-i-j)/8] for i in range(1, 7) for j in range(1, 8-i)])


def main():
    self_test()
    source = EXP / 'fixed_summary.json'
    summary = json.loads(source.read_text(encoding='utf-8'))
    root = Path(summary['build'])
    fixed_path = root / 'fixed_feasibility.json'
    assert hashlib.sha256(fixed_path.read_bytes()).hexdigest() == summary['verification']['reportSha256']
    fixed = json.loads(fixed_path.read_text(encoding='utf-8'))
    for item in fixed['inputs']:
        assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest() == item['sha256']
    build = json.loads((root/'build.json').read_text(encoding='utf-8'))
    head = Glb(Path(build['head']))
    faces = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    mapping = np.array(json.loads(Path(build['mapping']).read_text(encoding='utf-8'))['plateToHeadIndices'])
    hp = np.fromfile(root/'posed/head.positions.f64', dtype='<f8').reshape(len(fixed['frames']), -1, 3)
    failures = [v for v in fixed['verticesReport'] if v['status'] != 'feasible']
    face_ids = sorted({f for v in failures for f in v['incidentTriangles']})
    centre = hp[0, mapping].mean(axis=0)
    old = json.loads((root/'fixed_failure_plane_visibility.json').read_text(encoding='utf-8'))
    old_by_key = {(r['frame'], r['headTriangle']): r for r in old}
    rows = []
    for s, frame in enumerate(fixed['frames']):
        origin = hp[s].mean(axis=0)
        h = hp[s]-origin
        tree = bvh(h, faces)
        for fid in face_ids:
            tri = h[faces[fid]]
            normal = np.cross(tri[1]-tri[0], tri[2]-tri[0])
            area = float(np.linalg.norm(normal))
            visible, ambiguous, front_rays, hits, witness = 0, 0, 0, set(), None
            normal /= max(area, 1e-30)
            for view_index, direction in enumerate(VIEWS):
                camera = centre + np.array(direction)*.35-origin
                for sample_index, point in enumerate(BARY @ tri):
                    delta = point-camera
                    distance = float(np.linalg.norm(delta))
                    facing = float(normal @ (-delta/distance))
                    if facing < -1e-5:
                        continue
                    front_rays += 1
                    hit, _, face, depth = tree.ray_cast(Vector(camera), Vector(delta/distance), distance+.01)
                    gap = None if hit is None else distance-depth
                    if facing > 1e-5 and gap is not None and abs(gap) <= 1e-7:
                        visible += 1
                        if witness is None:
                            witness = {'viewIndex': view_index, 'barycentricIndex': sample_index,
                                       'depthGap': float(gap), 'facingDot': facing, 'firstHeadFace': int(face)}
                    elif gap is None or gap < -1e-7 or abs(gap) <= 2e-6:
                        ambiguous += 1
                    elif face is not None:
                        hits.add(int(face))
            if area < 1e-14:
                ambiguous += 1
            category = 'exposed' if visible else 'ambiguous' if ambiguous else 'sampled-hidden'
            old_row = old_by_key[(frame, fid)]
            old_exposed = any(v['front'] and v['visible']['1e-06'] for v in old_row['views'].values())
            # Dense sampling includes all previous rays; broaden uncertainty rather than lose their evidence.
            if old_exposed and category == 'sampled-hidden':
                raise AssertionError(('Lost earlier exposed classification', frame, fid))
            rows.append({'frame': frame, 'headTriangle': fid, 'category': category,
                         'positiveMargin': category != 'sampled-hidden', 'visibleRayCount': visible,
                         'ambiguousRayCount': ambiguous, 'frontRayCount': front_rays,
                         'previouslyExposed': bool(old_exposed), 'occludingFaces': sorted(hits), 'witness': witness})
        if s % 10 == 0:
            print(f'Dense visibility {s+1}/{len(fixed["frames"])}', flush=True)
    output = root/'visibility_margin_samples.json'
    report = {'build': str(root), 'frames': fixed['frames'], 'headFaces': face_ids,
              'viewDirections': VIEWS, 'barycentricSamples': BARY.tolist(), 'blender': bpy.app.version_string,
              'strictDepthTolerance': 1e-7, 'ambiguousDepthTolerance': 2e-6, 'grazingDotTolerance': 1e-5,
              'counts': {k: sum(r['category'] == k for r in rows) for k in ['exposed', 'ambiguous', 'sampled-hidden']},
              'newPositiveFacePoses': sum(r['positiveMargin'] and not r['previouslyExposed'] for r in rows),
              'inputs': [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in
                         [source, fixed_path, root/'fixed_failure_plane_visibility.json', root/'posed/head.positions.f64',
                          Path(build['head']), Path(build['mapping'])]], 'rows': rows}
    output.write_text(json.dumps(report, separators=(',', ':'))+'\n', encoding='utf-8')
    print(json.dumps({'path': str(output), 'counts': report['counts'],
                      'newPositiveFacePoses': report['newPositiveFacePoses'], 'views': len(VIEWS), 'samples': len(BARY)}), flush=True)


if __name__ == '__main__':
    main()
