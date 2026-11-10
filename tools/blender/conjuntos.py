"""Fotos del protagonista vestido de varias formas, para revisar la ropa sin abrir el visor.

    Blender -b --python tools/blender/conjuntos.py -- MODELO.glb DIR [--frame 30]

Por cada conjunto (CONJUNTOS) saca una foto de frente, de costado, de espalda y de tres cuartos, en
el cuadro dado del primer clip, con luz plana: DIR/<conjunto>.png. Esconde las prendas que no lleva
y los pedazos del cuerpo que tapan las que sí, igual que el visor.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
model, out = args[0], args[1]
opts = {k: v for k, v in zip(args, args[1:]) if k.startswith('--')}
FRAME = int(opts.get('--frame', 30))

CONJUNTOS = {
    'boxers': [],
    'tracksuit': ['campera_adidas', 'pantalon_adidas', 'jordan'],
    'newells': ['camperon_newells', 'chupin', 'nike'],
    'mezcla_a': ['camperon_newells', 'pantalon_adidas', 'jordan'],
    'mezcla_b': ['chupin', 'jordan'],
}
VISTAS = [('frente', 0), ('tres_cuartos', 40), ('costado', 90), ('espalda', 180)]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=model)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
if arm.animation_data and arm.animation_data.nla_tracks:
    track = arm.animation_data.nla_tracks[0]
    arm.animation_data.action = track.strips[0].action
    for t in arm.animation_data.nla_tracks:
        t.mute = True
bpy.context.scene.frame_set(FRAME)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x, scene.render.resolution_y = 360, 560
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('w')
scene.display.shading.background_type = 'VIEWPORT'
scene.display.shading.background_color = (0.35, 0.36, 0.4)

cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 1.15
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

os.makedirs(out, exist_ok=True)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for nombre, prendas in CONJUNTOS.items():
    for o in meshes:
        if o.name.startswith('ropa_'):
            prenda, _, tapan = o.name[5:].partition('__')
            o.hide_render = prenda not in prendas or any(t in prendas for t in tapan.split('+'))
        elif o.name.startswith('cuerpo__'):
            o.hide_render = any(p in prendas for p in o.name[8:].split('+'))
        else:
            o.hide_render = True
    shots = []
    for vista, deg in VISTAS:
        # El modelo mira a -Y de Blender (+Z de glTF).
        a = math.radians(deg)
        cam.location = Vector((3 * math.sin(a), -3 * math.cos(a), 0.55))
        cam.rotation_euler = (math.radians(90), 0, a)
        path = os.path.join(out, f'{nombre}_{vista}.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        shots.append(path)
    print('SHOTS', nombre, shots)
