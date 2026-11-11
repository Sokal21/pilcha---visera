import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as clonarConHuesos } from 'three/addons/utils/SkeletonUtils.js';
import type { CityCenter } from './escenario/cityCenter';
import type { Poligono } from './poligono';
import type { Fogonazo } from './fogonazo';

// Los enemigos: policías federales (public/models/policia.glb, tools/blender/vestir.py --solo) que
// aparecen sin parar por los bordes de la zona, de a uno cada tanto y nunca más de MAXIMO a la vez.
// Te persiguen (lejos corren, cerca caminan con el arma); cuando te tienen a tiro y nada en el medio
// se paran, apuntan y disparan, errando más cuanto más lejos estás. Un tiro en la cabeza los mata,
// en el cuerpo hacen falta CUERPO; al morir caen con su animación y al rato desaparecen.

const MAXIMO = 5;
const CADA = { desde: 3, hasta: 6 }; // segundos entre uno y otro
const LEJOS_PARA_APARECER = 28; // metros del jugador, como mínimo
const RANGO = 16; // desde acá disparan
const CORRE_DESDE = 22; // más lejos que esto, corren
const CUERPO = 4; // tiros al cuerpo que aguantan
const CADENCIA = { desde: 0.9, hasta: 1.7 };
const PUNTERIA = { cerca: 0.6, porMetro: 0.022, minima: 0.15 }; // probabilidad de pegar
const DAÑO = 10;
// Cuánto avanza el pie en cada paso (medido en el modelo del policía, en altos: la velocidad del pie
// apoyado por medio ciclo; la corrida no tiene dos cuadros seguidos con el pie quieto y sale del
// recorrido del pie, con la misma relación que en la del protagonista) y a qué ritmo se reproduce:
// la velocidad sale de los dos, así los pies no patinan. La patrulla es una caminata rápida: a 0,75.
const CAMINATA = { patrulla: { paso: 0.49, ritmo: 0.75 }, corrida: { paso: 0.82, ritmo: 0.9 } };
// Hacia dónde avanzan los pies en cada clip, respecto de hacia dónde mira el modelo (medido en el clip:
// la patrulla camina con el cuerpo de costado). El modelo se gira eso para avanzar hacia donde mira.
const RUMBO: Record<string, number> = { patrulla: THREE.MathUtils.degToRad(20.3) };
// Para rodear lo que se cruza (los troncos): si no puede seguir derecho, prueba girando de a tanto
// hacia un costado, y se queda con ese costado un rato.
const ESQUIVE = { paso: THREE.MathUtils.degToRad(30), intentos: 5, recuerda: 1.2 };
const SE_QUEDA_MUERTO = 8; // segundos tirado antes de desaparecer
const RADIO = 0.4; // para no encimarse entre ellos
const ALTO = 1.75;
const MIRAR_CADA = 0.25; // segundos entre una y otra vez que se fija si te ve
const ARRIBA = new THREE.Vector3(0, 1, 0);

type Estado = 'viene' | 'apunta' | 'muere';

interface Enemigo {
  raiz: THREE.Group;
  mixer: THREE.AnimationMixer;
  acciones: Map<string, THREE.AnimationAction>;
  actual: THREE.AnimationAction | null;
  estado: Estado;
  vida: number;
  mirando: number;
  correccion: number; // cuánto más gira para que el caño apunte al jugador
  desvio: number; // cuánto se gira el modelo para que el clip avance hacia donde va
  ve: boolean; // si ve al jugador (se revisa cada MIRAR_CADA)
  mirarEn: number;
  lado: number; // hacia qué costado está esquivando (1 o -1) y por cuánto más
  esquivando: number;
  enfriamiento: number;
  apuntando: number; // segundos desde que se paró a apuntar
  sinVer: number;
  muertoHace: number;
  cuerpos: THREE.SkinnedMesh[];
  cabeza: THREE.Bone | null;
  pistola: THREE.Object3D | null;
  escala: number;
}

export interface Opciones {
  escena: THREE.Scene;
  ciudad: CityCenter;
  poligono: Poligono;
  fogonazo: Fogonazo;
  /** La boca del caño y hacia dónde apunta, en la malla de la pistola. */
  boca: THREE.Vector3;
  eje: THREE.Vector3;
  /** Cuando una bala le pega al jugador. */
  alPegarte: (daño: number) => void;
  /** Cuando muere uno. */
  alMorir: () => void;
}

export class Enemigos {
  private readonly lista: Enemigo[] = [];
  private molde: THREE.Object3D | null = null;
  private clips: THREE.AnimationClip[] = [];
  private proximo = 2;
  private readonly rayo = new THREE.Raycaster();

