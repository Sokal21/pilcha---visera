"""Put motion capture onto a Tripo rig by its bones' turns, twist and all: for a roll, a fall, a
blow, where copying only which way each bone points (scripts/blender/retarget_bvh.py) loses the
twisting that makes it look alive.

    Blender -b --python scripts/blender/retarget_rot.py -- RIG.glb CLIP.(fbx|bvh) OUT.glb --name rodada [--frames 10:40] [--ground] [--gait]

Reads Mixamo's FBX (mixamorig:Hips...) or CMU's BVH (Hips, LeftUpLeg...).

How: both skeletons are brought to one pose of reference first, the captured one's own rest (a T
for both Mixamo and CMU), the rig's by turning each of its bones to point the way the captured
one's does at rest (its arms go up from Tripo's A). Then for every frame each captured bone's turn
from its rest is given to the matching bone of the rig, from its reference; the hips also rise and
fall, scaled to the rig's legs. Played in place: what the capture travels, the game does. With
--ground the body is rested on the ground every frame, its lowest point touching it (a roll);
with --feet the lowest heel or toe is (anything on its feet: the scabbard hangs low enough to
take the ground from --ground).
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.append(os.path.dirname(__file__))
from keyframes import Rig  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
rig_path, clip, out = args[0], args[1], args[2]
opts = {k: v for k, v in zip(args[3:], args[4:] + ['']) if k.startswith('--')}
NAME = opts.get('--name', 'captura')
FPS = 24

# The rig's bones, and the captured ones they are given the turns of.
PARTS = {
    'Hip': 'Hips', 'Spine01': 'Spine', 'Spine02': 'Spine1', 'NeckTwist01': 'Neck', 'Head': 'Head',
    'L_Clavicle': 'LeftShoulder', 'L_Upperarm': 'LeftArm', 'L_Forearm': 'LeftForeArm',
    'R_Clavicle': 'RightShoulder', 'R_Upperarm': 'RightArm', 'R_Forearm': 'RightForeArm',
    'L_Thigh': 'LeftUpLeg', 'L_Calf': 'LeftLeg', 'L_Foot': 'LeftFoot', 'L_ToeBase': 'LeftToeBase',
    'R_Thigh': 'RightUpLeg', 'R_Calf': 'RightLeg', 'R_Foot': 'RightFoot', 'R_ToeBase': 'RightToeBase',
}
# The hands are left to follow the forearms: a hand has no joint beyond it to know its rest by,
# and given its turns it came out flat and turned through a right angle.
# Where a captured bone's length runs to, to know which way it points: the next joint along.
NEXT = {
    'Hips': 'Spine', 'Spine': 'Spine1', 'Spine1': 'Neck', 'Neck': 'Head',
    'LeftShoulder': 'LeftArm', 'LeftArm': 'LeftForeArm', 'LeftForeArm': 'LeftHand',
    'RightShoulder': 'RightArm', 'RightArm': 'RightForeArm', 'RightForeArm': 'RightHand',
    'LeftUpLeg': 'LeftLeg', 'LeftLeg': 'LeftFoot', 'LeftFoot': 'LeftToeBase',
    'RightUpLeg': 'RightLeg', 'RightLeg': 'RightFoot', 'RightFoot': 'RightToeBase',
}

rig = Rig(rig_path, FPS)
before = set(bpy.data.objects)
if clip.lower().endswith('.fbx'):
    bpy.ops.import_scene.fbx(filepath=clip, automatic_bone_orientation=False)
else:
    bpy.ops.import_anim.bvh(filepath=clip, update_scene_fps=False, update_scene_duration=False)
src = next(o for o in set(bpy.data.objects) - before if o.type == 'ARMATURE')
action = src.animation_data.action
SOURCE_FPS = 30 if clip.lower().endswith('.fbx') else 120
first, last = (int(v) for v in action.frame_range)
if '--frames' in opts:
    first, last = (int(v) for v in opts['--frames'].split(':'))


def named(name: str) -> str:
    """The captured bone of that name, whatever its prefix (Mixamo's mixamorig:...)."""
    return next(b.name for b in src.data.bones if b.name.split(':')[-1] == name)


# A spine of three (Mixamo's Spine, Spine1, Spine2, waist to chest) is given bone for bone to the
# rig's three (Waist, Spine01, Spine02): passed one along, the chest took the middle of the back's
# turn, the waist none, and the spine's twist gathered in one place, where it showed.
if any(b.name.split(':')[-1] == 'Spine2' for b in src.data.bones):
    PARTS = {**PARTS, 'Waist': 'Spine', 'Spine01': 'Spine1', 'Spine02': 'Spine2'}
    NEXT = {**NEXT, 'Spine': 'Spine1', 'Spine1': 'Spine2', 'Spine2': 'Neck'}
SRC = {ours: named(theirs) for ours, theirs in PARTS.items() if any(b.name.split(':')[-1] == theirs for b in src.data.bones)}
SRC_NEXT = {named(a): named(b) for a, b in NEXT.items() if any(x.name.split(':')[-1] == a for x in src.data.bones)}

# The captured skeleton's axes at rest, from its hips and spine, against the rig's (+X forward,
# +Y left, +Z up): the turn that lays one onto the other.
rest = {b.name: src.matrix_world @ b.matrix_local for b in src.data.bones}
hips_l, hips_r = rest[named('LeftUpLeg')].to_translation(), rest[named('RightUpLeg')].to_translation()
spine_up = rest[named('Spine')].to_translation() - rest[named('Hips')].to_translation()
# Up is straight up: the capture's rest stands upright, but its spine leans a little, and taken
# for up it tipped every pose of the clip forward.
up = Vector((0, 0, 1))
left = (hips_l - hips_r)
left = (left - up * left.dot(up)).normalized()
forward = left.cross(up).normalized()
ONTO = Matrix((forward, left, up)).to_3x3()   # rows: captured axes; takes captured into the rig's

# Ahead, while he moves, is the way he travels over the stretch taken, not the way the capture's
# rest pose faces: an actor running and rolling some other way came out rolling sideways.
scene = bpy.context.scene


def hips_at(frame: float) -> Vector:
    scene.frame_set(int(frame), subframe=frame - int(frame))
    return (src.matrix_world @ src.pose.bones[named('Hips')].matrix).to_translation()


travel = hips_at(last) - hips_at(first)
travel.z = 0
if travel.length > 1e-3:
    # Falling back (--backward), ahead is whence he goes: the actor stood side on, on guard, and
    # squared by his hips he fell to his side.
    t_forward = -travel.normalized() if '--backward' in opts else travel.normalized()
    t_left = Vector((0, 0, 1)).cross(t_forward)
    ALONG = Matrix((t_forward, t_left, Vector((0, 0, 1)))).to_3x3()
else:
    ALONG = ONTO


def direction(world: dict, bone: str) -> Vector:
    nxt = SRC_NEXT.get(bone)
    if nxt:
        return (world[nxt].to_translation() - world[bone].to_translation()).normalized()
    return (world[bone].to_3x3() @ Vector((0, 1, 0))).normalized()


# The rig in the captured rest pose: each bone turned to point as its captured one does at rest.
arm = rig.arm
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
reference = {}
for name in rig.order:
    if name not in SRC:
        continue
    pb = arm.pose.bones[name]
    if name != 'Hip':
        want = ONTO @ direction(rest, SRC[name])
        rig.turn_to(pb, want)
    reference[name] = pb.matrix.to_3x3().normalized()
src_rest_turn = {SRC[n]: rest[SRC[n]].to_3x3().normalized() for n in SRC}
# Each bone's reference turn as its parent's reference holds it, to know its own turn later.
reference_from_parent = {n: arm.pose.bones[n].parent.matrix.to_3x3().normalized().inverted() @ reference[n]
                         for n in reference if arm.pose.bones[n].parent is not None}

# The captured legs against the rig's, to scale heights.
leg_src = (rest[named('LeftUpLeg')].to_translation() - rest[named('LeftFoot')].to_translation()).length
leg_rig = (arm.data.bones['L_Thigh'].head_local - arm.data.bones['L_Foot'].head_local).length
scale = leg_rig / leg_src
STILL = travel.length < leg_src * 0.3
REST_HIP = arm.data.bones['Hip'].head_local.z
FOOT_REST = min(arm.data.bones[b].head_local.z for b in ('L_Foot', 'R_Foot', 'L_ToeBase', 'R_ToeBase'))
ONTO4 = ONTO.to_4x4()
# How much of each spine bone's twist about its own length is kept (--twist, 0 to 1): its bending,
# forward and to the side, is all kept, but the capture's twisting of the back read as the spine
# wringing round.
TWIST = float(opts.get('--twist', '0.4'))
SPINE = ('Waist', 'Spine01', 'Spine02', 'NeckTwist01')
# How much a roll is straightened (--straight, 0 to 1): the whole body turned, each frame, so the
# line from hip to hip lies level and square across his way. Rolling over the shoulder, that line slews round
# and legs, body and head all lay askew of the way he went.
STRAIGHT = float(opts.get('--straight', '0'))

act = rig.action(NAME)
length = max(2, round((last - first) / SOURCE_FPS * FPS))


def heading(frame: float) -> float:
    """Which way round the captured pelvis faces, seen along his travel (radians about up)."""
    scene.frame_set(int(frame), subframe=frame - int(frame))
    w = {pb.name: src.matrix_world @ pb.matrix for pb in src.pose.bones}
    left_ = ALONG @ (w[named('LeftUpLeg')].to_translation() - w[named('RightUpLeg')].to_translation())
    return math.atan2(-left_.x, left_.y)


def tilt(frame: float) -> float:
    """How far from upright the captured spine leans, in degrees."""
    scene.frame_set(int(frame), subframe=frame - int(frame))
    w = {pb.name: src.matrix_world @ pb.matrix for pb in src.pose.bones}
    spine = (w[named('Neck')].to_translation() - w[named('Hips')].to_translation()).normalized()
    return math.degrees(math.acos(max(-1.0, min(1.0, spine.z))))


def lowest_hips() -> int:
    return min(range(first, last + 1), key=lambda f: hips_at(f).z)


# Standing he faces the way he goes: wherever the actor stands askew, before he goes down and
# after he is up again, he is turned square to it, frame by frame; in between, while he rolls,
# the turn is eased from the one to the other and the roll keeps its own. (Squared to how he
# stood at the start, an actor who stood askew and lined up as he dived dived askew.)
BOTTOM = lowest_hips()
UPRIGHT_LEAN = 55
DOWN = max([f for f in range(first, BOTTOM + 1) if tilt(f) < UPRIGHT_LEAN] or [first])
UP = min([f for f in range(BOTTOM, last + 1) if tilt(f) < UPRIGHT_LEAN] or [last])
SQUARES = {}


# A clip that hardly goes anywhere (an idle) is turned square once, by how he stands at its start:
# squared frame by frame, its hips' own small sway round would be taken out.


def square(frame: float) -> float:
    if '--backward' in opts:
        return 0.0
    if STILL:
        return SQUARES.setdefault('still', -heading(first))
    if '--gait' in opts:
        # A walk or run cycle is squared once, by how it faces on average round the cycle: squared
        # frame by frame, the hips' own turn with each step would be taken out.
        if 'cycle' not in SQUARES:
            hs = [heading(f) for f in range(first, last + 1)]
            SQUARES['cycle'] = -math.atan2(sum(math.sin(h) for h in hs), sum(math.cos(h) for h in hs))
        return SQUARES['cycle']
    f = round(frame)
    if f not in SQUARES:
        if f <= DOWN or f >= UP:
            SQUARES[f] = -heading(f)
        else:
            a, b = -heading(DOWN), -heading(UP)
            b = a + (b - a + math.pi) % (2 * math.pi) - math.pi
            SQUARES[f] = a + (b - a) * (f - DOWN) / (UP - DOWN)
    return SQUARES[f]


print(f'STANDING until {DOWN}, down at {BOTTOM}, up again from {UP}')
for frame in range(length + 1):
    at = first + (last - first) * frame / length
    turn_square = square(at)
    scene.frame_set(int(at), subframe=at - int(at))
    world = {pb.name: src.matrix_world @ pb.matrix for pb in src.pose.bones}
    squared = Matrix.Rotation(turn_square, 3, 'Z')
    across = squared @ ALONG @ (world[named('LeftUpLeg')].to_translation() - world[named('RightUpLeg')].to_translation())
    across.normalize()
    # Straight across his way and level: square to it but tipped onto his side, he still rolled
    # over the shoulder, lying askew.
    square_across = Vector((0, 1 if across.y >= 0 else -1, 0))
    if STRAIGHT > 0:
        straighten = Quaternion((1, 0, 0, 0)).slerp(across.rotation_difference(square_across.normalized()), STRAIGHT).to_matrix()
    else:
        straighten = Matrix.Identity(3)
    # The hips' height over the ground (the capture's ground is z = 0), as the rig's legs make it.
    hip_height = world[named('Hips')].to_translation().z * scale - REST_HIP

    def posed(lift: float) -> None:
        for pb in arm.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        for name in rig.order:
            if name not in SRC:
                continue
            pb = arm.pose.bones[name]
            theirs = SRC[name]
            # The captured bone's turn from its rest, laid into the rig's axes, after the rig's
            # bone's reference turn.
            # Posed as the capture is, seen along the way he travels; from its rest, seen as it faces.
            turned = ALONG @ world[theirs].to_3x3().normalized() @ src_rest_turn[theirs].inverted() @ ONTO.inverted()
            turned = straighten @ squared @ turned
            head = pb.matrix.to_translation()
            if name == 'Hip':
                head = head + Vector((0, 0, lift))
            want = turned @ reference[name]
            if name in SPINE and TWIST < 1 and pb.parent is not None:
                # Its turn from where its parent now holds it, as it was at the reference; the part
                # of that about its own length is cut down.
                held = pb.parent.matrix.to_3x3().normalized() @ reference_from_parent[name]
                delta = (want @ held.inverted()).to_quaternion()
                axis = (held @ Vector((0, 1, 0))).normalized()
                twist = Quaternion((delta.w, *(axis * Vector(delta[1:4]).dot(axis)))).normalized()
                swing = delta @ twist.inverted()
                kept = Quaternion((1, 0, 0, 0)).slerp(twist, TWIST)
                want = (swing @ kept).to_matrix() @ held
            pb.matrix = Matrix.Translation(head) @ want.to_4x4()
            bpy.context.view_layer.update()

    # Posed with no action on it: with one, every update laid back what was keyed on the frames
    # before, and the hips rose a little more each frame.
    arm.animation_data.action = None
    lift = hip_height
    posed(lift)
    if '--feet' in opts:
        # On his feet: the lowest of heels and toes set where they stand at rest. (Rested by the
        # lowest point of the mesh, the scabbard's tip, hanging nearly to the ground, took the
        # ground and he floated over it.)
        def feet() -> float:
            return min((arm.matrix_world @ arm.pose.bones[b].head).z for b in ('L_Foot', 'R_Foot', 'L_ToeBase', 'R_ToeBase'))
        for _ in range(3):
            off = feet() - FOOT_REST
            if abs(off) < 0.001:
                break
            lift -= off
            posed(lift)
    elif '--ground' in opts:
        for _ in range(3):
            low = rig.lowest()
            if abs(low) < 0.002:
                break
            lift -= low
            posed(lift)
    arm.animation_data.action = act
    for pb in arm.pose.bones:
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.keyframe_insert('location', frame=frame)

# How far along his way he has come at each frame, as a share of the whole: the game shows the
# frame he had reached when he has come as far (--travel FILE.json), so he never slides.
if '--travel' in opts:
    import json
    start = hips_at(first)
    gone = [max(0.0, (ALONG @ (hips_at(first + (last - first) * k / length) - start)).x) for k in range(length + 1)]
    for k in range(1, len(gone)):
        gone[k] = max(gone[k], gone[k - 1])
    whole = gone[-1] or 1
    json.dump([round(g / whole, 4) for g in gone], open(opts['--travel'], 'w'))
    print('TRAVEL', opts['--travel'])

bpy.data.objects.remove(src)
for a in [a for a in bpy.data.actions if a is not act]:
    bpy.data.actions.remove(a)
rig.export(out)
