import * as THREE from 'three';
import guardadas from './huesos.json';

// Ajustes de huesos por pose, que se acomodan a mano en armero.html: cuánto se gira y cuánto se
// corre cada hueso. A los que la animación mueve (la muñeca) se les suma encima; a los que ninguna
// animación mueve (los dedos, que agrega tools/blender/dedos.py), desde su reposo. "relajada" sin
// arma, "pistola" con ella. En huesos.json: { giro: [x, y, z, w], mover: [x, y, z] }, en los ejes
// del padre del hueso (un cuaternión suelto, como se guardaba antes, es solo el giro).

export interface Ajuste {
  giro?: [number, number, number, number];
  mover?: [number, number, number];
}
export type Ajustes = Record<string, Ajuste>;
export type PosesHuesos = { relajada: Ajustes; pistola: Ajustes };
export type NombrePose = keyof PosesHuesos;

function leer(crudo: Record<string, unknown>): Ajustes {
  const out: Ajustes = {};
  for (const [nombre, v] of Object.entries(crudo)) {
    out[nombre] = Array.isArray(v) ? { giro: v as Ajuste['giro'] } : (v as Ajuste);
  }
  return out;
}

const crudas = guardadas as unknown as Record<NombrePose, Record<string, unknown>>;
export const posesHuesos: PosesHuesos = { relajada: leer(crudas.relajada ?? {}), pistola: leer(crudas.pistola ?? {}) };

export class Pose {
  private readonly huesos = new Map<string, THREE.Bone>();
  private readonly reposo = new Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  /** Cómo estaba cada hueso antes del ajuste, en el último cuadro (para medir el ajuste al moverlo a mano). */
  readonly base = new Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>();

  constructor(modelo: THREE.Object3D) {
    modelo.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        this.huesos.set(o.name, o as THREE.Bone);
        this.reposo.set(o.name, { q: o.quaternion.clone(), p: o.position.clone() });
      }
    });
  }

  hueso(nombre: string): THREE.Bone | undefined {
    return this.huesos.get(nombre);
  }

  /** Antes de animar el cuadro: los huesos con ajuste vuelven a su reposo (los que la animación
   * mueve los pisa enseguida; los otros, si no, acumularían el ajuste cuadro tras cuadro). */
  antes(...poses: Ajustes[]): void {
    for (const pose of poses) {
      for (const nombre of Object.keys(pose)) {
        const r = this.reposo.get(nombre);
        const h = this.huesos.get(nombre);
        if (r && h) {
          h.quaternion.copy(r.q);
          h.position.copy(r.p);
        }
      }
    }
  }

  /** Después de animar: suma los ajustes de `a` (o entre `a` y `b`, `mezcla` de 0 a 1 hacia `b`). */
  aplicar(a: Ajustes, b?: Ajustes, mezcla = 0): void {
    const nombres = new Set([...Object.keys(a), ...Object.keys(b ?? {})]);
    for (const nombre of nombres) {
      const hueso = this.huesos.get(nombre);
      if (!hueso) continue;
      this.base.set(nombre, { q: hueso.quaternion.clone(), p: hueso.position.clone() });
      const qa = new THREE.Quaternion().fromArray(a[nombre]?.giro ?? [0, 0, 0, 1]);
      const qb = new THREE.Quaternion().fromArray(b?.[nombre]?.giro ?? [0, 0, 0, 1]);
      hueso.quaternion.multiply(qa.slerp(qb, mezcla));
      const pa = new THREE.Vector3().fromArray(a[nombre]?.mover ?? [0, 0, 0]);
      const pb = new THREE.Vector3().fromArray(b?.[nombre]?.mover ?? [0, 0, 0]);
      hueso.position.add(pa.lerp(pb, mezcla));
    }
  }

  /** El ajuste que lleva el hueso ahora, respecto de cómo lo dejó la animación. */
  medir(nombre: string): Ajuste | null {
    const hueso = this.huesos.get(nombre);
    if (!hueso) return null;
    const base = this.base.get(nombre) ?? this.reposo.get(nombre)!;
    const giro = base.q.clone().invert().multiply(hueso.quaternion);
    const mover = hueso.position.clone().sub(base.p);
    return { giro: giro.toArray() as Ajuste['giro'], mover: mover.toArray() as Ajuste['mover'] };
  }
}
