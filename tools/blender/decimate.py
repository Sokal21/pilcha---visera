"""Take a finished model (animated or not) down to fewer triangles, in Blender without a window.

    Blender -b --python scripts/blender/decimate.py -- IN.glb OUT.glb --faces 2500 [--keep 400]

The last step after prepare_model.py or prepare_rigged.py; IN and OUT may be the same file. The game
draws the world at 1.8 units a pixel and then pixelates it: a figure of 8000 triangles stands 45
pixels tall, a house of 15 000 fills 150 by 100, and every triangle is put through every pass
(the sun's shadows, the picture). At a quarter of them nothing of the silhouette or the three-step
shading changes, and a phone has a quarter of the vertices to work.

- Every mesh of the model is collapsed by the same ratio, `--faces` over the model's triangles,
  except those under `--keep` triangles (a musket, a sabre), left as they are.
- Collapsing stops at the seams of the texture (its UV islands), at the borders between materials
  and at sharp edges, so the texture does not smear and the hard lines hold; the bones' weights are
  carried over, so the clips still play.
- The armature, its clips, the props on its bones, the names of everything: all as they were.
"""
import os
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
src, dst = args[0], args[1]
opts = dict(zip(args[2::2], args[3::2]))
FACES = int(opts.get('--faces', 2500))
KEEP = int(opts.get('--keep', 400))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
armature = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)


def triangles(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


before = {o.name: triangles(o) for o in meshes}
total = sum(before.values())
ratio = min(1.0, FACES / max(1, total))
for o in meshes:
    if before[o.name] <= KEEP or ratio >= 1.0:
        continue
    if o.data.shape_keys:
        print(f'SKIPPED {o.name}: it has shape keys, which a collapse cannot keep')
        continue
    bpy.context.view_layer.objects.active = o
    mod = o.modifiers.new('decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    mod.use_symmetry = False
    mod.delimit = {'UV', 'SEAM', 'SHARP', 'MATERIAL'}
    # Worked on the mesh itself, before the armature bends it.
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)

after = {o.name: triangles(o) for o in meshes}

# Each clip exported as one of its own, as prepare_rigged.py exports them.
if armature is not None:
    for o in bpy.data.objects:
        if o is not armature:
            o.animation_data_clear()
    armature.animation_data_clear()
    armature.animation_data_create()
    for action in bpy.data.actions:
        action.use_fake_user = True
        track = armature.animation_data.nla_tracks.new()
        track.name = action.name
        track.strips.new(action.name, int(action.frame_range[0]), action)

os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True,
                          export_animation_mode='NLA_TRACKS', export_apply=False)
for name in before:
    print(f'  {name}: {before[name]} -> {after[name]} triangles')
print(f'WROTE {dst}: {total} -> {sum(after.values())} triangles (asked {FACES}), clips {[a.name for a in bpy.data.actions]}')
