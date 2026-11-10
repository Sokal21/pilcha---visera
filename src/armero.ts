import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { aplicarAgarre, leerAgarre, type Agarre } from './agarre';
import { Pose, posesHuesos, type NombrePose } from './huesos';

// El armero: el protagonista congelado en un cuadro de las animaciones con pistola, para acomodar
// a mano con un manipulador la pistola en la mano y los huesos de las manos (muñecas y dedos: se
// mueven y se giran), y guardar todo (src/agarre.json y src/huesos.json) para el juego. Los huesos
// se eligen con un click en sus puntos amarillos. Guardar no recarga la página (vite.config.ts).

const ALTO = 1.75;
const BOCA = new THREE.Vector3(-0.093, 0.115, -0.003); // la boca del caño en la malla de la pistola
const CLIPS = [
  { clip: 'pistola_reposo', nombre: 'Apuntando quieto' },
  { clip: 'pistola_caminata', nombre: 'Caminando apuntando' },
  { clip: 'pistola_guardar', nombre: 'Guardándola (al revés, sacándola)' },
];
const CONJUNTOS: Record<string, string[]> = {
  tracksuit: ['campera_adidas', 'pantalon_adidas', 'jordan'],
  newells: ['camperon_newells', 'chupin', 'nike'],
  boxers: [],
};
const DEDOS: Record<string, string> = { Thumb: 'pulgar', Index: 'índice', Middle: 'mayor', Ring: 'anular', Pinky: 'meñique' };
const PARTES: Record<string, string> = {
  Hip: 'Cadera', Pelvis: 'Pelvis', Waist: 'Cintura', Spine01: 'Espalda baja', Spine02: 'Espalda alta', NeckTwist01: 'Cuello',
  NeckTwist02: 'Cuello alto', Head: 'Cabeza', Clavicle: 'Hombro', Upperarm: 'Brazo', Forearm: 'Antebrazo', Hand: 'Muñeca',
  Thigh: 'Muslo', Calf: 'Rodilla', Foot: 'Pie', ToeBase: 'Dedos del pie',
};

function nombreDe(hueso: string): string {
  const lado = hueso[1] === '_' ? (hueso[0] === 'R' ? ' derecho' : ' izquierdo') : '';
  const resto = hueso[1] === '_' ? hueso.slice(2) : hueso;
  const dedo = /^(\w+?)([123])$/.exec(resto);
  if (dedo && DEDOS[dedo[1]]) return `${DEDOS[dedo[1]][0].toUpperCase()}${DEDOS[dedo[1]].slice(1)} ${['base', 'medio', 'punta'][Number(dedo[2]) - 1]}${lado}`;
  return `${PARTES[resto] ?? resto}${lado}`;
}

// Al mover (W) un hueso, cuántos de sus padres doblan para que llegue sin despegarse (cinemática
// inversa); la cadera se mueve entera.
function cadenaDe(hueso: string): number {
  if (hueso === 'Hip') return 0;
  if (/(Hand|Foot)$/.test(hueso)) return 2;
  if (hueso === 'Head') return 3;
  const dedo = /^[LR]_(Thumb|Index|Middle|Ring|Pinky)([123])$/.exec(hueso);
  if (dedo) return Number(dedo[2]) - 1;
  return 1;
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x26272c);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 2));
const sol = new THREE.DirectionalLight(0xffffff, 1.6);
sol.position.set(2, 4, 3);
scene.add(sol);
scene.add(new THREE.GridHelper(4, 16, 0x444444, 0x333333));

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0.9, 1.6, 1.3);
const orbita = new OrbitControls(camera, renderer.domElement);
orbita.target.set(0, 1.3, 0.3);
orbita.update();

// Vistas sin perspectiva, para comparar el caño (rojo) con el frente (verde) sin que la perspectiva
// abra dos líneas paralelas que vienen hacia la cámara.
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
let vista: 'libre' | 'arriba' | 'costado' | 'atras' = 'libre';

const manipulador = new TransformControls(camera, renderer.domElement);
manipulador.setSize(0.8);
manipulador.addEventListener('dragging-changed', (e) => (orbita.enabled = !e.value));
scene.add(manipulador.getHelper());

