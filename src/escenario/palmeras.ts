import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Las palmeras del City Center son canarias (Phoenix canariensis), como en las fotos: el modelo de
// Tripo (public/models/palmera.glb, del concepto de SpriteCook; una unidad de alto, parado en el
// origen) en una malla instanciada, cada una con su alto y su giro, siempre iguales (semilla).

const ALTO = { desde: 12, hasta: 16 };
// El modelo termina abajo en una punta redondeada: hasta el 4 % de su alto el tronco no tiene todavía
// su ancho (medido sobre el modelo). Va enterrado eso.
const ENTERRADA = 0.04;
/** Radio del tronco para chocar. */
export const RADIO_PALMERA = 0.7;
// El viento: toda la palmera se inclina un poco más cuanto más arriba (en el modelo, de 0 a 1 de
// alto), con dos vaivenes lentos superpuestos, y las hojas tiemblan más rápido. Cada una a su ritmo
// (la fase sale de dónde está). En la placa de video; el tiempo lo pone `vientoPalmeras`.
const VIENTO = { inclina: 0.012, tiembla: 0.006 };
const tiempoViento = { value: 0 };

/** Cada cuadro, con el tiempo en segundos. */
export function vientoPalmeras(t: number): void {
  tiempoViento.value = t;
}

function conViento(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tiempoViento = tiempoViento;
    shader.vertexShader = 'uniform float tiempoViento;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float altura = clamp(position.y, 0.0, 1.0);
      vec2 base = vec2(0.0);
      #ifdef USE_INSTANCING
        base = instanceMatrix[3].xz;
      #endif
      float fase = dot(base, vec2(0.37, 0.71));
      float vaiven = sin(tiempoViento * 0.9 + fase) * 0.65 + sin(tiempoViento * 2.1 + fase * 1.7) * 0.35;
      float copa = smoothstep(0.55, 1.0, altura);
      transformed.x += vaiven * ${VIENTO.inclina} * altura * altura + copa * sin(tiempoViento * 3.1 + fase + position.x * 25.0) * ${VIENTO.tiembla};
      transformed.z += vaiven * ${VIENTO.inclina * 0.6} * altura * altura + copa * cos(tiempoViento * 2.7 + fase + position.z * 25.0) * ${VIENTO.tiembla};`);
  };
  material.customProgramCacheKey = () => 'palmera-viento';
}

function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Las palmeras en `lugares` (metros x, z). Se arman cuando terminan de cargar los modelos; sus
 * mallas se suman entonces a `solidos` (contra lo que pegan los tiros). La sombra no la hace el modelo
 * (6000 triángulos por palmera dibujados otra vez para la sombra: medido en el navegador, bajaba el
 * juego de 60 a 40 por segundo) sino una versión de 600 (public/models/palmera_sombra.glb) que no se
 * ve; esa va a `transparentes` (fuera de la pasada de normales del contorno). */
export function armarPalmeras(lugares: THREE.Vector2[], semilla: number, solidos: THREE.Object3D[], transparentes: THREE.Object3D[]): THREE.Group {
  const grupo = new THREE.Group();
  const r = azar(semilla);
  const matrices = lugares.map((lugar) => {
    const alto = THREE.MathUtils.lerp(ALTO.desde, ALTO.hasta, r());
    const giro = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
    return new THREE.Matrix4().compose(new THREE.Vector3(lugar.x, -ENTERRADA * alto, lugar.y), giro, new THREE.Vector3(alto, alto, alto));
  });
  const instanciar = (gltf: { scene: THREE.Object3D }, armar: (geo: THREE.BufferGeometry, material: THREE.Material) => THREE.InstancedMesh) => {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const malla = o as THREE.Mesh;
      if (!malla.isMesh) return;
      const inst = armar(malla.geometry.clone().applyMatrix4(malla.matrixWorld), malla.material as THREE.Material);
      matrices.forEach((mt, i) => inst.setMatrixAt(i, mt));
      grupo.add(inst);
    });
  };
  const cargador = new GLTFLoader();
  cargador.load(`${import.meta.env.BASE_URL}models/palmera.glb`, (gltf) => instanciar(gltf, (geo, original) => {
    const material = original.clone();
    // De los dos lados: las hojas del modelo son finas y de atrás se veían huecas.
    material.side = THREE.DoubleSide;
    conViento(material);
    const inst = new THREE.InstancedMesh(geo, material, matrices.length);
    inst.receiveShadow = true;
    solidos.push(inst);
    return inst;
  }));
  cargador.load(`${import.meta.env.BASE_URL}models/palmera_sombra.glb`, (gltf) => instanciar(gltf, (geo) => {
    // No se ve (no pinta ni escribe profundidad): solo hace la sombra, meciéndose igual que la palmera.
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), matrices.length);
    const sombra = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    conViento(sombra);
    inst.customDepthMaterial = sombra;
    inst.castShadow = true;
    transparentes.push(inst);
    return inst;
  }));
  return grupo;
}
