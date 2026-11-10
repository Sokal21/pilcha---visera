import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONJUNTOS, LUGARES, PRENDAS, type Lugar } from './vestuario';
import { Poligono } from './poligono';
import { aplicarAgarre } from './agarre';
import { Fogonazo } from './fogonazo';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AJUSTES, ajustar, pasoSucio, valor } from './sucio';
import { Conos } from './conos';
import { Faldon } from './faldon';
import { Pose, posesHuesos } from './huesos';

// Un polígono de tiro para probar al protagonista: camina con WASD, con Shift saca la pistola y
// apunta (la cámara se acerca a su espalda y aparece la mira), con click dispara, con Shift otra
// vez la guarda. El panel de la derecha sigue sirviendo para vestirlo.

const ALTO = 1.75; // metros: el modelo mide una unidad
// Cuánto avanza un pie por paso en cada caminata (medido en el clip, en altos del modelo) y a qué
// velocidad se reproduce: así el piso avanza lo mismo que los pies y no patinan.
const CAMINATAS = {
  caminata: { paso: 0.53, ritmo: 0.8 },
  pistola_caminata: { paso: 0.52, ritmo: 0.6 },
};
// `pistola_guardar` va de apuntar a guardarla (24 cuadros por segundo). Se usa de 24 a 112: antes
// apunta quieto, después deja caer el brazo. En el 82 la pistola entra en la funda; al revés, sale.
const GUARDAR = { desde: 24, hasta: 112, funda: 82, fps: 24 };
const SACAR_RITMO = 2.4;
const GUARDAR_RITMO = 2.0;
const CADENCIA = 0.18; // segundos entre tiros
// La boca del caño en la malla de la pistola (la Glock en metros, ya en ejes de glTF).
const BOCA = new THREE.Vector3(-0.093, 0.115, -0.003);
// La ventana de expulsión, al costado derecho de la corredera, y hacia dónde salen las vainas:
// a la derecha (-Z en la malla), arriba y un poco hacia atrás (+X), a VAINA_VELOCIDAD m/s.
const EXPULSION = new THREE.Vector3(-0.03, 0.12, -0.012);
const EXPULSION_DIR = new THREE.Vector3(0.3, 0.6, -1).normalize();
const VAINA_VELOCIDAD = 3.2;

const CAMARA = {
  libre: { alto: 1.55, distancia: 4.2, hombro: 0, fov: 55 },
  apuntando: { alto: 1.6, distancia: 1.5, hombro: 0.5, fov: 42 },
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
// De noche: cielo y niebla azul oscuro, una luna tenue; lo demás lo ponen las farolas y los tiros.
scene.background = new THREE.Color(0x0b1222);
scene.fog = new THREE.Fog(0x0b1222, 22, 70);
scene.add(new THREE.HemisphereLight(0x8fa2d0, 0x2a2a34, 1.0));
const sol = new THREE.DirectionalLight(0xb4c4ff, 0.9); // la luna
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
Object.assign(sol.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 60 });
scene.add(sol, sol.target);

const poligono = new Poligono();
scene.add(poligono.grupo);
const fogonazo = new Fogonazo();
scene.add(fogonazo.grupo);
const conos = new Conos(poligono.lamparas);
scene.add(conos.grupo);
const FAROLAS = { conos: 0.6, polvo: 0.1 };
conos.intensidad = FAROLAS.conos;
conos.polvo = FAROLAS.polvo;

const camera = new THREE.PerspectiveCamera(CAMARA.libre.fov, innerWidth / innerHeight, 0.05, 200);

// Resplandor de lo que brilla (las lámparas, el fogonazo).
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.5, 0.75));
composer.addPass(new OutputPass());
const sucio = pasoSucio();
composer.addPass(sucio);

// La pasada de normales y profundidad para el contorno de tinta: la escena otra vez, con un
// material que pinta hacia dónde mira cada superficie. Lo transparente (fogonazo, conos, polvo) no.
const normales = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
const pintaNormales = new THREE.MeshNormalMaterial();
sucio.uniforms.tNormal.value = normales.texture;
sucio.uniforms.tDepth.value = normales.depthTexture;
sucio.uniforms.camaraCerca.value = camera.near;
sucio.uniforms.camaraLejos.value = camera.far;

