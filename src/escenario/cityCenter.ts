import * as THREE from 'three';
import plano from './city-center.json';
import { letrasEnRelieve } from './letras';
import { armarHotel } from './hotel';
import { armarMuro, profundidadAuras, texturaPlacas } from './muros';
import { armarEntrada } from './entrada';
import { armarPalmeras, RADIO_PALMERA, vientoPalmeras } from './palmeras';
import { adentroDe, armarPiso, medidorDeCalles, recortarLinea, ubicadorDeVereda } from './piso';
import { armarCantero } from './canteros';

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
const VEREDA_CANTERO = 1.8; // entre el cordón del rulo y el pasto del cantero
const VEREDA_MURO = 0.8; // entre la punta de un muro de luces y el cordón de la calle
/** La luz de las farolas de calle: blanca, apenas fría. */
export const COLOR_FAROLAS = 0xeef2ff;
const LUCES_FAROLAS = 4; // farolas que iluminan de verdad a la vez
const INTENSIDAD_FAROLA = 260;
const FUNDIDO_FAROLA = 6; // metros antes del corte en que la luz se va apagando
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
  /** Lo transparente, que no va en la pasada de normales del contorno. */
  readonly transparentes: THREE.Object3D[] = [];
  /** Lo que solo va en la pasada de normales (la silueta de las lámparas de los muros, para el contorno). */
  readonly soloNormales: THREE.Object3D[] = [];
  private readonly animaciones: ((t: number, jugador?: THREE.Vector3) => void)[] = [];
  /** Dónde arranca el jugador y hacia dónde mira la cámara. */
  readonly inicio: { x: number; z: number; yaw: number };
  readonly niebla = { cerca: 45, lejos: 170 };
  /** De dónde viene la luna: detrás del casino visto desde la entrada (al este-sureste), a 25° del
   * horizonte, para que se vea sobre su techo. */
  readonly luna = new THREE.Vector3(0.61, 0, 0.79).normalize().multiplyScalar(Math.cos(THREE.MathUtils.degToRad(25))).setY(Math.sin(THREE.MathUtils.degToRad(25)));
  private readonly paredes: THREE.Vector2[][] = [];
  private readonly postes: { p: THREE.Vector2; r: number }[] = [];
  private readonly zona: THREE.Vector2[];
  private readonly entrada: ReturnType<typeof armarEntrada>;
  private readonly lucesFarolas: THREE.SpotLight[] = [];

  constructor() {
    const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    // El piso: explanada, pasto, calles con cordones y rayas (src/escenario/piso.ts).
    const calles = (plano.calles as Calle[]).map((c) => ({ eje: c.eje_px.map(m), ancho: c.ancho, cerrada: !!c.cerrada, dobleMano: c.id === 'oeste' }));
    // El cantero sale del rulo que lo rodea (con una elipse la vereda se angostaba hasta desaparecer).
    const rulo = calles[(plano.calles as Calle[]).findIndex((c) => c.id === 'rulo')];
    const verdes = (plano.verdes as Verde[]).map((v) =>
      v.elipse_px ? adentroDe(rulo, VEREDA_CANTERO) : new THREE.Shape(v.poligono_px!.map((p) => m(p)).map((p) => new THREE.Vector2(p.x, -p.y))));
    const piso = armarPiso(
      calles,
      verdes,
      // El cartel de velocidad máxima, en la punta norte del cantero.
      m([232, 330]),
    );
    this.grupo.add(piso.grupo);
    this.solidos.push(...piso.solidos);

    const placas = texturaPlacas(true);
    const colores: Record<string, number> = {
      hotel: 0xc9c9d2, deck: 0xa9a59c, marquesina: 0xeeeef2, casino: 0x96969f, techo_casino: 0xbdbdc8,
    };
    const altos = new Map<string, number>();
    for (const e of plano.edificios as Edificio[]) altos.set(e.id, e.alto);
    for (const e of plano.edificios as Edificio[]) {
      const puntos = e.poligono_px.map(m);
      // Con las placas de piedra de los muros (las coordenadas de textura de la extrusión van en metros).
      const material = mat(colores[e.id] ?? 0xaaaaaa);
      if (!e.techo) material.map = placas;
      if (e.techo) {
        this.marquesina(puntos, e.alto, material);
        continue;
      }
      if (e.id === 'hotel') {
        const hotel = armarHotel(puntos);
        this.grupo.add(hotel.grupo);
        this.solidos.push(...hotel.solidos);
        this.paredes.push(hotel.pared);
        continue;
      }
      const desde = e.sobre ? altos.get(e.sobre)! : 0;
      const malla = bloque(puntos, desde, e.alto - desde, material);
      this.grupo.add(malla);
      this.solidos.push(malla);
      if (!e.sobre) this.paredes.push(puntos);
    }

    // La entrada: la vidriera bajo la marquesina y el hall con sus puertas.
    const en = plano.entrada;
    this.entrada = armarEntrada({
      x: m([en.x_px, 0]).x, desde: m([0, en.desde_px]).y, hasta: m([0, en.hasta_px]).y, alto: en.alto,
      hall: { desde: m([0, en.hall_px.desde]).y, hasta: m([0, en.hall_px.hasta]).y, fondo: (en.hall_px.fondo - en.x_px) * ESC },
    });
    this.grupo.add(this.entrada.grupo);
    this.solidos.push(...this.entrada.solidos);
    this.transparentes.push(...this.entrada.transparentes);
    this.paredes.push(...this.entrada.paredes);

    // Los muros blancos con luces rosas (la base del hotel y el frente del casino).
    // Donde la línea del plano llega a una calle, el muro se corta antes (con vereda hasta el cordón).
    const aCalle = medidorDeCalles(calles);
    plano.muros_luces.forEach((mu, k) => {
      const { linea, altos } = recortarLinea(mu.linea_px.map(m), mu.altos, (p) => aCalle(p) >= VEREDA_MURO);
      const muro = armarMuro({
        linea, adentro: m(mu.adentro_px), altos, fondo: mu.fondo, sesgo: mu.sesgo, semilla: 501 + k,
      });
      this.grupo.add(muro.grupo);
      this.solidos.push(...muro.solidos);
      if (muro.pared) this.paredes.push(muro.pared);
      this.transparentes.push(...muro.transparentes);
      this.soloNormales.push(...muro.soloNormales);
      this.animaciones.push(muro.animar);
      // El cantero con arbustos al pie del muro.
      const cantero = armarCantero(linea, m(mu.adentro_px), 901 + k, aCalle);
      this.grupo.add(cantero.grupo);
      this.paredes.push(...cantero.paredes);
    });

    // «Casino» en relieve, rosa e iluminado, sobre el frente del casino (mirando hacia afuera de su
    // primer tramo, el que da a la entrada) y por encima de las lámparas.
    const cartel = plano.carteles.find((c) => c.id === 'casino')!;
    const frente = plano.muros_luces.find((mu) => mu.id === 'luces_casino')!;
    const [fa, fb] = [m(frente.linea_px[0]), m(frente.linea_px[1])];
    let afuera = new THREE.Vector2(fb.y - fa.y, fa.x - fb.x).normalize();
    const lugarCartel = m(cartel.px);
    if (afuera.dot(m(frente.adentro_px).sub(lugarCartel)) > 0) afuera = afuera.negate();
    const letrasCasino = new THREE.Mesh(letrasEnRelieve(cartel.texto, 3, 0.3, 14, 'pacifico'), new THREE.MeshStandardMaterial({
      color: 0xff7fd6, emissive: 0xff3cbf, emissiveIntensity: 1.1, roughness: 0.4,
    }));
    letrasCasino.rotation.y = Math.atan2(afuera.x, afuera.y);
    letrasCasino.position.set(lugarCartel.x + afuera.x * 0.02, cartel.alto, lugarCartel.y + afuera.y * 0.02);
    letrasCasino.castShadow = true;
    this.grupo.add(letrasCasino);

    // Palmeras canarias (src/escenario/palmeras.ts).
    const lugares = plano.palmeras_px.map(m);
    this.grupo.add(armarPalmeras(lugares, 1912, this.solidos, this.transparentes));
    for (const p of lugares) this.postes.push({ p, r: RADIO_PALMERA });

    // Farolas de calle: poste alto, brazo y una lámpara que ilumina para abajo. Sin sombra: cada una
    // volvía a dibujar la escena y en el navegador no se notaba al lado de la de la luna.
    const metal = new THREE.MeshStandardMaterial({ color: 0x9a9ea6, metalness: 0.5, roughness: 0.5 });
    // Luz blanca (las del polígono son cálidas).
    const lamparaMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f7ff, emissiveIntensity: 4 });
    // En la vereda: las que el plano dejaba sobre una calle se corren afuera del cordón; el brazo, hacia la calle.
    const enVereda = ubicadorDeVereda(calles);
    const farolas = plano.farolas_px.map((px) => enVereda(m(px)));
    for (const farola of farolas) {
      const { p, hacia } = farola;
      const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, FAROLA_ALTO, 10), metal);
      poste.position.set(p.x, FAROLA_ALTO / 2, p.y);
      poste.castShadow = true;
      this.grupo.add(poste);
      this.solidos.push(poste);
      this.postes.push({ p, r: 0.15 });
      // El brazo y la lámpara, girados hacia la calle.
      const giro = -Math.atan2(hacia.y, hacia.x);
      const cabeza = new THREE.Vector3(p.x + hacia.x * 1.4, FAROLA_ALTO - 0.15, p.y + hacia.y * 1.4);
      const brazo = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.08), metal);
      brazo.position.set(p.x + hacia.x * 0.7, FAROLA_ALTO - 0.05, p.y + hacia.y * 0.7);
      brazo.rotation.y = giro;
      const lampara = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.28), lamparaMat);
      lampara.position.copy(cabeza);
      lampara.rotation.y = giro;
      this.grupo.add(brazo, lampara);
      this.lamparas.push(cabeza.clone());
    }
    // Las luces de verdad: unas pocas, para las farolas más cerca del jugador (el material calcula todas
    // las luces de la escena en cada píxel: medido en el navegador, con las nueve encendidas el juego
    // bajaba a 40 por segundo, con cuatro andaba a 60). Las demás se ven prendidas igual (la lámpara
    // brilla y tiene su cono), solo no iluminan, y a esa distancia casi no llegaban.
    for (let i = 0; i < LUCES_FAROLAS; i++) {
      const luz = new THREE.SpotLight(COLOR_FAROLAS, 0, 34, 0.75, 0.6, 2);
      this.grupo.add(luz, luz.target);
      this.lucesFarolas.push(luz);
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

  /** La profundidad de la escena, para que las aureolas de las luces se tapen con lo que tienen delante. */
  usarProfundidad(textura: THREE.Texture, camara: THREE.PerspectiveCamera): void {
    profundidadAuras(textura, camara);
  }

  /** Cada cuadro, con el tiempo en segundos y dónde está el jugador (las luces de los muros y su reflejo). */
  actualizar(t: number, jugador: THREE.Vector3): void {
    for (const animar of this.animaciones) animar(t, jugador);
    vientoPalmeras(t);
    this.entrada.actualizar(t, jugador);
    this.repartirLuces(jugador);
  }

  /** Las luces de verdad a las farolas más cerca del jugador. La que se acerca al corte (la distancia
   * de la primera que queda sin luz) se va apagando antes, así el cambio de farola no salta. */
  private repartirLuces(jugador: THREE.Vector3): void {
    const orden = this.lamparas
      .map((l) => ({ l, d: Math.hypot(l.x - jugador.x, l.z - jugador.z) }))
      .sort((a, b) => a.d - b.d);
    const corte = orden[LUCES_FAROLAS]?.d ?? Infinity;
    this.lucesFarolas.forEach((luz, i) => {
      const f = orden[i];
      if (!f) {
        luz.intensity = 0;
        return;
      }
      luz.position.set(f.l.x, f.l.y - 0.06, f.l.z);
      luz.target.position.set(f.l.x, 0, f.l.z);
      luz.intensity = INTENSIDAD_FAROLA * THREE.MathUtils.smoothstep(corte - f.d, 0, FUNDIDO_FAROLA);
    });
  }

  /** Si el jugador puede pararse en (x, z): dentro de la zona y fuera de edificios, palmeras y postes. */
  libre(x: number, z: number): boolean {
    const p = new THREE.Vector2(x, z);
    if (!dentro(p, this.zona) || distanciaBorde(p, this.zona) < RADIO_JUGADOR) return false;
    if (this.entrada.bloquea(x, z, RADIO_JUGADOR)) return false;
    for (const pared of this.paredes) {
      if (dentro(p, pared) || distanciaBorde(p, pared) < RADIO_JUGADOR) return false;
    }
    return !this.postes.some((o) => o.p.distanceTo(p) < o.r + RADIO_JUGADOR);
  }
}
