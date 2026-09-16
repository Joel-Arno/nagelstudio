/**
 * Ein gespeichertes Design zu einem fertigen, transparenten Bild zusammensetzen.
 * Wird von der Anprobe gebraucht -- der Editor macht dasselbe live in draw.js.
 */

import { shapePath } from './shapes.js';
import { RES, IMG_W, IMG_H } from './draw.js';
import { imageToUrl, releaseUrl, loadImage } from './store.js';

const cache = new Map();   // designId -> { canvas, updatedAt }

export async function designTexture(design){
  const hit = cache.get(design.id);
  if(hit && hit.updatedAt === design.updatedAt) return hit.canvas;

  const canvas = document.createElement('canvas');
  canvas.width = IMG_W;
  canvas.height = IMG_H;
  const ctx = canvas.getContext('2d');

  for(const layer of design.layers || []){
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
  ctx.fill(shapePath(design.shape || 'mandel'));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  cache.set(design.id, { canvas, updatedAt: design.updatedAt });
  return canvas;
}

export function forgetTexture(id){ cache.delete(id); }
