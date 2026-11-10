import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { aplicarAgarre } from './agarre';
import { Faldon } from './faldon';

// Fotogramas: las animaciones del protagonista cuadro por cuadro, para encontrar dónde se
// desajustan (una zapatilla que se sale del tobillo, la mano que suelta el arma) y decir en qué
// clip y en qué cuadro. El cartel de arriba sale en la captura. El faldón cuelga como en el juego y
// la pistola lleva el agarre guardado; la corrección del apunte hacia la mira no (depende de la
// cámara del juego).

const ALTO = 1.75;
const FPS = 24; // los clips se hornean a 24 cuadros por segundo (tools/blender/retarget_rot.py)
const ROPAS: Record<string, string[]> = {
  "Camperón Newell's, pantalón adidas, Jordan": ['camperon_newells', 'pantalon_adidas', 'jordan'],
  Tracksuit: ['campera_adidas', 'pantalon_adidas', 'jordan'],
  "Newell's": ['camperon_newells', 'chupin', 'nike'],
  'En boxers': [],
};
const NOMBRES: Record<string, string> = {
  caminata: 'Caminata', reposo: 'Reposo zombie', reposo_suave: 'Zombie, cuello suave', reposo_orco: 'Reposo orco',
  reposo_abierto: 'Piernas abiertas', pistola_reposo: 'Apuntando quieto', pistola_caminata: 'Caminando apuntando',
  pistola_guardar: 'Guardar la pistola (al revés, sacarla)',
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2c33);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 2));
const sol = new THREE.DirectionalLight(0xffffff, 1.6);
sol.position.set(2, 4, 3);
scene.add(sol);
scene.add(new THREE.GridHelper(6, 24, 0x555555, 0x3a3a3a));

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100);
const orbita = new OrbitControls(camera, renderer.domElement);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const selClip = $<HTMLSelectElement>('clip');
const selRopa = $<HTMLSelectElement>('ropa');
const linea = $<HTMLInputElement>('linea');
const cartel = $('cartel');

let mixer: THREE.AnimationMixer | null = null;
let faldon: Faldon | null = null;
let esqueleto: THREE.SkeletonHelper | null = null;
const acciones = new Map<string, THREE.AnimationAction>();
const mallas = new Map<string, THREE.Object3D>();
let cuadro = 0;
let reproduciendo = false;
let acumulado = 0;
let pistola = false;
let rayos = false;

function cuadros(): number {
  const a = acciones.get(selClip.value);
  return a ? Math.round(a.getClip().duration * FPS) : 0;
}

function vestir(): void {
  const puestas = new Set(ROPAS[selRopa.value] ?? []);
  if (pistola) puestas.add('pistola').add('pistola_mano');
  for (const [nombre, malla] of mallas) {
    const m = malla as THREE.Mesh;
    if (nombre.startsWith('ropa_')) {
      const [id, tapan = ''] = nombre.slice(5).split('__');
      m.visible = puestas.has(id) && !tapan.split('+').some((t) => puestas.has(t));
      // Con rayos X la ropa queda medio transparente y se ve el cuerpo de abajo.
      for (const mat of [m.material].flat() as THREE.MeshStandardMaterial[]) {
        mat.transparent = rayos;
        mat.opacity = rayos ? 0.35 : 1;
        mat.depthWrite = !rayos;
      }
    }
    if (nombre.startsWith('cuerpo__')) m.visible = rayos || !nombre.slice(8).split('+').some((id) => puestas.has(id));
  }
  $('pistola').classList.toggle('on', pistola);
  $('rayos').classList.toggle('on', rayos);
}

