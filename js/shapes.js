/**
 * Nagelformen -- parametrisch in Form und Laenge.
 *
 * Raster: 100 breit, 140 hoch. Die Nagelhaut liegt unten bei y = 140 (leicht
 * gebogen), die Nagelplatte ist 68 breit (x 16..84). Bei y = 70 liegt die
 * Fingerkuppe: bis dahin reicht das Nagelbett, darueber beginnt der freie
 * Rand. Die Laenge (0..1) bestimmt, wie weit der freie Rand hinausragt --
 * von knapp ueber der Kuppe (Kurz) bis an den oberen Rasterrand (XL).
 *
 * Form und Laenge sind getrennt, wie im Nagelstudio auch: dieselbe Mandel
 * gibt es kurz und lang. Jede Form wird aus ihrer rechten Haelfte erzeugt und
 * gespiegelt -- dadurch ist sie immer exakt symmetrisch.
 */

export const SHAPE_W = 100;
export const SHAPE_H = 140;

/** Anteil der Rasterbreite, den die Nagelplatte einnimmt. */
export const PLATE_W = 0.68;
/** Hoehe zu Breite des Rasters. */
export const RASTER_RATIO = SHAPE_H / SHAPE_W;
/** Hoehe der Fingerkuppe im Raster. */
export const KUPPE = 70;

const FREI_MIN = 6;       // freier Rand bei Laenge 0
const FREI_SPANNE = 64;   // bis zum oberen Rasterrand

export const LAENGE_STANDARD = 0.36;

export const SHAPES = [
  { id:'rund',      name:'Rund',      min:0.00, standard:0.19 },
  { id:'oval',      name:'Oval',      min:0.04, standard:0.36 },
  { id:'squoval',   name:'Squoval',   min:0.00, standard:0.25 },
  { id:'quadrat',   name:'Eckig',     min:0.00, standard:0.22 },
  { id:'mandel',    name:'Mandel',    min:0.12, standard:0.72 },
  { id:'sarg',      name:'Sarg',      min:0.24, standard:0.78 },
  { id:'ballerina', name:'Ballerina', min:0.30, standard:0.91 },
  { id:'stiletto',  name:'Stiletto',  min:0.38, standard:0.95 }
];

const STUFEN = [
  [0.16, 'Kurz'], [0.36, 'Mittel-kurz'], [0.60, 'Mittel'], [0.82, 'Lang'], [2, 'XL']
];

export function shapeById(id){
  return SHAPES.find(s => s.id === id) || SHAPES.find(s => s.id === 'mandel');
}

/** Laenge, die fuer diese Form tatsaechlich gilt (Mindestlaenge beachtet). */
export function effectiveLength(id, length){
  const s = shapeById(id);
  const l = (length == null || !Number.isFinite(length)) ? s.standard : length;
  return Math.max(s.min, Math.min(1, l));
}

export function lengthLabel(length){
  for(const [max, name] of STUFEN) if(length < max) return name;
  return 'XL';
}

/** Oberkante des Nagels im Raster. */
export function topFor(id, length){
  return KUPPE - (FREI_MIN + effectiveLength(id, length) * FREI_SPANNE);
}

/* ---------------- Formerzeugung ---------------- */

const C = (x1, y1, x2, y2, x, y) => ({ c1:{ x:x1, y:y1 }, c2:{ x:x2, y:y2 }, p:{ x, y } });
const L = (x, y) => ({ p:{ x, y } });

