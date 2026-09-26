"""Bake the game's own blink by executing the external Cyberpunk IO Suite facial solver.

Two things are solved against the female player head's facial setup, exactly as the idle bake does
(tools/bake_idle_face.py: the same pinned, unmodified solver modules, the same reference tracks and axes):

* ``additive__blink_normal__01``: the game's own "normal" blink clip from
  ``base\\animations\\facial\\generic\\interactive_scene\\generic_facial_additives.anims``
  (AdditiveFromRefPose: its float tracks are added to the rig's reference tracks), solved at 60 Hz,
  so "Play blink" plays the game's timing and its secondary controls (squint, gaze down, brow lower).
* ``eye_blink_closure``: the same clip's closing half, from its first frame to the frame where both
  ``eye_l_blink`` and ``eye_r_blink`` peak, solved at ``--steps`` + 1 evenly spaced instants. Its time axis
  is the closure (0 open, 1 the clip's closed frame), so the slider scrubs the game's own blink shape
  (inbetweens, influences and correctives included) instead of one control alone.

It also records, per eye shape, where the eye region's joints sit for that shape (`asset.extras.shapes`): the
head and eye morph targets carry morph-specific bind matrices (`boneRigMatrices`) per target, and the facial setup
assigns each joint a region (`JointRegions`, 0 = eyes). The lid root joints are not skinned, so no target lists
them; they sit exactly at the eye joint and follow its bind (a hypothesis, see knowledge/facial-animation.md).

Inputs are local WolvenKit exports of the player's own game files; the output GLB stays in the ignored
``public/assets`` and is never shipped. The asset-free report goes to evidence/game-blink-bake.json.
Credit, source revision and use terms: docs/community-credits.md.

Run from the repository root (see research/animation/cc-idle.md for the intake steps):

    python projects/xf-studio/authoring/tools/bake_game_blink.py --addon D:/Dev/Cyberpunk-Blender-add-on
"""
import argparse
import hashlib
import json
import struct
import sys
import types
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_idle_face import PIN, external_solver, multiply, read_glb, rotate  # noqa: E402

APP = Path(__file__).resolve().parents[1]
HQ = APP.parents[2]
CLIP = 'additive__blink_normal__01'
CLIP_SOURCE = 'base\\animations\\facial\\generic\\interactive_scene\\generic_facial_additives.anims'
BLINK_TRACKS = ('eye_l_blink', 'eye_r_blink')
SCHEMA = 'xfs/game-blink-1'


# REDengine (X,Y,Z) -> glTF (X,Z,-Y) as a change of basis; a bind B maps to C B C^-1 (checked on the Head joint below).
BASIS = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=float)


def node_worlds(nodes):
    """World matrices of the exported rig's rest pose (glTF axes), by node name."""
    def local(node):
        x, y, z, w = node.get('rotation', [0, 0, 0, 1])
        matrix = np.eye(4)
        matrix[:3, :3] = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                                   [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                                   [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]) * node.get('scale', [1, 1, 1])
        matrix[:3, 3] = node.get('translation', [0, 0, 0])
        return matrix
    parent = {child: index for index, node in enumerate(nodes) for child in node.get('children', [])}
    worlds = {}

    def world(index):
        if index not in worlds:
            worlds[index] = (world(parent[index]) if index in parent else np.eye(4)) @ local(nodes[index])
        return worlds[index]
    return {node['name']: world(index) for index, node in enumerate(nodes)}


def red_bind(entry):
    """A serialized boneRigMatrices entry (inverse bind, row-vector layout) as a glTF world bind."""
    inverse = np.array([[entry[row][col] for col in 'XYZW'] for row in 'XYZW']).T
    return BASIS @ np.linalg.inv(inverse) @ np.linalg.inv(BASIS)


