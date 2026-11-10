import * as THREE from 'three';

// Los conos de luz visibles debajo de cada farola y el polvo que flota adentro. Aditivos: suman
// luz, no tapan. Se controlan con `intensidad` (los conos) y `polvo` (el brillo de las motas).

const ALTO = 4.05;
const RADIO = 2.2;
const MOTAS = 180;

const SHADER_CONO = {
  uniforms: { intensidad: { value: 0.5 }, color: { value: new THREE.Color(0xffc98a) }, tiempo: { value: 0 } },
  vertexShader: /* glsl */ `
    varying float vAlto;
    varying vec3 vNormal, vVista;
    void main() {
      vAlto = position.y / ${ALTO.toFixed(2)} + 0.5;  // 0 en el piso, 1 en la lámpara
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vVista = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float intensidad, tiempo;
    uniform vec3 color;
    varying float vAlto;
    varying vec3 vNormal, vVista;
    void main() {
      // Más denso arriba, cerca de la lámpara, y en el centro (donde se lo mira de frente).
      float frente = pow(abs(dot(vNormal, vVista)), 1.6);
      float a = intensidad * pow(vAlto, 1.4) * frente * 0.35;
      gl_FragColor = vec4(color * a, a);
    }`,
};

export class Conos {
  readonly grupo = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly polvoMat: THREE.PointsMaterial;
  private readonly motas: { puntos: THREE.Points; base: Float32Array; fase: Float32Array }[] = [];

  constructor(lamparas: THREE.Vector3[]) {
    this.material = new THREE.ShaderMaterial({
      ...SHADER_CONO,
      uniforms: THREE.UniformsUtils.clone(SHADER_CONO.uniforms),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.polvoMat = new THREE.PointsMaterial({
      color: 0xffe2b0, size: 0.025, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    for (const l of lamparas) {
      const cono = new THREE.Mesh(new THREE.ConeGeometry(RADIO, ALTO, 40, 1, true), this.material);
      cono.position.set(l.x, l.y - ALTO / 2, l.z);
      this.grupo.add(cono);
      // Motas al azar adentro del cono.
      const base = new Float32Array(MOTAS * 3);
      const fase = new Float32Array(MOTAS);
      for (let i = 0; i < MOTAS; i++) {
        const y = Math.random() * (l.y - 0.3);
        const r = Math.sqrt(Math.random()) * RADIO * (1 - y / l.y) * 0.9;
        const a = Math.random() * Math.PI * 2;
        base.set([l.x + Math.cos(a) * r, y, l.z + Math.sin(a) * r], i * 3);
        fase[i] = Math.random() * 100;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
      const puntos = new THREE.Points(geo, this.polvoMat);
      puntos.frustumCulled = false;
      this.grupo.add(puntos);
      this.motas.push({ puntos, base, fase });
    }
  }

  set intensidad(v: number) {
    this.material.uniforms.intensidad.value = v;
    for (const c of this.grupo.children) if ((c as THREE.Mesh).isMesh) c.visible = v > 0;
  }

  set polvo(v: number) {
    this.polvoMat.opacity = v;
    for (const m of this.motas) m.puntos.visible = v > 0;
  }

  actualizar(t: number): void {
    // El polvo deriva despacio, cada mota a su ritmo.
    for (const { puntos, base, fase } of this.motas) {
      const pos = puntos.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < fase.length; i++) {
        const f = fase[i] + t * 0.3;
        pos.setXYZ(i, base[i * 3] + Math.sin(f) * 0.12, base[i * 3 + 1] + Math.sin(f * 0.7) * 0.15, base[i * 3 + 2] + Math.cos(f * 0.9) * 0.12);
      }
      pos.needsUpdate = true;
    }
  }
}
