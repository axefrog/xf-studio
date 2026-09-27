"""Cheek range study (experiment 026 follow-up): how far V's facial rig lets the upper cheek move.

Loads the face skeleton and facial setup (WolvenKit JSON, from the Studio's facial cache) and the pinned, unmodified IO Suite
solver (as projects/xf-studio/authoring/tools/bake_idle_face.py does), solves single controls, combinations and whole expressions,
poses the skeleton with forward kinematics and reports, in the face's own frame (left = the character's left, up, forward = out
of the face) and in millimetres:

* how far each cheek-related control moves the malar cheek (the "apple" over the cheekbone), the lateral orbit, the lower lid, the
  nasolabial cheek, the lower mid-cheek and the mouth corner, at 0.25, 0.5, 0.75 and 1;
* whether combinations add up or hit correctives and limits (solved together versus the sum of the parts);
* the wrinkle outputs (the solver's 33 ...Wrnkl tracks) each pose drives, which the game's skin shader turns into wrinkle normals
  inside the UV rectangles of engine/materials/defaults/defaultfaceregions.regionset.

Game-derived numbers go to the ignored generated/ folder; only summaries are quoted in the research note.

    python experiments/026-natural-expressions/cheek-range.py --addon <IO Suite checkout> --rig <rig.json> --setup <setup.json>
        [--setup2 <another setup.json> --label2 male] [--extra <{name: controls}.json>]
"""
import argparse
import json
import sys
import types
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'projects/xf-studio/authoring/tools'))
from bake_idle_face import external_solver  # noqa: E402

WEIGHTS = (0.25, 0.5, 0.75, 1.0)


def qmul(a, b):
    xyz = a[:3] * b[3] + b[:3] * a[3] + np.cross(a[:3], b[:3])
    return np.r_[xyz, a[3] * b[3] - np.dot(a[:3], b[:3])]


def qrot(q, v):
    return v + 2 * np.cross(q[:3], np.cross(q[:3], v) + q[3] * v)


class Face:
    def __init__(self, addon, rig_path, setup_path):
        self.loader, self.runtime, self.model, self.solver = external_solver(addon)
        rig = json.loads(Path(rig_path).read_text(encoding='utf-8'))['Data']['RootChunk']
        self.names = [n['$value'] for n in rig['boneNames']]
        self.parents = [int(p) for p in rig['boneParentIndexes']]
        self.tracks = [n['$value'] for n in rig['trackNames']]
        self.reference = np.array(rig['referenceTracks'], dtype=np.float32)
        rest = rig['boneTransforms']
        self.rt = np.array([[b.get('Translation', {}).get(k, 0) for k in 'XYZ'] for b in rest], dtype=np.float64)
        self.rr = np.array([[b.get('Rotation', {}).get(k, d) for k, d in (('i', 0), ('j', 0), ('k', 0), ('r', 1))] for b in rest], dtype=np.float64)
        self.rr /= np.linalg.norm(self.rr, axis=1)[:, None]
        self.rs = np.array([[abs(b.get('Scale', {}).get(k, 1)) for k in 'XYZ'] for b in rest], dtype=np.float64)
        setup = self.loader.parse_facial_setup(json.loads(Path(setup_path).read_text(encoding='utf-8')))
        dims = types.SimpleNamespace(num_bones=len(self.names), num_tracks=len(self.tracks))
        self.compiled = self.runtime.compile_runtime(setup, dims, self.model.TrackSegments.from_setup(setup, len(self.tracks)))
        self.wrinkles = {}
        for part in self.compiled.parts:
            for offset, source in enumerate(part.wrinkle_source_tracks):
                self.wrinkles[self.tracks[part.wrinkle_start_track + offset]] = self.tracks[int(source)]
        self.rest = self.world(self.rt, self.rr)
        head, nose, leye = (self.rest[self.names.index(n)] for n in ('Head', 'mid_J_mug_nose_tip_rowA_0_JNT', 'l_J_eye_JNT'))
        # REDengine is Z-up; forward is head -> nose tip, left is toward the character's left eye.
        self.axes = dict(left=np.sign(leye[0] - head[0]) or 1, fwd=np.sign(nose[1] - head[1]) or 1)
        self.regions = regions(self)

    def world(self, t, r):
        p, q = np.zeros_like(t), np.zeros_like(r)
        for i, parent in enumerate(self.parents):
            if parent < 0:
                p[i], q[i] = t[i], r[i]
                continue
            p[i] = p[parent] + qrot(q[parent], t[i] * self.rs[parent])
            q[i] = qmul(q[parent], r[i])
        return p

    def solve(self, controls):
        values = self.reference.copy()
        for name, weight in controls.items():
            values[self.tracks.index(name)] += weight
        bq, bt, out = self.solver.solve_runtime(self.compiled, values, lod=0)
        t = self.rt + np.array([qrot(self.rr[i], bt[i].astype(np.float64) * self.rs[i]) for i in range(len(self.names))])
        r = np.array([qmul(self.rr[i], bq[i].astype(np.float64) / (np.linalg.norm(bq[i]) or 1)) for i in range(len(self.names))])
        moved = self.world(t, r) - self.rest
        wrinkles = {name: float(out[self.tracks.index(name)]) for name in self.wrinkles}
        return moved, wrinkles

    def frame(self, d):
        """Displacement (metres, rig axes) to the face frame in mm: left, up, forward."""
        return np.array([d[0] * self.axes['left'], d[2], d[1] * self.axes['fwd']]) * 1000


