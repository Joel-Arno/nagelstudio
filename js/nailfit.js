/**
 * Nagelgroesse im Foto nachmessen.
 *
 * Die Lage des Nagels schaetzt MediaPipe aus den Gelenken gut; was die
 * Gelenkpunkte nicht hergeben, ist die Breite des Fingers -- die haengt von
 * der Hand ab, nicht von der Laenge des Fingerglieds. Hier wird der Bereich
 * um den geschaetzten Nagel begradigt ausgeschnitten und darin die
 * Fingerkontur vermessen; daraus folgt eine bessere Nagelbreite.
 *
 * Bewusst NICHT gemessen wird die Lage: Versuche, den Nagelrand im Bild zu
 * finden, lagen in Tests mal zu hoch, mal zu tief und waren damit schlechter
 * als die Schaetzung. Gemessen wird gegen eine Farbprobe aus dem Finger
 * selbst, nicht gegen feste Hautfarbwerte -- das passt zu jedem Hautton.
 */

const NX = 72;    // Breite des begradigten Ausschnitts in Pixeln
const NY = 104;   // Hoehe

/** Ausschnitt entlang der Fingerachse begradigen: Spitze zeigt nach oben. */
function straighten(photo, box, spanW, spanH){
  const c = document.createElement('canvas');
  c.width = NX; c.height = NY;
  const ctx = c.getContext('2d');
  const k = NX / spanW;

  ctx.translate(NX / 2, NY / 2);
  ctx.rotate(-Math.PI / 2 - box.angle);
  ctx.scale(k, k);
  ctx.translate(-box.cx, -box.cy);
  ctx.drawImage(photo, 0, 0);

  return { data: ctx.getImageData(0, 0, NX, NY).data, k, spanW, spanH };
}

/** Farbe als Chromatizitaet plus Helligkeit -- unabhaengig von Schatten. */
function pick(data, i){
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const sum = r + g + b + 1;
  return { r: r / sum, g: g / sum, l: sum / 3 };
}

function median(list){
  if(!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Farbprobe aus dem Fingerglied unterhalb des Nagels. Dort ist sicher Haut,
 * egal wie die Naegel aussehen.
 */
function skinReference(data){
  const rs = [], gs = [], ls = [];
  for(let y = Math.round(NY * 0.72); y < Math.round(NY * 0.96); y++){
    for(let x = Math.round(NX * 0.42); x < Math.round(NX * 0.58); x++){
      const p = pick(data, (y * NX + x) * 4);
      rs.push(p.r); gs.push(p.g); ls.push(p.l);
    }
  }
  return { r: median(rs), g: median(gs), l: median(ls) };
}

function isFinger(p, ref){
  const chroma = Math.abs(p.r - ref.r) + Math.abs(p.g - ref.g);
  const bright = (p.l - ref.l) / (ref.l + 1);
  // Der Nagel selbst gehoert zum Finger: heller ist erlaubt, ein anderer
  // Farbton nur in Grenzen. Der Hintergrund weicht meist in beidem ab.
  return chroma < 0.055 && bright > -0.45 && bright < 0.85;
}

/** Fingerbreite je Zeile: von der Mittelachse nach aussen bis zum Rand. */
function fingerWidths(data, ref){
  const widths = new Array(NY).fill(0);
  const edges = new Array(NY).fill(null);
  for(let y = 0; y < NY; y++){
    let left = NX / 2, right = NX / 2;
    for(let x = Math.floor(NX / 2); x >= 0; x--){
      if(!isFinger(pick(data, (y * NX + x) * 4), ref)) break;
      left = x;
    }
    for(let x = Math.ceil(NX / 2); x < NX; x++){
      if(!isFinger(pick(data, (y * NX + x) * 4), ref)) break;
      right = x;
    }
    widths[y] = right - left;
    edges[y] = { left, right };
  }
  return { widths, edges };
}

/** Wo endet die Fingerkuppe? Von oben die erste Zeile mit genug Finger. */
/** Erste Zeile, ab der der Finger ueber mehrere Zeilen hinweg da ist. */
function tipRow(widths){
  const max = Math.max(...widths);
  if(max < 6) return null;
  for(let y = 0; y < NY - 4; y++){
    if(widths[y] > max * 0.42 && widths[y + 1] > max * 0.42
       && widths[y + 2] > max * 0.42 && widths[y + 3] > max * 0.42) return y;
  }
  return null;
}

/**
 * Nagelflaeche suchen: innerhalb des Fingers die zusammenhaengende Region,
 * die sich von der Hautprobe abhebt -- heller, blasser oder lackiert.
 */
/**
 * @param photo   Canvas mit dem aufgerichteten Foto
 * @param box     Schaetzung { cx, cy, angle, w, h }
 * @returns       verbesserte Box plus Vertrauenswert und Herkunft
 */
export function refineNail(photo, box){
  const spanW = box.w * 2.6;
  const spanH = spanW * NY / NX;
  let out = { ...box, confidence: 0.3, source: 'schaetzung' };

  try{
    const { data, k } = straighten(photo, box, spanW, spanH);
    const ref = skinReference(data);
    const { widths, edges } = fingerWidths(data, ref);

    // Fuellt der "Finger" fast den ganzen Ausschnitt, hat die Farbprobe den
    // Hintergrund erwischt -- dann ist keine Messung moeglich.
    const belegt = widths.reduce((a, w) => a + w, 0) / (NX * NY);
    if(belegt > 0.72) return out;

    const tip = tipRow(widths);
    if(tip === null || tip > NY * 0.62) return out;

    // Fingerbreite ein Stueck unterhalb der Kuppe messen: direkt an der
    // Rundung ist der Finger schmaler als dort, wo der Nagel sitzt.
    const erwartet = box.w / 0.66;                      // aus der Schaetzung
    const von = tip + Math.round(erwartet * k * 0.55);
    const probe = [];
    for(let y = von; y < Math.min(NY, von + Math.round(erwartet * k * 0.8)); y++){
      if(widths[y] > 4) probe.push(widths[y]);
    }
    if(probe.length < 4) return out;
    const fingerW = median(probe) / k;
    if(!(fingerW > 0)) return out;

    // Gemessene Breite mit der Schaetzung mitteln und begrenzen: die
    // Messung bringt die Groessenordnung, die Schaetzung haelt Ausreisser
    // in Schach.
    const gemessen = fingerW * 0.74;   // Anteil der Fingerbreite an der Kuppe
    const gemischt = box.w * 0.35 + gemessen * 0.65;
    const nailW = Math.max(box.w * 0.75, Math.min(box.w * 1.35, gemischt));
    const faktor = nailW / box.w;

    out = {
      cx: box.cx, cy: box.cy, angle: box.angle,
      w: nailW,
      h: box.h * Math.min(1.25, Math.max(0.85, faktor)),
      confidence: 0.7,
      source: 'fingerbreite'
    };
  }catch(e){
    // Bildanalyse darf die Anprobe nie verhindern
  }
  return out;
}

/** Punkt aus dem begradigten Ausschnitt zurueck ins Foto rechnen. */
function localToPhoto(box, spanW, dxLocal, dyLocal){
  // dyLocal zaehlt von der Oberkante des Ausschnitts nach unten
  const spanH = spanW * NY / NX;
  const alongTip = spanH / 2 - dyLocal;     // positiv = Richtung Spitze
  const ux = Math.cos(box.angle), uy = Math.sin(box.angle);
  const nx = -uy, ny = ux;
  return {
    x: box.cx + ux * alongTip + nx * dxLocal,
    y: box.cy + uy * alongTip + ny * dxLocal
  };
}
