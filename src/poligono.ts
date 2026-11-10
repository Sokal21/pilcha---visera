import * as THREE from 'three';

// El polígono de tiro: piso, dos mesas con latas y tres blancos a distintas distancias. Las latas
// saltan cuando les pegan (gravedad, rebote, rozamiento; nada más) y los blancos guardan los agujeros.

const GRAVEDAD = 9.8;
const LATA_ALTO = 0.12;
const LATA_RADIO = 0.033;
const MESA_ALTO = 0.9;
// Una vaina de 9 mm: 19 mm de largo, 10 de ancho.
const VAINA_LARGO = 0.019;
const VAINA_RADIO = 0.005;
const VAINAS_MAX = 60;

interface Vaina {
  malla: THREE.Mesh;
  vel: THREE.Vector3;
  giro: THREE.Vector3;
  quieta: boolean;
}

interface Lata {
  malla: THREE.Mesh;
  inicio: THREE.Vector3;
  vel: THREE.Vector3;
  giro: THREE.Vector3;
  volando: boolean;
}

interface Mesa {
  centro: THREE.Vector3;
  ancho: number;
  fondo: number;
}

export interface Impacto {
  punto: THREE.Vector3;
  normal: THREE.Vector3;
  que: 'lata' | 'blanco' | 'otro';
  puntos: number;
}

export class Poligono {
  readonly grupo = new THREE.Group();
  readonly lamparas: THREE.Vector3[] = [];
  private readonly latas: Lata[] = [];
  private readonly mesas: Mesa[] = [];
  private readonly blancos: THREE.Mesh[] = [];
  private readonly agujeros: THREE.Mesh[] = [];
  private readonly solidos: THREE.Object3D[] = [];
  private readonly efectos: { obj: THREE.Object3D; vida: number; total: number }[] = [];
  private readonly vainas: Vaina[] = [];
  private readonly vainaGeo = new THREE.CylinderGeometry(VAINA_RADIO, VAINA_RADIO, VAINA_LARGO, 10);
  private readonly vainaMat = new THREE.MeshStandardMaterial({ color: 0xc9a23a, metalness: 0.85, roughness: 0.3 });

