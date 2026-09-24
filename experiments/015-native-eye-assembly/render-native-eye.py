"""Private Blender render of pinned posed native head and all three eye chunks.

Usage: blender -b -t 4 --python render-native-eye.py -- --mode source|eye-only
Output remains beneath ignored generated/renders/.
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / '013-native-preview-core' / 'generated' / 'visual-study'
MAPS = SOURCE / 'candidate'
EXTRA = HERE / 'generated' / 'material-textures'
EXPECTED = {
    'head-glb': '0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730',
    'eye-glb': '0e5420a75e5a65eded91bb68338860e119692f0868f78e7ef89c98c0c56eaeba',
    'lash-xbm': '5897127a8acc95866a0f6d4ae14ce79a2543f8a5526cfe9f7dec51ac7afc9977',
    'lash-png': 'c844d762c249ebf7e17c009605929c736aa039e53e698863d3d9fa6415be82de',
    'lash-mi': '6dffe3f4d48d79c1ec3d17d3b4fd19eb388a45f96875273661e0b443139b7f27',
    'wetness-mi': 'c8cd52dada67db836eb4bff2f409d96a61589b725fc3713673f063231b73a9e8',
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def discard_render_metadata(path):
    """Blender embeds wall-clock/render-time tEXt; retain all pixel/color chunks."""
    raw = path.read_bytes()
    assert raw[:8] == b'\x89PNG\r\n\x1a\n'
    out = bytearray(raw[:8])
    offset = 8
    while offset < len(raw):
        size = struct.unpack_from('>I', raw, offset)[0]
        kind = raw[offset + 4:offset + 8]
        end = offset + 12 + size
        assert end <= len(raw)
        if kind != b'tEXt':
            out.extend(raw[offset:end])
        offset = end
    assert offset == len(raw)
    path.write_bytes(out)


def glb(path):
    data = path.read_bytes()
    assert data[:4] == b'glTF' and struct.unpack_from('<I', data, 4)[0] == 2
    length, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4e4f534a
    doc = json.loads(data[20:20 + length])
    offset = 20 + length
    binary_length, kind = struct.unpack_from('<II', data, offset)
    assert kind == 0x004e4942
    return doc, data[offset + 8:offset + 8 + binary_length]


def accessor(doc, binary, index):
    item = doc['accessors'][index]
    assert not item.get('sparse')
    view = doc['bufferViews'][item['bufferView']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[item['type']]
    dtype = np.dtype({5121: 'u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[item['componentType']])
    row = width * dtype.itemsize
    offset = view.get('byteOffset', 0) + item.get('byteOffset', 0)
    return np.ndarray((item['count'], width), dtype=dtype, buffer=binary, offset=offset,
                      strides=(view.get('byteStride', row), dtype.itemsize)).copy()


def material(name, colour, image=None, alpha_image=None, alpha=.999, roughness=.8):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*colour, alpha)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*colour, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Alpha'].default_value = alpha
    if image:
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(str(image), check_existing=True)
        texture.extension = 'REPEAT'
        m.node_tree.links.new(texture.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha_image:
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(str(alpha_image), check_existing=True)
        texture.image.colorspace_settings.name = 'Non-Color'
        texture.extension = 'REPEAT'
        m.node_tree.links.new(texture.outputs['Color'], bsdf.inputs['Alpha'])
        m.surface_render_method = 'DITHERED'
    elif alpha < .999:
        m.surface_render_method = 'DITHERED'
    return m


def to_blender(p):
    return float(p[0]), -float(p[2]), float(p[1])


def add_surface(name, positions, faces, uv, mat):
    verts = [to_blender(p) for p in positions]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces.tolist())
    mesh.update()
    if len(uv) != len(verts):
        raise ValueError(f'UV/position mismatch for {name}')
    layer = mesh.uv_layers.new(name='source_uv0')
    for poly in mesh.polygons:
        poly.use_smooth = True
        for loop in poly.loop_indices:
            vertex = mesh.loops[loop].vertex_index
            layer.data[loop].uv = (float(uv[vertex, 0]), 1 - float(uv[vertex, 1]))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat)
    return obj


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['source', 'eye-only'], default='source')
    parser.add_argument('--frames', default='0,169,331,490')
    parser.add_argument('--sample', choices=['clearance', 'h091-comparison'], default='clearance')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    frames = [int(v) for v in args.frames.split(',')]
    assert all(v in [0, 27, 169, 298, 299, 331, 473, 490, 662] for v in frames)
    root = HERE / 'generated' / args.sample
    manifest = json.loads((root / 'manifest.json').read_text())
    fixed = json.loads((SOURCE / 'manifest.json').read_text())
    assert fixed['candidate']['head.glb'] == EXPECTED['head-glb']
    assert fixed['candidate']['eyes.glb'] == EXPECTED['eye-glb']
    head_path, eye_path = MAPS / 'head.glb', MAPS / 'eyes.glb'
    assert sha(head_path) == EXPECTED['head-glb'] and sha(eye_path) == EXPECTED['eye-glb']
    lash_xbm = EXTRA / 'base/characters/common/hair/textures/hb1_brow_beard_lashes/hb1_01__lash_single_d.xbm'
    lash_png = EXTRA / 'decoded/hb1_01__lash_single_d.png'
    assert sha(lash_xbm) == EXPECTED['lash-xbm'] and sha(lash_png) == EXPECTED['lash-png']
    lash_mi = HERE / 'generated/materials/base/characters/common/eyes/eyelashes_wa_01.mi'
    wetness_mi = HERE / 'generated/materials/base/characters/common/eyes/eyeshadow_base.mi'
    assert sha(lash_mi) == EXPECTED['lash-mi'] and sha(wetness_mi) == EXPECTED['wetness-mi']
    for role, path in [('head-albedo', MAPS / 'head-albedo.png'), ('eye-albedo', MAPS / 'eye-albedo.png')]:
        assert sha(path) == fixed['maps'][role]['candidate']['sha256']
    docs = {'head': glb(head_path), 'eye': glb(eye_path)}
    spec = [('head', 'head', 0), ('native-lash', 'eye', 0), ('native-eye', 'eye', 1), ('native-wetness', 'eye', 2)]
    source_uv = {}
    for name, doc_name, mesh_index in spec:
        doc, binary = docs[doc_name]
        primitive = doc['meshes'][mesh_index]['primitives'][0]
        source_uv[name] = accessor(doc, binary, primitive['attributes']['TEXCOORD_0'])
    indices = {}
    for name, row in manifest['meshIndices'].items():
        path = root / row['file']
        assert sha(path) == row['sha256']
        indices[name] = np.asarray(json.loads(path.read_text()), dtype=int).reshape(-1, 3)
    output = HERE / 'generated' / 'renders' / (args.sample if args.sample != 'clearance' else '') / args.mode
    output.mkdir(parents=True, exist_ok=True)
    report = {'mode': args.mode, 'frames': frames, 'shapes': manifest['shapes'],
              'source': {'sampleManifestSha256': sha(root / 'manifest.json'),
                         'nativeHeadSha256': sha(head_path), 'nativeEyeSha256': sha(eye_path),
                         'headAlbedoSha256': sha(MAPS / 'head-albedo.png'),
                         'eyeBaseDiffuseSha256': sha(MAPS / 'eye-albedo.png'),
                         'lashAlphaPngSha256': sha(lash_png),
                         'lashMaterialSha256': sha(lash_mi),
                         'wetnessSlotMaterialSha256': sha(wetness_mi)},
              'renders': []}
    for frame in frames:
        for shape in manifest['shapes']:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            scene = bpy.context.scene
            scene.render.engine = 'CYCLES'
            scene.cycles.device = 'CPU'
            scene.cycles.samples = 24
            scene.cycles.seed = 0
            scene.cycles.use_animated_seed = False
            scene.cycles.use_denoising = False
            scene.render.resolution_x, scene.render.resolution_y = 1080, 720
            scene.render.resolution_percentage = 100
            scene.render.image_settings.file_format = 'PNG'
            scene.view_settings.view_transform = 'Standard'
            scene.world = bpy.data.worlds.new('neutral studio ambient')
            scene.world.color = (.08, .08, .08)
            skin = material('Verified D05 base colour; approximate diffuse shader', (.72, .53, .48), MAPS / 'head-albedo.png', roughness=.9)
            eye = material('Verified eye base diffuse; brown gradient unresolved', (.8, .82, .85),
                           MAPS / 'eye-albedo.png', roughness=.28) if args.mode == 'source' else material(
                               'Diagnostic eye cyan', (.015, .82, .9), roughness=.4)
            lash = material('Source lash alpha; approximate dark hair colour', (.045, .025, .025),
                            alpha_image=lash_png, roughness=.75)
            wet = material('Diagnostic wetness slot; source shader unresolved', (.08, .55, .85),
                           alpha=.36, roughness=.12)
            mats = {'head': skin, 'native-lash': lash, 'native-eye': eye, 'native-wetness': wet}
            for name, _, _ in spec:
                if args.mode == 'eye-only' and name in ('native-lash', 'native-wetness'):
                    continue
                row = manifest['surfaces'][f'{shape}/{frame}/{name}']
                path = root / row['file']
                assert sha(path) == row['sha256']
                positions = np.fromfile(path, dtype='<f8').reshape(-1, 3)
                add_surface(name, positions, indices[name], source_uv[name], mats[name])
            centre = np.fromfile(root / manifest['surfaces'][f'neutral/{frame}/native-eye']['file'],
                                 dtype='<f8').reshape(-1, 3).mean(axis=0)
            target = Vector(to_blender(centre))
            camera_data = bpy.data.cameras.new('fixed-frontal')
            camera = bpy.data.objects.new('fixed-frontal', camera_data)
            scene.collection.objects.link(camera)
            camera.location = target + Vector((0, .35, 0))
            direction = target - camera.location
            camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
            camera_data.type = 'ORTHO'
            camera_data.ortho_scale = .085
            scene.camera = camera
            key_data = bpy.data.lights.new('broad key', 'AREA')
            key = bpy.data.objects.new('broad key', key_data)
            scene.collection.objects.link(key)
            key.location = target + Vector((-.11, .25, .12))
            key_data.energy = 2
            key_data.shape = 'DISK'
            key_data.size = .28
            key.rotation_euler = (target - key.location).to_track_quat('-Z', 'Y').to_euler()
            fill_data = bpy.data.lights.new('soft fill', 'AREA')
            fill = bpy.data.objects.new('soft fill', fill_data)
            scene.collection.objects.link(fill)
            fill.location = target + Vector((.12, .23, -.06))
            fill_data.energy = 1
            fill_data.size = .25
            fill.rotation_euler = (target - fill.location).to_track_quat('-Z', 'Y').to_euler()
            path = output / f'{shape}-frame-{frame:03}.png'
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            discard_render_metadata(path)
            report['renders'].append({'shape': shape, 'frame': frame, 'file': path.name,
                                      'sha256': sha(path), 'cameraCentreThree': centre.tolist()})
            print(f'RENDER {args.mode} {shape} {frame} {sha(path)}', flush=True)
    (output / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
