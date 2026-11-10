import * as THREE from 'three';
import { caraVidriera } from './hotel';

// La entrada bajo la marquesina, como en la foto de día: una vidriera alta de punta a punta y, en el
// medio, un hall de verdad detrás del vidrio (piso de piedra, cielorraso iluminado, el mostrador
// redondo de recepción), con dos puertas corredizas que se abren solas cuando el jugador se acerca.
// Se puede entrar al hall. El bloque central tiene la muesca del hall en el plano (city-center.json).

const VIDRIO = { color: 0x9fb4c8, opacidad: 0.2 };
const MARCO = 0x5d6066;
const PUERTA = { ancho: 2.4, alto: 2.8, corre: 1.1, abre: 3.5, velocidad: 3 };
const TRAVESAÑO = 3.4;
const CIELORRASO = 4.5;
const MODULO = 2; // entre parantes

export interface Entrada {
  /** Dónde está la fachada (x) y de dónde a dónde va (z). */
  x: number;
  desde: number;
  hasta: number;
  alto: number;
  /** El hall, en el medio: de dónde a dónde (z) y cuánto se mete (x). */
  hall: { desde: number; hasta: number; fondo: number };
}

interface Puerta {
  z: number;
  hojas: THREE.Object3D[];
  abierta: number;
}

/** Un rectángulo (x, z) como polígono de choque. */
function caja(x0: number, x1: number, z0: number, z1: number): THREE.Vector2[] {
  return [new THREE.Vector2(x0, z0), new THREE.Vector2(x1, z0), new THREE.Vector2(x1, z1), new THREE.Vector2(x0, z1)];
}

