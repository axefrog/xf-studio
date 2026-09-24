"""Independently verify a private native-preview-core candidate and its provenance."""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def glb(path):
    data = path.read_bytes()
    assert data[:4] == b'glTF' and struct.unpack_from('<I', data, 4)[0] == 2
    length, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4e4f534a
    doc = json.loads(data[20:20+length])
    start = 20+length
    binary_length, kind = struct.unpack_from('<II', data, start)
    assert kind == 0x004e4942
    binary = data[start+8:start+8+binary_length]
    assert len(binary) == binary_length
    return doc, binary


def array(doc, binary, index):
    accessor = doc['accessors'][index]
    assert not accessor.get('sparse')
    view = doc['bufferViews'][accessor['bufferView']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[accessor['type']]
    dtype = np.dtype({5121: 'u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[accessor['componentType']])
    row = width * dtype.itemsize
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    result = np.ndarray((accessor['count'], width), dtype=dtype, buffer=binary,
                        offset=offset, strides=(view.get('byteStride', row), dtype.itemsize)).copy()
    if accessor.get('normalized'):
        result = result.astype(np.float64) / np.iinfo(dtype).max
    return result


def inspect_glb(path, eye=False):
    doc, binary = glb(path)
    assert len(doc.get('skins', [])) == 1
    if eye:
        assert [m['name'] for m in doc['meshes']] == [
            'submesh_00_LOD_1_doubled', 'submesh_01_LOD_1', 'submesh_02_LOD_1']
        mesh = doc['meshes'][1]
        assert len(doc['skins'][0]['joints']) == 57
    else:
        assert len(doc['meshes']) == 1
        mesh = doc['meshes'][0]
    p = mesh['primitives'][0]
    attrs = p['attributes']
    assert all(name in attrs for name in ('POSITION', 'NORMAL', 'TEXCOORD_0',
                                         'TEXCOORD_1', 'JOINTS_0', 'WEIGHTS_0'))
    pos = array(doc, binary, attrs['POSITION'])
    uv = array(doc, binary, attrs['TEXCOORD_0'])
    indices = array(doc, binary, p['indices']).reshape(-1)
    weights = array(doc, binary, attrs['WEIGHTS_0'])
    assert np.isfinite(pos).all() and np.isfinite(uv).all()
    assert len(indices) % 3 == 0 and int(indices.max()) < len(pos)
    joints = array(doc, binary, attrs['JOINTS_0'])
    assert int(joints.max()) < len(doc['skins'][0]['joints'])
    if eye:
        assert np.max(np.abs(weights.sum(axis=1) - 1)) < 1e-5
        assert len(pos) == 668 and len(indices)//3 == 1292
        assert uv[:, 0].min() < -1 and uv[:, 0].max() > 1
        assert not p.get('targets')
    else:
        assert len(p['targets']) == 105
        assert 'JOINTS_1' in attrs and 'WEIGHTS_1' in attrs
        more = array(doc, binary, attrs['WEIGHTS_1'])
        assert np.max(np.abs((weights + more).sum(axis=1) - 1)) < 1e-5
    return {'vertices': len(pos), 'triangles': len(indices)//3,
            'joints': len(doc['skins'][0]['joints']), 'morphs': len(p.get('targets', [])),
            'uv0Bounds': [uv.min(axis=0).tolist(), uv.max(axis=0).tolist()]}


def verify(root):
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['schema'] == 'xfs/native-preview-core-candidate-1'
    assert manifest['installed'] is False
    assert digest(Path(manifest['provider'])) == manifest['providerSha256']
    assert digest(Path(manifest['wolvenkit']['path'])) == manifest['wolvenkit']['sha256']
    source = root / 'source'
    eye = root / 'eye-export'
    maps = root / 'maps'
    decoded = root / 'decoded'
    candidate = root / 'candidate'
    for key, entry in manifest['source'].items():
        location = eye if key == 'eyeMesh' else source
        assert digest(location / entry['depot']) == entry['sha256']
    gradient = manifest['eyeGradient']
    assert digest(maps / gradient['depot']) == gradient['sha256']
    assert gradient['convertedForThree'] is False
    for name, sha in manifest['candidate'].items():
        assert digest(candidate / name) == sha
    head_result = inspect_glb(candidate / 'head.glb')
    eye_result = inspect_glb(candidate / 'eyes.glb', eye=True)
    for name, entry in manifest['maps'].items():
        depot = entry['depot']
        raw = maps / depot
        png = decoded / Path(depot).with_suffix('.png').name
        output = candidate / (name + '.png')
        assert digest(raw) == entry['sourceSha256']
        metadata = json.loads((maps / (depot + '.json')).read_text(encoding='utf-8-sig'))
        assert metadata['Data']['RootChunk']['setup']['isGamma'] == (1 if name.endswith('albedo') else 0)
        assert digest(png) == entry['decodedSha256']
        assert digest(output) == entry['candidate']['sha256']
        source_pixels = np.asarray(Image.open(png).convert('RGBA'))
        target = np.asarray(Image.open(output).convert('RGB'))
        assert list(target.shape[:2][::-1]) == entry['candidate']['size']
        method = entry['candidate']['adapter']
        if method == 'srgb-copy':
            assert np.array_equal(source_pixels[:, :, :3], target)
        elif method in ('red-to-green', 'green-copy'):
            channel = 0 if method == 'red-to-green' else 1
            assert np.array_equal(source_pixels[:, :, channel], target[:, :, 1])
            assert np.array_equal(target[:, :, 0], target[:, :, 1])
            assert np.array_equal(target[:, :, 2], target[:, :, 1])
        elif method == 'rg-normal':
            x = source_pixels[:, :, 0].astype(float)/255*2-1
            y = -(source_pixels[:, :, 1].astype(float)/255*2-1)
            z = np.sqrt(np.maximum(0, 1-x*x-y*y))
            expected = np.rint(np.clip((np.stack((x,y,z), axis=-1)+1)*127.5, 0, 255)).astype('u1')
            assert np.array_equal(expected, target)
        else:
            raise ValueError(method)
    return {'head': head_result, 'eyes': eye_result, 'maps': len(manifest['maps']),
            'providerSha256': manifest['providerSha256'], 'verified': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', type=Path)
    result = verify(parser.parse_args().candidate)
    print(json.dumps(result, indent=2))
