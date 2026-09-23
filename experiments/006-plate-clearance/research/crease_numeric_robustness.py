"""Verify nearby quantized crease corrections with the independent full gate.

All candidate arrays and full verifier reports are ignored local outputs. This
never modifies the owned plate or emits a game resource.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
EXP = HERE.parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    baseline = json.loads((HERE / 'coupled_morph_opt_summary.json').read_text())
    original = ROOT / baseline['combinedNumericResult']
    assert sha(original) == baseline['combinedNumericSha256']
    source = np.load(original)
    crease = json.loads((HERE / 'crease_split_center_summary.json').read_text())
    delta = np.array(crease['bestSharedDelta'])
    interior = np.array(crease['bestInteriorDelta'])
    # Small variations reveal a numerically knife-edge candidate before any
    # resource import. They are not a proof over continuous pose time.
    variants = {
        'rounded_0p1micron': np.round(delta / 1e-7) * 1e-7,
        'pure_y_minus12micron': np.array([0., -12e-6, 0.]),
        'pure_y_minus14micron': np.array([0., -14e-6, 0.]),
        'pure_y_minus16micron': np.array([0., -16e-6, 0.]),
        'pure_y_minus20micron': np.array([0., -20e-6, 0.]),
        'y_minus_0p5micron': delta + np.array([0., -.5e-6, 0.]),
        'y_plus_0p5micron': delta + np.array([0., .5e-6, 0.]),
        'interior_rounded_0p1micron': np.round(interior / 1e-7) * 1e-7,
        'interior_x_minus1micron': interior + np.array([-1e-6, 0., 0.]),
        'interior_x_plus1micron': interior + np.array([1e-6, 0., 0.]),
        'interior_y_minus1micron': interior + np.array([0., -1e-6, 0.]),
        'interior_y_plus1micron': interior + np.array([0., 1e-6, 0.]),
        'interior_z_minus1micron': interior + np.array([0., 0., -1e-6]),
        'interior_z_plus1micron': interior + np.array([0., 0., 1e-6]),
    }
    output = []
    candidate_dir = EXP / 'generated/morph-aware'
    candidate_dir.mkdir(parents=True, exist_ok=True)
    for name, trial in variants.items():
        morph = source['morphChange'].copy()
        # Resolve h091_eyes from the linked source GLB's target ordering.
        prior = json.loads((HERE / 'morph_aware_rescue_summary.json').read_text())
        build = json.loads((Path(prior['sourceBuild']) / 'build.json').read_text())
        sys.path[:0] = [str(EXP.parent / '004-plate-import')]
        from verify_roundtrip import Glb
        head = Glb(Path(build['head']))
        names = head.mesh['extras']['targetNames']
        morph[names.index('h091_eyes'), 119] += trial
        file = candidate_dir / f'crease-robust-{name}.npz'
        np.savez_compressed(file, field=source['field'], baseChange=source['baseChange'],
                            morphChange=morph, mapping=source['mapping'])
        report = candidate_dir / f'crease-robust-{name}.json'
        relative = file.relative_to(ROOT)
        command = [sys.executable, str(HERE / 'coupled_morph_verify.py'),
                   '--candidate', str(relative), '--sha256', sha(file),
                   '--output', str(report)]
        verdict = json.loads(report.read_text()) if report.exists() else None
        if verdict is None or verdict['sha256'] != sha(file):
            subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
            verdict = json.loads(report.read_text())
        output.append({'name': name, 'delta': trial.tolist(), 'sha256': sha(file),
                       'gates': verdict['gates'], 'summary': verdict['summary']})
    path = HERE / 'crease_numeric_robustness_summary.json'
    path.write_text(json.dumps({'originalCandidateSha256': sha(original),
                                'variants': output,
                                'scope': '107 static shapes and 73 sampled poses each; no resource or continuous-time proof'},
                               indent=2) + '\n')
    print(json.dumps([(v['name'], v['summary']['posedNewNonadjacent'],
                       v['summary']['staticNewNonadjacent']) for v in output]))


if __name__ == '__main__':
    main()
