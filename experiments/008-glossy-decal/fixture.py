"""Recipe-driven Glossy material study; never package, register or install it."""
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
HQ = HERE.parents[1]
OUT = HERE / 'generated'
CLI = Path('F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe')
BUN = Path('C:/Users/Nathan/.bun/bin/bun.exe')
TEMPLATE_SHA = 'ddfacaf5894b6aba9cfde35d796ccad415d5db16d6c8e4851d7f3875d8266bbe'
TEMPLATE_DATA_SHA = '37c35987e6a6eea23ba52834b8e36b74d38436907717f9c4a77a84ae35aa4e19'
DEPOT = 'axefrog/appearance_studio/studies/glossy'
NAME = 'xfs_glossy_recipe_single_lobe'
ROUGHNESS_BYTE = round(.16 * 255)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def run(name, command, settings=None):
    env = os.environ.copy()
    for key, value in (settings or {}).items():
        env['XbmImportArgs__' + key] = str(value).lower() if isinstance(value, bool) else str(value)
    result = subprocess.run([str(item) for item in command], cwd=HQ, env=env,
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=240)
    log = result.stdout + '\n' + result.stderr
    (OUT / 'logs').mkdir(parents=True, exist_ok=True)
    (OUT / 'logs' / (name + '.log')).write_text(log, encoding='utf-8')
    counts = re.search(r'Imported (\d+)/(\d+) file\(s\)', log)
    imported = name.startswith('import-') and result.returncode == 3 and counts and counts[1] == counts[2] and int(counts[1]) > 0
    if (result.returncode != 0 and not imported) or re.search(r'\bError\s*\]|Unhandled exception|Traceback \(', log):
        raise RuntimeError(f'{name} failed (exit {result.returncode}); see {OUT / "logs" / (name + ".log")}')


def cname(value):
    return {'$type': 'CName', '$storage': 'string', '$value': value}


def ref(path):
    return {'DepotPath': {'$type': 'ResourcePath', '$storage': 'string', '$value': path.replace('/', '\\')}, 'Flags': 'Default'}


def texture(key, suffix):
    return {'$type': 'rRef:ITexture', key: ref(f'{DEPOT}/{NAME}_{suffix}.xbm')}


def scalar(key, value):
    return {'$type': 'Float', key: value}


def make_material():
    values = [texture('DiffuseTexture', 'diffuse'), texture('RoughnessTexture', 'roughness'),
              texture('MetalnessTexture', 'metalness'),
              {'$type': 'Color', 'DiffuseColor': {'$type': 'Color', 'Red': 255, 'Green': 255, 'Blue': 255, 'Alpha': 255}}]
    values += [scalar(key, value) for key, value in {
        'DiffuseAlpha': 1, 'RoughnessMetalnessAlpha': 1,
        'RoughnessScale': 1, 'RoughnessBias': 0,
        'MetalnessScale': 1, 'MetalnessBias': 0,
        'NormalAlpha': 0, 'AlphaMaskContrast': 0, 'SecondaryMaskInfluence': 0,
        'FresnelColorIntensity': 0,
    }.items()]
    root = {'$type': 'CMaterialInstance', 'audioTag': cname('None'),
            'baseMaterial': ref('base/materials/mesh_decal_blendable.mt'),
            'cookingPlatform': 'PLATFORM_PC', 'enableMask': 0, 'resourceVersion': 4,
            'values': values}
    return {'Header': {'WolvenKitVersion': '8.17.4', 'WKitJsonVersion': '0.0.9',
                       'GameVersion': 2310, 'DataType': 'CR2W'},
            'Data': {'Version': 195, 'BuildVersion': 0, 'RootChunk': root, 'EmbeddedFiles': []}}


