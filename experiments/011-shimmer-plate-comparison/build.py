"""Private one-selector Shimmer plate A/B/Off candidate. Never installs or enables export."""
import shutil
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from PIL import Image

HERE = Path(__file__).resolve().parent
HQ = HERE.parents[1]
STUDY = HERE.parent / '010-shimmer-game-adapter'
BASE_BUILDER = HERE.parent / '005-preset-collection' / 'build.py'
WK_DEFAULT = Path('F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe')
BUN_DEFAULT = Path(shutil.which('bun') or 'bun')
GAME_DEFAULT = Path('F:/Games/Cyberpunk 2077')
PLATE_DEFAULT = HERE.parent / '004-plate-import/generated/archive/axefrog/appearance_studio/studies'
TEMPLATE_DEFAULT = Path('D:/Dev/cp2077-modding-hq/research/consumers/glitter/extracted/base/materials/mesh_decal.mt')
TEMPLATE_JSON_DEFAULT = Path('D:/Dev/cp2077-modding-hq/research/consumers/glitter/json/mesh_decal.mt.json')
TEMPLATE_SHA = 'b1b181b70fd1b16393d626281eeff1d5fc99932f24868e55248d18a1abfbc019'
COLLECTION_ID = 'bcce9fc1-7f4b-4e59-9124-07d90c4ce110'
PRESET_ID = 'b147d554-3b34-4e82-8155-9be0e53991c9'
VARIANTS = [('flat', 'Flat normal / control', None, 0),
            ('plus_direct', '+Y / direct', False, 0),
            ('minus_direct', '-Y / direct', True, 0),
            ('plus_blended', '+Y / blended', False, 1),
            ('minus_blended', '-Y / blended', True, 1)]
NAMESPACE = 'xfs_shimmer_plate_diagnostic'
DEPOT = 'axefrog/appearance_studio/studies/shimmer_plate'


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cname(name):
    return {'$type': 'CName', '$storage': 'string', '$value': name}


def ref(path, soft=False):
    return {'DepotPath': {'$type': 'ResourcePath', '$storage': 'string', '$value': path.replace('/', '\\')},
            'Flags': 'Soft' if soft else 'Default'}


def run(out, label, command, settings=None, timeout=300):
    env = os.environ.copy()
    for key, value in (settings or {}).items():
        env['XbmImportArgs__' + key] = str(value).lower() if isinstance(value, bool) else str(value)
    p = subprocess.run([str(v) for v in command], cwd=HQ, env=env, capture_output=True,
                       text=True, encoding='utf-8', errors='replace', timeout=timeout)
    log = p.stdout + '\n' + p.stderr
    (out / 'logs').mkdir(parents=True, exist_ok=True)
    (out / 'logs' / (label + '.log')).write_text(log, encoding='utf-8')
    counts = re.search(r'Imported (\d+)/(\d+) file\(s\)', log)
    import_ok = label.startswith('import-') and p.returncode == 3 and counts and counts[1] == counts[2] and int(counts[1]) > 0
    if (p.returncode and not import_ok) or re.search(r'\bError\s*\]|Unhandled exception|Traceback \(', log):
        raise RuntimeError(f'{label}: exit {p.returncode}; see {out / "logs" / (label + ".log")}')
    print(label, 'complete', flush=True)


def normal_maps(out, size):
    raw = out / 'raw'
    shape = Image.frombytes('RGBA', (size, size), (raw / 'shape.rgba').read_bytes()).getchannel('A')
    optical = Image.frombytes('RGBA', (size, size), (raw / 'normal.rgba').read_bytes()).convert('RGB')
    surface = Image.frombytes('RGBA', (size, size), (raw / 'surface.rgba').read_bytes())
    rgb = bytes.fromhex(load(raw / 'source.json')['color'].lstrip('#'))
    diffuse = Image.merge('RGBA', (Image.new('L', shape.size, rgb[0]), Image.new('L', shape.size, rgb[1]),
                                   Image.new('L', shape.size, rgb[2]),
                                   shape.point([round((i / 255) ** .5 * 255) for i in range(256)])))
    r, g, b = optical.split()
    maps = {'diffuse': diffuse, 'normal_alpha': shape, 'roughness': surface.getchannel('G'),
            'metalness': surface.getchannel('B'),
            'normal_flat': Image.new('RGB', shape.size, (128, 128, 255)),
            'normal_plus': optical, 'normal_minus': Image.merge('RGB', (r, g.point(lambda v: 255 - v), b))}
    for key, image in maps.items():
        group = 'colour' if key == 'diffuse' else 'normal' if key.startswith('normal_') and key != 'normal_alpha' else 'scalar'
        path = out / 'input' / group / f'xfs_shimmer_{key}.png'
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path)
    return maps


