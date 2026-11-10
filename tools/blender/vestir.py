"""El protagonista con su ropa, en un solo GLB para el juego, en Blender sin ventana.

    Blender -b --python tools/blender/vestir.py -- OUT.glb RIG_ANIMADO.glb TRACKSUIT.glb NEWELLS.glb [CLIP.glb ...] --jordan JORDAN.glb --nike NIKE.glb

RIG_ANIMADO es el cuerpo en boxers con el rig de Tripo y sus clips (retarget_rot.py). TRACKSUIT y
NEWELLS son el mismo personaje vestido, hechos por Tripo desde la misma hoja en la misma pose, sin
rig. JORDAN y NIKE son cada zapatilla sola (la derecha), hecha por Tripo aparte. Los CLIP son más clips retargeteados al mismo rig: de ellos solo se toman las acciones. De cada vestido se queda solo la tela, cortada en prendas; cabeza, manos y piel se tiran (quedan
las del cuerpo). Cada prenda toma los pesos del cuerpo en el punto más cercano, así se mueve con el
mismo esqueleto y los mismos clips.

- Los vestidos vienen centrados en el origen: se suben medio alto y se calzan sobre el cuerpo por
  cabeza y manos (escala y traslado que mejor apoyan su piel sobre la del cuerpo).
- Las prendas se cortan con planos, para que los bordes salgan derechos: uno inclinado sobre el
  cuello de cada campera (más alto atrás, por la capucha), uno de través a cada antebrazo donde
  termina la manga, y horizontales en cintura y ruedo (CORTES, medidos en estos modelos).
  La piel del vestido que queda adentro del cuello y los puños no se ve. Después se tiran las islas
  sueltas que deja el corte.
- Las zapatillas no salen de los vestidos: ahí zapatilla y pierna son una sola superficie y el borde
  entre las dos está pintado triángulo por triángulo, así que cortada quedaba dentada. Cada una es
  un modelo propio (con su boca limpia), del largo del pie por ZAPATILLA_LARGO, debajo de cada pie y
  espejada para el izquierdo.
- El chupín no puede salir del modelo de Newell's (el camperón tapa los muslos): es la piel de las
  piernas del cuerpo inflada apenas, en un celeste plano.
- El camperón se estira de la cadera para abajo hasta la rodilla, como el de la foto.
- El cuerpo se parte en pedazos según qué prendas lo tapan (un rayo desde cada cara hacia afuera que
  choca con la prenda). Cada pedazo se llama `cuerpo__<prenda>+<prenda>` (o `cuerpo__` si nada lo
  tapa) y el juego lo esconde cuando lleva puesta alguna de ellas.
- Después, lo mismo que prepare_rigged.py: de frente a +Z, un alto de una unidad con los pies en el
  origen, materiales mates (la textura de Tripo tal cual) y cada acción como su clip.
"""
import colorsys
import math
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree


args = sys.argv[sys.argv.index('--') + 1:]
files = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or not args[i - 1].startswith('--'))]
opts = {k: v for k, v in zip(args, args[1:]) if k.startswith('--')}
dst, rig_path, tracksuit_path, newells_path, *clip_paths = files

# Alturas en el modelo de una unidad (pies en 0), medidas en los vestidos de Tripo.
CORTES = {
    'tracksuit': {'cintura': 0.49},
    'newells': {'ruedo': 0.345, 'largo': 0.29, 'cadera': 0.47},
}
PERSONAJE_ALTO = 1.75    # metros: la escala de lo que viene en metros (la pistola)
GIRO_PISTOLA_EXTRA = 20.0 # grados: cuánto más a la derecha que "la cabeza al frente" quedan las de pistola
APUNTA = ('pistola_reposo', 0)   # el cuadro en que la pistola tiene que apuntar derecho
EMPUÑADURA = (0.045, 0.003, 0.075)  # dónde la agarra la mano, en la Glock (metros)
CANA_DESDE = 0.035    # desde esta altura sobre la suela, la zapatilla empieza a seguir a la pantorrilla
CANA_HASTA = 0.05     # en cuánto alto pasa del todo (hasta CANA_PIERNA)
CANA_PIERNA = 0.85    # lo más que la sigue (la boca)
SUELA_ALTURA = 0.003  # cuánto sobre lo más bajo del pie va la suela (más abajo, se hundía en el piso)
ZAPATILLA_LARGO = 1.08  # el largo de la zapatilla, en largos del pie
PIE_APOYADO = 0.01    # hasta esta altura del tobillo sobre el del otro pie, el pie está en el piso
PIE_PUNTA_MAX = 40.0  # grados: lo más que apunta hacia abajo un pie en el aire
DEDOS_PISO = 0.012    # la punta de los dedos que baja hasta esto sobre el piso empieza a quedar apoyada
PIE_PLANO = 8.0       # grados: hasta esta inclinación (respecto del reposo) un pie apoyado se aplana del todo
PIE_PLANO_TRANSICION = 12.0  # y de ahí hasta esto más, deja de aplanarse
PIE_TRANSICION = 0.03  # y de ahí hasta esto más, pasa de apoyado a en el aire
TOBILLO = 0.06       # debajo, el pie
CAÑA = 0.15          # hasta dónde puede llegar una zapatilla
SUELA = 0.045        # debajo, todo es zapatilla (la suela de la Jordan tiene negro)
PEGADO = 0.015       # a menos de esto del cuerpo, lo del vestido es piel o pelo (no tela)
CABEZA = 0.86        # por encima, la cabeza del vestido: su piel calza el vestido sobre el cuerpo
INFLADO = 0.003      # cuánto se separa el chupín de la piel
CHUPIN = (171, 184, 190)
ALCANCE = 0.06       # hasta dónde busca prenda el rayo que sale de cada cara del cuerpo
FALDON = 'Faldon'    # el hueso del que cuelga el faldón del camperón
FALDON_TRANSICION = 0.15  # en cuánto alto pasa del cuerpo al hueso del faldón (de golpe, se doblaba como una cola)
FALDON_ANCHO = 0.08  # desde qué distancia al centro el faldón del camperón sigue del todo a la pierna
SOBRE_RUEDO = 0.04   # cuánto sobre el ruedo del camperón empieza lo que se esconde del pantalón
HUNDIDO = 0.02       # desde qué tan adentro sale: donde la prenda es ceñida, la piel la atraviesa unos milímetros

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=rig_path)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm)
for o in [o for o in bpy.data.objects if o not in (arm, body)]:
    bpy.data.objects.remove(o)
for path in clip_paths:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in set(bpy.data.objects) - before:
        bpy.data.objects.remove(o)
for a in bpy.data.actions:
    a.name = a.name.split('.')[0]
