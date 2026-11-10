"""A clip mirrored, left for right: the captain fires his pistol with his left hand, his sabre in his
right, and the capture (Mixamo's Handgun) fires with the right.

    Blender -b --python scripts/blender/mirror_clip.py -- RIG.glb CLIP.glb OUT.glb [--name NAME]

CLIP is a clip already on his rig (scripts/blender/retarget_rot.py). Every frame, each bone is posed as
the mirror image of its fellow on the other side (L_ for R_; a bone of the middle, its own), across
the plane between his shoulders: its frame in the armature reflected, then set right again by the
one fixed turn that takes the fellow's rest to its own, so the result is a turn, not a reflection.
"""
import sys

import bpy
from mathutils import Matrix

sys.path.append(__import__('os').path.dirname(__file__))
from keyframes import Rig  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
opts = dict(zip(args[3::2], args[4::2]))
rig = Rig(args[0])
arm = rig.arm
bones = arm.pose.bones


def bring(path: str) -> bpy.types.Action:
    before, had = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in set(bpy.data.objects) - before:
        bpy.data.objects.remove(o)
    return next(a for a in bpy.data.actions if a not in had)


def fellow(name: str) -> str:
    return 'R_' + name[2:] if name.startswith('L_') else 'L_' + name[2:] if name.startswith('R_') else name


# The plane between his shoulders, in the armature's space.
rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}
left, right = rest['L_Upperarm'].to_translation(), rest['R_Upperarm'].to_translation()
across = (left - right).normalized()
middle = (left + right) / 2
reflect = Matrix([[(1 if i == j else 0) - 2 * across[i] * across[j] for j in range(3)] for i in range(3)])
flip = Matrix.Translation(middle) @ reflect.to_4x4() @ Matrix.Translation(-middle)
# For each bone, the fixed turn after the reflection that brings it to its own rest frame.
fix = {n: rest[fellow(n)].inverted() @ flip.inverted() @ rest[n] for n in rest}

taken = bring(args[1])
arm.animation_data_create()
arm.animation_data.action = taken
if getattr(taken, 'slots', None):
    arm.animation_data.action_slot = taken.slots[0]
first, last = (int(f) for f in taken.frame_range)
# Every pose read first, then the new clip keyed (Blender's action slots: see anims/tiro_arrodillado.py).
frames = []
for f in range(first, last + 1):
    bpy.context.scene.frame_set(f)
    bpy.context.view_layer.update()
    frames.append({pb.name: pb.matrix.copy() for pb in bones})
arm.animation_data.action = None


def depth(b) -> int:
    return 0 if b.parent is None else 1 + depth(b.parent)


levels = sorted({depth(b) for b in arm.data.bones})
act = rig.action(opts.get('--name', taken.name))
for n, seen in enumerate(frames):
    for pb in bones:
        pb.matrix_basis = Matrix.Identity(4)
    # Parents first: a bone's place is set against its parent's as it already stands.
    for level in levels:
        for pb in bones:
            if depth(pb.bone) == level:
                pb.matrix = flip @ seen[fellow(pb.name)] @ fix[pb.name]
        bpy.context.view_layer.update()
    for pb in bones:
        pb.keyframe_insert('rotation_quaternion', frame=n)
        pb.keyframe_insert('location', frame=n)
act.frame_range = (0, last - first)
bpy.data.actions.remove(taken)
rig.export(args[2])
