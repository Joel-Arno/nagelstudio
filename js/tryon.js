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
import { designTexture, nagelMasse } from './compose.js';
import { shapeBounds, SHAPE_W, SHAPE_H, KUPPE } from './shapes.js';
import { refineNail } from './nailfit.js';
import { PLATE_W, RASTER_RATIO } from './shapes.js';

const HANDLE_R = 11;      // Radius der Griffe in Bildschirmpixeln
const HANDLE_OFF = 17;    // Abstand der Griffe vom Nagelrand

// Nach der Erkennung sitzt der Nagel sonst zu weit Richtung Nagelhaut.
// Das Foto kennt keine Millimeter; ein Nagel ist im Schnitt ~11 mm breit,
// daher wird die Verschiebung ueber die gemessene Nagelbreite geschaetzt.
const VERSATZ_MM = 3;
const NAGELBREITE_MM = 11;

// Antippen: der Punkt, den man auf dem echten Nagel trifft, ist die Mitte
// der Nagelplatte -- im Raster liegt sie zwischen Nagelhaut (140) und
// Fingerkuppe (70), etwas zur Nagelhaut hin.
const PLATTE_MITTE = 102;
const LANG_DRUECKEN = 450;     // ms

// Daumen von der Seite: von vorne ist der Daumen rund 1,2-mal so breit wie
// der Zeigefinger, von der Seite sieht man nur seine Dicke -- dann ist er
// kaum breiter oder sogar schmaler. Aus diesem Verhaeltnis wird geschaetzt,
// wie weit der Nagel zur Seite gedreht ist. Die Breitenmessung schwankt
// um gut 10 %, deshalb greift das erst, wenn der Daumen hoechstens so breit
// wie der Zeigefinger wirkt -- gerade gesehene Daumen bleiben unberuehrt.
const DAUMEN_VORNE = 1.04;
const DAUMEN_SEITE = 0.88;
const DAUMEN_MAX_DREHUNG = 65 * Math.PI / 180;
const TIPP_WEG = 8;            // px, mehr ist Ziehen

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
    // Vorher/Nachher: Position des Trennstrichs (0..1) oder null = aus
    this.vergleich = null;
    // Form und Laenge fuer alle Naegel abweichend vom Entwurf, oder null
    this.vorgabe = null;
    // Auswahlrahmen und Griffe nur beim Nachjustieren
    this.griffe = true;
    this.schatten = true;

    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;

    this.onChange = null;
    this._drag = null;
    this._pointers = new Map();
    this._pinch = null;
    this._viewDrag = null;
    this._draft = false;
    this._frame = null;
    this._textures = new Map();

    this._bind();
    window.addEventListener('resize', () => this._invalidate());
  }

  /* ---------------- Foto ---------------- */

  /**
   * Das Foto wird zuerst in ein Canvas gezeichnet und von dort verwendet.
   * Handyfotos tragen ihre Drehung als EXIF-Angabe; Anzeige und Erkennung
   * koennen das unterschiedlich auslegen, dann sitzen die Naegel daneben.
   * Nach dem Umkopieren sind die Bilddaten aufrecht, und beide sehen
   * garantiert dasselbe Bild. Sehr grosse Fotos werden dabei verkleinert --
   * die Erkennung braucht keine zwoelf Megapixel.
   */
  async setPhoto(img){
    const MAX = 2000;
    const srcW = img.naturalWidth || img.width, srcH = img.naturalHeight || img.height;
    const k = Math.min(1, MAX / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * k)), h = Math.max(1, Math.round(srcH * k));

    const flat = document.createElement('canvas');
    flat.width = w; flat.height = h;
    const fctx = flat.getContext('2d');
    fctx.drawImage(img, 0, 0, w, h);
    // wie ein <img> ansprechbar halten
    flat.naturalWidth = w;
    flat.naturalHeight = h;

    this.photo = flat;
    this.nails = [];
    this.selected = null;
    this.zoom = 1; this.panX = 0; this.panY = 0;
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

    if(onStatus) onStatus('Nägel werden vermessen …');

    const nails = [];
    hands.forEach((hand, hi) => {
      const handName = hands.length < 2 ? '' : (hi === 0 ? 'links im Bild' : 'rechts im Bild');
      const breiten = {};
      const start = nails.length;
      hand.nails.forEach(n => {
        // Schaetzung aus den Gelenken, danach im Bild nachgemessen
        const grob = boxFromQuad(n.quad);
        const fein = refineNail(this.photo, grob);
        if(fein.fingerBreite) breiten[n.finger] = fein.fingerBreite;
        const versatz = fein.w * VERSATZ_MM / NAGELBREITE_MM;
        fein.cx += Math.cos(fein.angle) * versatz;
        fein.cy += Math.sin(fein.angle) * versatz;
        nails.push(Object.assign(
          { id: 'n' + hi + '-' + n.finger, hand: hi, handName, name: n.name,
            finger: n.finger, visible: true, designId: null, roll: 0, aussen: n.aussen || 0,
            confidence: fein.confidence, source: fein.source },
          plateToRaster(fein)
        ));
      });
      const daumen = nails.slice(start).find(n => n.finger === 'daumen');
      if(daumen) daumen.roll = daumenDrehung(breiten, daumen.aussen);
    });
    this.nails = nails;
    this.selected = nails.length ? nails[0].id : null;
    this._invalidate();
    return {
      hands: hands.length,
      nails: nails.length,
      gemessen: nails.filter(n => n.source === 'nagelrand').length
    };
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
        hand: 0, handName: 'von Hand',
        name: FINGERS[i % FINGERS.length].name,
        finger: FINGERS[i % FINGERS.length].key,
        cx: count === 1 ? W * 0.5 : W * (0.28 + i * 0.11),
        cy: count === 1 ? H * 0.5 : H * 0.45,
        angle: -Math.PI / 2,
        w: base * (i === 0 ? 1.1 : 1 - i * 0.07) / PLATE_W,
        h: base * (i === 0 ? 1.1 : 1 - i * 0.07) / PLATE_W * RASTER_RATIO,
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
    await this._ensureTexture(designId, nail.finger);
    this._invalidate();
  }

  /** Ganzen Satz auflegen: jeder Finger bekommt seinen eigenen Nagel. */
  async assignAll(designId){
    for(const n of this.nails){
      n.designId = designId;
      n.visible = true;
      await this._ensureTexture(designId, n.finger);
    }
    this._invalidate();
  }

  _texKey(designId, finger){
    const v = this.vorgabe;
    return designId + ':' + (finger || 'zeigefinger') + (v ? ':' + (v.shape || '') + ':' + (v.length == null ? '' : v.length.toFixed(2)) : '');
  }

  async _ensureTexture(designId, finger){
    const key = this._texKey(designId, finger);
    if(!designId || this._textures.has(key)) return;
    const design = this.designs.get(designId);
    if(!design) return;
    this._textures.set(key, await designTexture(design, finger, this.vorgabe));
  }

  /**
   * Form und Laenge fuer alle Naegel vorgeben -- "Laenge & Form anpassen"
   * direkt auf der Hand. null nimmt wieder, was im Entwurf steht.
   */
  async setVorgabe(vorgabe){
    this.vorgabe = vorgabe && (vorgabe.shape || vorgabe.length != null) ? { ...vorgabe } : null;
    for(const n of this.nails) await this._ensureTexture(n.designId, n.finger);
    this._invalidate();
  }

  /** Vorher/Nachher-Vergleich ein- oder ausschalten. */
  setVergleich(an){
    this.vergleich = an ? (this.vergleich == null ? 0.5 : this.vergleich) : null;
    this._invalidate();
  }

  async refreshTextures(){
    this._textures.clear();
    for(const n of this.nails) await this._ensureTexture(n.designId, n.finger);
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

  /**
   * Naegel schrittweise verstellen (Knoepfe statt Griffe).
   * Mit alle = true gilt der Schritt fuer jeden Nagel -- sitzt die Erkennung
   * durchgehend zu klein oder zu tief, ist das in ein paar Tipps erledigt.
   */
  nudge(what, amount, alle = false){
    const liste = alle ? this.nails.filter(n => n.visible)
                       : (this.selectedNail ? [this.selectedNail] : []);
    if(!liste.length) return;

    for(const n of liste){
      const step = Math.max(1, n.h * 0.04);
      if(what === 'left')   n.cx -= step;
      if(what === 'right')  n.cx += step;
      if(what === 'up')     n.cy -= step;
      if(what === 'down')   n.cy += step;
      if(what === 'grow'){  n.w *= (1 + amount); n.h *= (1 + amount); }
      if(what === 'wider')  n.w *= (1 + amount);
      if(what === 'turn')   n.angle += amount;
      if(what === 'roll')   n.roll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, (n.roll || 0) + amount));
      n.w = Math.max(5, n.w);
      n.h = Math.max(6, n.h);
    }
    this._invalidate();
    if(this.onChange) this.onChange('adjust');
  }

  /**
   * Naegel entlang ihrer eigenen Achse verschieben -- "weiter zur
   * Fingerspitze" statt "nach rechts". Bei gespreizten Fingern zeigt jeder
   * in eine andere Richtung, deshalb rechnet das pro Nagel.
   */
  slide(amount, alle = false){
    const liste = alle ? this.nails.filter(n => n.visible)
                       : (this.selectedNail ? [this.selectedNail] : []);
    for(const n of liste){
      n.cx += Math.cos(n.angle) * n.h * amount;
      n.cy += Math.sin(n.angle) * n.h * amount;
    }
    this._invalidate();
    if(this.onChange) this.onChange('adjust');
  }

  /**
   * Auf einen echten Nagel tippen: der Nagel dieses Fingers springt dorthin.
   * Welcher Finger gemeint ist, entscheidet der Abstand zur Fingerachse --
   * die Erkennung liegt eher entlang des Fingers daneben als quer dazu.
   */
  setzeAuf(p){
    const kandidaten = this.nails.filter(n => n.visible);
    if(!kandidaten.length) return null;
    let bester = null, abstand = Infinity;
    for(const n of kandidaten){
      const m = mitteVon(n);
      const ux = Math.cos(n.angle), uy = Math.sin(n.angle);
      const dx = p.x - m.x, dy = p.y - m.y;
      const entlang = dx * ux + dy * uy;
      const quer = -dx * uy + dy * ux;
      const d = Math.abs(quer) + Math.abs(entlang) * 0.35;
      if(d < abstand){ abstand = d; bester = n; }
    }
    const n = bester;

    // Breite an der neuen Stelle nachmessen
    const fein = refineNail(this.photo, {
      cx: p.x, cy: p.y, angle: n.angle,
      w: n.w * PLATE_W, h: n.h * (SHAPE_H - KUPPE) / SHAPE_H
    });
    if(fein.source !== 'schaetzung'){
      n.w = fein.w / PLATE_W;
      n.h = n.w * RASTER_RATIO;
    }

    // Rastermitte so legen, dass die Plattenmitte auf dem Tipp liegt
    const ux = Math.cos(n.angle), uy = Math.sin(n.angle);
    const zurueck = n.h * (PLATTE_MITTE - SHAPE_H / 2) / SHAPE_H;
    const v = rollVersatz(n);
    n.cx = p.x + ux * zurueck - v.x;
    n.cy = p.y + uy * zurueck - v.y;
    n.visible = true;

    this.selected = n.id;
    this._puls = { x: p.x, y: p.y, t: performance.now() };
    this._invalidate();
    if(this.onChange) this.onChange('setzen');
    return n;
  }

  setOpacity(v){ this.opacity = v; this._invalidate(); }
  setGloss(on){ this.gloss = !!on; this._invalidate(); }
  setSchatten(on){ this.schatten = !!on; this._invalidate(); }

  /* ---------------- Ansicht und Koordinaten ---------------- */

  _layout(){
    const r = this.canvas.getBoundingClientRect();
    if(!this.photo) return { scale:1, ox:0, oy:0, rect:r };
    const W = this.photo.naturalWidth, H = this.photo.naturalHeight;
    const fit = Math.min(r.width / W, r.height / H);
    const scale = fit * this.zoom;
    return {
      scale,
      ox: (r.width - W * scale) / 2 + this.panX,
      oy: (r.height - H * scale) / 2 + this.panY,
      rect: r
    };
  }

  zoomBy(factor, cx, cy){
    const before = this._layout();
    const r = before.rect;
    const px = cx == null ? r.width / 2 : cx - r.left;
    const py = cy == null ? r.height / 2 : cy - r.top;
    const ix = (px - before.ox) / before.scale;
    const iy = (py - before.oy) / before.scale;

    this.zoom = Math.min(8, Math.max(1, this.zoom * factor));
    const after = this._layout();
    this.panX += px - (after.ox + ix * after.scale);
    this.panY += py - (after.oy + iy * after.scale);
    this._clampPan();
    this._invalidate();
  }

  resetView(){
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this._invalidate();
  }

  _setzeTrenner(clientX){
    const r = this.canvas.getBoundingClientRect();
    this.vergleich = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    this._invalidate();
  }

  /** Das Foto soll nicht aus dem Bild geschoben werden koennen. */
  _clampPan(){
    const r = this.canvas.getBoundingClientRect();
    if(!this.photo) return;
    const W = this.photo.naturalWidth, H = this.photo.naturalHeight;
    const fit = Math.min(r.width / W, r.height / H);
    const scale = fit * this.zoom;
    const overX = Math.max(0, (W * scale - r.width) / 2);
    const overY = Math.max(0, (H * scale - r.height) / 2);
    this.panX = Math.max(-overX, Math.min(overX, this.panX));
    this.panY = Math.max(-overY, Math.min(overY, this.panY));
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
      this._pointers.set(e.pointerId, e);

      // Tippen und lange Druecken erkennen
      clearTimeout(this._langTimer);
      this._tipp = this._pointers.size === 1
        ? { x: e.clientX, y: e.clientY, t: performance.now(), vergleich: this.vergleich, bewegt: false }
        : null;
      if(this._tipp){
        this._langTimer = setTimeout(() => this._langGedrueckt(), LANG_DRUECKEN);
      }

      if(this._pointers.size === 2){
        this._drag = null;
        this._viewDrag = null;
        const pts = [...this._pointers.values()];
        this._pinch = {
          dist: Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY),
          cx: (pts[0].clientX + pts[1].clientX) / 2,
          cy: (pts[0].clientY + pts[1].clientY) / 2
        };
        return;
      }
      if(this._pointers.size > 2) return;

      if(this.vergleich != null){
        this._vergleichZiehen = true;
        this._setzeTrenner(e.clientX);
        return;
      }

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
      const hit = [...this.nails].reverse().find(n => n.visible && quadContains(this._frameQuad(n), p.x, p.y));
      if(hit){
        this.selected = hit.id;
        this._drag = { mode:'move', nail: hit, start: p, cx0: hit.cx, cy0: hit.cy };
        this._draft = true;
        this._invalidate();
        if(this.onChange) this.onChange('select');
      }else{
        // neben den Naegeln: das Foto verschieben
        this._viewDrag = { x: e.clientX, y: e.clientY };
      }
    });

    c.addEventListener('pointermove', (e) => {
      if(this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, e);
      if(this._tipp && !this._tipp.bewegt
         && Math.hypot(e.clientX - this._tipp.x, e.clientY - this._tipp.y) > TIPP_WEG){
        this._tipp.bewegt = true;
        clearTimeout(this._langTimer);
      }
      if(this._vergleichZiehen && this._pointers.size < 2){ this._setzeTrenner(e.clientX); return; }

      if(this._pinch && this._pointers.size >= 2){
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
        return;
      }

      if(this._viewDrag){
        this.panX += e.clientX - this._viewDrag.x;
        this.panY += e.clientY - this._viewDrag.y;
        this._viewDrag = { x: e.clientX, y: e.clientY };
        this._clampPan();
        this._invalidate();
        return;
      }

      if(!this._drag) return;
      const p = this._toPhoto(e.clientX, e.clientY);
      const d = this._drag;
      const n = d.nail;

      if(d.mode === 'move'){
        n.cx = d.cx0 + (p.x - d.start.x);
        n.cy = d.cy0 + (p.y - d.start.y);
      }else if(d.mode === 'tip'){
        // Drehen und Laenge zugleich: der Griff sitzt vor der Nagelspitze
        const m = mitteVon(n);
        const dx = p.x - m.x, dy = p.y - m.y;
        n.angle = Math.atan2(dy, dx);
        n.h = Math.max(6, (Math.hypot(dx, dy) - this._offsetInPhoto()) / this._rahmenAnteil(n).spitze);
      }else if(d.mode === 'side'){
        const m = mitteVon(n);
        const dx = p.x - m.x, dy = p.y - m.y;
        const across = Math.abs(dx * Math.cos(n.angle + Math.PI / 2) + dy * Math.sin(n.angle + Math.PI / 2));
        n.w = Math.max(5, (across - this._offsetInPhoto()) / this._rahmenAnteil(n).seite / Math.cos(n.roll || 0));
      }
      this._invalidate();
    });

    const end = (e) => {
      clearTimeout(this._langTimer);
      const tipp = this._tipp;
      this._tipp = null;
      // Kurzer Tipp neben die Naegel beim Justieren: dorthin setzen
      if(tipp && !tipp.bewegt && !tipp.erledigt && this._viewDrag && this.griffe && e.type === 'pointerup'
         && performance.now() - tipp.t < LANG_DRUECKEN){
        this._pointers.delete(e.pointerId);
        this._viewDrag = null;
        this.setzeAuf(this._toPhoto(tipp.x, tipp.y));
        return;
      }
      if(tipp && tipp.erledigt){
        this._pointers.delete(e.pointerId);
        this._viewDrag = null;
        this._drag = null;
        this._draft = false;
        this._vergleichZiehen = false;
        this._invalidate();
        return;
      }
      this._pointers.delete(e.pointerId);
      this._vergleichZiehen = false;
      if(this._pointers.size < 2) this._pinch = null;
      this._viewDrag = null;
      if(!this._drag) return;
      this._drag = null;
      this._draft = false;
      this._invalidate();
      if(this.onChange) this.onChange('adjust');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('wheel', (e) => {
      if(!this.photo) return;
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY);
    }, { passive:false });
  }

  /** Lange auf das Foto gedrueckt: den passenden Nagel dorthin setzen. */
  _langGedrueckt(){
    const tipp = this._tipp;
    if(!tipp || tipp.bewegt || this._pointers.size !== 1) return;
    tipp.erledigt = true;
    // was der Druck bis hierhin ausgeloest hat, zuruecknehmen
    if(this._drag && this._drag.mode === 'move'){
      this._drag.nail.cx = this._drag.cx0;
      this._drag.nail.cy = this._drag.cy0;
    }
    this._drag = null;
    this._viewDrag = null;
    this._vergleichZiehen = false;
    this.vergleich = tipp.vergleich;
    if(navigator.vibrate) navigator.vibrate(12);
    this.setzeAuf(this._toPhoto(tipp.x, tipp.y));
  }

  _handlePoints(nail){
    const q = this._frameQuad(nail);
    const tip = this._toScreen({ x:(q[0].x + q[1].x) / 2, y:(q[0].y + q[1].y) / 2 });
    const side = this._toScreen({ x:(q[1].x + q[2].x) / 2, y:(q[1].y + q[2].y) / 2 });
    const c = this._toScreen(mitteVon(nail));
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
    if(this.vergleich != null){
      ctx.beginPath();
      ctx.rect(this.vergleich * r.width, 0, r.width, r.height);
      ctx.clip();
    }
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    for(const nail of this.nails){
      if(!nail.visible || !nail.designId) continue;
      const tex = this._textures.get(this._texKey(nail.designId, nail.finger));
      if(tex) this._paintNail(ctx, nail, tex);
    }
    ctx.restore();

    if(this.vergleich != null) this._paintVergleich(ctx, r);
    else if(this.griffe) this._paintHandles(ctx);
    this._paintPuls(ctx);
  }

  /** Kurzer Ring an der Stelle, auf die ein Nagel gesetzt wurde. */
  _paintPuls(ctx){
    if(!this._puls) return;
    const alter = (performance.now() - this._puls.t) / 650;
    if(alter >= 1){ this._puls = null; return; }
    const p = this._toScreen(this._puls);
    ctx.save();
    ctx.globalAlpha = 1 - alter;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#E0567C';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10 + alter * 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    this._invalidate();
  }

  _paintVergleich(ctx, r){
    const x = this.vergleich * r.width;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(x - 1.25, 0, 2.5, r.height);
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(x, r.height / 2, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#BE326A';
    ctx.beginPath();                               // zwei kleine Pfeile
    ctx.moveTo(x - 5, r.height / 2 - 6); ctx.lineTo(x - 11, r.height / 2); ctx.lineTo(x - 5, r.height / 2 + 6);
    ctx.moveTo(x + 5, r.height / 2 - 6); ctx.lineTo(x + 11, r.height / 2); ctx.lineTo(x + 5, r.height / 2 + 6);
    ctx.fill();

    const schild = (text, links) => {
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      const w = ctx.measureText(text).width + 18;
      const bx = links ? 12 : r.width - 12 - w;
      ctx.fillStyle = 'rgba(30,20,25,0.55)';
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(bx, 12, w, 24, 12); else ctx.rect(bx, 12, w, 24);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(text, bx + 9, 28);
    };
    schild('VORHER', true);
    schild('NACHHER', false);
    ctx.restore();
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
      // Laengsglanz entlang der Nagelwoelbung plus ein Lichtpunkt -- ein
      // rein linearer Verlauf sieht flach aus, echte Naegel sind gewoelbt.
      lc.globalCompositeOperation = 'screen';
      const quer = lc.createLinearGradient(0, 0, layer.width, 0);
      quer.addColorStop(0, 'rgba(255,255,255,0.03)');
      quer.addColorStop(0.28, 'rgba(255,255,255,0.26)');
      quer.addColorStop(0.46, 'rgba(255,255,255,0.05)');
      quer.addColorStop(1, 'rgba(255,255,255,0.10)');
      lc.fillStyle = quer;
      lc.fillRect(0, 0, layer.width, layer.height);

      const punkt = lc.createRadialGradient(
        layer.width * 0.33, layer.height * 0.26, 0,
        layer.width * 0.33, layer.height * 0.26, Math.max(layer.width, layer.height) * 0.42
      );
      punkt.addColorStop(0, 'rgba(255,255,255,0.40)');
      punkt.addColorStop(0.45, 'rgba(255,255,255,0.10)');
      punkt.addColorStop(1, 'rgba(255,255,255,0)');
      lc.fillStyle = punkt;
      lc.fillRect(0, 0, layer.width, layer.height);
    }

    // Alles wieder auf die Nagelflaeche beschneiden
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(mask, 0, 0);
    lc.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.globalAlpha = this.opacity;
    // Ein Nagel liegt auf dem Finger auf und wirft einen Schatten; ohne den
    // wirkt er wie aufgeklebt. Verlaengerte Formen brauchen ihn am meisten.
    if(this.schatten){
      ctx.shadowColor = 'rgba(28,12,18,0.45)';
      ctx.shadowBlur = Math.max(1.5, nail.w * 0.10);
      ctx.shadowOffsetX = Math.cos(nail.angle) * nail.h * 0.035;
      ctx.shadowOffsetY = Math.sin(nail.angle) * nail.h * 0.035 + nail.w * 0.02;
    }
    ctx.drawImage(layer, b.x, b.y, b.w, b.h);
    ctx.restore();
  }

  /** Welche Form liegt gerade auf diesem Nagel? */
  _shapeOf(nail){
    const design = nail.designId ? this.designs.get(nail.designId) : null;
    const n = design && design.nails && design.nails[nail.finger];
    if(!n) return null;
    return nagelMasse(n, this.vorgabe);
  }

  /**
   * Der Auswahlrahmen folgt der Nagelform, nicht dem Raster -- sonst zieht
   * man an einem Rahmen, der deutlich groesser ist als der sichtbare Nagel.
   */
  _frameQuad(nail){
    const masse = this._shapeOf(nail);
    const q = quadOf(nail);
    if(!masse) return q;
    const b = shapeBounds(masse.shape, masse.length);
    const u = (x) => x / SHAPE_W, v = (y) => y / SHAPE_H;
    const at = (x, y) => {
      const top = { x: q[0].x + (q[1].x - q[0].x) * u(x), y: q[0].y + (q[1].y - q[0].y) * u(x) };
      const bot = { x: q[3].x + (q[2].x - q[3].x) * u(x), y: q[3].y + (q[2].y - q[3].y) * u(x) };
      return { x: top.x + (bot.x - top.x) * v(y), y: top.y + (bot.y - top.y) * v(y) };
    };
    return [at(b.x, b.y), at(b.x + b.w, b.y), at(b.x + b.w, b.y + b.h), at(b.x, b.y + b.h)];
  }

  /**
   * Wie weit Spitze und Seite des Rahmens vom Mittelpunkt entfernt sind,
   * als Anteil von Rasterhoehe und -breite. Die Griffe sitzen am Rahmen der
   * Form, nicht am Raster -- ohne diese Umrechnung springt der Nagel beim
   * ersten Ziehen auf einen Bruchteil seiner Groesse.
   */
  _rahmenAnteil(nail){
    const masse = this._shapeOf(nail);
    if(!masse) return { spitze: 0.5, seite: 0.5 };
    const b = shapeBounds(masse.shape, masse.length);
    return {
      spitze: Math.max(0.05, (SHAPE_H / 2 - b.y) / SHAPE_H),
      seite: Math.max(0.05, (b.x + b.w - SHAPE_W / 2) / SHAPE_W)
    };
  }

  _paintHandles(ctx){
    const nail = this.selectedNail;
    if(!nail || !nail.visible) return;
    const q = this._frameQuad(nail).map(p => this._toScreen(p));

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
      const tex = this._textures.get(this._texKey(nail.designId, nail.finger));
      if(tex) this._paintNail(ctx, nail, tex);
    }
    this._draft = wasDraft;
    return out;
  }
}

