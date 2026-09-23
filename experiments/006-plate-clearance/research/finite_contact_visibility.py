"""Blender head-only exposure follow-up for finite-contact face/pose queries."""
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(EXP))
sys.path.insert(0, str(EXP.parent/'004-plate-import'))
from contact_visibility import bvh, self_test
from verify_roundtrip import Glb
from visibility_margin_sample import VIEWS, BARY


def main():
    self_test()
    path = HERE/'finite_contact_summary.json'
    report = json.loads(path.read_text(encoding='utf-8'))
    root = Path(report['build'])
    manifest = json.loads((root/'posed/manifest.json').read_text(encoding='utf-8'))
    build = json.loads((root/'build.json').read_text(encoding='utf-8'))
    head = Glb(Path(build['head']))
    faces = head.array(head.p['indices']).astype(int).reshape(-1,3)
    hp = np.fromfile(root/'posed/head.positions.f64',dtype='<f8').reshape(len(manifest['frames']),-1,3)
    mapping = np.array(json.loads(Path(build['mapping']).read_text(encoding='utf-8'))['plateToHeadIndices'])
    centre = hp[0,mapping].mean(axis=0)
    original = {(r['frame'],r['headTriangle']):r['category'] for r in
                json.loads((root/'visibility_margin_samples.json').read_text(encoding='utf-8'))['rows']}
    pending = set()
    for row in report['queries']:
        frame = row['frame']
        nearest = row['nearestHead']
        if nearest['faceExposure'] == 'unclassified':
            pending.add((frame,nearest['headTriangle']))
        for _,face in row['newNonadjacentContactPairs']:
            pending.add((frame,face))
    observations = {}
    for frame in sorted({f for f,_ in pending}):
        s = manifest['frames'].index(frame)
        origin = hp[s].mean(axis=0)
        h = hp[s]-origin
        tree = bvh(h,faces)
        for _,face in sorted(k for k in pending if k[0]==frame):
            tri = h[faces[face]]
            normal = np.cross(tri[1]-tri[0],tri[2]-tri[0])
            area = float(np.linalg.norm(normal))
            normal /= max(area,1e-30)
            visible = ambiguous = 0
            witness = None
            for vi,direction in enumerate(VIEWS):
                camera = centre + np.array(direction)*.35-origin
                for bi,point in enumerate(BARY@tri):
                    delta = point-camera
                    distance = float(np.linalg.norm(delta))
                    facing = float(normal@(-delta/distance))
                    if facing < -1e-5:
                        continue
                    hit,_,first,depth = tree.ray_cast(Vector(camera),Vector(delta/distance),distance+.01)
                    gap = None if hit is None else distance-depth
                    if facing > 1e-5 and gap is not None and abs(gap)<=1e-7 and first==face:
                        visible += 1
                        if witness is None:
                            witness = {'viewIndex':vi,'barycentricIndex':bi,'firstHeadFace':int(first),
                                       'depthGap':float(gap),'facingDot':facing}
                    elif gap is None or gap < -1e-7 or abs(gap)<=2e-6:
                        ambiguous += 1
            if area < 1e-14:
                ambiguous += 1
            category = 'exposed' if visible else 'ambiguous' if ambiguous else 'sampled-hidden'
            if (frame,face) in original:
                assert category == original[(frame,face)]
            observations[(frame,face)] = {'category':category,'visibleRayCount':visible,
                                           'ambiguousRayCount':ambiguous,'witness':witness}
        print(f'Exposure frame {frame} complete',flush=True)
    for row in report['queries']:
        key = (row['frame'],row['nearestHead']['headTriangle'])
        if key in observations:
            row['nearestHead']['faceExposure'] = observations[key]['category']
            row['nearestHead']['exposureWitness'] = observations[key]['witness']
        row['newNonadjacentContactHeadFaceExposure'] = [
            {'plateTriangle':i,'headTriangle':j,
             'headFaceExposure':observations[(row['frame'],j)]['category'],
             'witness':observations[(row['frame'],j)]['witness']}
            for i,j in row['newNonadjacentContactPairs']]
    report['visibilityFollowUp'] = {'blender':bpy.app.version_string,'views':len(VIEWS),
        'strictInteriorSamplesPerFaceView':len(BARY),'uniqueFacePoses':len(observations),
        'counts':{k:sum(v['category']==k for v in observations.values()) for k in
                  ['exposed','ambiguous','sampled-hidden']},
        'method':'Same head-only camera rays and conservative thresholds as visibility_margin_sample.py.',
        'limits':'Exposed head face does not prove the head-plus-plate intersection segment is visible.'}
    report['inputs'].append({'path':str(HERE/'visibility_margin_sample.py'),
        'sha256':hashlib.sha256((HERE/'visibility_margin_sample.py').read_bytes()).hexdigest()})
    path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report['visibilityFollowUp']),flush=True)


if __name__ == '__main__':
    main()