def quaternion(matrix):
    m = matrix[:3, :3]
    w = np.sqrt(max(0.0, 1 + m[0, 0] + m[1, 1] + m[2, 2])) / 2
    x = np.sqrt(max(0.0, 1 + m[0, 0] - m[1, 1] - m[2, 2])) / 2
    y = np.sqrt(max(0.0, 1 - m[0, 0] + m[1, 1] - m[2, 2])) / 2
    z = np.sqrt(max(0.0, 1 - m[0, 0] - m[1, 1] + m[2, 2])) / 2
    x = np.copysign(x, m[2, 1] - m[1, 2]); y = np.copysign(y, m[0, 2] - m[2, 0]); z = np.copysign(z, m[1, 0] - m[0, 1])
    q = np.array([x, y, z, w])
    return q / np.linalg.norm(q)


def eye_shape_binds(nodes, names, regions, head_morph_path, eye_morph_path):
    """Per eye shape, the world bind of each eye-region joint that the shape moves (glTF axes, [px,py,pz,qx,qy,qz,qw])."""
    base = node_worlds(nodes)
    head = json.loads(head_morph_path.read_text())['Data']['RootChunk']
    eye = json.loads(eye_morph_path.read_text())['Data']['RootChunk']
    eye_region = {names[i] for i, region in enumerate(regions) if region == 0}
    # The Head joint's bind is the same in every target and in the rig: it pins the axis convention.
    reference = head['targets'][0]
    head_index = [x['$value'] for x in reference['boneNames']].index('Head')
    error = np.abs(red_bind(reference['boneRigMatrices'][head_index]) - base['Head']).max()
    if error > 1e-5:
        raise ValueError(f'Morph binds do not match the rig in glTF axes (Head differs by {error})')
    listed = {x['$value'] for t in [reference] + eye['targets'][:1] for x in t['boneNames']}
    pivots = {side: f'{side}_J_eye_JNT' for side in 'lr'}
    followers = {name: pivot for pivot in pivots.values() for name in eye_region
                 if name != pivot and name not in listed and np.abs(base[name][:3, 3] - base[pivot][:3, 3]).max() < 1e-5}
    shapes, report = {}, {}
    for target in head['targets']:
        if target['regionName']['$value'] != 'eyes':
            continue
        name = target['name']['$value']
        binds = {}
        for source in [target] + [t for t in eye['targets'] if t['name']['$value'] == name and t['regionName']['$value'] == 'eyes']:
            for bone, entry in zip([x['$value'] for x in source['boneNames']], source['boneRigMatrices']):
                if bone in eye_region and bone in base:
                    binds[bone] = red_bind(entry)
        # Unskinned joints at the eye centre (lid and wetness roots) move with the eye joint's bind [hypothesis; the
        # alternatives measured in research/animation/game-blink.md close the lids less well on average].
        for bone, pivot in followers.items():
            if pivot in binds:
                binds[bone] = binds[pivot] @ np.linalg.inv(base[pivot]) @ base[bone]
        moved = {bone: matrix for bone, matrix in binds.items() if np.abs(matrix - base[bone]).max() > 1e-7}
        for bone, matrix in moved.items():
            if np.abs(np.linalg.norm(matrix[:3, :3], axis=0) - 1).max() > 1e-4:
                raise ValueError(f'{name} {bone}: morph bind is scaled')
        shapes[name] = {bone: [round(float(v), 8) for v in [*matrix[:3, 3], *quaternion(matrix)]] for bone, matrix in sorted(moved.items())}
        shifts = {bone: float(np.linalg.norm(matrix[:3, 3] - base[bone][:3, 3]) * 1000) for bone, matrix in moved.items()}
        turns = {bone: float(np.degrees(np.arccos(np.clip((np.trace(matrix[:3, :3].T @ base[bone][:3, :3]) - 1) / 2, -1, 1))))
                 for bone, matrix in moved.items()}
        report[name] = {'joints': len(moved), 'maxShiftMm': round(max(shifts.values(), default=0), 4),
                        'maxTurnDegrees': round(max(turns.values(), default=0), 4),
                        'eyeJointShiftMm': {side: round(shifts.get(pivot, 0.0), 4) for side, pivot in pivots.items()}}
    return shapes, {'followers': sorted(followers), 'targets': report}


