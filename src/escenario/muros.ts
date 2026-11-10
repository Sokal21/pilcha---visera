import * as THREE from 'three';

// Los muros blancos con luces rosas (la base del hotel y el frente del casino), como en las fotos de
// noche: la cara es vertical y lo que va en diagonal es el borde de arriba; las luces, esferas rosas
// que brillan, salpicadas por toda la cara y mucho más tupidas hacia un extremo (el de la entrada).
// La cara lleva placas de piedra con juntas.

const DENSIDAD = 0.3; // luces por metro cuadrado de cara
// Más apagado que blanco: la luna le pega de frente y sobre un muro tan claro las aureolas no se veían.
const BLANCO = 0xa9a6b6;
const PLACA = { ancho: 3, alto: 1.5 };
// La aureola de cada luz. El resplandor general no las agarra: mide lo claro que se ve cada píxel y
// el púrpura se ve oscuro (antes de llegar al umbral, el centro se iba a blanco). Cada luz lleva un
// cuadrado siempre de frente a la cámara con un brillo que se apaga hacia afuera. Sin prueba de
// profundidad (de costado la pared lo cortaba en rectángulos): lo tapa solo lo que esté bastante más
// cerca de la cámara que su luz (una palmera, el personaje), mirando la profundidad de la escena.
const AURA = { tamaño: 7.5, fuerza: 0.85 };
// Cada luz va y viene entre rosa y púrpura, lento y a su ritmo (un ciclo cada RITMO segundos).
// Sin pasar de 1: más brillantes, el tono mapeado los lavaba hacia el blanco.
const COLORES = { rosa: new THREE.Color(1, 0.08, 0.58), purpura: new THREE.Color(0.55, 0.04, 1), brillo: 1 };
const RITMO = { desde: 6, hasta: 18 };
// Las luces no iluminan (son cientos): una sola luz de verdad por muro, un reflector apoyado en el muro
// en el punto más cerca del jugador que lo apunta a él, con el color y la fuerza de las luces de ahí.
// Ilumina al personaje y el piso delante, nunca la pared (queda detrás del reflector): una luz que
// rodeaba al jugador le dejaba un foco a la pared cuando él se le acercaba. Se apaga a medida que el
// jugador se aleja (a `lejos` metros ya no está); la fuerza crece con la distancia para que a él le
// llegue lo mismo.
const REFLEJO = { alcance: 3, fuerza: 0.7, distancia: 9, afuera: 0.15, alto: 1.4, pecho: 1.1, lejos: 6, cerca: 0.7 };
// Las luces son discos: cilindros chatos con la cara hacia afuera del muro, medio metidos en él, cada
// uno dentro de un aro del material del muro que sobresale más que el disco (la luz queda contenida).
const DISCO = { espesor: 0.07 };
// El perfil del aro, en las medidas del disco (radio 1; alto en espesores, el muro en -0,25): por
// dentro pegado al disco, sale hasta 1,2 (el disco llega a 0,5) y por fuera baja en declive.
const ARO = [[1.0, -0.25], [1.0, 1.2], [1.16, 1.2], [1.32, -0.25]].map(([x, y]) => new THREE.Vector2(x, y));
const ARO_AFUERA = 1.32; // el radio de afuera del aro, en radios del disco
const SEPARACION = 0.12; // metros entre aro y aro, como mínimo