function ponerVista(v: typeof vista): void {
  vista = v;
  for (const id of ['arriba', 'costado', 'atras', 'libre']) document.getElementById(`vista-${id}`)?.classList.toggle('on', id === v);
  const foco = new THREE.Vector3(0, 1.3, 0.25);
  const lejos = { arriba: new THREE.Vector3(0, 10, 0), costado: new THREE.Vector3(-10, 0, 0), atras: new THREE.Vector3(0, 0, -10), libre: null }[v];
  if (lejos) {
    ortho.position.copy(foco).add(lejos);
    ortho.up.set(0, v === 'arriba' ? 0 : 1, v === 'arriba' ? 1 : 0);
    ortho.lookAt(foco);
  }
  encuadrar();
  manipulador.camera = lejos ? ortho : camera;
}

function encuadrar(): void {
  const media = 0.6;
  const aspecto = innerWidth / innerHeight;
  Object.assign(ortho, { left: -media * aspecto, right: media * aspecto, top: media, bottom: -media });
  ortho.updateProjectionMatrix();
}

addEventListener('resize', () => {
  encuadrar();
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const selClip = $<HTMLSelectElement>('clip');
const cuadro = $<HTMLInputElement>('cuadro');
const tiempo = $('tiempo');
const estado = $('estado');

let mixer: THREE.AnimationMixer | null = null;
const acciones = new Map<string, THREE.AnimationAction>();
const mallas = new Map<string, THREE.Object3D>();
let pistola: THREE.Object3D | null = null;
let deBlender: Agarre | null = null;
let modelo: THREE.Object3D | null = null;
let pose: Pose | null = null;
let conjunto = 'tracksuit';
let poseActual: NombrePose = 'pistola';
let elegido: string | null = null; // el hueso que se manipula; null: la pistola

// Un punto por hueso elegible (todos menos los de torsión y la raíz), siempre visible.
const puntos = new Map<string, THREE.Mesh>();
const puntoMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, depthTest: false, transparent: true, opacity: 0.85 });
const puntoElegido = new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false });

function crearPuntos(raiz: THREE.Object3D): void {
  raiz.traverse((o) => {
    if (!(o as THREE.Bone).isBone || /Twist|Root|Faldon/.test(o.name) && !/^NeckTwist/.test(o.name)) return;
    const chico = /(Thumb|Index|Middle|Ring|Pinky)[123]$/.test(o.name);
    const p = new THREE.Mesh(new THREE.SphereGeometry(chico ? 0.005 : 0.011, 10, 10), puntoMat);
    p.renderOrder = 10;
    p.userData.hueso = o.name;
    puntos.set(o.name, p);
    scene.add(p);
  });
}

// Mover con cinemática inversa: el manipulador mueve un objetivo invisible y la cadena de padres del
// hueso gira (CCD) hasta que el hueso llega, sin que él cambie de orientación.
const objetivo = new THREE.Object3D();
scene.add(objetivo);

function cadena(nombre: string): THREE.Bone[] {
  const out: THREE.Bone[] = [];
  let h = pose?.hueso(nombre)?.parent;
  for (let i = 0; i < cadenaDe(nombre) && h && (h as THREE.Bone).isBone; i++) {
    out.push(h as THREE.Bone);
    h = h.parent;
  }
  return out;
}

function alcanzar(hueso: THREE.Bone, padres: THREE.Bone[], destino: THREE.Vector3): void {
  const orientacion = hueso.getWorldQuaternion(new THREE.Quaternion());
  const j = new THREE.Vector3();
  const e = new THREE.Vector3();
  for (let vuelta = 0; vuelta < 12; vuelta++) {
    for (const p of padres) {
      p.getWorldPosition(j);
      hueso.getWorldPosition(e);
      const a = e.sub(j).normalize();
      const b = destino.clone().sub(j).normalize();
      if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) continue;
      const giro = new THREE.Quaternion().setFromUnitVectors(a, b);
      const padre = p.parent!.getWorldQuaternion(new THREE.Quaternion());
      p.quaternion.premultiply(padre.clone().invert().multiply(giro).multiply(padre));
      p.updateMatrixWorld(true);
    }
    if (hueso.getWorldPosition(e).distanceTo(destino) < 0.0005) break;
  }
  // El hueso queda orientado como estaba (la mano no gira al llevarla a otro lado).
  const padre = hueso.parent!.getWorldQuaternion(new THREE.Quaternion());
  hueso.quaternion.copy(padre.invert().multiply(orientacion));
  hueso.updateMatrixWorld(true);
}

function ubicarPuntos(): void {
  for (const [nombre, p] of puntos) {
    const h = pose?.hueso(nombre);
    p.visible = !!h;
    if (h) h.getWorldPosition(p.position);
    p.material = nombre === elegido ? puntoElegido : puntoMat;
  }
}