  constructor() {
    const piso = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x6f7a5a, roughness: 1 }));
    piso.rotation.x = -Math.PI / 2;
    piso.receiveShadow = true;
    this.grupo.add(piso);
    this.solidos.push(piso);
    const grilla = new THREE.GridHelper(80, 80, 0x5c6649, 0x5c6649);
    grilla.position.y = 0.002;
    this.grupo.add(grilla);

    // Fondo: un talud de tierra para que los tiros no se pierdan en la nada.
    const talud = new THREE.Mesh(new THREE.BoxGeometry(30, 3, 2), new THREE.MeshStandardMaterial({ color: 0x8a7350, roughness: 1 }));
    talud.position.set(0, 1.5, -26);
    talud.castShadow = talud.receiveShadow = true;
    this.grupo.add(talud);
    this.solidos.push(talud);

    for (const [x, z, sombra] of [[-5, 1, true], [5, -6, true], [-5, -13, false], [5, -20, false]] as const) {
      this.farola(new THREE.Vector3(x, 0, z), sombra);
    }
    this.mesa(new THREE.Vector3(-2.5, 0, -10), 6);
    this.mesa(new THREE.Vector3(3, 0, -16), 5);
    this.blanco(new THREE.Vector3(0.5, 0, -8));
    this.blanco(new THREE.Vector3(-4.5, 0, -14));
    this.blanco(new THREE.Vector3(5.5, 0, -21));
  }

  /** Una farola: poste, brazo hacia el centro del polígono y una lámpara que ilumina para abajo. */
  private farola(base: THREE.Vector3, sombra: boolean): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.6, roughness: 0.5 });
    const alto = 4.2;
    const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, alto, 10), metal);
    poste.position.set(base.x, alto / 2, base.z);
    poste.castShadow = true;
    this.grupo.add(poste);
    this.solidos.push(poste);
    const hacia = -Math.sign(base.x); // el brazo apunta al centro
    const brazo = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.05), metal);
    brazo.position.set(base.x + hacia * 0.45, alto - 0.05, base.z);
    this.grupo.add(brazo);
    const cabeza = new THREE.Vector3(base.x + hacia * 0.85, alto - 0.12, base.z);
    const pantalla = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.22), metal);
    pantalla.position.copy(cabeza).add(new THREE.Vector3(0, 0.04, 0));
    this.grupo.add(pantalla);
    const lampara = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.03, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 4 }),
    );
    lampara.position.copy(cabeza);
    this.grupo.add(lampara);
    this.lamparas.push(cabeza.clone());
    const luz = new THREE.SpotLight(0xffc98a, 90, 26, 0.8, 0.6, 2);
    luz.position.copy(cabeza).add(new THREE.Vector3(0, -0.05, 0));
    luz.target.position.copy(cabeza).setY(0);
    if (sombra) {
      luz.castShadow = true;
      luz.shadow.mapSize.set(1024, 1024);
      luz.shadow.bias = -0.0005;
    }
    this.grupo.add(luz, luz.target);
  }

  private mesa(centro: THREE.Vector3, latas: number): void {
    const ancho = 1.8;
    const fondo = 0.6;
    const madera = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });
    const tabla = new THREE.Mesh(new THREE.BoxGeometry(ancho, 0.05, fondo), madera);
    tabla.position.set(centro.x, MESA_ALTO - 0.025, centro.z);
    tabla.castShadow = tabla.receiveShadow = true;
    this.grupo.add(tabla);
    this.solidos.push(tabla);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pata = new THREE.Mesh(new THREE.BoxGeometry(0.06, MESA_ALTO - 0.05, 0.06), madera);
      pata.position.set(centro.x + dx * (ancho / 2 - 0.06), (MESA_ALTO - 0.05) / 2, centro.z + dz * (fondo / 2 - 0.06));
      pata.castShadow = true;
      this.grupo.add(pata);
    }
    this.mesas.push({ centro, ancho, fondo });
    const colores = [0xc8102e, 0xd9d9d9, 0x1f6fd1, 0xf2b705];
    for (let i = 0; i < latas; i++) {
      const lata = new THREE.Mesh(
        new THREE.CylinderGeometry(LATA_RADIO, LATA_RADIO, LATA_ALTO, 16),
        new THREE.MeshStandardMaterial({ color: colores[i % colores.length], metalness: 0.6, roughness: 0.35 }),
      );
      const x = centro.x - ancho / 2 + 0.2 + (i * (ancho - 0.4)) / Math.max(1, latas - 1);
      const inicio = new THREE.Vector3(x, MESA_ALTO + LATA_ALTO / 2, centro.z);
      lata.position.copy(inicio);
      lata.castShadow = true;
      this.grupo.add(lata);
      this.latas.push({ malla: lata, inicio, vel: new THREE.Vector3(), giro: new THREE.Vector3(), volando: false });
    }
  }

  private blanco(base: THREE.Vector3): void {
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = 256;
    const g = lienzo.getContext('2d')!;
    g.fillStyle = '#f4efe2';
    g.fillRect(0, 0, 256, 256);
    for (let r = 5; r >= 1; r--) {
      g.beginPath();
      g.arc(128, 128, r * 24, 0, Math.PI * 2);
      g.fillStyle = r % 2 ? '#b8231f' : '#f4efe2';
      g.fill();
    }
    g.beginPath();
    g.arc(128, 128, 10, 0, Math.PI * 2);
    g.fillStyle = '#111';
    g.fill();
    const textura = new THREE.CanvasTexture(lienzo);
    textura.colorSpace = THREE.SRGBColorSpace;
    const tablero = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: textura, roughness: 1 }));
    tablero.position.set(base.x, 1.35, base.z);
    tablero.castShadow = true;
    this.grupo.add(tablero);
    this.blancos.push(tablero);
    const palo = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), new THREE.MeshStandardMaterial({ color: 0x5b4a36 }));
    palo.position.set(base.x, 0.5, base.z - 0.04);
    palo.castShadow = true;
    this.grupo.add(palo);
    this.solidos.push(palo);
  }

  /** Hasta dónde llega una mirada desde `origen` hacia `dir`: lo primero que toca, o 40 m. */
  alcance(origen: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 {
    const rayo = new THREE.Raycaster(origen, dir, 0.5, 120);
    const objetos = [...this.latas.map((l) => l.malla), ...this.blancos, ...this.solidos];
    const hit = rayo.intersectObjects(objetos, false)[0];
    return hit ? hit.point : origen.clone().addScaledVector(dir, 40);
  }

  /** Un tiro desde `origen` hacia `dir`: qué toca primero, y lo que eso le hace. */
  disparar(origen: THREE.Vector3, dir: THREE.Vector3): Impacto | null {
    const rayo = new THREE.Raycaster(origen, dir, 0.1, 120);
    const objetos = [...this.latas.map((l) => l.malla), ...this.blancos, ...this.solidos];
    const hit = rayo.intersectObjects(objetos, false)[0];
    if (!hit) return null;
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
    const lata = this.latas.find((l) => l.malla === hit.object);
    if (lata) {
      lata.volando = true;
      lata.vel.add(dir.clone().multiplyScalar(5.5)).add(new THREE.Vector3(0, 2.8 + Math.random() * 1.5, 0));
      lata.giro.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 30);
      this.chispa(hit.point, 0xffe08a);
      return { punto: hit.point, normal, que: 'lata', puntos: 10 };
    }
    if (this.blancos.includes(hit.object as THREE.Mesh)) {
      const uv = hit.uv ?? new THREE.Vector2(0.5, 0.5);
      const d = Math.hypot(uv.x - 0.5, uv.y - 0.5) * 256;
      const puntos = d <= 10 ? 50 : Math.max(0, 6 - Math.ceil(d / 24)) * 5;
      this.agujero(hit.point, normal);
      return { punto: hit.point, normal, que: 'blanco', puntos };
    }
    this.chispa(hit.point, 0xc9b38a);
    return { punto: hit.point, normal, que: 'otro', puntos: 0 };
  }

  private agujero(punto: THREE.Vector3, normal: THREE.Vector3): void {
    const a = new THREE.Mesh(new THREE.CircleGeometry(0.012, 10), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    a.position.copy(punto).addScaledVector(normal, 0.002);
    a.lookAt(punto.clone().add(normal));
    this.grupo.add(a);
    this.agujeros.push(a);
  }

  private chispa(punto: THREE.Vector3, color: number): void {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), new THREE.MeshBasicMaterial({ color, transparent: true }));
    s.position.copy(punto);
    this.grupo.add(s);
    this.efectos.push({ obj: s, vida: 0.15, total: 0.15 });
  }

  /** Un trazo de la bala, del caño a donde pegó, que se desvanece enseguida. */
  trazo(desde: THREE.Vector3, hasta: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([desde, hasta]);
    const linea = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff3c4, transparent: true }));
    this.grupo.add(linea);
    this.efectos.push({ obj: linea, vida: 0.06, total: 0.06 });
  }

  /** Una vaina que sale despedida de `desde` con velocidad `vel`, girando. */
  vaina(desde: THREE.Vector3, vel: THREE.Vector3): void {
    const malla = new THREE.Mesh(this.vainaGeo, this.vainaMat);
    malla.position.copy(desde);
    malla.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    malla.castShadow = true;
    this.grupo.add(malla);
    const giro = new THREE.Vector3((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
    this.vainas.push({ malla, vel: vel.clone(), giro, quieta: false });
    if (this.vainas.length > VAINAS_MAX) this.grupo.remove(this.vainas.shift()!.malla);
  }

  reponer(): void {
    for (const l of this.latas) {
      l.malla.position.copy(l.inicio);
      l.malla.rotation.set(0, 0, 0);
      l.vel.set(0, 0, 0);
      l.giro.set(0, 0, 0);
      l.volando = false;
    }
    for (const a of this.agujeros) this.grupo.remove(a);
    this.agujeros.length = 0;
    for (const v of this.vainas) this.grupo.remove(v.malla);
    this.vainas.length = 0;
  }

  /** Lo que hay debajo de una lata en (x, z): una mesa o el piso. */
  private apoyo(x: number, z: number): number {
    for (const m of this.mesas) {
      if (Math.abs(x - m.centro.x) < m.ancho / 2 && Math.abs(z - m.centro.z) < m.fondo / 2) return MESA_ALTO;
    }
    return 0;
  }

  actualizar(dt: number): void {
    for (const l of this.latas) {
      if (!l.volando) continue;
      const p = l.malla.position;
      l.vel.y -= GRAVEDAD * dt;
      p.addScaledVector(l.vel, dt);
      l.malla.rotation.x += l.giro.x * dt;
      l.malla.rotation.y += l.giro.y * dt;
      l.malla.rotation.z += l.giro.z * dt;
      const piso = this.apoyo(p.x, p.z) + LATA_RADIO;
      if (p.y < piso && l.vel.y < 0) {
        p.y = piso;
        l.vel.y *= -0.3;
        l.vel.x *= 0.6;
        l.vel.z *= 0.6;
        l.giro.multiplyScalar(0.5);
        if (l.vel.length() < 0.4) {
          // Quieta, acostada.
          l.volando = false;
          l.vel.set(0, 0, 0);
          l.malla.rotation.set(Math.PI / 2, 0, l.malla.rotation.z);
        }
      }
    }
    for (const v of this.vainas) {
      if (v.quieta) continue;
      const p = v.malla.position;
      v.vel.y -= GRAVEDAD * dt;
      p.addScaledVector(v.vel, dt);
      v.malla.rotation.x += v.giro.x * dt;
      v.malla.rotation.y += v.giro.y * dt;
      v.malla.rotation.z += v.giro.z * dt;
      const piso = this.apoyo(p.x, p.z) + VAINA_RADIO;
      if (p.y < piso && v.vel.y < 0) {
        p.y = piso;
        v.vel.y *= -0.35;
        v.vel.x *= 0.5;
        v.vel.z *= 0.5;
        v.giro.multiplyScalar(0.4);
        if (v.vel.length() < 0.25) {
          // Acostada: el eje del cilindro (su Y) queda horizontal.
          v.quieta = true;
          v.malla.rotation.set(Math.PI / 2, 0, v.malla.rotation.z);
        }
      }
    }
    for (let i = this.efectos.length - 1; i >= 0; i--) {
      const e = this.efectos[i];
      e.vida -= dt;
      const k = Math.max(0, e.vida / e.total);
      const mat = (e.obj as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && 'opacity' in mat) mat.opacity = k;
      if (e.vida <= 0) {
        this.grupo.remove(e.obj);
        this.efectos.splice(i, 1);
      }
    }
  }
}
