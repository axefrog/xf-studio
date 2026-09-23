"""Copy native head skin bytes to its verified plate cut-out after mesh import.

WolvenKit normalizes byte weights on GLB export, then rounds them to a new byte
distribution on import. Preserve the original distribution instead of quantizing
twice. Bone slots are explicitly remapped by name, including zero-weight slots.
"""
import base64
import copy
import hashlib
import json
from pathlib import Path
import numpy as np


def skin_layout(root):
    blob = root['renderResourceBlob']['Data']
    chunk = blob['header']['renderChunkInfos'][0]
    layout = chunk['chunkVertices']['vertexLayout']
    offsets = chunk['chunkVertices']['byteOffsets']['Elements']
    strides = layout['slotStrides']['Elements']
    sizes = {'PT_Short4N': 8, 'PT_UByte4': 4, 'PT_UByte4N': 4, 'PT_Float16_4': 8}
    cursor = 0
    fields = {}
    for element in layout['elements']['Elements']:
        if element['streamType'] != 'ST_PerVertex' or element['streamIndex'] != 0:
            continue
        size = sizes[element['type']]  # Unknown stream format must fail explicitly.
        if element['usage'] in ['PS_SkinIndices', 'PS_SkinWeights']:
            expected = 'PT_UByte4' if element['usage'] == 'PS_SkinIndices' else 'PT_UByte4N'
            assert element['type'] == expected
            fields[element['usage'], element['usageIndex']] = cursor
        cursor += size
    assert cursor == strides[0]
    assert set(fields) == {(kind, slot) for kind in ['PS_SkinIndices', 'PS_SkinWeights'] for slot in [0, 1]}
    buffer = base64.b64decode(blob['renderBuffer']['Bytes'])
    assert offsets[0] + chunk['numVertices'] * strides[0] <= len(buffer)
    return blob, buffer, fields, offsets[0], strides[0], chunk['numVertices']


def transfer(head_document, plate_document, mapping):
    """Return a modified copy and audit. Inputs remain untouched."""
    result = copy.deepcopy(plate_document)
    head = head_document['Data']['RootChunk']
    plate = result['Data']['RootChunk']
    hb, hd, hf, ho, hs, hn = skin_layout(head)
    pb, pd, pf, po, ps, pn = skin_layout(plate)
    assert len(plate['renderResourceBlob']['Data']['header']['renderChunkInfos']) == 1
    assert len(mapping) == pn and min(mapping) >= 0 and max(mapping) < hn
    head_names = [n['$value'] for n in head['boneNames']]
    plate_names = [n['$value'] for n in plate['boneNames']]
    assert len(set(head_names)) == len(head_names) and len(set(plate_names)) == len(plate_names)
    remap = [plate_names.index(name) for name in head_names]
    assert max(remap) < 256
    output = bytearray(pd)
    allowed = set()
    old_weights, source_weights = [], []
    for i, source in enumerate(mapping):
        old_row, source_row = [], []
        for slot in [0, 1]:
            for kind in ['PS_SkinIndices', 'PS_SkinWeights']:
                hstart = ho + source * hs + hf[kind, slot]
                pstart = po + i * ps + pf[kind, slot]
                values = hd[hstart:hstart + 4]
                if kind == 'PS_SkinIndices':
                    values = bytes(remap[j] for j in values)
                else:
                    old_row.extend(pd[pstart:pstart + 4])
                    source_row.extend(values)
                output[pstart:pstart + 4] = values
                allowed.update(range(pstart, pstart + 4))
        old_weights.append(old_row)
        source_weights.append(source_row)
    changed = {i for i, (a, b) in enumerate(zip(pd, output)) if a != b}
    assert changed <= allowed and len(output) == len(pd)
    pb['renderBuffer']['Bytes'] = base64.b64encode(output).decode('ascii')
    # No declarations, non-skin data or resource metadata may change.
    check = copy.deepcopy(result)
    check['Data']['RootChunk']['renderResourceBlob']['Data']['renderBuffer']['Bytes'] = plate_document['Data']['RootChunk']['renderResourceBlob']['Data']['renderBuffer']['Bytes']
    assert check == plate_document
    old, source = np.array(old_weights), np.array(source_weights)
    assert (source.sum(axis=1) > 0).all()
    return result, {'vertices': pn, 'changedBytes': len(changed),
        'verticesWithChangedWeightBytes': int((old != source).any(axis=1).sum()),
        'sourceWeightByteSumRange': [int(source.sum(axis=1).min()), int(source.sum(axis=1).max())],
        'oldWeightByteSumRange': [int(old.sum(axis=1).min()), int(old.sum(axis=1).max())],
        'nonSkinBytesUnchanged': True, 'boneRemapByName': True,
        'sourceSkinBytesSha256': hashlib.sha256(source.astype('u1').tobytes()).hexdigest()}


def preserve(head_path, plate_path, mapping_path, output_path):
    load = lambda p: json.loads(Path(p).read_text(encoding='utf-8-sig'))
    result, report = transfer(load(head_path), load(plate_path), load(mapping_path)['plateToHeadIndices'])
    output_path.write_text(json.dumps(result, separators=(',', ':')) + '\n', encoding='utf-8')
    report['inputs'] = [{'path': str(p), 'sha256': hashlib.sha256(Path(p).read_bytes()).hexdigest()} for p in [head_path, plate_path, mapping_path]]
    return report


def preserve_morph(head_mesh_path, head_morph_path, plate_mesh_path, plate_morph_path, mapping_path, output_path):
    load = lambda p: json.loads(Path(p).read_text(encoding='utf-8-sig'))
    hm, ht, pm, pt = [load(p) for p in [head_mesh_path, head_morph_path, plate_mesh_path, plate_morph_path]]
    # Morph resources carry a separate base vertex buffer. The referenced mesh
    # supplies bone names/rig, not these vertex weights. Preserve both resources.
    def view(mesh, morph):
        return {'Data': {'RootChunk': {'boneNames': mesh['Data']['RootChunk']['boneNames'],
            'renderResourceBlob': morph['Data']['RootChunk']['blob']['Data']['baseBlob']}}}
    converted, report = transfer(view(hm, ht), view(pm, pt), load(mapping_path)['plateToHeadIndices'])
    result = copy.deepcopy(pt)
    result['Data']['RootChunk']['blob']['Data']['baseBlob']['Data']['renderBuffer']['Bytes'] = converted['Data']['RootChunk']['renderResourceBlob']['Data']['renderBuffer']['Bytes']
    output_path.write_text(json.dumps(result, separators=(',', ':')) + '\n', encoding='utf-8')
    report['inputs'] = [{'path': str(p), 'sha256': hashlib.sha256(Path(p).read_bytes()).hexdigest()} for p in [head_mesh_path, head_morph_path, plate_mesh_path, plate_morph_path, mapping_path]]
    return report
