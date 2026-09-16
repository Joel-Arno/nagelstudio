/**
 * Anprobe: ein Foto der Hand, erkannte Nagelflaechen, aufgelegte Designs.
 *
 * Die Erkennung schaetzt die Naegel nur -- deshalb ist jeder Nagel frei
 * verschiebbar, drehbar und in der Groesse aenderbar. Ein Nagel wird als
 * Mittelpunkt, Winkel, Breite und Hoehe gefuehrt; das Viereck fuer die
 * Darstellung ergibt sich daraus.
 */

import { detectNails, loadDetector, FINGERS } from './handdetect.js';
import { drawQuad, quadContains, quadBounds } from './warp.js';
import { designTexture } from './compose.js';

const HANDLE_R = 11;      // Radius der Griffe in Bildschirmpixeln
const HANDLE_OFF = 17;    // Abstand der Griffe vom Nagelrand

export class TryOn {
  constructor(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.photo = null;       // <img>
    this.shade = null;       // Graustufenfassung fuer Licht und Schatten
    this.nails = [];         // { id, hand, name, cx, cy, angle, w, h, visible, designId }
    this.designs = new Map();// id -> Entwurf
    this.selected = null;
    this.opacity = 1;
    this.gloss = true;

    this.onChange = null;
    this._drag = null;
    this._draft = false;
    this._frame = null;
    this._textures = new Map();

    this._bind();
    window.addEventListener('resize', () => this._invalidate());
  }

  /* ---------------- Foto ---------------- */

  async setPhoto(img){
    this.photo = img;
    this.nails = [];
    this.selected = null;

    const w = img.naturalWidth, h = img.naturalHeight;
    const shade = document.createElement('canvas');
    shade.width = w; shade.height = h;
    const sctx = shade.getContext('2d');
    // Nur Helligkeit, keine Farbe: so bleiben Licht und Schatten der Hand
    // erhalten, ohne den Hautton in das Design zu ziehen.
    // Weichzeichnen, damit nur Licht und Schatten durchkommen -- ohne
    // Weichzeichner schlaegt die Hautstruktur durch und der Nagel wirkt
    // wie eine aufgelegte Folie.
    const blur = Math.max(1.5, Math.min(7, Math.min(w, h) * 0.008));
    if(typeof sctx.filter === 'string'){
      sctx.filter = 'grayscale(1) blur(' + blur.toFixed(1) + 'px) contrast(0.62)';
    }
    sctx.drawImage(img, 0, 0);
    if(typeof sctx.filter !== 'string') this._flattenShade(sctx, w, h);
    this.shade = shade;

    this._invalidate();
  }

  _flattenShade(ctx, w, h){    // Rueckfallebene ohne ctx.filter
    const d = ctx.getImageData(0, 0, w, h);
    const px = d.data;
    for(let i = 0; i < px.length; i += 4){
      const l = 0.213 * px[i] + 0.715 * px[i+1] + 0.072 * px[i+2];
      const v = Math.max(0, Math.min(255, 128 + (l - 128) * 0.62));
      px[i] = px[i+1] = px[i+2] = v;
    }
    ctx.putImageData(d, 0, 0);
  }

  /* ---------------- Erkennung ---------------- */

  async detect(onStatus){
    if(!this.photo) return { hands:0, nails:0 };
    await loadDetector(onStatus);
    if(onStatus) onStatus('Hand wird gesucht …');

    const hands = await detectNails(this.photo, this.photo.naturalWidth, this.photo.naturalHeight);
    hands.sort((a, b) => a.mittelX - b.mittelX);

    const nails = [];
    hands.forEach((hand, hi) => {
      const handName = hands.length < 2 ? '' : (hi === 0 ? 'links im Bild' : 'rechts im Bild');
      hand.nails.forEach(n => {
        nails.push(Object.assign(
          { id: 'n' + hi + '-' + n.finger, hand: hi, handName, name: n.name,
            visible: true, designId: null },
          boxFromQuad(n.quad)
        ));
      });
    });
    this.nails = nails;
    this.selected = nails.length ? nails[0].id : null;
    this._invalidate();
    return { hands: hands.length, nails: nails.length };
  }