/** Rechte Haelfte: von unten Mitte ueber die Nagelhaut bis oben auf die Achse. */
function haelfte(id, t, laenge){
  const segs = [ C(72, 140, 82, 135, 82, 127) ];     // Nagelhaut
  const seite = (yB) => {                             // Nagelbett bis (84, yB)
    if(yB < 100){
      segs.push(C(83, 113, 84, 105, 84, 100));
      if(yB < 99.9) segs.push(L(84, yB));
    }else{
      segs.push(C(83, 127 - (127 - yB) * 0.45, 84, yB + (127 - yB) * 0.3, 84, yB));
    }
  };
  const H = 127 - t;

  switch(id){
    case 'rund': {
      const r = Math.min(34, H * 0.55);
      seite(t + r);
      segs.push(C(84, t + r * 0.448, 68.8, t, 50, t));
      break;
    }
    case 'oval': {
      const r = Math.min(52, H * 0.7);
      seite(t + r);
      segs.push(C(84, t + r * 0.42, 66.5, t, 50, t));
      break;
    }
    case 'squoval': {
      const r = Math.min(11, H * 0.22);
      seite(t + r);
      segs.push(C(84, t + r * 0.45, 84 - r * 0.45, t, 84 - r, t));
      segs.push(L(50, t));
      break;
    }
    case 'quadrat': {
      seite(t + 3);
      segs.push(C(84, t + 1.35, 82.65, t, 81, t));
      segs.push(L(50, t));
      break;
    }
    case 'sarg':
    case 'ballerina':
      flach(id, t, laenge, segs, seite);
      break;
    case 'stiletto':
    case 'mandel':
    default:
      spitz(id === 'stiletto' ? 'stiletto' : 'mandel', t, laenge, segs, seite);
  }
  return segs;
}

const r1 = (n) => Math.round(n * 10) / 10;
const pt = (p) => r1(p.x) + ',' + r1(p.y);
const spiegel = (p) => ({ x: SHAPE_W - p.x, y: p.y });

/** SVG-Pfad aus der rechten Haelfte, gespiegelt zur ganzen Form. */
function baue(segs){
  let d = 'M 50,140';
  const punkte = [{ x:50, y:140 }];
  for(const s of segs){
    d += s.c1 ? ' C ' + pt(s.c1) + ' ' + pt(s.c2) + ' ' + pt(s.p) : ' L ' + pt(s.p);
    punkte.push(s.p);
  }
  for(let i = segs.length - 1; i >= 0; i--){
    const s = segs[i], start = punkte[i];
    d += s.c1
      ? ' C ' + pt(spiegel(s.c2)) + ' ' + pt(spiegel(s.c1)) + ' ' + pt(spiegel(start))
      : ' L ' + pt(spiegel(start));
  }
  return d + ' Z';
}


const lerp = (a, b, k) => a + (b - a) * k;
const klemm = (v) => Math.max(0, Math.min(1, v));
const mitte = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Eine Bezierkurve in zwei gleichwertige Haelften teilen (de Casteljau). */
function teile(p0, s){
  const p01 = mitte(p0, s.c1), p12 = mitte(s.c1, s.c2), p23 = mitte(s.c2, s.p);
  const p012 = mitte(p01, p12), p123 = mitte(p12, p23), m = mitte(p012, p123);
  return [ { c1:p01, c2:p012, p:m }, { c1:p123, c2:p23, p:s.p } ];
}

/** Zwei gleich aufgebaute Kurvenfolgen ineinander ueberblenden. */
function mische(a, b, k){
  const m = (p, q) => ({ x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k) });
  return a.map((s, i) => s.c1
    ? { c1: m(s.c1, b[i].c1), c2: m(s.c2, b[i].c2), p: m(s.p, b[i].p) }
    : { p: m(s.p, b[i].p) });
}

/**
 * Mandel und Stiletto. Kurz sind beide fast oval -- eine kurze Mandel mit
 * scharfer Spitze saehe aus wie ein Zipfel auf einem flachen Dach. Mit
 * zunehmender Laenge wird die Form stufenlos zur echten Spitze.
 */
