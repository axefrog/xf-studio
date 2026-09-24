"""Extract an eye plate from the 2.31 native female head without Blender.

The compact GLB is an import input, not a game resource. Outputs contain game
data and must remain under an ignored directory.
"""
import argparse
import base64
import copy
import hashlib
import json
import struct
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / '004-plate-import'))
from verify_roundtrip import Glb  # noqa: E402


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def source_skin_rows(document, morph=False):
    root = document['Data']['RootChunk']
    blob = root['blob']['Data']['baseBlob'] if morph else root['renderResourceBlob']
    data = blob['Data']
    chunk = data['header']['renderChunkInfos'][0]
    layout = chunk['chunkVertices']['vertexLayout']
    raw = base64.b64decode(data['renderBuffer']['Bytes'])
    stride = layout['slotStrides']['Elements'][0]
    start = chunk['chunkVertices']['byteOffsets']['Elements'][0]
    size = {'PT_Short4N': 8, 'PT_UByte4': 4, 'PT_UByte4N': 4, 'PT_Float16_4': 8}
    offsets = {}
    cursor = 0
    for element in layout['elements']['Elements']:
        if element['streamType'] == 'ST_PerVertex' and element['streamIndex'] == 0:
            if element['usage'] in ('PS_SkinIndices', 'PS_SkinWeights'):
                offsets[element['usage'], element['usageIndex']] = cursor
            cursor += size[element['type']]
    assert cursor == stride and set(offsets) == {(k, s) for k in ('PS_SkinIndices', 'PS_SkinWeights') for s in (0, 1)}
    rows = []
    for vertex in range(chunk['numVertices']):
        row = b''.join(raw[start + vertex * stride + offsets[k, s]:start + vertex * stride + offsets[k, s] + 4]
                       for s in (0, 1) for k in ('PS_SkinIndices', 'PS_SkinWeights'))
        assert len(row) == 16
        rows.append(row)
    return rows


def chosen_faces(head, selection):
    faces = head.array(head.p['indices']).astype(np.int64).reshape(-1, 3)
    ids = [i for first, last in selection['faceRangesInclusive'] for i in range(first, last + 1)]
    assert len(ids) == selection['expectedFaces'] == len(set(ids))
    assert ids == sorted(ids) and min(ids) >= 0 and max(ids) < len(faces)
    picked = faces[ids]
    vertices = np.unique(picked)
    assert len(vertices) == selection['expectedVertices']
    return ids, picked, vertices


def topology(faces, vertex_count):
    edges = Counter(tuple(sorted((int(a), int(b)))) for face in faces
                    for a, b in ((face[0], face[1]), (face[1], face[2]), (face[2], face[0])))
    assert set(edges.values()) <= {1, 2} and 1 in edges.values()
    graph = defaultdict(set)
    for a, b in edges:
        graph[a].add(b)
        graph[b].add(a)
    unseen = set(range(vertex_count))
    components = []
    while unseen:
        seed = min(unseen)
        stack = [seed]
        unseen.remove(seed)
        count = 0
        while stack:
            count += 1
            for neighbor in graph[stack.pop()]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    stack.append(neighbor)
        components.append(count)
    boundary = [(a, b) for (a, b), count in edges.items() if count == 1]
    degree = Counter(v for edge in boundary for v in edge)
    assert set(degree.values()) == {2}, 'Open boundary must form closed loops'
    boundary_graph = defaultdict(set)
    for a, b in boundary:
        boundary_graph[a].add(b)
        boundary_graph[b].add(a)
    remaining = set(boundary_graph)
    loops = 0
    while remaining:
        loops += 1
        stack = [remaining.pop()]
        while stack:
            for neighbor in boundary_graph[stack.pop()]:
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    stack.append(neighbor)
    return {'componentVertexCounts': sorted(components), 'boundaryEdges': len(boundary),
            'boundaryLoops': loops,
            'nonManifoldEdges': sum(n > 2 for n in edges.values())}


