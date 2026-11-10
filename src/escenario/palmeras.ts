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

/** Las palmeras en `lugares` (metros x, z). Se arman cuando termina de cargar el modelo; sus mallas
 * se suman entonces a `solidos` (contra lo que pegan los tiros). */
export function armarPalmeras(lugares: THREE.Vector2[], semilla: number, solidos: THREE.Object3D[]): THREE.Group {
  const grupo = new THREE.Group();
  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/palmera.glb`, (gltf) => {
    const r = azar(semilla);
    const matrices = lugares.map((lugar) => {
      const alto = THREE.MathUtils.lerp(ALTO.desde, ALTO.hasta, r());
      const giro = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
      return new THREE.Matrix4().compose(new THREE.Vector3(lugar.x, -ENTERRADA * alto, lugar.y), giro, new THREE.Vector3(alto, alto, alto));
    });
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const malla = o as THREE.Mesh;
      if (!malla.isMesh) return;
      const geo = malla.geometry.clone().applyMatrix4(malla.matrixWorld);
      const inst = new THREE.InstancedMesh(geo, malla.material, matrices.length);
      matrices.forEach((mt, i) => inst.setMatrixAt(i, mt));
      inst.castShadow = inst.receiveShadow = true;
      grupo.add(inst);
      solidos.push(inst);
    });
  });
  return grupo;
}