function spitz(id, t, laenge, segs, seite){
  const stil = id === 'stiletto';
  const k = klemm(stil ? (laenge - 0.38) / 0.40 : (laenge - 0.10) / 0.80);

  // Ausgangsform: oval (Stiletto etwas spitzer)
  const r = Math.min(52, (127 - t) * 0.7);
  const startA = { x:84, y: t + r };
  const oval = teile(startA, C(84, t + r * 0.42, 50 + (stil ? 3 : 16.5), t, 50, t));

  // Zielform: die ausgepraegte Spitze. Bei der Mandel setzt die Rundung bei
  // mittlerer Laenge etwas tiefer an, sonst bleibt oben ein flaches Dach.
  const S = stil ? Math.max(t + 16, 78) : Math.max(78, Math.min(100, t + 58));
  const D = S - t;
  const spitze = stil
    ? [ C(83, S - D * 0.35, 64, t + D * 0.22, 53.4, t + 2.6), C(52.1, t + 0.8, 51, t, 50, t) ]
    : [ C(82.5, S - D * 0.42, 68, t + D * 0.17, 55, t + 2), C(53.3, t + 0.6, 51.7, t, 50, t) ];

  seite(lerp(startA.y, S, k));
  segs.push(...mische(oval, spitze, k));
}

/**
 * Sarg und Ballerina: gerade Seiten, die zur Kante hin zusammenlaufen.
 * Kurz ist die Kante breit, lang wird sie schmal -- sonst entstuende bei
 * kurzen Laengen ein Flaschenhals.
 */
function flach(id, t, laenge, segs, seite){
  const P = id === 'sarg'
    ? { k0:0.24, k1:0.74, jx:[76, 68.2], th:[70, 83], a:[0.45, 0.25] }
    : { k0:0.30, k1:0.80, jx:[73, 64.2], th:[70, 80], a:[0.45, 0.22] };
  const k = klemm((laenge - P.k0) / (P.k1 - P.k0));
  const S = Math.max(t + 16, 78), D = S - t;
  seite(S);

  const J = { x: lerp(P.jx[0], P.jx[1], k), y: t + 7 };
  const th = lerp(P.th[0], P.th[1], k) * Math.PI / 180;
  const dir = { x: Math.cos(th), y: Math.sin(th) };      // von J nach unten rechts
  const a1 = D * lerp(P.a[0], P.a[1], k);

  segs.push(C(84, S - D * 0.15, J.x + dir.x * a1, J.y + dir.y * a1, J.x, J.y));
  segs.push(C(J.x - dir.x * 3, J.y - dir.y * 3, J.x - 2.4, t, J.x - 5, t));   // Ecke
  segs.push(L(50, t));
}

/* ---------------- Oeffentliche Helfer ---------------- */

const pfadCache = new Map();
const path2dCache = new Map();

function schluessel(id, length){
  return id + ':' + Math.round(effectiveLength(id, length) * 100);
}

/** SVG-Pfad der Form in dieser Laenge. */
export function shapeD(id, length){
  const k = schluessel(id, length);
  if(!pfadCache.has(k)){
    const eff = effectiveLength(id, length);
    pfadCache.set(k, baue(haelfte(shapeById(id).id, topFor(id, length), eff)));
  }
  return pfadCache.get(k);
}

/** Path2D im Raster. Fuer Canvas vorher skalieren. */
export function shapePath(id, length){
  const k = schluessel(id, length);
  if(!path2dCache.has(k)) path2dCache.set(k, new Path2D(shapeD(id, length)));
  return path2dCache.get(k);
}

/** Bereich, den die Form im Raster belegt. */
export function shapeBounds(id, length){
  const t = topFor(id, length);
  const rand = (1 - PLATE_W) / 2 * SHAPE_W;
  return { x: rand, y: t, w: SHAPE_W * PLATE_W, h: SHAPE_H - t };
}

/** Hoehe zu Breite der Nagelplatte. */
export function shapeRatio(id, length){
  const b = shapeBounds(id, length);
  return b.h / b.w;
}

/** Kleines SVG-Vorschaubild. */
export function shapeSvg(id, fill = 'currentColor', length){
  return '<svg viewBox="0 0 ' + SHAPE_W + ' ' + SHAPE_H + '" aria-hidden="true" focusable="false">' +
         '<path d="' + shapeD(id, length) + '" fill="' + fill + '"/></svg>';
}
