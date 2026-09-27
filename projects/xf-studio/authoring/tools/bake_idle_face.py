"""Bake local facial motion by executing the external Cyberpunk IO Suite solver.

The solver remains in its own pinned checkout; no upstream implementation is copied.
Credit, source revision and use terms: docs/community-credits.md.
Inputs/outputs contain game data and stay local, excluded from source distribution.
"""
import argparse
import hashlib
import importlib
import json
import struct
import subprocess
import sys
import types
from pathlib import Path

import numpy as np

APP = Path(__file__).resolve().parents[1]
HQ = APP.parents[2]
ROOT = HQ / 'research/consumers/cc-idle'
PIN = '7a4ee793c36d9615946fe87ec9d42cde7568021d'


def read_glb(path):
    b = path.read_bytes()
    size = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20+size])


# SHA-256 of the reviewed modules at PIN (line endings normalised to LF), for a checkout without git history: an official source
# archive of PIN unpacked into XF Studio's tools folder (`<tools>/io-suite/<pin>/`). Every Python file of both packages is listed, so
# an added or changed module is refused as well (CORE-105).
PIN_MODULES = {
    'i_scene_cp77_gltf/animation/facial/__init__.py': 'a86d918bfe92a60d3c5f1924477d74bf12555e9cdce4548e345528bb2119e98f',
    'i_scene_cp77_gltf/animation/facial/constants.py': 'a68a39cc2b56fb4a5532daef80cbdfeeb46e4bb5b745ebe3884ec0b11f41e9d3',
    'i_scene_cp77_gltf/animation/facial/loader.py': '4f2420464a35d815fa2ec7c7ee8e01ab37b25a6442c0c1a588e298ba1940846d',
    'i_scene_cp77_gltf/animation/facial/model.py': '1f5dbdb164f1631cf0eaab4b000afa82c870a8fc786a9106f690bff13dbed97d',
    'i_scene_cp77_gltf/animation/facial/repository.py': 'afbc85277f3acb44a8c53ed9c5b058cc0ac429ceeef71258ad3020e9c2f468ca',
    'i_scene_cp77_gltf/animation/facial/runtime.py': '9f1f8e7ab4fafa58e35b7a75b4f0fa0854bcbc50538f38705635cde137517781',
    'i_scene_cp77_gltf/animation/facial/solver.py': '9b74321e9c4e6a2469ac8223e560cde25a8fd46d04603a31f5ae1e531ba4155c',
    'i_scene_cp77_gltf/bartmoss/__init__.py': 'c5c43c9809b868e53bfa6ff0b88907b88b6c10f86aa2be71949e121970e8cf7e',
    'i_scene_cp77_gltf/bartmoss/dynamics.py': 'a96507433936a5f3cb3ad339e1e40ba8cc844890b5eacccb3c1425c1782b1821',
    'i_scene_cp77_gltf/bartmoss/geometry.py': '3e7e3665a4ba916de2587ab8399f2c3b718f34f4e69295dbd6db4c3c1325dba5',
    'i_scene_cp77_gltf/bartmoss/hierarchy.py': 'e0cbc6ad8c5483ffe75351213eb66b401b3d91de729b534c3d9df30877f92dc3',
    'i_scene_cp77_gltf/bartmoss/quaternion.py': '6a42122e1dc2a07a706bfd64dea4c5644724b2b6f99e16473cbd964fd3fad971',
    'i_scene_cp77_gltf/bartmoss/scalar.py': '5cdf36af29e74935664aae9f03700e5c31217b07024f7fc3615607bb751f6642',
    'i_scene_cp77_gltf/bartmoss/trs.py': '585cdde47cbd34e5acd1a8e7015d8f80e723446d549ee125d3a9555cb6de6bca',
}


def verify_modules(checkout):
    """Refuse a checkout without git history unless its modules are exactly the reviewed ones (`PIN_MODULES`)."""
    found = {path.relative_to(checkout).as_posix() for folder in ['i_scene_cp77_gltf/animation/facial', 'i_scene_cp77_gltf/bartmoss']
             for path in (checkout / folder).glob('*.py')}
    if found != set(PIN_MODULES):
        raise ValueError(f'Expected reviewed solver {PIN}, found a different set of modules; inspect them before use')
    for relative, digest in PIN_MODULES.items():
        if hashlib.sha256((checkout / relative).read_bytes().replace(b'\r\n', b'\n')).hexdigest() != digest:
            raise ValueError(f'Expected reviewed solver {PIN}: {relative} has local changes; inspect them before use')