function medirSucio(): void {
  const pr = renderer.getPixelRatio();
  sucio.uniforms.resolucion.value.set(innerWidth * pr, innerHeight * pr);
  normales.setSize(innerWidth * pr, innerHeight * pr);
}
medirSucio();

function pintarNormales(): void {
  if (valor('contorno') <= 0) return;
  const transparentes = [fogonazo.grupo, conos.grupo];
  const antes = transparentes.map((o) => o.visible);
  for (const o of transparentes) o.visible = false;
  const fondo = scene.background;
  scene.background = null;
  scene.overrideMaterial = pintaNormales;
  renderer.setRenderTarget(normales);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  scene.background = fondo;
  transparentes.forEach((o, i) => (o.visible = antes[i]));
}

// Tonos: los materiales pasan a sombreado de dibujo (la luz en franjas planas) o vuelven al normal.
let tonos = 0;
let rampa: THREE.DataTexture | null = null;

function ponerTonos(n: number): void {
  tonos = n;
  if (n > 0) {
    // Una rampa nueva por cantidad de tonos (cambiarle el tamaño a una ya subida a la GPU no anda).
    const datos = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) datos.fill(Math.round(255 * (0.25 + (0.75 * i) / (n - 1))), i * 4, i * 4 + 4);
    rampa?.dispose();
    rampa = new THREE.DataTexture(datos, n, 1);
    rampa.minFilter = rampa.magFilter = THREE.NearestFilter;
    rampa.needsUpdate = true;
  }
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const estandar = (m.userData.estandar ?? m.material) as THREE.Material;
    if (!(estandar as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
    m.userData.estandar = estandar;
    if (n === 0) {
      m.material = estandar;
      return;
    }
    if (!m.userData.toon) {
      const e = estandar as THREE.MeshStandardMaterial;
      m.userData.toon = new THREE.MeshToonMaterial({
        color: e.color, map: e.map, emissive: e.emissive, emissiveMap: e.emissiveMap, emissiveIntensity: e.emissiveIntensity,
        transparent: e.transparent, opacity: e.opacity, side: e.side,
      });
    }
    (m.userData.toon as THREE.MeshToonMaterial).gradientMap = rampa;
    (m.userData.toon as THREE.MeshToonMaterial).needsUpdate = true;
    m.material = m.userData.toon;
  });
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  medirSucio();
});

// --- El protagonista ---

const jugador = new THREE.Group();
jugador.position.set(0, 0, 2);
scene.add(jugador);
let mirando = Math.PI; // hacia dónde mira (rotation.y); el modelo mira a +Z, los blancos están a -Z

const puesto: Record<Lugar, string | null> = { arriba: 'camperon_newells', abajo: 'pantalon_adidas', pies: 'jordan' };
const mallas = new Map<string, THREE.Object3D>();
let mixer: THREE.AnimationMixer | null = null;
const acciones = new Map<string, THREE.AnimationAction>();
let actual: THREE.AnimationAction | null = null;
let reposo = 'reposo_abierto';
let enfundar: THREE.AnimationAction | null = null;
let faldon: Faldon | null = null;
let pose: Pose | null = null;
let mezclaDedos = 0; // 0 relajada, 1 empuñando
let modelo: THREE.Object3D | null = null;
const espalda: THREE.Bone[] = [];

type Estado = 'libre' | 'sacando' | 'apuntando' | 'guardando';
let estado: Estado = 'libre';
let armada = false;

const REPOSOS: { clip: string; nombre: string }[] = [
  { clip: 'reposo', nombre: 'Zombie' },
  { clip: 'reposo_suave', nombre: 'Zombie, cuello suave' },
  { clip: 'reposo_orco', nombre: 'Orco' },
  { clip: 'reposo_abierto', nombre: 'Piernas abiertas' },
];

function pasarA(accion: THREE.AnimationAction | undefined | null, fundido = 0.25): void {
  if (!accion || accion === actual) return;
  accion.reset().play();
  if (actual) accion.crossFadeFrom(actual, fundido, false);
  actual = accion;
}

