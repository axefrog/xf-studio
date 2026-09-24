"""Build a private, fixed 2.31 female head/eye preview candidate from installed archives.

Requires Python with Pillow/NumPy, .NET 9 and WolvenKit Console 8.17.4.
The output directory must be new and is ignored by Git.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
HQ = HERE.parents[1]
ARCHIVE = 'archive/pc/content/basegame_4_appearance.archive'
HEAD_MORPH = 'base/characters/head/player_base_heads/player_female_average/h0_000_pwa__morphs.morphtarget'
HEAD_MESH = 'base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/h0_000_pwa_c__basehead.mesh'
EYE_MESH = 'base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/he_000_pwa_c__basehead.mesh'
EYE_GRADIENT = 'base/characters/common/eyes/gradient_profiles/eye_brown.gradient'
EYE_GRADIENT_SHA = 'a0316560105d88121dab00467ed1ff22a361db528ce9d7db019717e12fea5e04'
MAPS = {
    'head-albedo': ('base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/textures/h0_000_pwa_c__basehead_d05.xbm', 'cc210b3f6b35c4081c7e75ff6db8a616722f58ecfc358137bb153e8e23b04e8f', 'srgb-copy'),
    'head-normal': ('base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/textures/h0_001_pwa_c__basehead_n01.xbm', '8629f2213ad22c9ac33531377f3a12afa13aeca6cdb7d3b46bec59abe6b27415', 'rg-normal'),
    'head-roughness': ('base/characters/head/wa/h0_000_wa_c__basehead/textures/h0_000_wa_c__basehead_rm01.xbm', '13eefcecdb96bad238caa5feafe1bd361070bd6d6a1e29c789bdcbaf6f9f66f4', 'red-to-green'),
    'eye-albedo': ('base/characters/common/eyes/textures/he_000_base_d02.xbm', 'd1afea0622075a02c69110fbe390ba22d8c5275a6bce304d063def856f3888e1', 'srgb-copy'),
    'eye-normal': ('base/characters/common/eyes/textures/he_000_base_n01.xbm', '837d21fb747ddeafb80cd5d338c51031cc0321f160c76e772da694c2c386df0d', 'rg-normal'),
    'eye-roughness': ('base/characters/common/eyes/textures/he_000_base_rm01.xbm', 'fdd37f4a9644820042aaed4ab9410420a4340354ca8e489563bb3e9f51ab9784', 'green-copy'),
}
MESH_HASHES = {HEAD_MESH: 'e877b91a7b3f6bd678f0365d484a0dd32f7d7d4d6c13b213d2a7e73fcce874c6',
               HEAD_MORPH: '3e10c3f75fbefb0a9ddcf907a6275ca8a30aad915ad34acadb817ae4c9297b9e',
               EYE_MESH: '4d5dfa91efdf54485c5637ad34d64c32ae2f02cad7c52915062f3a0ec0f7aa19'}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(*args):
    result = subprocess.run([str(arg) for arg in args], cwd=HQ, capture_output=True,
                            text=True, encoding='utf-8', errors='replace', timeout=600)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode}): {(result.stdout + result.stderr)[-2500:]}')
    return result.stdout + result.stderr


def checked(path, expected):
    if not path.is_file() or sha(path) != expected:
        raise ValueError(f'Unexpected or missing 2.31 resource: {path}; expected SHA-256 {expected}')


def convert_map(source, output, method):
    image = Image.open(source).convert('RGBA')
    arr = np.asarray(image, dtype=np.uint8)
    if method == 'srgb-copy':
        result = image
    elif method == 'rg-normal':
        x = arr[:, :, 0].astype(np.float64) / 255 * 2 - 1
        y = -(arr[:, :, 1].astype(np.float64) / 255 * 2 - 1)
        z = np.sqrt(np.maximum(0, 1 - x*x - y*y))
        rgb = np.stack((x, y, z), axis=-1)
        result = Image.fromarray(np.rint(np.clip((rgb + 1)*127.5, 0, 255)).astype(np.uint8), 'RGB')
    elif method == 'red-to-green':
        # Three MeshStandardMaterial samples G; this is the game's base R term only.
        result = Image.fromarray(np.repeat(arr[:, :, 0:1], 3, axis=2), 'RGB')
    elif method == 'green-copy':
        # Provisional eye-channel adapter; shader parity is not established.
        result = Image.fromarray(np.repeat(arr[:, :, 1:2], 3, axis=2), 'RGB')
    else:
        raise ValueError(method)
    result.save(output, format='PNG', optimize=False)
    return {'sha256': sha(output), 'size': list(result.size), 'mode': result.mode, 'adapter': method}


def build(args):
    args.game = args.game.resolve()
    args.wolvenkit = args.wolvenkit.resolve()
    args.output = args.output.resolve()
    if not args.output.is_relative_to((HERE / 'generated').resolve()):
        raise ValueError('Private output must be under this experiment\'s ignored generated/ directory')
    archive = args.game / ARCHIVE
    if not archive.is_file():
        raise FileNotFoundError(archive)
    if not args.wolvenkit.is_file():
        raise FileNotFoundError(args.wolvenkit)
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError('Output directory must be new and empty')
    args.output.mkdir(parents=True, exist_ok=True)
    source = args.output / 'source'
    eye = args.output / 'eye-export'
    maps = args.output / 'maps'
    decoded = args.output / 'decoded'
    candidate = args.output / 'candidate'
    for directory in (source, eye, maps, decoded, candidate):
        directory.mkdir()

    run(args.wolvenkit, 'unbundle', archive, '-o', source,
        '-r', 'player_female_average.*(h0_000_pwa__morphs\\.morphtarget|h0_000_pwa_c__basehead\\.mesh)$', '-v', 'Quiet')
    for depot, digest in MESH_HASHES.items():
        if depot != EYE_MESH:
            checked(source / depot, digest)
    run(args.wolvenkit, 'convert', 's', source, '-v', 'Quiet')
    morph_json = source / (HEAD_MORPH + '.json')
    morph_doc = json.loads(morph_json.read_text(encoding='utf-8-sig'))
    linked = morph_doc['Data']['RootChunk']['baseMesh']['DepotPath']['$value'].replace('\\', '/')
    if linked != HEAD_MESH:
        raise ValueError(f'Unexpected head baseMesh: {linked}')

    # This mode exports skin and bones. WithRig silently skipped this eye on CLI 8.17.4.
    run(args.wolvenkit, 'uncook', archive, '-o', eye,
        # The exporter resolves a sibling mesh while uncooking this pair.
        '-r', 'he_000_pwa_c__basehead\\.mesh$',
        '-u', '--mesh-export-type', 'MeshOnly', '-v', 'Quiet')
    checked(eye / EYE_MESH, MESH_HASHES[EYE_MESH])
    eye_glb = eye / EYE_MESH.replace('.mesh', '.glb')
    if not eye_glb.is_file():
        raise RuntimeError('WolvenKit reported eye uncook success but wrote no GLB')
    run(args.wolvenkit, 'convert', 's', eye, '-v', 'Quiet')
    eye_doc = json.loads((eye / (EYE_MESH + '.json')).read_text(encoding='utf-8-sig'))['Data']['RootChunk']
    appearance = next(a['Data'] for a in eye_doc['appearances']
                      if a['Data']['name']['$value'] == 'gradient_brown')
    if appearance['chunkMaterials'][1]['$value'] != 'gradient_brown':
        raise ValueError('Vanilla gradient_brown eye chunk changed')
    entry = next(e for e in eye_doc['materialEntries'] if e['name']['$value'] == 'gradient_brown')
    material = eye_doc['localMaterialBuffer']['materials'][entry['index']]
    if material['baseMaterial']['DepotPath']['$value'].replace('\\', '/') != 'base/characters/common/eyes/brown_eye_gradient.mi':
        raise ValueError('Vanilla brown eye material inheritance changed')
    bindings = {name: value['DepotPath']['$value'].replace('\\', '/')
                for row in material['values'] for name, value in row.items()
                if isinstance(value, dict) and 'DepotPath' in value}
    expected_eye = {'Albedo': MAPS['eye-albedo'][0], 'Normal': MAPS['eye-normal'][0],
                    'Roughness': MAPS['eye-roughness'][0], 'IrisColorGradient': EYE_GRADIENT}
    if any(bindings.get(name) != path for name, path in expected_eye.items()):
        raise ValueError(f'Vanilla brown eye map chain changed: {bindings}')

    run(args.wolvenkit, 'unbundle', archive, '-o', maps,
        '-r', '(he_000_base_(d02|n01|rm01)|h0_000_pwa_c__basehead_d05|h0_001_pwa_c__basehead_n01|h0_000_wa_c__basehead_rm01)\\.xbm$',
        '-v', 'Quiet')
    for depot, digest, _ in MAPS.values():
        checked(maps / depot, digest)
    run(args.wolvenkit, 'unbundle', archive, '-o', maps,
        '-r', 'eye_brown\\.gradient$', '-v', 'Quiet')
    checked(maps / EYE_GRADIENT, EYE_GRADIENT_SHA)
    run(args.wolvenkit, 'convert', 's', maps, '-v', 'Quiet')
    for name, (depot, _, _) in MAPS.items():
        metadata = json.loads((maps / (depot + '.json')).read_text(encoding='utf-8-sig'))
        gamma = metadata['Data']['RootChunk']['setup']['isGamma']
        if gamma != (1 if name.endswith('albedo') else 0):
            raise ValueError(f'Unexpected XBM colour-space flag for {depot}: {gamma}')

    run('dotnet', 'build', HQ / 'projects/xf-studio/tools/morph-import', '--nologo', '-v', 'quiet')
    lookup = args.output / 'lookup' / HEAD_MESH
    lookup.parent.mkdir(parents=True)
    shutil.copy2(source / HEAD_MESH, lookup)
    packed = args.output / 'packed'
    packed.mkdir()
    run(args.wolvenkit, 'pack', args.output / 'lookup', '-o', packed, '-v', 'Quiet')
    adapter = HQ / 'projects/xf-studio/tools/morph-import/bin/Debug/net9.0/MorphImport.dll'
    run('dotnet', adapter, '--export-bound', packed / 'lookup.archive', source / HEAD_MORPH,
        args.output / 'head-export')
    head_glb = args.output / 'head-export.glb'
    if sha(head_glb) != '0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730':
        raise ValueError('Bound native head GLB differs from experiment 012 2.31 control')
    shutil.copy2(head_glb, candidate / 'head.glb')
    shutil.copy2(eye_glb, candidate / 'eyes.glb')

    map_report = {}
    for name, (depot, digest, method) in MAPS.items():
        filename = Path(depot).with_suffix('.png').name
        run(args.wolvenkit, 'export', maps / depot, '--uext', 'png', '-o', decoded,
            '-gp', args.game, '-v', 'Quiet')
        png = decoded / filename
        if not png.is_file():
            raise RuntimeError(f'No decoded PNG for {depot}')
        map_report[name] = {'depot': depot, 'sourceSha256': digest,
                            'decodedSha256': sha(png),
                            'candidate': convert_map(png, candidate / (name + '.png'), method)}

    report = {'schema': 'xfs/native-preview-core-candidate-1', 'gameVersion': '2.31',
              'provider': str(archive.resolve()), 'providerSha256': sha(archive),
              'wolvenkit': {'path': str(args.wolvenkit.resolve()), 'version': '8.17.4',
                            'sha256': sha(args.wolvenkit)},
              'source': {'headMesh': {'depot': HEAD_MESH, 'sha256': MESH_HASHES[HEAD_MESH]},
                         'headMorph': {'depot': HEAD_MORPH, 'sha256': MESH_HASHES[HEAD_MORPH]},
                         'eyeMesh': {'depot': EYE_MESH, 'sha256': MESH_HASHES[EYE_MESH]}},
              'candidate': {'head.glb': sha(candidate / 'head.glb'),
                            'eyes.glb': sha(candidate / 'eyes.glb')},
              'eyeAppearance': 'gradient_brown', 'eyeMaterialBase': material['baseMaterial']['DepotPath']['$value'],
              'eyeGradient': {'depot': EYE_GRADIENT, 'sha256': EYE_GRADIENT_SHA,
                              'convertedForThree': False},
              'maps': map_report, 'installed': False,
              'limits': ['Private fixed vanilla source candidate, not a saved-V or installed-mod resolver.',
                         'Native eye GLB has three chunks; eye surface is submesh_01_LOD_1. Use RepeatWrapping for its tiled UV0.',
                         'Brown eye gradient profile is source-verified but not adapted; base diffuse alone is not the brown rendered eye.',
                         'Three normal and roughness conversions are explicit approximations, not REDengine shader parity.',
                         'Native head and neutral eye-plate cut still need accepted plate clearance and Studio assembly.',
                         'No game rendering or effective mod-archive winner was tested.']}
    (args.output / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'manifest': str(args.output / 'manifest.json'), 'candidate': report['candidate'],
                      'mapCount': len(map_report)}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game', type=Path, required=True)
    parser.add_argument('--wolvenkit', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    build(parser.parse_args())
