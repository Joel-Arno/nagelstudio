/**
 * Zeichen-Engine fuer einen einzelnen Nagel.
 *
 * Gezeichnet wird immer in ein festes, normiertes Bild (600 x 840), das der
 * Nagelform entspricht. Die Form wird erst beim Anzeigen als Maske angewandt --
 * man darf also ueber den Rand hinausmalen, ohne dass etwas kaputtgeht.
 */

import { SHAPE_W, SHAPE_H, shapePath } from './shapes.js';

export const RES = 6;                 // Skalierung des normierten Systems
export const IMG_W = SHAPE_W * RES;   // 600
export const IMG_H = SHAPE_H * RES;   // 840

const UNDO_STEPS = 24;

function newCanvas(w = IMG_W, h = IMG_H){
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

let layerCounter = 0;
function layerId(){ return 'l' + (++layerCounter) + '-' + Math.random().toString(36).slice(2, 7); }

export class NailEditor {
  constructor(viewCanvas){
    this.view = viewCanvas;
    this.ctx = viewCanvas.getContext('2d');

    this.shape = 'mandel';
    this.layers = [];          // { id, name, visible, opacity, canvas, ctx }
    this.activeLayerId = null;

    this.tool = 'brush';       // brush | liner | glitter | eraser
    this.color = '#D8456B';
    this.size = 26;
    this.opacity = 1;
    this.usePressure = true;

    this.composite = newCanvas();
    this.compositeCtx = this.composite.getContext('2d');
    this.stroke = newCanvas();
    this.strokeCtx = this.stroke.getContext('2d');
    this.undoBuffer = newCanvas();

    this.undoStack = [];
    this.redoStack = [];

    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;

    this.showGloss = true;
    this.onChange = null;      // (reason) => void
    this.onHistory = null;

    this._compositeDirty = true;
    this._frame = null;
    this._pointers = new Map();
    this._drawing = null;
    this._penSeen = false;
    this._pinch = null;

    this._bindPointer();
    this._observeSize();
  }

  /* ---------------- Ebenen ---------------- */

  addLayer(name){
    const canvas = newCanvas();
    const layer = {
      id: layerId(),
      name: name || 'Ebene ' + (this.layers.length + 1),
      visible: true,
      opacity: 1,
      canvas,
      ctx: canvas.getContext('2d')
    };
    this.layers.push(layer);
    this.activeLayerId = layer.id;
    this._changed('layers');
    return layer;
  }

  get activeLayer(){
    return this.layers.find(l => l.id === this.activeLayerId) || this.layers[this.layers.length - 1] || null;
  }

  selectLayer(id){
    if(this.layers.some(l => l.id === id)){
      this.activeLayerId = id;
      this._changed('layers');
    }
  }

  removeLayer(id){
    const i = this.layers.findIndex(l => l.id === id);
    if(i < 0 || this.layers.length <= 1) return false;
    this.layers.splice(i, 1);
    if(this.activeLayerId === id) this.activeLayerId = this.layers[Math.max(0, i - 1)].id;
    this._dropHistoryFor(id);
    this._invalidate('layers');
    return true;
  }

  moveLayer(id, dir){
    const i = this.layers.findIndex(l => l.id === id);
    const j = i + dir;
    if(i < 0 || j < 0 || j >= this.layers.length) return false;
    const [l] = this.layers.splice(i, 1);
    this.layers.splice(j, 0, l);
    this._invalidate('layers');
    return true;
  }

  setLayerVisible(id, visible){
    const l = this.layers.find(x => x.id === id);
    if(!l) return;
    l.visible = !!visible;
    this._invalidate('layers');
  }

  setLayerOpacity(id, opacity){
    const l = this.layers.find(x => x.id === id);
    if(!l) return;
    l.opacity = Math.min(1, Math.max(0, opacity));
    this._invalidate('layers');
  }

  clearLayer(id){
    const l = this.layers.find(x => x.id === (id || this.activeLayerId));
    if(!l) return;
    this._pushUndo(l, 0, 0, IMG_W, IMG_H);
    l.ctx.clearRect(0, 0, IMG_W, IMG_H);
    this._invalidate('draw');
  }

  fillLayer(id){
    const l = this.layers.find(x => x.id === (id || this.activeLayerId));
    if(!l) return;
    this._pushUndo(l, 0, 0, IMG_W, IMG_H);
    l.ctx.save();
    l.ctx.globalAlpha = this.opacity;
    l.ctx.fillStyle = this.color;
    l.ctx.fillRect(0, 0, IMG_W, IMG_H);
    l.ctx.restore();
    this._invalidate('draw');
  }

  /* ---------------- Form ---------------- */

  setShape(id){
    this.shape = id;
    this._invalidate('shape');
  }

  /* ---------------- Werkzeuge ---------------- */

  setTool(t){ this.tool = t; }
  setColor(c){ this.color = c; }
  setSize(s){ this.size = s; }
  setOpacity(o){ this.opacity = Math.min(1, Math.max(0.02, o)); }
  setPressure(on){ this.usePressure = !!on; }

  /* ---------------- Zeichnen ---------------- */

  _bindPointer(){
    const v = this.view;
    v.style.touchAction = 'none';

    v.addEventListener('pointerdown', (e) => {
      if(e.pointerType === 'pen') this._penSeen = true;
      v.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, e);

      if(this._pointers.size === 2){ this._endStroke(); this._startPinch(); return; }
      if(this._pointers.size > 2) return;

      if(this._isNavPointer(e)){ this._pan = { x:e.clientX, y:e.clientY }; return; }
      this._startStroke(e);
    });

    v.addEventListener('pointermove', (e) => {
      if(!this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, e);

      if(this._pinch && this._pointers.size >= 2){ this._movePinch(); return; }
      if(this._pan){
        this.panX += e.clientX - this._pan.x;
        this.panY += e.clientY - this._pan.y;
        this._pan = { x:e.clientX, y:e.clientY };
        this._invalidate('view');
        return;
      }
      if(!this._drawing) return;

      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for(const ev of (events.length ? events : [e])) this._extendStroke(ev);
    });

    const up = (e) => {
      this._pointers.delete(e.pointerId);
      if(this._pointers.size < 2) this._pinch = null;
      if(this._pointers.size === 0){
        this._pan = null;
        this._endStroke();
      }
    };
    v.addEventListener('pointerup', up);
    v.addEventListener('pointercancel', up);
    v.addEventListener('pointerleave', (e) => { if(this._pointers.size === 0) this._endStroke(); });
  }

  /* Mit Pencil am iPad schiebt der Finger das Bild, statt zu malen. */
  _isNavPointer(e){
    return this._penSeen && e.pointerType === 'touch';
  }

  _startStroke(e){
    const layer = this.activeLayer;
    if(!layer) return;

    this.undoBuffer.getContext('2d').clearRect(0, 0, IMG_W, IMG_H);
    this.undoBuffer.getContext('2d').drawImage(layer.canvas, 0, 0);

    this.strokeCtx.clearRect(0, 0, IMG_W, IMG_H);
    this.strokeCtx.lineCap = 'round';
    this.strokeCtx.lineJoin = 'round';
    this.strokeCtx.strokeStyle = this.color;
    this.strokeCtx.fillStyle = this.color;

    const p = this._toImage(e);
    this._drawing = {
      layer,
      last: p,
      bbox: { x0:p.x, y0:p.y, x1:p.x, y1:p.y },
      maxWidth: this._widthFor(p.pressure)
    };
    this._dab(p);
    this._invalidate('draw');
  }

  _extendStroke(e){
    const d = this._drawing;
    if(!d) return;
    const p = this._toImage(e);
    const w = this._widthFor(p.pressure);
    d.maxWidth = Math.max(d.maxWidth, w);

    if(this.tool === 'glitter'){
      this._glitter(d.last, p, w);
    }else{
      this.strokeCtx.lineWidth = w;
      this.strokeCtx.beginPath();
      this.strokeCtx.moveTo(d.last.x, d.last.y);
      const mx = (d.last.x + p.x) / 2, my = (d.last.y + p.y) / 2;
      this.strokeCtx.quadraticCurveTo(d.last.x, d.last.y, mx, my);
      this.strokeCtx.lineTo(p.x, p.y);
      this.strokeCtx.stroke();
    }

    d.bbox.x0 = Math.min(d.bbox.x0, p.x); d.bbox.y0 = Math.min(d.bbox.y0, p.y);
    d.bbox.x1 = Math.max(d.bbox.x1, p.x); d.bbox.y1 = Math.max(d.bbox.y1, p.y);
    d.last = p;
    this._invalidate('draw');
  }

  _dab(p){
    const w = this._widthFor(p.pressure);
    if(this.tool === 'glitter'){ this._glitter(p, p, w); return; }
    this.strokeCtx.beginPath();
    this.strokeCtx.arc(p.x, p.y, w / 2, 0, Math.PI * 2);
    this.strokeCtx.fill();
  }

  _glitter(a, b, w){
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(2, Math.round(dist / 3) + 3);
    for(let i = 0; i < n; i++){
      const t = n === 1 ? 0 : i / (n - 1);
      const cx = a.x + (b.x - a.x) * t;
      const cy = a.y + (b.y - a.y) * t;
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * w * 0.6;
      const r = 0.8 + Math.random() * Math.max(1.2, w * 0.12);
      this.strokeCtx.globalAlpha = 0.35 + Math.random() * 0.65;
      this.strokeCtx.beginPath();
      this.strokeCtx.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, r, 0, Math.PI * 2);
      this.strokeCtx.fill();
    }
    this.strokeCtx.globalAlpha = 1;
  }

  _endStroke(){
    const d = this._drawing;
    this._drawing = null;
    this._pan = null;
    if(!d) return;

    const pad = d.maxWidth + 12;
    const x = Math.max(0, Math.floor(d.bbox.x0 - pad));
    const y = Math.max(0, Math.floor(d.bbox.y0 - pad));
    const w = Math.min(IMG_W - x, Math.ceil(d.bbox.x1 - d.bbox.x0 + pad * 2));
    const h = Math.min(IMG_H - y, Math.ceil(d.bbox.y1 - d.bbox.y0 + pad * 2));
    if(w <= 0 || h <= 0) return;

    this._pushUndo(d.layer, x, y, w, h, this.undoBuffer);

    const ctx = d.layer.ctx;
    ctx.save();
    ctx.globalAlpha = this.opacity;
    if(this.tool === 'eraser'){
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
    }
    if(this.tool === 'brush'){
      const blur = Math.min(2.4, Math.max(0.5, this.size * 0.035));
      if(typeof ctx.filter === 'string') ctx.filter = 'blur(' + blur.toFixed(2) + 'px)';
    }
    ctx.drawImage(this.stroke, 0, 0);
    ctx.restore();

    this.strokeCtx.clearRect(0, 0, IMG_W, IMG_H);
    this._invalidate('draw');
    this._changed('stroke');
  }

  _widthFor(pressure){
    if(!this.usePressure || pressure == null) return this.size;
    const min = this.tool === 'liner' ? 0.55 : 0.25;
    return this.size * (min + (1 - min) * pressure);
  }

  /* Bildschirmpunkt -> Bildkoordinate */
  _toImage(e){
    const r = this.view.getBoundingClientRect();
    const { scale, ox, oy } = this._layout();
    const x = (e.clientX - r.left - ox) / scale;
    const y = (e.clientY - r.top - oy) / scale;
    let pressure = null;
    if(e.pointerType === 'pen'){
      pressure = e.pressure > 0 ? e.pressure : 0.5;
    }else if(e.pressure && e.pressure !== 0.5 && e.pressure !== 1){
      pressure = e.pressure;
    }
    return { x, y, pressure };
  }

  /* ---------------- Verlauf ---------------- */

  _pushUndo(layer, x, y, w, h, fromCanvas){
    const src = fromCanvas || layer.canvas;
    const patch = newCanvas(w, h);
    patch.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
    this.undoStack.push({ layerId: layer.id, x, y, w, h, patch });
    if(this.undoStack.length > UNDO_STEPS) this.undoStack.shift();
    this.redoStack.length = 0;
    if(this.onHistory) this.onHistory();
  }

  _applyPatch(entry, intoStack){
    const layer = this.layers.find(l => l.id === entry.layerId);
    if(!layer) return false;
    const current = newCanvas(entry.w, entry.h);
    current.getContext('2d').drawImage(layer.canvas, entry.x, entry.y, entry.w, entry.h, 0, 0, entry.w, entry.h);
    intoStack.push({ layerId: entry.layerId, x: entry.x, y: entry.y, w: entry.w, h: entry.h, patch: current });

    layer.ctx.save();
    layer.ctx.globalCompositeOperation = 'copy';
    layer.ctx.clearRect(entry.x, entry.y, entry.w, entry.h);
    layer.ctx.restore();
    layer.ctx.clearRect(entry.x, entry.y, entry.w, entry.h);
    layer.ctx.drawImage(entry.patch, entry.x, entry.y);
    this._invalidate('draw');
    this._changed('undo');
    if(this.onHistory) this.onHistory();
    return true;
  }

  undo(){
    const entry = this.undoStack.pop();
    if(!entry) return false;
    return this._applyPatch(entry, this.redoStack);
  }

  redo(){
    const entry = this.redoStack.pop();
    if(!entry) return false;
    return this._applyPatch(entry, this.undoStack);
  }

  canUndo(){ return this.undoStack.length > 0; }
  canRedo(){ return this.redoStack.length > 0; }

  _dropHistoryFor(layerId){
    this.undoStack = this.undoStack.filter(e => e.layerId !== layerId);
    this.redoStack = this.redoStack.filter(e => e.layerId !== layerId);
    if(this.onHistory) this.onHistory();
  }

  resetHistory(){
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    if(this.onHistory) this.onHistory();
  }

  /* ---------------- Darstellung ---------------- */

  _observeSize(){
    const resize = () => { this._sizeView(); this._invalidate('view'); };
    if(window.ResizeObserver){
      this._ro = new ResizeObserver(resize);
      this._ro.observe(this.view);
    }
    window.addEventListener('resize', resize);
    this._sizeView();
  }

  _sizeView(){
    const r = this.view.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if(this.view.width !== w || this.view.height !== h){
      this.view.width = w;
      this.view.height = h;
    }
    this._dpr = dpr;
  }

  _layout(){
    const r = this.view.getBoundingClientRect();
    const pad = 18;
    const base = Math.min((r.width - pad * 2) / IMG_W, (r.height - pad * 2) / IMG_H);
    const scale = base * this.zoom;
    const ox = (r.width - IMG_W * scale) / 2 + this.panX;
    const oy = (r.height - IMG_H * scale) / 2 + this.panY;
    return { scale, ox, oy };
  }

  zoomBy(factor, cx, cy){
    const before = this._layout();
    const r = this.view.getBoundingClientRect();
    const px = cx == null ? r.width / 2 : cx - r.left;
    const py = cy == null ? r.height / 2 : cy - r.top;
    const ix = (px - before.ox) / before.scale;
    const iy = (py - before.oy) / before.scale;

    this.zoom = Math.min(6, Math.max(0.5, this.zoom * factor));
    const after = this._layout();
    this.panX += px - (after.ox + ix * after.scale);
    this.panY += py - (after.oy + iy * after.scale);
    this._invalidate('view');
  }

  resetView(){
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this._invalidate('view');
  }

  _startPinch(){
    const pts = [...this._pointers.values()];
    this._pinch = {
      dist: Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY),
      cx: (pts[0].clientX + pts[1].clientX) / 2,
      cy: (pts[0].clientY + pts[1].clientY) / 2
    };
  }

  _movePinch(){
    const pts = [...this._pointers.values()];
    const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
    const cx = (pts[0].clientX + pts[1].clientX) / 2;
    const cy = (pts[0].clientY + pts[1].clientY) / 2;
    if(this._pinch.dist > 0){
      this.panX += cx - this._pinch.cx;
      this.panY += cy - this._pinch.cy;
      this.zoomBy(dist / this._pinch.dist, cx, cy);
    }
    this._pinch = { dist, cx, cy };
  }

  _invalidate(reason){
    if(reason === 'draw' || reason === 'layers' || reason === 'shape') this._compositeDirty = true;
    if(this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this.render();
    });
  }

  _changed(reason){ if(this.onChange) this.onChange(reason); }

  /** Alle Ebenen uebereinander, auf die Nagelform beschnitten. */
  compose(target){
    const c = target || this.composite;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, IMG_W, IMG_H);

    for(const l of this.layers){
      if(!l.visible || l.opacity <= 0) continue;
      ctx.globalAlpha = l.opacity;
      ctx.drawImage(l.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;

    if(this._drawing){
      ctx.save();
      ctx.globalAlpha = this.tool === 'eraser' ? 1 : this.opacity;
      if(this.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(this.stroke, 0, 0);
      ctx.restore();
    }

    ctx.globalCompositeOperation = 'destination-in';
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fill(shapePath(this.shape));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    return c;
  }

  render(){
    this._sizeView();
    const ctx = this.ctx;
    const dpr = this._dpr || 1;
    const { scale, ox, oy } = this._layout();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.view.width, this.view.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Nagelbett als Untergrund, damit man sieht, was man tut
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale * RES, scale * RES);
    const path = shapePath(this.shape);
    ctx.fillStyle = '#F0DCD5';
    ctx.fill(path);
    ctx.restore();

    if(this._compositeDirty || this._drawing){
      this.compose();
      this._compositeDirty = false;
    }
    ctx.drawImage(this.composite, ox, oy, IMG_W * scale, IMG_H * scale);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale * RES, scale * RES);
    if(this.showGloss){
      ctx.save();
      ctx.clip(path);
      const g = ctx.createLinearGradient(20, 10, 70, 130);
      g.addColorStop(0, 'rgba(255,255,255,0.34)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.06)');
      g.addColorStop(0.75, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.10)');
      ctx.fillStyle = g;
      ctx.fill(path);
      ctx.restore();
    }
    ctx.lineWidth = 0.7 / scale;
    ctx.strokeStyle = 'rgba(60,40,44,0.45)';
    ctx.stroke(path);
    ctx.restore();
  }

  /* ---------------- Ein- und Ausgabe ---------------- */

  /** Fertiges Design als transparentes Bild -- Grundlage fuer die Anprobe. */
  exportTexture(){
    const c = newCanvas();
    this.compose(c);
    return c;
  }

  thumbnail(w = 180){
    const h = Math.round(w * IMG_H / IMG_W);
    const c = newCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#F0DCD5';
    ctx.save();
    ctx.scale(w / IMG_W * RES, h / IMG_H * RES);
    ctx.fill(shapePath(this.shape));
    ctx.restore();
    ctx.drawImage(this.exportTexture(), 0, 0, w, h);
    return c;
  }

  /** Setzt den Editor auf einen geladenen Entwurf. Bilder sind <img>-Elemente. */
  loadDesign(design, images){
    this.shape = design.shape || 'mandel';
    this.layers = [];
    (design.layers || []).forEach((l, i) => {
      const canvas = newCanvas();
      const ctx = canvas.getContext('2d');
      const img = images && images[i];
      if(img) ctx.drawImage(img, 0, 0, IMG_W, IMG_H);
      this.layers.push({
        id: l.id || layerId(),
        name: l.name || 'Ebene ' + (i + 1),
        visible: l.visible !== false,
        opacity: Number.isFinite(l.opacity) ? l.opacity : 1,
        canvas, ctx
      });
    });
    if(!this.layers.length) this.addLayer('Grundfarbe');
    this.activeLayerId = this.layers[this.layers.length - 1].id;
    this.resetHistory();
    this.resetView();
    this._invalidate('layers');
  }

  /** Ebenen-Metadaten plus Canvas-Referenzen zum Speichern. */
  layerData(){
    return this.layers.map(l => ({
      id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, canvas: l.canvas
    }));
  }

  isEmpty(){
    for(const l of this.layers){
      const d = l.ctx.getImageData(0, 0, IMG_W, IMG_H).data;
      for(let i = 3; i < d.length; i += 4){ if(d[i] !== 0) return false; }
    }
    return true;
  }

  destroy(){
    if(this._ro) this._ro.disconnect();
    if(this._frame) cancelAnimationFrame(this._frame);
  }
}
