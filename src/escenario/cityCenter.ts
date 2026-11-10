import * as THREE from 'three';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import plano from './city-center.json';
// Helvetiker de los ejemplos de three.js (MgOpen, licencia libre en fuentes/LICENSE).
import helvetiker from './fuentes/helvetiker_bold.typeface.json';

// La maqueta del City Center Rosario: bloques grises a escala real armados con el plano
// (city-center.json, calcado del satélite; tools/plano/dibujar.py lo dibuja). Sirve para caminarlo y
// confirmar tamaños antes de hacer los modelos de verdad, que van reemplazando cada bloque.
// x hacia el este, z hacia el sur, en metros desde el frente de la marquesina.

type Px = number[];
interface Edificio { id: string; alto: number; poligono_px: Px[]; techo?: boolean; sobre?: string }
interface Calle { id: string; ancho: number; eje_px: Px[]; cerrada?: boolean }
interface Verde { id: string; poligono_px?: Px[]; elipse_px?: { centro: Px; radios: Px } }

const ESC = plano.escala;
const [OX, OY] = plano.origen_px;
const RADIO_JUGADOR = 0.35;
const PALMERA_ALTO = 11;
const FAROLA_ALTO = 9;

/** De píxeles del satélite a metros del juego (x, z). */
function m(p: Px): THREE.Vector2 {
  return new THREE.Vector2((p[0] - OX) * ESC, (p[1] - OY) * ESC);
}

/** Una forma del plano levantada `alto` metros desde `desde`. */
function bloque(puntos: THREE.Vector2[], desde: number, alto: number, material: THREE.Material): THREE.Mesh {
  // La forma va en (x, -z) para que, acostada con -90° en X, quede en (x, z) con el alto hacia arriba.
  const forma = new THREE.Shape(puntos.map((p) => new THREE.Vector2(p.x, -p.y)));
  const geo = new THREE.ExtrudeGeometry(forma, { depth: alto, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, desde, 0);
  const malla = new THREE.Mesh(geo, material);
  malla.castShadow = malla.receiveShadow = true;
  return malla;
}

/** Una cinta plana a lo largo de un eje suavizado (calles), apenas sobre el piso. */
function cinta(eje: THREE.Vector2[], ancho: number, cerrada: boolean, y: number, material: THREE.Material): THREE.Mesh {
  const curva = new THREE.CatmullRomCurve3(eje.map((p) => new THREE.Vector3(p.x, 0, p.y)), cerrada, 'centripetal');
  const n = Math.max(8, Math.round(curva.getLength() / 1.5));
  const puntos = curva.getSpacedPoints(n);
  const pos: number[] = [];
  const indices: number[] = [];
  puntos.forEach((p, i) => {
    const t = curva.getTangentAt(Math.min(i / n, 1));
    const normal = new THREE.Vector3(-t.z, 0, t.x).multiplyScalar(ancho / 2);
    pos.push(p.x + normal.x, y, p.z + normal.z, p.x - normal.x, y, p.z - normal.z);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // Con el material de dos caras se ve sea cual sea el sentido en que se recorrió el eje.
  const malla = new THREE.Mesh(geo, material);
  malla.receiveShadow = true;
  return malla;
}

function plana(forma: THREE.Shape, y: number, material: THREE.Material): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(forma, 32);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  const malla = new THREE.Mesh(geo, material);
  malla.receiveShadow = true;
  return malla;
}

/** Un texto en relieve de `alto` metros, `relieve` de espesor y a lo sumo `ancho` de largo, centrado,
 * de cara a +Z con el fondo en z = 0. */
function letrasEnRelieve(texto: string, alto: number, relieve: number, ancho: number): THREE.BufferGeometry {
  const geo = new TextGeometry(texto, { font: new Font(helvetiker as never), size: alto, depth: relieve, curveSegments: 4 });
  geo.computeBoundingBox();
  const caja = geo.boundingBox!;
  geo.translate(-(caja.max.x + caja.min.x) / 2, -(caja.max.y + caja.min.y) / 2, 0);
  const largo = caja.max.x - caja.min.x;
  if (largo > ancho) geo.scale(ancho / largo, ancho / largo, 1);
  geo.computeVertexNormals();
  return geo;
}

function dentro(p: THREE.Vector2, poligono: THREE.Vector2[]): boolean {
  let adentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const a = poligono[i];
    const b = poligono[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) adentro = !adentro;
  }
  return adentro;
}

function distanciaBorde(p: THREE.Vector2, poligono: THREE.Vector2[]): number {
  let menor = Infinity;
  const ab = new THREE.Vector2();
  const ap = new THREE.Vector2();
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const a = poligono[j];
    ab.subVectors(poligono[i], a);
    ap.subVectors(p, a);
    const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
    menor = Math.min(menor, ap.distanceTo(ab.multiplyScalar(t)));
  }
  return menor;
}

