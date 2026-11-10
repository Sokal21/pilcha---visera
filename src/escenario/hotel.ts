import * as THREE from 'three';
import { letrasEnRelieve } from './letras';

// El Pullman, como en las fotos: una lámina de piedra clara de ocho pisos sobre una planta baja
// vidriada y retirada (la lámina vuela por encima). En las caras largas, franjas de ventanas por piso
// separadas por bandas de piedra, con habitaciones encendidas al azar (siempre las mismas); la cara
// corta del oeste, ciega, lavada de luz desde abajo y con «pullman HOTELS» en relieve. Las fachadas
// se pintan en un lienzo (sin modelos ni texturas generadas): son filas regulares y así se elige qué
// se prende.

const PLANTA_BAJA = 5;
const ALTO = 30;
const RETIRO = 1.2; // cuánto se mete la planta baja bajo la lámina
const PISOS = 8;
const PISO = 3.05;
const HABITACION = 3.6; // cada una, dos ventanas
const ENCENDIDAS = 0.38;
const PX_METRO = 24;

const PIEDRA = '#dcd8d0';
const JUNTA = '#c4c0b7';

/** Números al azar pero siempre los mismos para la misma semilla (las ventanas no cambian al recargar). */
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

interface Lienzos { color: CanvasRenderingContext2D; luz: CanvasRenderingContext2D; ancho: number; alto: number }

/** Dos lienzos del tamaño de una fachada de `ancho` × `alto` metros, con y medida desde abajo. */
function lienzos(ancho: number, alto: number): Lienzos & { aPx: (x: number, y: number) => [number, number] } {
  const w = Math.min(2048, Math.round(ancho * PX_METRO));
  const h = Math.min(2048, Math.round(alto * PX_METRO));
  const hacer = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c.getContext('2d')!;
  };
  const color = hacer();
  const luz = hacer();
  luz.fillStyle = '#000';
  luz.fillRect(0, 0, w, h);
  return { color, luz, ancho, alto, aPx: (x, y) => [(x / ancho) * w, h - (y / alto) * h] };
}

/** Un rectángulo en metros (x, y desde abajo a la izquierda). */
function rect(g: CanvasRenderingContext2D, l: ReturnType<typeof lienzos>, x: number, y: number, w: number, h: number): void {
  const [x0, y1] = l.aPx(x, y);
  const [x1, y0] = l.aPx(x + w, y + h);
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
}

function texturas(l: Lienzos): { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
  const t = (g: CanvasRenderingContext2D) => {
    const tx = new THREE.CanvasTexture(g.canvas);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 8;
    return tx;
  };
  return { map: t(l.color), emissiveMap: t(l.luz) };
}

/** Una cara larga: bandas de piedra y franjas de ventanas, de la lámina (sobre la planta baja). */
function caraVentanas(ancho: number, semilla: number) {
  const alto = ALTO - PLANTA_BAJA;
  const l = lienzos(ancho, alto);
  const { color: g, luz } = l;
  g.fillStyle = PIEDRA;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  const r = azar(semilla);
  const margen = 1.4;
  const habitaciones = Math.floor((ancho - 2 * margen) / HABITACION);
  const inicio = (ancho - habitaciones * HABITACION) / 2;
  for (let p = 0; p < PISOS; p++) {
    const base = 0.3 + p * PISO;
    // Junta entre bandas, a la altura de cada losa.
    g.fillStyle = JUNTA;
    rect(g, l, 0, base - 0.04, ancho, 0.05);
    const y = base + 0.85;
    const h = 1.5;
    g.fillStyle = '#2a3340';
    rect(g, l, inicio - 0.1, y - 0.1, habitaciones * HABITACION + 0.2, h + 0.2);
    for (let i = 0; i < habitaciones; i++) {
      const x = inicio + i * HABITACION;
      const prendida = r() < ENCENDIDAS;
      const cortina = prendida && r() < 0.35; // con la cortina a medio cerrar: solo abajo
      const fuerza = 0.55 + r() * 0.45;
      for (let v = 0; v < 2; v++) {
        const vx = x + 0.1 + v * (HABITACION / 2);
        const vw = HABITACION / 2 - 0.2;
        // El vidrio apagado refleja el cielo: más claro arriba.
        const [, ya] = l.aPx(0, y + h);
        const [, yb] = l.aPx(0, y);
        const reflejo = g.createLinearGradient(0, ya, 0, yb);
        reflejo.addColorStop(0, '#71839a');
        reflejo.addColorStop(1, '#2c3644');
        g.fillStyle = prendida ? '#e8c590' : reflejo;
        rect(g, l, vx, y, vw, h);
        if (prendida) {
          const tono = Math.round(255 * fuerza);
          luz.fillStyle = `rgb(${tono}, ${Math.round(tono * 0.8)}, ${Math.round(tono * 0.52)})`;
          rect(luz, l, vx, y, vw, cortina ? h * 0.55 : h);
          if (cortina) {
            g.fillStyle = '#b8a48a';
            rect(g, l, vx, y + h * 0.55, vw, h * 0.45);
          }
        }
      }
      // Parante entre habitaciones.
      g.fillStyle = '#bdb9b1';
      rect(g, l, x - 0.06, y, 0.12, h);
    }
    // Juntas verticales de las placas de piedra, en las bandas.
    g.fillStyle = JUNTA;
    for (let x = inicio; x <= ancho - inicio + 0.01; x += HABITACION) rect(g, l, x - 0.02, base, 0.04, 0.85);
  }
  // Coronamiento.
  g.fillStyle = '#e6e3dc';
  rect(g, l, 0, alto - 0.6, ancho, 0.6);
  return texturas(l);
}

