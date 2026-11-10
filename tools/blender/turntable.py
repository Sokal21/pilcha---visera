"""Render a model from eight sides as the game's camera sees it, to check it without the game.

    Blender -b --python scripts/blender/turntable.py -- MODEL.glb OUT_DIR [--size 384] [--whole 1]

The camera is orthographic and looks down 30°, as in the game. The model is turned in eighths,
starting with its front to the camera; each view is saved as OUT_DIR/giro_N.png, transparent.
Lay them out and pixelate them with tools/turntable_sheet.py.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
opts = dict(zip(args[2::2], args[3::2]))
SIZE = int(opts.get('--size', 384))
PITCH = math.radians(30)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
pivot = bpy.data.objects.new('pivot', None)
bpy.context.scene.collection.objects.link(pivot)
for o in [o for o in bpy.data.objects if o.parent is None and o is not pivot]:
    o.parent = pivot

corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
tall = max(c.z for c in corners)
# Framed by its height, standing on the ground; with --whole, by its widest too and round its
# middle, for a building wider than tall (or one straight from Tripo, its middle at the origin).
span, middle = tall, tall / 2
if opts.get('--whole'):
    low = min(c.z for c in corners)
    span = max(tall - low, 2 * max(max(abs(c.x), abs(c.y)) for c in corners))
    middle = (tall + low) / 2
scene = bpy.context.scene
camera = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.type = 'ORTHO'
camera.data.ortho_scale = span * 1.25
# glTF's +Z, the model's front, is Blender's -Y: the camera stands out that way, looking back and down.
away = 10
camera.location = (0, -away * math.cos(PITCH), middle + away * math.sin(PITCH))
camera.rotation_euler = Euler((math.pi / 2 - PITCH, 0, 0))

scene.render.engine = 'BLENDER_WORKBENCH'
# Flat: each colour shown as it is, so the texture is what is judged; the game does the light.
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'TEXTURE'
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'

os.makedirs(out, exist_ok=True)
for n in range(8):
    pivot.rotation_euler = (0, 0, math.radians(45 * n))
    scene.render.filepath = os.path.join(out, f'giro_{n}.png')
    bpy.ops.render.render(write_still=True)
print('WROTE', out)
