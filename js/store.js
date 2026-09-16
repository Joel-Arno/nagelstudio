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

export function emptyDesign(shape = 'mandel'){
  const now = Date.now();
  return {
    id: newId(),
    name: '',
    shape,
    layers: [],          // { id, name, visible, opacity, image }
    thumb: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
}

export async function putDesign(design){
  design.updatedAt = Date.now();
  await tx('readwrite', s => s.put(structuredCloneSafe(design)));
  return design;
}

export async function getDesign(id){
  return tx('readonly', s => ({ __req: s.get(id) }));
}

/** Alle lebenden Entwuerfe, zuletzt geaendert zuerst. */
export async function listDesigns(){
  const all = await tx('readonly', s => ({ __req: s.getAll() }));
  return (all || [])
    .filter(d => !d.deletedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Loeschen heisst: als geloescht markieren und Bilddaten freigeben. */
export async function deleteDesign(id){
  const d = await getDesign(id);
  if(!d) return;
  d.deletedAt = Date.now();
  d.layers = [];
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
  return {
    id: d.id,
    name: d.name,
    shape: d.shape,
    layers: (d.layers || []).map(l => ({
      id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, image: l.image
    })),
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
    out.push({
      id: d.id,
      name: d.name,
      shape: d.shape,
      layers: await Promise.all((d.layers || []).map(async l => ({
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
        image: await imageToDataUrl(l.image)
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
  return d && typeof d.id === 'string' && Array.isArray(d.layers) && typeof d.updatedAt === 'number';
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

    const incoming = {
      id: raw.id,
      name: String(raw.name || ''),
      shape: String(raw.shape || 'mandel'),
      layers: (raw.layers || []).map(l => ({
        id: String(l.id || newId()),
        name: String(l.name || 'Ebene'),
        visible: l.visible !== false,
        opacity: Number.isFinite(l.opacity) ? l.opacity : 1,
        image: dataUrlToBlob(l.image)
      })),
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
  const text = JSON.stringify(json);
  const file = new File([text], filename, { type:'application/json' });

  if(navigator.canShare && navigator.canShare({ files:[file] }) && navigator.share){
    try{
      await navigator.share({ files:[file], title: filename });
      return 'geteilt';
    }catch(err){
      if(err && err.name === 'AbortError') return 'abgebrochen';
      // faellt unten auf den Download zurueck
    }
  }

  const url = URL.createObjectURL(new Blob([text], { type:'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'gespeichert';
}
