"""Opt-in offline material fixture. It cannot package, register, or install a mod.

Requires a caller-supplied, SHA-pinned Cyberpunk 2.31 material template. The
test mask comes from the studio's checked-in initial recipe, not a user draft.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess

from PIL import Image

HERE = Path(__file__).resolve().parent
HQ = HERE.parents[1]
OUT = HERE / 'generated'
CLI = Path('F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe')
BUN = Path('C:/Users/Nathan/.bun/bin/bun.exe')
TEMPLATE_SHA = 'ddfacaf5894b6aba9cfde35d796ccad415d5db16d6c8e4851d7f3875d8266bbe'
DEPOT = 'axefrog/appearance_studio/studies/glossy'
NAME = 'xfs_glossy_single_lobe'
SIZE = 1024


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
        'DiffuseAlpha': 0, 'RoughnessMetalnessAlpha': 1,
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


def build(template):
    if not template.is_file() or sha(template) != TEMPLATE_SHA:
        raise ValueError('Supply the exact audited Cyberpunk 2.31 mesh_decal_blendable.mt binary')
    if not CLI.is_file() or not BUN.is_file():
        raise FileNotFoundError('WolvenKit CLI and Bun are required at the documented local paths')
    # The studio tool is pinned to the checked-in initial recipe. Its output is
    # generated inside this worktree and contains no personal authored design.
    run('bake-mask', [BUN, HQ / 'projects/xf-appearance-studio/authoring/tools/bake_decal_inputs.ts'])
    source = HERE.parent / '003-decal-material-import/generated/shape.rgba'
    image = Image.frombytes('RGBA', (SIZE, SIZE), source.read_bytes())
    mask = image.getchannel('A')
    if mask.getextrema()[0] == mask.getextrema()[1]:
        raise AssertionError('The test mask must contain both covered and uncovered texels')
    diffuse_alpha = mask.point([round(math.sqrt(i / 255) * 255) for i in range(256)])
    white = Image.new('L', mask.size, 255)
    inputs = OUT / 'input'
    for group in ('colour', 'scalar'):
        (inputs / group).mkdir(parents=True, exist_ok=True)
    Image.merge('RGBA', (white, white, white, diffuse_alpha)).save(inputs / 'colour' / f'{NAME}_diffuse.png')
    Image.new('L', mask.size, 20).save(inputs / 'scalar' / f'{NAME}_roughness.png')
    Image.new('L', mask.size, 0).save(inputs / 'scalar' / f'{NAME}_metalness.png')
    archive = OUT / 'archive' / DEPOT
    archive.mkdir(parents=True, exist_ok=True)
    for folder in ('roundtrip', 'export'):
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
    verify(template)


def parameters(material):
    return {key: value for item in material['values'] for key, value in item.items() if key != '$type'}


def verify(template):
    if not template.is_file() or sha(template) != TEMPLATE_SHA:
        raise ValueError('The audited 2.31 template is required for verification too')
    template_json = template.with_name(template.name + '.json')
    if not template_json.is_file():
        raise FileNotFoundError('Serialize the audited template beside the binary before verification')
    inspected = read(template_json)
    assert inspected['Header']['GameVersion'] == 2310
    material_template = inspected['Data']['RootChunk']
    assert material_template['name']['$value'] == 'mesh_decal_blendable'
    assert 'MVF_MeshSkinned' in material_template['vertexFactories']
    assert any(p['stagePassNameRegular']['$value'] == 'renderstage_post_gbuffer'
               for technique in material_template['techniques'] for p in technique['passes'])
    available = {item['name']['$value'] for group in material_template['parameterInfo'] for item in group}
    assert set(parameters(make_material()['Data']['RootChunk'])).issubset(available)
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
    assert actual['DiffuseAlpha'] == 0 and actual['RoughnessMetalnessAlpha'] == 1
    assert actual['NormalAlpha'] == 0 and actual['MetalnessScale'] == 1
    assert actual['FresnelColorIntensity'] == 0
    pixels = {}
    for suffix in ('diffuse', 'roughness', 'metalness'):
        name = f'{NAME}_{suffix}'
        binary = OUT / 'archive' / DEPOT / (name + '.xbm')
        assert actual[suffix.capitalize() + 'Texture']['DepotPath']['$value'].replace('\\', '/') == f'{DEPOT}/{name}.xbm'
        data = read(OUT / 'roundtrip' / (name + '.xbm.json'))['Data']['RootChunk']
        setup = data['setup']
        assert binary.is_file() and data['width'] == data['height'] == SIZE
        assert setup['hasMipchain'] == 1 and setup['isGamma'] == int(suffix == 'diffuse')
        assert setup['compression'] == ('TCM_QualityColor' if suffix == 'diffuse' else 'TCM_QualityR')
        decoded = Image.open(OUT / 'export' / (name + '.png')).convert('RGBA')
        source = Image.open(OUT / 'input' / ('colour' if suffix == 'diffuse' else 'scalar') / (name + '.png')).convert('RGBA')
        assert decoded.size == source.size == (SIZE, SIZE)
        if suffix != 'diffuse':
            error = sum(abs(a - b) for a, b in zip(decoded.getchannel('R').tobytes(), source.getchannel('R').tobytes())) / (SIZE * SIZE)
            assert error < 2, (suffix, error)
        else:
            error = None
        pixels[suffix] = {'xbmSha256': sha(binary), 'inputSha256': sha(OUT / 'input' / ('colour' if suffix == 'diffuse' else 'scalar') / (name + '.png'))}
        if error is not None:
            pixels[suffix]['meanDecodedRedByteError'] = error
    source_mask = Image.frombytes('RGBA', (SIZE, SIZE), (HERE.parent / '003-decal-material-import/generated/shape.rgba').read_bytes()).getchannel('A')
    decoded_alpha = Image.open(OUT / 'export' / f'{NAME}_diffuse.png').convert('RGBA').getchannel('A')
    desired = source_mask.tobytes()
    decoded = decoded_alpha.tobytes()
    errors = [abs((a / 255) ** 2 - b / 255) for a, b in zip(decoded, desired)]
    active = [error for error, wanted in zip(errors, desired) if 0 < wanted < 255]
    assert active and sum(active) / len(active) < 0.035, 'Decoded edge coverage is too far from the test mask'
    assert max(desired) > 0 and min(desired) == 0
    report = {'status': 'offline material and texture fixture only', 'templateSha256': TEMPLATE_SHA,
              'maskSha256': sha(HERE.parent / '003-decal-material-import/generated/shape.rgba'),
              'materialSha256': sha(OUT / 'archive' / DEPOT / (NAME + '.mi')),
              'textures': pixels, 'partialCoverageTexels': len(active),
              'meanPartialCoverageError': sum(active) / len(active),
              'roughnessByte': 20, 'metalnessByte': 0,
              'deployed': False, 'gameRendered': False,
              'limit': 'No mesh/app/CCXL binding or second specular lobe; lower mips and runtime appearance unverified.'}
    write(OUT / 'verification.json', report)
    write(HERE / 'result.json', report)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--build', action='store_true', help='Generate and validate local resources; never install')
    mode.add_argument('--verify', action='store_true', help='Validate an earlier local build')
    parser.add_argument('--template', required=True, type=Path,
                        help='Exact extracted 2.31 base/materials/mesh_decal_blendable.mt binary')
    args = parser.parse_args()
    (build if args.build else verify)(args.template)