def compact_glb(head, picked, vertices, output):
    doc = copy.deepcopy(head.doc)
    assert len(doc['buffers']) == len(doc['meshes']) == 1
    assert all(view['buffer'] == 0 for view in doc['bufferViews'])
    binary = bytearray(head.bin)
    remap = {int(old): new for new, old in enumerate(vertices)}
    compact_faces = np.array([[remap[int(v)] for v in face] for face in picked], dtype=np.uint32)
    primitive = doc['meshes'][0]['primitives'][0]

    def append_accessor(index, rows):
        accessor = doc['accessors'][index]
        old_view = head.doc['bufferViews'][accessor['bufferView']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[accessor['type']]
        dtype = np.dtype({5120: 'i1', 5121: 'u1', 5122: '<i2', 5123: '<u2',
                          5125: '<u4', 5126: '<f4'}[accessor['componentType']])
        row_size = width * dtype.itemsize
        stride = old_view.get('byteStride', row_size)
        start = old_view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        packed = b''.join(head.bin[start + int(row) * stride:start + int(row) * stride + row_size] for row in rows)
        assert len(packed) == len(rows) * row_size
        binary.extend(b'\0' * (-len(binary) % 4))
        offset = len(binary)
        binary.extend(packed)
        view = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(packed)}
        doc['bufferViews'].append(view)
        accessor['bufferView'] = len(doc['bufferViews']) - 1
        accessor['byteOffset'] = 0
        accessor['count'] = len(rows)
        for key in ('min', 'max'):
            accessor.pop(key, None)

    for index in primitive['attributes'].values():
        append_accessor(index, vertices)
    for target in primitive['targets']:
        for index in target.values():
            append_accessor(index, vertices)
    index_accessor = doc['accessors'][primitive['indices']]
    assert index_accessor['componentType'] in (5123, 5125)
    # Index values are newly remapped; append them separately rather than
    # copying the original face-corner bytes.
    binary.extend(b'\0' * (-len(binary) % 4))
    offset = len(binary)
    dtype = '<u2' if index_accessor['componentType'] == 5123 else '<u4'
    encoded = compact_faces.astype(dtype).tobytes()
    binary.extend(encoded)
    doc['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(encoded)})
    index_accessor['bufferView'] = len(doc['bufferViews']) - 1
    index_accessor['byteOffset'] = 0
    index_accessor['count'] = compact_faces.size
    index_accessor.pop('min', None)
    index_accessor.pop('max', None)
    doc['buffers'][0]['byteLength'] = len(binary)
    encoded_doc = json.dumps(doc, separators=(',', ':')).encode()
    encoded_doc += b' ' * (-len(encoded_doc) % 4)
    binary.extend(b'\0' * (-len(binary) % 4))
    output.write_bytes(struct.pack('<4sII', b'glTF', 2, 28 + len(encoded_doc) + len(binary)) +
                       struct.pack('<II', len(encoded_doc), 0x4e4f534a) + encoded_doc +
                       struct.pack('<II', len(binary), 0x004e4942) + binary)
    return compact_faces


def derive(head_path, mesh_path, morph_path, output):
    selection = json.loads((HERE / 'selection.json').read_text())
    assert sha(mesh_path) == selection['sourceHeadMeshSha256'], 'Native mesh revision differs; audit selection first'
    assert sha(morph_path) == selection['sourceHeadMorphSha256'], 'Native morph revision differs; audit selection first'
    assert sha(head_path) == selection['expectedBoundHeadGlbSha256'], 'Bound head export differs; audit triangle IDs first'
    head = Glb(head_path)
    assert len(head.doc.get('skins', [])) == 1 and len(head.mesh['extras']['targetNames']) == selection['expectedMorphs']
    assert set(head.p['attributes']) >= {'POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'TEXCOORD_1',
                                         'JOINTS_0', 'JOINTS_1', 'WEIGHTS_0', 'WEIGHTS_1'}
    ids, picked, vertices = chosen_faces(head, selection)
    mesh = json.loads(Path(mesh_path).read_text(encoding='utf-8-sig'))
    morph = json.loads(Path(morph_path).read_text(encoding='utf-8-sig'))
    mesh_skin, morph_skin = source_skin_rows(mesh), source_skin_rows(morph, morph=True)
    assert len(mesh_skin) == len(morph_skin) == len(head.attr('POSITION'))
    assert all(mesh_skin[i] == morph_skin[i] for i in vertices), 'Native mesh/morph base skin bytes differ'
    native_indices = np.asarray([list(row[:4]) + list(row[8:12]) for row in mesh_skin], dtype=int)
    native_weights = np.asarray([list(row[4:8]) + list(row[12:16]) for row in mesh_skin], dtype=float)
    bone_names = [entry['$value'] for entry in mesh['Data']['RootChunk']['boneNames']]
    exported_names = head.bones()
    assert len(set(bone_names)) == len(bone_names) == len(exported_names)
    remap = np.asarray([exported_names.index(name) for name in bone_names])
    glb_indices = np.concatenate([head.attr('JOINTS_0'), head.attr('JOINTS_1')], axis=1).astype(int)
    glb_weights = np.concatenate([head.attr('WEIGHTS_0'), head.attr('WEIGHTS_1')], axis=1)
    np.testing.assert_array_equal(glb_indices, remap[native_indices])
    weight_error = float(np.abs(glb_weights - native_weights / native_weights.sum(axis=1)[:, None]).max())
    assert weight_error < 2e-7, 'Bound GLB vertex order/weights differ from native resource'
    output.mkdir(parents=True, exist_ok=True)
    path = output / 'xfs_bootstrap_eye_plate.glb'
    compact_faces = compact_glb(head, picked, vertices, path)
    plate = Glb(path)
    for name in head.p['attributes']:
        np.testing.assert_array_equal(plate.attr(name), head.attr(name)[vertices])
    for left, right in zip(plate.p['targets'], head.p['targets']):
        for name in left:
            np.testing.assert_array_equal(plate.array(left[name]), head.array(right[name])[vertices])
    np.testing.assert_array_equal(plate.array(plate.p['indices']).astype(int).reshape(-1, 3), compact_faces)
    (output / 'vertex-map.json').write_text(json.dumps({'plateToHeadIndices': vertices.tolist()}, separators=(',', ':')) + '\n')
    shape_topology = topology(compact_faces, len(vertices))
    assert shape_topology == selection['expectedTopology'], 'Selection coverage/topology drifted'
    corners = plate.attr('POSITION')[compact_faces]
    area = np.linalg.norm(np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]), axis=1) / 2
    assert float(area.min()) > 1e-10
    minimum_morph_area = float('inf')
    for target in plate.p['targets']:
        moved = (plate.attr('POSITION') + plate.array(target['POSITION']))[compact_faces]
        target_area = np.linalg.norm(np.cross(moved[:, 1] - moved[:, 0], moved[:, 2] - moved[:, 0]), axis=1) / 2
        minimum_morph_area = min(minimum_morph_area, float(target_area.min()))
    assert minimum_morph_area > 1e-10
    report = {'schema': 'xfs/native-plate-derivation-1', 'source': {'headGlbSha256': sha(head_path),
              'nativeMeshSha256': sha(mesh_path), 'nativeMorphSha256': sha(morph_path)},
              'selectionSha256': sha(HERE / 'selection.json'), 'output': {'sha256': sha(path),
              'relativePath': path.name}, 'sourceFaceIdsSha256': hashlib.sha256(np.asarray(ids, '<u4').tobytes()).hexdigest(),
              'sourceVertexIdsSha256': hashlib.sha256(vertices.astype('<u4').tobytes()).hexdigest(),
              'vertexCount': len(vertices), 'triangleCount': len(picked), 'morphCount': len(plate.p['targets']),
              'topology': shape_topology, 'minimumBaseTriangleArea': float(area.min()),
              'minimumIndividualMorphTriangleArea': minimum_morph_area,
              'uv0Exact': True, 'allMorphAccessorsExact': True,
              'nativeSkin': {'meshSelectedRowsSha256': hashlib.sha256(b''.join(mesh_skin[i] for i in vertices)).hexdigest(),
                             'morphSelectedRowsSha256': hashlib.sha256(b''.join(morph_skin[i] for i in vertices)).hexdigest(),
                             'sourceMeshMorphRowsEqual': True, 'boundGlbNativeIndexOrderExact': True,
                             'boundGlbNormalizedWeightMaximumError': weight_error,
                             'serializedCandidateResourcesVerified': False},
              'limits': ['This neutral cut has zero designed skin clearance.',
                         'GLB weights are exporter-normalized; exact native resource bytes require a later mesh/morph import and independent round-trip audit.',
                         'No game rendering or animation clearance is established.']}
    (output / 'derivation.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--head-glb', type=Path, required=True, help='Bound native female head GLB from installed resources')
    parser.add_argument('--native-mesh-json', type=Path, required=True)
    parser.add_argument('--native-morph-json', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='Ignored private output directory')
    args = parser.parse_args()
    result = derive(args.head_glb, args.native_mesh_json, args.native_morph_json, args.output)
    print(json.dumps({k: v for k, v in result.items() if k not in ('source', 'limits')}, indent=2))