def verify_template(binary, serialized):
    if not binary.is_file() or sha(binary) != TEMPLATE_SHA:
        raise ValueError('Supply the exact audited Cyberpunk 2.31 mesh_decal_blendable.mt binary')
    if not serialized.is_file():
        raise FileNotFoundError('Serialize the audited 2.31 template locally')
    inspected = read(serialized)
    assert inspected['Header']['GameVersion'] == 2310
    data_sha = hashlib.sha256(json.dumps(inspected['Data'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    assert data_sha == TEMPLATE_DATA_SHA, 'Serialized template body does not match the audited 2.31 resource'
    material_template = inspected['Data']['RootChunk']
    assert material_template['name']['$value'] == 'mesh_decal_blendable'
    assert 'MVF_MeshSkinned' in material_template['vertexFactories']
    passes = [p for technique in material_template['techniques'] for p in technique['passes']
              if p['stagePassNameRegular']['$value'] == 'renderstage_post_gbuffer']
    assert passes and any(p['depthStencilMode']['depthWriteEnable'] == 0 and
                          any(t['blendEnable'] for t in p['blendMode']['renderTarget']['Elements'][:p['blendMode']['numTargets']])
                          for p in passes)
    available = {item['name']['$value'] for group in material_template['parameterInfo'] for item in group}
    assert set(parameters(make_material()['Data']['RootChunk'])).issubset(available)
    return {'binarySha256': TEMPLATE_SHA, 'serializedDataSha256': TEMPLATE_DATA_SHA,
            'jsonSha256': sha(serialized), 'gameVersion': 2310,
            'pass': 'MeshSkinned renderstage_post_gbuffer'}


def build(args):
    template = verify_template(args.template, args.template_json)
    if not CLI.is_file() or not BUN.is_file():
        raise FileNotFoundError('WolvenKit CLI and Bun are required at the documented local paths')
    run('bake-recipe', [BUN, HERE / 'recipe-inputs.ts', args.recipe, args.layer, OUT / 'raw', args.size])
    source = read(OUT / 'raw' / 'source.json')
    image = Image.frombytes('RGBA', (args.size, args.size), (OUT / 'raw' / 'shape.rgba').read_bytes())
    mask = image.getchannel('A')
    diffuse_alpha = mask.point([round(math.sqrt(i / 255) * 255) for i in range(256)])
    color = source['color'].lstrip('#')
    rgb = tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))
    inputs = OUT / 'input'
    for group in ('colour', 'scalar'):
        (inputs / group).mkdir(parents=True, exist_ok=True)
    Image.merge('RGBA', (*(Image.new('L', mask.size, value) for value in rgb), diffuse_alpha)).save(inputs / 'colour' / f'{NAME}_diffuse.png')
    Image.new('L', mask.size, ROUGHNESS_BYTE).save(inputs / 'scalar' / f'{NAME}_roughness.png')
    Image.new('L', mask.size, 0).save(inputs / 'scalar' / f'{NAME}_metalness.png')
    archive = OUT / 'archive' / DEPOT
    archive.mkdir(parents=True, exist_ok=True)
    for folder in ('roundtrip', 'export', 'export-dds'):
        (OUT / folder).mkdir(parents=True, exist_ok=True)
    common = {'GenerateMipMaps': True, 'IsStreamable': True, 'PremultiplyAlpha': False}
    run('import-colour', [CLI, 'import', inputs / 'colour', '-o', archive],
        dict(common, IsGamma=True, TextureGroup='TEXG_Generic_Color', RawFormat='TRF_TrueColor', Compression='TCM_QualityColor'))
    run('import-scalar', [CLI, 'import', inputs / 'scalar', '-o', archive],
        dict(common, IsGamma=False, TextureGroup='TEXG_Generic_Grayscale', RawFormat='TRF_Grayscale', Compression='TCM_QualityR'))
    write(OUT / 'mi-json' / (NAME + '.mi.json'), make_material())
    run('deserialize-material', [CLI, 'convert', 'deserialize', OUT / 'mi-json', '-o', archive])
    run('serialize-resources', [CLI, 'convert', 'serialize', archive, '-o', OUT / 'roundtrip'])
    run('export-textures', [CLI, 'export', archive, '-o', OUT / 'export', '--uext', 'png',
                            '--gamepath', 'F:/Games/Cyberpunk 2077'])
    run('export-texture-mips', [CLI, 'export', archive, '-o', OUT / 'export-dds', '--uext', 'dds',
                               '--gamepath', 'F:/Games/Cyberpunk 2077'])
    verify(args, template)


def parameters(material):
    return {key: value for item in material['values'] for key, value in item.items() if key != '$type'}


def dds_levels(path, stride, size, format_code):
    """WolvenKit's decoded RGBA/R DDS export, including every stored XBM mip."""
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


def mip_measurements(size, shape):
    diffuse = dds_levels(OUT / 'export-dds' / f'{NAME}_diffuse.dds', 4, size, 29)
    rough = dds_levels(OUT / 'export-dds' / f'{NAME}_roughness.dds', 1, size, 61)
    metal = dds_levels(OUT / 'export-dds' / f'{NAME}_metalness.dds', 1, size, 61)
    records = []
    encoded_shape = shape.point([round(math.sqrt(i / 255) * 255) for i in range(256)])
    for side in diffuse:
        source = shape.resize((side, side), Image.Resampling.BOX).tobytes()
        encoded_box = encoded_shape.resize((side, side), Image.Resampling.BOX).tobytes()
        decoded = diffuse[side]
        errors = [abs((decoded[4 * i + 3] / 255) ** 2 - value / 255) for i, value in enumerate(source)]
        source_mean = sum(source) / (255 * len(source))
        encoded_box_mean = sum((value / 255) ** 2 for value in encoded_box) / len(source)
        decoded_mean = sum((decoded[4 * i + 3] / 255) ** 2 for i in range(len(source))) / len(source)
        rough_error = sum(abs(v - ROUGHNESS_BYTE) for v in rough[side]) / len(rough[side])
        metal_error = sum(metal[side]) / len(metal[side])
        assert rough_error < 2 and metal_error < 2, side
        records.append({'size': side, 'sourceMeanCoverage': source_mean,
                        'sourceBoxOfEncodedAlphaSquaredMeanCoverage': encoded_box_mean,
                        'decodedMeanSquaredAlphaCoverage': decoded_mean,
                        'decodedCoverageRetention': decoded_mean / source_mean if source_mean else None,
                        'meanAbsoluteCoverageError': sum(errors) / len(errors),
                        'maxAbsoluteCoverageError': max(errors),
                        'roughnessMeanByteError': rough_error, 'metalnessMeanByteError': metal_error})
    return records


def verify(args, template=None):
    template = template or verify_template(args.template, args.template_json)
    if not BUN.is_file():
        raise FileNotFoundError('Bun is required to independently re-bake the selected recipe')
    run('rebake-recipe', [BUN, HERE / 'recipe-inputs.ts', args.recipe, args.layer, OUT / 'raw-verify', args.size])
    original = make_material()['Data']['RootChunk']
    converted = read(OUT / 'roundtrip' / (NAME + '.mi.json'))['Data']['RootChunk']
    assert converted['baseMaterial'] == original['baseMaterial']
    actual = parameters(converted)
    expected = parameters(original)
    assert actual.keys() == expected.keys()
    for key in expected:
        if isinstance(expected[key], float) or type(expected[key]) is int:
            assert math.isclose(actual[key], expected[key], rel_tol=1e-6, abs_tol=1e-8), key
        else:
            assert actual[key] == expected[key], key
    assert actual['DiffuseAlpha'] == 1 and actual['RoughnessMetalnessAlpha'] == 1
    assert actual['NormalAlpha'] == 0 and actual['MetalnessScale'] == 1
    assert actual['FresnelColorIntensity'] == 0
    size = args.size
    source_meta = read(OUT / 'raw' / 'source.json')
    shape_path = OUT / 'raw' / 'shape.rgba'
    assert source_meta['size'] == size and source_meta['layerId'] == args.layer and sha(shape_path) == source_meta['shapeSha256']
    assert source_meta == read(OUT / 'raw-verify' / 'source.json')
    assert shape_path.read_bytes() == (OUT / 'raw-verify' / 'shape.rgba').read_bytes()
    pixels = {}
    for suffix in ('diffuse', 'roughness', 'metalness'):
        name = f'{NAME}_{suffix}'
        binary = OUT / 'archive' / DEPOT / (name + '.xbm')
        assert actual[suffix.capitalize() + 'Texture']['DepotPath']['$value'].replace('\\', '/') == f'{DEPOT}/{name}.xbm'
        data = read(OUT / 'roundtrip' / (name + '.xbm.json'))['Data']['RootChunk']
        setup = data['setup']
        assert binary.is_file() and data['width'] == data['height'] == size
        assert setup['hasMipchain'] == 1 and setup['isGamma'] == int(suffix == 'diffuse')
        assert setup['compression'] == ('TCM_QualityColor' if suffix == 'diffuse' else 'TCM_QualityR')
        decoded = Image.open(OUT / 'export' / (name + '.png')).convert('RGBA')
        source = Image.open(OUT / 'input' / ('colour' if suffix == 'diffuse' else 'scalar') / (name + '.png')).convert('RGBA')
        assert decoded.size == source.size == (size, size)
        if suffix != 'diffuse':
            error = sum(abs(a - b) for a, b in zip(decoded.getchannel('R').tobytes(), source.getchannel('R').tobytes())) / (size * size)
            assert error < 2, (suffix, error)
        else:
            error = None
            decoded_rgb = decoded.convert('RGB').tobytes()
            source_rgb = source.convert('RGB').tobytes()
            color_error = sum(abs(a - b) for a, b in zip(decoded_rgb, source_rgb)) / len(source_rgb)
            assert color_error < 4, color_error
        pixels[suffix] = {'xbmSha256': sha(binary), 'inputSha256': sha(OUT / 'input' / ('colour' if suffix == 'diffuse' else 'scalar') / (name + '.png')),
                          'compression': setup['compression']}
        if error is not None:
            pixels[suffix]['meanDecodedRedByteError'] = error
        else:
            pixels[suffix]['meanDecodedRgbByteError'] = color_error
    source_mask = Image.frombytes('RGBA', (size, size), shape_path.read_bytes()).getchannel('A')
    source_diffuse = Image.open(OUT / 'input' / 'colour' / f'{NAME}_diffuse.png').convert('RGBA')
    color = source_meta['color'].lstrip('#')
    for channel, value in zip('RGB', (int(color[i:i + 2], 16) for i in (0, 2, 4))):
        assert source_diffuse.getchannel(channel).getextrema() == (value, value)
    assert source_diffuse.getchannel('A').tobytes() == source_mask.point(
        [round(math.sqrt(i / 255) * 255) for i in range(256)]).tobytes()
    assert Image.open(OUT / 'input' / 'scalar' / f'{NAME}_roughness.png').getextrema() == (ROUGHNESS_BYTE, ROUGHNESS_BYTE)
    assert Image.open(OUT / 'input' / 'scalar' / f'{NAME}_metalness.png').getextrema() == (0, 0)
    decoded_alpha = Image.open(OUT / 'export' / f'{NAME}_diffuse.png').convert('RGBA').getchannel('A')
    desired = source_mask.tobytes()
    decoded = decoded_alpha.tobytes()
    errors = [abs((a / 255) ** 2 - b / 255) for a, b in zip(decoded, desired)]
    active = [error for error, wanted in zip(errors, desired) if 0 < wanted < 255]
    assert active and sum(active) / len(active) < 0.035, 'Decoded edge coverage is too far from the test mask'
    assert max(desired) > 0 and min(desired) == 0
    report = {'status': 'offline recipe-driven Glossy single-lobe material study',
              'source': source_meta, 'template': template,
              'materialSha256': sha(OUT / 'archive' / DEPOT / (NAME + '.mi')),
              'textures': pixels, 'partialCoverageTexels': len(active),
              'meanPartialCoverageError': sum(active) / len(active),
              'decodedXbmMipCoverage': mip_measurements(size, source_mask),
              'roughnessByte': ROUGHNESS_BYTE, 'metalnessByte': 0,
              'browserGlossy': {'baseRoughness': .16, 'metalness': 0, 'clearcoat': 1, 'clearcoatRoughness': .08},
              'gameCandidate': {'surfaceRoughness': ROUGHNESS_BYTE / 255, 'metalness': 0,
                                'DiffuseAlpha': 1, 'RoughnessMetalnessAlpha': 1,
                                'independentCoatLobe': False, 'coatRoughnessParameter': None},
              'parameterTransfer': {'baseRoughnessAbsoluteQuantizationError': abs(ROUGHNESS_BYTE / 255 - .16),
                                    'browserReflectionLobes': 2, 'candidateReflectionLobes': 1,
                                    'unmappedClearcoatStrength': 1, 'unmappedCoatRoughness': .08},
              'productionExportGuardRetained': True,
              'deployed': False, 'gameRendered': False,
              'limitations': ['No mesh, morph, app, selector, archive or runtime binding.',
                              'Colour and roughness share a coverage mask on one G-buffer surface; no independent coat lobe.',
                              'Decoded XBM mip data is not sampler/LOD or screen-pixel evidence.',
                              'Mixed-finish overlap, light response and skin preservation remain unverified.']}
    write(OUT / 'verification.json', report)
    if args.recipe == '--sample':
        write(HERE / 'recipe-result.json', report)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--build', action='store_true', help='Generate and validate local resources; never install')
    mode.add_argument('--verify', action='store_true', help='Validate an earlier local build')
    parser.add_argument('--template', required=True, type=Path,
                        help='Exact extracted 2.31 base/materials/mesh_decal_blendable.mt binary')
    parser.add_argument('--template-json', required=True, type=Path,
                        help='Locally serialized JSON for the same exact 2.31 template')
    parser.add_argument('--recipe', default='--sample', help='Portable Studio recipe JSON, or --sample')
    parser.add_argument('--layer', default='sample-glossy', help='Enabled Glossy layer ID')
    parser.add_argument('--size', type=int, default=1024, help='Power-of-two raster size from 256 to 2048')
    args = parser.parse_args()
    if not 256 <= args.size <= 2048 or args.size & (args.size - 1):
        parser.error('--size must be a power of two from 256 to 2048')
    (build if args.build else verify)(args)