if arm.animation_data:
    arm.animation_data.action = None
for b in arm.pose.bones:
    b.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()


def use(action: bpy.types.Action) -> None:
    """Pone la acción en el esqueleto (en Blender 5, la de otro archivo necesita su slot)."""
    arm.animation_data_create()
    arm.animation_data.action = action
    # Siempre: si quedó el slot de otra acción, esta no se aplica y lo horneado sale quieto.
    if getattr(action, 'slots', None):
        arm.animation_data.action_slot = action.slots[0]


def looking() -> Vector:
    """Hacia dónde mira la cabeza, en el plano: el frente del rig (+X) llevado por el hueso."""
    pb = arm.pose.bones['Head']
    f = arm.matrix_world.to_3x3() @ pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted() @ Vector((1, 0, 0))
    f.z = 0
    return f.normalized()


def turn_about(pb: bpy.types.PoseBone, angle: float) -> None:
    head = pb.head.copy()
    pb.matrix = Matrix.Translation(head) @ Matrix.Rotation(angle, 4, 'Z') @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


def yaw_of(v: Vector) -> float:
    return math.atan2(v.y, v.x)


def turned(name: str, angle: float) -> None:
    """La acción `name` con todo el cuerpo girado `angle` (sobre la vertical, en la cadera) en todos
    sus cuadros, igual. Las capturas de pistola apuntan a donde mira la cabeza (la de apuntar
    quieto, 48° a la izquierda del frente): girada entera (no cuadro por cuadro, que al sacar el arma la hacía mirar a la
    izquierda y girar de golpe), apunta al frente."""
    src = bpy.data.actions[name]
    use(src)
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    first, last = map(int, src.frame_range)
    hip = arm.pose.bones['Hip']
    poses = []
    for f in range(first, last + 1):
        bpy.context.scene.frame_set(f)
        turn_about(hip, angle)
        poses.append({pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in arm.pose.bones})
    src.name = name + '_capturada'
    new = bpy.data.actions.new(name)
    arm.animation_data.action = new
    for f, pose in zip(range(first, last + 1), poses):
        for pb in arm.pose.bones:
            pb.location, pb.rotation_quaternion = pose[pb.name]
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_quaternion', frame=f)
    arm.animation_data.action = None
    bpy.data.actions.remove(src)
    for b in arm.pose.bones:
        b.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    print(f'GIRADA {name} {math.degrees(angle):.1f}°')


def foot_pitch(side: str) -> float:
    """Cuánto apunta el pie hacia abajo (radianes): del tobillo a los dedos, contra el piso."""
    pb = arm.pose.bones
    d = (arm.matrix_world @ pb[f'{side}_ToeBase'].head) - (arm.matrix_world @ pb[f'{side}_Foot'].head)
    return math.atan2(d.z, math.hypot(d.x, d.y))


def planted_feet(name: str, angle: float) -> None:
    """La acción `name` con los pies corregidos y apoyados, cuadro por cuadro:
    - los dos giran `angle` hacia arriba sobre el tobillo: el retarget deja el pie 35° más
      inclinado que en el rig (el hueso del pie de Mixamo y el del rig no apuntan igual);
    - el que está en el piso queda con la suela plana (conserva hacia dónde apunta, pierde la
      inclinación y el rolido): en la postura abierta las zapatillas rígidas quedaban torcidas;
      el que está en el aire, como venga, con una transición según la altura;
    - los dedos van derechos con el pie, salvo que la punta llegue al piso: ahí queda apoyada y
      el talón se levanta doblando en los dedos;
    - todo el cuerpo baja o sube para que el pie apoyado toque el piso como en el rig (al
      levantar las puntas, que eran lo más bajo, quedaba flotando)."""
    src = bpy.data.actions[name]
    use(src)
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    first, last = map(int, src.frame_range)
    hip = arm.pose.bones['Hip']
    feet = {side: arm.pose.bones[f'{side}_Foot'] for side in ('L', 'R')}
    toes = {side: arm.pose.bones[f'{side}_ToeBase'] for side in ('L', 'R')}
    rest_pitch = {}
    for side in feet:
        d = (toes[side].bone.head_local - feet[side].bone.head_local).normalized()
        rest_pitch[side] = math.asin(max(-1, min(1, d.z)))
    rest_low = {side: min(feet[side].bone.head_local.z, toes[side].bone.head_local.z, toes[side].bone.tail_local.z) for side in feet}
    poses = []
    for f in range(first, last + 1):
        bpy.context.scene.frame_set(f)
        for side, pb in feet.items():
            # Sobre el eje de costado del propio pie (-Y del rig llevado por el hueso): con el de la
            # dirección horizontal del pie, en el aire (punta al piso) el eje salía cualquiera y la
            # zapatilla daba vuelta entera.
            axis = (pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()) @ Vector((0, -1, 0))
            head = pb.head.copy()
            pb.matrix = Matrix.Translation(head) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-head) @ pb.matrix
            bpy.context.view_layer.update()
        lowest = min(pb.head.z for pb in feet.values())
        on_floor = {}
        for side, pb in feet.items():
            head = pb.head.copy()
            # Apoyado: la rotación respecto del reposo, solo con su giro sobre la vertical.
            rest = pb.bone.matrix_local.to_3x3()
            turn = (pb.matrix.to_3x3() @ rest.inverted()).to_quaternion()
            # Hacia dónde apunta, por el eje de costado del pie (+Y del rig): queda horizontal aunque
            # la punta mire al piso; por el de adelante, en el aire el giro salía cualquiera y la
            # zapatilla se daba vuelta.
            side_axis = turn @ Vector((0, 1, 0))
            flat = Quaternion(Vector((0, 0, 1)), math.atan2(side_axis.y, side_axis.x) - math.pi / 2)
            if flat.dot(turn) < 0:  # por el camino corto
                flat.negate()
            height = pb.head.z - lowest  # respecto del pie más bajo: el cuerpo todavía puede estar flotando
            planted = 1 - min(max((height - PIE_APOYADO) / PIE_TRANSICION, 0), 1)
            # Solo si ya está casi plano: al despegar el talón (o apoyarlo con la punta arriba),
            # aplanado, la pierna subía y la zapatilla quedaba en el piso, despegada del tobillo.
            d = ((arm.matrix_world @ toes[side].head) - (arm.matrix_world @ pb.head)).normalized()
            off = abs(math.asin(max(-1, min(1, d.z))) - rest_pitch[side])
            planted *= 1 - min(max((off - math.radians(PIE_PLANO)) / math.radians(PIE_PLANO_TRANSICION), 0), 1)
            on_floor[side] = planted
            want = turn.slerp(flat, planted)
            pb.matrix = Matrix.Translation(head) @ (want.to_matrix() @ rest).to_4x4()
            bpy.context.view_layer.update()
        # En el aire, el pie apunta hacia abajo a lo sumo PIE_PUNTA_MAX: al despegar quedaba casi
        # vertical, con la suela mirando para atrás.
        for side, pb in feet.items():
            if on_floor[side] > 0.5:
                continue
            d = ((arm.matrix_world @ toes[side].head) - (arm.matrix_world @ pb.head)).normalized()
            down = -math.asin(max(-1, min(1, d.z)))
            excess = down - math.radians(PIE_PUNTA_MAX)
            if excess <= 0:
                continue
            axis = (pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()) @ Vector((0, -1, 0))
            head = pb.head.copy()
            pb.matrix = Matrix.Translation(head) @ Matrix.Rotation(excess, 4, axis) @ Matrix.Translation(-head) @ pb.matrix
            bpy.context.view_layer.update()
        # Los dedos, derechos con el pie (en las capturas giran de más: la punta se doblaba).
        for side, tb in toes.items():
            foot_turn = feet[side].matrix.to_3x3() @ feet[side].bone.matrix_local.to_3x3().inverted()
            tb.matrix = Matrix.Translation(tb.head.copy()) @ (foot_turn @ tb.bone.matrix_local.to_3x3()).to_4x4()
            bpy.context.view_layer.update()
        # A la altura del piso por el pie apoyado (no por el que está en el aire).
        base = max(on_floor, key=on_floor.get)
        low = min(feet[base].head.z, toes[base].head.z, toes[base].tail.z)
        hip.matrix = Matrix.Translation((0, 0, rest_low[base] - low)) @ hip.matrix
        bpy.context.view_layer.update()
        # Y si el otro (apoyando el talón con la punta arriba) se mete en el piso, sube lo justo.
        sunk = max(rest_low[side] - min(feet[side].head.z, toes[side].head.z) for side in feet)
        if sunk > 0:
            hip.matrix = Matrix.Translation((0, 0, sunk)) @ hip.matrix
            bpy.context.view_layer.update()
        # La punta que llega al piso queda apoyada y el talón se levanta doblando en los dedos (al
        # despegar el pie; rígida, la punta se metía en el piso).
        for side, tb in toes.items():
            sink = rest_low[side] + DEDOS_PISO - tb.tail.z
            if sink <= 0:
                continue
            rest = tb.bone.matrix_local.to_3x3()
            turn = (tb.matrix.to_3x3() @ rest.inverted()).to_quaternion()
            side_axis = turn @ Vector((0, 1, 0))
            flat = Quaternion(Vector((0, 0, 1)), math.atan2(side_axis.y, side_axis.x) - math.pi / 2)
            if flat.dot(turn) < 0:
                flat.negate()
            want = turn.slerp(flat, min(sink / DEDOS_PISO, 1))
            tb.matrix = Matrix.Translation(tb.head.copy()) @ (want.to_matrix() @ rest).to_4x4()
            bpy.context.view_layer.update()
        poses.append({pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in arm.pose.bones})
    src.name = name + '_sin_pies'
    new = bpy.data.actions.new(name)
    arm.animation_data.action = new
    for f, pose in zip(range(first, last + 1), poses):
        for pb in arm.pose.bones:
            pb.location, pb.rotation_quaternion = pose[pb.name]
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_quaternion', frame=f)
    arm.animation_data.action = None
    bpy.data.actions.remove(src)
    for b in arm.pose.bones:
        b.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


