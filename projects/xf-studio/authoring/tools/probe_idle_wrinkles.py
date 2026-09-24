"""Read-only probe of processed wrinkle tracks in the actual selected UI idle.

Requires the ignored cc-idle intake and pinned external IO Suite checkout. Writes
only an asset-free JSON report to the path explicitly supplied by the caller.
"""
import argparse
import hashlib
import json
import types
from pathlib import Path

import numpy as np

from bake_idle_face import external_solver, read_glb

EXPECTED_SOURCES = {
    'h0_000_pwa_c__basehead_skeleton.rig.json': '454e38a25707047d1343f4a77fc1c7c89f09fe2707b01882405ed53c2176230f',
    'h0_000_pwa_c__basehead_rigsetup.facialsetup.json': 'aae907a8e308dd3261627778aa546e7e79182ef88ad0f93c946c9ac2034db458',
    'idle-face.glb': '372bd9629c24b918e23f792b01b703238021a1d82554cd8381fd2f2e9d2fef58',
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def probe(root, addon):
    loader, runtime, model, solver = external_solver(addon)
    rig_path = root / 'json/h0_000_pwa_c__basehead_skeleton.rig.json'
    setup_path = root / 'json/h0_000_pwa_c__basehead_rigsetup.facialsetup.json'
    face_path = root / 'raw/idle-face.glb'
    source_hashes = {p.name: sha256(p) for p in (rig_path, setup_path, face_path)}
    if source_hashes != EXPECTED_SOURCES:
        raise ValueError(f'Idle intake differs from the reviewed default source: {source_hashes}')
    rig = json.loads(rig_path.read_text())['Data']['RootChunk']
    setup = loader.parse_facial_setup(json.loads(setup_path.read_text()))
    face = read_glb(face_path)
    skin = face['skins'][0]
    names = [item['$value'] for item in rig['trackNames']]
    assert names == skin['extras']['trackNames']
    assert face['animations'][0]['name'] == 'ui_closeup_shot'
    extras = face['animations'][0]['extras']
    assert extras['animationType'] == 'AdditiveFromRefPose'
    dimensions = types.SimpleNamespace(num_bones=len(rig['boneNames']), num_tracks=len(names))
    segments = model.TrackSegments.from_setup(setup, len(names))
    compiled = runtime.compile_runtime(setup, dimensions, segments)
    wrinkle_sources = {}
    for part in compiled.parts:
        for offset, source in enumerate(part.wrinkle_source_tracks):
            wrinkle_sources[part.wrinkle_start_track + offset] = int(source)
    grouped = {}
    for key in extras['trackKeys']:
        grouped.setdefault(key['trackIndex'], []).append((key['time'], key['value']))
    grouped = {i: np.array(sorted(keys), dtype=np.float64) for i, keys in grouped.items()}
    duration = max(keys[-1, 0] for keys in grouped.values())
    times = np.linspace(0, duration, round(duration * 30) + 1, dtype=np.float32)
    defaults = np.array(rig['referenceTracks'], dtype=np.float32)
    samples = np.tile(defaults, (len(times), 1))
    for key in extras['constTrackKeys']:
        samples[:, key['trackIndex']] = defaults[key['trackIndex']] + key['value']
    for i, keys in grouped.items():
        samples[:, i] = defaults[i] + np.interp(times, keys[:, 0], keys[:, 1])

    indices = list(range(segments.wrinkle_start, segments.wrinkle_end))
    assert all(names[i].endswith('Wrnkl') for i in indices)
    assert set(indices) == set(wrinkle_sources)
    processed = np.empty((len(times), len(indices)), dtype=np.float32)
    for frame, tracks in enumerate(samples):
        _, _, output = solver.solve_runtime(compiled, tracks, lod=0)
        processed[frame] = output[indices]
    assert np.isfinite(processed).all()

    channels = []
    for column, i in enumerate(indices):
        values = processed[:, column]
        lo, hi = int(np.argmin(values)), int(np.argmax(values))
        channels.append({
            'index': i, 'name': names[i],
            'solverSourceIndex': wrinkle_sources[i], 'solverSourceName': names[wrinkle_sources[i]],
            'min': float(values[lo]), 'minTimeSeconds': float(times[lo]),
            'max': float(values[hi]), 'maxTimeSeconds': float(times[hi]),
            'range': float(values[hi] - values[lo]),
            'first': float(values[0]), 'last': float(values[-1]),
        })
    result = {
        'clip': 'ui_closeup_shot', 'sampleRateHz': 30, 'frames': len(times),
        'durationSeconds': float(duration),
        'sources': source_hashes,
        'solverCommit': '7a4ee793c36d9615946fe87ec9d42cde7568021d',
        'trackPolicy': 'AdditiveFromRefPose; rig referenceTracks plus decoded float keys',
        'processedWrinkleTrackRange': [segments.wrinkle_start, segments.wrinkle_end],
        'channels': channels,
        'limits': ['Offline solver output only; no engine material binding or runtime graph selection proved.',
                   'Uniform 30 Hz samples may miss extrema between samples.'],
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--intake', type=Path, required=True)
    parser.add_argument('--addon', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = probe(args.intake, args.addon)
    args.output.write_bytes((json.dumps(result, indent=2) + '\n').encode('utf-8'))
    print(f"{result['frames']} frames, {len(result['channels'])} processed wrinkle tracks")
    for channel in result['channels']:
        if 'brow' in channel['name'].lower():
            print(f"{channel['index']} {channel['name']}: {channel['range']:.8f} peak at {channel['maxTimeSeconds']:.3f}s")


if __name__ == '__main__':
    main()
