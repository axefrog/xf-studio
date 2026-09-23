"""Build isolated normal-offset plate candidates, preserving experiment 004's zero control."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import time
import numpy as np

HERE = Path(__file__).resolve().parent
HQ = HERE.parents[1]
BASE = HQ/'experiments/004-plate-import'
sys.path.insert(0, str(BASE))
from verify_roundtrip import Glb

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def run(folder, label, command, env=None):
    process = subprocess.run([str(x) for x in command], cwd=HQ, env=env, capture_output=True,
        encoding='utf-8', errors='replace', timeout=240)
    log = process.stdout+'\n'+process.stderr
    (folder/'logs').mkdir(parents=True, exist_ok=True)
    (folder/'logs'/f'{label}.log').write_text(log, encoding='utf-8')
    if process.returncode or re.search(r'\bError\s*\]|Unhandled exception|Traceback \(', log):
        raise RuntimeError(f'{folder.name}/{label}: {process.returncode}\n{log[-3000:]}')
    print(f'{folder.name}/{label}: complete', flush=True)

def offset_plate(source, output, amount, head_path=None):
    """Offset each individual target along its normal; retain original shading and weights."""
    plate = Glb(source)
    binary = bytearray(plate.bin)
    def replace(index, values):
        accessor = plate.doc['accessors'][index]
        view = plate.doc['bufferViews'][accessor['bufferView']]
        assert accessor['componentType'] == 5126 and 'byteStride' not in view and 'sparse' not in accessor
        assert values.shape == plate.array(index).shape and np.isfinite(values).all()
        data = values.astype('<f4')
        start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        binary[start:start+data.nbytes] = data.tobytes()
        accessor['min'] = data.min(axis=0).astype(float).tolist()
        accessor['max'] = data.max(axis=0).astype(float).tolist()
    def unit(v):
        length = np.linalg.norm(v, axis=1)
        assert length.min() > .1
        return v / length[:, None]
    normal = plate.attr('NORMAL')
    direction = unit(normal)
    geometric = None
    if head_path:
        head = Glb(head_path)
        mapping = json.loads((BASE/'head-shading-transfer.json').read_text())['plateToHeadIndices']
        faces = head.array(head.p['indices']).astype(int).reshape(-1,3)
        def geometric(points):
            corners = points[faces]
            face_normals = np.cross(corners[:,1]-corners[:,0],corners[:,2]-corners[:,0])
            lengths = np.linalg.norm(face_normals,axis=1)
            face_normals /= np.maximum(lengths,1e-30)[:,None]
            total = np.zeros_like(points)
            for corner in range(3):
                a = corners[:,(corner+1)%3]-corners[:,corner]
                b = corners[:,(corner+2)%3]-corners[:,corner]
                angle = np.arctan2(np.linalg.norm(np.cross(a,b),axis=1),np.sum(a*b,axis=1))
                np.add.at(total,faces[:,corner],face_normals*angle[:,None])
            chosen = total[mapping]
            length = np.linalg.norm(chosen,axis=1)
            assert length.min()>1e-8, 'Geometric normal is undefined'
            return chosen/length[:,None]
        direction = geometric(head.attr('POSITION'))
    replace(plate.p['attributes']['POSITION'], plate.attr('POSITION') + amount*direction)
    for index,target in enumerate(plate.p['targets']):
        moved = geometric(head.attr('POSITION')+head.array(head.p['targets'][index]['POSITION'])) if geometric else unit(normal + plate.array(target['NORMAL']))
        replace(target['POSITION'], plate.array(target['POSITION']) + amount*(moved-direction))
    doc = json.dumps(plate.doc, separators=(',', ':')).encode()
    doc += b' '*(-len(doc) % 4)
    binary += b'\0'*(-len(binary) % 4)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(struct.pack('<4sII', b'glTF', 2, 28+len(doc)+len(binary)) +
        struct.pack('<II', len(doc), 0x4e4f534a) + doc + struct.pack('<II', len(binary), 0x004e4942) + binary)
    candidate = Glb(output)
    original = Glb(source)
    for name in original.p['attributes']:
        if name != 'POSITION': assert np.array_equal(original.attr(name), candidate.attr(name)), name
    for old, new in zip(original.p['targets'], candidate.p['targets']):
        for name in ['NORMAL', 'TANGENT']: assert np.array_equal(original.array(old[name]), candidate.array(new[name]))
    assert np.array_equal(original.array(original.p['indices']), candidate.array(candidate.p['indices']))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--offsets', nargs='+', type=float, default=[.00005, .0001])
    parser.add_argument('--method', choices=['shading','geometry'], default='shading')
    args = parser.parse_args()
    assert len(set(args.offsets)) == len(args.offsets) and all(0 < x <= .001 for x in args.offsets)
    out = HERE/'generated'/f'build-{time.time_ns()}'
    out.mkdir(parents=True)
    source = BASE/'generated/raw/xfas_eye_plate.glb'
    assert sha(source) == json.loads((BASE/'head-shading-transfer.json').read_text())['output']['sha256']
    source_hash = sha(source)
    wk = Path('F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe')
    adapter = HQ/'projects/xf-appearance-studio/tools/morph-import/bin/Debug/net9.0/MorphImport.dll'
    run(out, 'build-adapter', ['dotnet', 'build', HQ/'projects/xf-appearance-studio/tools/morph-import', '--nologo', '-v', 'quiet'])
    # Morph export needs its original mesh archive to recover bones/weights, too.
    head_json = json.loads((HQ/'research/consumers/eye-plate/json/h0_000_pwa__morphs.morphtarget.json').read_text(encoding='utf-8-sig'))
    head_depot = Path(head_json['Data']['RootChunk']['baseMesh']['DepotPath']['$value'].replace('\\','/'))
    head_mesh = HQ/'research/consumers/eye-plate/extracted'/head_depot
    target = out/'head-lookup'/head_depot
    target.parent.mkdir(parents=True)
    shutil.copy2(head_mesh, target)
    (out/'head-packed').mkdir()
    run(out, 'head-resolver', [wk, 'pack', out/'head-lookup', '-o', out/'head-packed'])
    head_morph = HQ/'research/consumers/eye-plate/extracted/base/characters/head/player_base_heads/player_female_average/h0_000_pwa__morphs.morphtarget'
    run(out, 'bound-head', ['dotnet', adapter, '--export-bound', out/'head-packed/head-lookup.archive', head_morph, out/'head'])
    bound_head = out/'head.glb'
    unbound, bound = Glb(BASE/'generated/roundtrip/vanilla_head.glb'), Glb(bound_head)
    assert len(bound.doc['skins']) == 1
    for name in unbound.p['attributes']: assert np.array_equal(unbound.attr(name), bound.attr(name))
    assert np.array_equal(unbound.array(unbound.p['indices']), bound.array(bound.p['indices']))
    for old, new in zip(unbound.p['targets'], bound.p['targets']):
        for name in old: assert np.array_equal(unbound.array(old[name]), bound.array(new[name]))
    depot = Path('axefrog/appearance_studio/studies')
    candidates = []
    for amount in args.offsets:
        key = f'{args.method}-{amount:.8f}'
        folder = out/key
        for part in ['raw', 'archive', 'lookup', 'packed', 'roundtrip', 'logs']:
            (folder/part).mkdir(parents=True)
        glb = folder/'raw/xfas_eye_plate.glb'
        offset_plate(source, glb, amount, bound_head if args.method=='geometry' else None)
        resources = folder/'archive'/depot
        resources.mkdir(parents=True)
        for kind in ['mesh', 'morphtarget']:
            shutil.copy2(BASE/'generated/archive'/depot/f'xfas_eye_plate.{kind}', resources)
        env = os.environ.copy()
        env['GltfImportArgs__ImportFormat'] = 'Mesh'
        env['GltfImportArgs__ImportGarmentSupport'] = 'false'
        run(folder, 'mesh-import', [wk, 'import', glb, '-o', resources, '--keep'], env)
        lookup = folder/'lookup'/depot
        lookup.mkdir(parents=True)
        shutil.copy2(resources/'xfas_eye_plate.mesh', lookup)
        run(folder, 'pack-resolver', [wk, 'pack', folder/'lookup', '-o', folder/'packed'])
        run(folder, 'morph-import', ['dotnet', adapter, folder/'packed/lookup.archive', glb,
            resources/'xfas_eye_plate.morphtarget', folder/'roundtrip/xfas_eye_plate'])
        roundtrip = folder/'roundtrip/xfas_eye_plate.glb'
        assert roundtrip.exists()
        candidates.append({'name': key, 'offset': amount, 'source': str(glb), 'roundtrip': str(roundtrip),
            'resources': [{'path': str(p), 'sha256': sha(p), 'bytes': p.stat().st_size} for p in resources.iterdir()]})
    assert sha(source) == source_hash
    report = {'root': str(out), 'method': args.method, 'source': str(source), 'sourceSha256': source_hash,
        'head': str(bound_head), 'headSourceSha256': {'mesh': sha(head_mesh), 'morph': sha(head_morph)},
        'zeroControl': str(BASE/'generated/roundtrip/xfas_eye_plate.glb.glb'),
        'mapping': str(BASE/'head-shading-transfer.json'), 'candidates': candidates,
        'installed': False, 'validated': False}
    (out/'build.json').write_text(json.dumps(report, indent=2)+'\n')
    (HERE/'latest-build.json').write_text(json.dumps({'root': str(out), 'validated': False}, indent=2)+'\n')
    print(f'Built {len(candidates)} candidates in {out}', flush=True)

if __name__ == '__main__': main()