/* ---------------- Geometrie ---------------- */

/** Drehung des Daumennagels aus dem Breitenverhaeltnis Daumen/Zeigefinger. */
export function daumenDrehung(breiten, seite){
  const vergleich = breiten.zeigefinger || breiten.mittelfinger;
  if(!seite || !breiten.daumen || !vergleich) return 0;
  const verhaeltnis = breiten.daumen / vergleich;
  const t = Math.max(0, Math.min(1, (DAUMEN_VORNE - verhaeltnis) / (DAUMEN_VORNE - DAUMEN_SEITE)));
  return seite * t * DAUMEN_MAX_DREHUNG;
}

/**
 * Aus der gemessenen Nagelplatte das Raster machen, auf das ein Design
 * gelegt wird.
 *
 * Im Raster nimmt die Nagelplatte nur einen Teil der Breite ein, und nach
 * oben steht Platz fuer verlaengerte Formen. Das Raster wird deshalb
 * groesser als der gemessene Nagel -- an der Nagelhaut verankert, damit
 * eine kurze Form auf dem Nagelbett endet und eine lange darueber
 * hinausragt, so wie eine echte Verlaengerung.
 */
export function plateToRaster(plate){
  const w = plate.w / PLATE_W;
  const h = w * RASTER_RATIO;
  const ux = Math.cos(plate.angle), uy = Math.sin(plate.angle);
  // Verankert wird an der Nagelhaut, aber nicht ganz am unteren Rand der
  // Schaetzung: die faellt eher zu lang aus, und ein Fehler dort wuerde den
  // ganzen Nagel Richtung Gelenk ziehen.
  const baseX = plate.cx - ux * plate.h * 0.38;
  const baseY = plate.cy - uy * plate.h * 0.38;
  return {
    cx: baseX + ux * h / 2,
    cy: baseY + uy * h / 2,
    angle: plate.angle,
    w, h
  };
}

