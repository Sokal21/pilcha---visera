"""Make a generated model ready for the 3D game, in Blender without a window.

    Blender -b --python scripts/blender/prepare_model.py -- IN.glb OUT.glb [--colors 16] [--texture 512] [--front +x]

- Turns it so its front looks along +Z (glTF's forward, the game's "toward the camera"). Tripo
  exports its models looking along +X; say otherwise with --front.
- Stands it on its feet at the origin, one unit tall: the game grows it to its drawn height.
- Flattens its texture to a few colours (k-means over the texture's own pixels), at a small size,
  to be shown nearest-filtered: flat colour areas, which the engine's light then shades.
- Exports a single GLB, the texture inside it.
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix

sys.path.append(os.path.dirname(__file__))
from flatten import flatten  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
src, dst = args[0], args[1]
opts = dict(zip(args[2::2], args[3::2]))
COLOURS = int(opts.get('--colors', 16))
SIZE = int(opts.get('--texture', 512))
FRONT = opts.get('--front', '+x')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# Blender is Z up and Y back: glTF's +X forward is Blender's +X, glTF's +Z (the target) is Blender's -Y.
TURN = {'+x': -90, '-x': 90, '+z': 0, '-z': 180}[FRONT]
turn = Matrix.Rotation(np.radians(TURN), 4, 'Z')
for o in meshes:
    o.data.transform(turn @ o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
for o in [o for o in bpy.data.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o)

# Feet at the origin, one unit tall.
points = np.array([v.co[:] for o in meshes for v in o.data.vertices])
low, high = points.min(0), points.max(0)
tall = high[2] - low[2]
move = Matrix.Translation((-(low[0] + high[0]) / 2, -(low[1] + high[1]) / 2, -low[2]))
grow = Matrix.Scale(1 / tall, 4)
for o in meshes:
    o.data.transform(grow @ move)

flatten(COLOURS, SIZE)

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True)
faces = sum(len(o.data.polygons) for o in meshes)
print(f'WROTE {dst}: {faces} faces, texture {SIZE}px in {COLOURS} colours')