def external_solver(checkout):
    checkout = Path(checkout)
    if (checkout / '.git').exists():
        revision = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip()
        if revision != PIN:
            raise ValueError(f'Expected reviewed solver {PIN}, found {revision}')
        changed = subprocess.check_output(['git', '-C', str(checkout), 'status', '--porcelain', '--',
            'i_scene_cp77_gltf/animation/facial', 'i_scene_cp77_gltf/bartmoss/scalar.py'], text=True).strip()
        if changed:
            raise ValueError('Reviewed solver modules have local changes; inspect them before rebaking')
    else:
        verify_modules(checkout)
    # Load only pure numerical modules, without registering Blender UI or importing bpy.
    for suffix in ['', '.animation', '.animation.facial', '.bartmoss']:
        name = 'xfas_external_cp77' + suffix
        module = types.ModuleType(name)
        module.__path__ = [str(checkout / 'i_scene_cp77_gltf' / suffix.lstrip('.').replace('.', '/'))]
        sys.modules[name] = module
    prefix = 'xfas_external_cp77.animation.facial.'
    return tuple(importlib.import_module(prefix + name) for name in ['loader', 'runtime', 'model', 'solver'])


def multiply(a, b):
    # XYZW Hamilton product, used only for packing solved local deltas into glTF.
    xyz = a[:3] * b[3] + b[:3] * a[3] + np.cross(a[:3], b[:3])
    return np.r_[xyz, a[3] * b[3] - np.dot(a[:3], b[:3])]


def rotate(q, v):
    return v + 2 * np.cross(q[:3], np.cross(q[:3], v) + q[3] * v)


