"""Put a stride of real motion capture onto a Tripo rig, as a looping clip played in place.

    Blender -b --python scripts/blender/retarget_bvh.py -- RIG.glb CLIP.bvh OUT.glb --name caminata [--stride 0]
    Blender -b --python scripts/blender/retarget_bvh.py -- RIG.glb CLIP.bvh OUT.glb --name rodada --frames 61:193

With --frames, the stretch of the clip between those frames is taken as it is, not a stride:
for a roll, a fall, a blow. Then the hips are turned however the captured pelvis turns (all the
way over, in a roll), not only round and tilted, and the body is rested on the ground every frame
(its lowest point touching it), played in place: the game carries him.

For CMU's free motion capture (BVH, its skeleton's names). It finds the strides in the clip (from
one peak of the left thigh forward to the next), takes the one asked for (the middle one if not
said), and for each frame of it points each of the rig's bones the way the matching captured bone
points: thighs, calves, feet, upper arms, forearms, collarbones, the spine and the neck.
Directions are taken in the body's own frame (the way it travels over the stride, his left, up),
so the rig's different proportions do not matter; the hips keep their turn and tilt, and the body
its rise and fall, scaled to the rig's height. Twist along a bone is not carried.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.append(os.path.dirname(__file__))
from keyframes import Rig, ahead, turn  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
rig_path, bvh_path, out = args[0], args[1], args[2]
opts = dict(zip(args[3::2], args[4::2]))
NAME = opts.get('--name', 'captura')
FPS = 24

rig = Rig(rig_path, FPS)
before = set(bpy.data.objects)
bpy.ops.import_anim.bvh(filepath=bvh_path, update_scene_fps=False, update_scene_duration=False)
src = next(o for o in set(bpy.data.objects) - before if o.type == 'ARMATURE')
action = src.animation_data.action
first, last = (int(v) for v in action.frame_range)
SOURCE_FPS = round(1 / 0.0083333)   # CMU's are captured at 120 a second
scene = bpy.context.scene

# (captured from, captured to) -> the rig's bone pointed along it.
AIM = {
    'L_Thigh': ('LeftUpLeg', 'LeftLeg'), 'L_Calf': ('LeftLeg', 'LeftFoot'), 'L_Foot': ('LeftFoot', 'LeftToeBase'),
    'R_Thigh': ('RightUpLeg', 'RightLeg'), 'R_Calf': ('RightLeg', 'RightFoot'), 'R_Foot': ('RightFoot', 'RightToeBase'),
    'Spine01': ('Spine', 'Neck'), 'NeckTwist01': ('Neck', 'Head'),
    'L_Clavicle': ('LeftShoulder', 'LeftArm'), 'L_Upperarm': ('LeftArm', 'LeftForeArm'),
    'L_Forearm': ('LeftForeArm', 'LeftHand'),
    'R_Clavicle': ('RightShoulder', 'RightArm'), 'R_Upperarm': ('RightArm', 'RightForeArm'),
    'R_Forearm': ('RightForeArm', 'RightHand'),
}
# The hands are left to follow the forearms: a hand's bone has no joint beyond it to aim by, and
# its made-up axis turned the hand, and the cuff with it, up and forward.


def at(frame: float) -> dict[str, Vector]:
    scene.frame_set(int(frame), subframe=frame - int(frame))
    return {pb.name: src.matrix_world @ pb.head for pb in src.pose.bones}


# The strides: peaks of the left thigh forward, along the way the body travels.
heads = [at(f) for f in range(first, last + 1)]
travel = heads[-1]['Hips'] - heads[0]['Hips']
travel.z = 0
forward = travel.normalized()
swing = [(h['LeftLeg'] - h['LeftUpLeg']).normalized().dot(forward) for h in heads]
# A peak is the furthest forward within half a second either way: the capture's jitter makes many
# small ones, and no stride is shorter than that.
WINDOW = SOURCE_FPS // 2
peaks = [i for i in range(len(swing)) if swing[i] == max(swing[max(0, i - WINDOW):i + WINDOW + 1])
         and swing[i] > max(swing) - 0.4 * (max(swing) - min(swing))]
strides = list(zip(peaks, peaks[1:])) or [(0, 1)]
if '--frames' in opts:
    a, b = (int(v) for v in opts['--frames'].split(':'))
else:
    pick = strides[int(opts['--stride'])] if '--stride' in opts else strides[len(strides) // 2]
    a, b = pick[0] + first, pick[1] + first
print(f'STRIDES {[(p + first, q + first) for p, q in strides]} -> {a}-{b} ({(b - a) / SOURCE_FPS:.2f}s)')

# The body's frame over that stride.
travel = at(b)['Hips'] - at(a)['Hips']
travel.z = 0
fwd = travel.normalized()
up = Vector((0, 0, 1))
left = up.cross(fwd)


def ours(v: Vector) -> Vector:
    """A captured direction in the rig's axes: +X forward, +Y left, +Z up."""
    return Vector((v.dot(fwd), v.dot(left), v.dot(up)))


# Heights: the captured hips over the stride, and the rig's.
heights = [at(a + (b - a) * n / 32)['Hips'].z for n in range(33)]
mid = sum(heights) / len(heights)
captured_leg = (at(a)['LeftUpLeg'] - at(a)['LeftFoot']).length
rig_leg = (rig.arm.data.bones['L_Thigh'].head_local - rig.arm.data.bones['L_Foot'].head_local).length
scale = rig_leg / captured_leg

act = rig.action(NAME)
STRETCH = '--frames' in opts
length = max(2, round((b - a) / SOURCE_FPS * FPS))
REST_HIP = rig.arm.data.bones['Hip'].head_local.z
for frame in range(length + 1):
    if STRETCH:
        h = at(a + (b - a) * frame / length)
    else:
        # The last frame is the first again, so the loop closes.
        h = at(a + (b - a) * (frame % length) / length)
    spec = {bone: ahead(*ours(h[to] - h[fr])) for bone, (fr, to) in AIM.items()}
    hips = ours(h['LeftUpLeg'] - h['RightUpLeg'])
    if STRETCH:
        # The pelvis as it is: its left from hip to hip, its up toward the spine.
        left = hips.normalized()
        up_ = ours(h['Spine'] - h['Hips']).normalized()
        forward = left.cross(up_).normalized()
        up_ = forward.cross(left).normalized()
        q = Matrix((forward, left, up_)).transposed().to_quaternion()
        spec['Hip'] = [('move', (0, 0, h['Hips'].z * scale - REST_HIP)), ('turn', q)]
        # Rested on the ground: the lowest point of him touching it.
        bpy.context.scene.frame_set(frame)
        rig.arm.animation_data.action = act
        lift = h['Hips'].z * scale - REST_HIP
        for _ in range(3):
            spec['Hip'][0] = ('move', (0, 0, lift))
            rig.pose(spec)
            low = rig.lowest()
            if abs(low) < 0.002:
                break
            lift -= low
    else:
        yaw = math.degrees(math.atan2(-hips.x, hips.y))
        tilt = math.degrees(math.atan2(hips.z, math.hypot(hips.x, hips.y)))
        spec['Hip'] = [('move', (0, 0, (h['Hips'].z - mid) * scale)), turn('z', yaw), turn('x', -tilt)]
    rig.key(act, frame, spec)

bpy.data.objects.remove(src)
bpy.data.actions.remove(action)
rig.export(out)