export class CityCenter {
  readonly grupo = new THREE.Group();
  /** Las lámparas de las farolas (para los conos de luz). */
  readonly lamparas: THREE.Vector3[] = [];
  /** Contra lo que pegan los tiros. */
  readonly solidos: THREE.Object3D[] = [];
  /** Dónde arranca el jugador y hacia dónde mira la cámara. */
  readonly inicio: { x: number; z: number; yaw: number };
  readonly niebla = { cerca: 45, lejos: 170 };
  private readonly paredes: THREE.Vector2[][] = [];
  private readonly postes: { p: THREE.Vector2; r: number }[] = [];
  private readonly zona: THREE.Vector2[];

  constructor() {
    const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    const piso = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(0x8c8a84)); // explanada
    piso.rotation.x = -Math.PI / 2;
    piso.receiveShadow = true;
    this.grupo.add(piso);
    this.solidos.push(piso);

    const pasto = mat(0x4f6b3c);
    for (const v of plano.verdes as Verde[]) {
      let forma: THREE.Shape;
      if (v.elipse_px) {
        const c = m(v.elipse_px.centro);
        forma = new THREE.Shape();
        forma.absellipse(c.x, -c.y, v.elipse_px.radios[0] * ESC, v.elipse_px.radios[1] * ESC, 0, Math.PI * 2, false, 0);
      } else {
        forma = new THREE.Shape(v.poligono_px!.map((p) => m(p)).map((p) => new THREE.Vector2(p.x, -p.y)));
      }
      this.grupo.add(plana(forma, 0.02, pasto));
    }
    const asfalto = new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.9, side: THREE.DoubleSide });
    for (const c of plano.calles as Calle[]) {
      this.grupo.add(cinta(c.eje_px.map(m), c.ancho, !!c.cerrada, 0.04, asfalto));
    }

    const colores: Record<string, number> = {
      hotel: 0xc9c9d2, base_hotel: 0xe4e0e8, deck: 0xa9a59c, marquesina: 0xeeeef2, casino: 0x96969f, techo_casino: 0xbdbdc8,
    };
    const altos = new Map<string, number>();
    for (const e of plano.edificios as Edificio[]) altos.set(e.id, e.alto);
    for (const e of plano.edificios as Edificio[]) {
      const puntos = e.poligono_px.map(m);
      const material = mat(colores[e.id] ?? 0xaaaaaa);
      if (e.techo) {
        this.marquesina(puntos, e.alto, material);
        continue;
      }
      const desde = e.sobre ? altos.get(e.sobre)! : 0;
      const malla = bloque(puntos, desde, e.alto - desde, material);
      this.grupo.add(malla);
      this.solidos.push(malla);
      if (!e.sobre) this.paredes.push(puntos);
    }

    // Los muros con luces rosas: una franja de puntos que brillan sobre la fachada, a la altura del muro.
    const rosa = new THREE.MeshStandardMaterial({ color: 0xff7ad9, emissive: 0xff4fc8, emissiveIntensity: 3 });
    const punto = new THREE.SphereGeometry(0.18, 8, 6);
    for (const muro of plano.muros_luces) {
      const linea = muro.linea_px.map(m);
      for (let i = 1; i < linea.length; i++) {
        const a = linea[i - 1];
        const b = linea[i];
        const largo = a.distanceTo(b);
        const normal = new THREE.Vector2(b.y - a.y, a.x - b.x).normalize().multiplyScalar(-0.3);
        for (let d = 1; d < largo; d += 1.6) {
          const p = a.clone().lerp(b, d / largo).add(normal);
          const luz = new THREE.Mesh(punto, rosa);
          luz.position.set(p.x, 0.6 + ((d * 7.31) % 1) * 4.5, p.y);
          this.grupo.add(luz);
        }
      }
    }

    // Palmeras: tronco y una copa de bloque; el modelo de verdad viene después.
    const tronco = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 1 });
    const hojas = new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 1 });
    const troncoGeo = new THREE.CylinderGeometry(0.22, 0.32, PALMERA_ALTO, 8);
    const copaGeo = new THREE.ConeGeometry(2.6, 2.2, 8);
    for (const px of plano.palmeras_px) {
      const p = m(px);
      const t = new THREE.Mesh(troncoGeo, tronco);
      t.position.set(p.x, PALMERA_ALTO / 2, p.y);
      const c = new THREE.Mesh(copaGeo, hojas);
      c.position.set(p.x, PALMERA_ALTO, p.y);
      c.rotation.x = Math.PI; // abierta hacia abajo, como cuelgan las hojas
      t.castShadow = c.castShadow = true;
      this.grupo.add(t, c);
      this.solidos.push(t);
      this.postes.push({ p, r: 0.35 });
    }

    // Farolas de calle: poste alto, brazo y una lámpara que ilumina para abajo. Las dos más cerca de
    // la entrada hacen sombra (cada sombra vuelve a dibujar la escena).
    const metal = new THREE.MeshStandardMaterial({ color: 0x9a9ea6, metalness: 0.5, roughness: 0.5 });
    const lamparaMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 4 });
    const farolas = plano.farolas_px.map(m);
    const conSombra = [...farolas].sort((a, b) => a.length() - b.length()).slice(0, 2);
    for (const p of farolas) {
      const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, FAROLA_ALTO, 10), metal);
      poste.position.set(p.x, FAROLA_ALTO / 2, p.y);
      poste.castShadow = true;
      this.grupo.add(poste);
      this.solidos.push(poste);
      this.postes.push({ p, r: 0.15 });
      // El brazo hacia el lado de la entrada (x = 0); en la maqueta alcanza.
      const hacia = new THREE.Vector2(Math.sign(-p.x) || 1, 0);
      const cabeza = new THREE.Vector3(p.x + hacia.x * 1.4, FAROLA_ALTO - 0.15, p.y);
      const brazo = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.08), metal);
      brazo.position.set(p.x + hacia.x * 0.7, FAROLA_ALTO - 0.05, p.y);
      const lampara = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.28), lamparaMat);
      lampara.position.copy(cabeza);
      this.grupo.add(brazo, lampara);
      this.lamparas.push(cabeza.clone());
      const luz = new THREE.SpotLight(0xffc98a, 260, 34, 0.75, 0.6, 2);
      luz.position.copy(cabeza).add(new THREE.Vector3(0, -0.06, 0));
      luz.target.position.copy(cabeza).setY(0);
      if (conSombra.includes(p)) {
        luz.castShadow = true;
        luz.shadow.mapSize.set(1024, 1024);
        luz.shadow.bias = -0.0005;
      }
      this.grupo.add(luz, luz.target);
    }

    this.zona = plano.zona_jugable_px.map(m);
    // Arranca en el rulo, al norte del cantero, mirando hacia la marquesina.
    const desde = m([180, 300]);
    this.inicio = { x: desde.x, z: desde.y, yaw: Math.atan2(desde.x, desde.y) };
  }

  /** La entrada, como en la foto: arriba una viga larga y gruesa con «CITY CENTER ROSARIO», y debajo
   * un alero fino que sale hacia la calle, de perfil un triángulo (grueso contra el edificio, una hoja
   * en la punta), con la panza iluminada de madera. Lo sostienen pares de columnas en diagonal que
   * arrancan atrás y se abren hacia la punta, y al costado de cada par una columna redonda recta. `puntos`: la planta
   * del plano (el frente es su lado oeste, el fondo la fachada); `alto`: dónde termina el alero. */
  private marquesina(puntos: THREE.Vector2[], alto: number, material: THREE.Material): void {
    const xs = puntos.map((p) => p.x);
    const zs = puntos.map((p) => p.y);
    const frente = Math.min(...xs);
    const fondo = Math.max(...xs);
    const norte = Math.min(...zs);
    const sur = Math.max(...zs);
    const largo = sur - norte;

    // El alero: el perfil (x, y) estirado a lo largo de la entrada.
    const punta = frente - 1.5;
    const raiz = frente + 9;
    const arriba = alto - 0.5;
    const abajoPunta = arriba - 0.08;
    const abajoRaiz = arriba - 1.3;
    const perfil = new THREE.Shape([
      new THREE.Vector2(punta, abajoPunta), new THREE.Vector2(raiz, abajoRaiz),
      new THREE.Vector2(raiz, arriba), new THREE.Vector2(punta, arriba),
    ]);
    const aleroGeo = new THREE.ExtrudeGeometry(perfil, { depth: largo + 4, bevelEnabled: false });
    aleroGeo.translate(0, 0, norte - 2);
    const blanco = new THREE.MeshStandardMaterial({ color: 0xf2f2f4, roughness: 0.6 });
    const alero = new THREE.Mesh(aleroGeo, blanco);
    alero.castShadow = alero.receiveShadow = true;
    this.grupo.add(alero);
    this.solidos.push(alero);
    // La panza de madera iluminada, pegada a la cara de abajo.
    const pendiente = Math.atan2(abajoRaiz - abajoPunta, raiz - punta);
    const ancho = Math.hypot(raiz - punta, abajoRaiz - abajoPunta);
    const panzaGeo = new THREE.PlaneGeometry(ancho, largo + 4);
    panzaGeo.rotateX(Math.PI / 2); // mirando para abajo
    const panza = new THREE.Mesh(panzaGeo, new THREE.MeshStandardMaterial({
      color: 0xc98a4a, emissive: 0xffa24a, emissiveIntensity: 1.2, roughness: 0.8,
    }));
    panza.rotation.z = pendiente;
    panza.position.set((punta + raiz) / 2, (abajoPunta + abajoRaiz) / 2 - 0.02, (norte + sur) / 2);
    this.grupo.add(panza);

    // La viga del cartel, de la fachada hasta pasar el alero, y más larga que él hacia el norte.
    const vigaFrente = frente + 4;
    const viga = new THREE.Mesh(new THREE.BoxGeometry(fondo - vigaFrente, 3, largo + 10), material);
    viga.position.set((vigaFrente + fondo) / 2, arriba + 1.5, (norte + sur) / 2 - 3);
    viga.castShadow = viga.receiveShadow = true;
    this.grupo.add(viga);
    this.solidos.push(viga);
    // Las letras en relieve, salidas de la viga: hacen sombra sobre ella.
    const letras = new THREE.Mesh(letrasEnRelieve('CITY CENTER ROSARIO', 1.7, 0.3, 26), new THREE.MeshStandardMaterial({
      color: 0xf4f4f6, emissive: 0xffffff, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.45,
    }));
    letras.rotation.y = -Math.PI / 2; // de cara a la calle (-x), con el fondo pegado a la viga
    letras.position.set(vigaFrente - 0.01, arriba + 1.5, (norte + sur) / 2 + 2);
    letras.castShadow = letras.receiveShadow = true;
    this.grupo.add(letras);

    // Columnas en diagonal, de a pares: arrancan atrás juntas y se abren hacia el alero.
    const gris = new THREE.MeshStandardMaterial({ color: 0xd8d8de, metalness: 0.3, roughness: 0.5 });
    const barra = (desde: THREE.Vector3, hasta: THREE.Vector3, radio: number) => {
      const dir = hasta.clone().sub(desde);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, dir.length(), 10), gris);
      b.position.copy(desde).add(hasta).multiplyScalar(0.5);
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      b.castShadow = true;
      this.grupo.add(b);
      this.solidos.push(b);
    };
    const abajoEn = (x: number) => THREE.MathUtils.lerp(abajoPunta, abajoRaiz, (x - punta) / (raiz - punta));
    const PARES = 4;
    for (let i = 0; i < PARES; i++) {
      const z = norte + (largo * (i + 0.5)) / PARES;
      const base = frente + 6.5;
      const tope = frente + 0.8;
      for (const lado of [-1, 1]) {
        barra(new THREE.Vector3(base, 0, z + lado * 0.2), new THREE.Vector3(tope, abajoEn(tope), z + lado * 0.9), 0.12);
      }
      this.postes.push({ p: new THREE.Vector2(base, z), r: 0.45 });
    }
    // Columnas redondas bajo la viga, una al costado de cada par de diagonales (corrida lo bastante
    // para no cruzarse con ellas, que se abren hasta 0,9 m del centro del par).
    for (let i = 0; i < PARES; i++) {
      // Las dos del norte van del lado norte de su par, las otras del lado sur (como en la foto).
      const z = norte + (largo * (i + 0.5)) / PARES + (i < PARES / 2 ? -1.9 : 1.9);
      const x = vigaFrente + 1;
      barra(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, arriba, z), 0.38);
      this.postes.push({ p: new THREE.Vector2(x, z), r: 0.38 });
    }
  }

  /** Si el jugador puede pararse en (x, z): dentro de la zona y fuera de edificios, palmeras y postes. */
  libre(x: number, z: number): boolean {
    const p = new THREE.Vector2(x, z);
    if (!dentro(p, this.zona) || distanciaBorde(p, this.zona) < RADIO_JUGADOR) return false;
    for (const pared of this.paredes) {
      if (dentro(p, pared) || distanciaBorde(p, pared) < RADIO_JUGADOR) return false;
    }
    return !this.postes.some((o) => o.p.distanceTo(p) < o.r + RADIO_JUGADOR);
  }
}
