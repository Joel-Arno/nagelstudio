/**
 * Naegel aus einem Foto uebernehmen.
 *
 * Auf dem Foto liegt pro Finger ein Rahmen in der gewaehlten Nagelform. Die
 * Erkennung setzt die Rahmen vor, verschoben und gedreht wird wie in der
 * Anprobe. Was im Rahmen liegt, wird entzerrt ins Nagelraster kopiert und
 * wird so zu einer ganz normalen Ebene -- weiter bemalbar und anprobierbar.
 */

import { TryOn, quadOf } from './tryon.js';
import { FINGERS } from './handdetect.js';
import { shapePath, effectiveLength, SHAPE_W, SHAPE_H, PLATE_W, RASTER_RATIO } from './shapes.js';

const AUSGABE_W = SHAPE_W * 6;   // wie das Zeichenraster im Editor
const AUSGABE_H = SHAPE_H * 6;

export class Entnahme extends TryOn {
  constructor(canvas){
    super(canvas);
    this.form = { shape: 'oval', length: 0.36 };
    // Nur ein Rahmen: fuer einen einzelnen Nagel im Editor (nurFinger) oder
    // als Vorlage fuer alle fuenf Finger (einzeln).
    this.nurFinger = null;
    this.einzeln = false;
    this.griffe = true;
  }

  setForm(shape, length){
    this.form = { shape, length: effectiveLength(shape, length) };
    this._invalidate();
  }

  /** Der Rahmen folgt immer der gewaehlten Form. */
  _shapeOf(){ return this.form; }

  get einRahmen(){ return !!this.nurFinger || this.einzeln; }

  async detect(onStatus){
    const res = await super.detect(onStatus);
    if(!this.nails.length) return res;

    // Nur eine Hand verwenden: die mit den groessten Naegeln
    const haende = new Map();
    for(const n of this.nails){
      if(!haende.has(n.hand)) haende.set(n.hand, []);
      haende.get(n.hand).push(n);
    }
    let beste = null, groesse = -1;
    for(const liste of haende.values()){
      const g = liste.reduce((s, n) => s + n.w, 0) / liste.length;
      if(g > groesse){ groesse = g; beste = liste; }
    }
    let nails = beste.map(n => Object.assign(n, { hand: 0, handName: '' }));
    if(this.nurFinger){
      const n = nails.find(x => x.finger === this.nurFinger)
             || nails.find(x => x.finger === 'mittelfinger') || nails[0];
      nails = [n];
    }
    this.nails = nails;
    this.selected = (nails.find(n => n.finger === 'mittelfinger') || nails[0]).id;
    this._sichtbarkeit();
    return { ...res, hands: 1, nails: nails.length };
  }

  /** Rahmen fuer einen Finger holen -- fehlt er, wird einer gesetzt. */
  rahmenFuer(finger){
    let n = this.nails.find(x => x.finger === finger);
    if(!n){
      const W = this.photo.naturalWidth, H = this.photo.naturalHeight;
      const vorbild = this.selectedNail || this.nails[0];
      const platte = vorbild ? vorbild.w * PLATE_W : Math.min(W, H) * (this.einRahmen ? 0.28 : 0.1);
      const f = FINGERS.find(x => x.key === finger) || FINGERS[2];
      n = {
        id: 'e-' + finger, hand: 0, handName: '', name: f.name, finger,
        cx: W / 2, cy: H / 2, angle: vorbild ? vorbild.angle : -Math.PI / 2,
        w: platte / PLATE_W, h: platte / PLATE_W * RASTER_RATIO,
        visible: true, designId: null
      };
      this.nails.push(n);
    }
    this.selected = n.id;
    this._sichtbarkeit();
    return n;
  }

  /** Ohne Erkennung: Rahmen von Hand setzen. */
  addManualNails(){
    if(!this.photo) return 0;
    const W = this.photo.naturalWidth, H = this.photo.naturalHeight;
    this.nails = [];
    this.selected = null;
    if(this.einRahmen){
      this.rahmenFuer(this.nurFinger || 'mittelfinger');
      return 1;
    }
    const platte = Math.min(W * 0.09, H * 0.13);
    FINGERS.forEach((f, i) => {
      const n = this.rahmenFuer(f.key);
      n.cx = W * (0.2 + i * 0.15);
      n.cy = H * (i === 0 ? 0.58 : 0.42);
      n.w = platte * (i === 0 ? 1.1 : 1 - i * 0.06) / PLATE_W;
      n.h = n.w * RASTER_RATIO;
    });
    this.selected = this.nails[2].id;
    this._sichtbarkeit();
    return this.nails.length;
  }

  /** "Ein Nagel fuer alle": nur der ausgewaehlte Rahmen bleibt sichtbar. */
  setEinzeln(an){
    this.einzeln = !!an;
    if(this.einzeln && !this.selectedNail && this.nails.length) this.selected = this.nails[0].id;
    this._sichtbarkeit();
  }

  select(id){
    super.select(id);
    this._sichtbarkeit();
  }