/**
 * Ist ein Nagel um die Fingerachse gedreht (roll, etwa der Daumen von der
 * Seite), sieht man ihn schmaler und zur gedrehten Seite hin versetzt --
 * er liegt ja auf der Rundung des Fingers.
 */
export const MAX_ROLL = 1.2;
const FINGER_RADIUS = 0.62;     // Fingerradius im Verhaeltnis zur Nagelbreite

export function rollVersatz(n){
  const roll = n.roll || 0;
  if(!roll) return { x: 0, y: 0 };
  const s = Math.sin(roll) * n.w * PLATE_W * FINGER_RADIUS;
  return { x: -Math.sin(n.angle) * s, y: Math.cos(n.angle) * s };
}

/** Sichtbare Mitte des Rasters. */
export function mitteVon(n){
  const v = rollVersatz(n);
  return { x: n.cx + v.x, y: n.cy + v.y };
}

/** Viereck [Spitze-links, Spitze-rechts, Basis-rechts, Basis-links]. */
export function quadOf(n){
  const ux = Math.cos(n.angle), uy = Math.sin(n.angle);       // Richtung zur Spitze
  const nx = -uy, ny = ux;                                    // quer dazu
  const breite = n.w * Math.cos(n.roll || 0);
  const m = mitteVon(n);
  const hx = ux * n.h / 2, hy = uy * n.h / 2;
  const wx = nx * breite / 2, wy = ny * breite / 2;
  return [
    { x: m.x + hx - wx, y: m.y + hy - wy },
    { x: m.x + hx + wx, y: m.y + hy + wy },
    { x: m.x - hx + wx, y: m.y - hy + wy },
    { x: m.x - hx - wx, y: m.y - hy - wy }
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
