"""Build a recipe-driven, material-only Shimmer fixture; never install or package it."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / 'generated'
CLI = Path('F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe')
BUN = Path('C:/Users/Nathan/.bun/bin/bun.exe')
TEMPLATE_SHA = 'b1b181b70fd1b16393d626281eeff1d5fc99932f24868e55248d18a1abfbc019'
DEPOT = 'axefrog/appearance_studio/studies/shimmer'
NAME = 'xfs_shimmer_recipe_pbr'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def run(label, command, settings=None):
    env = os.environ.copy()
    for key, value in (settings or {}).items():
        env['XbmImportArgs__' + key] = str(value).lower() if isinstance(value, bool) else str(value)
    result = subprocess.run([str(part) for part in command], cwd=ROOT, env=env,
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300)
    log = result.stdout + '\n' + result.stderr
    (OUT / 'logs').mkdir(parents=True, exist_ok=True)
    (OUT / 'logs' / (label + '.log')).write_text(log, encoding='utf-8')
    counts = re.search(r'Imported (\d+)/(\d+) file\(s\)', log)
    imported = label.startswith('import-') and result.returncode == 3 and counts and counts[1] == counts[2] and int(counts[1]) > 0
    if (result.returncode != 0 and not imported) or re.search(r'\bError\s*\]|Unhandled exception|Traceback \(', log):
        raise RuntimeError(f'{label}: exit {result.returncode}; see {OUT / "logs" / (label + ".log")}')


def ref(path):
    return {'DepotPath': {'$type': 'ResourcePath', '$storage': 'string', '$value': path.replace('/', '\\')}, 'Flags': 'Default'}


def tex(key, suffix):
    return {'$type': 'rRef:ITexture', key: ref(f'{DEPOT}/{NAME}_{suffix}.xbm')}


def scalar(key, value):
    return {'$type': 'Float', key: value}


def material():
    values = [tex('DiffuseTexture', 'diffuse'), tex('NormalTexture', 'normal'),
              tex('NormalAlphaTex', 'normal_alpha'), tex('RoughnessTexture', 'roughness'),
              tex('MetalnessTexture', 'metalness'),
              {'$type': 'Color', 'DiffuseColor': {'$type': 'Color', 'Red': 255, 'Green': 255, 'Blue': 255, 'Alpha': 255}}]
    values += [scalar(key, value) for key, value in {
        'DiffuseAlpha': 1, 'NormalAlpha': 1, 'UseNormalAlphaTex': 1,
        'RoughnessMetalnessAlpha': 1, 'RoughnessScale': 1, 'MetalnessScale': 1,
        'RoughnessBias': 0, 'MetalnessBias': 0, 'AlphaMaskContrast': 0,
        'SecondaryMaskInfluence': 0, 'NormalsBlendingMode': 0,
    }.items()]
    root = {'$type': 'CMaterialInstance', 'audioTag': {'$type': 'CName', '$storage': 'string', '$value': 'None'},
            'baseMaterial': ref('base/materials/mesh_decal.mt'), 'cookingPlatform': 'PLATFORM_PC',
            'enableMask': 0, 'resourceVersion': 4, 'values': values}
    return {'Header': {'WolvenKitVersion': '8.17.4', 'WKitJsonVersion': '0.0.9',
                       'GameVersion': 2310, 'DataType': 'CR2W'},
            'Data': {'Version': 195, 'BuildVersion': 0, 'RootChunk': root, 'EmbeddedFiles': []}}


def params(root):
    return {key: value for entry in root['values'] for key, value in entry.items() if key != '$type'}


def verify_template(binary, serialized):
    if sha(binary) != TEMPLATE_SHA:
        raise ValueError('Supply the exact audited 2.31 mesh_decal.mt binary')
    doc = read(serialized)
    root = doc['Data']['RootChunk']
    assert doc['Header']['GameVersion'] == 2310 and root['name']['$value'] == 'mesh_decal'
    assert 'MVF_MeshSkinned' in root['vertexFactories']
    passes = [p for t in root['techniques'] for p in t['passes']
              if p['stagePassNameRegular']['$value'] == 'renderstage_post_gbuffer']
    assert passes and any(p['depthStencilMode']['depthWriteEnable'] == 0 and
                          any(target['blendEnable'] for target in p['blendMode']['renderTarget']['Elements'][:p['blendMode']['numTargets']])
                          for p in passes)
    available = {p['name']['$value'] for group in root['parameterInfo'] for p in group}
    assert set(params(material()['Data']['RootChunk'])).issubset(available)
    return {'binarySha256': TEMPLATE_SHA, 'jsonSha256': sha(serialized), 'gameVersion': 2310,
            'pass': 'MeshSkinned renderstage_post_gbuffer'}


def source_maps(size):
    raw = OUT / 'raw'
    shape = Image.frombytes('RGBA', (size, size), (raw / 'shape.rgba').read_bytes()).getchannel('A')
    normal = Image.frombytes('RGBA', (size, size), (raw / 'normal.rgba').read_bytes()).convert('RGB')
    surface = Image.frombytes('RGBA', (size, size), (raw / 'surface.rgba').read_bytes())
    colour = read(raw / 'source.json')['color'].lstrip('#')
    rgb = tuple(int(colour[i:i + 2], 16) for i in (0, 2, 4))
    alpha = shape.point([round(math.sqrt(i / 255) * 255) for i in range(256)])
    maps = {'diffuse': Image.merge('RGBA', (*(Image.new('L', shape.size, v) for v in rgb), alpha)),
            'normal': normal, 'normal_alpha': shape,
            'roughness': surface.getchannel('G'), 'metalness': surface.getchannel('B')}
    for name, image in maps.items():
        group = 'colour' if name == 'diffuse' else 'normal' if name == 'normal' else 'scalar'
        path = OUT / 'input' / group / f'{NAME}_{name}.png'
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path)
    return maps


def minification(maps):
    """BOX reduction of source maps; a diagnostic, not decoded XBM mips or screen pixels."""
    records = []
    source_size = maps['normal_alpha'].width
    for size in (source_size, source_size // 2, source_size // 4, source_size // 8, source_size // 16):
        shape = maps['normal_alpha'].resize((size, size), Image.Resampling.BOX).tobytes()
        normal = maps['normal'].resize((size, size), Image.Resampling.BOX).tobytes()
        rough = maps['roughness'].resize((size, size), Image.Resampling.BOX).tobytes()
        metal = maps['metalness'].resize((size, size), Image.Resampling.BOX).tobytes()
        active = [i for i, alpha in enumerate(shape) if alpha >= 128]
        assert active
        slope = [math.hypot(2 * normal[i * 3] / 255 - 1, 2 * normal[i * 3 + 1] / 255 - 1) for i in active]
        records.append({'size': size, 'coveredTexels': len(active),
                        'meanTangentSlope': sum(slope) / len(slope),
                        'strongSlopeFraction': sum(value >= .15 for value in slope) / len(slope),
                        'meanRoughnessByte': sum(rough[i] for i in active) / len(active),
                        'meanMetalnessByte': sum(metal[i] for i in active) / len(active)})
    return records


def dds_levels(path, stride, size, format_code):
    data = path.read_bytes()
    if len(data) < 148 or data[:4] != b'DDS ' or data[84:88] != b'DX10':
        raise ValueError(f'Unexpected DDS header: {path}')
    height, width = struct.unpack_from('<II', data, 12)
    count = struct.unpack_from('<I', data, 28)[0]
    fmt, dimension, _, array_size, _ = struct.unpack_from('<IIIII', data, 128)
    assert height == width == size and count == size.bit_length()
    assert fmt == format_code and dimension == 3 and array_size == 1
    levels, offset = {}, 148
    for index in range(count):
        side = max(1, size >> index)
        length = side * side * stride
        levels[side] = data[offset:offset + length]
        assert len(levels[side]) == length
        offset += length
    assert offset == len(data)
    return levels


def decoded_minification(size):
    paths = OUT / 'export-dds'
    normal = dds_levels(paths / f'{NAME}_normal.dds', 2, size, 49)
    shape = dds_levels(paths / f'{NAME}_normal_alpha.dds', 1, size, 61)
    rough = dds_levels(paths / f'{NAME}_roughness.dds', 1, size, 61)
    metal = dds_levels(paths / f'{NAME}_metalness.dds', 1, size, 61)
    records = []
    for side in (size, size // 2, size // 4, size // 8, size // 16):
        active = [i for i, alpha in enumerate(shape[side]) if alpha >= 128]
        assert active
        slope = [math.hypot(2 * normal[side][i * 2] / 255 - 1,
                            2 * normal[side][i * 2 + 1] / 255 - 1) for i in active]
        records.append({'size': side, 'coveredTexels': len(active),
                        'meanTangentSlope': sum(slope) / len(slope),
                        'strongSlopeFraction': sum(value >= .15 for value in slope) / len(slope),
                        'meanRoughnessByte': sum(rough[side][i] for i in active) / len(active),
                        'meanMetalnessByte': sum(metal[side][i] for i in active) / len(active)})
    return records


def build(args):
    if not CLI.is_file() or not BUN.is_file():
        raise FileNotFoundError('WolvenKit CLI and Bun are required')
    template = verify_template(args.template, args.template_json)
    run('bake-recipe', [BUN, HERE / 'recipe-inputs.ts', args.recipe, args.layer, OUT / 'raw', args.size])
    maps = source_maps(args.size)
    archive = OUT / 'archive' / DEPOT
    archive.mkdir(parents=True, exist_ok=True)
    (OUT / 'roundtrip').mkdir(parents=True, exist_ok=True)
    (OUT / 'export').mkdir(parents=True, exist_ok=True)
    (OUT / 'export-dds').mkdir(parents=True, exist_ok=True)
    common = {'GenerateMipMaps': True, 'IsStreamable': True, 'PremultiplyAlpha': False}
    for group, specific in {
        'colour': {'IsGamma': True, 'TextureGroup': 'TEXG_Generic_Color', 'RawFormat': 'TRF_TrueColor', 'Compression': 'TCM_QualityColor'},
        'normal': {'IsGamma': False, 'TextureGroup': 'TEXG_Generic_Normal', 'RawFormat': 'TRF_TrueColor', 'Compression': 'TCM_Normalmap'},
        'scalar': {'IsGamma': False, 'TextureGroup': 'TEXG_Generic_Grayscale', 'RawFormat': 'TRF_Grayscale', 'Compression': 'TCM_QualityR'},
    }.items():
        run('import-' + group, [CLI, 'import', OUT / 'input' / group, '-o', archive], common | specific)
    write(OUT / 'mi-json' / (NAME + '.mi.json'), material())
    run('deserialize-material', [CLI, 'convert', 'deserialize', OUT / 'mi-json', '-o', archive])
    run('serialize-resources', [CLI, 'convert', 'serialize', archive, '-o', OUT / 'roundtrip'])
    run('export-textures', [CLI, 'export', archive, '-o', OUT / 'export', '--uext', 'png',
                            '--gamepath', 'F:/Games/Cyberpunk 2077'])
    run('export-texture-mips', [CLI, 'export', archive, '-o', OUT / 'export-dds', '--uext', 'dds',
                                '--gamepath', 'F:/Games/Cyberpunk 2077'])
    wanted = material()['Data']['RootChunk']
    actual = read(OUT / 'roundtrip' / (NAME + '.mi.json'))['Data']['RootChunk']
    assert actual['baseMaterial'] == wanted['baseMaterial']
    expected_values, actual_values = params(wanted), params(actual)
    assert expected_values.keys() == actual_values.keys()
    for key, expected in expected_values.items():
        observed = actual_values[key]
        if isinstance(expected, (int, float)):
            assert math.isclose(observed, expected, rel_tol=1e-6, abs_tol=1e-8), key
        else:
            assert observed == expected, key
    textures = {}
    for name, image in maps.items():
        binary = archive / f'{NAME}_{name}.xbm'
        root = read(OUT / 'roundtrip' / f'{NAME}_{name}.xbm.json')['Data']['RootChunk']
        setup = root['setup']
        group = 'colour' if name == 'diffuse' else 'normal' if name == 'normal' else 'scalar'
        compression = {'colour': 'TCM_QualityColor', 'normal': 'TCM_Normalmap', 'scalar': 'TCM_QualityR'}[group]
        assert root['width'] == root['height'] == args.size and setup['hasMipchain'] == 1
        assert setup['compression'] == compression and setup['isGamma'] == int(group == 'colour')
        decoded = Image.open(OUT / 'export' / f'{NAME}_{name}.png').convert('RGBA')
        assert decoded.size == image.size
        red_error = sum(abs(a-b) for a, b in zip(decoded.getchannel('R').tobytes(),
                        image.convert('RGBA').getchannel('R').tobytes())) / (args.size * args.size)
        assert red_error < 4, (name, red_error)
        textures[name] = {'xbmSha256': sha(binary), 'compression': compression,
                          'decodedBaseRedMeanByteError': red_error}
    for suffix, key in [('diffuse', 'DiffuseTexture'), ('normal', 'NormalTexture'),
                        ('normal_alpha', 'NormalAlphaTex'), ('roughness', 'RoughnessTexture'), ('metalness', 'MetalnessTexture')]:
        assert actual_values[key]['DepotPath']['$value'].replace('\\', '/') == f'{DEPOT}/{NAME}_{suffix}.xbm'
    source_shape = maps['normal_alpha'].tobytes()
    decoded_alpha = Image.open(OUT / 'export' / f'{NAME}_diffuse.png').convert('RGBA').getchannel('A').tobytes()
    partial = [abs((decoded_alpha[i] / 255) ** 2 - value / 255) for i, value in enumerate(source_shape) if 0 < value < 255]
    assert partial and sum(partial) / len(partial) < .035
    report = {'status': 'offline recipe-driven Shimmer material fixture', 'source': read(OUT / 'raw' / 'source.json'),
              'template': template, 'materialSha256': sha(archive / f'{NAME}.mi'), 'textures': textures,
              'partialCoverageTexels': len(partial), 'meanPartialCoverageError': sum(partial) / len(partial),
              'sourceBoxMinification': minification(maps), 'decodedXbmMipMinification': decoded_minification(args.size),
              'productionExportGuardRetained': True,
              'gameRendered': False, 'deployed': False,
              'limitations': ['No mesh, morph, app, selector or archive binding.',
                              'Normal green sign and blend mode on the eye plate remain uncalibrated.',
                              'Decoded XBM mip statistics are not runtime sampler/LOD or screen-pixel evidence.',
                              'Stock decal blends one PBR surface; browser transparent-surface lighting is not equivalent.']}
    write(OUT / 'result.json', report)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--template', type=Path, required=True)
    parser.add_argument('--template-json', type=Path, required=True)
    parser.add_argument('--recipe', default='--sample')
    parser.add_argument('--layer', default='sample-shimmer')
    parser.add_argument('--size', type=int, default=1024)
    build(parser.parse_args())
