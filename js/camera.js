/**
 * Live-Kamera mit Haltungspruefung -- nach dem Vorbild von naild.
 *
 * Statt ein schlechtes Foto hinterher zu korrigieren, sorgt die Kamera
 * dafuer, dass es gar nicht erst entsteht: Sie wertet jedes Bild aus,
 * zeichnet das Handskelett ein, sagt, was zu tun ist, und loest selbst aus,
 * sobald die Haltung einen Moment lang stimmt.
 */

import { startLive, erkenneLive, bewerteHand, HAND_VERBINDUNGEN, FINGERSPITZEN } from './handdetect.js';

const HALTEZEIT = 1500;      // so lange muss "Perfekt" stehen -- sichtbar als 3-2-1
const BILDABSTAND = 60;      // hoechstens gut 15 Auswertungen pro Sekunde
const RUHIG = 0.010;         // mittlere Bewegung je Bild (Anteil der Bildgroesse)

export class LiveKamera {
  constructor({ video, overlay, onStatus, onAufnahme }){
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.onStatus = onStatus || (() => {});
    this.onAufnahme = onAufnahme || (() => {});
    this.facing = 'environment';
    this.auto = true;
    this.stream = null;
    this.laeuft = false;
    this._frame = null;
    this._zuletzt = 0;
    this._letzteZeit = -1;
    this._vorher = null;
    this._unruhe = 1;
    this._okSeit = null;
    this._ausgeloest = false;
  }

  /** Kamera oeffnen und die Erkennung starten. Wirft, wenn es keine Kamera gibt. */
  async start(facing){
    this.stop();
    if(facing) this.facing = facing;
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      throw new Error('Dieser Browser gibt keinen Kamerazugriff.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: this.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    this.video.srcObject = this.stream;
    this.video.closest('.cam-stage')?.classList.toggle('cam-user', this.facing === 'user');
    this.video.muted = true;
    this.video.setAttribute('playsinline', '');
    await this.video.play().catch(() => {});

    await startLive((info) => this.onStatus({ laden: info }));

    this.laeuft = true;
    this._ausgeloest = false;
    this._okSeit = null;
    this._vorher = null;
    this._unruhe = 1;
    this._schleife();
  }

  stop(){
    this.laeuft = false;
    if(this._frame) cancelAnimationFrame(this._frame);
    this._frame = null;
    if(this.stream){ this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    this.video.srcObject = null;
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  get gespiegelt(){ return this.facing === 'user'; }

  _schleife(){
    if(!this.laeuft) return;
    this._frame = requestAnimationFrame(() => this._schleife());

    const v = this.video;
    if(v.readyState < 2 || !v.videoWidth) return;
    const jetzt = performance.now();
    if(jetzt - this._zuletzt < BILDABSTAND || v.currentTime === this._letzteZeit) return;
    this._zuletzt = jetzt;
    this._letzteZeit = v.currentTime;

    let res = null;
    try{ res = erkenneLive(v, jetzt); }catch(e){ return; }
    const lm = res && res.landmarks && res.landmarks[0];
    let bewertung = bewerteHand(lm, v.videoWidth, v.videoHeight);

    // Ruhe: gleitender Mittelwert der Bewegung von Bild zu Bild
    if(lm && this._vorher){
      let summe = 0;
      for(let i = 0; i < lm.length; i++) summe += Math.hypot(lm[i].x - this._vorher[i].x, lm[i].y - this._vorher[i].y);
      this._unruhe = this._unruhe * 0.6 + (summe / lm.length) * 0.4;
    }else{
      this._unruhe = 1;
    }
    this._vorher = lm ? lm.map(p => ({ x: p.x, y: p.y })) : null;
    if(bewertung.ok && this._unruhe > RUHIG){
      bewertung = { ok:false, code:'unruhig', hinweis:'Ruhig halten …', fastOk:true };
    }

    // Wie lange schon "Perfekt"?
    if(bewertung.ok){ if(this._okSeit === null) this._okSeit = jetzt; }
    else this._okSeit = null;
    const fortschritt = this._okSeit === null ? 0 : Math.min(1, (jetzt - this._okSeit) / HALTEZEIT);

    this._zeichne(lm, bewertung);
    this.onStatus({ bewertung, fortschritt });

    if(this.auto && fortschritt >= 1 && !this._ausgeloest) this.ausloesen();
  }

  /** Lage des Videos im Sucher: es fuellt ihn wie object-fit: cover. */
  _abbildung(){
    const r = this.overlay.getBoundingClientRect();
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const s = Math.max(r.width / vw, r.height / vh);
    return { s, dx: (r.width - vw * s) / 2, dy: (r.height - vh * s) / 2, w: r.width, h: r.height, vw, vh };
  }

  _zeichne(lm, bewertung){
    const c = this.overlay, ctx = this.ctx;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if(c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)){
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if(!lm) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const a = this._abbildung();
    const pt = (p) => {
      const x = a.dx + p.x * a.vw * a.s;
      return { x: this.gespiegelt ? a.w - x : x, y: a.dy + p.y * a.vh * a.s };
    };
    const P = lm.map(pt);

    const farbe = bewertung.ok ? 'rgba(47,190,120,0.95)'
                : bewertung.fastOk ? 'rgba(255,214,120,0.95)'
                : 'rgba(255,255,255,0.85)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = farbe;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    for(const [i, j] of HAND_VERBINDUNGEN){
      ctx.moveTo(P[i].x, P[i].y);
      ctx.lineTo(P[j].x, P[j].y);
    }
    ctx.stroke();

    ctx.fillStyle = farbe;
    for(const p of P){
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2); ctx.fill();
    }
    // Naegel markieren: Ring an jeder Fingerspitze
    ctx.lineWidth = 2.5;
    for(const i of FINGERSPITZEN){
      const q = { x: (P[i].x * 2 + P[i - 1].x) / 3, y: (P[i].y * 2 + P[i - 1].y) / 3 };
      ctx.beginPath(); ctx.arc(q.x, q.y, 11, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  /** Das aktuelle Kamerabild festhalten -- in voller Aufloesung. */
  ausloesen(){
    const v = this.video;
    if(!v.videoWidth) return null;
    this._ausgeloest = true;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    if(this.gespiegelt){ ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0);
    this.onAufnahme(c);
    return c;
  }
}
