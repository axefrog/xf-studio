"""Measure fine-flake coverage only where the region study is authoritative.

Rebuilds the fixed mask through the actual TypeScript evaluator and checks its
hash against the bake manifest; no duplicated Python mask implementation.
These are texture sampling metrics, not screen-space highlight or BRDF tests.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess

import numpy as np


def sha(data):
    return hashlib.sha256(data).hexdigest()


def stats(values):
    return {
        "mean": float(values.mean()),
        "p50": float(np.quantile(values, .5)),
        "p90": float(np.quantile(values, .9)),
        "p95": float(np.quantile(values, .95)),
        "p99": float(np.quantile(values, .99)),
        "maximum": float(values.max()),
        "pixels": int(values.size),
    }


def roi_pixels(size, regions):
    # The entire texel lies inside a valid region, matching the bake harness.
    y, x = np.ogrid[:size, :size]
    result = np.zeros((size, size), dtype=bool)
    for r in regions:
        result |= ((x / size >= r['minU']) & ((x + 1) / size <= r['maxU'])
                   & (y / size >= r['minV']) & ((y + 1) / size <= r['maxV']))
    return result


def main():
    authoring = Path(__file__).resolve().parents[1]
    root = authoring.parents[2]
    folder = root / 'experiments/007-irregular-glitter/generated'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bun', default=shutil.which('bun') or str(Path.home() / '.bun/bin/bun.exe'))
    args = parser.parse_args()
    manifest_bytes = (folder / 'fine-manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    rows = manifest['records']
    masks = {}
    for size in sorted({r['size'] for r in rows}):
        script = ('import {initialRecipe,raster} from "./src/recipe";'
                  'const layer=initialRecipe().layers[0];'
                  'layer.color="#592640";layer.opacity=1;layer.enabled=true;'
                  f'process.stdout.write(Buffer.from(raster(layer,{size})));')
        data = subprocess.run([args.bun, '-e', script], cwd=authoring,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout
        if len(data) != size * size * 4:
            raise ValueError('Unexpected fixed-mask output length')
        digest = sha(data)
        for r in rows:
            if r['size'] == size and digest != r['regionMaskEvidence']['maskSha256']:
                raise ValueError(f'Fixed-mask hash differs from bake evidence at {size}')
        masks[size] = np.frombuffer(data, np.uint8).reshape(size, size, 4)[:, :, 3].astype(np.float64) / 255

    coverage = {}
    measurements = []
    for row in rows:
        name, size = row['name'], row['size']
        data = (folder / f'{name}-{size}-surface.rgba').read_bytes()
        recorded = next(f['sha256'] for f in row['files'] if f['name'].endswith('-surface.rgba'))
        if sha(data) != recorded:
            raise ValueError(f'Coverage hash differs from bake evidence: {name}/{size}')
        field = np.frombuffer(data, np.uint8).reshape(size, size, 4)[:, :, 0].astype(np.float64) / 255
        coverage[name, size] = field
        mask = masks[size]
        valid = roi_pixels(size, row['studyRegion']['regions'])
        painted = mask > 0
        if np.any(painted & ~valid):
            raise ValueError(f'Painted pixels fall outside valid ROI: {name}/{size}')
        values = field[painted]
        q = row['radiusQuantiles']
        measurements.append({
            'name': name, 'size': size,
            'nonzeroMaskPixels': int(painted.sum()),
            'maskWeightedMeanFlakeCoverage': float(np.sum(field * mask) / mask.sum()),
            'unweightedNonzeroMaskCoverage': stats(values),
            'opaqueMaskMeanFlakeCoverage': float(field[mask >= .9].mean()),
            'fractionPaintedPixelsWithAnyFlake': float(np.mean(values > 0)),
            'fractionPaintedPixelsFullyFlakeCovered': float(np.mean(values == 1)),
            'fractionPaintedPixelsPartiallyFlakeCovered': float(np.mean((values > 0) & (values < 1))),
            'characteristicMajorDiameterUVTexels': {
                'median': q[2] * 2 * size, 'p90': q[3] * 2 * size,
                'minimum': q[0] * 2 * size, 'maximum': q[4] * 2 * size,
                'definition': '2 * catalogue characteristic radius * atlas size; enclosing ellipse major diameter, not actual hexagon chord or screen projection',
                'population': 'retained region-plus-halo catalogue; unweighted by visible area or mask',
            },
        })

    errors = []
    for name in sorted({r['name'] for r in rows}):
        row = next(r for r in rows if r['name'] == name and r['size'] == 1024)
        low = coverage[name, 1024]
        high = coverage[name, 2048].reshape(1024, 2, 1024, 2).mean(axis=(1, 3))
        difference = np.abs(low - high)
        valid = roi_pixels(1024, row['studyRegion']['regions'])
        painted = masks[1024] > 0
        flake_visible = valid & ((low > 0) | (high > 0))
        errors.append({
            'name': name, 'comparison': '1K encoded coverage versus arithmetic average of corresponding 2x2 encoded 2K texels',
            'validRegionAbsoluteError': stats(difference[valid]),
            'flakePresentValidRegionAbsoluteError': stats(difference[flake_visible]),
            'nonzeroFixedMaskAbsoluteError': stats(difference[painted]),
            'maskWeightedMeanAbsoluteError': float(np.sum(difference * masks[1024]) / masks[1024].sum()),
            'validRegionSignedMeanDifference': float(np.mean((low - high)[valid])),
        })
    result = {
        'study': 'fine glitter mask-restricted sampling analysis',
        'fineManifestSha256': sha(manifest_bytes),
        'maskAndSurfaceHashesVerified': True,
        'limitations': [
            'Measurements exclude invalid atlas regions and do not assert full-atlas coverage.',
            'Coverage is encoded to 8 bits after 16 fixed subsamples; comparison includes this quantization.',
            'Averaging encoded scalar coverage is meaningful here, but does not preserve a normal distribution or a BRDF.',
            'UV texel diameters are not millimetres or screen-space sizes; the mesh UV mapping and camera determine appearance.',
            'No evidence here establishes convincing lit or animated glitter, two-lobe shading, or game parity.',
        ],
        'coverage': measurements, 'resolutionErrors': errors,
    }
    (folder / 'fine-metrics.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    for row in measurements:
        print(json.dumps({k: row[k] for k in ['name', 'size', 'maskWeightedMeanFlakeCoverage', 'fractionPaintedPixelsFullyFlakeCovered', 'characteristicMajorDiameterUVTexels']}))
    for row in errors:
        print(json.dumps({'name': row['name'], 'maskMeanError': row['maskWeightedMeanAbsoluteError'], 'ROI': row['validRegionAbsoluteError']}))


if __name__ == '__main__':
    main()
