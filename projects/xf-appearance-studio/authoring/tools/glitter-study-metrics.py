"""Measure owned bake output and render a coverage/albedo diagnostic sheet.
This is texture-input evidence, not a lit material/game-fidelity claim.
"""
from pathlib import Path
import json
import sys
import numpy as np
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[4]
folder = root / 'experiments/007-irregular-glitter/generated'
if '--fine' in sys.argv or '--covered' in sys.argv:
    # This catalogue is only complete in its declared regions. Encode the
    # owned pixels without applying global FFT/coverage claims to its empty exterior.
    fine = json.loads((folder / ('covered-manifest.json' if '--covered' in sys.argv else 'fine-manifest.json')).read_text(encoding='utf-8'))
    for row in fine['records']:
        name, size = row['name'], row['size']
        for kind in ['normal', 'surface', 'color']:
            Image.frombytes('RGBA', (size, size), (folder / f'{name}-{size}-{kind}.rgba').read_bytes()).save(folder / f'{name}-{size}-{kind}.png')
    print('Encoded region-limited fine study PNGs; no full-atlas statistics claimed.')
    sys.exit(0)
manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
metrics = []
coverage_by_variant = {}
for row in manifest['records']:
    name, size = row['name'], row['size']
    data = np.fromfile(folder / f'{name}-{size}-surface.rgba', dtype=np.uint8).reshape(size, size, 4)
    coverage = data[:, :, 0].astype(np.float64) / 255
    coverage_by_variant[(name, size)] = coverage
    centred = coverage - coverage.mean()
    variance = np.mean(centred ** 2)
    correlations = {}
    for cells in [64, 128, 256]:
        shift = size // cells
        # Non-wrapped lag; image-edge wrapping would invent neighbouring flakes.
        correlations[str(cells)] = [float(np.mean(centred[:, :-shift] * centred[:, shift:]) / variance),
                                   float(np.mean(centred[:-shift] * centred[shift:]) / variance)] if variance else [0, 0]
    fft = np.abs(np.fft.rfft2(centred)) ** 2
    yy, xx = np.ogrid[:size, :size // 2 + 1]
    radial = np.sqrt(np.minimum(yy, size-yy) ** 2 + xx ** 2)
    annulus = fft[(radial > 124) & (radial < 132)]
    reference = float(np.median(annulus))
    grid_power = float((fft[0, 128] + fft[128, 0]) / 2)
    metrics.append({ 'name': name, 'size': size, 'meanCoverage': float(coverage.mean()),
        'fractionFullyCovered': float(np.mean(coverage == 1)),
        'fractionPartiallyCovered': float(np.mean((coverage > 0) & (coverage < 1))),
        'axisLagCorrelation': correlations, 'legacy128GridPowerOverAnnulusMedian': grid_power/reference if reference else None })
    for kind in ['normal', 'surface', 'color']:
        image = Image.frombytes('RGBA', (size, size), (folder / f'{name}-{size}-{kind}.rgba').read_bytes())
        image.save(folder / f'{name}-{size}-{kind}.png')

sampling = []
for name in sorted({key[0] for key in coverage_by_variant}):
    low = coverage_by_variant[(name, 1024)]
    high = coverage_by_variant[(name, 2048)].reshape(1024, 2, 1024, 2).mean(axis=(1, 3))
    error = np.abs(low - high)
    sampling.append({'name': name, 'comparison': '1K base coverage versus 2K area-downsampled coverage',
        'meanAbsoluteError': float(error.mean()), 'p99AbsoluteError': float(np.quantile(error, .99)),
        'maxAbsoluteError': float(error.max()), 'meanCoverageDifference': float(low.mean()-high.mean())})

# Identical 256x256 UV-area crop from each 1K map, enlarged using nearest to
# reveal actual texel footprints rather than hide their sampling limitations.
names = ['legacy', 'sparse', 'default', 'dense', 'maximum']
sheet = Image.new('RGB', (5*320, 690), '#202327')
draw = ImageDraw.Draw(sheet)
for column, name in enumerate(names):
    draw.text((column*320+10, 10), name, fill='white')
    for row, kind in enumerate(['surface', 'color']):
        image = Image.open(folder / f'{name}-1024-{kind}.png')
        if kind == 'surface':
            image = image.getchannel('R').convert('RGB')
        image = image.crop((256, 256, 512, 512)).resize((310, 310), Image.Resampling.NEAREST)
        sheet.paste(image, (column*320+5, row*330+32))
sheet.save(folder / 'coverage-colour-comparison.png')
(folder / 'metrics.json').write_text(json.dumps({'coverage': metrics, 'sampling': sampling}, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'coverage': metrics, 'sampling': sampling}, indent=2))
