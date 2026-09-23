"""Blender-only diagnostic renders, from sampled arrays; never opens/saves source art."""
import bpy
import json
from pathlib import Path
import sys
from mathutils import Vector
import numpy as np

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'004-plate-import'))
from verify_roundtrip import Glb
root=Path(json.loads((HERE/'latest-build.json').read_text())['root'])
build=json.loads((root/'build.json').read_text())
manifest=json.loads((root/'posed/manifest.json').read_text())
analysis=json.loads((HERE/'contact-analysis.json').read_text())
head=Glb(Path(build['head']));ht=head.array(head.p['indices']).astype(int).reshape(-1,3)
candidate=build['candidates'][0]
plate=Glb(Path(candidate['roundtrip']));pt=plate.array(plate.p['indices']).astype(int).reshape(-1,3)
hp=np.fromfile(root/'posed/head.positions.f64',dtype='<f8').reshape(len(manifest['frames']),-1,3)
pp=np.fromfile(root/f'posed/{candidate["name"]}.positions.f64',dtype='<f8').reshape(len(manifest['frames']),-1,3)
def xyz(points):return np.column_stack([points[:,0],-points[:,2],points[:,1]])
def material(name,color):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);return m
for frame in [0,25]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    index=manifest['frames'].index(frame)
    entry=next(r for r in analysis['reports'] if r['candidate']==candidate['name'] and r['frame']==frame)
    red=set(entry['plateTriangles'])
    for name,points,faces in [('head',hp[index],ht),('plate',pp[index],pt)]:
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(xyz(points),[],faces.tolist());mesh.update()
        obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
        if name=='head':
            mesh.materials.append(material('head-grey',(.3,.33,.36)))
            for face in mesh.polygons:face.use_smooth=True
        else:
            mesh.materials.append(material('plate-blue',(.1,.45,.65)))
            mesh.materials.append(material('contact-red',(.9,.04,.015)))
            for face in mesh.polygons:
                face.material_index=1 if face.index in red else 0
                face.use_smooth=False
    contact_points=xyz(pp[index][np.unique(pt[list(red)])])
    target=Vector(contact_points.mean(axis=0))
    bpy.ops.object.camera_add(location=target+Vector((0,.17,.006)))
    camera=bpy.context.object;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=.115
    scene=bpy.context.scene;scene.camera=camera
    scene.render.engine='BLENDER_WORKBENCH'
    scene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL'
    scene.display.shading.show_shadows=False;scene.display.shading.show_cavity=True
    scene.world=bpy.data.worlds.new('diagnostic-world')
    scene.display.shading.background_type='WORLD';scene.world.color=(.025,.025,.025)
    scene.render.resolution_x=1500;scene.render.resolution_y=650;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(root/f'contacts-frame-{frame}.png')
    bpy.ops.render.render(write_still=True)
    print(scene.render.filepath,flush=True)
