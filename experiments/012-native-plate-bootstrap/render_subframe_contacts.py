"""Private Blender diagnostic renders of the packed plate on the sampled head.

Runs with Blender's Python. No authored master, game installation or package is
modified; images remain under an explicit ignored output directory.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / '004-plate-import')]
from verify_roundtrip import Glb  # noqa: E402


def xyz(points):
    return np.column_stack([points[:, 0], -points[:, 2], points[:, 1]])


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    return mat


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    parser = argparse.ArgumentParser()
    for name in ('head', 'native', 'native-map', 'packed', 'subframes', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args(argv)
    if not args.output.is_absolute():
        raise ValueError('Output must be an absolute ignored path')
    if hashlib.sha256(args.packed.read_bytes()).hexdigest() != '8e9c76b445ec746904bd8d24bfdf93f78f09d7627ffc8b3d4b337d8b524c6499':
        raise ValueError('Unexpected packed candidate')
    head, native, packed = map(Glb, (args.head, args.native, args.packed))
    mapping = np.asarray(json.loads(args.native_map.read_text())['plateToHeadIndices'], dtype=int)
    names = head.mesh['extras']['targetNames']
    saved = [names.index(name) for name in ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')]
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    pb = packed.attr('POSITION').astype(float)
    pt = np.stack([packed.array(t['POSITION']).astype(float) for t in packed.p['targets']])
    residual = pb - hb[mapping] + (pt[saved] - ht[saved][:, mapping]).sum(axis=0)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    pf = native.array(native.p['indices']).astype(int).reshape(-1, 3)
    manifest = json.loads((args.subframes / 'manifest.json').read_text())
    assert manifest['rate'] == 120 and manifest['firstTick'] == 0 and manifest['sampleCount'] == 2653
    hp = np.memmap(args.subframes / 'head.positions.f64', dtype='<f8', mode='r', shape=(2653, len(hb), 3))
    linear = np.memmap(args.subframes / 'fixed_linear.f64', dtype='<f8', mode='r',
                       shape=(2653, len(mapping), 3, 3))
    args.output.mkdir(parents=True, exist_ok=True)
    for tick, highlighted in ((479, 794), (1193, 795), (1961, 2017)):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        plate_positions = hp[tick, mapping] + np.einsum('vij,vj->vi', linear[tick], residual)
        for name, points, faces in (('head', hp[tick], hf), ('packed-plate', plate_positions, pf)):
            mesh = bpy.data.meshes.new(name)
            mesh.from_pydata(xyz(points), [], faces.tolist())
            mesh.update()
            obj = bpy.data.objects.new(name, mesh)
            bpy.context.collection.objects.link(obj)
            if name == 'head':
                mesh.materials.append(material('head-grey', (.38, .39, .42)))
                for face in mesh.polygons:
                    face.use_smooth = True
            else:
                mesh.materials.append(material('plate-cyan', (.05, .5, .67)))
                mesh.materials.append(material('finite-contact-red', (.94, .03, .02)))
                for face in mesh.polygons:
                    face.material_index = 1 if face.index == highlighted else 0
        target = Vector(xyz(plate_positions[pf[highlighted]]).mean(axis=0))
        bpy.ops.object.camera_add(location=target + Vector((0, .14, .015)))
        camera = bpy.context.object
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type = 'ORTHO'
        camera.data.ortho_scale = .075
        scene = bpy.context.scene
        scene.camera = camera
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'MATERIAL'
        scene.display.shading.show_shadows = False
        scene.display.shading.show_cavity = True
        scene.world = bpy.data.worlds.new('diagnostic-world')
        scene.display.shading.background_type = 'WORLD'
        scene.world.color = (.025, .025, .025)
        scene.render.resolution_x = 1200
        scene.render.resolution_y = 800
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.render.filepath = str(args.output / f'packed-eye-region-tick-{tick}.png')
        bpy.ops.render.render(write_still=True)
        print(scene.render.filepath, flush=True)


if __name__ == '__main__':
    main()