def regions(face):
    """The regions measured, by name and by rest position relative to the left eye (mm, face frame): the malar cheek (the "apple"
    under the eye, over the cheekbone), the lateral orbit (where crow's feet form), the lower mid-cheek (beside the mouth), the
    lower lid, the nasolabial cheek beside the nose, and the mouth corner. Joint names alone mislead: several `jaw_nosabial` joints
    sit on the malar cheek and the `eye_check` rows run from the outer orbit down over the cheekbone."""
    eye = face.rest[face.names.index('l_J_eye_JNT')]
    up = {n: face.frame(face.rest[i] - eye)[1] for i, n in enumerate(face.names)}
    cheek = lambda n: n.startswith(('l_J_eye_check_', 'l_J_jaw_nosabial_row'))
    return {
        'malar cheek': lambda n: cheek(n) and -47 <= up[n] <= -7,
        'lateral orbit': lambda n: n.startswith('l_J_eye_check_') and up[n] > -7,
        'lower mid-cheek': lambda n: cheek(n) and up[n] < -47,
        'lower lid': lambda n: n.startswith('l_J_eye_lid_dn_row'),
        'nasolabial cheek': lambda n: n.startswith('l_J_nose_nosabial_'),
        'mouth corner': lambda n: n == 'l_J_mug_lip_corner_0_JNT',
    }


def measure(face, moved):
    """Per region: the largest displacement (mm) with its components, and the mean up motion of the region's joints."""
    result = {}
    for region, test in face.regions.items():
        idx = [i for i, n in enumerate(face.names) if test(n)]
        vecs = [face.frame(moved[i]) for i in idx]
        lengths = [float(np.linalg.norm(v)) for v in vecs]
        k = int(np.argmax(lengths))
        ups = [float(v[1]) for v in vecs]
        result[region] = dict(max=lengths[k], up=float(vecs[k][1]), fwd=float(vecs[k][2]), left=float(vecs[k][0]),
                              maxUp=max(ups), meanUp=float(np.mean(ups)), mean=float(np.mean(lengths)), joint=face.names[idx[k]])
    return result


def controls_of(body):
    """An expression preset file's control vector (the editor's preset format) or a bare {controls} object."""
    for path in (('part', 'body', 'controls'), ('body', 'controls'), ('controls',)):
        node = body
        for key in path:
            node = node.get(key) if isinstance(node, dict) else None
        if isinstance(node, dict):
            return node
    raise ValueError('no controls in sample')


