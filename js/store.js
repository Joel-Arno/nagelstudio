/**
 * Datenhaltung: IndexedDB, lokal auf dem Geraet.
 *
 * Jeder Entwurf traegt eine eindeutige ID und einen Aenderungszeitstempel.
 * Geloeschte Entwuerfe bleiben als Grabstein (deletedAt) liegen, damit ein
 * Abgleich eine Loeschung von "kennt den Entwurf noch nicht" unterscheiden
 * kann. Genau darauf setzt spaeter ein Cloud-Abgleich auf -- mergeDesigns()
 * ist bereits die vollstaendige Zusammenfuehr-Logik.
 */

const DB_NAME = 'nagelstudio';
const DB_VERSION = 1;
const STORE = 'designs';

let dbPromise = null;

function openDb(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)){
        const os = db.createObjectStore(STORE, { keyPath:'id' });
        os.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn){
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try{ result = fn(store); }catch(err){ reject(err); return; }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export function newId(){
  if(crypto.randomUUID) return crypto.randomUUID();
  return 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Die fuenf Naegel einer Hand, in der Reihenfolge der Uebersicht. */
export const FINGER_KEYS = ['daumen', 'zeigefinger', 'mittelfinger', 'ringfinger', 'kleiner'];
export const FINGER_NAMES = {
  daumen:'Daumen', zeigefinger:'Zeigefinger', mittelfinger:'Mittelfinger',
  ringfinger:'Ringfinger', kleiner:'Kleiner Finger'
};

/** Grundfarbe, die ein frischer Nagel hat -- ein heller Naturton. */
export const NATURAL = '#EFD9D2';

export function emptyNail(shape = 'mandel', length = 0.36){
  // layers: { id, name, visible, opacity, image, pattern? }
  return { shape, length, base: NATURAL, layers: [] };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Mustervorgabe einer Ebene pruefen -- sie kommt auch aus fremden Dateien. */
function sauberesMuster(m){
  if(!m || typeof m !== 'object' || typeof m.id !== 'string' || m.id.length > 24) return undefined;
  return {
    id: m.id,
    color: HEX.test(m.color) ? m.color : '#D8456B',
    color2: HEX.test(m.color2) ? m.color2 : '#FFFFFF',
    strength: Number.isFinite(m.strength) ? Math.max(0, Math.min(1, m.strength)) : 0.5,
    seed: Number.isInteger(m.seed) ? m.seed : 1
  };
}

function laenge(v){
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined;
}

/**
 * Ein Entwurf ist ein Satz aus fuenf Naegeln. Jeder Nagel hat eine
 * deckende Grundfarbe und darueber die gezeichneten Ebenen -- was man beim
 * Malen sieht, liegt spaeter genauso auf der Hand.
 */
export function emptyDesign(shape = 'mandel'){
  const now = Date.now();
  const nails = {};
  FINGER_KEYS.forEach(k => { nails[k] = emptyNail(shape, 0.36); });
  return {
    id: newId(),
    name: '',
    nails,
    notiz: '',          // freie Notiz: Kundin, Lacke, Anlass
    schlagworte: [],    // zum Wiederfinden
    favorit: false,
    thumb: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
}

/**
 * Entwuerfe aus der ersten Fassung bestanden aus einem einzigen Nagel.
 * Die werden beim Laden zu einem Satz aufgefaltet: dieselbe Zeichnung liegt
 * dann auf allen fuenf Naegeln und kann dort weiterbearbeitet werden.
 */
export function migrateDesign(d){
  if(!d || d.nails) return d;
  const nails = {};
  FINGER_KEYS.forEach(k => {
    nails[k] = {
      shape: d.shape || 'mandel',
      base: NATURAL,
      layers: (d.layers || []).map(l => ({ ...l }))
    };
  });
  d.nails = nails;
  if(typeof d.notiz !== 'string') d.notiz = '';
  if(!Array.isArray(d.schlagworte)) d.schlagworte = [];
  d.favorit = !!d.favorit;
  delete d.layers;
  delete d.shape;
  return d;
}

export async function putDesign(design){
  design.updatedAt = Date.now();
  await tx('readwrite', s => s.put(structuredCloneSafe(design)));
  return design;
}

export async function getDesign(id){
  const d = await tx('readonly', s => ({ __req: s.get(id) }));
  return d ? migrateDesign(d) : d;
}

/** Alle lebenden Entwuerfe, zuletzt geaendert zuerst. */
export async function listDesigns(){
  const all = await tx('readonly', s => ({ __req: s.getAll() }));
  return (all || [])
    .filter(d => !d.deletedAt)
    .map(migrateDesign)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Loeschen heisst: als geloescht markieren und Bilddaten freigeben. */
export async function deleteDesign(id){
  const d = await getDesign(id);
  if(!d) return;
  d.deletedAt = Date.now();
  d.nails = {};
  d.anproben = [];
  d.thumb = null;
  await putDesign(d);
}

export async function purgeDeleted(olderThanDays = 60){
  const cutoff = Date.now() - olderThanDays * 864e5;
  const all = await tx('readonly', s => ({ __req: s.getAll() }));
  const dead = (all || []).filter(d => d.deletedAt && d.deletedAt < cutoff);
  if(dead.length) await tx('readwrite', s => dead.forEach(d => s.delete(d.id)));
  return dead.length;
}

export async function storageEstimate(){
  if(!navigator.storage || !navigator.storage.estimate) return null;
  try{ return await navigator.storage.estimate(); }catch(e){ return null; }
}

/* ---------- Bilddaten: Blob bevorzugt, Text-URL als Rueckfallebene ---------- */

export function canvasToImage(canvas){
  return new Promise(resolve => {
    if(canvas.toBlob){
      canvas.toBlob(blob => resolve(blob || canvas.toDataURL('image/png')), 'image/png');
    }else{
      resolve(canvas.toDataURL('image/png'));
    }
  });
}

export function imageToUrl(image){
  if(!image) return null;
  return typeof image === 'string' ? image : URL.createObjectURL(image);
}

export function releaseUrl(url){
  if(url && url.startsWith('blob:')) URL.revokeObjectURL(url);
}

export function loadImage(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
    img.src = src;
  });
}

async function imageToDataUrl(image){
  if(!image) return null;
  if(typeof image === 'string') return image;
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(image);
  });
}

function dataUrlToBlob(url){
  if(typeof url !== 'string' || !url.startsWith('data:')) return url;
  const [head, body] = url.split(',');
  const mime = (head.match(/data:([^;]+)/) || [,'image/png'])[1];
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

/* Manche Safari-Versionen stolpern ueber verschachtelte Blobs im
   structured clone. Ein flacher Nachbau des Datensatzes geht sicher durch. */
function structuredCloneSafe(d){
  const nails = {};
  for(const [key, nail] of Object.entries(d.nails || {})){
    nails[key] = {
      shape: nail.shape,
      length: laenge(nail.length),
      base: nail.base,
      layers: (nail.layers || []).map(l => ({
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, image: l.image,
        pattern: sauberesMuster(l.pattern)
      }))
    };
  }
  return {
    id: d.id,
    name: d.name,
    nails,
    notiz: d.notiz || '',
    schlagworte: Array.isArray(d.schlagworte) ? d.schlagworte : [],
    favorit: !!d.favorit,
    anproben: (d.anproben || []).slice(0, 12).map(a => ({ id: a.id, bild: a.bild, datum: a.datum })),
    thumb: d.thumb,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    deletedAt: d.deletedAt || null
  };
}

/* ---------- Austausch als Datei (AirDrop, Teilen, Sicherung) ---------- */

export const FILE_FORMAT = 'nagelstudio-entwuerfe';
export const FILE_VERSION = 1;

export async function exportDesigns(designs){
  const out = [];
  for(const d of designs){
    const nails = {};
    for(const [key, nail] of Object.entries(d.nails || {})){
      nails[key] = {
        shape: nail.shape,
        length: laenge(nail.length),
        base: nail.base,
        layers: await Promise.all((nail.layers || []).map(async l => ({
          id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
          image: await imageToDataUrl(l.image),
          pattern: sauberesMuster(l.pattern)
        })))
      };
    }
    out.push({
      id: d.id,
      name: d.name,
      nails,
      notiz: d.notiz || '',
      schlagworte: d.schlagworte || [],
      favorit: !!d.favorit,
      anproben: await Promise.all((d.anproben || []).map(async a => ({
        id: a.id, datum: a.datum, bild: await imageToDataUrl(a.bild)
      }))),
      thumb: await imageToDataUrl(d.thumb),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      deletedAt: d.deletedAt || null
    });
  }
  return { format: FILE_FORMAT, version: FILE_VERSION, exportedAt: Date.now(), designs: out };
}

function validDesign(d){
  return d && typeof d.id === 'string' && typeof d.updatedAt === 'number'
      && (d.nails || Array.isArray(d.layers));   // neues oder altes Format
}

/**
 * Fuehrt eingelesene Entwuerfe mit dem Bestand zusammen.
 * Regel: Der neuere Aenderungszeitstempel gewinnt -- fuer ein Werkzeug, das
 * eine einzelne Person benutzt, reicht das vollkommen aus.
 */
export async function mergeDesigns(payload){
  if(!payload || payload.format !== FILE_FORMAT || !Array.isArray(payload.designs)){
    throw new Error('Das ist keine Nagelstudio-Datei.');
  }
  const stats = { neu:0, aktualisiert:0, uebersprungen:0, geloescht:0 };
  for(const raw of payload.designs){
    if(!validDesign(raw)){ stats.uebersprungen++; continue; }
    const mine = await getDesign(raw.id);
    if(mine && mine.updatedAt >= raw.updatedAt){ stats.uebersprungen++; continue; }

    const readLayers = (list) => (list || []).map(l => ({
      id: String(l.id || newId()),
      name: String(l.name || 'Ebene'),
      visible: l.visible !== false,
      opacity: Number.isFinite(l.opacity) ? l.opacity : 1,
      image: dataUrlToBlob(l.image),
      pattern: sauberesMuster(l.pattern)
    }));

    const nails = {};
    if(raw.nails){
      FINGER_KEYS.forEach(k => {
        const n = raw.nails[k] || {};
        nails[k] = {
          shape: String(n.shape || 'mandel'),
          length: laenge(n.length),
          base: typeof n.base === 'string' ? n.base : NATURAL,
          layers: readLayers(n.layers)
        };
      });
    }else{
      // Datei aus der ersten Fassung: ein Nagel wird zum Satz
      FINGER_KEYS.forEach(k => {
        nails[k] = {
          shape: String(raw.shape || 'mandel'),
          base: NATURAL,
          layers: readLayers(raw.layers)
        };
      });
    }

    const incoming = {
      id: raw.id,
      name: String(raw.name || ''),
      nails,
      notiz: String(raw.notiz || ''),
      schlagworte: Array.isArray(raw.schlagworte) ? raw.schlagworte.map(String).slice(0, 12) : [],
      favorit: !!raw.favorit,
      anproben: Array.isArray(raw.anproben)
        ? raw.anproben.slice(0, 12).filter(a => a && a.bild).map(a => ({
            id: String(a.id || newId()), datum: Number(a.datum) || Date.now(), bild: dataUrlToBlob(a.bild)
          }))
        : [],
      thumb: dataUrlToBlob(raw.thumb),
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now(),
      deletedAt: raw.deletedAt || null
    };
    await tx('readwrite', s => s.put(structuredCloneSafe(incoming)));
    if(incoming.deletedAt) stats.geloescht++;
    else if(mine) stats.aktualisiert++;
    else stats.neu++;
  }
  return stats;
}

/**
 * Gibt die Datei weiter: auf iOS/iPadOS ueber das Teilen-Menue (dort liegt
 * AirDrop), sonst als normaler Download.
 */
export async function shareFile(filename, json){
  return shareBlob(filename, new Blob([JSON.stringify(json)], { type:'application/json' }));
}

/** Gibt einen beliebigen Blob weiter -- Teilen-Menue, sonst Download. */
export async function shareBlob(filename, blob){
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });

  if(navigator.canShare && navigator.canShare({ files:[file] }) && navigator.share){
    try{
      await navigator.share({ files:[file], title: filename });
      return 'geteilt';
    }catch(err){
      if(err && err.name === 'AbortError') return 'abgebrochen';
      // faellt unten auf den Download zurueck
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'gespeichert';
}