def material(name, mode, normal_name):
    def texture(key, map_name):
        return {'$type': 'rRef:ITexture', key: ref(f'{DEPOT}/textures/xfs_shimmer_{map_name}.xbm')}
    values = [texture('DiffuseTexture', 'diffuse'), texture('NormalTexture', normal_name),
              texture('NormalAlphaTex', 'normal_alpha'), texture('RoughnessTexture', 'roughness'),
              texture('MetalnessTexture', 'metalness')]
    values += [{'$type': 'Float', key: value} for key, value in {
        'DiffuseAlpha': 1, 'NormalAlpha': int(normal_name != 'normal_flat'), 'UseNormalAlphaTex': 1,
        'RoughnessMetalnessAlpha': 1, 'RoughnessScale': 1, 'MetalnessScale': 1,
        'RoughnessBias': 0, 'MetalnessBias': 0, 'AlphaMaskContrast': 0,
        'SecondaryMaskInfluence': 0, 'NormalsBlendingMode': mode}.items()]
    values.append({'$type': 'Color', 'DiffuseColor': {'$type': 'Color', 'Red': 255, 'Green': 255,
                                                   'Blue': 255, 'Alpha': 255}})
    return {'$type': 'CMaterialInstance', 'audioTag': cname('None'),
            'baseMaterial': ref('base/materials/mesh_decal.mt'), 'cookingPlatform': 'PLATFORM_PC',
            'enableMask': 0, 'resourceVersion': 4, 'values': values}