  _sichtbarkeit(){
    for(const n of this.nails) n.visible = !this.einRahmen || n.id === this.selected;
    this._invalidate();
  }

  /** Rahmen fuer das Uebernehmen: den des Fingers oder den naechstgelegenen. */
  rahmenZumUebernehmen(finger){
    const sichtbar = this.nails.filter(n => n.visible);
    if(!sichtbar.length) return null;
    if(this.einRahmen) return this.selectedNail && this.selectedNail.visible ? this.selectedNail : sichtbar[0];
    const eigen = sichtbar.find(n => n.finger === finger);
    if(eigen) return eigen;
    const pos = (k) => FINGERS.findIndex(f => f.key === k);
    return sichtbar.slice().sort((a, b) =>
      Math.abs(pos(a.finger) - pos(finger)) - Math.abs(pos(b.finger) - pos(finger)))[0];
  }

  /**
   * Den Inhalt eines Rahmens entzerrt ins Nagelraster kopieren. Ausserhalb
   * der Form bleibt es durchsichtig -- sonst kaeme bei einer spaeter
   * verlaengerten Form die Haut aus dem Foto mit.
   */
  ausschneiden(nail, w = AUSGABE_W, h = AUSGABE_H){
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    const q = quadOf(nail);
    const m = new DOMMatrix([
      (q[1].x - q[0].x) / w, (q[1].y - q[0].y) / w,
      (q[3].x - q[0].x) / h, (q[3].y - q[0].y) / h,
      q[0].x, q[0].y
    ]).inverse();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.drawImage(this.photo, 0, 0);
    ctx.setTransform(w / SHAPE_W, 0, 0, h / SHAPE_H, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fill(shapePath(this.form.shape, this.form.length));
    ctx.globalCompositeOperation = 'source-over';
    return out;
  }

  /** Kleine Vorschau fuer die Fingerleiste. */
  vorschau(nail, w = 30){
    return this.ausschneiden(nail, w * 2, Math.round(w * 2 * RASTER_RATIO));
  }

  /* ---------------- Darstellung ---------------- */

  render(){
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if(c.width !== w || c.height !== h){ c.width = w; c.height = h; }

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if(!this.photo) return;

    const { scale, ox, oy } = this._layout();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(this.photo, ox, oy, this.photo.naturalWidth * scale, this.photo.naturalHeight * scale);

    const sichtbar = this.nails.filter(n => n.visible);
    const umrisse = sichtbar.map(n => ({ n, pfad: this._umriss(n, scale, ox, oy) }));

    // Alles ausser den Naegeln abdunkeln -- man sieht sofort, was uebernommen wird
    const maske = new Path2D();
    maske.rect(0, 0, r.width, r.height);
    umrisse.forEach(u => maske.addPath(u.pfad));
    ctx.fillStyle = 'rgba(24,12,18,0.46)';
    ctx.fill(maske, 'evenodd');

    for(const { n, pfad } of umrisse){
      const aktiv = n.id === this.selected;
      ctx.lineWidth = aktiv ? 2.4 : 1.6;
      ctx.strokeStyle = aktiv ? '#E0567C' : 'rgba(255,255,255,0.9)';
      ctx.setLineDash(aktiv ? [] : [5, 4]);
      ctx.stroke(pfad);
      ctx.setLineDash([]);
      if(!this.einRahmen) this._schild(ctx, n, scale, ox, oy, aktiv);
    }

    const sel = this.selectedNail;
    if(sel && sel.visible){
      const pts = this._handlePoints(sel);
      for(const key of ['tip', 'side']){
        const p = pts[key];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
        ctx.fillStyle = key === 'tip' ? '#E0567C' : '#E8C07D';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
    }
    this._paintPuls(ctx);
  }

  /** Umriss der Form auf dem Bildschirm. */
  _umriss(n, scale, ox, oy){
    const q = quadOf(n);
    const m = new DOMMatrix([
      (q[1].x - q[0].x) * scale / SHAPE_W, (q[1].y - q[0].y) * scale / SHAPE_W,
      (q[3].x - q[0].x) * scale / SHAPE_H, (q[3].y - q[0].y) * scale / SHAPE_H,
      q[0].x * scale + ox, q[0].y * scale + oy
    ]);
    const p = new Path2D();
    p.addPath(shapePath(this.form.shape, this.form.length), m);
    return p;
  }

  /** Fingername unterhalb der Nagelhaut. */
  _schild(ctx, n, scale, ox, oy, aktiv){
    const ux = Math.cos(n.angle), uy = Math.sin(n.angle);
    const x = (n.cx - ux * n.h / 2) * scale + ox - ux * 16;
    const y = (n.cy - uy * n.h / 2) * scale + oy - uy * 16;
    const text = n.finger === 'kleiner' ? 'Kleiner' : n.name;
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    const tw = ctx.measureText(text).width + 14;
    ctx.fillStyle = aktiv ? '#D9467F' : 'rgba(30,20,25,0.62)';
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(x - tw / 2, y - 10, tw, 20, 10); else ctx.rect(x - tw / 2, y - 10, tw, 20);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y + 4);
    ctx.textAlign = 'start';
  }
}
