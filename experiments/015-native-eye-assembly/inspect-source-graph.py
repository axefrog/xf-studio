"""Hash-gated, asset-free summary of the installed native head/eye source chain.

Requires ignored generated/graph-trace[-json]/ and generated/eye-morph-export/
from WolvenKit 8.17.4. Never emits source payloads or graphics.
"""
import hashlib
import json
import struct
from collections import Counter
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PRIVATE = HERE / 'generated'
TRACE = PRIVATE / 'graph-trace'
JSON = PRIVATE / 'graph-trace-json'
APP = 'base/characters/head/player_base_heads/appearances/entity/head/'
MORPH = 'base/characters/head/player_base_heads/player_female_average/'
SOURCES = {
    'headEntity': (APP + 'h0_000_pwa__basehead.ent', '5253592dc4a551df90ca3a3d20a6354839c55fe3e3567896aa3fb76bb4f37fa9'),
    'eyeEntity': (APP + 'he_000_pwa__basehead.ent', '72271a32f542ed8beb30119ab5f8c2633649b664bf2fcdfb383549113d2b4bac'),
    'faceRigEntity': (APP + 'h0_000_pwa__basehead_face_rig.ent', '23ef863f0aff059d77cde3459387c3c048244f44ce885bfccb85a497efabd7be'),
    'headMorph': (MORPH + 'h0_000_pwa__morphs.morphtarget', '3e10c3f75fbefb0a9ddcf907a6275ca8a30aad915ad34acadb817ae4c9297b9e'),
    'eyeMorph': (MORPH + 'he_000_pwa__morphs.morphtarget', '42a19b6a4d2f4060f6785de525d8c55f663fb2a13db804cd84e929e5110d1323'),
    'faceGraph': ('base/animations/facial/_facial_graphs/player_woman_paperdoll_sermo.animgraph', '1e631615513459bad3389fff41488a0e98f2b875b6ad5da68c6dc9760d9c02c7'),
}
MORPH_GLB = PRIVATE / 'eye-morph-export' / (MORPH + 'he_000_pwa__morphs.morphtarget.glb')
PLAIN_GLB = HERE.parent / '013-native-preview-core/generated/visual-study/candidate/eyes.glb'
MORPH_GLB_SHA = '90ec2ee3396c598da5061d7d51f5945c34f7ccbff95246393e11c433e3fc3fdf'
PLAIN_GLB_SHA = '0e5420a75e5a65eded91bb68338860e119692f0868f78e7ef89c98c0c56eaeba'
V = '$value'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked(path, expected):
    actual = digest(path)
    assert actual == expected, f'{path}: {actual} != {expected}'
    return actual


def root(name):
    return json.loads((JSON / (name + '.json')).read_text())['Data']['RootChunk']


def value(obj):
    return obj[V]


def chunks(entity):
    return entity['compiledData']['Data']['Chunks']


def component(entity, name):
    return next(c for c in chunks(entity) if isinstance(c.get('name'), dict) and c['name'].get(V) == name)


def depot(ref):
    return value(ref['DepotPath']).replace('\\', '/').lower()


def glb(path):
    data = path.read_bytes()
    assert data[:4] == b'glTF' and struct.unpack_from('<I', data, 4)[0] == 2
    length = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + length])
    return doc, data[20 + length + 8:]


def positions(doc, binary, accessor_index):
    acc = doc['accessors'][accessor_index]
    assert acc['type'] == 'VEC3' and acc['componentType'] == 5126 and not acc.get('sparse')
    view = doc['bufferViews'][acc['bufferView']]
    return np.ndarray((acc['count'], 3), dtype='<f4', buffer=binary,
                      offset=view.get('byteOffset', 0) + acc.get('byteOffset', 0),
                      strides=(view.get('byteStride', 12), 4)).copy()


def matrix_map(target):
    return {value(name): matrix for name, matrix in zip(target['boneNames'], target['boneRigMatrices'])}


def collect_graph(node, names, types):
    if isinstance(node, dict):
        if node.get('$type') == 'CName' and isinstance(node.get(V), str):
            names[node[V]] += 1
        if isinstance(node.get('$type'), str):
            types[node['$type']] += 1
        for child in node.values():
            collect_graph(child, names, types)
    elif isinstance(node, list):
        for child in node:
            collect_graph(child, names, types)


