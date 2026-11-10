import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Desenfoque de movimiento de la cámara cuando gira con el mouse, como en los juegos en tercera
// persona (y como lo hacen Unreal y los filtros de reconstrucción de McGuire):
// - la cámara orbita alrededor del personaje: el giro se mide alrededor de ese punto, así el
//   personaje queda casi quieto en pantalla (nítido) y se barre el fondo. Caminar, el acercamiento al
//   apuntar y el retroceso del tiro no cuentan (`antes` recibe el giro del mouse y el punto);
// - obturador de cine: cuánto se barre es lo que la imagen recorre en `cantidad` de un cuadro a 30
//   por segundo (0,5 = obturador de 180°), igual a cualquier velocidad de cuadro, con un tope de
//   MAXIMO del ancho de la pantalla;
// - las muestras se corren con ruido (interleaved gradient noise): un grano en vez de copias;
// - un píxel del fondo no toma color de lo que tiene delante (el personaje no deja estela).

const MUESTRAS = 16;
const CUADRO_REFERENCIA = 1 / 30;
const MAXIMO = 0.05;

const SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    vistaInversa: { value: new THREE.Matrix4() },
    vistaAhora: { value: new THREE.Matrix4() },
    vistaAntes: { value: new THREE.Matrix4() },
    escala: { value: 0 },
    cerca: { value: 0.05 },
    lejos: { value: 200 },
    resolucion: { value: new THREE.Vector2(1, 1) },
    cuadro: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse, tDepth;
    uniform mat4 vistaInversa, vistaAhora, vistaAntes;
    uniform float escala, cerca, lejos, cuadro;
    uniform vec2 resolucion;
    varying vec2 vUv;

    float distancia(vec2 uv) {
      return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cerca, lejos);
    }

    // Interleaved gradient noise (Jimenez), distinto en cada cuadro.
    float ruido(vec2 p) {
      p += 5.588238 * mod(cuadro, 64.0);
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      float z = texture2D(tDepth, vUv).x;
      vec4 mundo = vistaInversa * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
      mundo /= mundo.w;
      vec4 a = vistaAhora * mundo;
      vec4 b = vistaAntes * mundo;
      vec2 recorrido = (a.xy / a.w - b.xy / b.w) * 0.5 * escala;
      // El tope, medido en anchos de pantalla.
      float largo = length(recorrido * vec2(1.0, resolucion.y / resolucion.x));
      if (largo > ${MAXIMO.toFixed(3)}) recorrido *= ${MAXIMO.toFixed(3)} / largo;
      vec3 centro = texture2D(tDiffuse, vUv).rgb;
      if (length(recorrido * resolucion) < 0.5) { gl_FragColor = vec4(centro, 1.0); return; }
      float aca = distancia(vUv);
      float salto = ruido(gl_FragCoord.xy) - 0.5;
      vec3 suma = centro;
      float peso = 1.0;
      for (int i = 0; i < ${MUESTRAS}; i++) {
        float t = (float(i) + 0.5 + salto) / float(${MUESTRAS}) - 0.5;
        vec2 uv = vUv + recorrido * t;
        // Lo que está bastante más cerca que este píxel no se le mezcla.
        float w = smoothstep(-0.6, -0.15, distancia(uv) - aca);
        suma += texture2D(tDiffuse, uv).rgb * w;
        peso += w;
      }
      gl_FragColor = vec4(suma / peso, 1.0);
    }`,
};

export class Movimiento {
  readonly paso = new ShaderPass(SHADER);
  private readonly giroAnterior = new THREE.Quaternion();
  private primera = true;
  private obturador = 0.5;

  constructor(profundidad: THREE.Texture) {
    this.paso.uniforms.tDepth.value = profundidad;
  }

  /** Cuánto de un cuadro a 30 por segundo queda abierto el obturador (0,5 = 180°). */
  get cantidad(): number {
    return this.obturador;
  }

  set cantidad(v: number) {
    this.obturador = v;
    this.paso.enabled = v > 0;
  }

  /** Con la cámara quieta la pasada se saltea entera (era una pasada de pantalla completa para nada). */
  private quieta(giro: THREE.Quaternion): boolean {
    return this.giroAnterior.angleTo(giro) < 1e-5;
  }

  /** Antes de dibujar el cuadro. `giro`: el de la cámara por el mouse (sin el retroceso); `foco` y
   * `distancia`: el punto alrededor del que orbita y a qué distancia está; `dt`: lo que duró el cuadro. */
  antes(camara: THREE.PerspectiveCamera, giro: THREE.Quaternion, foco: THREE.Vector3, distancia: number, dt: number, resolucion: THREE.Vector2): void {
    camara.updateMatrixWorld();
    if (this.primera) {
      this.giroAnterior.copy(giro);
      this.primera = false;
    }
    // La cámara puesta donde la deja ese giro alrededor del foco (mira por su -Z).
    const vista = (q: THREE.Quaternion) => {
      const lugar = new THREE.Vector3(0, 0, distancia).applyQuaternion(q).add(foco);
      const mundo = new THREE.Matrix4().compose(lugar, q, new THREE.Vector3(1, 1, 1));
      return new THREE.Matrix4().multiplyMatrices(camara.projectionMatrix, mundo.invert());
    };
    this.paso.enabled = this.obturador > 0 && !this.quieta(giro);
    const u = this.paso.uniforms;
    u.vistaInversa.value.multiplyMatrices(camara.projectionMatrix, camara.matrixWorldInverse).invert();
    u.vistaAhora.value.copy(vista(giro));
    u.vistaAntes.value.copy(vista(this.giroAnterior));
    u.escala.value = dt > 0 ? (this.obturador * CUADRO_REFERENCIA) / dt : 0;
    u.cerca.value = camara.near;
    u.lejos.value = camara.far;
    u.resolucion.value.copy(resolucion);
    u.cuadro.value = (u.cuadro.value + 1) % 1024;
    this.giroAnterior.copy(giro);
  }
}
