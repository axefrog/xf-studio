"""Finite native-eye/head triangle contacts at selected, source-pinned idle phases."""
import hashlib
import json
import sys
import argparse
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / '006-plate-clearance'))
from triangles import contacts, self_test


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    self_test()
    parser = argparse.ArgumentParser()
    parser.add_argument('--sample', choices=['clearance', 'h091-comparison'], default='clearance')
    args = parser.parse_args()
    root = HERE / 'generated' / args.sample
    manifest = json.loads((root / 'manifest.json').read_text())
    assert manifest['schema'] == ('xfs/native-eye-finite-samples-1' if args.sample == 'clearance'
                                  else 'xfs/native-eye-h091-samples-1')
    assert manifest['sampleRate'] == 30 and len(manifest['frames']) == (9 if args.sample == 'clearance' else 4)
    assert manifest['inputs']['eye']['sha256'] == ('0e5420a75e5a65eded91bb68338860e119692f0868f78e7ef89c98c0c56eaeba'
                                                  if args.sample == 'clearance' else '90ec2ee3396c598da5061d7d51f5945c34f7ccbff95246393e11c433e3fc3fdf')
    assert manifest['inputs']['head']['sha256'] == '0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730'
    for entry in manifest['inputs'].values():
        assert sha(Path(entry['path'])) == entry['sha256']
    indices = {}
    for name, entry in manifest['meshIndices'].items():
        path = root / entry['file']
        assert sha(path) == entry['sha256']
        indices[name] = np.asarray(json.loads(path.read_text()), dtype=int).reshape(-1, 3)
    result = {'schema': 'xfs/native-eye-finite-contact-1',
              'sampleManifestSha256': sha(root / 'manifest.json'),
              'shapes': manifest['shapes'], 'frames': manifest['frames'],
              'selection': manifest.get('selection', {'fixedComparisonFrames': manifest['frames']}), 'parts': {}, 'rows': []}
    surface_names = ['head', 'native-eye', 'native-lash', 'native-wetness']
    for shape in manifest['shapes']:
        for frame in manifest['frames']:
            positions = {}
            for name in surface_names:
                entry = manifest['surfaces'][f'{shape}/{frame}/{name}']
                file = root / entry['file']
                assert sha(file) == entry['sha256']
                array = np.fromfile(file, dtype='<f8').reshape(-1, 3)
                assert array.shape == (entry['vertices'], 3) and np.isfinite(array).all()
                assert len(indices[name]) == entry['triangles'] and indices[name].max() < len(array)
                positions[name] = array
            head = positions['head'][indices['head']]
            for name in surface_names[1:]:
                part = positions[name][indices[name]]
                outcome = contacts(part, head)
                assert not outcome['degenerateHeadTriangles'] and not outcome['degeneratePlateTriangles']
                pairs = sorted(outcome['pairs'])
                row = {'shape': shape, 'frame': frame, 'part': name,
                       'candidatePairs': outcome['candidatePairs'],
                       'contactPairs': len(pairs),
                       'partTrianglesInContact': outcome['plateTrianglesInContact'],
                       'pairs': pairs}
                result['rows'].append(row)
                print(shape, frame, name, len(pairs), flush=True)
    for name in surface_names[1:]:
        rows = [r for r in result['rows'] if r['part'] == name]
        neutral = {r['frame']: {tuple(p) for p in r['pairs']} for r in rows if r['shape'] == 'neutral'}
        saved = {r['frame']: {tuple(p) for p in r['pairs']} for r in rows if r['shape'] != 'neutral'}
        result['parts'][name] = {
            'neutralCounts': {str(f): len(neutral[f]) for f in manifest['frames']},
            'savedCounts': {str(f): len(saved[f]) for f in manifest['frames']},
            'newPairOccurrencesInSaved': sum(len(saved[f] - neutral[f]) for f in manifest['frames']),
            'lostPairOccurrencesInSaved': sum(len(neutral[f] - saved[f]) for f in manifest['frames']),
        }
    output = root / 'contact-pairs.json'
    output.write_text(json.dumps(result, separators=(',', ':')) + '\n')
    print(json.dumps({'output': str(output), 'sha256': sha(output), 'parts': result['parts']}))


if __name__ == '__main__':
    main()
