import * as THREE from 'three';

// El fogonazo de cada tiro: una estrella que mira a la cámara, dos llamas cruzadas a lo largo del
// caño, un destello de luz y un poco de humo que sube. Todo se crea una vez y se reusa: agregar una
// luz por tiro obliga a recompilar los materiales de la escena (un tirón en cada disparo).

const VIDA = 0.06; // segundos que dura el fogonazo
const HUMO_VIDA = 0.9;
const LUZ = 60; // intensidad del destello

function lienzo(ancho: number, alto: number, dibujar: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = ancho;
  c.height = alto;
  dibujar(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Una estrella: centro blanco, halo amarillo-naranja y rayos.
const ESTRELLA = lienzo(128, 128, (g) => {
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,240,180,1)');
  r.addColorStop(0.45, 'rgba(255,160,40,0.55)');
  r.addColorStop(1, 'rgba(255,90,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  g.translate(64, 64);
  for (let i = 0; i < 7; i++) {
    g.rotate((Math.PI * 2) / 7);
    const rayo = g.createLinearGradient(0, 0, 62, 0);
    rayo.addColorStop(0, 'rgba(255,250,220,0.9)');
    rayo.addColorStop(1, 'rgba(255,140,30,0)');
    g.fillStyle = rayo;
    g.beginPath();
    g.moveTo(0, -4);
    g.lineTo(62, 0);
    g.lineTo(0, 4);
    g.fill();
  }
});

// Una llama alargada: blanca donde sale del caño, naranja y transparente en la punta.
const LLAMA = lienzo(128, 64, (g) => {
  const r = g.createRadialGradient(10, 32, 0, 10, 32, 120);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.15, 'rgba(255,235,160,1)');
  r.addColorStop(0.5, 'rgba(255,140,30,0.6)');
  r.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = r;
  g.beginPath();
  g.moveTo(0, 32);
  g.quadraticCurveTo(40, 0, 128, 32);
  g.quadraticCurveTo(40, 64, 0, 32);
  g.fill();
});

const HUMO = lienzo(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(200,200,200,0.9)');
  r.addColorStop(1, 'rgba(200,200,200,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
});

function brillo(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
}

export class Fogonazo {
  readonly grupo = new THREE.Group();
  private readonly estrella: THREE.Sprite;
  private readonly llamas = new THREE.Group();
  private readonly luz = new THREE.PointLight(0xffa850, 0, 12, 2);
  private readonly humos: { s: THREE.Sprite; vida: number }[] = [];
  private vida = 0;

  constructor() {
    this.estrella = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ESTRELLA, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    const llama = new THREE.PlaneGeometry(1, 0.38);
    llama.translate(0.5, 0, 0); // empieza en la boca y se extiende hacia +X
    const a = new THREE.Mesh(llama, brillo(LLAMA));
    const b = new THREE.Mesh(llama, brillo(LLAMA));
    b.rotation.x = Math.PI / 2;
    this.llamas.add(a, b);
    for (const o of [this.estrella, this.llamas]) {
      o.visible = false;
      this.grupo.add(o);
    }
    this.grupo.add(this.luz);
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: HUMO, transparent: true, depthWrite: false, opacity: 0, color: 0x9a9a9a }));
      s.visible = false;
      this.grupo.add(s);
      this.humos.push({ s, vida: 0 });
    }
  }

  /** Un tiro desde `boca`, con el caño apuntando a `dir`. */
  disparar(boca: THREE.Vector3, dir: THREE.Vector3): void {
    this.vida = VIDA;
    const tam = 0.22 + Math.random() * 0.12;
    this.estrella.position.copy(boca).addScaledVector(dir, 0.03);
    this.estrella.scale.setScalar(tam);
    this.estrella.material.rotation = Math.random() * Math.PI * 2;
    this.llamas.position.copy(boca);
    this.llamas.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    this.llamas.rotateX(Math.random() * Math.PI);
    this.llamas.scale.set(0.22 + Math.random() * 0.14, 1, 1);
    this.estrella.visible = this.llamas.visible = true;
    this.luz.position.copy(boca).addScaledVector(dir, 0.15);
    this.luz.intensity = LUZ;
    const humo = this.humos.find((h) => h.vida <= 0) ?? this.humos[0];
    humo.vida = HUMO_VIDA;
    humo.s.position.copy(boca).addScaledVector(dir, 0.06);
    humo.s.visible = true;
  }

  actualizar(dt: number): void {
    if (this.vida > 0) {
      this.vida -= dt;
      const k = Math.max(0, this.vida / VIDA);
      this.estrella.material.opacity = k;
      for (const m of this.llamas.children as THREE.Mesh[]) (m.material as THREE.MeshBasicMaterial).opacity = k;
      this.luz.intensity = LUZ * k * k;
      if (this.vida <= 0) {
        this.estrella.visible = this.llamas.visible = false;
        this.luz.intensity = 0;
      }
    }
    for (const h of this.humos) {
      if (h.vida <= 0) continue;
      h.vida -= dt;
      const t = 1 - Math.max(0, h.vida / HUMO_VIDA);
      h.s.position.y += dt * 0.35;
      h.s.scale.setScalar(0.08 + t * 0.35);
      h.s.material.opacity = 0.35 * (1 - t);
      if (h.vida <= 0) h.s.visible = false;
    }
  }
}
