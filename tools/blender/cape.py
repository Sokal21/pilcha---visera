"""A long cape off the arms and legs: Tripo's rig binds the skin to whichever bones are nearest, so
the captain's cape, hanging behind him from the shoulders to mid-calf, was held by his arms (it hung
off the raised arm like a bat's wing) and his legs (it split and stretched with every step). Whatever
an arm or leg bone holds that lies further from that limb than the limb is thick is given instead to
his chest (Spine02) or his hips (Pelvis): the skin of the limb stays on it, the cape goes with his body.

Done by prepare_rigged.py (`--cape yes`) on the model as it loads it. Not on a file of its own: a rig
exported again from Blender and given to prepare_rigged.py took the clips wrongly at the wrist (the
pistol went on without the hand).

How far from a limb's bones its own skin goes, as shares of his height, measured on the captain:
upper arm 0.065; forearm 0.055 (its skin to 0.05, the cape from 0.06); hand 0.06 (its skin to 0.04;
the right hand held some 400 of the cape's vertices, from 0.08 to 0.37 away, which flew up behind
the pistol in a fan); leg 0.085 (skin to 0.07, nothing at 0.08, the cape from 0.09).
"""
import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

REACH = {'Upperarm': 0.065, 'Forearm': 0.055, 'Hand': 0.06, 'Thigh': 0.085}


def off_limbs(arm: bpy.types.Object, body: bpy.types.Object) -> dict:
    """Moves the cape off the limbs, in the rest pose; says how many vertices went to each bone."""
    bones = arm.data.bones
    corners = [body.matrix_world @ Vector(c) for c in body.bound_box]
    tall = max(c.z for c in corners) - min(c.z for c in corners)

    def chain(*names: str) -> list:
        """A limb as a line of points, in the world: each bone's head, and the last one's tail."""
        points = [arm.matrix_world @ bones[n].head_local for n in names]
        return points + [arm.matrix_world @ bones[names[-1]].tail_local]

    limbs = []
    for side in ('L', 'R'):
        limbs.append((('Upperarm',), side, chain(f'{side}_Upperarm', f'{side}_Forearm'), REACH['Upperarm'] * tall, 'Spine02'))
        limbs.append((('Forearm',), side, chain(f'{side}_Forearm', f'{side}_Hand'), REACH['Forearm'] * tall, 'Spine02'))
        limbs.append((('Hand',), side, chain(f'{side}_Hand'), REACH['Hand'] * tall, 'Spine02'))
        limbs.append((('Thigh', 'Calf', 'Foot', 'ToeBase'), side, chain(f'{side}_Thigh', f'{side}_Calf', f'{side}_Foot', f'{side}_ToeBase'), REACH['Thigh'] * tall, 'Pelvis'))
    groups = body.vertex_groups
    moved = {'Spine02': 0, 'Pelvis': 0}
    for v in body.data.vertices:
        p = body.matrix_world @ v.co
        for parts, side, line, reach, to in limbs:
            held = [g for g in v.groups if groups[g.group].name.startswith(side + '_') and any(k in groups[g.group].name for k in parts) and g.weight > 0]
            if not held or away(p, line) <= reach:
                continue
            weight = sum(g.weight for g in held)
            for g in held:
                groups[g.group].remove([v.index])
            (groups.get(to) or groups.new(name=to)).add([v.index], weight, 'ADD')
            moved[to] += 1
    return moved


def away(p: Vector, line: list) -> float:
    """How far a point is from a limb's line."""
    best = float('inf')
    for a, b in zip(line, line[1:]):
        at, share = intersect_point_line(p, a, b)
        at = a if share < 0 else b if share > 1 else at
        best = min(best, (p - at).length)
    return best
