import * as THREE from 'three';

// Los canteros al pie de los muros de luces, como en las fotos: un borde bajo de hormigón a lo largo
// del muro, tierra adentro y arbustos redondeados de varios tamaños y verdes, apretados. Todos los
// arbustos van en una malla instanciada.

const CANTERO = { separa: 0.1, ancho: 1.3, alto: 0.32, borde: 0.12, tierra: 0.26 };
const ARBUSTO = { cada: 0.55, radio: { desde: 0.32, hasta: 0.62 } };
const PASO = 0.3; // metros entre cortes a lo largo del muro
const MARGEN = 0.6; // vereda que queda entre el cantero y el cordón de la calle
const MINIMO = 0.5; // el cantero más angosto que vale la pena

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

/** Hacia afuera (lejos de `adentro`) en cada punto de la línea, a inglete. */
function normalesAfuera(linea: THREE.Vector2[], adentro: THREE.Vector2): THREE.Vector2[] {
  const lado = (a: THREE.Vector2, b: THREE.Vector2) => {
    const n = new THREE.Vector2(b.y - a.y, a.x - b.x).normalize();
    return n.dot(adentro.clone().sub(a)) > 0 ? n.negate() : n;
  };
  return linea.map((p, i) => {
    const ns = [];
    if (i > 0) ns.push(lado(linea[i - 1], p));
    if (i < linea.length - 1) ns.push(lado(p, linea[i + 1]));
    const suma = ns.reduce((s, n) => s.add(n), new THREE.Vector2()).normalize();
    return suma.multiplyScalar(1 / Math.max(0.3, suma.dot(ns[0])));
  });
}

function levantar(poligono: THREE.Vector2[], desde: number, alto: number, material: THREE.Material): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(poligono.map((p) => new THREE.Vector2(p.x, -p.y))), { depth: alto, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, desde, 0);
  const malla = new THREE.Mesh(geo, material);
  malla.castShadow = malla.receiveShadow = true;
  return malla;
}

/** Un punto a lo largo de la línea del muro: dónde está, hacia afuera, y hasta dónde llega el cantero
 * ahí (lo corta la calle). */
interface Corte { p: THREE.Vector2; n: THREE.Vector2; hasta: number }

/** Un cantero a lo largo de `linea` (la cara del muro), del lado contrario a `adentro`. `calle`: cuánto
 * hay de un punto a la calle más cercana; donde la calle se acerca, el borde de afuera sigue su curva
 * (con `MARGEN` de vereda) y donde no entra, el cantero se corta. `paredes`: sus plantas, para chocar. */
export function armarCantero(linea: THREE.Vector2[], adentro: THREE.Vector2, semilla: number, calle: (p: THREE.Vector2) => number) {
  const grupo = new THREE.Group();
  const ns = normalesAfuera(linea, adentro);
  const a = CANTERO.separa;
  const b = CANTERO.separa + CANTERO.ancho;
  const hormigon = new THREE.MeshStandardMaterial({ color: 0xb4b1aa, roughness: 0.9 });
  const materialTierra = new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: 1 });

  // A lo largo, cada PASO: hasta dónde llega afuera sin meterse en la calle.
  const cortes: Corte[] = [];
  for (let i = 1; i < linea.length; i++) {
    const largo = linea[i - 1].distanceTo(linea[i]);
    const pasos = Math.max(1, Math.round(largo / PASO));
    for (let k = i === 1 ? 0 : 1; k <= pasos; k++) {
      const t = k / pasos;
      const p = linea[i - 1].clone().lerp(linea[i], t);
      const n = ns[i - 1].clone().lerp(ns[i], t);
      let hasta = b;
      while (hasta > a && calle(p.clone().addScaledVector(n, hasta)) < MARGEN) hasta -= 0.05;
      cortes.push({ p, n, hasta });
    }
  }
  // Tramos seguidos donde entra (al menos MINIMO de ancho).
  const tramos: Corte[][] = [];
  let actual: Corte[] = [];
  for (const c of cortes) {
    if (c.hasta - a >= MINIMO) actual.push(c);
    else if (actual.length) {
      tramos.push(actual);
      actual = [];
    }
  }
  if (actual.length) tramos.push(actual);

  const paredes: THREE.Vector2[][] = [];
  const r = azar(semilla);
  const lugares: { p: THREE.Vector3; radio: number; tono: THREE.Color }[] = [];
  for (const tramo of tramos.filter((t) => t.length > 1)) {
    const en = (c: Corte, d: number) => c.p.clone().addScaledVector(c.n, d);
    const planta = [...tramo.map((c) => en(c, a)), ...tramo.map((c) => en(c, c.hasta)).reverse()];
    paredes.push(planta);
    grupo.add(levantar(planta, 0, CANTERO.tierra, materialTierra));
    // El borde: adentro, afuera (siguiendo el corte) y las dos puntas.
    grupo.add(levantar([...tramo.map((c) => en(c, a)), ...tramo.map((c) => en(c, a + CANTERO.borde)).reverse()], 0, CANTERO.alto, hormigon));
    grupo.add(levantar([...tramo.map((c) => en(c, c.hasta - CANTERO.borde)), ...tramo.map((c) => en(c, c.hasta)).reverse()], 0, CANTERO.alto, hormigon));
    for (const [c, otro] of [[tramo[0], tramo[1]], [tramo[tramo.length - 1], tramo[tramo.length - 2]]]) {
      const dentro = otro.p.clone().sub(c.p).normalize().multiplyScalar(CANTERO.borde);
      grupo.add(levantar([en(c, a), en(c, c.hasta), en(c, c.hasta).add(dentro), en(c, a).add(dentro)], 0, CANTERO.alto, hormigon));
    }
    // Los arbustos, uno cada tanto con algo de desorden, entre los bordes.
    let falta = ARBUSTO.cada / 2;
    for (let k = 1; k < tramo.length; k++) {
      falta -= tramo[k - 1].p.distanceTo(tramo[k].p);
      if (falta > 0) continue;
      falta = ARBUSTO.cada * (0.75 + r() * 0.5);
      const c = tramo[k];
      const ancho = c.hasta - a;
      const radio = Math.min(THREE.MathUtils.lerp(ARBUSTO.radio.desde, ARBUSTO.radio.hasta, r()), ancho * 0.55);
      const cuanto = THREE.MathUtils.lerp(a + radio * 0.6, c.hasta - radio * 0.6, r());
      const q = en(c, THREE.MathUtils.clamp(cuanto, a + 0.15, c.hasta - 0.15));
      const tono = new THREE.Color().setHSL(0.27 + r() * 0.06, 0.35 + r() * 0.15, 0.17 + r() * 0.08);
      lugares.push({ p: new THREE.Vector3(q.x, CANTERO.tierra + radio * 0.45, q.y), radio, tono });
    }
  }
  // Una bola facetada y despareja, aplastada: se lee como arbusto con la luz en franjas.
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const rr = azar(semilla + 1);
  const mover = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const clave = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!mover.has(clave)) mover.set(clave, 0.82 + rr() * 0.3);
    const k = mover.get(clave)!;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.75, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const arbustos = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), lugares.length);
  const matriz = new THREE.Matrix4();
  lugares.forEach((l, i) => {
    const giro = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
    matriz.compose(l.p, giro, new THREE.Vector3(l.radio, l.radio, l.radio));
    arbustos.setMatrixAt(i, matriz);
    arbustos.setColorAt(i, l.tono);
  });
  arbustos.castShadow = arbustos.receiveShadow = true;
  grupo.add(arbustos);

  return { grupo, paredes };
}
