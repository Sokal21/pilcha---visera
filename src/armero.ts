import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { agarre, aplicarAgarre, leerAgarre, type Agarre } from './agarre';

// El armero: el protagonista congelado en un cuadro de las animaciones con pistola, para acomodar
// el arma en la mano con un manipulador y guardar el agarre (src/agarre.json) que usa el juego.

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

const manipulador = new TransformControls(camera, renderer.domElement);
manipulador.setSize(0.8);
manipulador.addEventListener('dragging-changed', (e) => (orbita.enabled = !e.value));
scene.add(manipulador.getHelper());

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
let conjunto = 'tracksuit';

function vestir(): void {
  const puestas = new Set([...CONJUNTOS[conjunto], 'pistola', 'pistola_mano']);
  for (const [nombre, malla] of mallas) {
    if (nombre.startsWith('ropa_')) {
      const [id, tapan = ''] = nombre.slice(5).split('__');
      malla.visible = puestas.has(id) && !tapan.split('+').some((t) => puestas.has(t));
    }
    if (nombre.startsWith('cuerpo__')) malla.visible = !nombre.slice(8).split('+').some((id) => puestas.has(id));
  }
  for (const id of Object.keys(CONJUNTOS)) $(id).classList.toggle('on', id === conjunto);
}

function posar(): void {
  if (!mixer) return;
  const accion = acciones.get(selClip.value);
  if (!accion) return;
  for (const a of acciones.values()) if (a !== accion) a.stop();
  accion.play();
  accion.paused = true;
  accion.time = Number(cuadro.value) * accion.getClip().duration;
  mixer.update(0);
  tiempo.textContent = `${accion.time.toFixed(2)} s de ${accion.getClip().duration.toFixed(2)} s`;
}

function modo(m: 'translate' | 'rotate'): void {
  manipulador.setMode(m);
  $('mover').classList.toggle('on', m === 'translate');
  $('rotar').classList.toggle('on', m === 'rotate');
}

function espacio(local: boolean): void {
  manipulador.setSpace(local ? 'local' : 'world');
  $('local').classList.toggle('on', local);
}

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
    manipulador.attach(pistola);
    // El caño, hasta 30 m: como hija de la pistola, se mueve con ella.
    const caño = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([BOCA, BOCA.clone().add(new THREE.Vector3(-30, 0, 0))]),
      new THREE.LineBasicMaterial({ color: 0xff3030 }),
    );
    caño.frustumCulled = false;
    pistola.add(caño);
  }
  // Hacia dónde mira el personaje: su +Z, a la altura del pecho.
  const frente = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.35, 0), new THREE.Vector3(0, 1.35, 30)]),
    new THREE.LineBasicMaterial({ color: 0x30ff60 }),
  );
  scene.add(frente);
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
});

selClip.onchange = () => { cuadro.value = '0'; posar(); };
cuadro.oninput = posar;
$('mover').onclick = () => modo('translate');
$('rotar').onclick = () => modo('rotate');
$('local').onclick = () => espacio(manipulador.space !== 'local');
for (const id of Object.keys(CONJUNTOS)) $(id).onclick = () => { conjunto = id; vestir(); };
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'KeyW') modo('translate');
  if (e.code === 'KeyE') modo('rotate');
  if (e.code === 'KeyQ') espacio(manipulador.space !== 'local');
});

// Pasos chicos respecto del personaje (que mira a +Z, con +Y arriba y +X a su izquierda): la
// pistola cuelga de la mano, así que el paso se lleva a los ejes de la mano antes de sumarlo.
const PASO = 0.005;
const PASO_FINO = 0.001;
const GIRO = THREE.MathUtils.degToRad(2);
const GIRO_FINO = THREE.MathUtils.degToRad(0.5);
const fino = $<HTMLInputElement>('fino');

function correr(dx: number, dy: number, dz: number, chico = fino.checked): void {
  if (!pistola?.parent) return;
  const paso = chico ? PASO_FINO : PASO;
  const padre = pistola.parent;
  pistola.updateWorldMatrix(true, false);
  const donde = pistola.getWorldPosition(new THREE.Vector3());
  const destino = donde.clone().add(new THREE.Vector3(dx, dy, dz).multiplyScalar(paso));
  pistola.position.add(padre.worldToLocal(destino).sub(padre.worldToLocal(donde)));
}

// Girar sobre la boca del arma no: sobre la empuñadura (su origen), en ejes del personaje. "Caño
// arriba" es girar sobre el eje que cruza el pecho; "rolar", sobre el eje del caño hacia adelante.
function girar(ax: number, ay: number, az: number, chico = fino.checked): void {
  if (!pistola?.parent) return;
  const angulo = chico ? GIRO_FINO : GIRO;
  const eje = new THREE.Vector3(ax, ay, az).normalize();
  const enMundo = new THREE.Quaternion().setFromAxisAngle(eje, angulo);
  const padre = pistola.parent.getWorldQuaternion(new THREE.Quaternion());
  pistola.quaternion.premultiply(padre.clone().invert().multiply(enMundo).multiply(padre));
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mover]')) {
  const [x, y, z] = b.dataset.mover!.split(',').map(Number);
  b.onclick = () => correr(x, y, z);
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-girar]')) {
  const [x, y, z] = b.dataset.girar!.split(',').map(Number);
  b.onclick = () => girar(x, y, z);
}
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const teclas: Record<string, [number, number, number]> = {
    ArrowUp: [0, 0, 1], ArrowDown: [0, 0, -1], ArrowLeft: [1, 0, 0], ArrowRight: [-1, 0, 0], PageUp: [0, 1, 0], PageDown: [0, -1, 0],
  };
  const t = teclas[e.code];
  if (!t) return;
  e.preventDefault();
  correr(...t, e.shiftKey || fino.checked);
});

$('guardar').onclick = async () => {
  if (!pistola) return;
  const r = await fetch('/api/agarre', { method: 'POST', body: JSON.stringify(leerAgarre(pistola)) });
  estado.textContent = r.ok ? 'Guardado en src/agarre.json' : `No se pudo guardar (${r.status})`;
};
$('original').onclick = () => { if (pistola && deBlender) aplicarAgarre(pistola, deBlender); estado.textContent = 'Como lo puso Blender (sin guardar)'; };
$('guardado').onclick = () => { if (pistola) { if (deBlender) aplicarAgarre(pistola, deBlender); aplicarAgarre(pistola, agarre); } estado.textContent = 'Como está guardado'; };

modo('rotate');
espacio(true);

for (const id of ['arriba', 'costado', 'atras', 'libre'] as const) $(`vista-${id}`).onclick = () => ponerVista(id);
ponerVista('libre');

renderer.setAnimationLoop(() => {
  orbita.enabled = vista === 'libre' && !manipulador.dragging;
  orbita.update();
  renderer.render(scene, vista === 'libre' ? camera : ortho);
});