function vestir(): void {
  const puestas = new Set<string | null>(Object.values(puesto));
  if (armada) puestas.add('pistola');
  for (const [nombre, malla] of mallas) {
    // `ropa_<id>__<id>+<id>`: la parte de una prenda que tapan otras (lo del pantalón que queda
    // adentro del camperón) se esconde cuando alguna de ellas está puesta.
    if (nombre.startsWith('ropa_')) {
      const [id, tapan = ''] = nombre.slice(5).split('__');
      malla.visible = puestas.has(id) && !tapan.split('+').some((t) => puestas.has(t));
    }
    if (nombre.startsWith('cuerpo__')) malla.visible = !nombre.slice(8).split('+').some((id) => puestas.has(id));
  }
}

function armar(si: boolean): void {
  if (armada === si) return;
  armada = si;
  vestir();
}

// --- El panel ---

const panel = document.getElementById('panel')!;

function boton(texto: string, on: boolean, accion: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = texto;
  b.classList.toggle('on', on);
  b.onclick = accion;
  return b;
}

function titulo(texto: string): HTMLHeadingElement {
  const h = document.createElement('h2');
  h.textContent = texto;
  return h;
}

function pintarPanel(): void {
  panel.replaceChildren(titulo('Polígono'));
  panel.append(boton('Reponer latas y blancos', false, () => { poligono.reponer(); puntos = 0; tiros = 0; pintarHud(); }));
  const deslizador = (nombre: string, min: number, max: number, paso: number, actual: number, cambiar: (v: number) => void): void => {
    const fila = document.createElement('label');
    fila.className = 'ajuste';
    const texto = document.createElement('span');
    texto.textContent = `${nombre}: ${actual}`;
    const control = document.createElement('input');
    Object.assign(control, { type: 'range', min: String(min), max: String(max), step: String(paso), value: String(actual) });
    control.oninput = () => {
      cambiar(Number(control.value));
      texto.textContent = `${nombre}: ${control.value}`;
    };
    fila.append(texto, control);
    panel.append(fila);
  };
  for (const grupo of ['Tinta', 'Trama', 'Imagen']) {
    panel.append(titulo(grupo));
    if (grupo === 'Tinta') {
      const fila = document.createElement('div');
      fila.className = 'tonos';
      for (const [n, nombre] of [[0, 'Normal'], [2, '2 tonos'], [3, '3 tonos'], [4, '4 tonos']] as const) {
        fila.append(boton(nombre, tonos === n, () => { ponerTonos(n); pintarPanel(); }));
      }
      panel.append(fila);
    }
    for (const a of AJUSTES.filter((x) => x.grupo === grupo)) {
      deslizador(a.nombre, a.min, a.max, a.paso, a.valor, (v) => ajustar(sucio, a.id, v));
    }
  }
  panel.append(titulo('Farolas'));
  deslizador('Conos de luz', 0, 2, 0.05, FAROLAS.conos, (v) => { FAROLAS.conos = v; conos.intensidad = v; });
  deslizador('Polvo', 0, 1.5, 0.05, FAROLAS.polvo, (v) => { FAROLAS.polvo = v; conos.polvo = v; });
  panel.append(titulo('Conjuntos'));
  for (const c of CONJUNTOS) {
    const igual = LUGARES.every((l) => puesto[l.id] === (c.prendas.find((id) => PRENDAS.find((p) => p.id === id)?.lugar === l.id) ?? null));
    panel.append(boton(c.nombre, igual, () => {
      for (const l of LUGARES) puesto[l.id] = null;
      for (const id of c.prendas) {
        const p = PRENDAS.find((x) => x.id === id);
        if (p) puesto[p.lugar] = p.id;
      }
      vestir();
      pintarPanel();
    }));
  }
  panel.append(titulo('Reposo'));
  for (const r of REPOSOS.filter((x) => acciones.has(x.clip))) {
    panel.append(boton(r.nombre, reposo === r.clip, () => { reposo = r.clip; pintarPanel(); }));
  }
  for (const l of LUGARES) {
    panel.append(titulo(l.nombre));
    panel.append(boton('Nada', puesto[l.id] === null, () => { puesto[l.id] = null; vestir(); pintarPanel(); }));
    for (const p of PRENDAS.filter((x) => x.lugar === l.id)) {
      panel.append(boton(p.nombre, puesto[l.id] === p.id, () => { puesto[l.id] = p.id; vestir(); pintarPanel(); }));
    }
  }
}

