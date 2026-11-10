"""Huesos de dedos para el rig de Tripo, que termina en la mano: tres por dedo, ubicados por la forma
de la mano en la malla, y los vértices de cada dedo pasados de la mano a sus huesos.

    from dedos import add_fingers
    add_fingers(arm, body)   # con el rig en reposo, antes de leer los pesos del cuerpo

Cómo los encuentra, por mano (en la malla, sin nombres): la mano es lo que el hueso de la mano
mueve; su eje va de la muñeca al centro de esos vértices y la palma mira al cuerpo. De la mitad de
la mano hacia la punta, los cuatro dedos se separan de costado: se agrupan en cuatro por esa
coordenada, y cada dedo es la línea de los centros de su grupo de la base a la punta. El pulgar
es lo que queda del lado de afuera de los dedos, más cerca de la muñeca. Los huesos se llaman
<L|R>_<Thumb|Index|Middle|Ring|Pinky><1..3>; su Z mira hacia la palma, así doblar un dedo es girarlo
sobre su X.

Pesos: cada vértice de la mano que queda cerca de la línea de un dedo (y pasada su base) pasa a
los huesos de ese dedo, repartido entre los dos más cercanos; la palma sigue en la mano.
"""
import bpy
import numpy as np
from mathutils import Vector

FINGERS = ('Index', 'Middle', 'Ring', 'Pinky')
BASE = 0.55       # dónde arrancan los dedos, en largos de la mano desde la muñeca
REACH = 0.016     # hasta esta distancia de la línea de un dedo, el vértice es de ese dedo
EASE = 0.012      # en cuánto pasa de la palma al dedo, alrededor de la base


def hand_frame(arm: bpy.types.Object, body: bpy.types.Object, side: str):
    group = body.vertex_groups[f'{side}_Hand'].index
    mw = body.matrix_world
    held = []
    for v in body.data.vertices:
        w = next((g.weight for g in v.groups if g.group == group), 0)
        if w > 0.3:
            held.append((v.index, mw @ v.co, w))
    wrist = arm.matrix_world @ arm.data.bones[f'{side}_Hand'].head_local
    strong = [p for _, p, w in held if w > 0.5]
    way = (sum(strong, Vector()) / len(strong) - wrist).normalized()
    inward = Vector((0, -1 if wrist.y > 0 else 1, 0))
    palm = (inward - way * inward.dot(way)).normalized()
    across = way.cross(palm).normalized()
    return held, wrist, way, palm, across


def kmeans1(values: np.ndarray, k: int) -> np.ndarray:
    centres = np.quantile(values, np.linspace(0.1, 0.9, k))
    for _ in range(30):
        label = np.abs(values[:, None] - centres[None]).argmin(1)
        centres = np.array([values[label == i].mean() if np.any(label == i) else centres[i] for i in range(k)])
    return centres


