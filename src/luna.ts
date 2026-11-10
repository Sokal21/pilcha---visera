import * as THREE from 'three';

// La luna en el cielo: una esfera con el mapa de color de la Luna de la NASA (CGI Moon Kit, LRO,
// dominio público: public/texturas/luna.jpg), girada para mostrar siempre la cara visible, y un halo
// suave alrededor; bastante más grande que la de verdad para que se lea. Va siempre a la misma
// distancia de la cámara, en la dirección de donde viene su luz (`direccion`), así queda "en el
// infinito" y las sombras salen de ella. Sin niebla, y lo bastante brillante para que la agarre el
// resplandor.

const DISTANCIA = 150;
const TAMAÑO = 10;
const HALO = 55;

function texturaHalo(): THREE.CanvasTexture {
  const n = 128;
  const lienzo = document.createElement('canvas');
  lienzo.width = lienzo.height = n;
  const g = lienzo.getContext('2d')!;
  const h = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  // Vacío sobre el disco (es aditivo y se dibuja encima: lo lavaba) y desde el borde una sola caída
  // exponencial, en muchos tramos para que no se vea ningún escalón.
  const borde = TAMAÑO / HALO;
  h.addColorStop(0, 'rgba(255,255,255,0)');
  h.addColorStop(borde * 0.96, 'rgba(255,255,255,0)');
  const TRAMOS = 32;
  for (let i = 0; i <= TRAMOS; i++) {
    const r = borde + ((1 - borde) * i) / TRAMOS;
    const a = 0.4 * Math.exp((-7 * (r - borde)) / (1 - borde)) * (1 - i / TRAMOS);
    h.addColorStop(r, `rgba(255,255,255,${a.toFixed(4)})`);
  }
  g.fillStyle = h;
  g.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(lienzo);
}

export class Luna {
  readonly grupo = new THREE.Group();
  readonly direccion: THREE.Vector3;

  constructor(direccion: THREE.Vector3) {
    this.direccion = direccion.clone().normalize();
    const mapa = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}texturas/luna.jpg`);
    mapa.colorSpace = THREE.SRGBColorSpace;
    mapa.anisotropy = 4;
    // El centro del mapa (la cara visible) queda en +X de la esfera; se lo pasa a +Z, que es lo que
    // `lookAt` apunta a la cámara.
    const geo = new THREE.SphereGeometry(TAMAÑO / 2, 48, 24).rotateY(-Math.PI / 2);
    const disco = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: mapa, fog: false }));
    disco.material.color.setScalar(1.15); // apenas: con más, el resplandor le armaba un segundo halo
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texturaHalo(), color: 0x9fb4e8, fog: false, depthWrite: false, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending,
    }));
    halo.scale.setScalar(HALO);
    halo.renderOrder = -1;
    this.grupo.add(halo, disco);
  }

  /** Cada cuadro, con la cámara ya en su lugar. */
  actualizar(camara: THREE.Camera): void {
    this.grupo.position.copy(camara.position).addScaledVector(this.direccion, DISTANCIA);
    this.grupo.lookAt(camara.position);
  }
}
