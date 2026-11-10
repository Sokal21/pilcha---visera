"""Make a rigged, animated model ready for the 3D game, in Blender without a window.

    Blender -b --python scripts/blender/prepare_rigged.py -- OUT.glb MAIN.glb [MORE.glb ...] [--front +z] [--colors 16] [--texture 512] [--carries sabre] [--cape yes]

Tripo gives each batch of animations as a whole model of its own, the same skeleton in each. This
keeps MAIN's skeleton and mesh, takes every animation out of all of them (by its own name, which
Tripo gives the preset's: idle, run, slash...), and drops the rest, including the stray sphere
Tripo leaves in its files.

- Turns the skeleton so the model's front looks along +Z (glTF's forward). Say which way it
  looks as given with --front: a rigged model from Tripo looks along glTF +Z already.
- Feet at the origin and one unit tall in its rest pose: the game grows it to its drawn height.
- Flattens the texture as scripts/blender/flatten.py does.
- Gives it what it carries (--carries, from props.py, comma separated), held by its bone.
- With --cape yes, moves a long cape off the arms and legs to the body (scripts/blender/cape.py).
- Exports one GLB with every animation as its own clip.
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.append(os.path.dirname(__file__))
from cape import off_limbs  # noqa: E402
from flatten import flatten  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
files = [a for a in args if not a.startswith('--') and (args.index(a) == 0 or not args[args.index(a) - 1].startswith('--'))]
opts = {k: v for k, v in zip(args, args[1:]) if k.startswith('--')}
dst, main, more = files[0], files[1], files[2:]
COLOURS = int(opts.get('--colors', 16))
SIZE = int(opts.get('--texture', 512))
FRONT = opts.get('--front', '+z')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=main)
armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == armature]
for o in [o for o in bpy.data.objects if o is not armature and o not in body]:
    bpy.data.objects.remove(o)

# Every other file: only its animations are wanted.
for path in more:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in set(bpy.data.objects) - before:
        bpy.data.objects.remove(o)
for o in bpy.data.objects:
    if o is not armature:
        o.animation_data_clear()
actions = sorted(bpy.data.actions, key=lambda a: a.name)
# A name can come twice (idle in two batches): the first is kept.
seen = set()
for action in list(actions):
    name = action.name.split('.')[0]
    if name in seen:
        bpy.data.actions.remove(action)
        continue
    seen.add(name)
    action.name = name
    action.use_fake_user = True

# Stand it in its rest pose to measure it.
if armature.animation_data:
    armature.animation_data.action = None
for bone in armature.pose.bones:
    bone.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()

if opts.get('--cape') == 'yes':
    for o in body:
        print('cape moved off the limbs:', off_limbs(armature, o))

# What it carries, placed in the rig's own axes before it is turned.
# A prop may be given its arguments after '@': musket_in_hand@tiro@30 sets the musket in his hands
# as he stands in the clip 'tiro' at frame 30.
for prop in filter(None, opts.get('--carries', '').split(',')):
    import props  # noqa: E402  (your project's own props.py beside this script)
    name, *given = prop.split('@')
    getattr(props, name)(armature, *[int(g) if g.isdigit() else g for g in given])

# Blender is Z up and Y back: glTF's +X forward is Blender's +X; +Z, the target, is Blender's -Y.
TURN = {'+x': -90, '-x': 90, '+z': 0, '-z': 180}[FRONT]
depsgraph = bpy.context.evaluated_depsgraph_get()
points = np.array([(o.matrix_world @ v.co)[:] for o in body for v in o.evaluated_get(depsgraph).to_mesh().vertices])
low, high = points.min(0), points.max(0)
tall = high[2] - low[2]
centre = Vector(((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2]))
armature.matrix_world = (Matrix.Rotation(np.radians(TURN), 4, 'Z') @ Matrix.Scale(1 / tall, 4)
                         @ Matrix.Translation(-centre) @ armature.matrix_world)

flatten(COLOURS, SIZE)

# Each animation exported as a clip of its own.
armature.animation_data_create()
for action in bpy.data.actions:
    track = armature.animation_data.nla_tracks.new()
    track.name = action.name
    track.strips.new(action.name, int(action.frame_range[0]), action)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True,
                          export_animation_mode='NLA_TRACKS', export_apply=False)
print(f'WROTE {dst}: clips {[a.name for a in bpy.data.actions]}, {tall:.3f} tall before')