# Cuánto levantar los pies: lo que el pie apoyado del reposo está más inclinado que en reposo del rig.
rest_pitch = foot_pitch('L')
if 'reposo' in bpy.data.actions:
    use(bpy.data.actions['reposo'])
    bpy.context.scene.frame_set(int(bpy.data.actions['reposo'].frame_range[0]))
    bpy.context.view_layer.update()
    feet_lift = rest_pitch - foot_pitch('L')
    arm.animation_data.action = None
    for b in arm.pose.bones:
        b.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    print(f'PIES levantados {math.degrees(feet_lift):.1f}°')
    for a in [a.name for a in bpy.data.actions]:
        planted_feet(a, feet_lift)


def first_pose(name: str, measure):
    """Lo que mide `measure()` con la acción `name` en su primer cuadro (en las de pistola, apuntando)."""
    use(bpy.data.actions[name])
    bpy.context.scene.frame_set(int(bpy.data.actions[name].frame_range[0]))
    bpy.context.view_layer.update()
    value = measure()
    arm.animation_data.action = None
    for b in arm.pose.bones:
        b.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    return value


def hand_way() -> float:
    """Hacia dónde está girada la mano derecha (el frente del rig llevado por el hueso): la pistola
    va fija en ella, así que dice hacia dónde apunta."""
    pb = arm.pose.bones['R_Hand']
    return yaw_of(arm.matrix_world.to_3x3() @ pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted() @ Vector((1, 0, 0)))


# Cuánto girar las de pistola. La de apuntar quieto (APUNTA): lo que mira la cabeza, para que mire
# al frente, y GIRO_PISTOLA_EXTRA más a la derecha. Las otras, lo que haga falta para que la mano
# (y con ella el arma) quede girada igual que en esa al apuntar: si no, al terminar de sacarla y
# pasar a apuntar, el cuerpo saltaba de costado.
aim_turns = {}
if APUNTA[0] in bpy.data.actions:
    base = -first_pose(APUNTA[0], lambda: yaw_of(looking())) - math.radians(GIRO_PISTOLA_EXTRA)
    base_hand = first_pose(APUNTA[0], hand_way)
    for name in ('pistola_reposo', 'pistola_caminata', 'pistola_guardar'):
        if name in bpy.data.actions:
            aim_turns[name] = base + base_hand - first_pose(name, hand_way)

for name in ('pistola_reposo', 'pistola_caminata', 'pistola_guardar'):
    if name in bpy.data.actions:
        turned(name, aim_turns[name])

body_bvh = BVHTree.FromPolygons([(body.matrix_world @ v.co) for v in body.data.vertices],
                                [p.vertices[:] for p in body.data.polygons])
groups = [g.name for g in body.vertex_groups]
W = np.zeros((len(body.data.vertices), len(groups)), dtype=np.float32)
for v in body.data.vertices:
    for g in v.groups:
        W[v.index, g.group] = g.weight
body_world = [body.matrix_world @ v.co for v in body.data.vertices]


