/**
 * Nagelformen in einem normierten Koordinatensystem: 100 breit, 140 hoch.
 * Unten (y = 140) sitzt die Nagelhaut, oben (y = 0) die Spitze.
 * Alle Designs werden in diesem System gezeichnet und gespeichert -- dadurch
 * laesst sich dieselbe Zeichnung spaeter auf jeden erkannten Nagel legen.
 */

export const SHAPE_W = 100;
export const SHAPE_H = 140;

const BASE = 'M 14,124 C 14,136 24,140 50,140 C 76,140 86,136 86,124';

export const SHAPES = [
  { id:'oval',      name:'Oval',      path: BASE + ' L 86,64 C 86,20 70,4 50,4 C 30,4 14,20 14,64 Z' },
  { id:'rund',      name:'Rund',      path: BASE + ' L 86,70 C 86,28 72,8 50,8 C 28,8 14,28 14,70 Z' },
  { id:'squoval',   name:'Squoval',   path: BASE + ' L 86,30 C 86,16 82,10 70,10 L 30,10 C 18,10 14,16 14,30 Z' },
  { id:'quadrat',   name:'Quadrat',   path: BASE + ' L 86,16 C 86,11 84,9 79,9 L 21,9 C 16,9 14,11 14,16 Z' },
  { id:'mandel',    name:'Mandel',    path: BASE + ' L 84,66 C 82,34 66,8 50,4 C 34,8 18,34 16,66 Z' },
  { id:'sarg',      name:'Sarg',      path: BASE + ' L 86,72 L 66,14 C 65,10 63,9 59,9 L 41,9 C 37,9 35,10 34,14 L 14,72 Z' },
  { id:'ballerina', name:'Ballerina', path: BASE + ' L 86,76 L 70,18 C 69,13 66,11 61,11 L 39,11 C 34,11 31,13 30,18 L 14,76 Z' },
  { id:'stiletto',  name:'Stiletto',  path: BASE + ' L 84,70 L 52,6 C 51,4 49,4 48,6 L 16,70 Z' }
];

const cache = new Map();

export function shapeById(id){
  return SHAPES.find(s => s.id === id) || SHAPES[0];
}

/** Path2D im normierten System (100 x 140). Fuer Canvas vorher skalieren. */
export function shapePath(id){
  if(!cache.has(id)) cache.set(id, new Path2D(shapeById(id).path));
  return cache.get(id);
}

/** Kleines SVG-Vorschaubild einer Form, z. B. fuer die Formauswahl. */
export function shapeSvg(id, fill = 'currentColor'){
  const s = shapeById(id);
  return '<svg viewBox="0 0 ' + SHAPE_W + ' ' + SHAPE_H + '" aria-hidden="true" focusable="false">' +
         '<path d="' + s.path + '" fill="' + fill + '"/></svg>';
}
