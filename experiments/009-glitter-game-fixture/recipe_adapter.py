"""Recipe-driven *offline* stock-decal Glitter approximation; never exports a mod.

The TypeScript bridge supplies exact Studio coverage. Facet placement below is
an explicitly independent material-study profile, not a translation of the
browser's direct-light settings. All pixels are generated here, not copied.
"""
import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import subprocess

from PIL import Image, ImageChops, ImageDraw
from fixture import (CLI, DEPOT, GAME, EMISSION, PBR, materials,
                     validate_templates)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / 'generated' / 'recipe-adapter'
PROFILE = {'id': 'mesh-decal-resolved-study-v1', 'seed': 20260924,
           'candidateCount': 2400, 'radiusPxAt1024': [0.6, 1.7],
           'sparseEmissionEvery': 11}
RECIPE_DEPOT = DEPOT + '/recipe_adapter'
RESOURCE_NAMES = {'xfs_glitter_pigment': 'xfs_glitter_recipe_pigment',
                  'xfs_glitter_facet_normal': 'xfs_glitter_recipe_facet_normal',
                  'xfs_glitter_shape': 'xfs_glitter_recipe_shape',
                  'xfs_glitter_roughness': 'xfs_glitter_recipe_roughness',
                  'xfs_glitter_metalness': 'xfs_glitter_recipe_metalness',
                  'xfs_glitter_emissive_mask': 'xfs_glitter_recipe_emissive_mask'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def image_digest(image):
    return digest(image.tobytes())


def mean_masked_slope(normal, mask):
    rgb, alpha = normal.convert('RGB').tobytes(), mask.tobytes()
    slopes = [math.hypot(2 * rgb[3 * i] / 255 - 1, 2 * rgb[3 * i + 1] / 255 - 1)
              for i, a in enumerate(alpha) if a >= 128]
    return {'coveredPixels': len(slopes), 'meanTangentSlope': sum(slopes) / len(slopes),
            'strongTiltFraction': sum(v >= .25 for v in slopes) / len(slopes)}


def run(recipe, layer, size):
    OUT.mkdir(parents=True, exist_ok=True)
    command = ['bun', str(HERE / 'recipe-mask.ts'), recipe, layer, str(size), str(OUT)]
    subprocess.run(command, cwd=ROOT, check=True, timeout=180)
    source = json.loads((OUT / 'source.json').read_text(encoding='utf-8'))
    source_recipe = json.loads((OUT / 'recipe.json').read_text(encoding='utf-8'))
    selected = next(l for l in source_recipe['layers'] if l['id'] == layer)
    alpha = (OUT / 'coverage-alpha.raw').read_bytes()
    assert len(alpha) == size * size and digest(alpha) == source['coverageSha256']
    mask = Image.frombytes('L', (size, size), alpha)
    assert mask.getbbox() and source['coveredTexels'] == sum(v != 0 for v in alpha)
    rgba = Image.new('RGBA', (size, size), tuple(int(selected['color'][i:i + 2], 16)
                                                   for i in (1, 3, 5)) + (255,))
    rgba.putalpha(mask.point([round(math.sqrt(v / 255) * 255) for v in range(256)]))
    normal = Image.new('RGB', (size, size), (128, 128, 255))
    roughness = Image.new('L', (size, size), 170)
    metalness = Image.new('L', (size, size), 0)
    emission = Image.new('L', (size, size), 0)
    nd, rd, md, ed = map(ImageDraw.Draw, (normal, roughness, metalness, emission))
    rng = random.Random(PROFILE['seed'])
    accepted = 0
    # The bounding rectangle only avoids wasted random trials. The *exact*
    # recipe mask still clips every generated material map below.
    left, top, right, bottom = mask.getbbox()
    for _ in range(PROFILE['candidateCount']):
        x, y = rng.randrange(left, right), rng.randrange(top, bottom)
        if mask.getpixel((x, y)) < 110:
            continue
        radius = rng.uniform(*PROFILE['radiusPxAt1024']) * size / 1024
        angle = rng.random() * math.tau
        sides = rng.choice((3, 4))
        points = [(round(x + radius * math.cos(angle + math.tau * j / sides)),
                   round(y + radius * math.sin(angle + math.tau * j / sides))) for j in range(sides)]
        tilt = rng.random() * math.tau
        slope = rng.uniform(.2, .8)
        nd.polygon(points, fill=(round(127.5 * (1 + slope * math.cos(tilt))),
                                 round(127.5 * (1 + slope * math.sin(tilt))), 255))
        rd.polygon(points, fill=rng.randrange(35, 95))
        md.polygon(points, fill=rng.randrange(170, 245))
        if accepted % PROFILE['sparseEmissionEvery'] == 0:
            ed.polygon(points, fill=rng.randrange(150, 220))
        accepted += 1
    normal = Image.composite(normal, Image.new('RGB', normal.size, (128, 128, 255)), mask)
    roughness = Image.composite(roughness, Image.new('L', roughness.size, 170), mask)
    metalness = ImageChops.multiply(metalness, mask)
    emission = ImageChops.multiply(emission, mask)
    maps = {'pigment': rgba, 'shape': mask, 'facet_normal': normal,
            'roughness': roughness, 'metalness': metalness, 'emissive_mask': emission}
    map_hashes = {}
    for name, image in maps.items():
        image.save(OUT / f'xfs_glitter_recipe_{name}.png')
        map_hashes[name] = image_digest(image)
    minification = []
    for tier in (size, size // 2, size // 4, size // 8, size // 16):
        shape = mask.resize((tier, tier), Image.Resampling.BOX)
        norm = normal.resize((tier, tier), Image.Resampling.BOX)
        emi = emission.resize((tier, tier), Image.Resampling.BOX)
        stat = mean_masked_slope(norm, shape)
        assert stat['coveredPixels'] > 0
        pixels = emi.tobytes()
        minification.append({'size': tier, **stat,
                             'emissionHighContrastFraction': sum(v >= 96 for v in pixels) / len(pixels)})
    report = {'status': 'recipe-driven offline map study; not a game export',
              'gameTemplateEvidence': 'mesh_decal.mt / mesh_decal_emissive_subsurface.mt, game 2.31; see result.json',
              'source': source, 'sourceOptics': selected['flakes'],
              'approximationProfile': PROFILE, 'acceptedFacetCandidates': accepted,
              'mapPixelSha256': map_hashes, 'sourceBoxMinification': minification,
              'contract': {'pigment': 'sRGB layer RGB; alpha=sqrt(exact recipe coverage)',
                           'normal': 'resolved RGB tilt; game reads BC5 R/G',
                           'normalCoverage': 'exact recipe coverage; game reads red',
                           'roughnessMetalness': 'resolved red scalar maps',
                           'emission': 'separate sparse red mask; light-independent, second component'},
              'losses': ['Direct-light UV-cell facet selection, strength and fineShare have no stock shader mapping.',
                         'This fixed approximation profile does not consume recipe density, seed or facet colour.',
                         'BOX results are source diagnostics, not decoded game XBM mips or light response.',
                         'No eye plate, morphs, appearance, selector, archive or runtime rendering is built.'],
              'studioExportGuardRetained': True, 'gameRendered': False}
    (OUT / 'result.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report


def run_cli(label, arguments, options=None):
    env = os.environ.copy()
    for key, value in (options or {}).items():
        env['XbmImportArgs__' + key] = str(value).lower() if isinstance(value, bool) else str(value)
    proc = subprocess.run([str(CLI), *map(str, arguments)], cwd=ROOT, env=env,
                          capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300)
    log = proc.stdout + '\n' + proc.stderr
    logs = OUT / 'logs'
    logs.mkdir(exist_ok=True)
    (logs / f'{label}.log').write_text(log, encoding='utf-8')
    imported = re.search(r'Imported (\d+)/(\d+) file\(s\)', log)
    import_ok = label.startswith('import-') and proc.returncode == 3 and imported and int(imported[1]) > 0 and imported[1] == imported[2]
    if (proc.returncode != 0 and not import_ok) or re.search(r'\bError\s*\]|Unhandled exception|Traceback \(', log):
        raise RuntimeError(f'{label}: exit {proc.returncode}; inspect {logs / (label + ".log")}')


def serialize_stock_candidates(paths, size):
    """Optional local XBM/MI roundtrip using exact verified 2.31 templates."""
    if not CLI.is_file() or not GAME.is_dir():
        raise FileNotFoundError('WolvenKit CLI or installed game missing')
    templates = validate_templates(paths)
    archive = OUT / 'archive' / RECIPE_DEPOT
    archive.mkdir(parents=True, exist_ok=True)
    inputs = OUT / 'import-input'
    for group, names in {'colour': ['pigment'], 'normal': ['facet_normal'],
                         'scalar': ['shape', 'roughness', 'metalness', 'emissive_mask']}.items():
        folder = inputs / group
        folder.mkdir(parents=True, exist_ok=True)
        for name in names:
            source = OUT / f'xfs_glitter_recipe_{name}.png'
            (folder / source.name).write_bytes(source.read_bytes())
    settings = {'GenerateMipMaps': True, 'IsStreamable': True, 'PremultiplyAlpha': False}
    for group, specific in {
        'colour': dict(IsGamma=True, TextureGroup='TEXG_Generic_Color', RawFormat='TRF_TrueColor', Compression='TCM_QualityColor'),
        'normal': dict(IsGamma=False, TextureGroup='TEXG_Generic_Normal', RawFormat='TRF_TrueColor', Compression='TCM_Normalmap'),
        'scalar': dict(IsGamma=False, TextureGroup='TEXG_Generic_Grayscale', RawFormat='TRF_Grayscale', Compression='TCM_QualityR')
    }.items():
        run_cli('import-' + group, ['import', inputs / group, '-o', archive], settings | specific)
    docs = materials()
    named = {'xfs_glitter_recipe_pbr': copy.deepcopy(docs[PBR]),
             'xfs_glitter_recipe_emission': copy.deepcopy(docs[EMISSION])}
    for name, doc in named.items():
        for entry in doc['Data']['RootChunk']['values']:
            for value in entry.values():
                if isinstance(value, dict) and 'DepotPath' in value:
                    path = value['DepotPath']['$value'].replace('\\', '/')
                    for old, new in RESOURCE_NAMES.items():
                        path = path.replace('/' + old + '.xbm', '/' + new + '.xbm')
                    value['DepotPath']['$value'] = path.replace(DEPOT, RECIPE_DEPOT).replace('/', '\\')
        output = OUT / 'mi-json' / (name + '.mi.json')
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(doc, indent=2) + '\n', encoding='utf-8')
    run_cli('deserialize-materials', ['convert', 'deserialize', OUT / 'mi-json', '-o', archive])
    (OUT / 'roundtrip').mkdir(parents=True, exist_ok=True)
    run_cli('serialize-resources', ['convert', 'serialize', archive, '-o', OUT / 'roundtrip'])
    binary_hashes = {}
    for name, doc in named.items():
        binary = archive / (name + '.mi')
        actual = json.loads((OUT / 'roundtrip' / (name + '.mi.json')).read_text(encoding='utf-8'))['Data']['RootChunk']
        wanted = doc['Data']['RootChunk']
        assert actual['baseMaterial'] == wanted['baseMaterial']
        assert actual['values'] == wanted['values']
        assert binary.is_file()
        for entry in actual['values']:
            for value in entry.values():
                if isinstance(value, dict) and 'DepotPath' in value:
                    local = OUT / 'archive' / value['DepotPath']['$value'].replace('\\', '/')
                    assert local.is_file(), (name, local)
        binary_hashes[name] = digest(binary.read_bytes())
    expected_compression = {'colour': 'TCM_QualityColor', 'normal': 'TCM_Normalmap', 'scalar': 'TCM_QualityR'}
    texture_hashes = {}
    for group, files in {'colour': ['pigment'], 'normal': ['facet_normal'],
                         'scalar': ['shape', 'roughness', 'metalness', 'emissive_mask']}.items():
        for label in files:
            name = 'xfs_glitter_recipe_' + label
            binary = archive / (name + '.xbm')
            root = json.loads((OUT / 'roundtrip' / (name + '.xbm.json')).read_text(encoding='utf-8'))['Data']['RootChunk']
            assert binary.is_file() and root['width'] == root['height'] == size
            assert root['setup']['compression'] == expected_compression[group]
            assert root['setup']['hasMipchain'] == 1 and root['setup']['isGamma'] == int(group == 'colour')
            texture_hashes[name] = digest(binary.read_bytes())
    (OUT / 'export').mkdir(exist_ok=True)
    run_cli('export-textures', ['export', archive, '-o', OUT / 'export', '--uext', 'png', '--gamepath', GAME])
    wanted = Image.open(OUT / 'xfs_glitter_recipe_shape.png').convert('L').tobytes()
    decoded_alpha = Image.open(OUT / 'export/xfs_glitter_recipe_pigment.png').convert('RGBA').getchannel('A').tobytes()
    edges = [abs((a / 255) ** 2 - b / 255) for a, b in zip(decoded_alpha, wanted) if 0 < b < 255]
    assert edges
    edge_error = sum(edges) / len(edges)
    assert edge_error < .035, edge_error
    decoded_emission = Image.open(OUT / 'export/xfs_glitter_recipe_emissive_mask.png').convert('RGBA').getchannel('R').tobytes()
    leaks = sum(1 for a, b in zip(decoded_emission, wanted) if b == 0 and a > 8)
    assert leaks == 0, leaks
    report = {'status': '2.31 stock material binary serialization only; no mesh/selector/runtime',
              'templates': templates, 'materials': binary_hashes, 'textures': texture_hashes,
              'decodedBasePartialCoverageMeanError': edge_error,
              'decodedEmissionOutsideShapeTexels': leaks,
              'decodedLowerMipsChecked': False, 'gameRendered': False}
    (OUT / 'serialization.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', default='--sample')
    parser.add_argument('--layer', default='sample-glitter')
    parser.add_argument('--size', type=int, default=1024)
    parser.add_argument('--check', action='store_true', help='Compare to committed sample result')
    parser.add_argument('--serialize', action='store_true', help='Also make XBM/MI fixture with verified current-game templates')
    parser.add_argument('--pbr-template', type=Path)
    parser.add_argument('--emissive-template', type=Path)
    args = parser.parse_args()
    report = run(args.recipe, args.layer, args.size)
    expected = HERE / 'recipe-adapter-result.json'
    if args.check:
        assert json.loads(expected.read_text(encoding='utf-8')) == report
    else:
        expected.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    if args.serialize:
        if not args.pbr_template or not args.emissive_template:
            parser.error('--serialize requires --pbr-template and --emissive-template')
        result = serialize_stock_candidates({'mesh_decal': args.pbr_template,
                                             'mesh_decal_emissive_subsurface': args.emissive_template}, args.size)
        serial = HERE / 'recipe-adapter-serialization.json'
        if args.check:
            assert json.loads(serial.read_text(encoding='utf-8')) == result
        else:
            serial.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'mask': report['source']['coverageSha256'],
                      'acceptedFacets': report['acceptedFacetCandidates'],
                      'mips': report['sourceBoxMinification']}, indent=2))