def main(args):
    out = args.output.resolve()
    if out.exists():
        raise ValueError(f'Output already exists: {out}')
    for label, path in [('WolvenKit', args.wolvenkit), ('Bun', args.bun),
                        ('material template', args.template), ('material template JSON', args.template_json),
                        ('plate mesh', args.plate / 'xfas_eye_plate.mesh'),
                        ('plate morph', args.plate / 'xfas_eye_plate.morphtarget')]:
        if not path.is_file():
            raise FileNotFoundError(f'{label}: {path}')
    if sha(args.template) != TEMPLATE_SHA:
        raise ValueError('The material template differs from the audited 2.31 mesh_decal.mt')
    template = load(args.template_json)
    template_root = template['Data']['RootChunk']
    if template['Header']['GameVersion'] != 2310 or template_root['name']['$value'] != 'mesh_decal' or 'MVF_MeshSkinned' not in template_root['vertexFactories']:
        raise ValueError('The material template JSON is not the audited MeshSkinned 2.31 material')
    passes = [item for technique in template_root['techniques'] for item in technique['passes']
              if item['stagePassNameRegular']['$value'] == 'renderstage_post_gbuffer']
    if not passes or not any(item['depthStencilMode']['depthWriteEnable'] == 0 and
                             any(target['blendEnable'] for target in item['blendMode']['renderTarget']['Elements'][:item['blendMode']['numTargets']])
                             for item in passes):
        raise ValueError('The audited decal blend/depth pass was not found')
    available = {p['name']['$value'] for group in template_root['parameterInfo'] for p in group}
    if not set(next(key for key in item if key != '$type') for item in material('probe', 0, 'normal_plus')['values']).issubset(available):
        raise ValueError('The template lacks a required diagnostic parameter')
    mode_alpha_defaults = [param['Data'].get('texture') for group in template_root['parameters']['Elements']
                           for param in group if param.get('Data', {}).get('parameterName', {}).get('$value') == 'NormalsBlendingModeAlpha']
    if len(mode_alpha_defaults) != 1 or mode_alpha_defaults[0]['DepotPath']['$value'].replace('\\', '/') != 'engine/textures/editor/white.xbm':
        raise ValueError('The template normal-blend interpolation default is not the expected white map')
    out.mkdir(parents=True)
    run(out, 'bake-shimmer', [args.bun, STUDY / 'recipe-inputs.ts', args.recipe,
                              args.layer, out / 'raw', args.size])
    source = load(out / 'raw/source.json')
    recipe = load(out / 'raw/selected-recipe.json')
    selected = next(layer for layer in recipe['layers'] if layer['id'] == source['layerId'])
    assert selected['finish'] == 'shimmer'
    flat_recipe = copy.deepcopy(recipe)
    flat_layer = next(layer for layer in flat_recipe['layers'] if layer['id'] == source['layerId'])
    flat_recipe['layers'] = [flat_layer]
    flat_layer['finish'] = 'matte'
    flat_layer.pop('flakes', None)
    collection = {'schema': 'xfas/collection-1', 'id': COLLECTION_ID, 'name': 'Shimmer diagnostic scaffold',
                  'presets': [{'id': PRESET_ID, 'name': 'Flat scaffold', 'revision': 1,
                               'recipe': flat_recipe}]}
    write(out / 'scaffold-collection.json', collection)
    run(out, 'build-scaffold', [sys.executable, BASE_BUILDER, '--collection', out / 'scaffold-collection.json',
                                '--output', out / 'scaffold', '--plate', args.plate,
                                '--wolvenkit', args.wolvenkit, '--bun', args.bun,
                                '--gamepath', args.gamepath, '--no-latest'], timeout=900)
    scaffold = out / 'scaffold'
    plan = load(scaffold / 'baked/plan.json')
    assert len(plan['presets']) == 1
    maps = normal_maps(out, args.size)
    archive = out / 'archive'
    texture_dir = archive / DEPOT / 'textures'
    model_dir = archive / DEPOT / 'models'
    app_dir = archive / DEPOT
    for path in (texture_dir, model_dir, app_dir, out / 'models-json', out / 'app-json',
                 out / 'cc-json', out / 'roundtrip', out / 'export-dds', out / 'package/archive/pc/mod'):
        path.mkdir(parents=True, exist_ok=True)
    common = {'GenerateMipMaps': True, 'IsStreamable': True, 'PremultiplyAlpha': False}
    for group, specific in {
        'colour': {'IsGamma': True, 'TextureGroup': 'TEXG_Generic_Color', 'RawFormat': 'TRF_TrueColor', 'Compression': 'TCM_QualityColor'},
        'normal': {'IsGamma': False, 'TextureGroup': 'TEXG_Generic_Normal', 'RawFormat': 'TRF_TrueColor', 'Compression': 'TCM_Normalmap'},
        'scalar': {'IsGamma': False, 'TextureGroup': 'TEXG_Generic_Grayscale', 'RawFormat': 'TRF_Grayscale', 'Compression': 'TCM_QualityR'},
    }.items():
        run(out, 'import-' + group, [args.wolvenkit, 'import', out / 'input' / group, '-o', texture_dir], common | specific)
    base_mesh = load(scaffold / 'models-json/xfs_eye_plate.mesh.json')
    base_morph = load(scaffold / 'models-json/xfs_eye_plate.morphtarget.json')
    base_app = load(scaffold / 'app-json/xfs_collection.app.json')
    base_cc = load(scaffold / 'cc-json/xfs_collection.inkcharcustomization.json')
    app_path = f'{DEPOT}/xfs_shimmer_plate.app'
    cc_path = f'{DEPOT}/xfs_shimmer_plate.inkcharcustomization'
    option = base_cc['Data']['RootChunk']['headCustomizationOptions'][0]['Data']
    option['name'] = option['uiSlot'] = cname(NAMESPACE)
    option['localizedName'] = 'XF Studio Shimmer diagnostic'
    option['resource'] = ref(app_path, True)
    base_cc['Data']['RootChunk']['headGroups'][0]['options'] = [cname(NAMESPACE)]
    off = copy.deepcopy(base_app['Data']['RootChunk']['appearances'][0])
    off['HandleId'] = '10000'
    off['Data']['name'] = cname('xfs_off')
    app_appearances = [off]
    definitions = [copy.deepcopy(option['definitions'][0])]
    definitions[0]['name'] = cname('xfs_off')
    seed_template = base_app['Data']['RootChunk']['appearances'][1]
    paths = {}
    for index, (key, label, flipped, mode) in enumerate(VARIANTS, start=1):
        identity = f'xfs_shimmer_{key}'
        mesh_path = f'{DEPOT}/models/{identity}.mesh'
        morph_path = f'{DEPOT}/models/{identity}.morphtarget'
        normal_name = 'normal_flat' if flipped is None else 'normal_minus' if flipped else 'normal_plus'
        mesh = copy.deepcopy(base_mesh)
        mr = mesh['Data']['RootChunk']
        mr['appearances'][0]['Data']['name'] = cname(identity)
        mr['appearances'][0]['Data']['chunkMaterials'] = [cname(identity + '@preset')]
        mr['localMaterialBuffer']['materials'] = [material(identity, mode, normal_name)]
        mr['localMaterialBuffer']['rawData'] = None
        mr['localMaterialBuffer']['rawDataHeaders'] = []
        write(out / 'models-json' / (identity + '.mesh.json'), mesh)
        morph = copy.deepcopy(base_morph)
        morph['Data']['RootChunk']['baseMesh'] = ref(mesh_path)
        morph['Data']['RootChunk']['baseMeshAppearance'] = cname(identity)
        write(out / 'models-json' / (identity + '.morphtarget.json'), morph)
        entry = copy.deepcopy(seed_template)
        entry['HandleId'] = str(10000 + index * 10)
        data = entry['Data']
        data['name'] = cname(identity)
        component = data['components'][0]
        component_name = identity + '_component'
        component['name'] = cname(component_name)
        component['id'] = str(int.from_bytes(hashlib.sha256(('xfs:component:' + component_name).encode()).digest()[:8], 'little') or 1)
        component['meshAppearance'] = cname(identity)
        component['morphResource'] = ref(morph_path)
        component['parentTransform']['HandleId'] = str(10000 + index * 10 + 1)
        component['skinning']['HandleId'] = str(10000 + index * 10 + 2)
        override = data['partsOverrides'][0]['componentsOverrides'][0]
        override['componentName'] = cname(component_name)
        override['meshAppearance'] = cname(identity)
        data['resolvedDependencies'] = [ref(morph_path, True)]
        app_appearances.append(entry)
        definitions.append({'$type': 'gameuiIndexedAppearanceDefinition', 'name': cname(identity),
                            'index': index, 'localizedName': label})
        paths[key] = {'appearance': identity, 'mesh': mesh_path, 'morph': morph_path,
                      'normal': normal_name, 'normalMode': mode, 'normalGreenInverted': flipped}
    base_app['Data']['RootChunk']['appearances'] = app_appearances
    option['definitions'] = definitions
    option['defaultIndex'] = 0
    write(out / 'app-json/xfs_shimmer_plate.app.json', base_app)
    write(out / 'cc-json/xfs_shimmer_plate.inkcharcustomization.json', base_cc)
    run(out, 'deserialize-models', [args.wolvenkit, 'convert', 'deserialize', out / 'models-json', '-o', model_dir])
    run(out, 'deserialize-app', [args.wolvenkit, 'convert', 'deserialize', out / 'app-json', '-o', app_dir])
    run(out, 'deserialize-cc', [args.wolvenkit, 'convert', 'deserialize', out / 'cc-json', '-o', app_dir])
    run(out, 'serialize', [args.wolvenkit, 'convert', 'serialize', archive, '-o', out / 'roundtrip'])
    run(out, 'export-mips', [args.wolvenkit, 'export', texture_dir, '-o', out / 'export-dds', '--uext', 'dds', '--gamepath', args.gamepath])
    package = out / 'package/archive/pc/mod'
    run(out, 'pack', [args.wolvenkit, 'pack', archive, '-o', package])
    packed = package / (NAMESPACE + '.archive')
    (package / 'archive.archive').rename(packed)
    (package / (NAMESPACE + '.archive.xl')).write_text(
        'customizations:\n  female: ' + cc_path.replace('/', '\\') + '\nresource:\n  scope:\n    player_customization.app:\n      - ' + app_path.replace('/', '\\') + '\n', encoding='utf-8')
    artifacts = [{'path': str(p.relative_to(archive)).replace('\\', '/'), 'sha256': sha(p), 'bytes': p.stat().st_size}
                 for p in sorted(archive.rglob('*')) if p.is_file()]
    write(out / 'build.json', {'status': 'private Shimmer comparison candidate', 'source': source,
                              'plateInputs': {p.name: sha(p) for p in args.plate.glob('xfas_eye_plate.*')},
                              'templateSha256': TEMPLATE_SHA, 'templateJsonSha256': sha(args.template_json),
                              'namespace': NAMESPACE, 'app': app_path, 'customization': cc_path,
                              'variants': paths, 'sourceMaps': {key: hashlib.sha256(image.tobytes()).hexdigest() for key, image in maps.items()},
                              'artifacts': artifacts, 'archiveSha256': sha(packed),
                              'installed': False, 'gameRenderingVerified': False})
    print('BUILD', out)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=HERE / 'generated' / 'candidate')
    parser.add_argument('--recipe', default='--sample')
    parser.add_argument('--layer', default='sample-shimmer')
    parser.add_argument('--size', type=int, default=1024)
    parser.add_argument('--plate', type=Path, default=PLATE_DEFAULT)
    parser.add_argument('--wolvenkit', type=Path, default=WK_DEFAULT)
    parser.add_argument('--bun', type=Path, default=BUN_DEFAULT)
    parser.add_argument('--gamepath', type=Path, default=GAME_DEFAULT)
    parser.add_argument('--template', type=Path, default=TEMPLATE_DEFAULT)
    parser.add_argument('--template-json', type=Path, default=TEMPLATE_JSON_DEFAULT)
    main(parser.parse_args())
