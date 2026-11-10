"""A model of ours (Tripo's, unrigged) put on the skeleton of one of Quaternius's animals (CC0): the ox on
the bull, the nahuel (a puma) on the wolf. Written for the ox on Quaternius's bull's skeleton, to play the bull's own
clips as they are: carried over onto Tripo's quadruped rig, the walk came out strange however it was
mended (its hind legs never bent as a cow's). The bull's bones are moved into the ox's body, its skin
bound to them by Blender, and its clips kept untouched: they are turns of those same bones.

    Blender -b --python scripts/blender/fit_to_bull.py -- OX.glb BULL.fbx OUT.glb [--still Ear,Tail] [--hips yes] [--even yes]

- The ox is turned to look as the bull does (along -Y, its left at +X) and sized to the bull's length,
  its feet on the ground.
- The bull's bones are stretched to the ox's box; then every joint of a leg below the belly is moved
  across and along to the middle of the ox's leg at that height, so each bone lies inside its leg.
- The skin is weighed by heat on a copy with its doubled vertices merged (Tripo doubles them along its
  texture's seams: weighed apart, the skin cracks open there), given back from the copy's nearest;
  small loose pieces (horns, eyes) go whole with the nearest of the body.
- Its tail's bones are laid down the ox's own tail, its middle found at each height.
- Only the bones' keys are kept in the clips (each also keys the whole armature, in the FBX's units).
OUT goes to prepare_rigged.py (front +z: it looks along glTF's +Z already).
"""
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

args = sys.argv[sys.argv.index('--') + 1:]
OX, BULL, OUT = args[:3]
STILL = [k for k in dict(zip(args[3::2], args[4::2])).get('--still', '').split(',') if k]
HIPS = dict(zip(args[3::2], args[4::2])).get('--hips') == 'yes'
EVEN_ON = dict(zip(args[3::2], args[4::2])).get('--even') == 'yes'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=BULL)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    bpy.data.objects.remove(o)
for action in bpy.data.actions:
    action.name = action.name.split('|')[-1]
    action.use_fake_user = True
    for bag in [b for layer in action.layers for strip in layer.strips for b in strip.channelbags]:
        for curve in [c for c in bag.fcurves if not c.data_path.startswith('pose.bones')]:
            bag.fcurves.remove(curve)
arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=OX)
new = set(bpy.data.objects) - before
ox = max((o for o in new if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
for o in new:
    if o is not ox:
        bpy.data.objects.remove(o)
ox.parent = None
# Its turn and size into the mesh itself: Tripo's looks along +X with its left at +Y.
ox.matrix_world = Matrix.Rotation(-1.5707963, 4, 'Z') @ ox.matrix_world
bpy.context.view_layer.objects.active = ox
ox.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def box(points):
    lo = Vector([min(p[i] for p in points) for i in range(3)])
    hi = Vector([max(p[i] for p in points) for i in range(3)])
    return lo, hi


M = arm.matrix_world
bones = arm.data.bones
deform = [b for b in bones if not any(k in b.name for k in ('Pole', 'IK', 'FF', '_end'))]
# By name: the bones themselves are not to be held across edit mode.
DEFORM = {b.name for b in deform}
blo, bhi = box([M @ b.head_local for b in deform] + [M @ b.tail_local for b in deform])
# The bull's body: from its hooves to the top of its back, tail to muzzle.
# The animal's skeleton by its own names: Quaternius's (Head, Tail1…, FrontUpperLeg.L…) or Rigify's
# metarig (the Ice Age pack's sabre-tooth: spine.011 its head, spine.003… its tail, front_thigh.L…).
RIGIFY = 'spine.011' in bones
NAMES = {
    'head': 'spine.011' if RIGIFY else 'Head',
    'tail': ['spine.003', 'spine.002', 'spine.001', 'spine'] if RIGIFY else None,
    'legs': ('thigh', 'shin', 'foot') if RIGIFY else ('UpperLeg', 'LowerLeg', 'BackLeg'),
    'ground': 'toe' if RIGIFY else 'LowerLeg',
    'back': ('spine.005', 'spine.006', 'spine.007') if RIGIFY else ('Torso', 'Back'),
    'root': 'spine.004' if RIGIFY else 'Body',
}
is_front = (lambda n: n.startswith('front_')) if RIGIFY else (lambda n: n.startswith('Front'))
tail_root = NAMES['tail'][0] if RIGIFY else 'Tail1'
bull_len = (M @ bones[NAMES['head']].tail_local).y - (M @ bones[tail_root].head_local).y
olo, ohi = box([v.co for v in ox.data.vertices])
ox_len = ohi.y - olo.y
s = abs(bull_len) / ox_len * 1.08
for v in ox.data.vertices:
    v.co = Vector(((v.co.x - (olo.x + ohi.x) / 2) * s, (v.co.y - (olo.y + ohi.y) / 2) * s, (v.co.z - olo.z) * s))
ox.data.update()
olo, ohi = box([v.co for v in ox.data.vertices])

# The bull's bones stretched to the ox's box (hooves at the ground, its back and length the ox's).
ground = min((M @ b.tail_local).z for b in bones if NAMES['ground'] in b.name and b.name.endswith(('.L', '.R')))
back = max((M @ b.head_local).z for b in deform if b.name.startswith(NAMES['back']))
ox_back = max(v.co.z for v in ox.data.vertices if abs(v.co.y) < (ohi.y - olo.y) * 0.15 and abs(v.co.x) < (ohi.x - olo.x) * 0.2)
mid_b = (blo + bhi) / 2
width = (ohi.x - olo.x) / max(1e-6, (bhi.x - blo.x)) * 0.8


EVEN = (ox_back * 0.96) / (back - ground)


def stretch(p: Vector) -> Vector:
    # With `--even yes`, by one measure every way, to its height (the puma stands far higher on its legs
    # than the wolf: stretched more up than along, the skeleton turned differently, and as the wolf
    # crouched to strike the puma splayed its legs and kept its body up).
    if EVEN_ON:
        return Vector((p.x * EVEN, (p.y - mid_b.y) * EVEN + (olo.y + ohi.y) / 2, (p.z - ground) * EVEN))
    return Vector((p.x * width, (p.y - mid_b.y) * (ohi.y - olo.y) / (bhi.y - blo.y) + (olo.y + ohi.y) / 2,
                   (p.z - ground) * (ox_back * 0.96) / (back - ground)))


bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
edit = arm.data.edit_bones
inv = M.inverted()
for b in edit:
    b.use_connect = False
for b in edit:
    b.head, b.tail = inv @ stretch(M @ b.head), inv @ stretch(M @ b.tail)

# Each leg's joints below the belly moved to the middle of the ox's leg at that height.
verts = [v.co for v in ox.data.vertices]
length = ohi.y - olo.y
belly = ox_back * 0.55


def leg_middle(at: Vector, side: float, front: bool, top: float = None):
    top = belly if top is None else top
    near = [p for p in verts if abs(p.z - at.z) < length * 0.025 and p.x * side > 0
            and (p.y < 0 if front else p.y > 0) and abs(p.y - at.y) < length * 0.18 and p.z < top]
    if len(near) < 6:
        return None
    return Vector((sum(p.x for p in near) / len(near), sum(p.y for p in near) / len(near), at.z))


for b in edit:
    if not any(k in b.name for k in NAMES['legs']) or not b.name.endswith(('.L', '.R')):
        continue
    side = 1 if b.name.endswith('.L') else -1
    front = is_front(b.name)
    for end in ('head', 'tail'):
        p = M @ getattr(b, end)
        # A hind leg's joints up to the hip too, with `--hips yes` (the wolf's thigh lay outside the puma's, and
        # its skin tore at the hip as it galloped): the middle of the thigh's half at that height.
        reach = ox_back * 0.85 if HIPS and not front else belly
        if p.z < reach:
            found = leg_middle(p, side, front, reach)
            if found:
                setattr(b, end, inv @ found)
# The tail's bones down the ox's own tail (where the bull's lie, its tail flew about anyhow, and held
# by the back its tuft caught on the hind legs): its middle at so many heights, from its root by the
# rump down to its tuft, found among the ox's corners behind its rump and near its middle line.
rump = max(p.y for p in verts if p.z > ox_back * 0.6)
tail = [p for p in verts if p.y > rump - length * 0.03 and abs(p.x) < (ohi.x - olo.x) * 0.07]
if tail:
    top, bottom = max(p.z for p in tail), min(p.z for p in tail)
    # However many the animal has (the bull 7, the wolf 8).
    chain = [edit[n] for n in NAMES['tail']] if RIGIFY else sorted((b for b in edit if b.name.startswith('Tail') and b.name[4:].isdigit()), key=lambda b: int(b.name[4:]))
    marks = []
    for k in range(len(chain) + 1):
        z = top + (bottom - top) * k / len(chain)
        near = [p for p in tail if abs(p.z - z) < length * 0.025] or tail
        marks.append(Vector((sum(p.x for p in near) / len(near), sum(p.y for p in near) / len(near), z)))
    for bone, a, b in zip(chain, marks, marks[1:]):
        bone.head, bone.tail = inv @ a, inv @ b
    end = edit.get(f'{chain[-1].name}_end')
    if end:
        end.head, end.tail = inv @ marks[-1], inv @ (marks[-1] + Vector((0, 0, -length * 0.02)))
# Whole again: each child's head where its parent's tail now is.
for b in edit:
    if b.parent and (b.head - b.parent.tail).length < 0.35 * s:
        b.head = b.parent.tail
bpy.ops.object.mode_set(mode='OBJECT')
for b in arm.data.bones:
    # Bones the animal has and ours does not want: by `--still Ear,Tail`, those named so hold nothing
    # (the wolf's great ears took half the puma's head; its tail, thrashing, tangled the puma's curled
    # one with its hind legs), and what they would have held goes with whatever else is nearest.
    still = NAMES['tail'] if RIGIFY and 'Tail' in STILL else []
    b.use_deform = b.name in DEFORM and b.name != 'Body' and b.name not in still and not any(b.name.startswith(k) for k in STILL)

# The skin, weighed by heat on a merged copy, given back from its nearest.
copy = ox.copy()
copy.data = ox.data.copy()
bpy.context.collection.objects.link(copy)
merged = bmesh.new()
merged.from_mesh(copy.data)
bmesh.ops.remove_doubles(merged, verts=merged.verts, dist=0.002 * s)
merged.to_mesh(copy.data)
merged.free()
bpy.ops.object.select_all(action='DESELECT')
copy.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
tree = KDTree(len(copy.data.vertices))
for v in copy.data.vertices:
    tree.insert(v.co, v.index)
tree.balance()
names = [g.name for g in copy.vertex_groups]
weights = {}
for v in ox.data.vertices:
    _, i, _ = tree.find(v.co)
    weights[v.index] = {names[g.group]: g.weight for g in copy.data.vertices[i].groups if g.weight > 0}
pieces = bmesh.new()
pieces.from_mesh(ox.data)
pieces.verts.ensure_lookup_table()
seen, islands = set(), []
for start in pieces.verts:
    if start.index in seen:
        continue
    island, stack = [], [start]
    seen.add(start.index)
    while stack:
        v = stack.pop()
        island.append(v.index)
        for e in v.link_edges:
            w = e.other_vert(v)
            if w.index not in seen:
                seen.add(w.index)
                stack.append(w)
    islands.append(island)
pieces.free()
islands.sort(key=len, reverse=True)
whole = KDTree(len(islands[0]))
for i in islands[0]:
    whole.insert(ox.data.vertices[i].co, i)
whole.balance()
# Small loose pieces low down, by the legs, are no part of the ox (splinters Tripo left): taken off.
low = ox_back * 0.5
splinters = [i for island in islands[1:] if len(island) < 40 and max(ox.data.vertices[i].co.z for i in island) < low for i in island]
for island in islands[1:]:
    if len(island) > len(islands[0]) * 0.05:
        continue
    middle = sum((ox.data.vertices[i].co for i in island), Vector()) / len(island)
    _, nearest, _ = whole.find(middle)
    for i in island:
        weights[i] = dict(weights[nearest])
bpy.data.objects.remove(copy)
for name in names:
    ox.vertex_groups.new(name=name)
for i, ws in weights.items():
    for name, w in ws.items():
        ox.vertex_groups[name].add([i], w, 'REPLACE')
if splinters:
    gone = bmesh.new()
    gone.from_mesh(ox.data)
    gone.verts.ensure_lookup_table()
    bmesh.ops.delete(gone, geom=[gone.verts[i] for i in splinters], context='VERTS')
    gone.to_mesh(ox.data)
    gone.free()
print('splinters taken off', len(splinters))
ox.parent = arm
ox.modifiers.new('Armature', 'ARMATURE').object = arm
print('held', {g.name: sum(1 for v in ox.data.vertices if any(x.group == g.index and x.weight > 0.5 for x in v.groups)) for g in ox.vertex_groups})
print('copyheld', {n: sum(1 for v in weights.values() if v.get(n, 0) > 0.5) for n in names})

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True)
print('WROTE', OUT, [a.name for a in bpy.data.actions])
