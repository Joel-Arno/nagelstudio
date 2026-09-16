/**
 * Ein gespeichertes Design zu einem fertigen, transparenten Bild zusammensetzen.
 * Wird von der Anprobe gebraucht -- der Editor macht dasselbe live in draw.js.
 */

import { shapePath } from './shapes.js';
import { RES, IMG_W, IMG_H } from './draw.js';
import { imageToUrl, releaseUrl, loadImage } from './store.js';

const cache = new Map();   // designId:finger -> { canvas, updatedAt }

/** Fertiges Bild eines einzelnen Nagels aus dem Satz. */
export async function designTexture(design, fingerKey = 'zeigefinger'){
  const key = design.id + ':' + fingerKey;
  const hit = cache.get(key);
  if(hit && hit.updatedAt === design.updatedAt) return hit.canvas;

  const nail = (design.nails && (design.nails[fingerKey] || design.nails.zeigefinger)) || {};

  const canvas = document.createElement('canvas');
  canvas.width = IMG_W;
  canvas.height = IMG_H;
  const ctx = canvas.getContext('2d');

  if(nail.base){
    ctx.fillStyle = nail.base;
    ctx.fillRect(0, 0, IMG_W, IMG_H);
  }

  for(const layer of nail.layers || []){
    if(layer.visible === false || layer.opacity === 0) continue;
    const url = imageToUrl(layer.image);
    if(!url) continue;
    try{
      const img = await loadImage(url);
      ctx.globalAlpha = Number.isFinite(layer.opacity) ? layer.opacity : 1;
      ctx.drawImage(img, 0, 0, IMG_W, IMG_H);
    }catch(e){ /* eine kaputte Ebene darf den Rest nicht verhindern */ }
    finally{ releaseUrl(url); }
  }
  ctx.globalAlpha = 1;

  // Auf die Nagelform beschneiden
  ctx.globalCompositeOperation = 'destination-in';
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fill(shapePath(nail.shape || 'mandel'));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  cache.set(key, { canvas, updatedAt: design.updatedAt });
  return canvas;
}

export function forgetTextures(){ cache.clear(); }

/** Relative Groesse und Neigung der fuenf Naegel in der Uebersicht. */
export const SET_LAYOUT = [
  { key:'daumen',       scale:0.86, tilt:-0.34, lift:0.30 },
  { key:'zeigefinger',  scale:0.97, tilt:-0.11, lift:0.05 },
  { key:'mittelfinger', scale:1.00, tilt: 0.00, lift:0.00 },
  { key:'ringfinger',   scale:0.95, tilt: 0.11, lift:0.04 },
  { key:'kleiner',      scale:0.80, tilt: 0.28, lift:0.22 }
];

/** Vorschaubild eines ganzen Satzes: die fuenf Naegel nebeneinander. */
/**
 * Vorschaubild eines Satzes: die fuenf Naegel auf einem Bogen, wie die
 * Fingerspitzen einer Hand -- das liest sich auf einer Kachel besser als
 * eine flache Reihe.
 */
export async function setThumbnail(design, nailWidth = 84){
  const gap = Math.round(nailWidth * 0.14);
  const nailHeight = nailWidth * IMG_H / IMG_W;
  const width = Math.round(SET_LAYOUT.length * nailWidth + (SET_LAYOUT.length - 1) * gap + nailWidth * 0.55);
  const height = Math.round(nailHeight * 1.62);

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');

  for(let i = 0; i < SET_LAYOUT.length; i++){
    const { key, scale, tilt, lift } = SET_LAYOUT[i];
    const tex = await designTexture(design, key);
    const w = nailWidth * scale, h = nailHeight * scale;
    const cx = nailWidth * 0.3 + i * (nailWidth + gap) + nailWidth / 2;
    const cy = height - h / 2 - height * 0.05 - nailHeight * lift;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.drawImage(tex, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  return canvas;
}