/** La cara corta: piedra en placas, ciega, lavada de luz azulada desde abajo (los reflectores de la base). */
function caraCiega(ancho: number) {
  const alto = ALTO - PLANTA_BAJA;
  const l = lienzos(ancho, alto);
  const { color: g, luz } = l;
  g.fillStyle = PIEDRA;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.fillStyle = JUNTA;
  for (let y = 0.3; y < alto; y += 1.5) rect(g, l, 0, y, ancho, 0.04);
  for (let x = 0; x < ancho; x += 1.8) rect(g, l, x, 0, 0.04, alto);
  const [, arriba] = l.aPx(0, alto * 0.75);
  const [, abajo] = l.aPx(0, 0);
  const lavado = luz.createLinearGradient(0, abajo, 0, arriba);
  lavado.addColorStop(0, 'rgba(150, 168, 210, 0.42)');
  lavado.addColorStop(1, 'rgba(150, 168, 210, 0)');
  luz.fillStyle = lavado;
  luz.fillRect(0, 0, luz.canvas.width, luz.canvas.height);
  return texturas(l);
}

/** La planta baja: vidrio entre parantes, con la luz cálida de adentro. */
function caraVidriera(ancho: number) {
  const l = lienzos(ancho, PLANTA_BAJA);
  const { color: g, luz } = l;
  g.fillStyle = '#3a4350';
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  luz.fillStyle = 'rgb(150, 110, 60)';
  luz.fillRect(0, 0, luz.canvas.width, luz.canvas.height);
  g.fillStyle = '#9a9890';
  luz.fillStyle = '#000';
  for (let x = 0; x <= ancho; x += 2.2) {
    rect(g, l, x - 0.07, 0, 0.14, PLANTA_BAJA);
    rect(luz, l, x - 0.07, 0, 0.14, PLANTA_BAJA);
  }
  rect(g, l, 0, 3.6, ancho, 0.12);
  rect(luz, l, 0, 3.6, ancho, 0.12);
  rect(g, l, 0, PLANTA_BAJA - 0.5, ancho, 0.5);
  rect(luz, l, 0, PLANTA_BAJA - 0.5, ancho, 0.5);
  return texturas(l);
}

/** El polígono metido `d` metros hacia adentro (convexo). */
function encoger(puntos: THREE.Vector2[], d: number): THREE.Vector2[] {
  const centro = puntos.reduce((s, p) => s.add(p), new THREE.Vector2()).divideScalar(puntos.length);
  const adentro = (a: THREE.Vector2, b: THREE.Vector2) => {
    const n = new THREE.Vector2(b.y - a.y, a.x - b.x).normalize();
    return n.dot(centro.clone().sub(a)) < 0 ? n.negate() : n;
  };
  return puntos.map((p, i) => {
    const antes = puntos[(i + puntos.length - 1) % puntos.length];
    const despues = puntos[(i + 1) % puntos.length];
    const n1 = adentro(antes, p);
    const n2 = adentro(p, despues);
    const bis = n1.clone().add(n2).normalize();
    return p.clone().addScaledVector(bis, d / Math.max(0.2, bis.dot(n1)));
  });
}

