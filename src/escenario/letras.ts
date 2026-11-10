import * as THREE from 'three';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
// Helvetiker de los ejemplos de three.js (MgOpen, licencia libre en fuentes/LICENSE) y Pacifico, la
// cursiva del cartel «Casino» (Google Fonts, SIL OFL en fuentes/OFL-Pacifico.txt; pasada al formato de
// three con opentype.js).
import helvetiker from './fuentes/helvetiker_bold.typeface.json';
import pacifico from './fuentes/pacifico.typeface.json';

const FUENTES = { helvetiker: new Font(helvetiker as never), pacifico: new Font(pacifico as never) };

/** Un texto en relieve de `alto` metros, `relieve` de espesor y a lo sumo `ancho` de largo, centrado,
 * de cara a +Z con el fondo en z = 0. */
export function letrasEnRelieve(
  texto: string, alto: number, relieve: number, ancho: number, fuente: keyof typeof FUENTES = 'helvetiker',
): THREE.BufferGeometry {
  const geo = new TextGeometry(texto, { font: FUENTES[fuente], size: alto, depth: relieve, curveSegments: fuente === 'pacifico' ? 8 : 4 });
  geo.computeBoundingBox();
  const caja = geo.boundingBox!;
  geo.translate(-(caja.max.x + caja.min.x) / 2, -(caja.max.y + caja.min.y) / 2, 0);
  const largo = caja.max.x - caja.min.x;
  if (largo > ancho) geo.scale(ancho / largo, ancho / largo, 1);
  geo.computeVertexNormals();
  // Los triángulos degenerados (en la cursiva los trazos se enciman) quedan con la normal en cero, y en
  // el shader eso da NaN: un píxel negro que el resplandor desparramaba como un destello.
  const normales = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < normales.count; i++) {
    if (normales.getX(i) === 0 && normales.getY(i) === 0 && normales.getZ(i) === 0) normales.setXYZ(i, 0, 0, 1);
  }
  return geo;
}

