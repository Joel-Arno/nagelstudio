/**
 * Realistische Vorschau: ein Finger mit Nagel darauf.
 *
 * Fuer Formauswahl, Laengenvorschau und die Uebersicht eines Satzes. Eine
 * flache Silhouette sagt wenig darueber, wie lang "Mittel" wirklich ist --
 * auf einem Finger sieht man es sofort.
 */

import { SHAPE_W, SHAPE_H, KUPPE, shapePath, topFor } from './shapes.js';

export const HAUTTOENE = [
  { id:'hell',    name:'Hell',    farbe:'#F1D2C0' },
  { id:'mittel',  name:'Mittel',  farbe:'#E2B597' },
  { id:'oliv',    name:'Oliv',    farbe:'#C99A73' },
  { id:'dunkel',  name:'Dunkel',  farbe:'#8D5E43' },
  { id:'tief',    name:'Tief',    farbe:'#5E3C2C' }
];

let hautton = '#E2B597';
export function setHautton(farbe){ hautton = farbe; }
export function getHautton(){ return hautton; }

function hex(c){
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [226, 181, 151];
}
function tone(c, f){                     // f > 0 heller, f < 0 dunkler
  const [r, g, b] = hex(c);
  const k = (v) => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f));
  return 'rgb(' + k(r) + ',' + k(g) + ',' + k(b) + ')';
}

/** Umriss des Fingers im Raster; reicht nach unten weit ueber das Raster hinaus. */
function fingerPfad(){
  const p = new Path2D();
  p.moveTo(4, 400);
  p.lineTo(4, 100);
  p.bezierCurveTo(4, 74, 24, 61, 50, 61);
  p.bezierCurveTo(76, 61, 96, 74, 96, 100);
  p.lineTo(96, 400);
  p.closePath();
  return p;
}
const FINGER = typeof Path2D !== 'undefined' ? fingerPfad() : null;

/**
 * @param ctx   Zielflaeche
 * @param box   { x, y, w, h } Bereich in Pixeln
 * @param o     { shape, length, texture?, skin?, natur? }
 *              texture: fertiges Nagelbild (600 x 840) oder null fuer Nude
 */
export function renderFingerNail(ctx, box, o){
  const skin = o.skin || hautton;
  const s = box.w / 104;
  const ox = box.x + (box.w - SHAPE_W * s) / 2;
  const oy = box.y + Math.max(2, box.h * 0.03);

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.translate(ox, oy);
  ctx.scale(s, s);

  // Finger
  const quer = ctx.createLinearGradient(4, 0, 96, 0);
  quer.addColorStop(0,    tone(skin, -0.28));
  quer.addColorStop(0.16, tone(skin, -0.06));
  quer.addColorStop(0.46, tone(skin, 0.10));
  quer.addColorStop(0.80, tone(skin, -0.04));
  quer.addColorStop(1,    tone(skin, -0.30));
  ctx.fillStyle = quer;
  ctx.fill(FINGER);

  // Kuppe leicht heller, Richtung Hand etwas dunkler
  const laengs = ctx.createLinearGradient(0, 61, 0, 260);
  laengs.addColorStop(0, 'rgba(255,255,255,0.10)');
  laengs.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = laengs;
  ctx.fill(FINGER);

  // Hautfalte am Endgelenk
  ctx.strokeStyle = tone(skin, -0.22);
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(22, 176); ctx.quadraticCurveTo(50, 171, 78, 176);
  ctx.moveTo(28, 181); ctx.quadraticCurveTo(50, 177, 72, 181);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const nagel = shapePath(o.shape, o.length);

  // Nagelwall: weicher, etwas dunklerer Rand rund um den Nagel
  ctx.save();
  ctx.shadowColor = tone(skin, -0.45);
  ctx.shadowBlur = 5 * s;
  ctx.shadowOffsetY = 0.6 * s;
  ctx.fillStyle = tone(skin, -0.12);
  ctx.fill(nagel);
  ctx.restore();

  // Nagel
  ctx.save();
  ctx.clip(nagel);
  if(o.texture){
    ctx.drawImage(o.texture, 0, 0, SHAPE_W, SHAPE_H);
  }else{
    // Nude-Lack: rosig, zur Spitze heller
    const t = topFor(o.shape, o.length);
    const g = ctx.createLinearGradient(0, t, 0, SHAPE_H);
    g.addColorStop(0, '#F6DCD8');
    g.addColorStop(Math.max(0.05, (KUPPE - t) / (SHAPE_H - t)), '#F0CACA');
    g.addColorStop(1, '#E6B2B6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SHAPE_W, SHAPE_H);
    if(o.natur !== false){
      // freier Rand: leicht milchig
      const f = ctx.createLinearGradient(0, t, 0, KUPPE + 4);
      f.addColorStop(0, 'rgba(255,250,248,0.75)');
      f.addColorStop(1, 'rgba(255,250,248,0)');
      ctx.fillStyle = f;
      ctx.fillRect(0, t, SHAPE_W, KUPPE + 4 - t);
    }
  }

  // Woelbung: dunklere Flanken, Laengsglanz, Lichtpunkt
  const flanke = ctx.createLinearGradient(16, 0, 84, 0);
  flanke.addColorStop(0, 'rgba(60,20,30,0.22)');
  flanke.addColorStop(0.2, 'rgba(60,20,30,0)');
  flanke.addColorStop(0.8, 'rgba(60,20,30,0)');
  flanke.addColorStop(1, 'rgba(60,20,30,0.24)');
  ctx.fillStyle = flanke;
  ctx.fillRect(0, 0, SHAPE_W, SHAPE_H);

  ctx.globalCompositeOperation = 'screen';
  const glanz = ctx.createLinearGradient(26, 0, 46, 0);
  glanz.addColorStop(0, 'rgba(255,255,255,0)');
  glanz.addColorStop(0.5, 'rgba(255,255,255,0.42)');
  glanz.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glanz;
  ctx.fillRect(0, 0, SHAPE_W, 128);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  // feine Kante
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = 'rgba(90,40,50,0.28)';
  ctx.stroke(nagel);

  ctx.restore();
}

/** Bequemer Weg: gleich ein fertiges Canvas. */
export function fingerCanvas(w, h, o){
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = w + 'px';
  c.style.height = h + 'px';
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  renderFingerNail(ctx, { x:0, y:0, w, h }, o);
  return c;
}
