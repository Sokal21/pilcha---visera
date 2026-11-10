"""Start a clip from another's pose: over its first frames, every bone is eased from where it
stands in a frame of another clip of the same rig into the clip's own. For a capture whose actor
starts on guard (Mixamo's Falling Back Death) to start from his standing instead.

    Blender -b --python scripts/blender/ease_from.py -- CLIP.glb FROM.glb OUT.glb [--frames 8] [--at 0]

CLIP.glb and FROM.glb are single clips of one rig (scripts/blender/retarget_rot.py's); --frames is
how many of the clip's first frames are eased over, slow-fast-slow, and --at which frame of FROM
it starts from.
"""
import math
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
clip_path, from_path, out = args[:3]
opts = dict(zip(args[3::2], args[4::2]))
FRAMES = int(opts.get('--frames', 8))
AT = int(opts.get('--at', 0))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=from_path)
source = next(o for o in bpy.data.objects if o.type == 'ARMATURE')


def bind(arm: bpy.types.Object, act: bpy.types.Action) -> None:
    """Plays the action on the rig, its slot bound: an action only lying in the file is not played."""
    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
    arm.animation_data.action = act
    arm.animation_data.action_slot = act.slots[0]


bind(source, bpy.data.actions[0])
bpy.context.scene.frame_set(AT)
start = {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in source.pose.bones}
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

bpy.ops.import_scene.gltf(filepath=clip_path)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
act = bpy.data.actions[0]
bind(arm, act)
scene = bpy.context.scene
first = int(act.frame_range[0])
# Read every eased frame before keying any, so a key does not change what is read next.
own = {}
for f in range(first, first + FRAMES + 1):
    scene.frame_set(f)
    own[f] = {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in arm.pose.bones}
for f, pose in own.items():
    k = 0.5 - 0.5 * math.cos(math.pi * (f - first) / FRAMES)
    for pb in arm.pose.bones:
        if pb.name not in start:
            continue
        loc0, rot0 = start[pb.name]
        loc1, rot1 = pose[pb.name]
        if rot0.dot(rot1) < 0:
            rot0 = -rot0
        pb.location = loc0.lerp(loc1, k)
        pb.rotation_quaternion = rot0.slerp(rot1, k)
        pb.keyframe_insert('location', frame=f)
        pb.keyframe_insert('rotation_quaternion', frame=f)

arm.animation_data.action = None
track = arm.animation_data.nla_tracks.new()
track.name = act.name
track.strips.new(act.name, first, act)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_animation_mode='NLA_TRACKS')
print('WROTE', out, act.name, f'eased over frames {first}..{first + FRAMES}')
