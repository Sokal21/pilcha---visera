// Lo que el personaje puede ponerse. Cada prenda es la malla `ropa_<id>` del GLB del protagonista.
// El cuerpo viene partido en mallas `cuerpo__<id>+<id>...` según qué prendas tapan cada pedazo
// (tools/blender/vestir.py): un pedazo se esconde mientras lleva puesta alguna de ellas, para que la
// piel no asome a través de la tela.

export type Lugar = 'arriba' | 'abajo' | 'pies';

export interface Prenda {
  id: string;
  nombre: string;
  lugar: Lugar;
}

export const LUGARES: { id: Lugar; nombre: string }[] = [
  { id: 'arriba', nombre: 'Arriba' },
  { id: 'abajo', nombre: 'Abajo' },
  { id: 'pies', nombre: 'Pies' },
];

export const PRENDAS: Prenda[] = [
  { id: 'campera_adidas', nombre: 'Campera adidas', lugar: 'arriba' },
  { id: 'camperon_newells', nombre: "Camperón Newell's", lugar: 'arriba' },
  { id: 'pantalon_adidas', nombre: 'Pantalón adidas', lugar: 'abajo' },
  { id: 'chupin', nombre: 'Chupín celeste', lugar: 'abajo' },
  { id: 'jordan', nombre: 'Jordan 5', lugar: 'pies' },
  { id: 'nike', nombre: 'Nike negras', lugar: 'pies' },
];

export const CONJUNTOS: { nombre: string; prendas: (string | null)[] }[] = [
  { nombre: 'En boxers', prendas: [] },
  { nombre: 'Tracksuit', prendas: ['campera_adidas', 'pantalon_adidas', 'jordan'] },
  { nombre: "Newell's", prendas: ['camperon_newells', 'chupin', 'nike'] },
];
