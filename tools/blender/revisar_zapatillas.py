"""Revisa cuadro por cuadro cómo quedan las zapatillas en cada clip del GLB del protagonista.

    Blender -b --python tools/blender/revisar_zapatillas.py -- public/models/protagonista.glb

Por cada cuadro y cada pie, la rotación de la zapatilla respecto de su reposo (ajustada sobre sus
vértices: no depende de los ejes de los huesos), su punto más bajo y cuánto se aleja su boca de la
canilla. Lista los cuadros en que la zapatilla se inclina más de LIMITE grados, queda por debajo
del piso o se despega del tobillo (SEPARA), y el peor de cada clip.
"""
import math
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
LIMITE = 50
SEPARA = 0.012  # cuánto más que en reposo puede alejarse la boca de la zapatilla de la canilla

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args[0])
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for t in arm.animation_data.nla_tracks:
    t.mute = True
shoe = bpy.data.objects['ropa_jordan']


def points() -> np.ndarray:
    dg = bpy.context.evaluated_depsgraph_get()
    m = shoe.evaluated_get(dg).to_mesh()
    return np.array([(shoe.matrix_world @ v.co)[:] for v in m.vertices])


arm.animation_data.action = None
for b in arm.pose.bones:
    b.matrix_basis.identity()
bpy.context.view_layer.update()
rest = points()
sides = {'L': rest[:, 0] > 0, 'R': rest[:, 0] < 0}
# La boca de cada zapatilla (sus vértices más altos) y qué tan lejos queda de la canilla: si se
# aleja mucho más que en reposo, la zapatilla se despegó del tobillo.
mouths = {}
for side, mask in sides.items():
    top = rest[mask][:, 2].max()
    mouths[side] = np.nonzero(mask & (rest[:, 2] > top - 0.012))[0]


def shin_gap(now: np.ndarray, side: str) -> float:
    calf = arm.pose.bones[f'{side}_Calf']
    a = np.array((arm.matrix_world @ calf.head)[:])
    b = np.array((arm.matrix_world @ calf.tail)[:])
    p = now[mouths[side]].mean(0)
    t = np.clip((p - a) @ (b - a) / ((b - a) @ (b - a)), 0, 1)
    return float(np.linalg.norm(p - (a + t * (b - a))))


rest_gap = {side: shin_gap(rest, side) for side in sides}

for act in sorted(bpy.data.actions, key=lambda a: a.name):
    arm.animation_data.action = act
    arm.animation_data.action_slot = act.slots[0]
    first, last = map(int, act.frame_range)
    bad, worst = [], (0, None, None)
    for f in range(first, last + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        now = points()
        for side, mask in sides.items():
            a = rest[mask] - rest[mask].mean(0)
            b = now[mask] - now[mask].mean(0)
            u, _, vt = np.linalg.svd(a.T @ b)
            d = np.diag([1, 1, np.sign(np.linalg.det(vt.T @ u.T))])
            r = vt.T @ d @ u.T
            tilt = math.degrees(math.acos(max(-1, min(1, (r @ [0, 0, 1])[2]))))
            low = now[mask][:, 2].min()
            gap = shin_gap(now, side) - rest_gap[side]
            if tilt > worst[0]:
                worst = (tilt, f, side)
            if tilt > LIMITE or low < -0.01 or gap > SEPARA:
                bad.append(f'{f}{side}:{tilt:.0f}°/{low:+.3f}/boca {gap:+.3f}')
    print(f'REVISION {act.name}: peor {worst[0]:.0f}° (cuadro {worst[1]}, {worst[2]})', ' '.join(bad[:30]))