def clip_samples(clip, defaults, rate=None, times=None):
    """Reference tracks plus the clip's decoded additive keys at `rate` Hz or at `times` (keys interpolated linearly)."""
    extras = clip['animations'][0]['extras']
    if extras['animationType'] != 'AdditiveFromRefPose':
        raise ValueError(f"Expected an AdditiveFromRefPose clip, found {extras['animationType']}")
    grouped = {}
    for key in extras['trackKeys']:
        grouped.setdefault(key['trackIndex'], []).append((key['time'], key['value']))
    grouped = {index: np.array(sorted(keys), dtype=np.float64) for index, keys in grouped.items()}
    duration = max(keys[-1, 0] for keys in grouped.values())
    if times is None:
        times = np.linspace(0, duration, round(duration * rate) + 1, dtype=np.float32)
    samples = np.tile(defaults, (len(times), 1))
    for key in extras['constTrackKeys']:
        samples[:, key['trackIndex']] = defaults[key['trackIndex']] + key['value']
    for index, keys in grouped.items():
        samples[:, index] = defaults[index] + np.interp(times, keys[:, 0], keys[:, 1])
    return times, samples, grouped, float(duration)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--addon', type=Path, default=Path('D:/Dev/Cyberpunk-Blender-add-on'))
    parser.add_argument('--idle-intake', type=Path, default=HQ / 'research/consumers/cc-idle',
                        help='Folder holding json/<rig>.rig.json and json/<setup>.facialsetup.json (the idle intake)')
    parser.add_argument('--blink-intake', type=Path, default=HQ / 'research/consumers/game-blink',
                        help=f'Folder holding raw/{CLIP}.glb (anim-export of the generic facial additives)')
    parser.add_argument('--head-morph', type=Path, default=None,
                        help='Serialized h0_000_pwa__morphs.morphtarget.json (default: <blink intake>/json/)')
    parser.add_argument('--eye-morph', type=Path, default=None,
                        help='Serialized he_000_pwa__morphs.morphtarget.json (default: <blink intake>/json/)')
    parser.add_argument('--setup', type=Path, default=None,
                        help='Facial setup JSON to solve with (default: the female head own setup, from the idle intake); for '
                             'comparisons, so it needs --output and --evidence (the Studio blink and its tracked report stay untouched)')
    parser.add_argument('--output', type=Path, default=None, help='Output GLB (default: public/assets/game-blink.glb)')
    parser.add_argument('--evidence', type=Path, default=None, help='Report JSON (default: evidence/game-blink-bake.json)')
    parser.add_argument('--steps', type=int, default=20, help='Closure samples between open (0) and closed (1)')
    parser.add_argument('--rate', type=int, default=60, help='Clip sample rate in Hz')
    args = parser.parse_args()
    if args.setup and not (args.output and args.evidence):
        parser.error('--setup bakes a comparison: give --output and --evidence too, so the Studio blink and its tracked report stay as they are')
    loader, runtime, model, solver = external_solver(args.addon)
    rig_path = args.idle_intake / 'json/h0_000_pwa_c__basehead_skeleton.rig.json'
    setup_path = args.setup or args.idle_intake / 'json/h0_000_pwa_c__basehead_rigsetup.facialsetup.json'
    clip_path = args.blink_intake / f'raw/{CLIP}.glb'
    rig = json.loads(rig_path.read_text())['Data']['RootChunk']
    rig_name, setup_name = rig_path.name.removesuffix('.json'), setup_path.name.removesuffix('.json')
    # Player heads are named for their body type: pwa (female), pma (male).
    body_gender = next((gender for tag, gender in (('_pwa', 'female'), ('_pma', 'male')) if tag in rig_name), 'unknown')
    setup_json = json.loads(setup_path.read_text())
    setup = loader.parse_facial_setup(setup_json)
    clip = read_glb(clip_path)
    skin = clip['skins'][0]
    names = [x['$value'] for x in rig['boneNames']]
    tracks = [x['$value'] for x in rig['trackNames']]
    # The generic additives are authored on the male player rig; its bone and track lists equal the female head's
    # (checked when the intake was made), and the anim export used the female rig, so indices are the female rig's.
    assert names == [clip['nodes'][i]['name'] for i in skin['joints']]
    assert tracks == skin['extras']['trackNames']
    dimensions = types.SimpleNamespace(num_bones=len(names), num_tracks=len(tracks))
    compiled = runtime.compile_runtime(setup, dimensions, model.TrackSegments.from_setup(setup, dimensions.num_tracks))
    defaults = np.array(rig['referenceTracks'], dtype=np.float32)
    blink = [tracks.index(name) for name in BLINK_TRACKS]
    corrective_names = [x['$value'] for x in setup_json['Data']['RootChunk']['faceCorrectiveNames']]
    face_part = next(part for part in compiled.parts if part.part_name == 'face')

    def solve(frames):
        quats = np.empty((len(frames), len(names), 4), dtype=np.float32)
        trans = np.empty((len(frames), len(names), 3), dtype=np.float32)
        fired = {}
        for frame, values in enumerate(frames):
            q, t, _ = solver.solve_runtime(compiled, values, lod=0)
            quats[frame], trans[frame] = q, t
            for index in np.flatnonzero(face_part.corr_weights > 1e-3):
                fired[corrective_names[index]] = max(fired.get(corrective_names[index], 0.0), float(face_part.corr_weights[index]))
        assert np.isfinite(quats).all() and np.isfinite(trans).all()
        assert np.max(np.abs(np.linalg.norm(quats, axis=2) - 1)) < 1e-4
        return quats, trans, fired

    clip_times, clip_frames, clip_keys, duration = clip_samples(clip, defaults, args.rate)
    played = solve(clip_frames)
    # The closing half: up to the first key where both blink controls reach their peak.
    peaks = [clip_keys[index][int(np.argmax(clip_keys[index][:, 1])), 0] for index in blink]
    if max(abs(clip_keys[index][:, 1].max() - 1) for index in blink) > 1e-3:
        raise ValueError('The blink clip does not close the lids fully (its blink controls never reach 1)')
    peak = float(max(peaks))
    weights = np.linspace(0, 1, args.steps + 1, dtype=np.float32)
    _, closure_frames, _, _ = clip_samples(clip, defaults, times=weights * peak)
    closure = solve(closure_frames)
    def moving(quats, trans):
        return (np.abs(quats - [0, 0, 0, 1]).max(axis=(0, 2)) > 1e-7) | (np.abs(trans).max(axis=(0, 2)) > 1e-7)
    closure_active = np.flatnonzero(moving(closure[0], closure[1]))
    active = np.flatnonzero(moving(closure[0], closure[1]) | moving(played[0], played[1]))
    # The clip's first frame is not quite the rest pose (its gaze-down control starts slightly above zero); the Studio
    # shows the editing pose at closure 0, so record how far the first frame is from it.
    first = closure[0][0], closure[1][0]
    open_offset = {'bones': int(moving(first[0][None], first[1][None]).sum()),
                   'maxTurnDegrees': float(np.degrees(2 * np.arccos(np.clip(np.abs(first[0][:, 3]), 0, 1))).max()),
                   'maxShiftMm': float(np.abs(first[1]).max() * 1000)}

    head_morph_path = args.head_morph or args.blink_intake / 'json/h0_000_pwa__morphs.morphtarget.json'
    eye_morph_path = args.eye_morph or args.blink_intake / 'json/he_000_pwa__morphs.morphtarget.json'
    regions = setup_json['Data']['RootChunk']['bakedData']['Data']['JointRegions']
    shapes, shape_report = eye_shape_binds(clip['nodes'], names, regions, head_morph_path, eye_morph_path)

    out = {'asset': {'version': '2.0', 'generator': 'XF Studio local blink bake; Cyberpunk IO Suite solver',
                     'extras': {'schema': SCHEMA,
                                'closure': {'animation': 'eye_blink_closure', 'tracks': list(BLINK_TRACKS), 'steps': args.steps,
                                            'clip': CLIP, 'closedTime': peak},
                                'clip': {'animation': CLIP, 'source': CLIP_SOURCE, 'duration': duration, 'sampleRate': args.rate},
                                'shapes': shapes,
                                'rig': {'skeleton': rig_name, 'setup': setup_name, 'bodyGender': body_gender}}},
           'scene': 0, 'scenes': clip['scenes'], 'nodes': clip['nodes'],
           'buffers': [], 'bufferViews': [], 'accessors': [], 'animations': []}
    data = bytearray()

    def accessor(values, kind):
        values = np.asarray(values, dtype='<f4')
        index = len(out['accessors'])
        out['bufferViews'].append({'buffer': 0, 'byteOffset': len(data), 'byteLength': values.nbytes})
        out['accessors'].append({'bufferView': index, 'componentType': 5126, 'count': len(values), 'type': kind,
                                 'min': np.atleast_1d(values.min(axis=0)).tolist(),
                                 'max': np.atleast_1d(values.max(axis=0)).tolist()})
        data.extend(values.tobytes())
        return index

    for name, times, (quats, trans, _) in [('eye_blink_closure', weights, closure), (CLIP, clip_times, played)]:
        # REDengine (X,Y,Z) -> glTF (X,Z,-Y), the same basis the idle bake and WolvenKit's rig export use.
        quats = quats[:, :, [0, 2, 1, 3]].copy(); quats[:, :, 2] *= -1
        trans = trans[:, :, [0, 2, 1]].copy(); trans[:, :, 2] *= -1
        animation = {'name': name, 'channels': [], 'samplers': []}
        time_index = accessor(times, 'SCALAR')
        # Every animation carries the same bones (the union), so switching between them never leaves a stale pose.
        for bone in active:
            node_index = skin['joints'][int(bone)]
            node = clip['nodes'][node_index]
            base_q = np.array(node.get('rotation', [0, 0, 0, 1]), dtype=float)
            base_q /= np.linalg.norm(base_q)
            base_t = np.array(node.get('translation', [0, 0, 0]), dtype=float)
            rotations = [multiply(base_q, q) for q in quats[:, bone]]
            translations = [base_t + rotate(base_q, t * node.get('scale', [1, 1, 1])) for t in trans[:, bone]]
            for path, values, kind in [('rotation', rotations, 'VEC4'), ('translation', translations, 'VEC3')]:
                animation['channels'].append({'sampler': len(animation['samplers']), 'target': {'node': node_index, 'path': path}})
                animation['samplers'].append({'input': time_index, 'output': accessor(values, kind), 'interpolation': 'LINEAR'})
        out['animations'].append(animation)
    out['buffers'] = [{'byteLength': len(data)}]
    encoded = json.dumps(out, separators=(',', ':')).encode(); encoded += b' ' * (-len(encoded) % 4)
    data += b'\0' * (-len(data) % 4)
    payload = (struct.pack('<4sII', b'glTF', 2, 28 + len(encoded) + len(data)) +
               struct.pack('<II', len(encoded), 0x4e4f534a) + encoded +
               struct.pack('<II', len(data), 0x004e4942) + data)
    output = args.output or APP / 'public/assets/game-blink.glb'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)

    # Asset-free structure of the blink poses (names, counts, thresholds), for the knowledge page.
    def pose_info(track):
        part = next(p for p in (setup.face, setup.eyes, setup.tongue) if track in p.main_tracks)
        pose = int(np.flatnonzero(part.main_tracks == track)[0])
        start, end = int(part.ib_row_ptr[pose]), int(part.ib_row_ptr[pose + 1])
        bones = sorted({names[int(b)] for k in range(start, end)
                        for b in part.main_poses.pose_bones[part.main_poses.row_ptr[k]:part.main_poses.row_ptr[k + 1]]})
        envelope = [{'envelope': int(part.env_types[i]), 'lod': int(part.env_lods[i])} for i in np.flatnonzero(part.env_tracks == track)]
        influences = [tracks[int(part.infl_tracks[i])] for i in range(part.infl_num)
                      if track in part.infl_indices[part.infl_row_ptr[i]:part.infl_row_ptr[i + 1]]]
        return {'part': part.part_name, 'mainPose': pose, 'inbetweenThresholds': part.ib_thresholds[start:end].tolist(),
                'envelope': envelope, 'limits': int(np.count_nonzero(part.limit_tracks == track)),
                'influencedBy': [tracks[int(x)] for i in np.flatnonzero(part.infl_tracks == track)
                                 for x in part.infl_indices[part.infl_row_ptr[i]:part.infl_row_ptr[i + 1]]],
                'influences': influences,
                'upperLowerPart': [int(part.ulf_parts[i]) for i in np.flatnonzero(part.ulf_tracks == track)],
                'bones': bones}
    correctives = [name for name in corrective_names if any(track in name.split('__') for track in BLINK_TRACKS)]
    corrective_poses = setup_json['Data']['RootChunk']['correctivePosesData']['Data']['Face']['Poses']
    keyed = {tracks[index]: {'keys': len(keys), 'min': float(keys[:, 1].min()), 'max': float(keys[:, 1].max()),
                             'peakTime': float(keys[int(np.argmax(keys[:, 1])), 0])}
             for index, keys in clip_keys.items() if np.ptp(keys[:, 1]) > 1e-5}
    report = {'solver': {'repository': 'https://github.com/WolvenKit/Cyberpunk-Blender-add-on', 'commit': PIN,
                         'license': 'GPL-3.0-or-later', 'use': 'External unmodified numerical solver executed offline'},
              'sourceHashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in [rig_path, setup_path, clip_path, head_morph_path, eye_morph_path]},
              'eyeShapes': shape_report,
              'closure': {'clip': CLIP, 'closedTime': peak, 'firstFrameFromRest': open_offset, 'tracks': list(BLINK_TRACKS), 'steps': args.steps, 'activeBones': len(closure_active),
                          'correctivesFired': closure[2]},
              'clip': {'name': CLIP, 'source': CLIP_SOURCE, 'duration': duration, 'sampleRate': args.rate,
                       'frames': len(clip_times), 'animationType': 'AdditiveFromRefPose', 'varyingTracks': keyed,
                       'correctivesFired': played[2]},
              'poses': {name: pose_info(tracks.index(name)) for name in BLINK_TRACKS},
              'blinkCorrectives': [{'name': name, 'transforms': corrective_poses[corrective_names.index(name)]['NumTransforms']}
                                   for name in correctives],
              'activeBones': [names[int(i)] for i in active], 'outputBytes': len(payload),
              'outputSha256': hashlib.sha256(payload).hexdigest(),
              'trackPolicy': 'AdditiveFromRefPose: decoded track values added to rig referenceTracks; the closure is the clip from 0 to closedTime',
              'rig': {'skeleton': rig_name, 'bodyGender': body_gender},
              'setup': {'used': setup_name, 'sha256': hashlib.sha256(setup_path.read_bytes()).hexdigest(),
                        'role': 'the female head\'s own setup, beside its skeleton' if args.setup is None else 'a comparison setup (--setup)',
                        'alsoReferenced':'The female face-rig entity names base\\characters\\head\\pma\\h0_001_ma_c__player\\h0_001_ma_c__player_rigsetup.facialsetup; which one the engine solves V\'s face with is untested'},
              'limitations': ['Which clip or system blinks V during gameplay is not established; the clip is one of the game\'s own blink clips.',
                              'External solver applies rotations/translations, not pose scale arrays; wrinkle outputs are not rendered.',
                              'In-game visual parity is not established.']}
    evidence = args.evidence or APP / 'evidence/game-blink-bake.json'
    text = json.dumps(report, indent=2) + '\n'
    # The report is tracked: an identical bake leaves the file (and its timestamp) alone.
    if evidence.exists() and evidence.read_text() == text:
        print('Report unchanged:', evidence.name)
    else:
        evidence.write_text(text)
    print(json.dumps({k: report[k] for k in ['closure', 'outputBytes', 'outputSha256']}, indent=2))
    print('Active bones:', len(active))


if __name__ == '__main__':
    main()
