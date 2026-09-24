"""Import a derived cut as private mesh/morph resources and audit both skin buffers.

Requires installed WolvenKit, .NET, and the project-local morph importer. This
does not pack or install a game mod. All resource output stays in --output.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
HQ = HERE.parents[1]
sys.path[:0] = [str(HERE.parent / '004-plate-import'), str(HERE.parent / '006-plate-clearance')]
from verify_roundtrip import Glb  # noqa: E402
from retain_head_weights import preserve, preserve_morph  # noqa: E402
from verify_crease_roundtrip import skin_rows  # noqa: E402

NAME = 'xfs_bootstrap_eye_plate'
DEPOT = f'axefrog\\appearance_studio\\studies\\{NAME}.mesh'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def cname(value):
    return {'$type': 'CName', '$storage': 'string', '$value': value}


def ref(value):
    return {'DepotPath': {'$type': 'ResourcePath', '$storage': 'string', '$value': value}, 'Flags': 'Default'}


def prepare(mesh_path, morph_path, glb, output):
    templates = output / 'templates'
    templates.mkdir(parents=True, exist_ok=True)
    names = glb.mesh['extras']['targetNames']
    for kind, path in [('mesh', mesh_path), ('morphtarget', morph_path)]:
        document = json.loads(path.read_text(encoding='utf-8-sig'))
        root = document['Data']['RootChunk']
        if kind == 'mesh':
            root['appearances'] = [{'HandleId': '0', 'Data': {'$type': 'meshMeshAppearance',
                'name': cname('xfs_bootstrap_reference'), 'chunkMaterials': [cname('xfs_bootstrap_reference')], 'tags': []}}]
            root['materialEntries'] = [{'$type': 'CMeshMaterialEntry', 'index': 0, 'isLocalInstance': 1,
                                        'name': cname('xfs_bootstrap_reference')}]
            root['localMaterialBuffer']['materials'] = [{'$type': 'CMaterialInstance', 'audioTag': cname('None'),
                'baseMaterial': ref('base\\materials\\mesh_decal.mt'), 'cookingPlatform': 'PLATFORM_PC',
                'enableMask': 1, 'metadata': None, 'resourceVersion': 4, 'values': []}]
            root['localMaterialBuffer']['rawData'] = None
            root['localMaterialBuffer']['rawDataHeaders'] = []
            root['parameters'] = []
            root['inplaceResources'] = []
            for key in ('externalMaterials', 'preloadExternalMaterials', 'preloadLocalMaterialInstances', 'localMaterialInstances'):
                if key in root:
                    root[key] = []
            bones = {v['$value'] for v in root['boneNames']}
            assert bones == set(glb.bones())
        else:
            targets = {t['name']['$value'] + '_' + t['regionName']['$value']: t for t in root['targets']}
            assert len(names) == 105 and set(names) == set(targets)
            root['targets'] = [targets[name] for name in names]
            root['baseMesh'] = ref(DEPOT)
            root['baseMeshAppearance'] = cname('xfs_bootstrap_reference')
            root['baseTexture'] = ref('engine\\textures\\editor\\normal.xbm')
            root['blob']['Data']['textureDiffsBuffer'] = None
            root['blob']['Data']['header']['targetTextureDiffsData'] = [{'$type': 'rendRenderMorphTargetMeshBlobTextureData',
                **{key: {'Elements': []} for key in ('targetDiffOffset', 'targetDiffScale', 'targetDiffsDataOffset',
                    'targetDiffsDataSize', 'targetDiffsMipLevelCounts', 'targetDiffsWidth')}} for _ in names]
        (templates / f'{NAME}.{kind}.json').write_text(json.dumps(document, separators=(',', ':')) + '\n')
    return templates


def run(output, label, command, cwd=HQ, env=None):
    result = subprocess.run([str(x) for x in command], cwd=cwd, env=env, capture_output=True,
                            text=True, encoding='utf-8', errors='replace', timeout=300)
    logs = output / 'logs'
    logs.mkdir(exist_ok=True)
    log = result.stdout + '\n' + result.stderr
    (logs / f'{label}.log').write_text(log, encoding='utf-8')
    if result.returncode or re.search(r'\bError\s*\]|Unhandled exception|Traceback \(', log):
        raise RuntimeError(f'{label} failed ({result.returncode}): {log[-3000:]}')
    print(f'{label}: complete', flush=True)


def audit(source_glb, final_glb, mesh_source, morph_source, mesh_json, morph_json, mapping):
    original, final = Glb(source_glb), Glb(final_glb)
    indices = json.loads(mapping.read_text())['plateToHeadIndices']
    assert len(indices) == len(final.attr('POSITION')) == 1620
    assert original.mesh['extras']['targetNames'] == final.mesh['extras']['targetNames']
    np.testing.assert_array_equal(original.array(original.p['indices']), final.array(final.p['indices']))
    errors = {}
    for name in original.p['attributes']:
        if name in ('JOINTS_0', 'JOINTS_1', 'WEIGHTS_0', 'WEIGHTS_1'):
            continue
        error = float(np.abs(original.attr(name) - final.attr(name)).max())
        errors[name] = error
    assert errors['TEXCOORD_0'] == errors['TEXCOORD_1'] == 0
    assert errors['POSITION'] < 5e-6
    assert errors['NORMAL'] < .002 and errors['TANGENT'] < .002
    morph_error = {name: 0. for name in ('POSITION', 'NORMAL', 'TANGENT')}
    for a, b in zip(original.p['targets'], final.p['targets']):
        for name in morph_error:
            morph_error[name] = max(morph_error[name], float(np.abs(original.array(a[name]) - final.array(b[name])).max()))
    assert morph_error['POSITION'] < 2e-5
    assert morph_error['NORMAL'] < .004 and morph_error['TANGENT'] < .004
    load = lambda path: json.loads(path.read_text(encoding='utf-8-sig'))['Data']['RootChunk']
    hm, ht, pm, pt = map(load, (mesh_source, morph_source, mesh_json, morph_json))
    source_mesh = skin_rows(hm['renderResourceBlob'], hm['boneNames'])
    source_morph = skin_rows(ht['blob']['Data']['baseBlob'], hm['boneNames'])
    plate_mesh = skin_rows(pm['renderResourceBlob'], pm['boneNames'])
    plate_morph = skin_rows(pt['blob']['Data']['baseBlob'], pm['boneNames'])
    assert all(plate_mesh[i] == source_mesh[j] for i, j in enumerate(indices))
    assert all(plate_morph[i] == source_morph[j] for i, j in enumerate(indices))
    assert plate_mesh == plate_morph
    return {'exactNativeSkinBytesMesh': True, 'exactNativeSkinBytesMorphBase': True,
            'meshMorphSkinRowsEqual': True, 'triangleIndicesEqual': True,
            'baseAttributeMaximumAbsoluteError': errors, 'morphMaximumAbsoluteError': morph_error,
            'serializedResourceProof': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--derived', type=Path, required=True, help='Output directory from derive.py')
    parser.add_argument('--native-mesh-json', type=Path, required=True)
    parser.add_argument('--native-morph-json', type=Path, required=True)
    parser.add_argument('--wolvenkit', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='Ignored private output directory')
    args = parser.parse_args()
    selection = json.loads((HERE / 'selection.json').read_text())
    assert sha(args.native_mesh_json) == selection['sourceHeadMeshSha256']
    assert sha(args.native_morph_json) == selection['sourceHeadMorphSha256']
    source = args.derived / f'{NAME}.glb'
    mapping = args.derived / 'vertex-map.json'
    derivation = json.loads((args.derived / 'derivation.json').read_text())
    assert derivation['selectionSha256'] == sha(HERE / 'selection.json')
    assert sha(source) == derivation['output']['sha256']
    vertex_ids = json.loads(mapping.read_text())['plateToHeadIndices']
    assert hashlib.sha256(np.asarray(vertex_ids, '<u4').tobytes()).hexdigest() == derivation['sourceVertexIdsSha256']
    out = args.output
    if out.exists() and any(out.iterdir()):
        raise ValueError('Output directory must be new and empty')
    out.mkdir(parents=True, exist_ok=True)
    adapter_project = HQ / 'projects/xf-studio/tools/morph-import'
    adapter = adapter_project / 'bin/Debug/net9.0/MorphImport.dll'
    run(out, 'build-adapter', ['dotnet', 'build', adapter_project, '--nologo', '-v', 'quiet'])
    assert adapter.exists()
    templates = prepare(args.native_mesh_json, args.native_morph_json, Glb(source), out)
    resources = out / 'archive/axefrog/appearance_studio/studies'
    resources.mkdir(parents=True, exist_ok=True)
    run(out, 'deserialize-templates', [args.wolvenkit, 'convert', 'deserialize', templates, '-o', resources])
    env = os.environ.copy()
    env['GltfImportArgs__ImportFormat'] = 'Mesh'
    env['GltfImportArgs__ImportGarmentSupport'] = 'false'
    run(out, 'mesh-import', [args.wolvenkit, 'import', source, '-o', resources, '--keep'], env=env)
    imported = out / 'imported-json'
    retained = out / 'retained-json'
    for folder in (imported, retained):
        folder.mkdir(exist_ok=True)
    run(out, 'serialize-mesh', [args.wolvenkit, 'convert', 'serialize', resources / f'{NAME}.mesh', '-o', imported])
    mesh_transfer = preserve(args.native_mesh_json, imported / f'{NAME}.mesh.json', mapping, retained / f'{NAME}.mesh.json')
    run(out, 'restore-mesh-skin', [args.wolvenkit, 'convert', 'deserialize', retained, '-o', resources])
    # The morph importer resolves bone names through a private mesh archive.
    lookup = out / 'lookup/axefrog/appearance_studio/studies'
    lookup.mkdir(parents=True, exist_ok=True)
    shutil.copy2(resources / f'{NAME}.mesh', lookup / f'{NAME}.mesh')
    packed = out / 'packed'
    packed.mkdir(exist_ok=True)
    run(out, 'pack-resolver', [args.wolvenkit, 'pack', out / 'lookup', '-o', packed])
    roundtrip = out / 'roundtrip'
    roundtrip.mkdir(exist_ok=True)
    run(out, 'morph-import', ['dotnet', adapter, packed / 'lookup.archive', source,
                               resources / f'{NAME}.morphtarget', roundtrip / NAME])
    morph_imported = out / 'morph-imported-json'
    morph_retained = out / 'morph-retained-json'
    for folder in (morph_imported, morph_retained):
        folder.mkdir(exist_ok=True)
    run(out, 'serialize-morph', [args.wolvenkit, 'convert', 'serialize', resources / f'{NAME}.morphtarget', '-o', morph_imported])
    morph_transfer = preserve_morph(args.native_mesh_json, args.native_morph_json,
        retained / f'{NAME}.mesh.json', morph_imported / f'{NAME}.morphtarget.json', mapping,
        morph_retained / f'{NAME}.morphtarget.json')
    run(out, 'restore-morph-skin', [args.wolvenkit, 'convert', 'deserialize', morph_retained, '-o', resources])
    mesh_final = out / 'mesh-final-json'
    morph_final = out / 'morph-final-json'
    for folder in (mesh_final, morph_final):
        folder.mkdir(exist_ok=True)
    run(out, 'serialize-final-mesh', [args.wolvenkit, 'convert', 'serialize', resources / f'{NAME}.mesh', '-o', mesh_final])
    run(out, 'serialize-final-morph', [args.wolvenkit, 'convert', 'serialize', resources / f'{NAME}.morphtarget', '-o', morph_final])
    run(out, 'export-final', ['dotnet', adapter, '--export-bound', packed / 'lookup.archive',
                              resources / f'{NAME}.morphtarget', roundtrip / 'retained'])
    final_glb = roundtrip / 'retained.glb'
    checks = audit(source, final_glb, args.native_mesh_json, args.native_morph_json,
                   mesh_final / f'{NAME}.mesh.json', morph_final / f'{NAME}.morphtarget.json', mapping)
    report = {'schema': 'xfs/native-plate-roundtrip-1', 'sourceDerivedSha256': sha(source),
              'resources': {p.name: sha(p) for p in resources.glob(f'{NAME}.*')},
              'roundtripGlbSha256': sha(final_glb), 'meshTransfer': mesh_transfer,
              'morphTransfer': morph_transfer, 'checks': checks,
              'installed': False, 'gameRenderingVerified': False,
              'clearanceAccepted': False}
    (out / 'roundtrip-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'resources': report['resources'], 'checks': checks}, indent=2))


if __name__ == '__main__':
    main()