function mostrar(): void {
  const accion = acciones.get(selClip.value);
  if (!mixer || !accion) return;
  const total = cuadros();
  cuadro = ((cuadro % (total + 1)) + total + 1) % (total + 1);
  for (const a of acciones.values()) if (a !== accion) a.stop();
  accion.play();
  accion.paused = true;
  accion.time = Math.min(cuadro / FPS, accion.getClip().duration);
  mixer.update(0);
  modelo?.updateMatrixWorld(true);
  faldon?.colgar();
  linea.max = String(total);
  linea.value = String(cuadro);
  cartel.innerHTML = `${NOMBRES[selClip.value] ?? selClip.value} · cuadro ${cuadro} / ${total}<small>${selClip.value} · ${(cuadro / FPS).toFixed(2)} s</small>`;
}

const VISTAS: Record<string, { pos: [number, number, number]; foco: [number, number, number] }> = {
  frente: { pos: [0, 1.1, 3.6], foco: [0, 0.9, 0] },
  costado: { pos: [3.6, 1.1, 0], foco: [0, 0.9, 0] },
  atras: { pos: [0, 1.1, -3.6], foco: [0, 0.9, 0] },
  arriba: { pos: [0, 5, 0.01], foco: [0, 0.9, 0] },
  pies: { pos: [0.9, 0.35, 1.1], foco: [0, 0.1, 0] },
  mano: { pos: [0.7, 1.5, 1.2], foco: [0, 1.3, 0.3] },
};

function vista(id: string): void {
  const v = VISTAS[id];
  camera.position.set(...v.pos);
  orbita.target.set(...v.foco);
  orbita.update();
}

let modelo: THREE.Object3D | null = null;
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
  const arma = mallas.get('ropa_pistola');
  if (arma) aplicarAgarre(arma);
  modelo.updateMatrixWorld(true);
  faldon = new Faldon(modelo);
  esqueleto = new THREE.SkeletonHelper(modelo);
  esqueleto.visible = false;
  scene.add(esqueleto);
  mixer = new THREE.AnimationMixer(modelo);
  for (const clip of gltf.animations) acciones.set(clip.name, mixer.clipAction(clip));
  for (const nombre of [...acciones.keys()].sort()) {
    const op = document.createElement('option');
    op.value = nombre;
    op.textContent = NOMBRES[nombre] ?? nombre;
    selClip.append(op);
  }
  selClip.value = acciones.has('caminata') ? 'caminata' : selClip.options[0].value;
  vestir();
  mostrar();
});

for (const nombre of Object.keys(ROPAS)) {
  const op = document.createElement('option');
  op.value = op.textContent = nombre;
  selRopa.append(op);
}
selClip.onchange = () => {
  cuadro = 0;
  pistola = selClip.value.startsWith('pistola');
  vestir();
  mostrar();
  selClip.blur();
};
selRopa.onchange = () => { vestir(); selRopa.blur(); };
linea.oninput = () => { cuadro = Number(linea.value); mostrar(); };
$('pistola').onclick = () => { pistola = !pistola; vestir(); };
$('rayos').onclick = () => { rayos = !rayos; vestir(); };
$('huesos').onclick = () => {
  if (!esqueleto) return;
  esqueleto.visible = !esqueleto.visible;
  $('huesos').classList.toggle('on', esqueleto.visible);
};
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-vista]')) b.onclick = () => vista(b.dataset.vista!);

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
  const pasos: Record<string, number> = { KeyD: 1, ArrowRight: 1, KeyA: -1, ArrowLeft: -1, KeyW: 10, KeyS: -10 };
  if (e.code in pasos) {
    e.preventDefault();
    reproduciendo = false;
    cuadro += pasos[e.code];
    mostrar();
  }
  if (e.code === 'Space') {
    e.preventDefault();
    reproduciendo = !reproduciendo;
  }
});

vista('frente');
const reloj = new THREE.Timer();
renderer.setAnimationLoop((t) => {
  reloj.update(t);
  if (reproduciendo) {
    acumulado += reloj.getDelta();
    while (acumulado >= 1 / FPS) {
      acumulado -= 1 / FPS;
      cuadro++;
    }
    mostrar();
  }
  orbita.update();
  renderer.render(scene, camera);
});
