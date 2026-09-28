"""Which facial-setup entries move a joint: stage-by-stage attribution of one expression, solved with the external solver.

Diagnostic for facial correctives tuning (research/animation/facial-correctives-tuning.md). It solves one control vector with
the pinned, unmodified IO Suite solver (loaded like the bakes, tools/bake_idle_face.py `external_solver`; none of its code is
copied here), then reports for each chosen joint:

* the control weights after each stage (envelopes, limits, influences) where a stage changed them;
* the in-between and corrective weights that fired;
* how far the joint moves in the head's space (forward kinematics over the rig's rest pose), and how much of that each main
  pose, in-between and corrective contributes, measured by switching that one entry off and solving again (ablation).

Positions are REDengine model space in millimetres (Z up, -Y forward for the head). The input is a saved expression's controls
(a JSON object of control -> weight) or a part preset body with `controls`.

    python tools/facial_attribution.py --addon <IO Suite checkout> --rig <rig.json> --setup <setup.json> \
        --controls <controls.json> [--joints <regex>] [--top 12] [--json out.json]
"""
import argparse
import json
import re
import sys
import types
from pathlib import Path

import numpy as np
from importlib import import_module

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_idle_face import external_solver  # noqa: E402

WEIGHT_THRESHOLD = 0.001


def quat_mul(a, b):
    xyz = a[:3] * b[3] + b[:3] * a[3] + np.cross(a[:3], b[:3])
    return np.r_[xyz, a[3] * b[3] - np.dot(a[:3], b[:3])]


def quat_rot(q, v):
    return v + 2 * np.cross(q[:3], np.cross(q[:3], v) + q[3] * v)


class Rig:
    def __init__(self, chunk):
        self.names = [x['$value'] for x in chunk['boneNames']]
        self.parents = list(chunk['boneParentIndexes'])
        self.tracks = [x['$value'] for x in chunk['trackNames']]
        self.reference = np.array(chunk['referenceTracks'], dtype=np.float32)
        self.rest_q = np.array([[t['Rotation'][k] for k in 'ijkr'] for t in chunk['boneTransforms']], dtype=float)
        self.rest_t = np.array([[t['Translation'][k] for k in 'XYZ'] for t in chunk['boneTransforms']], dtype=float)

    def world(self, dq, dt):
        """Model-space joint positions with the solver's local deltas applied after each joint's rest (as the bakes do)."""
        n = len(self.names)
        wq = np.zeros((n, 4)); wt = np.zeros((n, 3))
        for i in range(n):
            lq = quat_mul(self.rest_q[i], dq[i]); lt = self.rest_t[i] + quat_rot(self.rest_q[i], dt[i])
            p = self.parents[i]
            if p < 0:
                wq[i], wt[i] = lq, lt
            else:
                wq[i] = quat_mul(wq[p], lq); wt[i] = wt[p] + quat_rot(wq[p], lt)
        return wt


