/**
 * Vorlagen und Stempel.
 *
 * Alles zeichnet in das normierte Nagelbild (600 x 840, Spitze oben) und
 * wird wie ein Pinselstrich auf die aktive Ebene gelegt -- also mit
 * Rueckgaengig, und frei weiter bemalbar.
 */

import { IMG_W, IMG_H } from './draw.js';

export const PATTERNS = [
  { id:'french',   name:'French',        zweifarbig:false },
  { id:'halbmond', name:'Halbmond',      zweifarbig:false },
  { id:'ombre',    name:'Verlauf',       zweifarbig:true  },
  { id:'diagonal', name:'Diagonal',      zweifarbig:false },
  { id:'spitze',   name:'Spitze',        zweifarbig:false },
  { id:'punkte',   name:'Punkte',        zweifarbig:false },
  { id:'streifen', name:'Streifen',      zweifarbig:false },
  { id:'glitzer',  name:'Glitzerfall',   zweifarbig:false },
  { id:'marmor',   name:'Marmor',        zweifarbig:true  },
  { id:'kontur',   name:'Rand',          zweifarbig:false }
];

export const STAMPS = [
  { id:'herz',   name:'Herz' },
  { id:'stern',  name:'Stern' },
  { id:'bluete', name:'Blüte' },
  { id:'punkt',  name:'Punkt' },
  { id:'schleife', name:'Schleife' }
];

/**
 * @param ctx     Zeichenflaeche der aktiven Ebene (600 x 840)
 * @param id      Vorlage aus PATTERNS
 * @param o       { color, color2, strength (0..1) }
 */