def chains(arm, body, side):
    """Las cuatro (o cinco) líneas de articulaciones de los dedos de una mano, en el mundo."""
    held, wrist, way, palm, across = hand_frame(arm, body, side)
    pts = np.array([p[:] for _, p, _ in held])
    rel = pts - np.array(wrist[:])
    along = rel @ np.array(way[:])
    side_c = rel @ np.array(across[:])
    length = along.max()
    tips = along > 0.78 * length
    centres = np.sort(kmeans1(side_c[tips], 4))
    spacing = np.diff(centres).mean()
    # El pulgar: lo que, más cerca de la muñeca, sale de costado más allá de los dedos.
    lo, hi = centres[0] - spacing * 0.8, centres[-1] + spacing * 0.8
    near = (along > 0.15 * length) & (along < 0.7 * length)
    out_lo = near & (side_c < lo)
    out_hi = near & (side_c > hi)
    thumb_mask, thumb_lo = (out_lo, True) if out_lo.sum() > out_hi.sum() else (out_hi, False)
    # El índice es el dedo del lado del pulgar.
    order = list(centres) if thumb_lo else list(centres[::-1])
    result = {}
    for name, c in zip(FINGERS, order):
        mine = (np.abs(side_c - c) < spacing * 0.5) & (along > BASE * length * 0.9)
        joints = []
        for t in (BASE, 0.70, 0.84):
            sl = mine & (np.abs(along - t * length) < 0.06 * length)
            if not np.any(sl):
                sl = mine
            joints.append(pts[sl].mean(0))
        tip_i = np.argmax(np.where(mine, along, -1))
        joints.append(pts[tip_i] - np.array(way[:]) * 0.004)
        result[name] = [Vector(j) for j in joints]
    tp = pts[thumb_mask]
    if len(tp):
        d = np.linalg.norm(tp - np.array(wrist[:]), axis=1)
        base = tp[d < np.quantile(d, 0.3)].mean(0)
        tip = tp[d.argmax()]
        line = tip - base
        joints = [base]
        for t in (0.38, 0.7):
            q = base + line * t
            close = np.linalg.norm(tp - q, axis=1) < max(np.linalg.norm(line) * 0.2, 0.006)
            joints.append(tp[close].mean(0) if np.any(close) else q)
        joints.append(tip - line / max(np.linalg.norm(line), 1e-6) * 0.004)
        result['Thumb'] = [Vector(j) for j in joints]
    return result, palm, way, length


def add_fingers(arm: bpy.types.Object, body: bpy.types.Object) -> None:
    found = {side: chains(arm, body, side) for side in ('L', 'R')}
    inv = arm.matrix_world.inverted()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for side, (fingers, palm, _, _) in found.items():
        hand = arm.data.edit_bones[f'{side}_Hand']
        for name, joints in fingers.items():
            parent = hand
            for i in range(3):
                b = arm.data.edit_bones.new(f'{side}_{name}{i + 1}')
                b.head = inv @ joints[i]
                b.tail = inv @ joints[i + 1]
                b.align_roll(inv.to_3x3() @ palm)
                b.parent = parent
                b.use_connect = i > 0
                b.use_deform = True
                parent = b
    bpy.ops.object.mode_set(mode='OBJECT')
    for side, (fingers, palm, way, length) in found.items():
        weigh(arm, body, side, fingers)
        print(f'DEDOS {side}: ' + ', '.join(f'{n} {sum((j[i + 1] - j[i]).length for i in range(3)):.3f}' for n, j in fingers.items()))


def weigh(arm, body, side, fingers):
    held, wrist, way, palm, across = hand_frame(arm, body, side)
    hand_group = body.vertex_groups[f'{side}_Hand']
    groups = {f'{side}_{n}{i + 1}': body.vertex_groups.get(f'{side}_{n}{i + 1}') or body.vertex_groups.new(name=f'{side}_{n}{i + 1}')
              for n in fingers for i in range(3)}
    for index, p, w in held:
        best = None
        for name, joints in fingers.items():
            for i in range(3):
                a, b = joints[i], joints[i + 1]
                ab = b - a
                t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
                d = (p - (a + ab * t)).length
                if best is None or d < best[0]:
                    best = (d, name, i, t, (p - joints[0]).dot((joints[1] - joints[0]).normalized()))
        d, name, i, t, past_base = best
        if d > REACH:
            continue
        into = min(max((past_base + EASE / 2) / EASE, 0), 1) if i == 0 else 1.0
        if into <= 0:
            continue
        # Repartido con el hueso vecino cerca de cada articulación.
        share = {i: 1.0}
        if t < 0.25 and i > 0:
            share = {i: 0.5 + 2 * t, i - 1: 0.5 - 2 * t}
        elif t > 0.75 and i < 2:
            share = {i: 0.5 + 2 * (1 - t), i + 1: 0.5 - 2 * (1 - t)}
        moved = w * into
        hand_group.add([index], w - moved, 'REPLACE')
        for j, s in share.items():
            groups[f'{side}_{name}{j + 1}'].add([index], moved * s, 'REPLACE')