// --- Mira y puntaje ---

const mira = document.getElementById('mira')!;
const hud = document.getElementById('hud')!;
let puntos = 0;
let tiros = 0;
let ultimo = '';

function pintarHud(): void {
  hud.textContent = `Puntos ${puntos} · Tiros ${tiros}${ultimo ? ` · ${ultimo}` : ''}`;
}

// --- Controles ---

const teclas = new Set<string>();
let yaw = 0;
let pitch = -0.08;
let bloqueado = false;
let disparoPendiente = false;

addEventListener('keydown', (e) => {
  teclas.add(e.code);
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) alternarArma();
});
addEventListener('keyup', (e) => teclas.delete(e.code));
addEventListener('blur', () => teclas.clear());

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!bloqueado) {
    renderer.domElement.requestPointerLock();
    return;
  }
  if (e.button === 0) disparoPendiente = true;
});
document.addEventListener('pointerlockchange', () => {
  bloqueado = document.pointerLockElement === renderer.domElement;
  document.body.classList.toggle('jugando', bloqueado);
});
document.addEventListener('mousemove', (e) => {
  if (!bloqueado) return;
  const k = estado === 'apuntando' ? 0.0016 : 0.0025;
  yaw -= e.movementX * k;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * k, -1.1, 0.7);
});

function alternarArma(): void {
  if (!enfundar) return;
  if (estado === 'libre') {
    // Sacarla: el clip de guardarla, al revés.
    estado = 'sacando';
    enfundar.timeScale = -SACAR_RITMO;
    pasarA(enfundar, 0.2);
    enfundar.time = enfundar.getClip().duration;
  } else if (estado === 'apuntando') {
    estado = 'guardando';
    enfundar.timeScale = GUARDAR_RITMO;
    pasarA(enfundar, 0.15);
    enfundar.time = 0;
  }
}

// --- El modelo ---

new GLTFLoader().load(`${import.meta.env.BASE_URL}models/protagonista.glb`, (gltf) => {
  modelo = gltf.scene;
  modelo.scale.setScalar(ALTO);
  modelo.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      mallas.set(o.name, o);
      o.frustumCulled = false;
      o.castShadow = true;
    }
    if ((o as THREE.Bone).isBone && (o.name === 'Spine01' || o.name === 'Spine02')) espalda.push(o as THREE.Bone);
  });
  jugador.add(modelo);
  if (tonos) ponerTonos(tonos);
  const pistola = mallas.get('ropa_pistola');
  if (pistola) aplicarAgarre(pistola);
  jugador.updateMatrixWorld(true);
  faldon = new Faldon(modelo);
  pose = new Pose(modelo);
  mixer = new THREE.AnimationMixer(modelo);
  for (const clip of gltf.animations) acciones.set(clip.name, mixer.clipAction(clip));
  for (const nombre of Object.keys(CAMINATAS) as (keyof typeof CAMINATAS)[]) {
    acciones.get(nombre)?.setEffectiveTimeScale(CAMINATAS[nombre].ritmo);
  }
  const guardar = THREE.AnimationClip.findByName(gltf.animations, 'pistola_guardar');
  if (guardar) {
    const parte = THREE.AnimationUtils.subclip(guardar, 'enfundar', GUARDAR.desde, GUARDAR.hasta, GUARDAR.fps);
    enfundar = mixer.clipAction(parte);
    enfundar.setLoop(THREE.LoopOnce, 1);
    enfundar.clampWhenFinished = true;
  }
  pasarA(acciones.get(reposo), 0);
  vestir();
  pintarPanel();
});

pintarPanel();
pintarHud();

function velocidad(clip: keyof typeof CAMINATAS): number {
  const a = acciones.get(clip);
  if (!a) return 1.5;
  return (2 * CAMINATAS[clip].paso * ALTO * CAMINATAS[clip].ritmo) / a.getClip().duration;
}

function anguloHacia(desde: number, hacia: number, k: number): number {
  const d = Math.atan2(Math.sin(hacia - desde), Math.cos(hacia - desde));
  return desde + d * Math.min(1, k);
}


