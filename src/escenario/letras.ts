import * as THREE from 'three';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
// Helvetiker de los ejemplos de three.js (MgOpen, licencia libre en fuentes/LICENSE).
import helvetiker from './fuentes/helvetiker_bold.typeface.json';

const fuente = new Font(helvetiker as never);

/** Un texto en relieve de `alto` metros, `relieve` de espesor y a lo sumo `ancho` de largo, centrado,
 * de cara a +Z con el fondo en z = 0. */
export function letrasEnRelieve(texto: string, alto: number, relieve: number, ancho: number): THREE.BufferGeometry {
  const geo = new TextGeometry(texto, { font: fuente, size: alto, depth: relieve, curveSegments: 4 });
  geo.computeBoundingBox();
  const caja = geo.boundingBox!;
  geo.translate(-(caja.max.x + caja.min.x) / 2, -(caja.max.y + caja.min.y) / 2, 0);
  const largo = caja.max.x - caja.min.x;
  if (largo > ancho) geo.scale(ancho / largo, ancho / largo, 1);
  geo.computeVertexNormals();
  return geo;
}

