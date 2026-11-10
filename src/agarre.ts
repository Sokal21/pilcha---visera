import * as THREE from 'three';
import guardado from './agarre.json';

// Cómo va la pistola en la mano: su posición, giro y escala respecto del hueso de la mano derecha
// (el nodo del que cuelga en el GLB). Lo acomoda a mano armero.html y lo guarda en agarre.json;
// vacío, queda como la puso tools/blender/vestir.py.

export interface Agarre {
  posicion: [number, number, number];
  giro: [number, number, number, number];
  escala: [number, number, number];
}

export const agarre = guardado as Partial<Agarre>;

export function aplicarAgarre(pistola: THREE.Object3D, a: Partial<Agarre> = agarre): void {
  if (a.posicion) pistola.position.fromArray(a.posicion);
  if (a.giro) pistola.quaternion.fromArray(a.giro);
  if (a.escala) pistola.scale.fromArray(a.escala);
}

export function leerAgarre(pistola: THREE.Object3D): Agarre {
  return {
    posicion: pistola.position.toArray() as Agarre['posicion'],
    giro: pistola.quaternion.toArray() as Agarre['giro'],
    escala: pistola.scale.toArray() as Agarre['escala'],
  };
}
