"""Prepare one private import trial using measured WolvenKit readback shifts.

This is a bounded experiment, not an acceptance test. verify_repair.py must
check each actual resource readback after roundtrip.py.
"""
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


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    for name in ('derived', 'numeric', 'old-import', 'old-packed', 'head', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--scale', type=float, required=True)
    parser.add_argument('--iterate', action='store_true', help='Adjust the previous input by its measured packed error')
    args = parser.parse_args()
    assert 0 < args.scale <= 1.5
    assert not args.output.exists() or not any(args.output.iterdir())
    native_path = args.derived / 'xfs_bootstrap_eye_plate.glb'
    native = Glb(native_path)
    old_input = Glb(args.old_import)
    old_packed = Glb(args.old_packed)
    head = Glb(args.head)
    candidate = np.load(args.numeric)
    mapping = candidate['mapping']
    assert np.array_equal(mapping, json.loads((args.derived / 'vertex-map.json').read_text())['plateToHeadIndices'])
    assert sha(native_path) == '0571c4da09595009dbc7e4e305518e95f18a58ba4c59bf51e97e7d56d0f060ea'
    assert len(native.p['targets']) == len(old_input.p['targets']) == len(old_packed.p['targets']) == 105
    original_base = head.attr('POSITION')[mapping].astype(float)
    original_morph = np.stack([head.array(t['POSITION'])[mapping].astype(float) for t in head.p['targets']])
    input_base = old_input.attr('POSITION').astype(float) - original_base
    packed_base = old_packed.attr('POSITION').astype(float) - original_base
    input_morph = np.stack([old_input.array(t['POSITION']).astype(float) for t in old_input.p['targets']]) - original_morph
    packed_morph = np.stack([old_packed.array(t['POSITION']).astype(float) for t in old_packed.p['targets']]) - original_morph
    if args.iterate:
        base = input_base + args.scale * (candidate['base'] - packed_base)
        morph = input_morph + args.scale * (candidate['morph'] - packed_morph)
    else:
        base = candidate['base'] + args.scale * (input_base - packed_base)
        morph = candidate['morph'] + args.scale * (input_morph - packed_morph)
    args.output.mkdir(parents=True, exist_ok=True)
    output_glb = args.output / native_path.name
    write_glb(native_path, output_glb, base, morph)
    trial = Glb(output_glb)
    assert trial.mesh['extras']['targetNames'] == native.mesh['extras']['targetNames']
    np.testing.assert_array_equal(native.array(native.p['indices']), trial.array(trial.p['indices']))
    for attribute in native.p['attributes']:
        if attribute != 'POSITION':
            np.testing.assert_array_equal(native.attr(attribute), trial.attr(attribute))
    for before, after in zip(native.p['targets'], trial.p['targets']):
        for attribute in ('NORMAL', 'TANGENT'):
            np.testing.assert_array_equal(native.array(before[attribute]), trial.array(after[attribute]))
    manifest = json.loads((args.derived / 'derivation.json').read_text())
    manifest['schema'] = 'xfs/native-plate-readback-compensation-trial-1'
    manifest['neutralDerivedSha256'] = sha(native_path)
    manifest['numericCandidateSha256'] = sha(args.numeric)
    manifest['priorImportSha256'] = sha(args.old_import)
    manifest['priorPackedSha256'] = sha(args.old_packed)
    manifest['compensationScale'] = args.scale
    manifest['iteratedFromPreviousInput'] = args.iterate
    manifest['output']['sha256'] = sha(output_glb)
    manifest['allMorphAccessorsExact'] = False
    (args.output / 'derivation.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (args.output / 'vertex-map.json').write_bytes((args.derived / 'vertex-map.json').read_bytes())
    print(json.dumps({'scale': args.scale, 'iterated': args.iterate, 'importGlbSha256': sha(output_glb),
                      'maximumBaseCorrection': float(np.max(np.abs(base-candidate['base']))),
                      'maximumMorphCorrection': float(np.max(np.abs(morph-candidate['morph'])))}))


if __name__ == '__main__':
    main()