  /**
   * Naegel von Hand setzen. Ohne erkannte Naegel gleich fuenf Stueck,
   * sonst einen einzelnen -- etwa fuer einen Finger, den die Erkennung
   * uebersehen hat.
   */
  addManualNails(){
    if(!this.photo) return 0;
    const W = this.photo.naturalWidth, H = this.photo.naturalHeight;
    const base = Math.min(W, H) * 0.09;
    const count = this.nails.length ? 1 : 5;
    const nails = [];
    for(let i = 0; i < count; i++){
      nails.push({
        id: 'm-' + Date.now().toString(36) + '-' + i,
        hand: 0, handName: 'von Hand', name: FINGERS[i % FINGERS.length].name,
        cx: count === 1 ? W * 0.5 : W * (0.28 + i * 0.11),
        cy: count === 1 ? H * 0.5 : H * 0.45,
        angle: -Math.PI / 2,
        w: base * (i === 0 ? 1.1 : 1 - i * 0.07),
        h: base * 1.3 * (i === 0 ? 1 : 1 - i * 0.06),
        visible: true, designId: null
      });
    }
    this.nails = this.nails.concat(nails);
    this.selected = nails[0].id;
    this._invalidate();
    return nails.length;
  }

  /* ---------------- Entwuerfe ---------------- */

  setDesigns(list){
    this.designs = new Map(list.map(d => [d.id, d]));
  }

  async assign(nailId, designId){
    const nail = this.nails.find(n => n.id === nailId);
    if(!nail) return;
    nail.designId = designId;
    nail.visible = true;
    await this._ensureTexture(designId);
    this._invalidate();
  }

  async assignAll(designId){
    await this._ensureTexture(designId);
    this.nails.forEach(n => { n.designId = designId; n.visible = true; });
    this._invalidate();
  }

  async _ensureTexture(designId){
    if(!designId || this._textures.has(designId)) return;
    const design = this.designs.get(designId);
    if(!design) return;
    this._textures.set(designId, await designTexture(design));
  }

  async refreshTextures(){
    this._textures.clear();
    for(const n of this.nails) await this._ensureTexture(n.designId);
    this._invalidate();
  }

  get selectedNail(){ return this.nails.find(n => n.id === this.selected) || null; }

  select(id){ this.selected = id; this._invalidate(); }

  toggleVisible(id){
    const n = this.nails.find(x => x.id === (id || this.selected));
    if(!n) return;
    n.visible = !n.visible;
    this._invalidate();
  }

  setOpacity(v){ this.opacity = v; this._invalidate(); }
  setGloss(on){ this.gloss = !!on; this._invalidate(); }

  /* ---------------- Ansicht und Koordinaten ---------------- */

  _layout(){
    const r = this.canvas.getBoundingClientRect();
    if(!this.photo) return { scale:1, ox:0, oy:0, rect:r };
    const W = this.photo.naturalWidth, H = this.photo.naturalHeight;
    const scale = Math.min(r.width / W, r.height / H);
    return { scale, ox: (r.width - W * scale) / 2, oy: (r.height - H * scale) / 2, rect: r };
  }