const SHADER_AURA = {
  uniforms: {
    fuerza: { value: AURA.fuerza },
    tDepth: { value: null as THREE.Texture | null },
    cerca: { value: 0.05 },
    lejos: { value: 200 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vColor;
    varying float vCentro, vRadio;
    void main() {
      vUv = uv;
      vColor = instanceColor;
      vec4 centro = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vCentro = centro.z;
      float radio = length(instanceMatrix[0].xyz) * ${AURA.tamaño.toFixed(1)};
      vRadio = radio * 0.5;
      centro.xy += position.xy * radio;
      gl_Position = projectionMatrix * centro;
    }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform float fuerza, cerca, lejos;
    uniform sampler2D tDepth;
    varying vec2 vUv;
    varying vec3 vColor;
    varying float vCentro, vRadio;
    void main() {
      float d = length(vUv - 0.5) * 2.0;
      float a = pow(max(0.0, 1.0 - d), 1.7) * fuerza;
      // Lo que hay en este píxel, contra la luz: más cerca que ella por más que el radio del brillo
      // (la pared alrededor, vista de costado, puede estar hasta eso más cerca) la tapa.
      float z = texture2D(tDepth, gl_FragCoord.xy / vec2(textureSize(tDepth, 0))).x;
      float delante = perspectiveDepthToViewZ(z, cerca, lejos) - vCentro;
      a *= 1.0 - smoothstep(vRadio + 0.2, vRadio + 0.7, delante);
      gl_FragColor = vec4(vColor * a, a);
    }`,
};

/** La profundidad de la escena (la pasada de normales) contra la que se tapan las aureolas. */
export function profundidadAuras(textura: THREE.Texture, camara: THREE.PerspectiveCamera): void {
  SHADER_AURA.uniforms.tDepth.value = textura;
  SHADER_AURA.uniforms.cerca.value = camara.near;
  SHADER_AURA.uniforms.lejos.value = camara.far;
}

export interface Muro {
  /** La línea de la cara, en metros. */
  linea: THREE.Vector2[];
  /** Un punto del lado de adentro (el edificio). */
  adentro: THREE.Vector2;
  /** El alto en cada punto de la línea. */
  altos: number[];
  /** De la cara hacia adentro; 0: no hay muro, las luces van sobre la fachada que marca la línea. */
  fondo: number;
  /** Hacia dónde se amontonan las luces a lo largo de la línea: 1 parejo, más de 1 hacia el final,
   * menos de 1 hacia el principio. */
  sesgo: number;
  semilla: number;
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

/** Placas de piedra con juntas, para repetir cada PLACA. Con `porMetro`, ya escalada para
 * coordenadas de textura en metros (las de los bloques extruidos). */
export function texturaPlacas(porMetro = false): THREE.CanvasTexture {
  const w = 192;
  const h = 96;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#d2cfd8';
  g.fillRect(0, h - 3, w, 3);
  g.fillRect(w - 3, 0, 3, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (porMetro) t.repeat.set(1 / PLACA.ancho, 1 / PLACA.alto);
  return t;
}

/** Hacia adentro en cada punto de la línea (el promedio de los lados que llegan, a inglete). */
function normalesAdentro(linea: THREE.Vector2[], adentro: THREE.Vector2): THREE.Vector2[] {
  const lado = (a: THREE.Vector2, b: THREE.Vector2) => {
    const n = new THREE.Vector2(b.y - a.y, a.x - b.x).normalize();
    return n.dot(adentro.clone().sub(a)) < 0 ? n.negate() : n;
  };
  return linea.map((p, i) => {
    const ns = [];
    if (i > 0) ns.push(lado(linea[i - 1], p));
    if (i < linea.length - 1) ns.push(lado(p, linea[i + 1]));
    const suma = ns.reduce((s, n) => s.add(n), new THREE.Vector2()).normalize();
    return suma.multiplyScalar(1 / Math.max(0.3, suma.dot(ns[0])));
  });
}

/** `transparentes`: lo que no va en la pasada de normales del contorno (las aureolas); `animar`: cada
 * cuadro, con el tiempo en segundos, para el color de las luces. */
export function armarMuro(m: Muro): {
  grupo: THREE.Group; solidos: THREE.Object3D[]; pared: THREE.Vector2[] | null; transparentes: THREE.Object3D[]; soloNormales: THREE.Object3D[];
  animar: (t: number, jugador?: THREE.Vector3) => void;
} {
  const grupo = new THREE.Group();
  const solidos: THREE.Object3D[] = [];
  const ns = normalesAdentro(m.linea, m.adentro);
  // Lo recorrido a lo largo de la línea hasta cada punto (para las placas y para repartir las luces).
  const recorrido = [0];
  for (let i = 1; i < m.linea.length; i++) recorrido.push(recorrido[i - 1] + m.linea[i - 1].distanceTo(m.linea[i]));
  const total = recorrido[recorrido.length - 1];

  let pared: THREE.Vector2[] | null = null;
  if (m.fondo > 0) {
    // Cada corte: abajo y arriba en la cara, arriba y abajo atrás. La cara con coordenadas de
    // textura en metros (a lo largo, alto), para las placas.
    const cortes = m.linea.map((p, i) => {
      const atras = p.clone().addScaledVector(ns[i], m.fondo);
      return [
        new THREE.Vector3(p.x, 0, p.y), new THREE.Vector3(p.x, m.altos[i], p.y),
        new THREE.Vector3(atras.x, m.altos[i], atras.y), new THREE.Vector3(atras.x, 0, atras.y),
      ];
    });
    const pos: number[] = [];
    const uv: number[] = [];
    const tri = (v: THREE.Vector3[], t: number[][]) => {
      for (let k = 0; k < 3; k++) {
        pos.push(v[k].x, v[k].y, v[k].z);
        uv.push(t[k][0] / PLACA.ancho, t[k][1] / PLACA.alto);
      }
    };
    const cuad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ua: number, ub: number) => {
      tri([a, b, c], [[ua, a.y], [ub, b.y], [ub, c.y]]);
      tri([a, c, d], [[ua, a.y], [ub, c.y], [ua, d.y]]);
    };
    for (let i = 1; i < cortes.length; i++) {
      const [a0, a1, a2, a3] = cortes[i - 1];
      const [b0, b1, b2, b3] = cortes[i];
      const ua = recorrido[i - 1];
      const ub = recorrido[i];
      cuad(a0, b0, b1, a1, ua, ub);
      cuad(a1, b1, b2, a2, ua, ub);
      cuad(a2, b2, b3, a3, ua, ub);
    }
    const [c0, c1, c2, c3] = cortes[0];
    cuad(c0, c1, c2, c3, 0, m.fondo);
    const [d0, d1, d2, d3] = cortes[cortes.length - 1];
    cuad(d0, d3, d2, d1, 0, m.fondo);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const muro = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: BLANCO, map: texturaPlacas(), roughness: 0.85, side: THREE.DoubleSide,
    }));
    muro.castShadow = muro.receiveShadow = true;
    grupo.add(muro);
    solidos.push(muro);
    pared = [...cortes.map((c) => new THREE.Vector2(c[0].x, c[0].z)), ...cortes.map((c) => new THREE.Vector2(c[3].x, c[3].z)).reverse()];
  }

  // Las luces: cada una en un punto de la línea (amontonadas según `sesgo`) y a cualquier altura de la
  // cara, apenas salidas de ella.
  const r = azar(m.semilla);
  const alturaMedia = m.altos.reduce((s, h) => s + h, 0) / m.altos.length;
  const buscadas = Math.round(total * alturaMedia * DENSIDAD);
  // Sin encimarse: cada una a lo largo (s) y en alto (y) sobre la cara; la que cae sobre otra (con
  // los aros y un margen) se vuelve a tirar, y si después de varios intentos no hay lugar, no va.
  const puestas: { s: number; y: number; radio: number }[] = [];
  for (let k = 0; k < buscadas; k++) {
    for (let intento = 0; intento < 12; intento++) {
      const s = Math.pow(r(), 1 / m.sesgo) * total;
      let i = 1;
      while (i < recorrido.length - 1 && recorrido[i] < s) i++;
      const t = (s - recorrido[i - 1]) / Math.max(1e-6, recorrido[i] - recorrido[i - 1]);
      const alto = THREE.MathUtils.lerp(m.altos[i - 1], m.altos[i], t);
      const radio = 0.13 + 0.12 * r();
      const y = THREE.MathUtils.lerp(0.35, alto - 0.5, r());
      const libre = puestas.every((o) => Math.hypot(o.s - s, o.y - y) > (o.radio + radio) * ARO_AFUERA + SEPARACION);
      if (libre) {
        puestas.push({ s, y, radio });
        break;
      }
    }
  }
  const cuantas = puestas.length;
  const luces = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 1, 20),
    // Sin luz de escena: el color de cada una (instanceColor) es lo que brilla.
    new THREE.MeshBasicMaterial(),
    cuantas,
  );
  const matriz = new THREE.Matrix4();
  const arriba = new THREE.Vector3(0, 1, 0);
  const donde: THREE.Vector3[] = [];
  puestas.forEach(({ s, y, radio }, k) => {
    let i = 1;
    while (i < recorrido.length - 1 && recorrido[i] < s) i++;
    const t = (s - recorrido[i - 1]) / Math.max(1e-6, recorrido[i] - recorrido[i - 1]);
    const p = m.linea[i - 1].clone().lerp(m.linea[i], t);
    const afuera = ns[i - 1].clone().lerp(ns[i], t).normalize().negate();
    const centro = new THREE.Vector3(p.x + afuera.x * DISCO.espesor * 0.25, y, p.y + afuera.y * DISCO.espesor * 0.25);
    donde.push(centro);
    const giro = new THREE.Quaternion().setFromUnitVectors(arriba, new THREE.Vector3(afuera.x, 0, afuera.y));
    matriz.compose(centro, giro, new THREE.Vector3(radio, DISCO.espesor, radio));
    luces.setMatrixAt(k, matriz);
  });
  // Ritmo y fase de cada una.
  const ritmos = Array.from({ length: cuantas }, () => ({
    vel: (Math.PI * 2) / THREE.MathUtils.lerp(RITMO.desde, RITMO.hasta, r()), fase: r() * Math.PI * 2,
  }));
  const tinte = new THREE.Color();
  const reflejo = new THREE.SpotLight(COLORES.rosa, 0, REFLEJO.distancia, 0.7, 1, 2);
  grupo.add(reflejo, reflejo.target);
  let normalCerca = new THREE.Vector2(1, 0);
  const cerca = new THREE.Vector3();
  const mezcla = new THREE.Color();
  const animar = (t: number, jugador?: THREE.Vector3) => {
    // El punto del muro más cerca del jugador.
    let mejor = Infinity;
    if (jugador) {
      for (let i = 1; i < m.linea.length; i++) {
        const a = m.linea[i - 1];
        const ab = m.linea[i].clone().sub(a);
        const u = THREE.MathUtils.clamp(new THREE.Vector2(jugador.x - a.x, jugador.z - a.y).dot(ab) / ab.lengthSq(), 0, 1);
        const q = a.clone().addScaledVector(ab, u);
        const d = Math.hypot(jugador.x - q.x, jugador.z - q.y);
        if (d < mejor) {
          mejor = d;
          cerca.set(q.x, 0, q.y);
          normalCerca = ns[i - 1].clone().lerp(ns[i], u).normalize();
        }
      }
    }
    mezcla.setRGB(0, 0, 0);
    let peso = 0;
    ritmos.forEach((q, k) => {
      tinte.copy(COLORES.rosa).lerp(COLORES.purpura, 0.5 + 0.5 * Math.sin(t * q.vel + q.fase)).multiplyScalar(COLORES.brillo);
      luces.setColorAt(k, tinte);
      if (mejor < Infinity) {
        // Cuánto aporta al reflejo: las que están a menos de REFLEJO.alcance del punto (a lo largo).
        const d = Math.hypot(donde[k].x - cerca.x, donde[k].z - cerca.z);
        const w = Math.max(0, 1 - d / REFLEJO.alcance);
        if (w > 0) {
          mezcla.r += tinte.r * w;
          mezcla.g += tinte.g * w;
          mezcla.b += tinte.b * w;
          peso += w;
        }
      }
    });
    luces.instanceColor!.needsUpdate = true;
    auras.instanceColor = luces.instanceColor;
    if (peso > 0 && jugador && mejor < REFLEJO.lejos) {
      reflejo.color.setRGB(mezcla.r / peso, mezcla.g / peso, mezcla.b / peso);
      // En el muro (apenas por fuera), apuntando al pecho del jugador.
      reflejo.position.set(cerca.x - normalCerca.x * REFLEJO.afuera, jugador.y + REFLEJO.alto, cerca.z - normalCerca.y * REFLEJO.afuera);
      reflejo.target.position.set(jugador.x, jugador.y + REFLEJO.pecho, jugador.z);
      const hasta = Math.max(REFLEJO.cerca, reflejo.position.distanceTo(reflejo.target.position));
      const lejania = 1 - mejor / REFLEJO.lejos;
      reflejo.intensity = REFLEJO.fuerza * Math.min(peso, 6) * (hasta * hasta) / (REFLEJO.cerca * REFLEJO.cerca) * lejania * lejania;
    } else {
      reflejo.intensity = 0;
    }
  };
  const aros = new THREE.InstancedMesh(
    new THREE.LatheGeometry(ARO, 24),
    new THREE.MeshStandardMaterial({ color: BLANCO, roughness: 0.85, side: THREE.DoubleSide }),
    cuantas,
  );
  aros.instanceMatrix.copy(luces.instanceMatrix);
  aros.castShadow = aros.receiveShadow = true;
  const auras = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    ...SHADER_AURA, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }), cuantas);
  auras.instanceMatrix.copy(luces.instanceMatrix);
  auras.frustumCulled = false; // el cuadrado se arma en el shader: la caja de las esferas no lo cubre
  grupo.add(luces, aros, auras);
  animar(0);

  // El contorno, alrededor de la lámpara entera: ni el disco ni el aro van en la pasada de normales
  // (marcaban el borde de adentro, el de afuera y el del disco); en su lugar va una pieza maciza con
  // la silueta de afuera del aro, que solo se dibuja ahí.
  const tapas = new THREE.InstancedMesh(
    // Una cúpula lisa del alto del aro hasta su borde de afuera: sin cantos, el contorno sale solo en
    // la silueta y donde se junta con la pared (con la tapa plana, su canto se dibujaba adentro).
    new THREE.LatheGeometry(Array.from({ length: 9 }, (_, k) => {
      const a = (k / 8) * (Math.PI / 2);
      return new THREE.Vector2(ARO_AFUERA * Math.sin(a), ARO[0].y + (ARO[1].y - ARO[0].y) * Math.cos(a));
    }), 24),
    new THREE.MeshBasicMaterial(),
    cuantas,
  );
  tapas.instanceMatrix.copy(luces.instanceMatrix);
  tapas.visible = false;
  grupo.add(tapas);
  return { grupo, solidos, pared, transparentes: [auras, aros, luces], soloNormales: [tapas], animar };
}