// Apuntando, el caño va a donde está la mira: la captura apunta a donde apuntaba su actor y la
// cámara está al hombro (la espalda ya viene destorcida de tools/blender/vestir.py). El cuerpo gira
// lo que le falta de lado (de a poco, queda para el cuadro siguiente) y la espalda se dobla lo que
// falta de arriba abajo.
const ARRIBA = new THREE.Vector3(0, 1, 0);

function girarEnMundo(hueso: THREE.Bone, giro: THREE.Quaternion): void {
  if (!hueso.parent) return;
  const padre = hueso.parent.getWorldQuaternion(new THREE.Quaternion());
  hueso.quaternion.premultiply(padre.clone().invert().multiply(giro).multiply(padre));
  hueso.updateMatrixWorld(true);
}

let giroApunte = 0;
let mezclaApunte = 0;
let dobleEspalda = 0;
const EJE_X = new THREE.Vector3(-1, 0, 0); // hacia la boca, en la malla de la pistola
function apuntarCaño(dt: number): void {
  mezclaApunte = THREE.MathUtils.damp(mezclaApunte, estado === 'apuntando' ? 1 : 0, 6, dt);
  const pistola = mallas.get('ropa_pistola');
  if (!pistola || mezclaApunte < 0.01) return;
  pistola.updateWorldMatrix(true, false);
  const desde = BOCA.clone().applyMatrix4(pistola.matrixWorld);
  const caño = EJE_X.clone().transformDirection(pistola.matrixWorld);
  const mirada = camera.getWorldDirection(new THREE.Vector3());
  const blanco = poligono.alcance(camera.position, mirada);
  const quiere = blanco.sub(desde).normalize();
  const lado = Math.atan2(quiere.x, quiere.z) - Math.atan2(caño.x, caño.z);
  giroApunte = THREE.MathUtils.clamp(giroApunte + Math.atan2(Math.sin(lado), Math.cos(lado)) * Math.min(1, dt * 10), -1.5, 1.5);
  const alto = Math.asin(THREE.MathUtils.clamp(quiere.y, -1, 1)) - Math.asin(THREE.MathUtils.clamp(caño.y, -1, 1));
  dobleEspalda = THREE.MathUtils.damp(dobleEspalda, alto, 12, dt);
  const eje = new THREE.Vector3(caño.x, 0, caño.z).normalize().cross(ARRIBA).normalize();
  for (const hueso of espalda) {
    girarEnMundo(hueso, new THREE.Quaternion().setFromAxisAngle(eje, (dobleEspalda * mezclaApunte) / espalda.length));
  }
}

let enfriamiento = 0;
let retroceso = 0;
let mezclaCamara = 0; // 0 libre, 1 apuntando
const boca = new THREE.Vector3();

function disparar(): void {
  tiros++;
  const origen = camera.position.clone();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const pistola = mallas.get('ropa_pistola');
  if (pistola) {
    pistola.updateWorldMatrix(true, false);
    boca.copy(BOCA).applyMatrix4(pistola.matrixWorld);
    fogonazo.disparar(boca, new THREE.Vector3(-1, 0, 0).transformDirection(pistola.matrixWorld));
    const ventana = EXPULSION.clone().applyMatrix4(pistola.matrixWorld);
    const sale = EXPULSION_DIR.clone().transformDirection(pistola.matrixWorld);
    sale.x += (Math.random() - 0.5) * 0.25;
    sale.z += (Math.random() - 0.5) * 0.25;
    poligono.vaina(ventana, sale.normalize().multiplyScalar(VAINA_VELOCIDAD * (0.85 + Math.random() * 0.3)));
  }
  const hit = poligono.disparar(origen, dir);
  if (hit) {
    if (pistola) poligono.trazo(boca, hit.punto);
    puntos += hit.puntos;
    ultimo = hit.que === 'lata' ? '¡Lata!' : hit.que === 'blanco' ? `Blanco +${hit.puntos}` : '';
  } else {
    ultimo = '';
  }
  pintarHud();
  retroceso = 1;
  pitch = Math.min(0.7, pitch + 0.015);
}