  constructor(private readonly o: Opciones) {
    new GLTFLoader().load(`${import.meta.env.BASE_URL}models/policia.glb`, (gltf) => {
      this.molde = gltf.scene;
      this.clips = gltf.animations;
    });
  }

  /** Cuántos hay vivos. */
  get vivos(): number {
    return this.lista.filter((e) => e.estado !== 'muere').length;
  }

  /** Todos afuera (al volver a empezar). */
  reiniciar(): void {
    for (const e of this.lista) this.o.escena.remove(e.raiz);
    this.lista.length = 0;
    this.proximo = 2;
  }

  /** Cada cuadro. `jugador`: dónde está; `vivo`: si hay que perseguirlo y tirarle. */
  actualizar(dt: number, jugador: THREE.Vector3, vivo: boolean): void {
    if (vivo) {
      this.proximo -= dt;
      if (this.proximo <= 0 && this.vivos < MAXIMO && this.molde) {
        this.aparecer(jugador);
        this.proximo = THREE.MathUtils.lerp(CADA.desde, CADA.hasta, Math.random());
      }
    }
    const pecho = jugador.clone().setY(jugador.y + 1.3);
    for (const e of [...this.lista]) {
      e.mixer.update(dt);
      if (e.estado === 'muere') {
        e.muertoHace += dt;
        if (e.muertoHace > SE_QUEDA_MUERTO) {
          this.o.escena.remove(e.raiz);
          this.lista.splice(this.lista.indexOf(e), 1);
        }
        continue;
      }
      const p = e.raiz.position;
      const hacia = new THREE.Vector3(jugador.x - p.x, 0, jugador.z - p.z);
      const d = hacia.length();
      hacia.normalize();
      const suPecho = p.clone().setY(p.y + 1.3 * e.escala);
      // Si lo ve: un rayo contra los edificios, cada tanto (cada uno a su turno), no en cada cuadro.
      e.mirarEn -= dt;
      if (e.mirarEn <= 0) {
        e.ve = d < RANGO + 6 && this.ve(suPecho, pecho);
        e.mirarEn = MIRAR_CADA * (0.8 + Math.random() * 0.4);
      }
      const ve = e.ve;
      e.sinVer = ve ? 0 : e.sinVer + dt;

      if (!vivo) {
        this.pasar(e, 'pistola_reposo', 0.3);
        continue;
      }
      if (e.estado === 'viene') {
        if (d < RANGO && ve) {
          e.estado = 'apunta';
          e.apuntando = 0;
          e.enfriamiento = 0.5 + Math.random() * 0.6;
          this.pasar(e, 'pistola_reposo', 0.2);
          continue;
        }
        const corre = d > CORRE_DESDE;
        const clip = corre ? 'corrida' : 'patrulla';
        this.pasar(e, clip, 0.25);
        // Hacia el jugador, apartándose de los otros.
        const quiere = hacia.clone();
        for (const otro of this.lista) {
          if (otro === e || otro.estado === 'muere') continue;
          const lejos = p.distanceTo(otro.raiz.position);
          if (lejos < RADIO * 4 && lejos > 1e-3) quiere.add(p.clone().sub(otro.raiz.position).setY(0).multiplyScalar(0.8 / lejos));
        }
        quiere.normalize();
        const fue = this.caminar(e, quiere, this.velocidad(e, clip) * dt, dt);
        e.mirando = girarHacia(e.mirando, Math.atan2(fue.x, fue.z), dt * 8);
        e.correccion = THREE.MathUtils.damp(e.correccion, 0, 6, dt);
        e.desvio = THREE.MathUtils.damp(e.desvio, RUMBO[clip] ?? 0, 8, dt);
        e.raiz.rotation.y = e.mirando - e.desvio;
      } else {
        // Apuntando: de frente al jugador, con el caño corregido para que le apunte de verdad.
        if (d > RANGO + 4 || e.sinVer > 0.8) {
          e.estado = 'viene';
          continue;
        }
        e.apuntando += dt;
        e.desvio = THREE.MathUtils.damp(e.desvio, 0, 8, dt);
        e.mirando = girarHacia(e.mirando, Math.atan2(hacia.x, hacia.z), dt * 10);
        const caño = this.caño(e);
        if (caño) {
          const lado = Math.atan2(hacia.x, hacia.z) - Math.atan2(caño.dir.x, caño.dir.z);
          e.correccion = THREE.MathUtils.clamp(e.correccion + Math.atan2(Math.sin(lado), Math.cos(lado)) * Math.min(1, dt * 8), -1.5, 1.5);
        }
        e.raiz.rotation.y = e.mirando + e.correccion;
        e.enfriamiento -= dt;
        if (e.enfriamiento <= 0 && e.apuntando > 0.4 && ve) {
          this.disparar(e, pecho, d);
          e.enfriamiento = THREE.MathUtils.lerp(CADENCIA.desde, CADENCIA.hasta, Math.random());
        }
      }
    }
  }

