"""Publish only numeric and digest evidence from the ignored h091 comparison."""
import hashlib
import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PRIVATE = HERE / 'generated'
OLD = PRIVATE / 'clearance'
NEW = PRIVATE / 'h091-comparison'
FRAMES = (0, 169, 331, 490)
PARTS = ('head', 'native-eye', 'native-lash', 'native-wetness')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def surface(root, manifest, shape, frame, part):
    row = manifest['surfaces'][f'{shape}/{frame}/{part}']
    path = root / row['file']
    assert sha(path) == row['sha256']
    return np.fromfile(path, dtype='<f8').reshape(row['vertices'], 3)


def main():
    old_manifest, new_manifest = read(OLD / 'manifest.json'), read(NEW / 'manifest.json')
    old_report, new_report = read(HERE / 'clearance-evidence.json'), read(NEW / 'visible-evidence.json')
    assert new_manifest['schema'] == 'xfs/native-eye-h091-samples-1'
    assert new_manifest['frames'] == list(FRAMES)
    assert new_manifest['savedMorphs'] == ['h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear']
    assert new_manifest['eyeMorph'] == 'h091_eyes' and new_manifest['sharedExactH091Matrices'] == 34
    assert new_report['inputs']['sampleManifestSha256'] == sha(NEW / 'manifest.json')
    assert new_report['inputs']['contactPairsSha256'] == sha(NEW / 'contact-pairs.json')
    for entry in new_manifest['inputs'].values():
        assert sha(Path(entry['path'])) == entry['sha256']
    rows = []
    for frame in FRAMES:
        change = {}
        for part in PARTS:
            neutral_old = surface(OLD, old_manifest, 'neutral', frame, part)
            neutral_new = surface(NEW, new_manifest, 'neutral', frame, part)
            saved_old = surface(OLD, old_manifest, 'saved-five-morph', frame, part)
            saved_new = surface(NEW, new_manifest, 'saved-five-morph', frame, part)
            change[part] = {
                'neutralMaxComponentDifferenceMeters': float(np.max(np.abs(neutral_old - neutral_new))),
                'savedMaxVertexDisplacementMeters': float(np.linalg.norm(saved_old - saved_new, axis=1).max()),
            }
        old_eye = next(r for r in old_report['rows'] if r['shape'] == 'saved-five-morph'
                       and r['frame'] == frame and r['part'] == 'native-eye')
        new_eye = next(r for r in new_report['rows'] if r['shape'] == 'saved-five-morph'
                       and r['frame'] == frame and r['part'] == 'native-eye')
        rows.append({'frame': frame, 'parts': change,
                     'savedEyeFiniteContactPairs': {'old': old_eye['contactPairs'], 'h091': new_eye['contactPairs']},
                     'savedEyeOpaqueExposedContactPairs': {
                         'old': old_eye['allOpaqueSurfaceExposedContactPairs'],
                         'h091': new_eye['allOpaqueSurfaceExposedContactPairs']}})
    render_manifest_hashes = {}
    for mode in ('source', 'eye-only'):
        root = PRIVATE / 'renders' / 'h091-comparison' / mode
        manifest_path = root / 'manifest.json'
        render_manifest = read(manifest_path)
        assert render_manifest['source']['sampleManifestSha256'] == sha(NEW / 'manifest.json')
        assert render_manifest['frames'] == list(FRAMES) and len(render_manifest['renders']) == 8
        assert all(sha(root / row['file']) == row['sha256'] for row in render_manifest['renders'])
        render_manifest_hashes[mode] = sha(manifest_path)
    evidence = {
        'schema': 'xfs/native-eye-h091-comparison-1',
        'sourceSha256': {key: row['sha256'] for key, row in new_manifest['inputs'].items()},
        'sampleManifestSha256': sha(NEW / 'manifest.json'),
        'contactPairsSha256': sha(NEW / 'contact-pairs.json'),
        'visibleEvidenceSha256': sha(NEW / 'visible-evidence.json'),
        'renderManifestSha256': render_manifest_hashes,
        'maximumSourceBindPositionErrorMeters': new_manifest['maximumSourceBindPositionError'],
        'sharedExactH091Matrices': 34,
        'rows': rows,
        'limits': 'Offline current world-bind-relative idle solve; opaque finite rays and approximate materials. Neither live morph/graph activation nor REDengine parity is proved.',
    }
    out = HERE / 'h091-comparison-evidence.json'
    out.write_text(json.dumps(evidence, indent=2) + '\n')
    print(out, sha(out))


if __name__ == '__main__':
    main()