def main():
    source_hashes = {label: checked(TRACE / path, expected)
                     for label, (path, expected) in SOURCES.items()}
    checked(MORPH_GLB, MORPH_GLB_SHA)
    checked(PLAIN_GLB, PLAIN_GLB_SHA)
    head_entity, eye_entity, rig_entity = [root(name) for name in
                                           ('h0_000_pwa__basehead.ent', 'he_000_pwa__basehead.ent',
                                            'h0_000_pwa__basehead_face_rig.ent')]
    head_component = component(head_entity, 'MorphTargetSkinnedMesh7243')
    eye_component = component(eye_entity, 'MorphTargetSkinnedMesh3637')
    assert depot(head_component['morphResource']) == SOURCES['headMorph'][0]
    assert depot(eye_component['morphResource']) == SOURCES['eyeMorph'][0]
    assert component(head_entity, 'face_rig')['$type'] == 'entExternalComponent'
    assert component(eye_entity, 'face_rig')['$type'] == 'entExternalComponent'
    rig = component(rig_entity, 'face_rig')
    ui = component(rig_entity, 'ui_animations')
    assert depot(rig['graph']) == SOURCES['faceGraph'][0]
    ui_sets = sorted({depot(entry['animSet']) for entry in ui['animations']['gameplay']})
    assert ui_sets == ['base/animations/ui/female/ui_female_face.anims']

    head_morph, eye_morph = [root(name) for name in
                             ('h0_000_pwa__morphs.morphtarget', 'he_000_pwa__morphs.morphtarget')]
    assert depot(eye_morph['baseMesh']) == 'base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/he_000_pwa_c__basehead.mesh'
    head_targets = {value(t['name']): t for t in head_morph['targets']}
    eye_targets = {value(t['name']): t for t in eye_morph['targets']}
    assert value(eye_targets['h091']['regionName']) == 'eyes'
    assert value(head_targets['h091']['regionName']) == 'eyes'
    head_joints, eye_joints = matrix_map(head_targets['h091']), matrix_map(eye_targets['h091'])
    shared = sorted(head_joints.keys() & eye_joints.keys())
    assert len(head_joints) == 254 and len(eye_joints) == 57 and len(shared) == 34
    assert all(head_joints[name] == eye_joints[name] for name in shared)

    morph_doc, morph_binary = glb(MORPH_GLB)
    plain_doc, plain_binary = glb(PLAIN_GLB)
    displacement = []
    for index, (morph_mesh, plain_mesh) in enumerate(zip(morph_doc['meshes'], plain_doc['meshes'])):
        primitive, other = morph_mesh['primitives'][0], plain_mesh['primitives'][0]
        names = morph_mesh['extras']['targetNames']
        assert names == [f'h{i:02}1_eyes' for i in range(1, 22)]
        base = positions(morph_doc, morph_binary, primitive['attributes']['POSITION'])
        plain = positions(plain_doc, plain_binary, other['attributes']['POSITION'])
        assert np.array_equal(base, plain)
        delta = positions(morph_doc, morph_binary, primitive['targets'][8]['POSITION'])
        lengths = np.linalg.norm(delta.astype(np.float64), axis=1)
        displacement.append({'chunk': index, 'vertices': len(base),
                             'changedVertices': int(np.count_nonzero(lengths > 1e-8)),
                             'maximumMm': round(float(lengths.max() * 1000), 6),
                             'meanMm': round(float(lengths.mean() * 1000), 6)})

    graph = root('player_woman_paperdoll_sermo.animgraph')
    names, types = Counter(), Counter()
    collect_graph(graph, names, types)
    report = {
        'sourceSha256': source_hashes,
        'morphGlbSha256': MORPH_GLB_SHA,
        'plainEyeGlbSha256': PLAIN_GLB_SHA,
        'entityBindings': {'headMorph': SOURCES['headMorph'][0], 'eyeMorph': SOURCES['eyeMorph'][0],
                           'sharedFaceRigBinding': 'face_rig', 'faceGraph': SOURCES['faceGraph'][0],
                           'uiFaceAnimSet': ui_sets},
        'morphTargets': {'headCount': len(head_targets), 'eyeCount': len(eye_targets),
                         'eyeNames': list(eye_targets), 'matchingH091Region': 'eyes',
                         'h091SharedJointMatrices': len(shared), 'h091SharedJointMatricesExact': True,
                         'h091EyeChunkDisplacement': displacement},
        'faceGraph': {'uiCloseupShotNameOccurrences': names['ui_closeup_shot'],
                      'uiCloseupShotEyesNameOccurrences': names['ui_closeup_shot_eyes'],
                      'eyeTracksLookAtNodes': types['animAnimNode_EyesTracksLookAt']},
    }
    out = HERE / 'source-graph-evidence.json'
    out.write_text(json.dumps(report, indent=2) + '\n')
    print(out)


if __name__ == '__main__':
    main()
