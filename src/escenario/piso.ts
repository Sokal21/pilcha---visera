import * as THREE from 'three';

// El piso del City Center: la explanada de losas de hormigón, el pasto de los canteros y las calles de
// asfalto con cordones a los costados, rayas blancas en los bordes y la punteada del medio en las de
// doble mano. Los cordones y las rayas se cortan donde una calle entra en otra (si no, cruzaban el
// asfalto de la otra). Las texturas, pintadas en lienzos, van a escala: se repiten cada tantos metros.
// Además, el cartel de velocidad máxima.

const LADO_TEXTURA = { asfalto: 4, vereda: 4, pasto: 3 }; // metros que cubre cada textura
const CORDON = { ancho: 0.18, alto: 0.14, color: 0xb9b6ae };
const RAYA = { ancho: 0.12, adentro: 0.35, trazo: 3, hueco: 3 };
const ALTURA = { asfalto: 0.04, raya: 0.052, pasto: 0.02 };
const PASO = 1.2; // metros entre puntos a lo largo de las calles

export interface Calle {
  eje: THREE.Vector2[];
  ancho: number;
  cerrada: boolean;
  /** Doble mano: lleva la punteada del medio. */
  dobleMano: boolean;
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

function lienzo(n: number, pintar: (g: CanvasRenderingContext2D, r: () => number) => void, semilla: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  pintar(c.getContext('2d')!, azar(semilla));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Asfalto: gris oscuro con grano claro y oscuro y algún parche. */
function texturaAsfalto(): THREE.CanvasTexture {
  return lienzo(256, (g, r) => {
    g.fillStyle = '#44464c';
    g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 6; k++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '30,31,35' : '80,82,88'}, 0.12)`;
      g.beginPath();
      g.ellipse(r() * 256, r() * 256, 20 + r() * 50, 15 + r() * 40, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let k = 0; k < 4000; k++) {
      const v = r() < 0.5 ? 25 + r() * 25 : 90 + r() * 60;
      g.fillStyle = `rgb(${v}, ${v}, ${v + 4})`;
      g.fillRect(r() * 256, r() * 256, 1 + r(), 1 + r());
    }
  }, 11);
}

/** Vereda: losas de hormigón de 2 m con juntas. */
function texturaVereda(): THREE.CanvasTexture {
  return lienzo(256, (g, r) => {
    for (const [x, y] of [[0, 0], [128, 0], [0, 128], [128, 128]]) {
      const v = 128 + Math.floor(r() * 14);
      g.fillStyle = `rgb(${v}, ${v - 3}, ${v - 9})`;
      g.fillRect(x, y, 128, 128);
    }
    for (let k = 0; k < 2500; k++) {
      const v = 100 + r() * 70;
      g.fillStyle = `rgba(${v}, ${v}, ${v - 6}, 0.5)`;
      g.fillRect(r() * 256, r() * 256, 1, 1);
    }
    g.fillStyle = '#6d6a64';
    for (const p of [0, 128]) {
      g.fillRect(p, 0, 2, 256);
      g.fillRect(0, p, 256, 2);
    }
  }, 12);
}

/** Pasto: verde con matas más claras y más oscuras. */
function texturaPasto(): THREE.CanvasTexture {
  return lienzo(256, (g, r) => {
    g.fillStyle = '#4b6a39';
    g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 3000; k++) {
      const claro = r() < 0.5;
      g.strokeStyle = claro ? `rgba(110, 145, 80, 0.55)` : `rgba(40, 62, 30, 0.55)`;
      g.lineWidth = 1;
      const x = r() * 256;
      const y = r() * 256;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
      g.stroke();
    }
  }, 13);
}

/** Los puntos de una calle a lo largo de su eje suavizado, con su normal (hacia un costado). */
function recorrer(c: Calle): { p: THREE.Vector2; n: THREE.Vector2; d: number }[] {
  const curva = new THREE.CatmullRomCurve3(c.eje.map((p) => new THREE.Vector3(p.x, 0, p.y)), c.cerrada, 'centripetal');
  const largo = curva.getLength();
  const n = Math.max(8, Math.round(largo / PASO));
  return curva.getSpacedPoints(n).map((p, i) => {
    const t = curva.getTangentAt(Math.min(i / n, 1));
    return { p: new THREE.Vector2(p.x, p.z), n: new THREE.Vector2(-t.z, t.x).normalize(), d: (largo * i) / n };
  });
}

/** Una tira plana a lo largo de los puntos, corrida `desplazamiento` hacia la normal, de `ancho`; con
 * coordenadas de textura en metros (u de costado, v a lo largo). Solo entre puntos con `usar`. */
function tira(
  puntos: { p: THREE.Vector2; n: THREE.Vector2; d: number }[], desplazamiento: number, ancho: number, y: number,
  usar: (i: number) => boolean = () => true,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  let anterior = -1;
  puntos.forEach((q, i) => {
    const base = pos.length / 3;
    const a = q.p.clone().addScaledVector(q.n, desplazamiento - ancho / 2);
    const b = q.p.clone().addScaledVector(q.n, desplazamiento + ancho / 2);
    pos.push(a.x, y, a.y, b.x, y, b.y);
    uv.push(0, q.d, ancho, q.d);
    if (anterior >= 0 && usar(i - 1) && usar(i)) indices.push(anterior, anterior + 1, base, anterior + 1, base + 1, base);
    anterior = base;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(indices);
  return geo;
}

/** Un cordón: un listón bajo a lo largo de los puntos (arriba y los dos costados), solo donde `usar`. */
function cordon(puntos: { p: THREE.Vector2; n: THREE.Vector2; d: number }[], desplazamiento: number, usar: (i: number) => boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const indices: number[] = [];
  puntos.forEach((q, i) => {
    const a = q.p.clone().addScaledVector(q.n, desplazamiento - CORDON.ancho / 2);
    const b = q.p.clone().addScaledVector(q.n, desplazamiento + CORDON.ancho / 2);
    pos.push(a.x, 0, a.y, a.x, CORDON.alto, a.y, b.x, CORDON.alto, b.y, b.x, 0, b.y);
    if (i > 0 && usar(i - 1) && usar(i)) {
      const p0 = (i - 1) * 4;
      const p1 = i * 4;
      for (let k = 0; k < 3; k++) indices.push(p0 + k, p1 + k, p0 + k + 1, p0 + k + 1, p1 + k, p1 + k + 1);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(indices);
  const caras = geo.toNonIndexed();
  caras.computeVertexNormals();
  return caras;
}

/** Un cartel de chapa en un caño: `pintar` dibuja la cara en un lienzo de `w`×`h` píxeles. */
function cartel(lugar: THREE.Vector3, mira: number, ancho: number, alto: number, w: number, h: number, pintar: (g: CanvasRenderingContext2D) => void, redondo = false): THREE.Group {
  const grupo = new THREE.Group();
  const caño = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, lugar.y + alto / 2, 8), new THREE.MeshStandardMaterial({ color: 0x9da1a8, metalness: 0.6, roughness: 0.4 }));
  caño.position.y = (lugar.y + alto / 2) / 2;
  caño.castShadow = true;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  pintar(c.getContext('2d')!);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = 8;
  const cara = new THREE.Mesh(
    redondo ? new THREE.CircleGeometry(ancho / 2, 32) : new THREE.PlaneGeometry(ancho, alto),
    new THREE.MeshStandardMaterial({ map: tx, roughness: 0.5, side: THREE.DoubleSide }),
  );
  cara.position.set(0, lugar.y, 0.05);
  cara.castShadow = true;
  grupo.add(caño, cara);
  grupo.position.set(lugar.x, 0, lugar.z);
  grupo.rotation.y = mira;
  return grupo;
}

/** Lo que encierra una calle cerrada (el rulo alrededor del cantero), metido hacia adentro: medio
 * ancho de calle, el cordón y `vereda` metros. Como forma de three (en x, -z). */
export function adentroDe(calle: Calle, vereda: number): THREE.Shape {
  const puntos = recorrer(calle);
  const centro = puntos.reduce((s, q) => s.add(q.p), new THREE.Vector2()).divideScalar(puntos.length);
  const metido = calle.ancho / 2 + CORDON.ancho + vereda;
  const borde = puntos.slice(0, -1).map((q) => {
    const lado = Math.sign(centro.clone().sub(q.p).dot(q.n)) || 1;
    const p = q.p.clone().addScaledVector(q.n, lado * metido);
    return new THREE.Vector2(p.x, -p.y);
  });
  return new THREE.Shape(borde);
}

/** Cuánto hay desde un punto hasta el borde de afuera del cordón de la calle más cercana (negativo si
 * está sobre una calle o un cordón). */
export function medidorDeCalles(calles: Calle[]) {
  const recorridos = calles.map(recorrer);
  return (p: THREE.Vector2): number => {
    let menor = Infinity;
    recorridos.forEach((r, k) => {
      for (const q of r) menor = Math.min(menor, q.p.distanceTo(p) - calles[k].ancho / 2 - CORDON.ancho);
    });
    return menor;
  };
}

/** La parte de una línea (con un alto en cada punto) entre el primer y el último punto que cumplen
 * `vale`, buscados cada 0,2 m; en las puntas nuevas, los altos interpolados. */
export function recortarLinea(linea: THREE.Vector2[], altos: number[], vale: (p: THREE.Vector2) => boolean) {
  const muestras: { p: THREE.Vector2; alto: number; vertice: boolean }[] = [];
  for (let i = 1; i < linea.length; i++) {
    const pasos = Math.max(1, Math.round(linea[i - 1].distanceTo(linea[i]) / 0.2));
    for (let k = i === 1 ? 0 : 1; k <= pasos; k++) {
      const t = k / pasos;
      muestras.push({ p: linea[i - 1].clone().lerp(linea[i], t), alto: THREE.MathUtils.lerp(altos[i - 1], altos[i], t), vertice: k === pasos || (i === 1 && k === 0) });
    }
  }
  const primero = muestras.findIndex((q) => vale(q.p));
  let ultimo = -1;
  for (let k = muestras.length - 1; k >= 0; k--) if (vale(muestras[k].p)) { ultimo = k; break; }
  if (primero < 0 || ultimo <= primero) return { linea, altos };
  const puntos = muestras.filter((q, k) => k === primero || k === ultimo || (k > primero && k < ultimo && q.vertice));
  return { linea: puntos.map((q) => q.p), altos: puntos.map((q) => q.alto) };
}

/** Para poner cosas en la vereda (las farolas): un punto sobre una calle, o pegado a ella, se corre al
 * costado más cercano, justo afuera del cordón (si ese costado cae sobre otra calle, al otro).
 * `hacia`: hacia la calle, para el brazo. */
export function ubicadorDeVereda(calles: Calle[], afuera = 0.7) {
  const recorridos = calles.map(recorrer);
  const sobreAlguna = (p: THREE.Vector2) => recorridos.some((r, k) => r.some((q) => q.p.distanceTo(p) < calles[k].ancho / 2 + CORDON.ancho));
  return (p: THREE.Vector2): { p: THREE.Vector2; hacia: THREE.Vector2 } => {
    let mejor = { d: Infinity, q: recorridos[0][0], k: 0 };
    recorridos.forEach((r, k) => r.forEach((q) => {
      const d = q.p.distanceTo(p) - calles[k].ancho / 2;
      if (d < mejor.d) mejor = { d, q, k };
    }));
    const { q, k } = mejor;
    const lado = Math.sign(p.clone().sub(q.p).dot(q.n)) || 1;
    const hacia = q.n.clone().multiplyScalar(-lado);
    if (mejor.d > CORDON.ancho + afuera * 0.5 && !sobreAlguna(p)) return { p: p.clone(), hacia };
    const borde = calles[k].ancho / 2 + CORDON.ancho + afuera;
    for (const l of [lado, -lado]) {
      const nuevo = q.p.clone().addScaledVector(q.n, l * borde);
      if (!sobreAlguna(nuevo)) return { p: nuevo, hacia: q.n.clone().multiplyScalar(-l) };
    }
    return { p: q.p.clone().addScaledVector(q.n, lado * borde), hacia };
  };
}

/** El piso entero. `verdes`: las formas de los canteros (en el plano x, -z de las formas de three). */
export function armarPiso(calles: Calle[], verdes: THREE.Shape[], velocidad: THREE.Vector2) {
  const grupo = new THREE.Group();
  const asfalto = texturaAsfalto();
  asfalto.repeat.setScalar(1 / LADO_TEXTURA.asfalto);
  const vereda = texturaVereda();
  vereda.repeat.setScalar(400 / LADO_TEXTURA.vereda);
  const pasto = texturaPasto();
  pasto.repeat.setScalar(1 / LADO_TEXTURA.pasto);

  const piso = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: vereda, roughness: 0.95 }));
  piso.rotation.x = -Math.PI / 2;
  piso.receiveShadow = true;
  grupo.add(piso);

  const materialPasto = new THREE.MeshStandardMaterial({ map: pasto, roughness: 1 });
  for (const forma of verdes) {
    const geo = new THREE.ShapeGeometry(forma, 32);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, ALTURA.pasto, 0);
    const m = new THREE.Mesh(geo, materialPasto);
    m.receiveShadow = true;
    grupo.add(m);
  }

  // Si un punto cae sobre el asfalto de otra calle (ahí no va ni cordón ni raya).
  const recorridos = calles.map(recorrer);
  const sobreOtra = (p: THREE.Vector2, propia: number) =>
    recorridos.some((r, k) => k !== propia && r.some((q) => q.p.distanceTo(p) < calles[k].ancho / 2 - 0.05));

  const materialAsfalto = new THREE.MeshStandardMaterial({ map: asfalto, roughness: 0.9, side: THREE.DoubleSide });
  const blanco = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.7, side: THREE.DoubleSide });
  const materialCordon = new THREE.MeshStandardMaterial({ color: CORDON.color, roughness: 0.9 });
  calles.forEach((c, k) => {
    const puntos = recorridos[k];
    const asf = new THREE.Mesh(tira(puntos, 0, c.ancho, ALTURA.asfalto), materialAsfalto);
    asf.receiveShadow = true;
    grupo.add(asf);
    for (const lado of [-1, 1]) {
      const borde = lado * (c.ancho / 2 + CORDON.ancho / 2);
      const libreCordon = puntos.map((q) => !sobreOtra(q.p.clone().addScaledVector(q.n, borde), k));
      const cor = new THREE.Mesh(cordon(puntos, borde, (i) => libreCordon[i]), materialCordon);
      cor.castShadow = cor.receiveShadow = true;
      grupo.add(cor);
      const enRaya = lado * (c.ancho / 2 - RAYA.adentro);
      const libreRaya = puntos.map((q) => !sobreOtra(q.p.clone().addScaledVector(q.n, enRaya), k));
      grupo.add(new THREE.Mesh(tira(puntos, enRaya, RAYA.ancho, ALTURA.raya, (i) => libreRaya[i]), blanco));
    }
    if (c.dobleMano) {
      const ciclo = RAYA.trazo + RAYA.hueco;
      const libre = puntos.map((q) => !sobreOtra(q.p, k));
      grupo.add(new THREE.Mesh(tira(puntos, 0, RAYA.ancho, ALTURA.raya, (i) => libre[i] && puntos[i].d % ciclo < RAYA.trazo), blanco));
    }
  });

  // Velocidad máxima 10, en la punta del cantero de cara a los que entran al rulo.
  grupo.add(cartel(new THREE.Vector3(velocidad.x, 2, velocidad.y), Math.PI, 0.6, 0.6, 256, 256, (g) => {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(128, 128, 124, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#d01818';
    g.lineWidth = 30;
    g.beginPath();
    g.arc(128, 128, 104, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#111111';
    g.font = 'bold 110px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('10', 128, 136);
  }, true));

  return { grupo, solidos: [piso] };
}
