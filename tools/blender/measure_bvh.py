"""Measure a motion capture's gait in plain angles, to key an animation by real numbers.

    Blender -b --python scripts/blender/measure_bvh.py -- CLIP.bvh [--from 0] [--to 999]

For every frame: each upper arm's and thigh's swing in the plane of walking, against the torso
(degrees, forward positive), each elbow's and knee's bend, and the body's height. Prints the range
of each and, over one stride (from one left heel strike to the next, found where the left thigh
is furthest forward), each at sixteen even moments: the curves to copy.
CMU's skeleton names (LeftArm, LeftForeArm, LeftUpLeg, LeftLeg...) are expected.
"""
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
opts = dict(zip(args[1::2], args[2::2]))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_anim.bvh(filepath=args[0], update_scene_fps=True, update_scene_duration=True)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
scene = bpy.context.scene
start = max(scene.frame_start, int(opts.get('--from', 0)))
end = min(scene.frame_end, int(opts.get('--to', 10 ** 6)))


def where(bone, tail=False):
    pb = arm.pose.bones[bone]
    return arm.matrix_world @ (pb.tail if tail else pb.head)


rows = []
for f in range(start, end + 1):
    scene.frame_set(f)
    up = (where('Neck') - where('Hips')).normalized()
    across = (where('LeftUpLeg') - where('RightUpLeg'))
    forward = up.cross(across).normalized()      # left × up is backward; up × left is forward
    side = forward.cross(up).normalized()

    def swing(a, b):
        d = (where(b) - where(a)).normalized()
        d = d - side * d.dot(side)
        return math.degrees(math.atan2(d.dot(forward), -d.dot(up)))

    def bend(a, b, c):
        u, v = (where(b) - where(a)).normalized(), (where(c) - where(b)).normalized()
        return math.degrees(math.acos(max(-1, min(1, u.dot(v)))))

    rows.append({
        'L_arm': swing('LeftArm', 'LeftForeArm'), 'R_arm': swing('RightArm', 'RightForeArm'),
        'L_elbow': bend('LeftArm', 'LeftForeArm', 'LeftHand'), 'R_elbow': bend('RightArm', 'RightForeArm', 'RightHand'),
        'L_thigh': swing('LeftUpLeg', 'LeftLeg'), 'R_thigh': swing('RightUpLeg', 'RightLeg'),
        'L_knee': bend('LeftUpLeg', 'LeftLeg', 'LeftFoot'), 'R_knee': bend('RightUpLeg', 'RightLeg', 'RightFoot'),
        'lean': math.degrees(math.atan2(up.dot(forward), up.z)) if abs(up.z) > 0.1 else 0,
        'height': where('Hips').z,
    })

print(f'FRAMES {start}-{end} at {scene.render.fps} fps')
for k in rows[0]:
    vs = [r[k] for r in rows]
    print(f'RANGE {k:8s} {min(vs):7.1f} .. {max(vs):7.1f}')
# One stride: between two peaks of the left thigh forward.
th = [r['L_thigh'] for r in rows]
peaks = [i for i in range(1, len(th) - 1) if th[i] >= th[i - 1] and th[i] > th[i + 1] and th[i] > max(th) - 0.35 * (max(th) - min(th))]
if len(peaks) >= 2:
    a, b = peaks[len(peaks) // 2 - 1], peaks[len(peaks) // 2]
    print(f'STRIDE frames {a + start}-{b + start} ({(b - a) / scene.render.fps:.2f}s)')
    for k in rows[0]:
        line = [rows[a + round((b - a) * n / 16)][k] for n in range(16)]
        print(f'CURVE {k:8s} ' + ' '.join(f'{v:6.1f}' if k != 'height' else f'{v:6.2f}' for v in line))