  /** Un tiro del jugador: si le pega a alguno antes que a `hasta` metros, le hace daño (en la cabeza
   * lo mata). Devuelve dónde pegó, o null si no le pegó a ninguno. */
  impacto(origen: THREE.Vector3, dir: THREE.Vector3, hasta: number): { punto: THREE.Vector3; cabeza: boolean; mato: boolean } | null {
    this.rayo.set(origen, dir);
    this.rayo.far = hasta;
    let mejor: { e: Enemigo; hit: THREE.Intersection } | null = null;
    for (const e of this.lista) {
      if (e.estado === 'muere') continue;
      for (const hit of this.rayo.intersectObjects(e.cuerpos, false)) {
        if (!mejor || hit.distance < mejor.hit.distance) mejor = { e, hit };
        break;
      }
    }
    if (!mejor) return null;
    const { e, hit } = mejor;
    const cabezaY = e.cabeza ? e.cabeza.getWorldPosition(new THREE.Vector3()).y : Infinity;
    const cabeza = hit.point.y > cabezaY - 0.04;
    e.vida -= cabeza ? CUERPO : 1;
    const mato = e.vida <= 0;
    if (mato) this.morir(e);
    else if (e.estado === 'viene') {
      // Le tiraron: se para a contestar.
      e.estado = 'apunta';
      e.apuntando = 0;
      e.enfriamiento = 0.4;
      this.pasar(e, 'pistola_reposo', 0.15);
    }
    return { punto: hit.point, cabeza, mato };
  }

  private aparecer(jugador: THREE.Vector3): void {
    const zona = this.o.ciudad.zonaJugable;
    // Un punto de los bordes de la zona, metido unos metros, libre y lejos del jugador.
    for (let intento = 0; intento < 40; intento++) {
      const borde = Math.floor(Math.random() * 4);
      const t = Math.random();
      const a = zona[borde];
      const b = zona[(borde + 1) % zona.length];
      const centro = zona.reduce((s, q) => s.add(q), new THREE.Vector2()).divideScalar(zona.length);
      const q = a.clone().lerp(b, t);
      q.add(centro.clone().sub(q).normalize().multiplyScalar(3));
      if (!this.o.ciudad.libre(q.x, q.y)) continue;
      if (Math.hypot(q.x - jugador.x, q.y - jugador.z) < LEJOS_PARA_APARECER) continue;
      this.lista.push(this.armar(new THREE.Vector3(q.x, 0, q.y), jugador));
      return;
    }
  }

  private armar(lugar: THREE.Vector3, jugador: THREE.Vector3): Enemigo {
    const modelo = clonarConHuesos(this.molde!);
    const escala = ALTO * (0.97 + Math.random() * 0.08);
    modelo.scale.setScalar(escala);
    const cuerpos: THREE.SkinnedMesh[] = [];
    let cabeza: THREE.Bone | null = null;
    let pistola: THREE.Object3D | null = null;
    modelo.traverse((x) => {
      if ((x as THREE.Mesh).isMesh) {
        x.castShadow = true;
        x.frustumCulled = false;
        if ((x as THREE.SkinnedMesh).isSkinnedMesh) cuerpos.push(x as THREE.SkinnedMesh);
      }
      if (x.name === 'ropa_pistola') pistola = x;
      if ((x as THREE.Bone).isBone && x.name === 'Head') cabeza = x as THREE.Bone;
    });
    const raiz = new THREE.Group();
    raiz.add(modelo);
    raiz.position.copy(lugar);
    this.o.escena.add(raiz);
    const mixer = new THREE.AnimationMixer(modelo);
    const acciones = new Map<string, THREE.AnimationAction>();
    for (const clip of this.clips) acciones.set(clip.name, mixer.clipAction(clip));
    const muerte = acciones.get('muerte');
    if (muerte) {
      muerte.setLoop(THREE.LoopOnce, 1);
      muerte.clampWhenFinished = true;
    }
    for (const [nombre, c] of Object.entries(CAMINATA)) acciones.get(nombre)?.setEffectiveTimeScale(c.ritmo);
    const mirando = Math.atan2(jugador.x - lugar.x, jugador.z - lugar.z);
    raiz.rotation.y = mirando;
    const e: Enemigo = {
      raiz, mixer, acciones, actual: null, estado: 'viene', vida: CUERPO, mirando, correccion: 0, desvio: 0, ve: false, mirarEn: Math.random() * MIRAR_CADA, lado: 1, esquivando: 0,
      enfriamiento: 1, apuntando: 0, sinVer: 0, muertoHace: 0, cuerpos, cabeza, pistola, escala,
    };
    this.pasar(e, 'corrida', 0);
    return e;
  }