  _toPhoto(clientX, clientY){
    const { scale, ox, oy, rect } = this._layout();
    return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale };
  }

  _toScreen(p){
    const { scale, ox, oy } = this._layout();
    return { x: p.x * scale + ox, y: p.y * scale + oy };
  }

  /* ---------------- Ziehen und Griffe ---------------- */

  _bind(){
    const c = this.canvas;
    c.style.touchAction = 'none';

    c.addEventListener('pointerdown', (e) => {
      if(!this.photo) return;
      c.setPointerCapture(e.pointerId);
      const p = this._toPhoto(e.clientX, e.clientY);

      const sel = this.selectedNail;
      if(sel && sel.visible){
        const handle = this._handleAt(e.clientX, e.clientY, sel);
        if(handle){
          this._drag = { mode: handle, nail: sel, start: p,
                         w0: sel.w, h0: sel.h, a0: sel.angle };
          this._draft = true;
          return;
        }
      }

      // Nagel unter dem Finger auswaehlen
      const hit = [...this.nails].reverse().find(n => n.visible && quadContains(quadOf(n), p.x, p.y));
      if(hit){
        this.selected = hit.id;
        this._drag = { mode:'move', nail: hit, start: p, cx0: hit.cx, cy0: hit.cy };
        this._draft = true;
        this._invalidate();
        if(this.onChange) this.onChange('select');
      }
    });

    c.addEventListener('pointermove', (e) => {
      if(!this._drag) return;
      const p = this._toPhoto(e.clientX, e.clientY);
      const d = this._drag;
      const n = d.nail;

      if(d.mode === 'move'){
        n.cx = d.cx0 + (p.x - d.start.x);
        n.cy = d.cy0 + (p.y - d.start.y);
      }else if(d.mode === 'tip'){
        // Drehen und Laenge zugleich: der Griff sitzt vor der Nagelspitze
        const dx = p.x - n.cx, dy = p.y - n.cy;
        n.angle = Math.atan2(dy, dx);
        n.h = Math.max(6, (Math.hypot(dx, dy) - this._offsetInPhoto()) * 2);
      }else if(d.mode === 'side'){
        const dx = p.x - n.cx, dy = p.y - n.cy;
        const across = Math.abs(dx * Math.cos(n.angle + Math.PI / 2) + dy * Math.sin(n.angle + Math.PI / 2));
        n.w = Math.max(5, (across - this._offsetInPhoto()) * 2);
      }
      this._invalidate();
    });

    const end = () => {
      if(!this._drag) return;
      this._drag = null;
      this._draft = false;
      this._invalidate();
      if(this.onChange) this.onChange('adjust');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  _handlePoints(nail){
    const q = quadOf(nail);
    const tip = this._toScreen({ x:(q[0].x + q[1].x) / 2, y:(q[0].y + q[1].y) / 2 });
    const side = this._toScreen({ x:(q[1].x + q[2].x) / 2, y:(q[1].y + q[2].y) / 2 });
    const c = this._toScreen({ x: nail.cx, y: nail.cy });
    // ein Stueck nach aussen schieben, sonst liegen die Griffe auf dem Nagel
    const push = (p) => {
      const dx = p.x - c.x, dy = p.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      return { x: p.x + dx / d * HANDLE_OFF, y: p.y + dy / d * HANDLE_OFF };
    };
    return { tip: push(tip), side: push(side) };
  }

  /** Griffabstand in Fotokoordinaten -- haengt von der Anzeigegroesse ab. */
  _offsetInPhoto(){
    const { scale } = this._layout();
    return HANDLE_OFF / (scale || 1);
  }

  _handleAt(clientX, clientY, nail){
    const r = this.canvas.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    const pts = this._handlePoints(nail);
    for(const key of ['tip', 'side']){
      if(Math.hypot(pts[key].x - x, pts[key].y - y) <= HANDLE_R + 8) return key;
    }
    return null;
  }

  /* ---------------- Darstellung ---------------- */

  _invalidate(){
    if(this._frame) return;
    this._frame = requestAnimationFrame(() => { this._frame = null; this.render(); });
  }

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

    // Naegel im Fotoraum zeichnen, dann mit derselben Abbildung einblenden
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    for(const nail of this.nails){
      if(!nail.visible || !nail.designId) continue;
      const tex = this._textures.get(nail.designId);
      if(tex) this._paintNail(ctx, nail, tex);
    }
    ctx.restore();

    this._paintHandles(ctx);
  }

  _paintNail(ctx, nail, tex){
    const quad = quadOf(nail);
    const b = quadBounds(quad, 2);
    if(b.w < 2 || b.h < 2) return;

    const layer = document.createElement('canvas');
    layer.width = Math.ceil(b.w); layer.height = Math.ceil(b.h);
    const lc = layer.getContext('2d');
    const local = quad.map(p => ({ x: p.x - b.x, y: p.y - b.y }));
    drawQuad(lc, tex, local, this._draft ? 2 : 6);

    // Maske fuer spaeter sichern
    const mask = document.createElement('canvas');
    mask.width = layer.width; mask.height = layer.height;
    mask.getContext('2d').drawImage(layer, 0, 0);

    // Licht und Schatten der Hand durchscheinen lassen. soft-light laesst
    // mittleres Grau unveraendert -- nur hellere und dunklere Stellen des
    // Fotos wirken sich aus, die Lackfarbe bleibt sie selbst.
    lc.globalCompositeOperation = 'soft-light';
    lc.drawImage(this.shade, b.x, b.y, b.w, b.h, 0, 0, layer.width, layer.height);

    if(this.gloss){
      lc.globalCompositeOperation = 'screen';
      const g = lc.createLinearGradient(0, 0, layer.width * 0.7, layer.height);
      g.addColorStop(0, 'rgba(255,255,255,0.34)');
      g.addColorStop(0.42, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      lc.fillStyle = g;
      lc.fillRect(0, 0, layer.width, layer.height);
    }

    // Alles wieder auf die Nagelflaeche beschneiden
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(mask, 0, 0);
    lc.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.drawImage(layer, b.x, b.y, b.w, b.h);
    ctx.restore();
  }

  _paintHandles(ctx){
    const nail = this.selectedNail;
    if(!nail || !nail.visible) return;
    const q = quadOf(nail).map(p => this._toScreen(p));

    ctx.save();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(224,86,124,0.95)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    for(let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    const pts = this._handlePoints(nail);
    for(const key of ['tip', 'side']){
      const p = pts[key];
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = key === 'tip' ? '#E0567C' : '#E8C07D';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Das fertige Bild in Originalaufloesung. */
  exportImage(){
    const W = this.photo.naturalWidth, H = this.photo.naturalHeight;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    ctx.drawImage(this.photo, 0, 0);
    const wasDraft = this._draft;
    this._draft = false;
    for(const nail of this.nails){
      if(!nail.visible || !nail.designId) continue;
      const tex = this._textures.get(nail.designId);
      if(tex) this._paintNail(ctx, nail, tex);
    }
    this._draft = wasDraft;
    return out;
  }
}

/* ---------------- Geometrie ---------------- */

/** Viereck [Spitze-links, Spitze-rechts, Basis-rechts, Basis-links]. */
export function quadOf(n){
  const ux = Math.cos(n.angle), uy = Math.sin(n.angle);       // Richtung zur Spitze
  const nx = -uy, ny = ux;                                    // quer dazu
  const hx = ux * n.h / 2, hy = uy * n.h / 2;
  const wx = nx * n.w / 2, wy = ny * n.w / 2;
  return [
    { x: n.cx + hx - wx, y: n.cy + hy - wy },
    { x: n.cx + hx + wx, y: n.cy + hy + wy },
    { x: n.cx - hx + wx, y: n.cy - hy + wy },
    { x: n.cx - hx - wx, y: n.cy - hy - wy }
  ];
}

export function boxFromQuad(q){
  const tipMid = { x:(q[0].x + q[1].x) / 2, y:(q[0].y + q[1].y) / 2 };
  const baseMid = { x:(q[2].x + q[3].x) / 2, y:(q[2].y + q[3].y) / 2 };
  return {
    cx: (tipMid.x + baseMid.x) / 2,
    cy: (tipMid.y + baseMid.y) / 2,
    angle: Math.atan2(tipMid.y - baseMid.y, tipMid.x - baseMid.x),
    w: Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y),
    h: Math.hypot(tipMid.x - baseMid.x, tipMid.y - baseMid.y)
  };
}
