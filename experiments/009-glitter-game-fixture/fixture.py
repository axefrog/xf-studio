"""Build and verify an offline, generated-pixel REDengine glitter comparison.

This script does not create a mesh, appearance, selector, archive, or install.
Both source templates must be extracted from Cyberpunk 2077 2.31 and supplied
as binaries with adjacent WolvenKit JSON. All outputs stay in ignored generated/.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import subprocess

from PIL import Image, ImageChops, ImageDraw

HERE = Path(__file__).resolve().parent
HQ = HERE.parents[1]
OUT = HERE / 'generated'
CLI = Path('F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe')
GAME = Path('F:/Games/Cyberpunk 2077')
SIZE = 1024
DEPOT = 'axefrog/appearance_studio/studies/glitter_game'
PBR = 'xfs_glitter_resolved_pbr'
AXIAL_PBR = 'xfs_glitter_axial_pbr'
EMISSION = 'xfs_glitter_sparse_emission'
TEMPLATES = {
    'mesh_decal': ('b1b181b70fd1b16393d626281eeff1d5fc99932f24868e55248d18a1abfbc019', 'renderstage_post_gbuffer'),
    'mesh_decal_emissive_subsurface': ('b590a2ee02497e7354e3ed2f83d4bfff42b08a7b2ee14f202c45f10ee799d699', 'renderstage_subsurface_emissive'),
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')


def validate_templates(paths):
    evidence = {}
    for name, path in paths.items():
        expected, stage = TEMPLATES[name]
        if not path.is_file() or sha(path) != expected:
            raise ValueError(f'{name}: expected current-game binary SHA-256 {expected}')
        serialized = path.with_name(path.name + '.json')
        if not serialized.is_file():
            raise FileNotFoundError(f'Serialize {path} to adjacent {serialized.name}')
        doc = load(serialized)
        root = doc['Data']['RootChunk']
        assert doc['Header']['GameVersion'] == 2310 and root['name']['$value'] == name
        assert 'MVF_MeshSkinned' in root['vertexFactories']
        passes = [p for t in root['techniques'] for p in t['passes'] if p['stagePassNameRegular']['$value'] == stage]
        assert passes and all(p['depthStencilMode']['depthWriteEnable'] == 0 for p in passes)
        assert any(any(target['blendEnable'] for target in p['blendMode']['renderTarget']['Elements'][:p['blendMode']['numTargets']]) for p in passes)
        available = {p['name']['$value'] for group in root['parameterInfo'] for p in group}
        instance = materials()[PBR if name == 'mesh_decal' else EMISSION]['Data']['RootChunk']
        assert set(values(instance)).issubset(available)
        # The selected emissive pixel program multiplies EmissiveMask by
        # SecondaryMask.red. The instance omits SecondaryMask intentionally,
        # so pin the 2.31 template's white default instead of assuming it.
        if name == 'mesh_decal_emissive_subsurface':
            defaults = {item['Data']['parameterName']['$value']: item['Data']
                        for group in root['parameters']['Elements'] for item in group}
            gate = defaults['SecondaryMask']['texture']['DepotPath']['$value']
            assert gate == 'engine\\textures\\editor\\white.xbm', gate
        evidence[name] = {'binarySha256': expected, 'jsonSha256': sha(serialized),
                          'gameVersion': 2310, 'stage': stage, 'meshSkinned': True,
                          'alphaBlendedTarget': True, 'depthWrite': False}
        if name == 'mesh_decal_emissive_subsurface':
            evidence[name]['defaultSecondaryMask'] = gate
    return evidence


def run(label, args, settings=None):
    env = os.environ.copy()
    for key, value in (settings or {}).items():
        env['XbmImportArgs__' + key] = str(value).lower() if isinstance(value, bool) else str(value)
    result = subprocess.run([str(CLI), *map(str, args)], cwd=HQ, env=env,
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300)
    log = result.stdout + '\n' + result.stderr
    (OUT / 'logs').mkdir(parents=True, exist_ok=True)
    (OUT / 'logs' / (label + '.log')).write_text(log, encoding='utf-8')
    counts = re.search(r'Imported (\d+)/(\d+) file\(s\)', log)
    imported = label.startswith('import-') and result.returncode == 3 and counts and counts[1] == counts[2] and int(counts[1]) > 0
    if (result.returncode != 0 and not imported) or re.search(r'\bError\s*\]|Unhandled exception|Traceback \(', log):
        raise RuntimeError(f'{label}: exit {result.returncode}; inspect {OUT / "logs" / (label + ".log")}')


def cname(value):
    return {'$type': 'CName', '$storage': 'string', '$value': value}


def ref(path):
    return {'DepotPath': {'$type': 'ResourcePath', '$storage': 'string', '$value': path.replace('/', '\\')}, 'Flags': 'Default'}


def tex(key, name):
    return {'$type': 'rRef:ITexture', key: ref(f'{DEPOT}/{name}.xbm')}


def scalar(key, value):
    return {'$type': 'Float', key: value}


def material(name, template, values):
    root = {'$type': 'CMaterialInstance', 'audioTag': cname('None'),
            'baseMaterial': ref(f'base/materials/{template}.mt'), 'cookingPlatform': 'PLATFORM_PC',
            'enableMask': 0, 'resourceVersion': 4, 'values': values}
    return {'Header': {'WolvenKitVersion': '8.17.4', 'WKitJsonVersion': '0.0.9',
                       'GameVersion': 2310, 'DataType': 'CR2W'},
            'Data': {'Version': 195, 'BuildVersion': 0, 'RootChunk': root, 'EmbeddedFiles': []}}


def pbr_values(normal_name):
    pbr = [tex('DiffuseTexture', 'xfs_glitter_pigment'),
           tex('NormalTexture', normal_name),
           tex('NormalAlphaTex', 'xfs_glitter_shape'),
           tex('RoughnessTexture', 'xfs_glitter_roughness'),
           tex('MetalnessTexture', 'xfs_glitter_metalness'),
           {'$type': 'Color', 'DiffuseColor': {'$type': 'Color', 'Red': 255, 'Green': 255, 'Blue': 255, 'Alpha': 255}}]
    pbr += [scalar(k, v) for k, v in {
        'DiffuseAlpha': 1, 'NormalAlpha': 1, 'UseNormalAlphaTex': 1,
        'RoughnessMetalnessAlpha': 1, 'RoughnessScale': 1, 'MetalnessScale': 1,
        'RoughnessBias': 0, 'MetalnessBias': 0,
        'AlphaMaskContrast': 0, 'SecondaryMaskInfluence': 0, 'NormalsBlendingMode': 0,
    }.items()]
    return pbr


def materials():
    emission = [tex('EmissiveMask', 'xfs_glitter_emissive_mask'),
                {'$type': 'Vector4', 'EmissiveMaskChannel': {'$type': 'Vector4', 'W': 0, 'X': 1, 'Y': 0, 'Z': 0}},
                {'$type': 'Color', 'EmissiveColor': {'$type': 'Color', 'Red': 255, 'Green': 222, 'Blue': 171, 'Alpha': 255}},
                scalar('EmissiveEV', 0.0), scalar('AlphaThreshold', 0.0)]
    return {PBR: material(PBR, 'mesh_decal', pbr_values('xfs_glitter_facet_normal')),
            AXIAL_PBR: material(AXIAL_PBR, 'mesh_decal', pbr_values('xfs_glitter_axial_normal')),
            EMISSION: material(EMISSION, 'mesh_decal_emissive_subsurface', emission)}


def axial_normal_from_height(height):
    """Finite-difference tangent normal from a deliberately simple axial height field."""
    source = height.load()
    image = Image.new('RGB', height.size, (128, 128, 255))
    target = image.load()
    for y in range(1, SIZE - 1):
        for x in range(1, SIZE - 1):
            # One pixel of source height is 1/32 tangent-slope unit. This
            # artistic scale is a fixture parameter, not a REDengine unit.
            nx = (source[x - 1, y] - source[x + 1, y]) / 64
            ny = (source[x, y - 1] - source[x, y + 1]) / 64
            length = math.hypot(nx, ny)
            if length > .85:
                nx *= .85 / length
                ny *= .85 / length
            target[x, y] = (round(127.5 * (nx + 1)), round(127.5 * (ny + 1)), 255)
    return image


def generate_pixels():
    """Deterministic ellipsoid test patch and seeded triangles/quads; no source art."""
    rng = random.Random(20260923)
    mask = Image.new('L', (SIZE, SIZE), 0)
    pixels = mask.load()
    for y in range(290, 680):
        for x in range(120, 905):
            u = (x - 512) / 365
            v = (y - (482 - 66 * u * u)) / (75 * (1 - 0.30 * abs(u)))
            d = u * u + v * v
            pixels[x, y] = round(210 * max(0.0, min(1.0, (1.0 - d) * 8)))
    normal = Image.new('RGB', (SIZE, SIZE), (128, 128, 255))
    height = Image.new('L', (SIZE, SIZE), 128)
    hp = height.load()
    rough = Image.new('L', (SIZE, SIZE), 168)
    metal = Image.new('L', (SIZE, SIZE), 0)
    flecks = Image.new('L', (SIZE, SIZE), 0)
    nd, rd, md, ed = map(ImageDraw.Draw, (normal, rough, metal, flecks))
    accepted = 0
    for _ in range(5400):
        x, y = rng.randrange(135, 890), rng.randrange(315, 660)
        if mask.getpixel((x, y)) < 110:
            continue
        radius = rng.choices((2.0, 3.4, 5.3, 8.0), weights=(3, 5, 4, 1))[0]
        sides = rng.choice((3, 4))
        angle = rng.random() * math.tau
        points = [(round(x + radius * rng.uniform(.72, 1.12) * math.cos(angle + i * math.tau / sides)),
                   round(y + radius * rng.uniform(.72, 1.12) * math.sin(angle + i * math.tau / sides))) for i in range(sides)]
        tilt = rng.random() * math.tau
        slope = rng.uniform(.22, .73)
        nx, ny = slope * math.cos(tilt), slope * math.sin(tilt)
        nd.polygon(points, fill=(round(127.5 * (nx + 1)), round(127.5 * (ny + 1)), 255))
        left, right = max(0, min(p[0] for p in points)), min(SIZE - 1, max(p[0] for p in points))
        top, bottom = max(0, min(p[1] for p in points)), min(SIZE - 1, max(p[1] for p in points))
        local = Image.new('1', (right - left + 1, bottom - top + 1), 0)
        ImageDraw.Draw(local).polygon([(px - left, py - top) for px, py in points], fill=1)
        lp = local.load()
        for yy in range(top, bottom + 1):
            for xx in range(left, right + 1):
                if lp[xx - left, yy - top]:
                    along = (xx - x) * math.cos(tilt) + (yy - y) * math.sin(tilt)
                    hp[xx, yy] = max(0, min(255, round(128 + 12 * along)))
        rd.polygon(points, fill=rng.randrange(38, 105))
        md.polygon(points, fill=rng.randrange(180, 246))
        if accepted % 7 == 0:
            ed.polygon(points, fill=rng.randrange(125, 211))
        accepted += 1
    flecks = ImageChops.multiply(flecks, mask)
    inputs = OUT / 'input'
    for group in ('colour', 'normal', 'scalar'):
        (inputs / group).mkdir(parents=True, exist_ok=True)
    square_root = mask.point([round(math.sqrt(i / 255) * 255) for i in range(256)])
    pigment = Image.merge('RGBA', (Image.new('L', mask.size, 65), Image.new('L', mask.size, 35),
                                   Image.new('L', mask.size, 85), square_root))
    pigment.save(inputs / 'colour/xfs_glitter_pigment.png')
    normal.save(inputs / 'normal/xfs_glitter_facet_normal.png')
    axial_normal_from_height(height).save(inputs / 'normal/xfs_glitter_axial_normal.png')
    (OUT / 'diagnostic').mkdir(parents=True, exist_ok=True)
    height.save(OUT / 'diagnostic/xfs_glitter_axial_height.png')
    for name, image in [('shape', mask), ('roughness', rough), ('metalness', metal), ('emissive_mask', flecks)]:
        image.save(inputs / 'scalar' / f'xfs_glitter_{name}.png')
    return accepted


def build(paths):
    validate_templates(paths)
    if not CLI.is_file():
        raise FileNotFoundError(CLI)
    generate_pixels()
    archive = OUT / 'archive' / DEPOT
    for folder in ('roundtrip', 'export', 'mi-json'):
        (OUT / folder).mkdir(parents=True, exist_ok=True)
    archive.mkdir(parents=True, exist_ok=True)
    common = {'GenerateMipMaps': True, 'IsStreamable': True, 'PremultiplyAlpha': False}
    for group, settings in {
        'colour': dict(IsGamma=True, TextureGroup='TEXG_Generic_Color', RawFormat='TRF_TrueColor', Compression='TCM_QualityColor'),
        'normal': dict(IsGamma=False, TextureGroup='TEXG_Generic_Normal', RawFormat='TRF_TrueColor', Compression='TCM_Normalmap'),
        'scalar': dict(IsGamma=False, TextureGroup='TEXG_Generic_Grayscale', RawFormat='TRF_Grayscale', Compression='TCM_QualityR'),
    }.items():
        run('import-' + group, ['import', OUT / 'input' / group, '-o', archive], common | settings)
    for name, doc in materials().items():
        save(OUT / 'mi-json' / (name + '.mi.json'), doc)
    run('deserialize-materials', ['convert', 'deserialize', OUT / 'mi-json', '-o', archive])
    run('serialize-resources', ['convert', 'serialize', archive, '-o', OUT / 'roundtrip'])
    run('export-textures', ['export', archive, '-o', OUT / 'export', '--uext', 'png', '--gamepath', GAME])
    verify(paths)


def values(root):
    return {key: value for item in root['values'] for key, value in item.items() if key != '$type'}


def verify(paths):
    template_evidence = validate_templates(paths)
    material_evidence = {}
    for name, expected_doc in materials().items():
        binary = OUT / 'archive' / DEPOT / (name + '.mi')
        expected = expected_doc['Data']['RootChunk']
        converted = load(OUT / 'roundtrip' / (name + '.mi.json'))['Data']['RootChunk']
        assert converted['baseMaterial'] == expected['baseMaterial']
        actual_values, wanted_values = values(converted), values(expected)
        assert actual_values.keys() == wanted_values.keys()
        for key, wanted in wanted_values.items():
            actual = actual_values[key]
            if isinstance(wanted, (int, float)):
                assert math.isclose(actual, wanted, abs_tol=1e-6), key
            else:
                assert actual == wanted, key
            if isinstance(wanted, dict) and 'DepotPath' in wanted:
                local = OUT / 'archive' / wanted['DepotPath']['$value'].replace('\\', '/')
                assert local.is_file(), (key, local)
        assert binary.is_file() and binary.name.startswith('xfs_')
        material_evidence[name] = {'sha256': sha(binary), 'base': expected['baseMaterial']['DepotPath']['$value']}
    textures = {}
    wanted = Image.open(OUT / 'input/scalar/xfs_glitter_shape.png').getchannel('L').tobytes()
    covered_count = sum(cover >= 128 for cover in wanted)
    for source in sorted((OUT / 'input').glob('*/*.png')):
        name = source.stem
        binary = OUT / 'archive' / DEPOT / (name + '.xbm')
        root = load(OUT / 'roundtrip' / (name + '.xbm.json'))['Data']['RootChunk']
        setup = root['setup']
        group = source.parent.name
        expected_compression = {'colour': 'TCM_QualityColor', 'normal': 'TCM_Normalmap', 'scalar': 'TCM_QualityR'}[group]
        assert name.startswith('xfs_') and binary.is_file()
        assert root['width'] == root['height'] == SIZE
        assert setup['compression'] == expected_compression and setup['hasMipchain'] == 1
        assert setup['isGamma'] == int(group == 'colour')
        decoded = Image.open(OUT / 'export' / (name + '.png')).convert('RGBA')
        original = Image.open(source).convert('RGBA')
        assert decoded.size == (SIZE, SIZE)
        red_error = None
        if group == 'scalar':
            red_error = sum(abs(a - b) for a, b in zip(decoded.getchannel('R').tobytes(), original.getchannel('R').tobytes())) / (SIZE * SIZE)
            assert red_error < 3.0, (name, red_error)
        textures[name] = {'sha256': sha(binary), 'compression': expected_compression,
                          'mipchainFlag': True, 'isGamma': bool(setup['isGamma'])}
        if red_error is not None:
            textures[name]['decodedRedMeanByteError'] = red_error
        if group == 'normal':
            channel_errors = [sum(abs(a - b) for a, b in zip(decoded.getchannel(channel).tobytes(),
                                                              original.getchannel(channel).tobytes())) / (SIZE * SIZE)
                              for channel in ('R', 'G')]
            textures[name]['decodedTangentMeanAbsByteError'] = channel_errors
            covered_errors = [sum(abs(a - b) for a, b, cover in zip(decoded.getchannel(channel).tobytes(),
                                                                      original.getchannel(channel).tobytes(), wanted)
                                  if cover >= 128) / covered_count
                              for channel in ('R', 'G')]
            textures[name]['decodedTangentCoveredMeanAbsByteError'] = covered_errors
    decoded_alpha = Image.open(OUT / 'export/xfs_glitter_pigment.png').convert('RGBA').getchannel('A').tobytes()
    edge = [abs((a / 255) ** 2 - b / 255) for a, b in zip(decoded_alpha, wanted) if 0 < b < 255]
    assert edge and sum(edge) / len(edge) < .035
    decoded_emission = Image.open(OUT / 'export/xfs_glitter_emissive_mask.png').convert('RGBA').getchannel('R').tobytes()
    leak = sum(1 for a, b in zip(decoded_emission, wanted) if b == 0 and a > 8)
    assert leak == 0, f'emissive bleed outside pigment: {leak} texels'
    # PIL BOX is a diagnostic source-map minification, not REDengine's decoded mip chain.
    mip = []
    normal_mip = {}
    emission = Image.open(OUT / 'input/scalar/xfs_glitter_emissive_mask.png').getchannel('L')
    shape = Image.open(OUT / 'input/scalar/xfs_glitter_shape.png').getchannel('L')
    for size in (1024, 512, 256, 128, 64):
        reduced = emission.resize((size, size), Image.Resampling.BOX)
        data = reduced.tobytes()
        mip.append({'size': size, 'nonzeroFraction': sum(v > 0 for v in data) / len(data),
                    'highContrastFraction': sum(v >= 96 for v in data) / len(data)})
    coverage_by_size = {size: shape.resize((size, size), Image.Resampling.BOX).tobytes()
                        for size in (1024, 512, 256, 128, 64)}
    for name in ('xfs_glitter_facet_normal', 'xfs_glitter_axial_normal'):
        normal = Image.open(OUT / 'input/normal' / (name + '.png')).convert('RGB')
        measurements = []
        for size, coverage in coverage_by_size.items():
            n = normal.resize((size, size), Image.Resampling.BOX)
            r, g = n.getchannel('R').tobytes(), n.getchannel('G').tobytes()
            slopes = [math.hypot(2 * r[i] / 255 - 1, 2 * g[i] / 255 - 1)
                      for i, v in enumerate(coverage) if v >= 128]
            assert slopes
            measurements.append({'size': size, 'coveredPixels': len(slopes),
                                 'meanTangentSlope': sum(slopes) / len(slopes),
                                 'strongTiltFraction': sum(v >= .25 for v in slopes) / len(slopes)})
        normal_mip[name] = measurements
    report = {'status': 'offline material-only comparison', 'gameVersion': 2310,
              'templates': template_evidence, 'materials': material_evidence, 'textures': textures,
              'partialCoverageTexels': len(edge), 'meanPartialCoverageError': sum(edge) / len(edge),
              'emissiveOutsideShapeTexels': leak, 'sourceBoxMinification': mip,
              'sourceBoxNormalTilt': normal_mip,
              'comparisons': ['Off', 'flat-normal PBR', 'axial-height PBR', 'emission only',
                              'flat-normal PBR plus emission (two components)',
                              'axial-height PBR plus emission (two components)'],
              'meshBound': False, 'selectorRegistered': False, 'gameRendered': False,
              'limit': 'BOX minification is source-map diagnostic, not decoded REDengine mip data; material order, glow, and appearance are unverified.'}
    save(OUT / 'verification.json', report)
    save(HERE / 'result.json', report)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--build', action='store_true')
    mode.add_argument('--verify', action='store_true')
    parser.add_argument('--pbr-template', required=True, type=Path)
    parser.add_argument('--emissive-template', required=True, type=Path)
    args = parser.parse_args()
    paths = {'mesh_decal': args.pbr_template,
             'mesh_decal_emissive_subsurface': args.emissive_template}
    (build if args.build else verify)(paths)