export function applyPattern(ctx, id, o){
  const color = o.color || '#D8456B';
  const color2 = o.color2 || '#FFFFFF';
  const s = Math.min(1, Math.max(0, o.strength == null ? 0.5 : o.strength));

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  switch(id){
    case 'french': {
      // Farbige Spitze mit geschwungener Kante
      const tiefe = IMG_H * (0.12 + s * 0.28);
      ctx.beginPath();
      ctx.moveTo(-20, tiefe);
      ctx.quadraticCurveTo(IMG_W / 2, tiefe - IMG_H * (0.05 + s * 0.09), IMG_W + 20, tiefe);
      ctx.lineTo(IMG_W + 20, -20);
      ctx.lineTo(-20, -20);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'halbmond': {
      // Farbiger Bogen am Nagelbett
      const hoehe = IMG_H * (0.10 + s * 0.22);
      ctx.beginPath();
      ctx.moveTo(-20, IMG_H + 20);
      ctx.lineTo(-20, IMG_H - hoehe);
      ctx.quadraticCurveTo(IMG_W / 2, IMG_H - hoehe - IMG_H * 0.13, IMG_W + 20, IMG_H - hoehe);
      ctx.lineTo(IMG_W + 20, IMG_H + 20);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'ombre': {
      const g = ctx.createLinearGradient(0, 0, 0, IMG_H);
      g.addColorStop(0, color);
      g.addColorStop(0.5 + (s - 0.5) * 0.6, mix(color, color2, 0.5));
      g.addColorStop(1, color2);
      ctx.fillStyle = g;
      ctx.fillRect(-20, -20, IMG_W + 40, IMG_H + 40);
      break;
    }
    case 'diagonal': {
      const versatz = IMG_H * (0.25 + s * 0.4);
      ctx.beginPath();
      ctx.moveTo(-20, versatz);
      ctx.lineTo(IMG_W + 20, versatz - IMG_H * 0.42);
      ctx.lineTo(IMG_W + 20, -20);
      ctx.lineTo(-20, -20);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'spitze': {
      // Keil von der Mitte der Spitze nach unten
      const tiefe = IMG_H * (0.3 + s * 0.45);
      ctx.beginPath();
      ctx.moveTo(-20, -20);
      ctx.lineTo(IMG_W + 20, -20);
      ctx.lineTo(IMG_W + 20, IMG_H * 0.1);
      ctx.lineTo(IMG_W / 2, tiefe);
      ctx.lineTo(-20, IMG_H * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'punkte': {
      const r = 8 + s * 26;
      const abstand = r * 3.4;
      for(let y = abstand * 0.6; y < IMG_H; y += abstand){
        const versatz = (Math.round(y / abstand) % 2) * abstand / 2;
        for(let x = versatz + abstand * 0.4; x < IMG_W; x += abstand){
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'streifen': {
      const breite = 6 + s * 26;
      ctx.lineWidth = breite;
      for(let x = -IMG_H; x < IMG_W + IMG_H; x += breite * 3){
        ctx.beginPath();
        ctx.moveTo(x, -20);
        ctx.lineTo(x + IMG_H * 0.6, IMG_H + 20);
        ctx.stroke();
      }
      break;
    }
    case 'glitzer': {
      // dicht an der Spitze, nach unten ausduennend
      const menge = Math.round(900 + s * 3200);
      for(let i = 0; i < menge; i++){
        const t = Math.pow(Math.random(), 0.45);      // oben dichter
        const y = t * IMG_H;
        const x = Math.random() * IMG_W;
        const wahrscheinlich = 1 - y / IMG_H;
        if(Math.random() > wahrscheinlich * 0.9 + 0.08) continue;
        ctx.globalAlpha = 0.35 + Math.random() * 0.65;
        ctx.beginPath();
        ctx.arc(x, y, 1 + Math.random() * (2 + s * 4), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'marmor': {
      // weiche Adern quer ueber den Nagel
      const g = ctx.createLinearGradient(0, 0, IMG_W, IMG_H);
      g.addColorStop(0, color);
      g.addColorStop(1, mix(color, color2, 0.35));
      ctx.fillStyle = g;
      ctx.fillRect(-20, -20, IMG_W + 40, IMG_H + 40);

      ctx.strokeStyle = color2;
      ctx.lineCap = 'round';
      const adern = 3 + Math.round(s * 5);
      for(let i = 0; i < adern; i++){
        ctx.globalAlpha = 0.5 + Math.random() * 0.4;
        ctx.lineWidth = 2 + Math.random() * (4 + s * 8);
        ctx.beginPath();
        let x = Math.random() * IMG_W, y = -20;
        ctx.moveTo(x, y);
        while(y < IMG_H + 20){
          x += (Math.random() - 0.5) * IMG_W * 0.5;
          y += IMG_H * (0.12 + Math.random() * 0.18);
          ctx.lineTo(Math.max(-40, Math.min(IMG_W + 40, x)), y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'kontur': {
      ctx.lineWidth = 6 + s * 26;
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2,
                     IMG_W - ctx.lineWidth, IMG_H - ctx.lineWidth);
      break;
    }
  }
  ctx.restore();
}

/** Stempel an eine Stelle setzen. size in Bildpunkten. */
export function drawStamp(ctx, id, x, y, size, color){
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.fillStyle = color;

  switch(id){
    case 'herz':
      ctx.beginPath();
      ctx.moveTo(0, 32);
      ctx.bezierCurveTo(-46, -2, -30, -40, 0, -18);
      ctx.bezierCurveTo(30, -40, 46, -2, 0, 32);
      ctx.closePath();
      ctx.fill();
      break;
    case 'stern': {
      ctx.beginPath();
      for(let i = 0; i < 10; i++){
        const r = i % 2 ? 16 : 40;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'bluete': {
      for(let i = 0; i < 5; i++){
        ctx.save();
        ctx.rotate(i * Math.PI * 2 / 5);
        ctx.beginPath();
        ctx.ellipse(0, -24, 13, 24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      break;
    }
    case 'punkt':
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'schleife':
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-46, -30, -46, 30, 0, 0);
      ctx.bezierCurveTo(46, -30, 46, 30, 0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

function mix(a, b, t){
  const pa = hex(a), pb = hex(b);
  const c = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return 'rgb(' + c(0) + ',' + c(1) + ',' + c(2) + ')';
}

function hex(c){
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [216, 69, 107];
}