function vestir(): void {
  const puestas = new Set([...CONJUNTOS[conjunto], poseActual === 'pistola' ? 'pistola' : '']);
  for (const [nombre, malla] of mallas) {
    if (nombre.startsWith('ropa_')) {
      const [id, tapan = ''] = nombre.slice(5).split('__');
      malla.visible = puestas.has(id) && !tapan.split('+').some((t) => puestas.has(t));
    }
    if (nombre.startsWith('cuerpo__')) malla.visible = !nombre.slice(8).split('+').some((id) => puestas.has(id));
  }
  for (const id of Object.keys(CONJUNTOS)) $(id).classList.toggle('on', id === conjunto);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-pose]')) b.classList.toggle('on', b.dataset.pose === poseActual);
}

function posar(): void {
  if (!mixer) return;
  const accion = acciones.get(selClip.value);
  if (!accion) return;
  // Detenida y vuelta a arrancar cada vez: si no, en el mismo cuadro three.js no vuelve a aplicarla y
  // los huesos con ajuste quedaban en su reposo (los brazos salían de la pose).
  for (const a of acciones.values()) a.stop();
  accion.play();
  accion.paused = true;
  accion.time = Number(cuadro.value) * accion.getClip().duration;
  pose?.antes(posesHuesos.relajada, posesHuesos.pistola);
  mixer.update(0);
  modelo?.updateMatrixWorld(true);
  pose?.aplicar(posesHuesos[poseActual]);
  ubicarPuntos();
  if (!manipulador.dragging) sujetar(); // el objetivo de la cinemática inversa, de vuelta sobre el hueso
  tiempo.textContent = `${accion.time.toFixed(2)} s de ${accion.getClip().duration.toFixed(2)} s`;
}

function modo(m: 'translate' | 'rotate'): void {
  manipulador.setMode(m);
  sujetar();
  $('mover').classList.toggle('on', m === 'translate');
  $('rotar').classList.toggle('on', m === 'rotate');
}

function espacio(local: boolean): void {
  manipulador.setSpace(local ? 'local' : 'world');
  $('local').classList.toggle('on', local);
}

function elegir(nombre: string | null): void {
  elegido = nombre;
  if (nombre) {
    // Que el hueso y su cadena tengan su entrada (vacía) para que el cuadro registre cómo los deja la animación.
    let falta = false;
    for (const n of [nombre, ...cadena(nombre).map((b) => b.name)]) {
      if (!posesHuesos[poseActual][n]) {
        posesHuesos[poseActual][n] = {};
        falta = true;
      }
    }
    if (falta) posar();
  }
  sujetar();
  $('elegido').textContent = nombre ? nombreDe(nombre) : 'La pistola';
  ubicarPuntos();
}

// Qué agarra el manipulador: la pistola; un hueso, para girarlo; o el objetivo de la cinemática
// inversa, puesto sobre el hueso, para moverlo (la cadera se mueve directo).
function sujetar(): void {
  const hueso = elegido ? pose?.hueso(elegido) : null;
  if (!elegido) {
    if (pistola) manipulador.attach(pistola);
  } else if (hueso && manipulador.mode === 'translate' && cadenaDe(elegido) > 0) {
    hueso.getWorldPosition(objetivo.position);
    hueso.getWorldQuaternion(objetivo.quaternion);
    manipulador.attach(objetivo);
  } else if (hueso) {
    manipulador.attach(hueso);
  }
}

// Al mover o girar un hueso, su ajuste (y el de su cadena) es lo que se aparta de como lo dejó la animación.
manipulador.addEventListener('objectChange', () => {
  if (!elegido || !pose) return;
  const hueso = pose.hueso(elegido);
  if (!hueso) return;
  const padres = manipulador.object === objetivo ? cadena(elegido) : [];
  if (padres.length) alcanzar(hueso, padres, objetivo.getWorldPosition(new THREE.Vector3()));
  for (const n of [elegido, ...padres.map((b) => b.name)]) {
    const ajuste = pose.medir(n);
    if (ajuste) posesHuesos[poseActual][n] = ajuste;
  }
  ubicarPuntos();
});

// Elegir un hueso con un click en su punto (si no se está arrastrando el manipulador).
const rayo = new THREE.Raycaster();
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (manipulador.dragging || manipulador.axis) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  rayo.setFromCamera(ndc, vista === 'libre' ? camera : ortho);
  const hit = rayo.intersectObjects([...puntos.values()].filter((p) => p.visible))[0];
  if (hit) elegir(hit.object.userData.hueso as string);
});