def face_colours(o: bpy.types.Object) -> np.ndarray:
    """El color de la textura en el centro (en UV) de cada cara."""
    img = next(n.image for n in o.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE')
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    uv = o.data.uv_layers.active.data
    out = np.zeros((len(o.data.polygons), 3), dtype=np.float32)
    for p in o.data.polygons:
        u = np.mean([uv[i].uv[:] for i in p.loop_indices], 0)
        out[p.index] = px[int(np.clip(u[1] * h, 0, h - 1)), int(np.clip(u[0] * w, 0, w - 1)), :3]
    return out


def is_skin(c: np.ndarray, lax: float = 0.25) -> np.ndarray:
    hsv = np.array([colorsys.rgb_to_hsv(*x) for x in c])
    return (hsv[:, 0] > 0.02) & (hsv[:, 0] < 0.13) & (hsv[:, 1] > lax) & (hsv[:, 2] > 0.15)


def is_light(c: np.ndarray) -> np.ndarray:
    return c.mean(1) > 0.45


def is_denim(c: np.ndarray) -> np.ndarray:
    return (c[:, 2] - c[:, 0] > 0.04) & (c.mean(1) > 0.5)


def fit(o: bpy.types.Object, skin: np.ndarray) -> None:
    """Escala y traslado que apoyan la piel del vestido (cabeza y manos) sobre la del cuerpo."""
    centres = np.array([(o.matrix_world @ p.center)[:] for p in o.data.polygons])[skin]
    total = Matrix.Identity(4)
    for _ in range(12):
        src = np.array([(total @ Vector(c))[:] for c in centres])
        dst_ = np.array([body_bvh.find_nearest(Vector(c))[0][:] for c in src])
        ms, md = src.mean(0), dst_.mean(0)
        s = np.sqrt(((dst_ - md) ** 2).sum() / ((src - ms) ** 2).sum())
        t = md - s * ms
        total = Matrix.Translation(Vector(t)) @ Matrix.Scale(s, 4) @ total
    err = np.mean([(Vector(c) - body_bvh.find_nearest(Vector(c))[0]).length
                   for c in np.array([(total @ Vector(c))[:] for c in centres])])
    print(f'FIT {o.name}: scale {total.to_scale()[0]:.4f} move {tuple(round(x, 4) for x in total.to_translation())} skin off by {err:.4f}')
    o.matrix_world = total @ o.matrix_world


def piece(src: bpy.types.Object, faces: set, name: str) -> bpy.types.Object:
    """Una copia de `src` con solo esas caras."""
    o = src.copy()
    o.data = src.data.copy()
    o.name = o.data.name = name
    bpy.context.collection.objects.link(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in faces], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    return o


def bind(o: bpy.types.Object, skirt: float | None = None) -> None:
    """Pasa la prenda al espacio del cuerpo, le da los pesos del cuerpo en su punto más cercano y la
    cuelga del esqueleto. Con `skirt` (una altura), lo que está debajo es un faldón: su centro sigue
    al hueso FALDON (y la espalda también), el frente y los costados a cada pierna: el frente no se
    estira entre las dos al abrirlas."""
    o.data.transform(body.matrix_world.inverted() @ o.matrix_world)
    o.parent = arm
    o.matrix_world = body.matrix_world.copy()
    o.vertex_groups.clear()
    vgs = [o.vertex_groups.new(name=g) for g in groups]
    hanging = o.vertex_groups.new(name=FALDON) if skirt is not None else None
    hip_x = (arm.matrix_world @ arm.data.bones['Hip'].head_local).x
    for v in o.data.vertices:
        p = body.matrix_world @ v.co
        _, _, f, _ = body_bvh.find_nearest(p)
        corners = body.data.polygons[f].vertices
        near = np.array([1 / max((body_world[i] - p).length, 1e-5) for i in corners])
        w = (W[list(corners)] * (near / near.sum())[:, None]).sum(0)
        if skirt is not None and p.z < skirt:
            # Cuánto sigue a la pierna: nada en el medio, del todo desde FALDON_ANCHO al costado, y
            # menos cuanto más cerca de la cadera.
            # Atrás cuelga: al flexionar los muslos la parte de atrás se levantaba como una cola.
            side = min(abs(p.y) / FALDON_ANCHO, 1)
            back = min(max((hip_x - p.x) / 0.05, 0), 1)
            down = min((skirt - p.z) / FALDON_TRANSICION, 1)
            leg = side * (1 - 0.9 * back) * down + (1 - down)
            w = w * leg
            hanging.add([v.index], float(1 - leg), 'REPLACE')
        for i in np.nonzero(w > 1e-4)[0]:
            vgs[i].add([v.index], float(w[i]), 'REPLACE')
    o.modifiers.clear()
    mod = o.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm


def dressed(path: str) -> bpy.types.Object:
    """Un vestido de Tripo, calzado sobre el cuerpo y con la posición aplicada a la malla."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = set(bpy.data.objects) - before
    o = next(x for x in new if x.type == 'MESH')
    for x in new - {o}:
        bpy.data.objects.remove(x)
    o.location.z += 0.5
    bpy.context.view_layer.update()
    skin = is_skin(face_colours(o))
    fit(o, skin & np.array([(o.matrix_world @ p.center).z > CABEZA or abs((o.matrix_world @ p.center).y) > 0.22
                            for p in o.data.polygons]))
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
    return o


def bone_at(name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].head_local


def neck_plane(o: bpy.types.Object) -> tuple:
    """Un plano justo sobre el cuello de la prenda: más alto atrás si hay capucha."""
    colours = face_colours(o)
    skin = is_skin(colours, 0.12)
    neck = bone_at('NeckTwist01')
    front, back = [], []
    for p, c, sk in zip(o.data.polygons, colours, skin):
        q = p.center
        if sk or c.mean() > 0.4 or not (0.74 < q.z < 0.855) or abs(q.y - neck.y) > 0.06:
            continue
        (front if q.x > neck.x + 0.01 else back if q.x < neck.x - 0.01 else []).append(q.z)
    zf, zb = np.percentile(front, 97) - 0.003, np.percentile(back, 97) - 0.003
    a, b = Vector((neck.x + 0.05, 0, zf)), Vector((neck.x - 0.05, 0, zb))
    d = a - b
    n = Vector((-d.z, 0, d.x)).normalized()
    if n.z < 0:
        n = -n
    print(f'CUELLO {o.name}: adelante {zf:.3f} atrás {zb:.3f}')
    # Solo lo que está pegado a la cabeza o el cuello del cuerpo (la piel y el pelo del vestido): la
    # capucha del camperón sube atrás más que el plano y quedaba con la punta comida.
    return (a + b) / 2, n, lambda q: abs(q.y - neck.y) < 0.1 and (body_bvh.find_nearest(q)[0] - q).length < PEGADO


def wrist_planes(o: bpy.types.Object) -> list:
    """Por cada brazo, un plano de través al antebrazo donde termina la manga."""
    colours = face_colours(o)
    skin = is_skin(colours)
    planes = []
    for side, sign in (('L', 1), ('R', -1)):
        elbow, wrist = bone_at(f'{side}_Forearm'), bone_at(f'{side}_Hand')
        d = (wrist - elbow).normalized()
        reach = []
        for p, sk in zip(o.data.polygons, skin):
            t = (p.center - elbow).dot(d)
            if not sk and t > 0 and (p.center - (elbow + d * t)).length < 0.05:
                reach.append(t)
        t = np.percentile(reach, 99) - 0.002
        print(f'PUÑO {o.name} {side}: a {t:.3f} del codo (muñeca a {(wrist - elbow).length:.3f})')
        planes.append((elbow + d * t, d, lambda q, sign=sign: q.y * sign > 0.16))
    return planes


def cut(src: bpy.types.Object, name: str, planes: list, drop=None, least: int = 40) -> bpy.types.Object:
    """Una copia de `src` cortada por planos: cada plano (punto, normal, dónde) corta la malla y se
    lleva lo que queda del lado de la normal, solo donde `dónde(centro)` es cierto. `drop(colores, alturas)`
    descarta además caras por su color; al final se van las islas de menos de `least` caras."""
    o = src.copy()
    o.data = src.data.copy()
    o.name = o.data.name = name
    bpy.context.collection.objects.link(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    # La malla de Tripo llega partida en las costuras de la textura: se suelda para que las islas
    # sean pedazos de verdad y no parches de la textura.
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    for co, no, where in planes:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no, dist=1e-5)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if (f.calc_center_median() - co).dot(no) > 0 and where(f.calc_center_median())],
                         context='FACES')
    if drop is not None:
        bm.to_mesh(o.data)
        colours = face_colours(o)
        bm.faces.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        heights = np.array([f.calc_center_median().z for f in bm.faces])
        out = drop(colours, heights)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if out[f.index]], context='FACES')
    # Islas sueltas: restos del corte.
    seen = set()
    small = []
    for f in bm.faces:
        if f in seen:
            continue
        island, todo = [], [f]
        seen.add(f)
        while todo:
            g = todo.pop()
            island.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen:
                        seen.add(h)
                        todo.append(h)
        if len(island) < least:
            small.extend(island)
    bmesh.ops.delete(bm, geom=small, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    return o


def local_plane(o: bpy.types.Object, z: float, keep: str) -> tuple:
    """Un plano horizontal a la altura `z` del mundo, en las coordenadas de la malla de `o`."""
    to_local = o.matrix_world.inverted()
    up = (to_local.to_3x3() @ Vector((0, 0, 1))).normalized()
    return to_local @ Vector((0, 0, z)), (-up if keep == 'above' else up), lambda q: True


def below(z: float) -> tuple:
    """Plano horizontal: se lleva lo de arriba."""
    return Vector((0, 0, z)), Vector((0, 0, 1)), lambda q: True


def above(z: float) -> tuple:
    return Vector((0, 0, z)), Vector((0, 0, -1)), lambda q: True


def rigid_shoe(o: bpy.types.Object) -> None:
    """Una zapatilla: la suela y el talón del hueso del pie, la punta dobla con los dedos y la caña
    (la boca y el cuello) pasa de a poco a la pantorrilla. El tobillo del rig está casi en la suela:
    rígida, al cambiar el ángulo entre pie y canilla la boca se corría y se despegaba del tobillo;
    con el talón en la pantorrilla, en cambio, se levantaba (en puntas de pie). Los dedos van
    derechos con el pie salvo al apoyar la punta (planted_feet)."""
    for g in list(o.vertex_groups):
        o.vertex_groups.remove(g)
    for side, sign in (('L', 1), ('R', -1)):
        foot = o.vertex_groups.new(name=f'{side}_Foot')
        toe = o.vertex_groups.new(name=f'{side}_ToeBase')
        calf = o.vertex_groups.new(name=f'{side}_Calf')
        joint = bone_at(f'{side}_ToeBase')
        ahead = joint - bone_at(f'{side}_Foot')
        ahead.z = 0
        ahead.normalize()
        mine = [v for v in o.data.vertices if (o.matrix_world @ v.co).y * sign > 0]
        sole = min((o.matrix_world @ v.co).z for v in mine)
        for v in mine:
            p = o.matrix_world @ v.co
            k = min(max(((p - joint).dot(ahead) + 0.01) / 0.03, 0), 1)  # 0 detrás de los dedos, 1 en la punta
            up = min(max((p.z - sole - CANA_DESDE) / CANA_HASTA, 0), 1) * CANA_PIERNA * (1 - k)
            rest = 1 - up
            if k < 1:
                foot.add([v.index], rest * (1 - k), 'REPLACE')
            if k > 0:
                toe.add([v.index], rest * k, 'REPLACE')
            if up > 0:
                calf.add([v.index], up, 'REPLACE')


def shoe(path: str, name: str) -> bpy.types.Object:
    """Una zapatilla derecha de Tripo, puesta en los dos pies: su largo es el del pie por
    ZAPATILLA_LARGO, centrada sobre él, con la suela en el piso; la izquierda es su espejo."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = set(bpy.data.objects) - before
    src = next(x for x in new if x.type == 'MESH')
    for x in new - {src}:
        bpy.data.objects.remove(x)
    src.data.transform(src.matrix_world)
    src.matrix_world = Matrix.Identity(4)
    pts = np.array([v.co[:] for v in src.data.vertices])
    # Su largo es el eje horizontal más largo; el talón, la punta con el cuello más alto.
    flat = pts[:, :2] - pts[:, :2].mean(0)
    axis = np.linalg.eigh(flat.T @ flat)[1][:, -1]
    along = flat @ axis
    lo, hi = along.min(), along.max()
    heel_high = pts[along > lo + 0.75 * (hi - lo), 2].max() > pts[along < lo + 0.25 * (hi - lo), 2].max()
    toe_way = -axis if heel_high else axis
    src_len = hi - lo
    src_mid = pts[:, :2].mean(0) + axis * (lo + hi) / 2
    src_side = np.array([-toe_way[1], toe_way[0]])
    src_bottom = pts[:, 2].min()
    pairs = []
    for side, sign in (('R', -1), ('L', 1)):
        ankle, toe = bone_at(f'{side}_Foot'), bone_at(f'{side}_ToeBase')
        # El pie es todo lo de ese lado debajo del tobillo (el talón lo mueve la pantorrilla, no el pie).
        mine = np.array([body_world[i][:] for i in range(len(body_world))
                         if body_world[i].z < TOBILLO and body_world[i].y * sign > 0])
        # Hacia dónde apunta el pie: su eje largo, del lado de los dedos.
        c2 = mine[:, :2] - mine[:, :2].mean(0)
        way = np.linalg.eigh(c2.T @ c2)[1][:, -1]
        if way @ np.array([(toe - ankle).x, (toe - ankle).y]) < 0:
            way = -way
        t = mine[:, :2] @ way
        foot_len = t.max() - t.min()
        mid = mine[:, :2].mean(0) - way * (mine[:, :2].mean(0) @ way) + way * (t.max() + t.min()) / 2
        scale = foot_len * ZAPATILLA_LARGO / src_len
        o = src.copy()
        o.data = src.data.copy()
        bpy.context.collection.objects.link(o)
        side_way = np.array([-way[1], way[0]])
        mirror = 1 if side == 'R' else -1
        for v in o.data.vertices:
            q = np.array(v.co[:2]) - src_mid
            a, b = q @ toe_way, q @ src_side
            xy = mid + way * a * scale + side_way * b * scale * mirror
            v.co = Vector((xy[0], xy[1], (v.co.z - src_bottom) * scale + mine[:, 2].min() + SUELA_ALTURA))
        if mirror < 0:
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
            bm.to_mesh(o.data)
            bm.free()
        print(f'ZAPATILLA {name} {side}: pie {foot_len:.3f}, escala {scale:.4f}')
        pairs.append(o)
    bpy.data.objects.remove(src)
    with bpy.context.temp_override(active_object=pairs[0], selected_editable_objects=pairs, object=pairs[0]):
        bpy.ops.object.join()
    pairs[0].name = pairs[0].data.name = name
    return pairs[0]


def fist(o: bpy.types.Object, bone: str) -> tuple:
    """Cierra la mano en puño en la malla misma (el rig no tiene dedos): los dedos se doblan hacia la
    palma en los nudillos y otra vez a mitad de camino, cada vértice tanto como lo mueve la mano.
    Devuelve dónde está la mano en reposo: muñeca, hacia dónde van los dedos, largo y palma."""
    group = o.vertex_groups[bone].index
    held = [(v, next((g.weight for g in v.groups if g.group == group), 0)) for v in o.data.vertices]
    held = [(v, w) for v, w in held if w > 0.05]
    mw = o.matrix_world
    wrist = arm.matrix_world @ arm.data.bones[bone].head_local
    strong = [mw @ v.co for v, w in held if w > 0.5]
    middle = sum(strong, Vector()) / len(strong)
    way = (middle - wrist).normalized()
    length = max((mw @ v.co - wrist).dot(way) for v, _ in held)
    inward = Vector((0, -1 if wrist.y > 0 else 1, 0))   # la palma mira al cuerpo
    palm = (inward - way * inward.dot(way)).normalized()
    axis = way.cross(palm).normalized()
    inverse = mw.inverted()
    for joint, angle in ((0.72, 80), (0.45, 85)):
        pivot = wrist + way * length * joint
        turn = Matrix.Rotation(math.radians(angle), 4, axis)
        for v, w in held:
            q = mw @ v.co
            along = (q - wrist).dot(way)
            if along <= length * joint:
                continue
            k = min(1.0, (along - length * joint) / (length * 0.12)) * min(1.0, w * 1.5)
            v.co = inverse @ q.lerp(pivot + (turn @ (q - pivot)), k)
    o.data.update()
    return wrist, way, length, palm


def pistol(path: str, texture: str | None, wrist: Vector, way: Vector, length: float, palm: Vector) -> None:
    """La Glock (FBX en metros, caño hacia -X, empuñadura abajo) en la mano derecha, colgada del hueso:
    a escala del personaje (PERSONAJE_ALTO), la empuñadura en el puño y, en el cuadro que apunta
    (APUNTA), derecha al frente y nivelada."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    parts = [o for o in set(bpy.data.objects) - before if o.type == 'MESH']
    for o in set(bpy.data.objects) - before - set(parts):
        bpy.data.objects.remove(o)
    with bpy.context.temp_override(active_object=parts[0], selected_editable_objects=parts, object=parts[0]):
        bpy.ops.object.join()
    gun = parts[0]
    gun.data.transform(gun.matrix_world)
    gun.matrix_world = Matrix.Identity(4)
    gun.name = gun.data.name = 'ropa_pistola'
    mat = bpy.data.materials.new('pistola')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    if texture:
        img = bpy.data.images.load(texture)
        img.scale(1024, 1024)
        img.pack()
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = img
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    gun.data.materials.clear()
    gun.data.materials.append(mat)
    # Posada como apunta: dónde queda la mano y para dónde mira el personaje (+X del rig).
    rest_hand = arm.matrix_world @ arm.pose.bones['R_Hand'].head
    use(bpy.data.actions[APUNTA[0]])
    bpy.context.scene.frame_set(APUNTA[1])
    bpy.context.view_layer.update()
    pb = arm.pose.bones['R_Hand']
    moved = (arm.matrix_world @ pb.head - rest_hand).length
    assert moved > 0.05, f'la mano no se movió al posar {APUNTA}: {moved:.3f}'
    posed = arm.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted() @ arm.matrix_world.inverted()
    hold = posed @ (wrist + way * length * 0.42 + palm * length * 0.18)
    scale = 1 / PERSONAJE_ALTO
    place = (Matrix.Translation(hold) @ Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Scale(scale, 4)
             @ Matrix.Translation(-Vector(EMPUÑADURA)))
    # Colgada del hueso: su padre es la punta del hueso tal como está posado.
    tip = arm.matrix_world @ pb.matrix @ Matrix.Translation((0, pb.bone.length, 0))
    gun.parent = arm
    gun.parent_type = 'BONE'
    gun.parent_bone = 'R_Hand'
    gun.matrix_parent_inverse = Matrix.Identity(4)
    gun.matrix_basis = tip.inverted() @ place
    bpy.context.view_layer.update()
    arm.animation_data.action = None
    for b in arm.pose.bones:
        b.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    print(f'PISTOLA en la mano, posada como {APUNTA}')


# El hueso del faldón del camperón: cuelga de la cadera, ninguna animación lo mueve y el juego lo
# mantiene derecho (como si colgara), así el faldón no se levanta atrás cuando la pelvis se inclina.
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
hip = arm.data.edit_bones['Hip']
faldon = arm.data.edit_bones.new(FALDON)
faldon.head = hip.head.copy()
faldon.tail = hip.head + Vector((0, 0, -0.2))
faldon.parent = hip
faldon.use_deform = True
bpy.ops.object.mode_set(mode='OBJECT')

prendas = {}
ts = dressed(tracksuit_path)
c = CORTES['tracksuit']
top = [neck_plane(ts), *wrist_planes(ts)]
prendas['campera_adidas'] = cut(ts, 'ropa_campera_adidas', top + [above(c['cintura'])])
# Las zapatillas no se cortan con un plano: la Jordan es de caña alta (el plano le cortaba lengüeta y
# cuello) y la Nike baja (le dejaba encima el tobillo del vestido). Se reconocen por color debajo de
# CAÑA: la Jordan es lo claro, más la suela; lo negro de arriba es el puño del pantalón.
prendas['pantalon_adidas'] = cut(ts, 'ropa_pantalon_adidas', [below(c['cintura'])],
                                 drop=lambda col, z: (z < SUELA) | ((z < 0.12) & is_light(col)) | ((z < CAÑA) & is_skin(col)))
prendas['jordan'] = shoe(opts['--jordan'], 'ropa_jordan')

nw = dressed(newells_path)
c = CORTES['newells']
top = [neck_plane(nw), *wrist_planes(nw)]
prendas['camperon_newells'] = cut(nw, 'ropa_camperon_newells', top + [above(c['ruedo'])], drop=lambda col, z: is_denim(col))
# Tripo lo hizo sobre la rodilla; el de la foto llega a la rodilla. Se estira de la cadera para abajo
# hasta `largo` (tela negra lisa: la textura estirada no se nota).
coat = prendas['camperon_newells']
# Abajo el camperón es negro (y rojo en el ribete): lo claro que queda ahí es jean del vestido, más
# oscuro que lo que reconoce is_denim, que estirado se ve como dientes blancos bajo el ruedo.
colours = face_colours(coat)
bm = bmesh.new()
bm.from_mesh(coat.data)
bm.faces.ensure_lookup_table()
light = [f for f in bm.faces if f.calc_center_median().z < c['cadera'] and colours[f.index].mean() > 0.3
         and colours[f.index].max() - colours[f.index].min() < 0.15]
bmesh.ops.delete(bm, geom=light, context='FACES')
bm.to_mesh(coat.data)
bm.free()
print(f'CAMPERÓN: {len(light)} caras claras abajo, fuera')
hem = min(v.co.z for v in coat.data.vertices)
stretch = (c['cadera'] - c['largo']) / (c['cadera'] - hem)
for v in coat.data.vertices:
    if v.co.z < c['cadera']:
        v.co.z = c['cadera'] - (c['cadera'] - v.co.z) * stretch
print(f'CAMPERÓN: ruedo de {hem:.3f} a {c["largo"]:.3f}')
prendas['nike'] = shoe(opts['--nike'], 'ropa_nike')

for name, o in prendas.items():
    bind(o, skirt=CORTES['newells']['cadera'] if name == 'camperon_newells' else None)
    if name in ('jordan', 'nike'):
        rigid_shoe(o)
    print(f'PRENDA {o.name}: {len(o.data.polygons)} caras')
bpy.data.objects.remove(ts)
bpy.data.objects.remove(nw)

# El chupín: la piel de cadera y piernas del cuerpo, inflada, en celeste.
legs = [i for i, g in enumerate(groups) if g in ('Hip', 'Pelvis') or 'Thigh' in g or 'Calf' in g or 'Foot' in g]
# Hasta arriba del boxer, que es gris: si no, asoma sobre la cintura.
body_col = face_colours(body)
body_z = np.array([(body.matrix_world @ p.center).z for p in body.data.polygons])
grey = (body_col.max(1) - body_col.min(1) < 0.06) & (body_col.mean(1) < 0.45) & (body_z > 0.4) & (body_z < 0.65)
cintura = float(np.percentile(body_z[grey], 99.5)) + 0.008
print(f'CHUPIN hasta {cintura:.3f} (arriba del boxer)')
chupin_faces = set()
for p in body.data.polygons:
    zc = (body.matrix_world @ p.center).z
    if TOBILLO - 0.05 < zc < cintura and W[list(p.vertices)][:, legs + [groups.index('Waist')]].sum(1).mean() > 0.6:
        chupin_faces.add(p.index)
# Abajo termina con un plano en el tobillo (cortado cara por cara dejaba dientes): lo que queda
# adentro de cada zapatilla se esconde mientras la lleva puesta, más abajo.
raw = piece(body, chupin_faces, 'chupin_entero')
chupin = cut(raw, 'ropa_chupin', [local_plane(raw, TOBILLO - 0.02, keep='above')], least=1)
bpy.data.objects.remove(raw)
for v in chupin.data.vertices:
    v.co += v.normal * INFLADO / body.matrix_world.to_scale()[0]
mat = bpy.data.materials.new('chupin')
mat.use_nodes = True
mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*[(x / 255) ** 2.2 for x in CHUPIN], 1)
chupin.data.materials.clear()
chupin.data.materials.append(mat)
prendas['chupin'] = chupin
print(f'PRENDA ropa_chupin: {len(chupin.data.polygons)} caras')

# Qué prendas tapa cada cara del cuerpo.
bpy.context.view_layer.update()
trees = {}
for name, o in prendas.items():
    mw = o.matrix_world
    trees[name] = BVHTree.FromPolygons([(mw @ v.co) for v in o.data.vertices], [p.vertices[:] for p in o.data.polygons])
normal_m = body.matrix_world.to_3x3().inverted().transposed()
# Las zapatillas tapan el pie entero hasta su borde: la punta es fina y los dedos la atraviesan. El
# cuerpo se corta con un plano en cada borde, para que el tobillo que asoma quede derecho.
tops = {name: max((o.matrix_world @ v.co).z for v in o.data.vertices) for name, o in prendas.items() if name in ('jordan', 'nike')}
bm = bmesh.new()
bm.from_mesh(body.data)
for top in tops.values():
    co, no, _ = local_plane(body, top - 0.01, keep='below')
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no, dist=1e-5)
bm.to_mesh(body.data)
bm.free()
W = np.zeros((len(body.data.vertices), len(groups)), dtype=np.float32)
for v in body.data.vertices:
    for g in v.groups:
        W[v.index, g.group] = g.weight
# Manos y cabeza no las tapa nada: colgando junto a la cadera, el rayo de la mano chocaba con el
# pantalón. El cuello sí pasa por el rayo: exento, la piel de atrás del cuello atravesaba el cuello
# de la campera.
bare = [i for i, g in enumerate(groups) if 'Hand' in g or g == 'Head']
feet = [i for i, g in enumerate(groups) if 'Foot' in g or 'Toe' in g]
# La mano derecha abierta se esconde con la pistola en la mano (`cuerpo__pistola`): la reemplaza su
# copia cerrada en puño, `ropa_pistola_mano`.
right_hand = groups.index('R_Hand')
covers = {}
for p in body.data.polygons:
    if W[list(p.vertices)][:, bare].sum(1).mean() > 0.5:
        key = ('pistola',) if W[list(p.vertices), right_hand].mean() > 0.5 else ()
        covers.setdefault(key, set()).add(p.index)
        continue
    centre = body.matrix_world @ p.center
    n = (normal_m @ p.normal).normalized()
    by = tuple(sorted(name for name, t in trees.items()
                      if t.ray_cast(centre - n * HUNDIDO, n, ALCANCE + HUNDIDO)[0] is not None
                      or (name in tops and W[list(p.vertices)][:, feet].sum(1).mean() > 0.5)))
    covers.setdefault(by, set()).add(p.index)
for by, faces in sorted(covers.items(), key=lambda kv: -len(kv[1])):
    o = piece(body, faces, 'cuerpo__' + '+'.join(by))
    print(f'CUERPO {o.name}: {len(faces)} caras')
if '--pistola' in opts:
    fist_hand = piece(body, covers[('pistola',)], 'ropa_pistola_mano')
    wrist, way, length, palm = fist(fist_hand, 'R_Hand')
    pistol(opts['--pistola'], opts.get('--pistola-textura'), wrist, way, length, palm)
bpy.data.objects.remove(body)

# Lo que el camperón tapa del pantalón y del chupín se esconde mientras lo lleva puesto: con las
# piernas abiertas los muslos atravesaban el faldón. Se corta con un plano apenas sobre el ruedo,
# para que el borde quede derecho y adentro del camperón. Lo mismo con lo que queda adentro de cada
# zapatilla (el chupín atravesaba la caña de la Jordan), por rayo: ese borde no se ve. Cada pedazo
# es `ropa_<id>__<prendas que lo tapan>`, o `ropa_<id>` si nada lo tapa.
shoe_trees = {n: BVHTree.FromPolygons([(prendas[n].matrix_world @ v.co) for v in prendas[n].data.vertices],
                                      [p.vertices[:] for p in prendas[n].data.polygons]) for n in ('jordan', 'nike')}
for name in ('pantalon_adidas', 'chupin'):
    o = prendas[name]
    o.name = f'{name}_entero'
    halves = [cut(o, f'{name}_bajo_camperon', [local_plane(o, CORTES['newells']['largo'] + SOBRE_RUEDO, keep='above')], least=1),
              cut(o, f'{name}_libre', [local_plane(o, CORTES['newells']['largo'] + SOBRE_RUEDO, keep='below')], least=1)]
    bpy.data.objects.remove(o)
    for half, coat_over in zip(halves, (('camperon_newells',), ())):
        nm = half.matrix_world.to_3x3().inverted().transposed()
        groups_of = {}
        for p in half.data.polygons:
            centre = half.matrix_world @ p.center
            n = (nm @ p.normal).normalized()
            shoes = tuple(s for s, t in shoe_trees.items() if centre.z < tops[s] + 0.01
                          and t.ray_cast(centre - n * HUNDIDO, n, ALCANCE + HUNDIDO)[0] is not None)
            groups_of.setdefault(coat_over + shoes, set()).add(p.index)
        for over, faces in groups_of.items():
            piece(half, faces, f'ropa_{name}' + ('__' + '+'.join(sorted(over)) if over else ''))
        bpy.data.objects.remove(half)

# Como prepare_rigged.py: de frente a +Z, una unidad de alto con los pies en el origen.
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
depsgraph = bpy.context.evaluated_depsgraph_get()
points = np.array([(o.matrix_world @ v.co)[:] for o in meshes if o.name.startswith('cuerpo__')
                   for v in o.evaluated_get(depsgraph).to_mesh().vertices])
low, high = points.min(0), points.max(0)
tall = high[2] - low[2]
centre = Vector(((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2]))
arm.matrix_world = Matrix.Rotation(np.radians(-90), 4, 'Z') @ Matrix.Scale(1 / tall, 4) @ Matrix.Translation(-centre) @ arm.matrix_world

# Sin reducir la textura: a 512 px y pocos colores el escudo se pixelaba y sus estrellas se volvían
# color piel. Solo mate, para que la luz del juego sea la que sombrea.
for material in bpy.data.materials:
    for node in (material.node_tree.nodes if material.node_tree else []):
        if node.type == 'BSDF_PRINCIPLED':
            node.inputs['Metallic'].default_value = 0
            node.inputs['Roughness'].default_value = 1

def softened(source: str, bones: tuple, share: float, name: str, keep: str) -> None:
    """Una copia de la acción `source` en la que esos huesos giran solo `share` de lo que giran en
    ella, y `keep` sigue mirando a donde miraba (si no, con la espalda inclinada, mira al piso)."""
    src = bpy.data.actions[source]
    arm.animation_data.action = src
    first, last = map(int, src.frame_range)
    poses = []
    for f in range(first, last + 1):
        bpy.context.scene.frame_set(f)
        poses.append(({pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in arm.pose.bones},
                      arm.pose.bones[keep].matrix.to_quaternion()))
    new = bpy.data.actions.new(name)
    arm.animation_data.action = new
    for f, (pose, facing) in zip(range(first, last + 1), poses):
        for pb in arm.pose.bones:
            loc, rot = pose[pb.name]
            pb.location = loc
            pb.rotation_quaternion = Quaternion().slerp(rot, share) if pb.name in bones else rot
        bpy.context.view_layer.update()
        head = arm.pose.bones[keep]
        head.matrix = Matrix.LocRotScale(head.matrix.to_translation(), facing, None)
        bpy.context.view_layer.update()
        for pb in arm.pose.bones:
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_quaternion', frame=f)
    arm.animation_data.action = None


# El reposo zombie lleva el cuello 32° adelante y la cabeza 40° atrás sobre él: el cuello se arruga.
# Una versión con el cuello a menos de un tercio y la cabeza mirando igual, para comparar.
if 'reposo' in bpy.data.actions:
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    softened('reposo', ('NeckTwist01', 'NeckTwist02'), 0.3, 'reposo_suave', keep='Head')

arm.animation_data_create()
# Las pistas que traía el rig importado apuntan a acciones que ya se reemplazaron: vacías, el
# exportador sacaba todos los clips quietos.
for track in list(arm.animation_data.nla_tracks):
    arm.animation_data.nla_tracks.remove(track)
arm.animation_data.action = None
for a in list(bpy.data.actions):
    a.use_fake_user = True
    track = arm.animation_data.nla_tracks.new()
    track.name = a.name
    track.strips.new(a.name, int(a.frame_range[0]), a)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True,
                          export_animation_mode='NLA_TRACKS', export_apply=False)
print(f'WROTE {dst}: clips {[a.name for a in bpy.data.actions]}, mallas {sorted(o.name for o in meshes)}')
