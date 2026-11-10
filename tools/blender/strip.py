"""Render frames of one animation from the game's camera, to check it without the game.

    Blender -b --python scripts/blender/strip.py -- MODEL.glb ACTION OUT_DIR [--frames 8] [--turn 0] [--size 320]

The camera is orthographic, 30° down, as in the game. `--turn` turns the model (degrees, about the
upright) to see it from another side: 0 front, 90 his left side. The frames are evenly spaced
through the action, saved as OUT_DIR/f_N.png; lay them out with tools/turntable_sheet.py-style
scripts or tools/strip_sheet.py.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, name, out = args[0], args[1], args[2]
opts = dict(zip(args[3::2], args[4::2]))
FRAMES = int(opts.get('--frames', 8))
TURN = float(opts.get('--turn', 0))
SIZE = int(opts.get('--size', 320))
PITCH = math.radians(30)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in [o for o in bpy.data.objects if o.type == 'MESH' and o.parent != arm]:
    bpy.data.objects.remove(o)
action = bpy.data.actions[name]
arm.animation_data_create()
for track in list(arm.animation_data.nla_tracks):
    arm.animation_data.nla_tracks.remove(track)
arm.animation_data.action = action
pivot = bpy.data.objects.new('pivot', None)
bpy.context.scene.collection.objects.link(pivot)
arm.parent = pivot
pivot.rotation_euler = (0, 0, math.radians(TURN))

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
tall = max((o.matrix_world @ Vector(c)).z for o in meshes for c in o.bound_box)
scene = bpy.context.scene
camera = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.type = 'ORTHO'
camera.data.ortho_scale = tall * 1.5
away = 10
camera.location = (0, -away * math.cos(PITCH), tall / 2 + away * math.sin(PITCH))
camera.rotation_euler = Euler((math.pi / 2 - PITCH, 0, 0))
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'TEXTURE'
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = SIZE
os.makedirs(out, exist_ok=True)
start, end = action.frame_range
for n in range(FRAMES):
    scene.frame_set(round(start + (end - start) * n / FRAMES))
    scene.render.filepath = os.path.join(out, f'f_{n}.png')
    bpy.ops.render.render(write_still=True)
print('WROTE', out)