def clip_tracks(face, defaults, envelopes):
    """A face clip's absolute track values over time: `values(times)`, and its duration (its last key).

    `AdditiveFromRefPose` clips store deltas that add to the rig's reference tracks. The creator's section showcases
    (`ui_closeup_shot_eyes` and the like) are typed `Additive`; the face graph adds them onto the reference pose the same way, and
    they are read the same way only when they store deltas too: their envelope tracks (which rest at 1) must add nothing, or the
    clip would hold absolute values and doubling them would be wrong, so such a clip is refused.
    """
    extras = face['animations'][0]['extras']
    kind = extras['animationType']
    assert kind in ('AdditiveFromRefPose', 'Additive'), f'Unsupported face clip type {kind}'
    grouped = {}
    for key in extras['trackKeys']:
        grouped.setdefault(key['trackIndex'], []).append((key['time'], key['value']))
    for index in grouped:
        grouped[index] = np.array(sorted(grouped[index]), dtype=np.float64)
    const = {key['trackIndex']: key['value'] for key in extras['constTrackKeys']}
    if kind == 'Additive':
        stored = [abs(const.get(i, 0.0)) for i in envelopes] + [float(np.abs(grouped[i][:, 1]).max()) for i in envelopes if i in grouped]
        assert max(stored, default=0.0) < 1e-6, 'This Additive clip stores absolute envelope values; it is not a delta clip'
    duration = max(x[-1, 0] for x in grouped.values())

    def values(times):
        samples = np.tile(defaults, (len(times), 1))
        for index, value in const.items():
            samples[:, index] = defaults[index] + value
        for index, keys in grouped.items():
            samples[:, index] = defaults[index] + np.interp(times, keys[:, 0], keys[:, 1])
        return samples
    return values, float(duration), kind


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--addon', type=Path, default=Path('D:/Dev/Cyberpunk-Blender-add-on'))
    # Another face clip of the creator's face set (prepare_body_idles.py bakes the full-body view's this way); the defaults are the
    # close-up idle's, as before.
    parser.add_argument('--clip', default='ui_closeup_shot')
    parser.add_argument('--face-glb', type=Path, default=ROOT / 'raw/idle-face.glb')
    # A section's one-shot showcase played before the loop, as the creator's face graph does when a section's flag is set
    # (knowledge/facial-expressions.md §5): the showcase once, blended in from the loop over `--blend` seconds, then the loop blended in
    # from the showcase's last frame. The glTF's animation then plays once up to `loopFrom` (its extras) and loops from there.
    parser.add_argument('--intro-clip')
    parser.add_argument('--intro-glb', type=Path)
    parser.add_argument('--blend', type=float, default=0.5)
    parser.add_argument('--name', help='Animation name stem (default: --clip); the animation is `<name>_face`')
    parser.add_argument('--intake', type=Path, default=ROOT, help='The cc-idle intake (json/ holds the face rig and setup)')
    parser.add_argument('--output', type=Path, default=APP / 'public/assets/cc-idle-face.glb')
    parser.add_argument('--report', type=Path, default=APP / 'evidence/idle-face-bake.json')
    args = parser.parse_args()
    assert (args.intro_clip is None) == (args.intro_glb is None), '--intro-clip and --intro-glb go together'
    loader, runtime, model, solver = external_solver(args.addon)
    rig_path = args.intake / 'json/h0_000_pwa_c__basehead_skeleton.rig.json'
    setup_path = args.intake / 'json/h0_000_pwa_c__basehead_rigsetup.facialsetup.json'
    rig = json.loads(rig_path.read_text())['Data']['RootChunk']
    setup = loader.parse_facial_setup(json.loads(setup_path.read_text()))
    face = read_glb(args.face_glb)
    skin = face['skins'][0]
    names = [x['$value'] for x in rig['boneNames']]
    track_names = [x['$value'] for x in rig['trackNames']]
    assert names == [face['nodes'][i]['name'] for i in skin['joints']]
    assert track_names == skin['extras']['trackNames']
    dimensions = types.SimpleNamespace(num_bones=len(names), num_tracks=len(rig['trackNames']))
    compiled = runtime.compile_runtime(setup, dimensions, model.TrackSegments.from_setup(setup, dimensions.num_tracks))
    defaults = np.array(rig['referenceTracks'], dtype=np.float32)
    assert len(defaults) == dimensions.num_tracks
    # The envelope tracks (the first block of the setup's track mapping) rest at 1 and gate the whole face.
    envelopes = [i for i, name in enumerate(track_names) if name in ('faceEnvelope', 'upperFace', 'lowerFace')]
    loop, duration, clip_kind = clip_tracks(face, defaults, envelopes)
    sources = [rig_path, setup_path, args.face_glb]
    loop_from = None
    if args.intro_glb:
        intro_face = read_glb(args.intro_glb)
        assert intro_face['skins'][0]['extras']['trackNames'] == track_names
        intro, intro_duration, intro_kind = clip_tracks(intro_face, defaults, envelopes)
        sources.append(args.intro_glb)
        blend = args.blend
        # Showcase, then the blend back, then one whole loop from the blend's end: looping [loopFrom, end] repeats the loop seamlessly,
        # since the loop clip's value at `duration + blend` is its value at `blend`.
        total = intro_duration + blend + duration
        loop_from = intro_duration + blend
        times = np.linspace(0, total, round(total * 30) + 1, dtype=np.float64)
        samples = np.empty((len(times), dimensions.num_tracks), dtype=np.float32)
        first = times < intro_duration
        t = times[first]
        w = np.clip(t / blend, 0, 1)[:, None]
        samples[first] = (1 - w) * loop(np.mod(t, duration)) + w * intro(t)
        u = times[~first] - intro_duration
        w = np.clip(u / blend, 0, 1)[:, None]
        samples[~first] = (1 - w) * intro(np.full(len(u), intro_duration)) + w * loop(np.mod(u, duration))
        times = times.astype(np.float32)
        duration = total
    else:
        times = np.linspace(0, duration, round(duration * 30) + 1, dtype=np.float32)
        samples = loop(times.astype(np.float64)).astype(np.float32)
    quats = np.empty((len(times), len(names), 4), dtype=np.float32)
    trans = np.empty((len(times), len(names), 3), dtype=np.float32)
    for frame, tracks in enumerate(samples):
        q, t, _ = solver.solve_runtime(compiled, tracks, lod=0)
        quats[frame] = q
        trans[frame] = t
    assert np.isfinite(quats).all() and np.isfinite(trans).all()
    assert np.max(np.abs(np.linalg.norm(quats, axis=2) - 1)) < 1e-4
    active = np.flatnonzero((np.abs(quats - [0, 0, 0, 1]).max(axis=(0, 2)) > 1e-7) |
                            (np.abs(trans).max(axis=(0, 2)) > 1e-7))
    # REDengine (X,Y,Z) -> glTF (X,Z,-Y), the same basis used by WolvenKit's rig export.
    quats = quats[:, :, [0, 2, 1, 3]].copy(); quats[:, :, 2] *= -1
    trans = trans[:, :, [0, 2, 1]].copy(); trans[:, :, 2] *= -1
    out = {'asset': {'version': '2.0', 'generator': 'XFAS local facial bake; Cyberpunk IO Suite solver'},
           'scene': 0, 'scenes': face['scenes'], 'nodes': face['nodes'],
           'buffers': [], 'bufferViews': [], 'accessors': [],
           'animations': [{'name': f'{args.name or args.clip}_face', 'channels': [], 'samplers': [],
                           **({'extras': {'loopFrom': round(loop_from, 6), 'intro': args.intro_clip, 'loop': args.clip}} if loop_from else {})}]}
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

    time_index = accessor(times, 'SCALAR')
    for bone in active:
        node_index = skin['joints'][int(bone)]
        node = face['nodes'][node_index]
        base_q = np.array(node.get('rotation', [0, 0, 0, 1]), dtype=float)
        base_q /= np.linalg.norm(base_q)
        base_t = np.array(node.get('translation', [0, 0, 0]), dtype=float)
        # IO Suite applies solved values as local pose-bone basis deltas, after rest TRS.
        rotations = [multiply(base_q, q) for q in quats[:, bone]]
        translations = [base_t + rotate(base_q, t * node.get('scale', [1, 1, 1])) for t in trans[:, bone]]
        for path, values, kind in [('rotation', rotations, 'VEC4'), ('translation', translations, 'VEC3')]:
            a = out['animations'][0]
            a['channels'].append({'sampler': len(a['samplers']), 'target': {'node': node_index, 'path': path}})
            a['samplers'].append({'input': time_index, 'output': accessor(values, kind), 'interpolation': 'LINEAR'})
    out['buffers'] = [{'byteLength': len(data)}]
    encoded = json.dumps(out, separators=(',', ':')).encode(); encoded += b' ' * (-len(encoded) % 4)
    data += b'\0' * (-len(data) % 4)
    payload = (struct.pack('<4sII', b'glTF', 2, 28+len(encoded)+len(data)) +
               struct.pack('<II', len(encoded), 0x4e4f534a) + encoded +
               struct.pack('<II', len(data), 0x004e4942) + data)
    output = args.output
    output.write_bytes(payload)
    report = {'solver': {'repository': 'https://github.com/WolvenKit/Cyberpunk-Blender-add-on', 'commit': PIN,
                         'license': 'GPL-3.0-or-later', 'use': 'External unmodified numerical solver executed offline'},
              'clip': args.clip,
              **({'intro': {'clip': args.intro_clip, 'blendSeconds': args.blend, 'loopFrom': round(loop_from, 6),
                            'policy': 'The section showcase once, blended in from the loop and back to it (linear, in track space, before the solve), '
                                      'as the creator face graph plays a section one-shot; the loop then repeats from loopFrom'}} if loop_from else {}),
              'animationType': clip_kind, **({'introAnimationType': intro_kind} if loop_from else {}),
              'sourceHashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
              'duration': float(duration), 'frames': len(times), 'sampleRate': 30,
              'activeBones': [names[int(i)] for i in active], 'outputBytes': len(payload),
              'outputSha256': hashlib.sha256(payload).hexdigest(),
              'trackPolicy': 'AdditiveFromRefPose (and Additive delta clips): decoded track values added to rig referenceTracks',
              'limitations': ['Game animation graph layering/synchronization not established.',
                             'External solver applies rotations/translations, not pose scale arrays.',
                             'Wrinkle outputs are not rendered; in-game visual parity not established.']}
    args.report.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ['activeBones', 'sourceHashes']}, indent=2))
    print('Active bones:', len(active))


if __name__ == '__main__':
    main()
