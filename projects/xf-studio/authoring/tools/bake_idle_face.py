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


def external_solver(checkout):
    revision = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != PIN:
        raise ValueError(f'Expected reviewed solver {PIN}, found {revision}')
    changed = subprocess.check_output(['git', '-C', str(checkout), 'status', '--porcelain', '--',
        'i_scene_cp77_gltf/animation/facial', 'i_scene_cp77_gltf/bartmoss/scalar.py'], text=True).strip()
    if changed:
        raise ValueError('Reviewed solver modules have local changes; inspect them before rebaking')
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--addon', type=Path, default=Path('D:/Dev/Cyberpunk-Blender-add-on'))
    args = parser.parse_args()
    loader, runtime, model, solver = external_solver(args.addon)
    rig_path = ROOT / 'json/h0_000_pwa_c__basehead_skeleton.rig.json'
    setup_path = ROOT / 'json/h0_000_pwa_c__basehead_rigsetup.facialsetup.json'
    rig = json.loads(rig_path.read_text())['Data']['RootChunk']
    setup = loader.parse_facial_setup(json.loads(setup_path.read_text()))
    face = read_glb(ROOT / 'raw/idle-face.glb')
    skin = face['skins'][0]
    names = [x['$value'] for x in rig['boneNames']]
    assert names == [face['nodes'][i]['name'] for i in skin['joints']]
    assert [x['$value'] for x in rig['trackNames']] == skin['extras']['trackNames']
    dimensions = types.SimpleNamespace(num_bones=len(names), num_tracks=len(rig['trackNames']))
    compiled = runtime.compile_runtime(setup, dimensions, model.TrackSegments.from_setup(setup, dimensions.num_tracks))
    extras = face['animations'][0]['extras']
    assert extras['animationType'] == 'AdditiveFromRefPose'
    grouped = {}
    for key in extras['trackKeys']:
        grouped.setdefault(key['trackIndex'], []).append((key['time'], key['value']))
    for index in grouped:
        grouped[index] = np.array(sorted(grouped[index]), dtype=np.float64)
    duration = max(x[-1, 0] for x in grouped.values())
    times = np.linspace(0, duration, round(duration * 30) + 1, dtype=np.float32)
    defaults = np.array(rig['referenceTracks'], dtype=np.float32)
    assert len(defaults) == dimensions.num_tracks
    samples = np.tile(defaults, (len(times), 1))
    for key in extras['constTrackKeys']:
        samples[:, key['trackIndex']] = defaults[key['trackIndex']] + key['value']
    for index, keys in grouped.items():
        samples[:, index] = defaults[index] + np.interp(times, keys[:, 0], keys[:, 1])
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
           'animations': [{'name': 'ui_closeup_shot_face', 'channels': [], 'samplers': []}]}
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
    output = APP / 'public/assets/cc-idle-face.glb'
    output.write_bytes(payload)
    report = {'solver': {'repository': 'https://github.com/WolvenKit/Cyberpunk-Blender-add-on', 'commit': PIN,
                         'license': 'GPL-3.0-or-later', 'use': 'External unmodified numerical solver executed offline'},
              'sourceHashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [rig_path, setup_path, ROOT / 'raw/idle-face.glb']},
              'duration': float(duration), 'frames': len(times), 'sampleRate': 30,
              'activeBones': [names[int(i)] for i in active], 'outputBytes': len(payload),
              'outputSha256': hashlib.sha256(payload).hexdigest(),
              'trackPolicy': 'AdditiveFromRefPose: decoded track values added to rig referenceTracks',
              'limitations': ['Game animation graph layering/synchronization not established.',
                             'External solver applies rotations/translations, not pose scale arrays.',
                             'Wrinkle outputs are not rendered; in-game visual parity not established.']}
    (APP / 'evidence/idle-face-bake.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ['activeBones', 'sourceHashes']}, indent=2))
    print('Active bones:', len(active))


if __name__ == '__main__':
    main()
