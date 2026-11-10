import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// El último pase de la imagen, sobre la imagen ya en sRGB (después de OutputPass): contorno de
// tinta (por saltos de profundidad y de orientación, que dibuja una pasada aparte con las normales),
// trama de puntos en las sombras, granulado, y los ajustes de antes (viñeta, aberración, gradación),
// apagados. Los valores se tocan desde el panel (AJUSTES).

export interface Ajuste {
  id: string;
  grupo: string;
  nombre: string;
  min: number;
  max: number;
  paso: number;
  valor: number;
}

export const AJUSTES: Ajuste[] = [
  { id: 'contorno', grupo: 'Tinta', nombre: 'Contorno', min: 0, max: 1, paso: 0.01, valor: 0.8 },
  { id: 'grosor', grupo: 'Tinta', nombre: 'Grosor (px)', min: 0.5, max: 4, paso: 0.1, valor: 1.4 },
  { id: 'pliegues', grupo: 'Tinta', nombre: 'Líneas en pliegues', min: 0, max: 1, paso: 0.01, valor: 0.5 },
  { id: 'trama', grupo: 'Trama', nombre: 'Cantidad', min: 0, max: 1, paso: 0.01, valor: 0 },
  { id: 'tramaTam', grupo: 'Trama', nombre: 'Tamaño del punto (px)', min: 3, max: 16, paso: 0.5, valor: 6 },
  { id: 'tramaUmbral', grupo: 'Trama', nombre: 'Desde qué oscuridad', min: 0.05, max: 0.9, paso: 0.01, valor: 0.45 },
  { id: 'grano', grupo: 'Imagen', nombre: 'Granulado', min: 0, max: 0.25, paso: 0.005, valor: 0.15 },
  { id: 'vineta', grupo: 'Imagen', nombre: 'Viñeta', min: 0, max: 1, paso: 0.01, valor: 0 },
  { id: 'aberracion', grupo: 'Imagen', nombre: 'Aberración cromática', min: 0, max: 0.02, paso: 0.0005, valor: 0 },
  { id: 'contraste', grupo: 'Imagen', nombre: 'Contraste', min: 0.6, max: 1.6, paso: 0.01, valor: 1 },
  { id: 'saturacion', grupo: 'Imagen', nombre: 'Saturación', min: 0, max: 1.6, paso: 0.01, valor: 1 },
  { id: 'calidez', grupo: 'Imagen', nombre: 'Calidez (− fría, + cálida)', min: -0.2, max: 0.2, paso: 0.005, valor: 0 },
];

const SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tNormal: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    camaraCerca: { value: 0.05 },
    camaraLejos: { value: 200 },
    tiempo: { value: 0 },
    resolucion: { value: new THREE.Vector2(1, 1) },
    ...Object.fromEntries(AJUSTES.map((a) => [a.id, { value: a.valor }])),
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse, tNormal, tDepth;
    uniform float camaraCerca, camaraLejos, tiempo;
    uniform vec2 resolucion;
    uniform float contorno, grosor, pliegues, trama, tramaTam, tramaUmbral;
    uniform float grano, vineta, aberracion, contraste, saturacion, calidez;
    varying vec2 vUv;

    float azar(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    float distancia(vec2 uv) {
      float z = texture2D(tDepth, uv).x;
      return -perspectiveDepthToViewZ(z, camaraCerca, camaraLejos);
    }

    // Tinta: donde la profundidad salta (silueta) o la orientación cambia de golpe (pliegues).
    float tinta() {
      vec2 px = grosor / resolucion;
      float d = distancia(vUv);
      vec3 n = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
      float borde = 0.0;
      vec2 dirs[4];
      dirs[0] = vec2(px.x, 0.0); dirs[1] = vec2(-px.x, 0.0); dirs[2] = vec2(0.0, px.y); dirs[3] = vec2(0.0, -px.y);
      for (int i = 0; i < 4; i++) {
        float dv = distancia(vUv + dirs[i]);
        borde = max(borde, smoothstep(0.02, 0.06, abs(dv - d) / max(d, 0.001)));
        vec3 nv = texture2D(tNormal, vUv + dirs[i]).xyz * 2.0 - 1.0;
        borde = max(borde, pliegues * smoothstep(0.75, 0.45, dot(n, nv)));
      }
      return borde;
    }

    void main() {
      vec2 d = vUv - 0.5;
      vec3 c = vec3(
        texture2D(tDiffuse, vUv + d * aberracion * 4.0).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - d * aberracion * 4.0).b
      );
      c = (c - 0.5) * contraste + 0.5;
      float luz = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(luz), c, saturacion);
      c *= vec3(1.0 + calidez, 1.0, 1.0 - calidez);
      // Trama: una grilla de puntos a 45°, más grandes cuanto más oscuro, solo bajo el umbral.
      if (trama > 0.0) {
        vec2 p = vUv * resolucion;
        p = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p / tramaTam;
        float r = length(fract(p) - 0.5);
        float oscuro = clamp((tramaUmbral - luz) / tramaUmbral, 0.0, 1.0);
        float punto = 1.0 - smoothstep(0.0, 0.08, r - sqrt(oscuro) * 0.55);
        c = mix(c, c * 0.25, punto * trama);
      }
      if (contorno > 0.0) c = mix(c, vec3(0.04, 0.035, 0.05), tinta() * contorno);
      c *= 1.0 - vineta * smoothstep(0.15, 0.75, length(d * vec2(resolucion.x / resolucion.y, 1.0)));
      float n = azar(floor(vUv * resolucion) + fract(tiempo) * 97.0) - 0.5;
      c += n * grano * (1.2 - luz * 0.6);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export function pasoSucio(): ShaderPass {
  return new ShaderPass(SHADER);
}

export function ajustar(paso: ShaderPass, id: string, valor: number): void {
  const a = AJUSTES.find((x) => x.id === id);
  if (a) a.valor = valor;
  paso.uniforms[id].value = valor;
}

export function valor(id: string): number {
  return AJUSTES.find((x) => x.id === id)?.valor ?? 0;
}
