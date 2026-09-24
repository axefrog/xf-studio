"""Materialize a verified numeric field as a private native-cut import input."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / '004-plate-import'), str(HERE.parent / '006-plate-clearance')]
from verify_roundtrip import Glb  # noqa: E402
from roundtrip_crease import write_glb  # noqa: E402

NATIVE_SHA = '0571c4da09595009dbc7e4e305518e95f18a58ba4c59bf51e97e7d56d0f060ea'
NAME = 'xfs_bootstrap_eye_plate.glb'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--derived', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--numeric-report', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError('Output directory must be new and empty')
    source = args.derived / NAME
    assert sha(source) == NATIVE_SHA
    report = json.loads(args.numeric_report.read_text())
    assert report['gate'] == 'NUMERIC_PASS'
    assert report['inputSha256']['candidate'] == sha(args.candidate)
    assert report['inputSha256']['native'] == NATIVE_SHA
    data = np.load(args.candidate)
    assert set(data.files) == {'base', 'morph', 'mapping'}
    mapping = json.loads((args.derived / 'vertex-map.json').read_text())
    np.testing.assert_array_equal(data['mapping'], mapping['plateToHeadIndices'])
    args.output.mkdir(parents=True, exist_ok=True)
    destination = args.output / NAME
    write_glb(source, destination, data['base'], data['morph'])
    original, final = Glb(source), Glb(destination)
    assert original.mesh['extras']['targetNames'] == final.mesh['extras']['targetNames']
    np.testing.assert_array_equal(original.array(original.p['indices']), final.array(final.p['indices']))
    for attribute in original.p['attributes']:
        if attribute != 'POSITION':
            np.testing.assert_array_equal(original.attr(attribute), final.attr(attribute))
    for a, b in zip(original.p['targets'], final.p['targets']):
        for attribute in ('NORMAL', 'TANGENT'):
            np.testing.assert_array_equal(original.array(a[attribute]), final.array(b[attribute]))
    manifest = json.loads((args.derived / 'derivation.json').read_text())
    assert manifest['output']['sha256'] == NATIVE_SHA
    manifest['schema'] = 'xfs/native-plate-repair-import-input-1'
    manifest['neutralDerivedSha256'] = NATIVE_SHA
    manifest['numericCandidateSha256'] = sha(args.candidate)
    manifest['output']['sha256'] = sha(destination)
    manifest['allMorphAccessorsExact'] = False
    manifest['limits'] = [
        'This is a numeric correction imported only for private resource validation.',
        'A numeric pass does not establish packed-resource clearance or game rendering.',
    ]
    (args.output / 'derivation.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (args.output / 'vertex-map.json').write_bytes((args.derived / 'vertex-map.json').read_bytes())
    print(json.dumps({'candidateSha256': sha(args.candidate),
                      'importGlbSha256': sha(destination),
                      'triangleUvSkinAndShadingAccessorsExact': True}))


if __name__ == '__main__':
    main()
