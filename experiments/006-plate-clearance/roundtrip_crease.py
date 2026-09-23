"""Serialize one ignored morph-aware plate field without changing the owned master."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import time

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent / '004-plate-import'))
from verify_roundtrip import Glb
from build import run
from retain_head_weights import preserve, preserve_morph


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_glb(source, destination, base_change, morph_change):
    glb = Glb(source)
    assert len(glb.p['targets']) == len(morph_change) == 105
    binary = bytearray(glb.bin)

    def replace(index, values):
        accessor = glb.doc['accessors'][index]
        view = glb.doc['bufferViews'][accessor['bufferView']]
        assert accessor['componentType'] == 5126 and 'byteStride' not in view and 'sparse' not in accessor
        assert values.shape == glb.array(index).shape and np.isfinite(values).all()
        data = np.asarray(values, dtype='<f4')
        start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        binary[start:start + data.nbytes] = data.tobytes()
        accessor['min'] = data.min(axis=0).astype(float).tolist()
        accessor['max'] = data.max(axis=0).astype(float).tolist()

    replace(glb.p['attributes']['POSITION'], glb.attr('POSITION').astype(float) + base_change)
    for target, correction in zip(glb.p['targets'], morph_change):
        replace(target['POSITION'], glb.array(target['POSITION']).astype(float) + correction)
    document = json.dumps(glb.doc, separators=(',', ':')).encode()
    document += b' ' * (-len(document) % 4)
    binary += b'\0' * (-len(binary) % 4)
    destination.write_bytes(struct.pack('<4sII', b'glTF', 2, 28 + len(document) + len(binary)) +
                            struct.pack('<II', len(document), 0x4e4f534a) + document +
                            struct.pack('<II', len(binary), 0x004e4942) + binary)


def root_data(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))['Data']['RootChunk']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--source-build', type=Path, required=True)
    args = parser.parse_args()
    assert sha(args.candidate).lower() == args.sha256.lower()
    source_build = json.loads((args.source_build / 'build.json').read_text())
    assert source_build['preserveHeadWeights']
    source = next(c for c in source_build['candidates'] if c['name'] == 'geometry-0.00005000')
    assert source['weightTransfer']['binaryRoundtripSkinBufferExact']
    assert source['weightTransfer']['morphBaseBuffer']['binaryRoundtripSkinBufferExact']
    source_glb = Path(source['roundtrip'])
    data = np.load(args.candidate)
    mapping = np.asarray(json.loads(Path(source_build['mapping']).read_text())['plateToHeadIndices'])
    np.testing.assert_array_equal(data['mapping'], mapping)
    assert data['baseChange'].shape == (len(mapping), 3)
    assert data['morphChange'].shape == (105, len(mapping), 3)
    out = HERE / 'generated' / f'roundtrip-crease-{time.time_ns()}'
    out.mkdir(parents=True)
    for part in ['raw', 'archive', 'lookup', 'packed', 'roundtrip', 'logs',
                 'imported-json', 'retained-json', 'retained-roundtrip-json',
                 'morph-imported-json', 'morph-retained-json', 'morph-retained-roundtrip-json']:
        (out / part).mkdir()
    raw = out / 'raw/xfas_eye_plate.glb'
    write_glb(source_glb, raw, data['baseChange'], data['morphChange'])
    source_hq = Path(source_build['root']).parents[3]
    depot = Path('axefrog/appearance_studio/studies')
    resources = out / 'archive' / depot
    resources.mkdir(parents=True)
    for kind in ['mesh', 'morphtarget']:
        shutil.copy2(Path(source['resources'][0]['path']).parent / f'xfas_eye_plate.{kind}', resources)
    wk = Path('F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe')
    adapter_project = ROOT / 'projects/xf-appearance-studio/tools/morph-import'
    run(out, 'build-adapter', ['dotnet', 'build', adapter_project, '--nologo', '-v', 'quiet'])
    adapter = adapter_project / 'bin/Debug/net9.0/MorphImport.dll'
    env = os.environ.copy()
    env['GltfImportArgs__ImportFormat'] = 'Mesh'
    env['GltfImportArgs__ImportGarmentSupport'] = 'false'
    run(out, 'mesh-import', [wk, 'import', raw, '-o', resources, '--keep'], env)
    run(out, 'serialize-mesh', [wk, 'convert', 'serialize', resources / 'xfas_eye_plate.mesh', '-o', out / 'imported-json'])
    head_mesh_json = source_hq / 'research/consumers/eye-plate/json/h0_000_pwa_c__basehead.mesh.json'
    head_morph_json = source_hq / 'research/consumers/eye-plate/json/h0_000_pwa__morphs.morphtarget.json'
    mesh_audit = preserve(head_mesh_json, out / 'imported-json/xfas_eye_plate.mesh.json',
                          source_build['mapping'], out / 'retained-json/xfas_eye_plate.mesh.json')
    run(out, 'restore-mesh-skin', [wk, 'convert', 'deserialize', out / 'retained-json', '-o', resources])
    run(out, 'verify-mesh-skin', [wk, 'convert', 'serialize', resources / 'xfas_eye_plate.mesh', '-o', out / 'retained-roundtrip-json'])
    a, b = [root_data(p) for p in [out / 'retained-json/xfas_eye_plate.mesh.json', out / 'retained-roundtrip-json/xfas_eye_plate.mesh.json']]
    assert a['renderResourceBlob']['Data']['renderBuffer']['Bytes'] == b['renderResourceBlob']['Data']['renderBuffer']['Bytes']
    assert a['boneNames'] == b['boneNames']
    mesh_audit['binaryRoundtripSkinBufferExact'] = True
    lookup = out / 'lookup' / depot
    lookup.mkdir(parents=True)
    shutil.copy2(resources / 'xfas_eye_plate.mesh', lookup)
    run(out, 'pack-resolver', [wk, 'pack', out / 'lookup', '-o', out / 'packed'])
    run(out, 'morph-import', ['dotnet', adapter, out / 'packed/lookup.archive', raw,
                              resources / 'xfas_eye_plate.morphtarget', out / 'roundtrip/xfas_eye_plate'])
    run(out, 'serialize-morph', [wk, 'convert', 'serialize', resources / 'xfas_eye_plate.morphtarget', '-o', out / 'morph-imported-json'])
    morph_audit = preserve_morph(head_mesh_json, head_morph_json,
                                 out / 'retained-roundtrip-json/xfas_eye_plate.mesh.json',
                                 out / 'morph-imported-json/xfas_eye_plate.morphtarget.json',
                                 source_build['mapping'], out / 'morph-retained-json/xfas_eye_plate.morphtarget.json')
    run(out, 'restore-morph-skin', [wk, 'convert', 'deserialize', out / 'morph-retained-json', '-o', resources])
    run(out, 'verify-morph-skin', [wk, 'convert', 'serialize', resources / 'xfas_eye_plate.morphtarget', '-o', out / 'morph-retained-roundtrip-json'])
    a, b = [root_data(p)['blob']['Data'] for p in [out / 'morph-retained-json/xfas_eye_plate.morphtarget.json',
                                                     out / 'morph-retained-roundtrip-json/xfas_eye_plate.morphtarget.json']]
    assert a['baseBlob']['Data']['renderBuffer']['Bytes'] == b['baseBlob']['Data']['renderBuffer']['Bytes']
    assert a['diffsBuffer']['Bytes'] == b['diffsBuffer']['Bytes']
    assert a['mappingBuffer']['Bytes'] == b['mappingBuffer']['Bytes']
    morph_audit['binaryRoundtripSkinBufferExact'] = True
    run(out, 'export-retained-morph', ['dotnet', adapter, '--export-bound', out / 'packed/lookup.archive',
                                        resources / 'xfas_eye_plate.morphtarget', out / 'roundtrip/xfas_eye_plate'])
    report = {'root': str(out), 'candidate': str(args.candidate), 'candidateSha256': sha(args.candidate),
              'sourceBuild': str(args.source_build), 'sourceGlb': str(source_glb), 'sourceGlbSha256': sha(source_glb),
              'head': source_build['head'], 'mapping': source_build['mapping'],
              'raw': str(raw), 'roundtrip': str(out / 'roundtrip/xfas_eye_plate.glb'),
              'meshSkin': mesh_audit, 'morphSkin': morph_audit,
              'resources': [{'path': str(p), 'sha256': sha(p), 'bytes': p.stat().st_size} for p in resources.iterdir()],
              'installed': False, 'approvedAsMaster': False}
    (out / 'build.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'root': str(out), 'resources': report['resources']}))


if __name__ == '__main__':
    main()
