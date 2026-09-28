"""Keep the external Cyberpunk IO Suite facial solver warm and answer solve requests over stdin/stdout.

The Studio's live expression preview (research/animation/expression-editor-design.md §5.2) asks this process to solve the
face's 414 control tracks into local joint deltas, one request per line. The solver is the same pinned, unmodified checkout
the idle and blink bakes run (tools/bake_idle_face.py `external_solver`): it stays a separate GPL-3.0 program, loaded here
without Blender, and none of its code enters XF Studio. Credit, source revision and use terms: docs/community-credits.md.

Protocol (UTF-8 JSON, one object per line):

* on start, one line: ``{"ready": true, "joints": n, "tracks": m, "compileMs": ms}`` or ``{"ready": false, "error": text}``;
* request: ``{"id": int, "frames": [[m floats], ...]}``: absolute track values (the rig's reference tracks plus any additive
  values), one list per frame;
* answer: ``{"id": int, "ms": solve ms, "q": base64 float32 [frames * n * 4], "t": base64 float32 [frames * n * 3]}``: each
  joint's local rotation (x, y, z, w) and translation delta in REDengine axes, as the solver returns them; or
  ``{"id": int, "error": text}``. A request with ``"outputs": true`` also gets ``"o"``: base64 float32 [frames * m], the solve's
  processed track buffer (wrinkle outputs included), for the in-app solver's parity harness (tests/facial-solver-oracle.test.ts).

The host (src/facial-host.ts) owns everything else: which rig and setup, the track values, latest-wins scheduling and axes.

    python projects/xf-studio/authoring/tools/facial_solver_server.py --addon <IO Suite checkout> --rig <rig.json> --setup <setup.json>
"""
import argparse
import base64
import json
import sys
import time
import types
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_idle_face import external_solver  # noqa: E402


def send(message):
    sys.stdout.write(json.dumps(message, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--addon', type=Path, required=True)
    parser.add_argument('--rig', type=Path, required=True, help='WolvenKit JSON of the face skeleton (.rig)')
    parser.add_argument('--setup', type=Path, required=True, help='WolvenKit JSON of the facial setup (.facialsetup)')
    args = parser.parse_args()
    try:
        started = time.perf_counter()
        loader, runtime, model, solver = external_solver(args.addon)
        rig = json.loads(args.rig.read_text(encoding='utf-8'))['Data']['RootChunk']
        setup = loader.parse_facial_setup(json.loads(args.setup.read_text(encoding='utf-8')))
        names = rig['boneNames']
        tracks = rig['trackNames']
        dimensions = types.SimpleNamespace(num_bones=len(names), num_tracks=len(tracks))
        compiled = runtime.compile_runtime(setup, dimensions, model.TrackSegments.from_setup(setup, dimensions.num_tracks))
        compile_ms = (time.perf_counter() - started) * 1000
    except Exception as error:  # A plain line the host turns into guidance; the process then exits.
        send({'ready': False, 'error': f'{type(error).__name__}: {error}'})
        return 1
    send({'ready': True, 'joints': len(names), 'tracks': len(tracks), 'compileMs': round(compile_ms, 1)})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get('id')
            frames = np.asarray(request['frames'], dtype=np.float32)
            if frames.ndim != 2 or frames.shape[1] != len(tracks) or not np.isfinite(frames).all():
                raise ValueError(f'expected frames of {len(tracks)} finite track values')
            began = time.perf_counter()
            outputs = request.get('outputs') is True
            quats = np.empty((len(frames), len(names), 4), dtype=np.float32)
            trans = np.empty((len(frames), len(names), 3), dtype=np.float32)
            processed = np.empty((len(frames), len(tracks)), dtype=np.float32) if outputs else None
            for index, values in enumerate(frames):
                q, t, o = solver.solve_runtime(compiled, values, lod=0)
                quats[index], trans[index] = q, t
                if outputs:
                    o = np.asarray(o, dtype=np.float32).reshape(-1)
                    if o.shape[0] != len(tracks):
                        raise ValueError(f'the processed tracks hold {o.shape[0]} values, not {len(tracks)}')
                    processed[index] = o
            elapsed = (time.perf_counter() - began) * 1000
            answer = {'id': request_id, 'ms': round(elapsed, 3),
                      'q': base64.b64encode(quats.astype('<f4').tobytes()).decode('ascii'),
                      't': base64.b64encode(trans.astype('<f4').tobytes()).decode('ascii')}
            if outputs:
                answer['o'] = base64.b64encode(processed.astype('<f4').tobytes()).decode('ascii')
            send(answer)
        except Exception as error:
            send({'id': request_id, 'error': f'{type(error).__name__}: {error}'})
    return 0


if __name__ == '__main__':
    sys.exit(main())
