import * as THREE from 'three';

// El faldón del camperón cuelga, gire como gire la cadera: su hueso (Faldon, que agrega
// tools/blender/vestir.py) apunta casi derecho para abajo, un poco (RODILLAS) hacia las rodillas.
// Derecho del todo, agachado le quedaba una punta atrás. Lo usan el juego y fotogramas.html.

const RODILLAS = 0.25;

export class Faldon {
  private hueso: THREE.Bone | null = null;
  private readonly rodillas: THREE.Bone[] = [];
  private readonly reposo = new THREE.Quaternion(); // su giro respecto del modelo, en reposo

  /** `modelo` en su pose de reposo, con las matrices del mundo al día. */
  constructor(private readonly modelo: THREE.Object3D) {
    modelo.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      if (o.name === 'Faldon') this.hueso = o as THREE.Bone;
      if (o.name === 'L_Calf' || o.name === 'R_Calf') this.rodillas.push(o as THREE.Bone);
    });
    if (this.hueso) {
      const qm = modelo.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.reposo.copy(qm.multiply(this.hueso.getWorldQuaternion(new THREE.Quaternion())));
    }
  }

  /** Después de animar el cuadro (y de poner al día las matrices del mundo). */
  colgar(): void {
    const hueso = this.hueso;
    if (!hueso?.parent) return;
    const reposoMundo = this.modelo.getWorldQuaternion(new THREE.Quaternion()).multiply(this.reposo);
    const cabeza = hueso.getWorldPosition(new THREE.Vector3());
    const quiere = new THREE.Vector3(0, -1, 0);
    if (this.rodillas.length === 2) {
      const medio = this.rodillas[0].getWorldPosition(new THREE.Vector3()).add(this.rodillas[1].getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
      quiere.multiplyScalar(1 - RODILLAS).addScaledVector(medio.sub(cabeza).normalize(), RODILLAS).normalize();
    }
    const eje = new THREE.Vector3(0, 1, 0).applyQuaternion(reposoMundo); // el hueso apunta por su +Y
    const giro = new THREE.Quaternion().setFromUnitVectors(eje, quiere).multiply(reposoMundo);
    const padre = hueso.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    hueso.quaternion.copy(padre.multiply(giro));
    hueso.updateMatrixWorld(true);
  }
}