/** Cada lado del polígono con su normal hacia afuera. */
function lados(puntos: THREE.Vector2[]) {
  const centro = puntos.reduce((s, p) => s.add(p), new THREE.Vector2()).divideScalar(puntos.length);
  return puntos.map((a, i) => {
    const b = puntos[(i + 1) % puntos.length];
    let n = new THREE.Vector2(b.y - a.y, a.x - b.x).normalize();
    const medio = a.clone().add(b).multiplyScalar(0.5);
    if (n.dot(medio.clone().sub(centro)) < 0) n = n.negate();
    return { a, b, medio, n, largo: a.distanceTo(b) };
  });
}

/** Un plano de fachada sobre el lado, de `desde` a `hasta`, mirando hacia afuera. */
function cara(lado: ReturnType<typeof lados>[number], desde: number, hasta: number, tx: ReturnType<typeof texturas>, separa: number): THREE.Mesh {
  const malla = new THREE.Mesh(
    new THREE.PlaneGeometry(lado.largo, hasta - desde),
    new THREE.MeshStandardMaterial({ ...tx, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.85 }),
  );
  malla.rotation.y = Math.atan2(lado.n.x, lado.n.y);
  malla.position.set(lado.medio.x + lado.n.x * separa, (desde + hasta) / 2, lado.medio.y + lado.n.y * separa);
  malla.receiveShadow = true;
  return malla;
}

function volumen(puntos: THREE.Vector2[], desde: number, alto: number, material: THREE.Material): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(puntos.map((p) => new THREE.Vector2(p.x, -p.y))), { depth: alto, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, desde, 0);
  const malla = new THREE.Mesh(geo, material);
  malla.castShadow = malla.receiveShadow = true;
  return malla;
}

/** El hotel sobre `puntos` (su planta, en metros x, z). `pared`: contra qué choca el jugador (la
 * planta baja, que está retirada: se camina bajo el vuelo de la lámina). */
export function armarHotel(puntos: THREE.Vector2[]): { grupo: THREE.Group; solidos: THREE.Object3D[]; pared: THREE.Vector2[] } {
  const grupo = new THREE.Group();
  const solidos: THREE.Object3D[] = [];
  const piedra = new THREE.MeshStandardMaterial({ color: 0xd2cec6, roughness: 0.9 });

  // La lámina, con las fachadas pintadas apenas por fuera.
  const lamina = volumen(puntos, PLANTA_BAJA, ALTO - PLANTA_BAJA, piedra);
  grupo.add(lamina);
  solidos.push(lamina);
  lados(puntos).forEach((lado, i) => {
    const tx = lado.largo > 30 ? caraVentanas(lado.largo, 1810 + i * 97) : caraCiega(lado.largo);
    grupo.add(cara(lado, PLANTA_BAJA, ALTO, tx, 0.03));
  });

  // La planta baja vidriada, retirada.
  const pared = encoger(puntos, RETIRO);
  const nucleo = volumen(pared, 0, PLANTA_BAJA, new THREE.MeshStandardMaterial({ color: 0x3a4350 }));
  grupo.add(nucleo);
  solidos.push(nucleo);
  for (const lado of lados(pared)) grupo.add(cara(lado, 0, PLANTA_BAJA, caraVidriera(lado.largo), 0.03));

  // Sala de máquinas en la azotea (para la silueta).
  const centro = puntos.reduce((s, p) => s.add(p), new THREE.Vector2()).divideScalar(puntos.length);
  const sala = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 8), new THREE.MeshStandardMaterial({ color: 0xbab6ae, roughness: 0.9 }));
  sala.position.set(centro.x + 8, ALTO + 1.5, centro.y);
  sala.castShadow = true;
  grupo.add(sala);

  // «pullman HOTELS» en relieve sobre la cara ciega que mira al oeste, arriba y algo a la derecha.
  const oeste = lados(puntos).reduce((a, b) => (b.n.x < a.n.x ? b : a));
  const giro = Math.atan2(oeste.n.x, oeste.n.y);
  const derecha = new THREE.Vector2(Math.cos(giro), -Math.sin(giro));
  const material = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, emissive: 0xfff3e0, emissiveIntensity: 0.6, roughness: 0.45 });
  for (const [texto, alto, y] of [['pullman', 2.6, 26.2], ['H O T E L S', 0.9, 23.9]] as const) {
    const letras = new THREE.Mesh(letrasEnRelieve(texto, alto, 0.25, oeste.largo - 3), material);
    letras.rotation.y = giro;
    const p = oeste.medio.clone().addScaledVector(derecha, 1.5).addScaledVector(oeste.n, 0.04);
    letras.position.set(p.x, y, p.y);
    letras.castShadow = true;
    grupo.add(letras);
  }

  return { grupo, solidos, pared };
}