  private pasar(e: Enemigo, nombre: string, fundido: number): void {
    const accion = e.acciones.get(nombre);
    if (!accion || accion === e.actual) return;
    accion.reset().play();
    if (e.actual && fundido > 0) accion.crossFadeFrom(e.actual, fundido, false);
    else if (e.actual) e.actual.stop();
    e.actual = accion;
  }

  private velocidad(e: Enemigo, clip: keyof typeof CAMINATA): number {
    const accion = e.acciones.get(clip);
    if (!accion) return 1.5;
    const c = CAMINATA[clip];
    return (2 * c.paso * e.escala * c.ritmo) / accion.getClip().duration;
  }

  /** Si de `desde` se ve `hasta`: nada de los edificios en el medio. */
  private ve(desde: THREE.Vector3, hasta: THREE.Vector3): boolean {
    const dir = hasta.clone().sub(desde);
    const largo = dir.length();
    this.rayo.set(desde, dir.normalize());
    this.rayo.far = largo - 0.3;
    return this.rayo.intersectObjects(this.o.ciudad.tapanLaVista, false).length === 0;
  }

  /** Sin meterse en paredes ni troncos: si no puede derecho, prueba girando hacia el costado que viene
   * esquivando (o el otro), cada vez más abierto. Devuelve hacia dónde fue. */
  private caminar(e: Enemigo, hacia: THREE.Vector3, distancia: number, dt: number): THREE.Vector3 {
    const p = e.raiz.position;
    const ciudad = this.o.ciudad;
    const probar = (dir: THREE.Vector3) => {
      const x = p.x + dir.x * distancia;
      const z = p.z + dir.z * distancia;
      if (!ciudad.libre(x, z)) return false;
      p.set(x, p.y, z);
      return true;
    };
    e.esquivando = Math.max(0, e.esquivando - dt);
    if (probar(hacia)) return hacia;
    if (e.esquivando <= 0) e.lado = Math.random() < 0.5 ? 1 : -1;
    for (let k = 1; k <= ESQUIVE.intentos; k++) {
      for (const lado of [e.lado, -e.lado]) {
        const dir = hacia.clone().applyAxisAngle(ARRIBA, lado * k * ESQUIVE.paso);
        if (probar(dir)) {
          e.lado = lado;
          e.esquivando = ESQUIVE.recuerda;
          return dir;
        }
      }
    }
    return hacia;
  }

  /** La boca del caño y hacia dónde apunta, en el mundo. */
  private caño(e: Enemigo): { boca: THREE.Vector3; dir: THREE.Vector3 } | null {
    if (!e.pistola) return null;
    e.pistola.updateWorldMatrix(true, false);
    return {
      boca: this.o.boca.clone().applyMatrix4(e.pistola.matrixWorld),
      dir: this.o.eje.clone().transformDirection(e.pistola.matrixWorld),
    };
  }

  private disparar(e: Enemigo, pecho: THREE.Vector3, d: number): void {
    const caño = this.caño(e);
    if (!caño) return;
    this.o.fogonazo.disparar(caño.boca, caño.dir);
    const pega = Math.random() < Math.max(PUNTERIA.minima, PUNTERIA.cerca - d * PUNTERIA.porMetro);
    if (pega) {
      this.o.poligono.trazo(caño.boca, pecho);
      this.o.alPegarte(DAÑO);
      return;
    }
    // Errado: pasa cerca del jugador y pega en lo que haya detrás.
    const errado = pecho.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.4, (Math.random() - 0.3) * 1.2, (Math.random() - 0.5) * 2.4));
    const dir = errado.sub(caño.boca).normalize();
    const hit = this.o.poligono.disparar(caño.boca, dir);
    this.o.poligono.trazo(caño.boca, hit ? hit.punto : caño.boca.clone().addScaledVector(dir, 40));
  }

  private morir(e: Enemigo): void {
    e.estado = 'muere';
    e.muertoHace = 0;
    e.raiz.rotation.y = e.mirando;
    this.pasar(e, 'muerte', 0.12);
    this.o.alMorir();
  }
}

/** De `desde` hacia `hasta` (ángulos), por el camino corto, a lo sumo `paso`. */
function girarHacia(desde: number, hasta: number, paso: number): number {
  const d = Math.atan2(Math.sin(hasta - desde), Math.cos(hasta - desde));
  return desde + THREE.MathUtils.clamp(d, -paso, paso);
}
