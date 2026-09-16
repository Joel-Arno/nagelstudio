/**
 * Ein rechteckiges Bild auf ein beliebiges Viereck zeichnen.
 *
 * Canvas kennt nur affine Transformationen, also wird das Viereck in ein
 * Raster kleiner Kacheln zerlegt; jede Kachel wird einzeln affin gezeichnet.
 * Je feiner das Raster, desto weicher die perspektivische Verzerrung.
 */

/** Punkt im Viereck [oben-links, oben-rechts, unten-rechts, unten-links]. */
export function quadPoint(quad, u, v){
  const top = {
    x: quad[0].x + (quad[1].x - quad[0].x) * u,
    y: quad[0].y + (quad[1].y - quad[0].y) * u
  };
  const bottom = {
    x: quad[3].x + (quad[2].x - quad[3].x) * u,
    y: quad[3].y + (quad[2].y - quad[3].y) * u
  };
  return {
    x: top.x + (bottom.x - top.x) * v,
    y: top.y + (bottom.y - top.y) * v
  };
}

function triangle(ctx, img, s, d, grow){
  // Nur der Beschnitt wird minimal aufgeblasen, damit zwischen den Kacheln
  // keine Haarlinien blitzen. Die Abbildung selbst rechnet mit den echten
  // Eckpunkten -- sonst verschiebt sich die Textur von Kachel zu Kachel.
  const cx = (d[0].x + d[1].x + d[2].x) / 3;
  const cy = (d[0].y + d[1].y + d[2].y) / 3;
  const p = d.map(pt => ({
    x: pt.x + (pt.x - cx > 0 ? grow : -grow),
    y: pt.y + (pt.y - cy > 0 ? grow : -grow)
  }));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  ctx.lineTo(p[1].x, p[1].y);
  ctx.lineTo(p[2].x, p[2].y);
  ctx.closePath();
  ctx.clip();

  // Affine Abbildung, die die drei Quellpunkte auf die drei Zielpunkte legt
  const den = s[0].x * (s[2].y - s[1].y) - s[1].x * s[2].y + s[2].x * s[1].y
            + (s[1].x - s[2].x) * s[0].y;
  if(den !== 0){
    const m11 = -(s[0].y * (d[2].x - d[1].x) - s[1].y * d[2].x + s[2].y * d[1].x
              + (s[1].y - s[2].y) * d[0].x) / den;
    const m12 = (s[1].y * d[2].y + s[0].y * (d[1].y - d[2].y) - s[2].y * d[1].y
              + (s[2].y - s[1].y) * d[0].y) / den;
    const m21 = (s[0].x * (d[2].x - d[1].x) - s[1].x * d[2].x + s[2].x * d[1].x
              + (s[1].x - s[2].x) * d[0].x) / den;
    const m22 = -(s[1].x * d[2].y + s[0].x * (d[1].y - d[2].y) - s[2].x * d[1].y
              + (s[2].x - s[1].x) * d[0].y) / den;
    const dx = (s[0].x * (s[2].y * d[1].x - s[1].y * d[2].x)
             + s[0].y * (s[1].x * d[2].x - s[2].x * d[1].x)
             + (s[2].x * s[1].y - s[1].x * s[2].y) * d[0].x) / den;
    const dy = (s[0].x * (s[2].y * d[1].y - s[1].y * d[2].y)
             + s[0].y * (s[1].x * d[2].y - s[2].x * d[1].y)
             + (s[2].x * s[1].y - s[1].x * s[2].y) * d[0].y) / den;
    ctx.transform(m11, m12, m21, m22, dx, dy);
    ctx.drawImage(img, 0, 0);
  }
  ctx.restore();
}

/** Ist das Viereck ein Parallelogramm? Dann genuegt eine Transformation. */
function isParallelogram(q, tol = 0.6){
  return Math.abs((q[0].x + q[2].x) - (q[1].x + q[3].x)) < tol
      && Math.abs((q[0].y + q[2].y) - (q[1].y + q[3].y)) < tol;
}

/** Exakter Weg ohne Kacheln -- keine Naehte, schneller. */
function drawAffine(ctx, img, q){
  const w = img.width, h = img.height;
  ctx.save();
  ctx.transform(
    (q[1].x - q[0].x) / w, (q[1].y - q[0].y) / w,
    (q[3].x - q[0].x) / h, (q[3].y - q[0].y) / h,
    q[0].x, q[0].y
  );
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * @param quad  [oben-links, oben-rechts, unten-rechts, unten-links] im Ziel
 * @param steps Rasterfeinheit fuer den perspektivischen Fall
 *
 * Gedrehte, gestauchte Naegel ergeben Parallelogramme -- die werden in einem
 * Zug gezeichnet. Nur echte perspektivische Vierecke brauchen das Raster;
 * dort bleiben an den Kachelgrenzen feine Naehte sichtbar.
 */
export function drawQuad(ctx, img, quad, steps = 6){
  if(isParallelogram(quad)){ drawAffine(ctx, img, quad); return; }
  const w = img.width, h = img.height;
  const grow = 0.3;
  for(let i = 0; i < steps; i++){
    for(let j = 0; j < steps; j++){
      const u0 = i / steps, u1 = (i + 1) / steps;
      const v0 = j / steps, v1 = (j + 1) / steps;

      const s00 = { x:u0 * w, y:v0 * h }, s10 = { x:u1 * w, y:v0 * h };
      const s11 = { x:u1 * w, y:v1 * h }, s01 = { x:u0 * w, y:v1 * h };

      const d00 = quadPoint(quad, u0, v0), d10 = quadPoint(quad, u1, v0);
      const d11 = quadPoint(quad, u1, v1), d01 = quadPoint(quad, u0, v1);

      triangle(ctx, img, [s00, s10, s11], [d00, d10, d11], grow);
      triangle(ctx, img, [s00, s11, s01], [d00, d11, d01], grow);
    }
  }
}

/** Umschliessendes Rechteck eines Vierecks, mit Rand. */
export function quadBounds(quad, pad = 0){
  const xs = quad.map(p => p.x), ys = quad.map(p => p.y);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

/** Liegt der Punkt im Viereck? (Halbebenen-Test, Viereck ist konvex) */
export function quadContains(quad, px, py){
  let sign = 0;
  for(let i = 0; i < 4; i++){
    const a = quad[i], b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if(cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if(sign === 0) sign = s;
    else if(s !== sign) return false;
  }
  return true;
}