def study(face, samples, extra):
    prefixes = ('eye_l_oculi_squint', 'nose_l_', 'lips_l_nasolabial', 'lips_l_corner', 'cheek_l_', 'face_gravity', 'lips_l_upper_raise',
                'lips_l_pull', 'eye_l_blink', 'eye_l_widen', 'sculp_', 'eye_l_brows_lower', 'lips_l_stretch', 'jaw_mid_open')
    controls = [c for c in face.tracks[13:154] if c.startswith(prefixes)]
    single = {}
    for name in controls:
        single[name] = {}
        for w in WEIGHTS:
            moved, wr = face.solve({name: w})
            single[name][w] = dict(regions=measure(face, moved), wrinkles={k: v for k, v in wr.items() if v > 1e-4})
    combos = {
        'AU6 (outer-lower 1)': {'eye_l_oculi_squint_outer_lower': 1},
        'AU6 + AU12 (both 1)': {'eye_l_oculi_squint_outer_lower': 1, 'lips_l_corner_up': 1},
        'AU6 + AU12 + AU11 + AU9 (all 1)': {'eye_l_oculi_squint_outer_lower': 1, 'lips_l_corner_up': 1, 'lips_l_nasolabialDeepener': 1, 'nose_l_snear': 1},
        'AU6 1 + sneer 0.5': {'eye_l_oculi_squint_outer_lower': 1, 'nose_l_snear': 0.5},
        'AU6 1 + nasolabial 0.5': {'eye_l_oculi_squint_outer_lower': 1, 'lips_l_nasolabialDeepener': 0.5},
        'AU6 1 + inner 1 + outer-upper 1': {'eye_l_oculi_squint_outer_lower': 1, 'eye_l_oculi_squint_inner': 1, 'eye_l_oculi_squint_outer_upper': 1},
        'AU6 1 + cheek puff 1': {'eye_l_oculi_squint_outer_lower': 1, 'cheek_l_puff': 1},
        'AU6 at 2 (clamped?)': {'eye_l_oculi_squint_outer_lower': 2},
        'corner up 1 + sharp 1': {'lips_l_corner_up': 1, 'lips_l_corner_sharp_up': 1},
    }
    combined = {}
    for label, vector in combos.items():
        together, wr = face.solve(vector)
        parts = sum((face.solve({k: v})[0] for k, v in vector.items()), np.zeros_like(together))
        diff = max(float(np.linalg.norm(face.frame(together[i] - parts[i]))) for i, n in enumerate(face.names) if n.endswith('_JNT'))
        combined[label] = dict(together=measure(face, together), sumOfParts=measure(face, parts), largestDifferenceMm=diff,
                               wrinkles={k: v for k, v in wr.items() if v > 1e-4})
    expressions = {}
    vectors = {p.stem: controls_of(json.loads(p.read_text(encoding='utf-8'))) for p in sorted(Path(samples).glob('*.json'))}
    if extra:
        vectors.update(json.loads(Path(extra).read_text(encoding='utf-8')))
    for name, vector in vectors.items():
        moved, wr = face.solve({k: v for k, v in vector.items() if k in face.tracks})
        expressions[name] = dict(regions=measure(face, moved), wrinkles={k: v for k, v in wr.items() if v > 1e-4})
    return dict(single=single, combined=combined, expressions=expressions, wrinkleSources=face.wrinkles)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--addon', required=True)
    parser.add_argument('--rig', required=True)
    parser.add_argument('--setup', required=True)
    parser.add_argument('--setup2')
    parser.add_argument('--label2', default='second')
    parser.add_argument('--samples', default=str(ROOT / 'projects/xf-studio/authoring/data/expression-samples'))
    parser.add_argument('--extra', help='JSON file of {name: controls} to solve as whole expressions (vanilla faces, recipes)')
    args = parser.parse_args()
    out = Path(__file__).resolve().parent / 'generated'
    out.mkdir(exist_ok=True)
    report = {}
    for label, setup in (('female', args.setup), (args.label2, args.setup2)):
        if setup:
            report[label] = study(Face(args.addon, args.rig, setup), args.samples, args.extra)
    (out / 'cheek-range.json').write_text(json.dumps(report, indent=1), encoding='utf-8')
    for label, data in report.items():
        print(f'== {label} setup')
        for name, by in data['single'].items():
            r = by[1.0]['regions']
            line = '  '.join(f"{reg.split()[0][:5]} {r[reg]['max']:.1f}/{r[reg]['maxUp']:+.1f}" for reg in r)
            lin = ' '.join(f"{by[w]['regions']['malar cheek']['maxUp']:.2f}" for w in WEIGHTS)
            wr = ', '.join(f'{k[:-5]}={v:.2f}' for k, v in by[1.0]['wrinkles'].items())
            print(f'{name:32} {line} | malar up {lin} | {wr}')
        print('-- combinations (malar cheek max mm and largest rise, solved together vs sum of parts)')
        for name, c in data['combined'].items():
            t, s = c['together']['malar cheek'], c['sumOfParts']['malar cheek']
            print(f"{name:34} {t['max']:.2f} (up {t['maxUp']:+.2f}) vs {s['max']:.2f} (up {s['maxUp']:+.2f}); lid {c['together']['lower lid']['max']:.2f} vs {c['sumOfParts']['lower lid']['max']:.2f}; largest joint difference {c['largestDifferenceMm']:.2f} mm")
        print('-- expressions')
        for name, e in data['expressions'].items():
            r = e['regions']
            wr = ', '.join(f'{k[:-5]}={v:.2f}' for k, v in sorted(e['wrinkles'].items(), key=lambda kv: -kv[1])[:6])
            print(f"{name:26} malar {r['malar cheek']['max']:.2f} (rise {r['malar cheek']['maxUp']:+.2f}, mean {r['malar cheek']['meanUp']:+.2f})  orbit {r['lateral orbit']['max']:.2f}  lid {r['lower lid']['max']:.2f}  naso {r['nasolabial cheek']['max']:.2f}  low {r['lower mid-cheek']['max']:.2f}  corner {r['mouth corner']['max']:.1f} | {wr}")


if __name__ == '__main__':
    main()