new GLTFLoader().load(`${import.meta.env.BASE_URL}models/protagonista.glb`, (gltf) => {
  modelo = gltf.scene;
  modelo.scale.setScalar(ALTO);
  modelo.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      mallas.set(o.name, o);
      o.frustumCulled = false;
    }
  });
  scene.add(modelo);
  pistola = mallas.get('ropa_pistola') ?? null;
  if (pistola) {
    deBlender = leerAgarre(pistola);
    aplicarAgarre(pistola);
    // El caño, hasta 30 m: como hija de la pistola, se mueve con ella.
    const caño = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([BOCA, BOCA.clone().add(new THREE.Vector3(-30, 0, 0))]),
      new THREE.LineBasicMaterial({ color: 0xff3030 }),
    );
    caño.frustumCulled = false;
    pistola.add(caño);
  }
  // Hacia dónde mira el personaje: su +Z, a la altura del pecho.
  scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.35, 0), new THREE.Vector3(0, 1.35, 30)]),
    new THREE.LineBasicMaterial({ color: 0x30ff60 }),
  ));
  pose = new Pose(modelo);
  crearPuntos(modelo);
  mixer = new THREE.AnimationMixer(modelo);
  for (const clip of gltf.animations) acciones.set(clip.name, mixer.clipAction(clip));
  for (const c of CLIPS.filter((x) => acciones.has(x.clip))) {
    const op = document.createElement('option');
    op.value = c.clip;
    op.textContent = c.nombre;
    selClip.append(op);
  }
  vestir();
  posar();
  elegir(null);
});

selClip.onchange = () => { cuadro.value = '0'; posar(); selClip.blur(); };
cuadro.oninput = posar;
$('mover').onclick = () => modo('translate');
$('rotar').onclick = () => modo('rotate');
$('local').onclick = () => espacio(manipulador.space !== 'local');
for (const id of Object.keys(CONJUNTOS)) $(id).onclick = () => { conjunto = id; vestir(); };
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-pose]')) {
  b.onclick = () => { poseActual = b.dataset.pose as NombrePose; vestir(); posar(); elegir(elegido); };
}
$('manipular-pistola').onclick = () => elegir(null);
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'KeyW') modo('translate');
  if (e.code === 'KeyE') modo('rotate');
  if (e.code === 'KeyQ') espacio(manipulador.space !== 'local');
});

$('volver').onclick = () => {
  if (elegido) {
    for (const n of [elegido, ...cadena(elegido).map((b) => b.name)]) posesHuesos[poseActual][n] = {};
    posar();
    sujetar();
    estado.textContent = `${nombreDe(elegido)}: como la deja la animación (sin guardar)`;
  } else if (pistola && deBlender) {
    aplicarAgarre(pistola, deBlender);
    aplicarAgarre(pistola);
    estado.textContent = 'Pistola como está guardada';
  }
};
$('original').onclick = () => {
  if (pistola && deBlender) aplicarAgarre(pistola, deBlender);
  estado.textContent = 'Pistola como la puso Blender (sin guardar)';
};

// Guarda las dos cosas juntas, así no queda una sin guardar.
$('guardar').onclick = async () => {
  if (!pistola) return;
  const limpias = Object.fromEntries(Object.entries(posesHuesos).map(([p, a]) => [p, Object.fromEntries(Object.entries(a).filter(([, v]) => v.giro || v.mover))]));
  const [r1, r2] = await Promise.all([
    fetch('/api/guardar/agarre', { method: 'POST', body: JSON.stringify(leerAgarre(pistola)) }),
    fetch('/api/guardar/huesos', { method: 'POST', body: JSON.stringify(limpias) }),
  ]);
  estado.textContent = r1.ok && r2.ok ? 'Guardado (src/agarre.json y src/huesos.json)' : `No se pudo guardar (${r1.status} / ${r2.status})`;
};

modo('rotate');
espacio(true);
for (const id of ['arriba', 'costado', 'atras', 'libre'] as const) $(`vista-${id}`).onclick = () => ponerVista(id);
ponerVista('libre');

renderer.setAnimationLoop(() => {
  orbita.enabled = vista === 'libre' && !manipulador.dragging;
  orbita.update();
  renderer.render(scene, vista === 'libre' ? camera : ortho);
});