const reloj = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(reloj.getDelta(), 0.05);

  // Hacia dónde camina, respecto de la cámara.
  const adelante = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const derecha = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const quiere = new THREE.Vector3();
  if (teclas.has('KeyW')) quiere.add(adelante);
  if (teclas.has('KeyS')) quiere.sub(adelante);
  if (teclas.has('KeyD')) quiere.add(derecha);
  if (teclas.has('KeyA')) quiere.sub(derecha);
  const mueve = quiere.lengthSq() > 0 && (estado === 'libre' || estado === 'apuntando');
  if (mueve) quiere.normalize();

  if (estado === 'libre') {
    if (mueve) {
      jugador.position.addScaledVector(quiere, velocidad('caminata') * dt);
      mirando = anguloHacia(mirando, Math.atan2(quiere.x, quiere.z), dt * 10);
      pasarA(acciones.get('caminata'));
    } else {
      pasarA(acciones.get(reposo));
    }
  } else if (estado === 'apuntando') {
    // Apuntando mira siempre a donde mira la cámara; camina en cualquier dirección.
    mirando = anguloHacia(mirando, yaw + Math.PI, dt * 20);
    if (mueve) {
      jugador.position.addScaledVector(quiere, velocidad('pistola_caminata') * dt);
      const caminata = acciones.get('pistola_caminata');
      const atras = quiere.dot(adelante) < -0.3;
      caminata?.setEffectiveTimeScale(CAMINATAS.pistola_caminata.ritmo * (atras ? -1 : 1));
      pasarA(caminata, 0.15);
    } else {
      pasarA(acciones.get('pistola_reposo'), 0.15);
    }
    enfriamiento -= dt;
    if (disparoPendiente && enfriamiento <= 0) {
      disparar();
      enfriamiento = CADENCIA;
    }
  } else if (enfundar) {
    // Sacándola o guardándola: quieto, la pistola aparece o desaparece al pasar por la funda.
    mirando = anguloHacia(mirando, yaw + Math.PI, dt * 8);
    const funda = (GUARDAR.funda - GUARDAR.desde) / GUARDAR.fps;
    armar(enfundar.time < funda);
    const fin = enfundar.getClip().duration;
    if (estado === 'sacando' && enfundar.time <= 0.001) estado = 'apuntando';
    if (estado === 'guardando' && enfundar.time >= fin - 0.001) estado = 'libre';
  }
  disparoPendiente = false;
  jugador.rotation.y = mirando + giroApunte * mezclaApunte;
  pose?.antes(posesHuesos.relajada, posesHuesos.pistola);
  mixer?.update(dt);
  jugador.updateMatrixWorld(true);
  faldon?.colgar();
  mezclaDedos = THREE.MathUtils.damp(mezclaDedos, armada ? 1 : 0, 14, dt);
  pose?.aplicar(posesHuesos.relajada, posesHuesos.pistola, mezclaDedos);
  apuntarCaño(dt);

  // La cámara: detrás y arriba; apuntando, cerca del hombro derecho.
  mezclaCamara = THREE.MathUtils.damp(mezclaCamara, estado === 'apuntando' || estado === 'sacando' ? 1 : 0, 8, dt);
  const a = CAMARA.libre;
  const b = CAMARA.apuntando;
  const m = mezclaCamara;
  const alto = THREE.MathUtils.lerp(a.alto, b.alto, m);
  const distancia = THREE.MathUtils.lerp(a.distancia, b.distancia, m);
  const hombro = THREE.MathUtils.lerp(a.hombro, b.hombro, m);
  const fov = THREE.MathUtils.lerp(a.fov, b.fov, m);
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  retroceso = Math.max(0, retroceso - dt * 10);
  const mirada = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const foco = jugador.position.clone().add(new THREE.Vector3(0, alto, 0)).addScaledVector(derecha, hombro);
  camera.position.copy(foco).addScaledVector(mirada, -distancia);
  camera.position.y = Math.max(0.2, camera.position.y);
  camera.lookAt(foco.clone().addScaledVector(mirada, 10));
  if (retroceso > 0) camera.rotateX(retroceso * 0.01);

  mira.classList.toggle('visible', estado === 'apuntando');
  sol.position.copy(jugador.position).add(new THREE.Vector3(8, 15, 6));
  sol.target.position.copy(jugador.position);

  poligono.actualizar(dt);
  fogonazo.actualizar(dt);
  sucio.uniforms.tiempo.value += dt;
  conos.actualizar(sucio.uniforms.tiempo.value);
  pintarNormales();
  composer.render();
});
