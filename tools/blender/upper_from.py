"""Stand a captured upper body on another clip's legs: the spine, and everything on it (neck, head,
arms), from CLIP; the hips and legs from BASE, looped under it. For a capture whose actor does the
right thing lying down (Mixamo's Laying Severe Cough, the plague-dead soldier's retching): turned
from his hips, his back curls and his arms move as they did, over a standing man's legs.

    Blender -b --python scripts/blender/upper_from.py -- CLIP.glb BASE.glb OUT.glb [--name vomito] [--lean 0] [--frames 0:40]

CLIP.glb and BASE.glb are single clips of one rig (scripts/blender/retarget_rot.py's). --lean bends
him forward that many degrees more at the first bone of the spine, on top of the capture's own;
--frames takes only that stretch of CLIP.
"""
import math
import sys

import bpy
from mathutils import Quaternion, Vector

args = sys.argv[sys.argv.index('--') + 1:]
clip_path, base_path, out = args[:3]
opts = dict(zip(args[3::2], args[4::2]))
NAME = opts.get('--name', 'captura')
LEAN = float(opts.get('--lean', 0))
UPPER = 'Spine01'


def bind(arm: bpy.types.Object, act: bpy.types.Action) -> None:
    """Plays the action on the rig, its slot bound: an action only lying in the file is not played."""
    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
    arm.animation_data.action = act
    arm.animation_data.action_slot = act.slots[0]


def poses(path: str) -> tuple[list[dict], bpy.types.Object]:
    """Every frame of a file's one clip, each bone's place and turn."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    act = bpy.data.actions[0]
    bind(arm, act)
    first, last = (int(f) for f in act.frame_range)
    frames = []
    for f in range(first, last + 1):
        bpy.context.scene.frame_set(f)
        frames.append({pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in arm.pose.bones})
    return frames, arm


bpy.ops.wm.read_factory_settings(use_empty=True)
base, _ = poses(base_path)
clip, arm = poses(clip_path)
if '--frames' in opts:
    a, b = (int(v) for v in opts['--frames'].split(':'))
    clip = clip[a:b + 1]

spine = arm.pose.bones[UPPER]
upper = {spine.name} | {b.name for b in spine.children_recursive}
# Forward, in the spine bone's own axes: the rig's +Y is his left, so a turn about it bends him over.
left = (spine.bone.matrix_local.to_3x3().inverted() @ Vector((0, 1, 0))).normalized()
bend = Quaternion(left, math.radians(LEAN))

act = bpy.data.actions.new(NAME)
for old in list(bpy.data.actions):
    if old is not act:
        bpy.data.actions.remove(old)
arm.animation_data.action = act
for f, pose in enumerate(clip):
    legs = base[f % len(base)]
    for pb in arm.pose.bones:
        loc, rot = (pose if pb.name in upper else legs)[pb.name]
        if pb.name == UPPER:
            rot = rot @ bend
        pb.location, pb.rotation_quaternion = loc, rot
        pb.keyframe_insert('location', frame=f)
        pb.keyframe_insert('rotation_quaternion', frame=f)

arm.animation_data.action = None
track = arm.animation_data.nla_tracks.new()
track.name = NAME
track.strips.new(NAME, 0, act)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_animation_mode='NLA_TRACKS')
print('WROTE', out, NAME, f'{len(clip)} frames, its legs from {base_path}')