export function armarEntrada(e: Entrada) {
  const grupo = new THREE.Group();
  const solidos: THREE.Object3D[] = [];
  const transparentes: THREE.Object3D[] = [];
  const paredes: THREE.Vector2[][] = [];
  const marco = new THREE.MeshStandardMaterial({ color: MARCO, metalness: 0.6, roughness: 0.4 });
  const vidrio = new THREE.MeshStandardMaterial({
    color: VIDRIO.color, transparent: true, opacity: VIDRIO.opacidad, roughness: 0.05, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide,
  });
  const barra = (x: number, y: number, z: number, ax: number, ay: number, az: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(ax, ay, az), marco);
    b.position.set(x, y, z);
    b.castShadow = true;
    grupo.add(b);
    return b;
  };

  // A los costados del hall, vidriera con el bloque detrás (pintada, con la luz de adentro).
  for (const [z0, z1] of [[e.desde, e.hall.desde], [e.hall.hasta, e.hasta]]) {
    const ancho = z1 - z0;
    const tx = caraVidriera(ancho, e.alto);
    const cara = new THREE.Mesh(new THREE.PlaneGeometry(ancho, e.alto), new THREE.MeshStandardMaterial({ ...tx, emissive: 0xffffff, roughness: 0.6 }));
    cara.rotation.y = -Math.PI / 2; // de cara a la calle (-x)
    cara.position.set(e.x - 0.03, e.alto / 2, (z0 + z1) / 2);
    cara.receiveShadow = true;
    grupo.add(cara);
  }

  // El hall: piso, cielorraso con luz, el bloque encima (la muesca dejaba el techo abierto), la pared
  // del fondo y el mostrador redondo.
  const { desde: h0, hasta: h1, fondo } = e.hall;
  const xFondo = e.x + fondo;
  const anchoHall = h1 - h0;
  const medio = (h0 + h1) / 2;
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(fondo, anchoHall), new THREE.MeshStandardMaterial({ color: 0xd9d3c8, roughness: 0.35 }));
  piso.rotation.x = -Math.PI / 2;
  piso.position.set(e.x + fondo / 2, 0.015, medio);
  piso.receiveShadow = true;
  grupo.add(piso);
  const cielo = new THREE.Mesh(new THREE.PlaneGeometry(fondo, anchoHall), new THREE.MeshStandardMaterial({
    color: 0xf3ead8, emissive: 0xffe2b0, emissiveIntensity: 0.55,
  }));
  cielo.rotation.x = Math.PI / 2; // mirando para abajo
  cielo.position.set(e.x + fondo / 2, CIELORRASO, medio);
  grupo.add(cielo);
  const encima = new THREE.Mesh(new THREE.BoxGeometry(fondo, e.alto - CIELORRASO, anchoHall), new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.9 }));
  encima.position.set(e.x + fondo / 2, (CIELORRASO + e.alto) / 2 + 0.001, medio);
  encima.castShadow = true;
  grupo.add(encima);
  const fondoMat = new THREE.MeshStandardMaterial({ color: 0xa8774a, emissive: 0x6b3f1c, emissiveIntensity: 0.35, roughness: 0.7 });
  const paredFondo = new THREE.Mesh(new THREE.PlaneGeometry(anchoHall, CIELORRASO), fondoMat);
  paredFondo.rotation.y = -Math.PI / 2;
  paredFondo.position.set(xFondo - 0.02, CIELORRASO / 2, medio);
  grupo.add(paredFondo);
  solidos.push(paredFondo);
  const mostrador = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 1.1, 40), new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.4 }));
  mostrador.position.set(e.x + fondo * 0.6, 0.55, medio);
  mostrador.castShadow = mostrador.receiveShadow = true;
  grupo.add(mostrador);
  solidos.push(mostrador);
  const borde = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.04, 8, 48), new THREE.MeshStandardMaterial({
    color: 0xffd9a0, emissive: 0xffc070, emissiveIntensity: 1.2,
  }));
  borde.rotation.x = Math.PI / 2;
  borde.position.set(mostrador.position.x, 1.1, medio);
  grupo.add(borde);
  // Una luz cálida adentro: ilumina al jugador en el hall y se derrama por el vidrio.
  const luz = new THREE.PointLight(0xffd6a0, 40, 16, 2);
  luz.position.set(e.x + fondo / 2, CIELORRASO - 0.4, medio);
  grupo.add(luz);
  const bordeMostrador = new THREE.Vector2(mostrador.position.x, medio);

  // El frente del hall: vidrio de piso a techo entre parantes, con dos puertas corredizas.
  const puertas: Puerta[] = [];
  const zPuertas = [medio - 2, medio + 2];
  const frente = new THREE.Mesh(new THREE.PlaneGeometry(anchoHall, e.alto - PUERTA.alto), vidrio);
  frente.rotation.y = -Math.PI / 2;
  frente.position.set(e.x, (PUERTA.alto + e.alto) / 2, medio);
  grupo.add(frente);
  transparentes.push(frente);
  // Abajo, vidrio fijo salvo los vanos de las puertas.
  const cortes = [h0, ...zPuertas.flatMap((z) => [z - PUERTA.ancho / 2, z + PUERTA.ancho / 2]), h1];
  for (let i = 0; i < cortes.length; i += 2) {
    const [z0, z1] = [cortes[i], cortes[i + 1]];
    const fijo = new THREE.Mesh(new THREE.PlaneGeometry(z1 - z0, PUERTA.alto), vidrio);
    fijo.rotation.y = -Math.PI / 2;
    fijo.position.set(e.x, PUERTA.alto / 2, (z0 + z1) / 2);
    grupo.add(fijo);
    transparentes.push(fijo);
    paredes.push(caja(e.x - 0.12, e.x + 0.12, z0, z1));
  }
  for (let z = h0; z <= h1 + 0.01; z += MODULO) {
    if (zPuertas.some((zp) => Math.abs(z - zp) < PUERTA.ancho / 2 + 0.05)) continue;
    barra(e.x, e.alto / 2, z, 0.12, e.alto, 0.08);
  }
  barra(e.x, PUERTA.alto + 0.04, medio, 0.14, 0.1, anchoHall);
  barra(e.x, TRAVESAÑO + 1.2, medio, 0.12, 0.08, anchoHall);
  barra(e.x, e.alto - 0.06, medio, 0.14, 0.12, anchoHall);
  for (const zp of zPuertas) {
    // Las jambas y dos hojas de vidrio con marco que corren hacia los costados.
    barra(e.x, PUERTA.alto / 2, zp - PUERTA.ancho / 2, 0.14, PUERTA.alto, 0.1);
    barra(e.x, PUERTA.alto / 2, zp + PUERTA.ancho / 2, 0.14, PUERTA.alto, 0.1);
    const hojas = [-1, 1].map((lado) => {
      const hoja = new THREE.Group();
      const ancho = PUERTA.ancho / 2;
      const cristal = new THREE.Mesh(new THREE.PlaneGeometry(ancho - 0.08, PUERTA.alto - 0.1), vidrio);
      cristal.rotation.y = -Math.PI / 2;
      hoja.add(cristal);
      transparentes.push(cristal);
      for (const [y, h] of [[PUERTA.alto / 2 - 0.03, 0.06], [-PUERTA.alto / 2 + 0.05, 0.1]] as const) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, ancho), marco);
        b.position.y = y;
        hoja.add(b);
      }
      for (const dz of [-ancho / 2 + 0.03, ancho / 2 - 0.03]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, PUERTA.alto, 0.06), marco);
        b.position.z = dz;
        hoja.add(b);
      }
      hoja.position.set(e.x - 0.08, PUERTA.alto / 2, zp + (lado * ancho) / 2);
      hoja.userData.cerrada = hoja.position.z;
      hoja.userData.lado = lado;
      grupo.add(hoja);
      return hoja;
    });
    puertas.push({ z: zp, hojas, abierta: 0 });
  }

  let antes = -1;
  return {
    grupo, solidos, transparentes,
    /** Las paredes fijas del frente (las del hall son las de la muesca del bloque, en el plano). */
    paredes,
    /** Cada cuadro: las puertas se abren con el jugador cerca y se cierran cuando se va. */
    actualizar(t: number, jugador: THREE.Vector3): void {
      const dt = antes < 0 ? 0 : Math.min(0.1, t - antes);
      antes = t;
      for (const p of puertas) {
        const cerca = Math.hypot(jugador.x - e.x, jugador.z - p.z) < PUERTA.abre;
        p.abierta = THREE.MathUtils.clamp(p.abierta + (cerca ? 1 : -1) * dt * PUERTA.velocidad, 0, 1);
        const corre = THREE.MathUtils.smootherstep(p.abierta, 0, 1) * PUERTA.corre;
        for (const h of p.hojas) h.position.z = h.userData.cerrada + h.userData.lado * corre;
      }
    },
    /** Si (x, z) choca con el mostrador o con una puerta que no está bien abierta. */
    bloquea(x: number, z: number, radio: number): boolean {
      if (Math.hypot(x - bordeMostrador.x, z - bordeMostrador.y) < 1.7 + radio) return true;
      return puertas.some((p) => p.abierta < 0.8 && Math.abs(x - e.x) < 0.12 + radio && Math.abs(z - p.z) < PUERTA.ancho / 2 + radio);
    },
  };
}
