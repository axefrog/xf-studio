"""Independent static verification of the private Shimmer selector candidate."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
from PIL import Image

HERE = Path(__file__).resolve().parent
WK_DEFAULT = Path('F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe')
EXPECTED = {'flat': ('normal_flat', 0, 0), 'plus_direct': ('normal_plus', 0, 1),
            'minus_direct': ('normal_minus', 0, 1), 'plus_blended': ('normal_plus', 1, 1),
            'minus_blended': ('normal_minus', 1, 1)}


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def val(x):
    return x['$value']


def dep(x):
    return val(x['DepotPath']).replace('\\', '/')


def normalized(x):
    if isinstance(x, dict):
        return {key: normalized(value) for key, value in x.items() if key not in ('HandleId', 'BufferId', 'HandleRefId')}
    if isinstance(x, list):
        return [normalized(value) for value in x]
    return x


def dds_levels(path, stride, side, format_code):
    data = path.read_bytes()
    assert data[:4] == b'DDS ' and data[84:88] == b'DX10', path
    height, width = struct.unpack_from('<II', data, 12)
    count = struct.unpack_from('<I', data, 28)[0]
    fmt, dim, _, array_size, _ = struct.unpack_from('<IIIII', data, 128)
    assert width == height == side and count == side.bit_length()
    assert fmt == format_code and dim == 3 and array_size == 1, (path, fmt)
    at = 148
    result = {}
    for level in range(count):
        n = max(1, side >> level)
        result[n] = data[at:at + n * n * stride]
        assert len(result[n]) == n * n * stride
        at += n * n * stride
    assert at == len(data)
    return result


def main(args):
    out = args.build.resolve()
    manifest = load(out / 'build.json')
    source = manifest['source']
    size = source['size']
    rt = out / 'roundtrip'
    archive = out / 'archive'
    base_mesh = load(out / 'scaffold/source-json/xfas_eye_plate.mesh.json')['Data']['RootChunk']
    base_morph = load(out / 'scaffold/source-json/xfas_eye_plate.morphtarget.json')['Data']['RootChunk']
    app = load(rt / 'xfs_shimmer_plate.app.json')['Data']['RootChunk']
    cc = load(rt / 'xfs_shimmer_plate.inkcharcustomization.json')['Data']['RootChunk']
    assert len(app['appearances']) == 6 and len(cc['headCustomizationOptions']) == 1
    off = app['appearances'][0]['Data']
    assert val(off['name']) == 'xfs_off' and not off['components'] and not off['partsOverrides'][0]['componentsOverrides']
    option = cc['headCustomizationOptions'][0]['Data']
    assert val(option['name']) == val(option['uiSlot']) == manifest['namespace']
    assert dep(option['resource']) == manifest['app']
    assert option['defaultIndex'] == 0 and len(option['definitions']) == 6
    assert val(option['definitions'][0]['name']) == 'xfs_off'
    assert [definition['index'] for definition in option['definitions']] == list(range(6))
    assert [val(v) for v in cc['headGroups'][0]['options']] == [manifest['namespace']]
    app_ids = set()
    refs = []
    for index, (key, (normal_name, mode, normal_alpha)) in enumerate(EXPECTED.items(), start=1):
        variant = manifest['variants'][key]
        identity = variant['appearance']
        assert identity.startswith('xfs_')
        assert val(option['definitions'][index]['name']) == val(app['appearances'][index]['Data']['name']) == identity
        entry = app['appearances'][index]['Data']
        assert len(entry['components']) == 1
        component = entry['components'][0]
        assert component['$type'] == 'entMorphTargetSkinnedMeshComponent'
        assert val(component['meshAppearance']) == identity and dep(component['morphResource']) == variant['morph']
        assert component['isEnabled'] == 1 and int(component['id']) not in app_ids
        app_ids.add(int(component['id']))
        assert entry['compiledData']['Data']['CruidDict'] == {'0': component['id']}
        assert entry['compiledData']['Data']['Chunks']
        override = entry['partsOverrides'][0]['componentsOverrides']
        assert len(override) == 1 and val(override[0]['meshAppearance']) == identity
        assert val(override[0]['componentName']) == val(component['name'])
        assert dep(entry['resolvedDependencies'][0]) == variant['morph']
        mesh = load(rt / (identity + '.mesh.json'))['Data']['RootChunk']
        morph = load(rt / (identity + '.morphtarget.json'))['Data']['RootChunk']
        for field in ('renderResourceBlob', 'boneNames', 'boneRigMatrices', 'boundingBox'):
            assert normalized(mesh[field]) == normalized(base_mesh[field]), (key, field)
        for field in ('blob', 'targets'):
            assert normalized(morph[field]) == normalized(base_morph[field]), (key, field)
        assert len(morph['targets']) == 105
        assert dep(morph['baseMesh']) == variant['mesh'] and val(morph['baseMeshAppearance']) == identity
        assert len(mesh['appearances']) == 1 and val(mesh['appearances'][0]['Data']['name']) == identity
        assert [val(v) for v in mesh['appearances'][0]['Data']['chunkMaterials']] == [identity + '@preset']
        assert len(mesh['materialEntries']) == len(mesh['localMaterialBuffer']['materials']) == 1
        assert val(mesh['materialEntries'][0]['name']) == '@preset'
        material = mesh['localMaterialBuffer']['materials'][0]
        assert dep(material['baseMaterial']) == 'base/materials/mesh_decal.mt'
        params = {name: value for item in material['values'] for name, value in item.items() if name != '$type'}
        assert params['NormalsBlendingMode'] == mode and params['NormalAlpha'] == normal_alpha
        assert params['UseNormalAlphaTex'] == 1
        assert params['DiffuseAlpha'] == params['RoughnessMetalnessAlpha'] == 1
        assert params['AlphaMaskContrast'] == params['SecondaryMaskInfluence'] == 0
        assert params['RoughnessScale'] == params['MetalnessScale'] == 1
        for param, map_name in [('DiffuseTexture', 'diffuse'), ('NormalTexture', normal_name),
                                ('NormalAlphaTex', 'normal_alpha'), ('RoughnessTexture', 'roughness'),
                                ('MetalnessTexture', 'metalness')]:
            path = dep(params[param])
            assert path == f'axefrog/appearance_studio/studies/shimmer_plate/textures/xfs_shimmer_{map_name}.xbm'
            assert (archive / path).is_file()
            refs.append(path)
    assert len(app_ids) == 5 and len(set(refs)) == 7
    # Exact source masks are zero outside the authoring shape; the inspected shader gates
    # normal by NormalAlphaTex and colour/surface by squared diffuse alpha.
    shape = Image.frombytes('RGBA', (size, size), (out / 'raw/shape.rgba').read_bytes()).getchannel('A').tobytes()
    assert hashlib.sha256((out / 'raw/shape.rgba').read_bytes()).hexdigest() == source['shapeSha256']
    assert hashlib.sha256((out / 'raw/normal.rgba').read_bytes()).hexdigest() == source['normalSha256']
    assert hashlib.sha256((out / 'raw/surface.rgba').read_bytes()).hexdigest() == source['surfaceSha256']
    diffuse = Image.open(out / 'input/colour/xfs_shimmer_diffuse.png').convert('RGBA')
    normal_alpha_image = Image.open(out / 'input/scalar/xfs_shimmer_normal_alpha.png').convert('L')
    assert normal_alpha_image.tobytes() == shape
    diffuse_alpha = diffuse.getchannel('A').tobytes()
    assert all(diffuse_alpha[i] == 0 for i, v in enumerate(shape) if v == 0)
    raw_normal = Image.frombytes('RGBA', (size, size), (out / 'raw/normal.rgba').read_bytes()).convert('RGB')
    raw_surface = Image.frombytes('RGBA', (size, size), (out / 'raw/surface.rgba').read_bytes())
    source_maps = {name: Image.open(out / 'input' / ('colour' if name == 'diffuse' else
                    'normal' if name in ('normal_flat', 'normal_plus', 'normal_minus') else 'scalar') /
                    f'xfs_shimmer_{name}.png') for name in manifest['sourceMaps']}
    assert {key: hashlib.sha256(image.tobytes()).hexdigest() for key, image in source_maps.items()} == manifest['sourceMaps']
    assert source_maps['normal_plus'].convert('RGB').tobytes() == raw_normal.tobytes()
    positive = raw_normal.tobytes()
    negative = source_maps['normal_minus'].convert('RGB').tobytes()
    assert all(negative[i] == 255 - positive[i] for i in range(1, len(positive), 3))
    assert all(negative[i] == positive[i] for i in range(len(positive)) if i % 3 != 1)
    assert source_maps['normal_flat'].convert('RGB').getpixel((0, 0)) == (128, 128, 255)
    assert source_maps['normal_flat'].convert('RGB').tobytes() == bytes((128, 128, 255)) * (size * size)
    assert source_maps['roughness'].convert('L').tobytes() == raw_surface.getchannel('G').tobytes()
    assert source_maps['metalness'].convert('L').tobytes() == raw_surface.getchannel('B').tobytes()
    # Independent source-channel and imported-mip checks; mips are not screen samples.
    formats = {'diffuse': (4, 29), 'normal_alpha': (1, 61), 'roughness': (1, 61),
               'metalness': (1, 61), 'normal_flat': (2, 49), 'normal_plus': (2, 49), 'normal_minus': (2, 49)}
    mip_report = {}
    for map_name, (stride, fmt) in formats.items():
        texture = load(rt / f'xfs_shimmer_{map_name}.xbm.json')['Data']['RootChunk']
        setup = texture['setup']
        assert texture['width'] == texture['height'] == size and setup['hasMipchain'] == 1
        assert setup['isGamma'] == int(map_name == 'diffuse')
        assert setup['compression'] == ('TCM_Normalmap' if map_name.startswith('normal_') and map_name != 'normal_alpha' else
                                        'TCM_QualityColor' if map_name == 'diffuse' else 'TCM_QualityR')
        levels = dds_levels(out / 'export-dds' / f'xfs_shimmer_{map_name}.dds', stride, size, fmt)
        mip_report[map_name] = {'levels': len(levels), 'baseSha256': hashlib.sha256(levels[size]).hexdigest(),
                                'tier256Sha256': hashlib.sha256(levels[256]).hexdigest() if size >= 256 else None}
    pos = dds_levels(out / 'export-dds/xfs_shimmer_normal_plus.dds', 2, size, 49)[size]
    neg = dds_levels(out / 'export-dds/xfs_shimmer_normal_minus.dds', 2, size, 49)[size]
    assert pos != neg
    assert sum(abs(pos[i] - neg[i]) for i in range(1, len(pos), 2)) > 0
    decoded_shape = dds_levels(out / 'export-dds/xfs_shimmer_normal_alpha.dds', 1, size, 61)[size]
    outside = [i for i, v in enumerate(shape) if v == 0]
    assert outside and max(decoded_shape[i] for i in outside) <= 8
    decoded_diffuse = dds_levels(out / 'export-dds/xfs_shimmer_diffuse.dds', 4, size, 29)[size]
    decoded_outside_alpha = [decoded_diffuse[i * 4 + 3] for i in outside]
    assert max(decoded_outside_alpha) <= 2
    partial = [i for i, v in enumerate(shape) if 0 < v < 255]
    assert partial
    avg_error = sum(abs((diffuse_alpha[i] / 255) ** 2 - shape[i] / 255) for i in partial) / len(partial)
    assert avg_error < .005
    package = out / 'package/archive/pc/mod'
    packed = package / (manifest['namespace'] + '.archive')
    assert sha(packed) == manifest['archiveSha256']
    xl = (package / (manifest['namespace'] + '.archive.xl')).read_text(encoding='utf-8')
    assert manifest['customization'].replace('/', '\\') in xl and manifest['app'].replace('/', '\\') in xl
    unpacked = out / 'unpacked'
    unpacked.mkdir(exist_ok=True)
    p = subprocess.run([str(args.wolvenkit), 'unbundle', str(packed), '-o', str(unpacked)],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
    (out / 'logs/unpack-verify.log').write_text(p.stdout + '\n' + p.stderr, encoding='utf-8')
    assert p.returncode == 0 and 'Error' not in p.stdout
    files = [f for f in unpacked.rglob('*') if f.is_file()]
    assert len(files) == len(manifest['artifacts'])
    assert all(Path(a['path']).name.startswith('xfs_') for a in manifest['artifacts'])
    assert all((unpacked / a['path']).is_file() and sha(unpacked / a['path']) == a['sha256'] for a in manifest['artifacts'])
    normals = dds_levels(out / 'export-dds/xfs_shimmer_normal_plus.dds', 2, size, 49)
    coverage = dds_levels(out / 'export-dds/xfs_shimmer_normal_alpha.dds', 1, size, 61)
    roughness = dds_levels(out / 'export-dds/xfs_shimmer_roughness.dds', 1, size, 61)
    metalness = dds_levels(out / 'export-dds/xfs_shimmer_metalness.dds', 1, size, 61)
    channel_tiers = []
    for tier in (size, size // 2, size // 4, size // 8, size // 16):
        active = [i for i, alpha in enumerate(coverage[tier]) if alpha >= 128]
        assert active
        slopes = [math.hypot(2 * normals[tier][2 * i] / 255 - 1,
                             2 * normals[tier][2 * i + 1] / 255 - 1) for i in active]
        channel_tiers.append({'size': tier, 'coveredTexels': len(active),
                              'strongSlopeFraction': sum(v >= .15 for v in slopes) / len(slopes),
                              'meanRoughnessByte': sum(roughness[tier][i] for i in active) / len(active),
                              'meanMetalnessByte': sum(metalness[tier][i] for i in active) / len(active)})
    result = {'status': 'offline static verification passed', 'sourceRecipeSha256': source['recipeSha256'],
              'sourceShapeSha256': source['shapeSha256'], 'sourceNormalSha256': source['normalSha256'],
              'sourceSurfaceSha256': source['surfaceSha256'], 'templateSha256': manifest['templateSha256'],
              'plateInputSha256': manifest['plateInputs'], 'selectorOptions': 6,
              'variants': list(EXPECTED), 'meshMorphPairs': 5, 'preservedMorphsEach': 105,
              'nativeModelBuffersUnchanged': True, 'sharedTextureCount': len(formats),
              'resourceCount': len(files), 'archiveSha256': sha(packed), 'decodedMips': mip_report,
              'sourcePartialCoverageError': avg_error, 'offUnmaskedSourceNormalAlphaMax': max(decoded_shape[i] for i in outside),
              'decodedChannelTiers': channel_tiers,
              'decodedDiffuseOutsideAlphaMax': max(decoded_outside_alpha),
              'decodedDiffuseOutsideNonzeroTexels': sum(v != 0 for v in decoded_outside_alpha),
              'installed': False, 'gameRenderingVerified': False,
              'limits': ['ArchiveXL registration, switch clearing, normal orientation and blended response need a game session.',
                         'Decoded mip texels and resource graph are not runtime shading or sampler evidence.',
                         'The duplicated plate resources make a controlled diagnostic, not an optimized exporter.']}
    (out / 'verification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'decodedMips'}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', type=Path, default=HERE / 'generated/candidate')
    parser.add_argument('--wolvenkit', type=Path, default=WK_DEFAULT)
    main(parser.parse_args())