def instrumented_solve(solver, runtime, values, off_main=(), off_corr=(), record=None):
    """solver.solve_runtime with the same stage calls, able to switch single in-betweens or correctives off (ablation)."""
    np.copyto(runtime.input_tracks, values)
    runtime.reset()
    const = import_module(solver.__name__.rsplit('.', 1)[0] + '.constants')
    for part in runtime.parts:
        out = runtime.output_tracks
        c = lambda i, hi=1.0: min(max(float(out[i]), 0.0), hi)  # noqa: E731
        upper, lower, lipsync = c(const.ENV_UPPER_FACE), c(const.ENV_LOWER_FACE), c(const.ENV_LIPSYNC)
        jali_jaw, jali_lips = c(const.ENV_JALI_JAW, 2.0), c(const.ENV_JALI_LIPS, 2.0)
        muzzle_lips, muzzle_eyes = c(const.ENV_MUZZLE_LIPS), c(const.ENV_MUZZLE_EYES)
        muzzle_brows, muzzle_dir = c(const.ENV_MUZZLE_BROWS), c(const.ENV_MUZZLE_EYE_DIR)
        snap = lambda: out[part.main_tracks].copy()  # noqa: E731
        stages = {'input': snap()}
        solver._stage_envelopes(part, runtime.input_tracks, out, 0, 0.0, muzzle_eyes, muzzle_brows, muzzle_dir)
        stages['envelopes'] = snap()
        solver._stage_limits(part, jali_jaw, jali_lips, muzzle_lips, lipsync, out)
        stages['limits'] = snap()
        solver._stage_influences(part, out)
        stages['influences'] = snap()
        solver._stage_upper_lower(part, upper, lower, out)
        solver._stage_lipsync_overrides(runtime, lipsync)
        solver._stage_lipsync_poses(part, runtime)
        solver._stage_influences(part, out)
        stages['final'] = snap()
        ib = solver._stage_inbetweens(part, out)
        corr = solver._stage_correctives(part, out, ib, 0)
        if part.num_corr_infl:
            before = corr.copy()
            solver._stage_corrective_influences(part, corr)
            stages['corr_before_influence'] = before
        if part.part_name == 'face':
            for i in off_main:
                ib[i] = 0.0
            for i in off_corr:
                corr[i] = 0.0
        if record is not None:
            record[part.part_name] = {'stages': stages, 'ib': ib.copy(), 'corr': corr.copy()}
        solver._blend_poses(part.main_poses, ib, runtime)
        if part.num_correctives:
            solver._blend_poses(part.corrective_poses, corr, runtime)
        solver._stage_wrinkles(part, out)
    return runtime.bone_quats.copy(), runtime.bone_trans.copy()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--addon', type=Path, required=True)
    parser.add_argument('--rig', type=Path, required=True)
    parser.add_argument('--setup', type=Path, required=True)
    parser.add_argument('--controls', type=Path, required=True)
    parser.add_argument('--joints', default=r'^(l|r)_J_(jaw_nosabial|nose_nosabial|eye_check|mug_mouth_rowB)', help='regex of joint names (default: the cheek and fold)')
    parser.add_argument('--scale', type=float, default=1.0, help='multiply every control weight (1 = as saved)')
    parser.add_argument('--top', type=int, default=12)
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()

    loader, runtime_mod, model, solver = external_solver(args.addon)
    rig_chunk = json.loads(args.rig.read_text(encoding='utf-8'))['Data']['RootChunk']
    setup_chunk = json.loads(args.setup.read_text(encoding='utf-8'))
    setup = loader.parse_facial_setup(setup_chunk)
    corr_names = [x['$value'] for x in setup_chunk['Data']['RootChunk']['faceCorrectiveNames']]
    rig = Rig(rig_chunk)
    dims = types.SimpleNamespace(num_bones=len(rig.names), num_tracks=len(rig.tracks))
    runtime = runtime_mod.compile_runtime(setup, dims, model.TrackSegments.from_setup(setup, dims.num_tracks))
    face = next(p for p in runtime.parts if p.part_name == 'face')

    raw = json.loads(args.controls.read_text(encoding='utf-8'))
    controls = raw.get('controls', raw)
    values = rig.reference.copy()
    for name, weight in controls.items():
        values[rig.tracks.index(name)] += float(weight) * args.scale

    # Name every in-between of the face part: "<control>@<threshold>".
    ib_names = []
    for pose in range(face.num_main_poses):
        start, end = int(face.ib_row_ptr[pose]), int(face.ib_row_ptr[pose + 1])
        control = rig.tracks[int(face.main_tracks[pose])]
        ib_names += [f'{control}@{float(face.ib_thresholds[k]):.2f}' if end - start > 1 else control for k in range(start, end)]

    zero = np.zeros((len(rig.names), 4)); zero[:, 3] = 1
    rest = rig.world(zero, np.zeros((len(rig.names), 3)))
    record = {}
    q, t = instrumented_solve(solver, runtime, values, record=record)
    posed = rig.world(q, t)
    moved = (posed - rest) * 1000
    chosen = [i for i, n in enumerate(rig.names) if re.search(args.joints, n)]

    rec = record['face']
    main_names = [rig.tracks[int(k)] for k in face.main_tracks]
    changes = {}
    for a, b in [('input', 'envelopes'), ('envelopes', 'limits'), ('limits', 'influences'), ('influences', 'final')]:
        diff = {main_names[i]: [round(float(rec['stages'][a][i]), 4), round(float(rec['stages'][b][i]), 4)]
                for i in range(len(main_names)) if abs(rec['stages'][a][i] - rec['stages'][b][i]) > 1e-4}
        if diff:
            changes[f'{a}->{b}'] = diff
    fired_ib = {ib_names[i]: round(float(w), 4) for i, w in enumerate(rec['ib']) if w > WEIGHT_THRESHOLD}
    fired_corr = {corr_names[i]: round(float(w), 4) for i, w in enumerate(rec['corr']) if w > WEIGHT_THRESHOLD}
    corr_pre = rec['stages'].get('corr_before_influence')
    damped_corr = {corr_names[i]: [round(float(corr_pre[i]), 4), round(float(rec['corr'][i]), 4)]
                   for i in range(len(corr_names)) if corr_pre is not None and corr_pre[i] - rec['corr'][i] > 1e-4}

    contributions = {}
    for kind, names, weights in [('main', ib_names, rec['ib']), ('corr', corr_names, rec['corr'])]:
        for i, w in enumerate(weights):
            if w <= WEIGHT_THRESHOLD:
                continue
            q2, t2 = instrumented_solve(solver, runtime, values, off_main=[i] if kind == 'main' else (),
                                        off_corr=[i] if kind == 'corr' else ())
            delta = (posed - rig.world(q2, t2)) * 1000
            contributions[f'{kind}:{names[i]}'] = {'weight': round(float(w), 4), 'delta': delta}

    joints = {}
    for j in chosen:
        if np.linalg.norm(moved[j]) < 0.05:
            continue
        ranked = sorted(contributions.items(), key=lambda kv: -np.linalg.norm(kv[1]['delta'][j]))[:args.top]
        joints[rig.names[j]] = {
            'restMm': [round(float(x) * 1000, 2) for x in rest[j]],
            'movedMm': [round(float(x), 2) for x in moved[j]], 'movedLengthMm': round(float(np.linalg.norm(moved[j])), 2),
            'from': [{'entry': k, 'weight': v['weight'], 'mm': [round(float(x), 2) for x in v['delta'][j]],
                      'lengthMm': round(float(np.linalg.norm(v['delta'][j])), 2)} for k, v in ranked],
        }
    report = {'controls': controls, 'scale': args.scale, 'stageChanges': changes, 'inbetweens': fired_ib,
              'correctives': fired_corr, 'correctivesDampedByInfluence': damped_corr, 'joints': joints}
    text = json.dumps(report, indent=1)
    if args.json:
        args.json.write_text(text, encoding='utf-8')
    print(text)


if __name__ == '__main__':
    sys.exit(main())
