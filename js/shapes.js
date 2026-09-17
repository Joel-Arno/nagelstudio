/**
 * Nagelformen in einem normierten Raster: 100 breit, 140 hoch.
 *
 * Die Nagelhaut liegt immer unten bei y = 140, leicht gebogen -- in der
 * Mitte reicht die Nagelplatte weiter zur Fingerspitze als an den Seiten.
 * Nach oben belegt jede Form so viel Platz, wie ihr in Wirklichkeit
 * zusteht: eine runde Naturform endet weit vor dem Rasterrand, eine
 * Stilettoform laeuft fast bis nach oben durch.
 *
 * Dadurch stimmen die Laengenverhaeltnisse von selbst -- legt man das
 * Raster auf einen Finger, endet der runde Nagel auf dem Nagelbett und der
 * Stiletto ragt darueber hinaus, so wie eine echte Verlaengerung.
 */

export const SHAPE_W = 100;
export const SHAPE_H = 140;

/** Anteil der Rasterbreite, den die Nagelplatte einnimmt. */
export const PLATE_W = 0.68;
/** Hoehe zu Breite des Rasters. */
export const RASTER_RATIO = SHAPE_H / SHAPE_W;

// Nagelhaut: Seiten etwas hoeher als die Mitte. Die Nagelplatte ist an der
// Basis ein wenig schmaler und wird zur Fingerkuppe hin breiter.
const BASIS = 'M 18,127 C 18,135 28,140 50,140 C 72,140 82,135 82,127';

export const SHAPES = [
  {
    id:'rund', name:'Rund', top:52,
    // kurz, folgt der Fingerkuppe
    path: BASIS + ' C 83,108.4 84,92.6 84,88.1 C 84,65.5 70,52 50,52'
                + ' C 30,52 16,65.5 16,88.1 C 16,92.6 17,108.4 18,125.3 Z'
  },
  {
    id:'oval', name:'Oval', top:41,
    // laenger, gleichmaessig gerundet
    path: BASIS + ' C 83,108.4 84,93.7 84,87.3 C 84,60 69,41 50,41'
                + ' C 31,41 16,60 16,87.3 C 16,93.7 17,108.4 18,126.3 Z'
  },
  {
    id:'squoval', name:'Squoval', top:48,
    // gerade Seiten, weich gebrochene Ecken
    path: BASIS + ' C 83,105 84,76.5 84,61.1 C 84,52.4 79,48 70,48'
                + ' L 30,48 C 21,48 16,52.4 16,61.1 C 16,76.5 17,105 18,125.8 Z'
  },
  {
    id:'quadrat', name:'Quadrat', top:50,
    // gerade Kante, nur minimal gebrochene Ecken
    path: BASIS + ' L 84,55.6 C 84,52.2 82,50 79,50 L 21,50 C 18,50 16,52.2 16,55.6 Z'
  },
  {
    id:'mandel', name:'Mandel', top:18,
    // bis zur Fingerkuppe voll breit, erst der freie Rand laeuft zusammen
    path: BASIS + ' C 83,109.5 84,89.2 83,74.9 C 81,52.6 68,27.2 55,19'
                + ' C 52,17 48,17 45,19 C 32,27.2 19,52.6 17,74.9'
                + ' C 16,89.2 17,109.5 18,126.8 Z'
  },
  {
    id:'sarg', name:'Sarg', top:14,
    // gerade Seiten bis zur Kuppe, dann schmale gerade Kante
    path: BASIS + ' C 83,109 84,88.4 83,71.8 C 82,59.4 72,32.6 68,22.3'
                + ' C 66,16.1 64,14 60,14 L 40,14 C 36,14 34,16.1 32,22.3'
                + ' C 28,32.6 18,59.4 17,71.8 C 16,88.4 17,109 18,126.6 Z'
  },
  {
    id:'ballerina', name:'Ballerina', top:6,
    // wie Sarg, laenger und zur Kante hin schlanker
    path: BASIS + ' C 83,109.5 84,89.2 83,71 C 81,56.8 68,24.3 64,14.1'
                + ' C 62,8 60,6 56,6 L 44,6 C 40,6 38,8 36,14.1'
                + ' C 32,24.3 19,56.8 17,71 C 16,89.2 17,109.5 18,126.8 Z'
  },
  {
    id:'stiletto', name:'Stiletto', top:3,
    // volle Breite bis zur Kuppe, dann spitz auslaufend
    path: BASIS + ' C 83,109.3 84,88.9 83,72.5 C 80,52.1 64,19.4 53,5'
                + ' C 51,2 49,2 47,5 C 36,19.4 20,52.1 17,72.5'
                + ' C 16,88.9 17,109.3 18,126.7 Z'
  }
];

const cache = new Map();

export function shapeById(id){
  return SHAPES.find(s => s.id === id) || SHAPES.find(s => s.id === 'mandel');
}

/** Path2D im normierten Raster. Fuer Canvas vorher skalieren. */
export function shapePath(id){
  if(!cache.has(id)) cache.set(id, new Path2D(shapeById(id).path));
  return cache.get(id);
}

/** Bereich, den die Form im Raster belegt -- fuer Auswahlrahmen und Zuschnitt. */
export function shapeBounds(id){
  const s = shapeById(id);
  const rand = (1 - PLATE_W) / 2 * SHAPE_W;
  return { x: rand, y: s.top, w: SHAPE_W * PLATE_W, h: SHAPE_H - s.top };
}

/** Hoehe zu Breite der Nagelplatte dieser Form. */
export function shapeRatio(id){
  const b = shapeBounds(id);
  return b.h / b.w;
}

/** Kleines SVG-Vorschaubild einer Form. */
export function shapeSvg(id, fill = 'currentColor'){
  const s = shapeById(id);
  return '<svg viewBox="0 0 ' + SHAPE_W + ' ' + SHAPE_H + '" aria-hidden="true" focusable="false">' +
         '<path d="' + s.path + '" fill="' + fill + '"/></svg>';
}
