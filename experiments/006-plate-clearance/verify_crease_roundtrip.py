"""Independent audit of serialized crease candidate and sampled contacts."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / '004-plate-import'), str(HERE)]
from verify_roundtrip import Glb
from triangles import contacts, intersect_pairs, self_test


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def skin_rows(blob, bone_names):
    """Decode both packed native skin streams without using the transfer adapter."""
    data = blob['Data']
    chunk = data['header']['renderChunkInfos'][0]
    layout = chunk['chunkVertices']['vertexLayout']
    stream = base64.b64decode(data['renderBuffer']['Bytes'])
    stride = layout['slotStrides']['Elements'][0]
    start = chunk['chunkVertices']['byteOffsets']['Elements'][0]
    sizes = {'PT_Short4N': 8, 'PT_UByte4': 4, 'PT_UByte4N': 4, 'PT_Float16_4': 8}
    offsets = {}
    cursor = 0
    for element in layout['elements']['Elements']:
        if element['streamIndex'] == 0 and element['streamType'] == 'ST_PerVertex':
            if element['usage'] in ('PS_SkinIndices', 'PS_SkinWeights'):
                offsets[(element['usage'], element['usageIndex'])] = cursor
            cursor += sizes[element['type']]
    assert cursor == stride and len(offsets) == 4
    names = [item['$value'] for item in bone_names]
    rows = []
    for vertex in range(chunk['numVertices']):
        indices, weights = [], []
        for slot in (0, 1):
            base = start + vertex * stride
            indices.extend(stream[base + offsets['PS_SkinIndices', slot]:base + offsets['PS_SkinIndices', slot] + 4])
            weights.extend(stream[base + offsets['PS_SkinWeights', slot]:base + offsets['PS_SkinWeights', slot] + 4])
        rows.append((tuple(names[i] for i in indices), bytes(weights)))
    return rows


def new_pairs(plate_triangles, head_triangles, source_faces, head_faces):
    pairs = np.asarray(contacts(plate_triangles, head_triangles)['pairs'], dtype=int).reshape(-1, 2)
    if not len(pairs):
        return pairs
    native = head_faces[source_faces[pairs[:, 0]]]
    other = head_faces[pairs[:, 1]]
    pairs = pairs[~(native[:, :, None] == other[:, None, :]).any(axis=(1, 2))]
    if not len(pairs):
        return pairs
    already = intersect_pairs(head_triangles[source_faces[pairs[:, 0]]], head_triangles[pairs[:, 1]])
    return pairs[~already]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--build', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    self_test()
    build = json.loads((args.build / 'build.json').read_text())
    assert sha(build['candidate']) == build['candidateSha256']
    head, raw, final = [Glb(Path(build[key])) for key in ('head', 'raw', 'roundtrip')]
    mapping = np.asarray(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'], dtype=int)
    candidate = np.load(build['candidate'])
    np.testing.assert_array_equal(candidate['mapping'], mapping)
    names = head.mesh['extras']['targetNames']
    assert len(names) == 105 and names == raw.mesh['extras']['targetNames'] == final.mesh['extras']['targetNames']
    head_faces = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    raw_faces = raw.array(raw.p['indices']).astype(int).reshape(-1, 3)
    final_faces = final.array(final.p['indices']).astype(int).reshape(-1, 3)
    assert len(raw_faces) == 3010
    np.testing.assert_array_equal(raw_faces, final_faces)
    face_lookup = {tuple(sorted(face)): i for i, face in enumerate(head_faces)}
    source_faces = np.asarray([face_lookup[tuple(sorted(face))] for face in mapping[final_faces]])
    assert len(source_faces) == len(final_faces)
    attributes = {}
    for name in raw.p['attributes']:
        before, after = raw.attr(name), final.attr(name)
        assert before.shape == after.shape
        error = float(np.max(np.abs(before.astype(float) - after.astype(float))))
        attributes[name] = error
    assert attributes['TEXCOORD_0'] == attributes['TEXCOORD_1'] == 0
    assert attributes['POSITION'] < 5e-6
    morph_error = {name: 0. for name in ('POSITION', 'NORMAL', 'TANGENT')}
    nonzero_shading_changes = 0
    for before, after in zip(raw.p['targets'], final.p['targets']):
        for name in morph_error:
            left, right = raw.array(before[name]), final.array(after[name])
            morph_error[name] = max(morph_error[name], float(np.max(np.abs(left.astype(float) - right.astype(float)))))
            if name != 'POSITION':
                changed = (left != right).any(axis=1)
                nonzero_shading_changes += int(np.count_nonzero(left[changed]))
                assert np.max(np.abs(right[changed]), initial=0) <= 1/1023 + 1e-7 if changed.any() else True
    assert morph_error['POSITION'] < 2e-5 and nonzero_shading_changes == 0
    source_hq = Path(build['sourceBuild']).parents[3]
    head_mesh = json.loads((source_hq / 'research/consumers/eye-plate/json/h0_000_pwa_c__basehead.mesh.json').read_text(encoding='utf-8-sig'))['Data']['RootChunk']
    head_morph = json.loads((source_hq / 'research/consumers/eye-plate/json/h0_000_pwa__morphs.morphtarget.json').read_text(encoding='utf-8-sig'))['Data']['RootChunk']
    mesh = json.loads((args.build / 'retained-roundtrip-json/xfas_eye_plate.mesh.json').read_text(encoding='utf-8-sig'))['Data']['RootChunk']
    morph = json.loads((args.build / 'morph-retained-roundtrip-json/xfas_eye_plate.morphtarget.json').read_text(encoding='utf-8-sig'))['Data']['RootChunk']
    expected_mesh = skin_rows(head_mesh['renderResourceBlob'], head_mesh['boneNames'])
    expected_morph = skin_rows(head_morph['blob']['Data']['baseBlob'], head_mesh['boneNames'])
    actual_mesh = skin_rows(mesh['renderResourceBlob'], mesh['boneNames'])
    actual_morph = skin_rows(morph['blob']['Data']['baseBlob'], mesh['boneNames'])
    assert len(actual_mesh) == len(actual_morph) == len(mapping) == 1635
    assert all(actual_mesh[i] == expected_mesh[source] for i, source in enumerate(mapping))
    assert all(actual_morph[i] == expected_morph[source] for i, source in enumerate(mapping))
    assert actual_mesh == actual_morph
    shared_bones = sorted(set(head.bones()) | set(final.bones()))
    head_weights = head.weights(shared_bones)[mapping]
    plate_weights = final.weights(shared_bones)
    head_weight_error = float(np.max(np.abs(head_weights - plate_weights)))
    assert head_weight_error < 2e-7
    assert np.max(np.count_nonzero(plate_weights, axis=1)) == 8
    # The numeric field is compared to the exported result, not simply its input GLB.
    source = Glb(Path(build['sourceGlb']))
    np.testing.assert_allclose(raw.attr('POSITION'), source.attr('POSITION').astype(float) + candidate['baseChange'], rtol=0, atol=1e-7)
    for i in range(105):
        np.testing.assert_allclose(raw.array(raw.p['targets'][i]['POSITION']),
                                   source.array(source.p['targets'][i]['POSITION']).astype(float) + candidate['morphChange'][i],
                                   rtol=0, atol=1e-7)
    edges = np.unique(np.sort(np.concatenate((final_faces[:, [0, 1]], final_faces[:, [1, 2]], final_faces[:, [2, 0]])), axis=1), axis=0)
    hb, pb = head.attr('POSITION').astype(float), final.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    pt = np.stack([final.array(t['POSITION']).astype(float) for t in final.p['targets']])
    saved = [names.index(n) for n in ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')]
    cases = [('Basis', [])] + [(name, [i]) for i, name in enumerate(names)] + [('saved_v', saved)]
    static = []
    for name, indices in cases:
        h = hb + ht[indices].sum(axis=0) if indices else hb
        p = pb + pt[indices].sum(axis=0) if indices else pb
        displacement = p - h[mapping]
        limits = np.minimum(5e-5, .25 * np.linalg.norm(h[mapping[edges[:, 0]]] - h[mapping[edges[:, 1]]], axis=1))
        gap = np.linalg.norm(displacement[edges[:, 0]] - displacement[edges[:, 1]], axis=1)
        pairs = new_pairs(p[final_faces], h[head_faces], source_faces, head_faces)
        static.append({'name': name, 'newNonadjacent': len(pairs),
                       'overDisplacement': int((np.linalg.norm(displacement, axis=1) > .00025 + 1e-10).sum()),
                       'overNeighbor': int((gap > limits + 1e-10).sum()),
                       'maxDisplacement': float(np.linalg.norm(displacement, axis=1).max()),
                       'maxNeighborGap': float(gap.max()),
                       'newPairs': [{'plateFace': int(a), 'headFace': int(b)} for a, b in pairs]})
    source_root = Path(build['sourceBuild'])
    frames = json.loads((source_root / 'posed/manifest.json').read_text())['frames']
    assert len(frames) == 73
    hp = np.fromfile(source_root / 'posed/head.positions.f64', dtype='<f8').reshape(len(frames), -1, 3)
    linear = np.fromfile(source_root / 'fixed_linear.f64', dtype='<f8').reshape(len(frames), len(mapping), 3, 3)
    residual = pb - hb[mapping] + (pt[saved] - ht[saved][:, mapping]).sum(axis=0)
    posed = []
    for index, frame in enumerate(frames):
        p = hp[index, mapping] + np.einsum('vij,vj->vi', linear[index], residual)
        pairs = new_pairs(p[final_faces], hp[index, head_faces], source_faces, head_faces)
        posed.append({'frame': frame, 'newNonadjacent': len(pairs),
                      'newPairs': [{'plateFace': int(a), 'headFace': int(b)} for a, b in pairs]})
    # Repeat the same gates on the pre-import GLB to locate any serialization loss.
    rb = raw.attr('POSITION').astype(float)
    rt = np.stack([raw.array(t['POSITION']).astype(float) for t in raw.p['targets']])
    raw_static = []
    for name, indices in cases:
        h = hb + ht[indices].sum(axis=0) if indices else hb
        p = rb + rt[indices].sum(axis=0) if indices else rb
        displacement = p - h[mapping]
        limits = np.minimum(5e-5, .25 * np.linalg.norm(h[mapping[edges[:, 0]]] - h[mapping[edges[:, 1]]], axis=1))
        gap = np.linalg.norm(displacement[edges[:, 0]] - displacement[edges[:, 1]], axis=1)
        raw_static.append({'name': name,
                           'newNonadjacent': len(new_pairs(p[raw_faces], h[head_faces], source_faces, head_faces)),
                           'overNeighbor': int((gap > limits + 1e-10).sum()),
                           'overDisplacement': int((np.linalg.norm(displacement, axis=1) > .00025 + 1e-10).sum())})
    raw_residual = rb - hb[mapping] + (rt[saved] - ht[saved][:, mapping]).sum(axis=0)
    raw_posed = []
    for index, frame in enumerate(frames):
        p = hp[index, mapping] + np.einsum('vij,vj->vi', linear[index], raw_residual)
        raw_posed.append({'frame': frame,
                          'newNonadjacent': len(new_pairs(p[raw_faces], hp[index, head_faces], source_faces, head_faces))})
    gates = {'meshSkinExact': True, 'morphBaseSkinExact': True, 'topologyAndUVExact': True,
             'all105MorphsPresent': True, 'static107': len(static) == 107,
             'posed73': len(posed) == 73,
             'staticNewContactFree': not any(r['newNonadjacent'] for r in static),
             'posedNewContactFree': not any(r['newNonadjacent'] for r in posed),
             'staticDisplacementWithinBound': not any(r['overDisplacement'] for r in static),
             'staticNeighborWithinLimit': not any(r['overNeighbor'] for r in static)}
    report = {'candidateSha256': build['candidateSha256'], 'resources': build['resources'],
              'roundtripGlbSha256': sha(build['roundtrip']), 'vertexCount': len(mapping),
              'triangleCount': len(final_faces), 'morphCount': len(names),
              'nativeSkinBytesCompared': {'meshVertices': len(actual_mesh), 'morphBaseVertices': len(actual_morph),
                                          'eightSlotsPerVertex': True,
                                          'exportedWeightMaxErrorVersusHead': head_weight_error},
              'attributeMaxError': attributes, 'morphMaxError': morph_error,
              'nonzeroShadingComponentsChanged': nonzero_shading_changes,
              'rawStaticCases': raw_static, 'rawPoseCases': raw_posed,
              'staticCases': static, 'posedCases': posed, 'gates': gates,
              'samplingLimit': '73 fixed frames from decoded idle; no continuous-time or game-rendering claim'}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'gates': gates, 'staticNewContacts': sum(r['newNonadjacent'] for r in static),
                      'posedNewContacts': sum(r['newNonadjacent'] for r in posed),
                      'maxStaticDisplacement': max(r['maxDisplacement'] for r in static),
                      'maxStaticNeighborGap': max(r['maxNeighborGap'] for r in static),
                      'rawStaticNewContacts': sum(r['newNonadjacent'] for r in raw_static),
                      'rawPosedNewContacts': sum(r['newNonadjacent'] for r in raw_posed),
                      'morphMaxError': morph_error}))


if __name__ == '__main__':
    main()
