"""Read-only sampled visibility audit of certified fixed-shell failure planes.

Run with Blender Python. Full per-plane observations stay in ignored generated/;
the adjacent summary contains metadata only. No plate construction or mutation.
"""
import hashlib
import json
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

VIEWS = {'front': [0, 0, -1], 'left30': [-.5, 0, -.8660254],
         'right30': [.5, 0, -.8660254], 'above20': [0, .3420201, -.9396926],
         'below20': [0, -.3420201, -.9396926]}
BARY = np.array([[1/3, 1/3, 1/3], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6]])


def main():
    self_test()
    fixed_summary = json.loads((EXP / 'fixed_summary.json').read_text(encoding='utf-8'))
    root = Path(fixed_summary['build'])
    report_path = root / 'fixed_feasibility.json'
    report = json.loads(report_path.read_text(encoding='utf-8'))
    assert hashlib.sha256(report_path.read_bytes()).hexdigest() == fixed_summary['verification']['reportSha256']
    build = json.loads((root / 'build.json').read_text(encoding='utf-8'))
    paths = [report_path, root / 'build.json', Path(build['head']), root / 'posed/head.positions.f64',
             root / 'contact-visibility-details.json', Path(build['mapping'])]
    expected = {p['path']: p['sha256'] for p in report['inputs']}
    for p in paths:
        if str(p) in expected:
            assert hashlib.sha256(p.read_bytes()).hexdigest() == expected[str(p)]
    head = Glb(Path(build['head']))
    faces = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    mapping = np.array(json.loads(Path(build['mapping']).read_text(encoding='utf-8'))['plateToHeadIndices'])
    frames = report['frames']
    hp = np.fromfile(root / 'posed/head.positions.f64', dtype='<f8').reshape(len(frames), -1, 3)
    failures = [r for r in report['verticesReport'] if r['status'] != 'feasible']
    face_ids = sorted({f for r in failures for f in r['incidentTriangles']})
    centre = hp[0, mapping].mean(axis=0)
    observations = {}
    for s, frame in enumerate(frames):
        origin = hp[s].mean(axis=0)
        h = hp[s] - origin
        tree = bvh(h, faces)
        for fid in face_ids:
            tri = h[faces[fid]]
            normal = np.cross(tri[1]-tri[0], tri[2]-tri[0])
            row = {'frame': frame, 'headTriangle': fid, 'doubleArea': float(np.linalg.norm(normal)), 'views': {}}
            for name, direction in VIEWS.items():
                camera = centre + np.array(direction)*.35 - origin
                front = bool(normal @ (camera-tri.mean(axis=0)) > 0)
                gaps, hits = [], []
                for point in BARY @ tri:
                    delta = point-camera
                    distance = np.linalg.norm(delta)
                    hit, _, face, depth = tree.ray_cast(Vector(camera), Vector(delta/distance), float(distance+.01))
                    gaps.append(None if hit is None else float(distance-depth))
                    hits.append(None if face is None else int(face))
                row['views'][name] = {'front': front, 'gaps': gaps, 'firstHeadFaces': hits,
                    'visible': {str(t): sum(g is not None and abs(g)<=t for g in gaps) for t in [1e-7, 1e-6]}}
            observations[(frame, fid)] = row
        if s % 20 == 0:
            print(f'Visibility {s+1}/{len(frames)}', flush=True)

    def exposed(row, tolerance=1e-6):
        return any(v['front'] and v['visible'][str(tolerance)] for v in row['views'].values())

    details = json.loads((root / 'contact-visibility-details.json').read_text(encoding='utf-8'))
    output = []
    for failure in failures:
        incident = failure['incidentTriangles']
        sampled = [observations[(f, i)] for f in frames for i in incident]
        certificate = failure.get('opposedDualCertificate', failure.get('normDualCertificate'))
        planes = []
        for index, weight in zip(certificate['indices'], certificate['weights']):
            if weight <= 1e-10:
                continue
            frame, fid = frames[index//len(incident)], incident[index%len(incident)]
            obs = observations[(frame, fid)]
            blockers = sorted({i for v in obs['views'].values() if v['front']
                for g, i in zip(v['gaps'], v['firstHeadFaces']) if g is not None and g > 1e-6})
            planes.append({'frame': frame, 'headTriangle': fid, 'weight': weight,
                'exposed': exposed(obs), 'frontInAnyView': any(v['front'] for v in obs['views'].values()),
                'exposedAtStrictTolerance': exposed(obs, 1e-7),
                'occludingHeadFaces': blockers,
                'occludersSharingFailureVertex': [i for i in blockers if failure['headVertex'] in faces[i]]})
        face_life = {str(fid): {'exposedFrames': [f for f in frames if exposed(observations[(f, fid)])],
            'frontFrames': [f for f in frames if any(v['front'] for v in observations[(f, fid)]['views'].values())]}
            for fid in incident}
        contacts = []
        for case in details:
            involved = [r for r in case['contacts'] if r['headTriangle'] in incident]
            visible = [r for r in involved if any(v['plateFrontFacing'] and v['combinedVisibleSamples'] for v in r['views'].values())]
            contacts.append({'candidate': case['candidate'], 'frame': case['frame'], 'incidentHeadContactPairs': len(involved),
                'exposedPairs': len(visible), 'exposedNewNonAdjacentPairs': sum(r['sharedSourceVertices']==0 and not r['alreadyIntersectsInHead'] for r in visible)})
        normal_min = []
        for s in range(len(frames)):
            t = hp[s, faces[incident]]
            n = np.cross(t[:, 1]-t[:, 0], t[:, 2]-t[:, 0])
            n /= np.linalg.norm(n, axis=1)[:, None]
            normal_min.append(float((n @ n.T).min()))
        output.append({'headVertex': failure['headVertex'], 'plateVertex': failure['plateVertex'], 'uv': failure['uv'],
            'status': failure['status'], 'incidentFaces': incident,
            'exposedFacePoseCount': sum(exposed(r) for r in sampled), 'totalFacePoseCount': len(sampled),
            'toleranceSensitiveFacePoses': sum(bool(exposed(r, 1e-7)) != bool(exposed(r, 1e-6)) for r in sampled),
            'facesNeverExposedInSample': [int(f) for f, v in face_life.items() if not v['exposedFrames']],
            'everyIncidentFaceExposedSomewhere': all(v['exposedFrames'] for v in face_life.values()),
            'worstSamePoseNormalDot': min(normal_min), 'worstSamePoseNormalFrame': frames[int(np.argmin(normal_min))],
            'minimumDoubleArea': min(r['doubleArea'] for r in sampled),
            'certificatePlanes': planes, 'priorContactCases': contacts, 'faceLifetimes': face_life})
        output[-1]['certificateEntirelyExposed'] = all(p['exposed'] for p in planes)
        output[-1]['certificateEntirelyExposedAtStrictTolerance'] = all(p['exposedAtStrictTolerance'] for p in planes)
    detailed = root / 'fixed_failure_plane_visibility.json'
    detailed.write_text(json.dumps(list(observations.values()), separators=(',', ':'))+'\n', encoding='utf-8')
    paths.append(detailed)
    ever_exposed = {str(t): sorted({row['headTriangle'] for row in observations.values() if exposed(row, t)})
                    for t in [1e-7, 1e-6]}
    summary = {'build': str(root), 'blender': bpy.app.version_string, 'frames': len(frames), 'uniqueIncidentFaces': len(face_ids),
        'method': 'Head-only opaque BVH, four strict-interior barycentric samples per incident face, five fixed views, all 73 preserved poses.',
        'newAssetsCreated': False, 'releaseCandidateSelected': False,
        'inputs': [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths],
        'vertices': output,
        'everExposedFacesByTolerance': ever_exposed,
        'exposedOnlyConstraintFailureCertifiedVertices': [r['headVertex'] for r in output if r['certificateEntirelyExposedAtStrictTolerance']],
        'limits': ['Finite samples cannot prove permanent invisibility, continuous clearance or actual game rendering.',
            'Front-facing uses geometric winding; double-sided materials can differ.',
            'Failure-plane visibility is head-only. Contact exposure refers to older separate opaque head-plus-plate study.',
            'Contact joins select the head triangle involved; they do not claim every incident plate face was checked here.',
            'No selective relaxation or replacement geometry is approved by visibility alone.']}
    (HERE / 'fixed-failure-classification.json').write_text(json.dumps(summary, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'vertices': len(output), 'faces': len(face_ids),
        'allFacesEverExposedVertices': sum(r['everyIncidentFaceExposedSomewhere'] for r in output),
        'certificatePlanes': sum(len(r['certificatePlanes']) for r in output),
        'certificateExposed': sum(p['exposed'] for r in output for p in r['certificatePlanes'])}), flush=True)


if __name__ == '__main__':
    main()
