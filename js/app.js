/**
 * Verdrahtung der Oberflaeche: Galerie, Editor, Speichern, Austausch.
 */

import { SHAPES, shapeSvg, shapeById, effectiveLength, lengthLabel } from './shapes.js';
import { fingerCanvas } from './nailrender.js';
import { NailEditor, IMG_W, IMG_H } from './draw.js';
import { TryOn } from './tryon.js';
import { LiveKamera } from './camera.js';
import {
  emptyDesign, putDesign, getDesign, listDesigns, deleteDesign, purgeDeleted,
  canvasToImage, imageToUrl, releaseUrl, loadImage,
  exportDesigns, mergeDesigns, shareFile, shareBlob, storageEstimate,
  FINGER_KEYS, FINGER_NAMES, NATURAL
} from './store.js';
import { designTexture, setThumbnail, forgetTextures, SET_LAYOUT, nagelMasse } from './compose.js';
import { PATTERNS, STAMPS, applyPattern, drawStamp } from './patterns.js';

const $ = (id) => document.getElementById(id);

const PALETTE = [
  '#D8456B','#B3123C','#7C1034','#E2727F','#F2A0B8','#F7D6DD',
  '#C4622D','#E8A33D','#E8C07D','#F6E7C8','#FFFFFF','#F3EDE4',
  '#6C8E6A','#2F6F62','#2B4C5C','#4A3F8F','#7A3CFF','#1C1A1E'
];

const RECENT_KEY = 'nagelstudio.farben';

let editor = null;
let current = null;          // offener Entwurf (Satz aus fuenf Naegeln)
let currentFinger = 'mittelfinger';
let saveTimer = null;
let dirty = false;
let recent = loadRecent();
let suchText = '';
let nurFavoriten = false;

/* ================= Galerie ================= */

function formatDate(ts){
  const d = new Date(ts);
  const heute = new Date();
  const sameDay = d.toDateString() === heute.toDateString();
  if(sameDay) return 'heute ' + d.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' });
  return d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'2-digit' });
}

function passtZurSuche(d){
  if(nurFavoriten && !d.favorit) return false;
  if(!suchText) return true;
  const heu = [d.name, d.notiz, ...(d.schlagworte || [])].join(' ').toLowerCase();
  return suchText.split(/\s+/).every(w => heu.includes(w));
}

async function renderGallery(){
  const alle = await listDesigns();
  const designs = alle.filter(passtZurSuche);
  const grid = $('galleryGrid');
  grid.querySelectorAll('img').forEach(img => releaseUrl(img.src));
  grid.innerHTML = '';
  $('emptyGallery').hidden = designs.length > 0 || alle.length > 0;
  const nichtsGefunden = alle.length > 0 && designs.length === 0;
  let hinweis = document.getElementById('keinTreffer');
  if(nichtsGefunden){
    if(!hinweis){
      hinweis = document.createElement('p');
      hinweis.id = 'keinTreffer';
      hinweis.className = 'empty';
      grid.after(hinweis);
    }
    hinweis.textContent = 'Nichts gefunden zu „' + (suchText || 'Favoriten') + '“.';
    hinweis.hidden = false;
  }else if(hinweis){
    hinweis.hidden = true;
  }

  for(const d of designs){
    const card = document.createElement('article');
    card.className = 'card';

    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'card-preview';
    preview.setAttribute('aria-label', 'Entwurf ' + (d.name || 'ohne Namen') + ' öffnen');
    const img = document.createElement('img');
    img.alt = '';
    img.src = d.thumb ? imageToUrl(d.thumb) : placeholderThumb('mandel');
    preview.appendChild(img);
    preview.addEventListener('click', () => openDesign(d.id));

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const name = document.createElement('p');
    name.className = 'card-name';
    name.textContent = d.name || 'Ohne Namen';
    const date = document.createElement('span');
    date.className = 'card-date';
    const formen = [...new Set(FINGER_KEYS.map(k => (d.nails[k] || {}).shape).filter(Boolean))];
    date.textContent = (formen.length === 1 ? shapeById(formen[0]).name : formen.length + ' Formen')
                     + ' · ' + formatDate(d.updatedAt);
    meta.append(name, date);

    if(d.favorit){
      const stern = document.createElement('span');
      stern.className = 'card-fav';
      stern.textContent = '★';
      stern.setAttribute('aria-label', 'Favorit');
      card.appendChild(stern);
    }

    let tags = null;
    if((d.schlagworte || []).length){
      tags = document.createElement('div');
      tags.className = 'card-tags';
      d.schlagworte.slice(0, 3).forEach(t => {
        const tag = document.createElement('span');
        tag.className = 'card-tag';
        tag.textContent = t;
        tags.appendChild(tag);
      });
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.append(
      actionBtn('Kopie', () => duplicateDesign(d)),
      actionBtn('Teilen', () => shareDesigns([d], (d.name || 'entwurf'))),
      actionBtn('Löschen', () => confirmDelete(d), 'del')
    );

    card.append(preview, meta);
    if(tags) card.appendChild(tags);
    card.appendChild(actions);
    grid.appendChild(card);
  }

  showStorage();
}

function actionBtn(label, fn, cls){
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if(cls) b.className = cls;
  b.addEventListener('click', fn);
  return b;
}

function placeholderThumb(shape){
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140">' +
    shapeSvg(shape, '#EAD3DC').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') + '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

async function showStorage(){
  const est = await storageEstimate();
  if(!est || !est.usage){ $('storageInfo').textContent = ''; return; }
  const mb = (est.usage / 1048576).toFixed(1);
  $('storageInfo').textContent = 'Alles liegt auf diesem Gerät · ' + mb + ' MB belegt · sichere deine Entwürfe ab und zu über „Sichern“';
}

/* ================= Editor ================= */

function ensureEditor(){
  if(editor) return editor;
  editor = new NailEditor($('canvas'));
  editor.onChange = () => { dirty = true; scheduleSave(); refreshLayerList(); syncBaseColor(); };
  editor.onHistory = () => {
    $('btnUndo').disabled = !editor.canUndo();
    $('btnRedo').disabled = !editor.canRedo();
  };
  return editor;
}

async function openDesign(id){
  const design = await getDesign(id);
  if(!design) return;
  current = design;
  $('designName').value = design.name || '';
  $('notiz').value = design.notiz || '';
  $('schlagworte').value = (design.schlagworte || []).join(', ');
  $('btnFavorit').setAttribute('aria-pressed', String(!!design.favorit));
  $('btnFavorit').textContent = design.favorit ? '★' : '☆';
  await showSet();
}

/** Uebersicht des Satzes: fuenf Naegel zum Antippen. */
async function showSet(){
  showView('set');
  await renderSet();
  renderAnproben();
}

async function renderSet(){
  if(!current) return;
  const box = $('nailSet');
  box.innerHTML = '';
  const stage = $('nailSet').parentElement.getBoundingClientRect();
  const proBreite = Math.floor((Math.min(stage.width, 760) - 70) / 5);
  const proHoehe = Math.floor((stage.height - 150) * IMG_W / IMG_H);
  const nailW = Math.max(46, Math.min(150, proBreite, proHoehe || proBreite));

  for(const { key, scale, tilt } of SET_LAYOUT){
    const nail = current.nails[key];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'nail-card' + (isNailEmpty(nail) ? ' is-empty' : '');
    card.setAttribute('aria-label', FINGER_NAMES[key] + ' bemalen');

    // Jeder Nagel auf seinem Finger -- so liest man Laenge und Form sofort
    const w = Math.round(nailW * scale);
    const tex = await designTexture(current, key);
    const masse = nagelMasse(nail);
    const canvas = fingerCanvas(w, Math.round(w * 1.95), { shape: masse.shape, length: masse.length, texture: tex });

    canvas.style.transform = 'rotate(' + (tilt * 0.6).toFixed(3) + 'rad)';
    canvas.style.transformOrigin = '50% 100%';
    card.style.marginBottom = Math.round(nailW * (SET_LAYOUT[SET_LAYOUT.findIndex(x => x.key === key)].lift || 0) * 1.4) + 'px';

    const label = document.createElement('span');
    label.textContent = FINGER_NAMES[key];

    card.append(canvas, label);
    card.addEventListener('click', () => openNail(key));
    box.appendChild(card);
  }
}

function isNailEmpty(nail){
  return !nail || !(nail.layers || []).length;
}

/** Einen Nagel des Satzes im Editor oeffnen. */
async function openNail(fingerKey){
  const ed = ensureEditor();
  currentFinger = fingerKey;
  const nail = current.nails[fingerKey];

  const urls = [];
  const images = [];
  for(const l of nail.layers || []){
    const url = imageToUrl(l.image);
    urls.push(url);
    try{ images.push(url ? await loadImage(url) : null); }
    catch(e){ images.push(null); }
  }

  ed.loadDesign(nail, images);
  urls.forEach(releaseUrl);

  showView('editor');
  renderFingerSwitch();
  syncShapeList();
  refreshLayerList();
  syncBaseColor();
  ed.onHistory();
  dirty = false;
  requestAnimationFrame(() => ed.render());
  fadeHint();
}

function renderFingerSwitch(){
  const box = $('fingerSwitch');
  box.innerHTML = '';
  FINGER_KEYS.forEach(key => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'finger-tab' + (key === currentFinger ? ' is-active' : '');
    b.textContent = FINGER_NAMES[key];
    b.addEventListener('click', async () => {
      if(key === currentFinger) return;
      await stashNail();
      await openNail(key);
    });
    box.appendChild(b);
  });
}

function syncBaseColor(){
  const base = editor ? editor.base : NATURAL;
  $('baseColor').value = base || NATURAL;
  $('btnBaseNone').textContent = base ? 'ohne' : 'zurück';
}

async function newDesign(){
  const d = emptyDesign('mandel');
  await putDesign(d);
  current = d;
  currentFinger = 'mittelfinger';
  $('designName').value = '';
  $('notiz').value = '';
  $('schlagworte').value = '';
  $('btnFavorit').setAttribute('aria-pressed', 'false');
  $('btnFavorit').textContent = '☆';
  await showSet();
}

async function duplicateDesign(d){
  const full = await getDesign(d.id);
  if(!full) return;
  const copy = emptyDesign();
  copy.name = (full.name || 'Ohne Namen') + ' (Kopie)';
  FINGER_KEYS.forEach(k => {
    const n = full.nails[k] || {};
    copy.nails[k] = { shape: n.shape, base: n.base, layers: (n.layers || []).map(l => ({ ...l })) };
  });
  copy.thumb = full.thumb;
  await putDesign(copy);
  await renderGallery();
  toast('Kopie angelegt');
}

function fadeHint(){
  const hint = $('pencilHint');
  hint.classList.remove('fade');
  setTimeout(() => hint.classList.add('fade'), 4000);
}

function showView(which){
  $('viewGallery').hidden = which !== 'gallery';
  $('viewSet').hidden = which !== 'set';
  $('viewEditor').hidden = which !== 'editor';
  $('viewTryon').hidden = which !== 'tryon';
  $('viewCamera').hidden = which !== 'camera';
}

async function closeEditor(){
  await stashNail();
  await saveNow();
  await showSet();
}

async function closeSet(){
  const name = $('designName').value.trim();
  if(current && !name && isSetEmpty(current)){
    await deleteDesign(current.id);      // nichts gemalt, nichts behalten
    current = null;
  }else{
    await saveNow();
  }
  showView('gallery');
  await renderGallery();
}

function isSetEmpty(design){
  if(design.notiz || (design.schlagworte || []).length) return false;
  return FINGER_KEYS.every(k => isNailEmpty(design.nails[k]));
}

/** Den Stand des Editors in den Satz uebernehmen. */
async function stashNail(){
  if(!editor || !current) return;
  const layers = [];
  for(const l of editor.layerData()){
    layers.push({
      id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
      image: await canvasToImage(l.canvas),
      pattern: l.pattern
    });
  }
  current.nails[currentFinger] = { shape: editor.shape, length: editor.length, base: editor.base, layers };
}

/* ---------- Speichern ---------- */

function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1200);
}

async function saveNow(){
  clearTimeout(saveTimer);
  if(!current) return;
  if(editor && $('viewEditor').hidden === false) await stashNail();
  current.name = $('designName').value.trim();
  current.notiz = $('notiz').value.trim();
  current.schlagworte = $('schlagworte').value
    .split(',').map(t => t.trim()).filter(Boolean).slice(0, 12);
  current.updatedAt = Date.now();
  forgetTextures();
  current.thumb = await canvasToImage(await setThumbnail(current));
  await putDesign(current);
  dirty = false;
}

/* ---------- Ebenen ---------- */

function refreshLayerList(){
  if(!editor) return;
  const list = $('layerList');
  list.innerHTML = '';
  editor.layers.forEach((l) => {
    const row = document.createElement('div');
    row.className = 'layer' + (l.id === editor.activeLayerId ? ' is-active' : '');
    row.addEventListener('click', (e) => {
      if(e.target.closest('.layer-btn')) return;
      editor.selectLayer(l.id);
      refreshLayerList();
    });

    const thumb = document.createElement('span');
    thumb.className = 'layer-thumb';
    thumb.style.backgroundImage = 'url(' + layerThumb(l) + ')';

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = l.name;

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'layer-btn' + (l.visible ? '' : ' off');
    eye.textContent = l.visible ? '●' : '○';
    eye.title = l.visible ? 'Ebene ausblenden' : 'Ebene einblenden';
    eye.addEventListener('click', () => { editor.setLayerVisible(l.id, !l.visible); refreshLayerList(); dirty = true; scheduleSave(); });

    const up = document.createElement('button');
    up.type = 'button'; up.className = 'layer-btn'; up.textContent = '↑'; up.title = 'nach oben';
    up.addEventListener('click', () => { editor.moveLayer(l.id, 1); refreshLayerList(); dirty = true; scheduleSave(); });

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'layer-btn'; del.textContent = '✕'; del.title = 'Ebene löschen';
    del.addEventListener('click', () => {
      if(editor.layers.length <= 1){ toast('Die letzte Ebene bleibt bestehen'); return; }
      askModal('Ebene löschen?', 'Diese Ebene wird entfernt. Das lässt sich nicht rückgängig machen.', 'Löschen', () => {
        editor.removeLayer(l.id);
        refreshLayerList();
        dirty = true; scheduleSave();
      });
    });

    row.append(thumb, name, eye, up, del);
    list.appendChild(row);
  });
}

const thumbCache = new WeakMap();
function layerThumb(l){
  const c = document.createElement('canvas');
  c.width = 26; c.height = 36;
  const ctx = c.getContext('2d');
  ctx.drawImage(l.canvas, 0, 0, IMG_W, IMG_H, 0, 0, 26, 36);
  return c.toDataURL('image/png');
}


/* ---------- Muster und Stempel ---------- */

let patternStrength = 0.5;

function buildPatterns(){
  const box = $('patternGrid');
  box.innerHTML = '';
  PATTERNS.forEach(pat => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pattern-item';
    b.title = pat.name;

    const c = document.createElement('canvas');
    c.width = 60; c.height = 84;
    b.appendChild(c);

    const label = document.createElement('span');
    label.textContent = pat.name;
    b.appendChild(label);

    b.addEventListener('click', () => {
      ensureEditor().usePattern(pat.id, { strength: patternStrength });
      refreshLayerList();
      dirty = true; scheduleSave();
      toast(pat.name + ' aufgelegt');
    });
    box.appendChild(b);
    drawPatternPreview(c, pat);
  });
}

/** Kleine Vorschau je Muster, in den gerade gewählten Farben. */
function drawPatternPreview(canvas, pat){
  const tmp = document.createElement('canvas');
  tmp.width = IMG_W; tmp.height = IMG_H;
  const tctx = tmp.getContext('2d');
  tctx.fillStyle = '#F3E6E2';
  tctx.fillRect(0, 0, IMG_W, IMG_H);
  applyPattern(tctx, pat.id, {
    color: editor ? editor.color : '#D8456B',
    color2: $('color2') ? $('color2').value : '#FFFFFF',
    strength: patternStrength
  });
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath();
  const r = 7;
  ctx.moveTo(r, 0); ctx.lineTo(canvas.width - r, 0);
  ctx.quadraticCurveTo(canvas.width, 0, canvas.width, r);
  ctx.lineTo(canvas.width, canvas.height - 3);
  ctx.quadraticCurveTo(canvas.width / 2, canvas.height + 4, 0, canvas.height - 3);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.clip();
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function refreshPatternPreviews(){
  const items = $('patternGrid').querySelectorAll('.pattern-item canvas');
  PATTERNS.forEach((pat, i) => { if(items[i]) drawPatternPreview(items[i], pat); });
}

function buildStamps(){
  const row = $('stampRow');
  row.innerHTML = '';
  STAMPS.forEach(st => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stamp-item';
    b.title = st.name;
    b.setAttribute('aria-label', 'Stempel ' + st.name);

    const c = document.createElement('canvas');
    c.width = 60; c.height = 60;
    const ctx = c.getContext('2d');
    drawStamp(ctx, st.id, 30, 30, 52, editor ? editor.color : '#D8456B');
    b.appendChild(c);

    b.addEventListener('click', () => {
      ensureEditor().setStamp(st.id);
      selectTool('stamp');
      document.querySelectorAll('.stamp-item').forEach(x => x.classList.toggle('is-active', x === b));
      toast(st.name + ' gewählt – tippe auf den Nagel');
    });
    row.appendChild(b);
  });
}

function refreshStampPreviews(){
  const items = $('stampRow').querySelectorAll('.stamp-item canvas');
  STAMPS.forEach((st, i) => {
    if(!items[i]) return;
    const ctx = items[i].getContext('2d');
    ctx.clearRect(0, 0, 60, 60);
    drawStamp(ctx, st.id, 30, 30, 52, editor ? editor.color : '#D8456B');
  });
}

/* ---------- Formen ---------- */

function buildShapeList(){
  const box = $('shapeList');
  box.innerHTML = '';
  SHAPES.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shape-item';
    b.dataset.shape = s.id;
    b.setAttribute('aria-label', 'Form ' + s.name);
    const bild = document.createElement('span');
    bild.className = 'shape-bild';
    const name = document.createElement('span');
    name.className = 'shape-name';
    name.textContent = s.name;
    b.append(bild, name);
    b.addEventListener('click', () => {
      editor.setShape(s.id);
      if($('formFuerAlle').checked) formAufAlle({ shape: s.id, length: editor.length });
      syncShapeList();
      dirty = true; scheduleSave();
    });
    box.appendChild(b);
  });
}

/** Form und Laenge gelten im Studio meist fuer die ganze Hand. */
function formAufAlle(werte){
  if(!current) return;
  FINGER_KEYS.forEach(k => {
    const n = current.nails[k] || (current.nails[k] = { base: NATURAL, layers: [] });
    if(werte.shape) n.shape = werte.shape;
    if(werte.length != null) n.length = effectiveLength(n.shape || 'mandel', werte.length);
  });
}

let formFrame = null;
function syncShapeList(){
  if(!editor) return;
  document.querySelectorAll('.shape-item').forEach(b => {
    b.classList.toggle('is-active', b.dataset.shape === editor.shape);
  });
  $('laengeRange').value = Math.round(editor.length * 100);
  $('laengeOut').textContent = lengthLabel(editor.length);

  // Vorschauen gebuendelt einmal pro Bild neu zeichnen
  if(formFrame) return;
  formFrame = requestAnimationFrame(() => {
    formFrame = null;
    document.querySelectorAll('.shape-item').forEach(b => {
      const slot = b.querySelector('.shape-bild');
      slot.innerHTML = '';
      slot.appendChild(fingerCanvas(52, 84, { shape: b.dataset.shape, length: editor.length }));
    });
    const gross = $('laengeVorschau');
    gross.innerHTML = '';
    gross.appendChild(fingerCanvas(78, 138, {
      shape: editor.shape, length: editor.length, texture: editor.exportTexture()
    }));
  });
}

/* ---------- Farben ---------- */

function loadRecent(){
  try{ return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }catch(e){ return []; }
}
function rememberColor(c){
  recent = [c, ...recent.filter(x => x !== c)].slice(0, 6);
  try{ localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); }catch(e){}
  buildPalette();
}

function buildPalette(){
  const box = $('palette');
  box.innerHTML = '';
  const colors = [...new Set([...recent, ...PALETTE])];
  colors.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (editor && editor.color === c ? ' is-active' : '');
    b.style.background = c;
    b.title = c;
    b.setAttribute('aria-label', 'Farbe ' + c);
    b.addEventListener('click', () => {
      setColor(c);
      buildPalette();
    });
    box.appendChild(b);
  });
}

function buildColorBar(){
  const bar = $('colorBar');
  if(!bar) return;
  bar.innerHTML = '';

  const aktuell = document.createElement('span');
  aktuell.className = 'aktuell';
  aktuell.style.background = editor ? editor.color : PALETTE[0];
  aktuell.title = 'aktuelle Farbe';
  bar.appendChild(aktuell);

  // die zuletzt benutzten Farben, sonst die Anfangsauswahl
  const schnell = [...new Set([...recent, ...PALETTE])].slice(0, 6);
  schnell.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'quick';
    b.style.background = c;
    b.title = c;
    b.setAttribute('aria-label', 'Farbe ' + c);
    b.addEventListener('click', () => { setColor(c); buildPalette(); });
    bar.appendChild(b);
  });

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = editor ? editor.color : PALETTE[0];
  picker.setAttribute('aria-label', 'eigene Farbe');
  picker.addEventListener('input', (e) => setColor(e.target.value));
  picker.addEventListener('change', (e) => rememberColor(e.target.value));
  bar.appendChild(picker);
}

function setColor(c){
  ensureEditor().setColor(c);
  $('colorPicker').value = c;
  if(editor.tool === 'eraser') selectTool('brush');
  refreshPatternPreviews();
  refreshStampPreviews();
  buildColorBar();
}

/* ---------- Werkzeuge ---------- */

function selectTool(tool){
  ensureEditor().setTool(tool);
  document.querySelectorAll('.tool[data-tool]').forEach(b => {
    b.classList.toggle('is-active', b.dataset.tool === tool);
  });
}

/* ---------- Austausch ---------- */

async function shareDesigns(designs, label){
  if(!designs.length){ toast('Es gibt noch nichts zu sichern'); return; }
  try{
    const payload = await exportDesigns(designs);
    const slug = (label || 'nagelstudio').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'nagelstudio';
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const res = await shareFile(slug + '-' + stamp + '.json', payload);
    if(res === 'geteilt') toast('Geteilt');
    else if(res === 'gespeichert') toast('Datei gespeichert – von dort aus per AirDrop teilen');
  }catch(err){
    toast('Teilen fehlgeschlagen: ' + err.message);
  }
}

async function importFile(file){
  try{
    const data = JSON.parse(await file.text());
    const stats = await mergeDesigns(data);
    await renderGallery();
    const parts = [];
    if(stats.neu) parts.push(stats.neu + ' neu');
    if(stats.aktualisiert) parts.push(stats.aktualisiert + ' aktualisiert');
    if(stats.geloescht) parts.push(stats.geloescht + ' gelöscht');
    if(stats.uebersprungen) parts.push(stats.uebersprungen + ' unverändert');
    toast(parts.length ? 'Übernommen: ' + parts.join(', ') : 'Nichts Neues dabei');
  }catch(err){
    toast(err.message || 'Datei konnte nicht gelesen werden');
  }
}

/* ---------- Kleinteile ---------- */

let toastTimer = null;
function toast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

let modalAction = null;
function askModal(title, text, okLabel, fn){
  $('modalTitle').textContent = title;
  $('modalText').textContent = text;
  $('modalOk').textContent = okLabel;
  modalAction = fn;
  $('modal').hidden = false;
}
function closeModal(){ $('modal').hidden = true; modalAction = null; }

function confirmDelete(d){
  askModal(
    'Entwurf löschen?',
    '„' + (d.name || 'Ohne Namen') + '“ wird von diesem Gerät entfernt.',
    'Löschen',
    async () => { await deleteDesign(d.id); await renderGallery(); toast('Gelöscht'); }
  );
}


/* ================= Anprobe ================= */

let tryon = null;
let tryonUrls = [];
let bevorzugterEntwurf = null;   // aus der Satz-Uebersicht heraus geoeffnet
let alleEntwuerfe = [];

function ensureTryon(){
  if(tryon) return tryon;
  tryon = new TryOn($('tryonCanvas'));
  tryon.onChange = () => renderNailChips();
  return tryon;
}

/** Statuszeile der Anprobe; nimmt Text oder { text, anteil } entgegen. */
function tryonStatus(info){
  const el = $('tryonStatus');
  if(!info){ el.hidden = true; el.innerHTML = ''; return; }
  const text = typeof info === 'string' ? info : info.text;
  const anteil = typeof info === 'object' ? info.anteil : null;
  el.hidden = false;
  if(anteil == null){ el.textContent = text; return; }
  el.innerHTML = '';
  const zeile = document.createElement('span');
  zeile.textContent = text + ' ' + Math.round(anteil * 100) + '%';
  const balken = document.createElement('span');
  balken.className = 'balken';
  const fuell = document.createElement('span');
  fuell.style.width = Math.round(anteil * 100) + '%';
  balken.appendChild(fuell);
  el.append(zeile, balken);
}

/**
 * Die Anprobe hat vier Zustaende: noch kein Foto, Ergebnis (mit
 * Vorher/Nachher), Laenge & Form anpassen, Naegel nachjustieren.
 */
function setTryonModus(modus){
  const hatFoto = !!(tryon && tryon.photo);
  $('tryonEmpty').hidden = modus !== 'leer';
  $('tryonBar').hidden = modus === 'leer';
  $('btnNochmal').hidden = !hatFoto;
  $('ergebnisKnoepfe').hidden = modus !== 'ergebnis';
  $('wischHinweis').hidden = modus !== 'ergebnis';
  $('designStrip').hidden = modus === 'justage';
  $('anpassenPanel').hidden = modus !== 'anpassen';
  $('justagePanel').hidden = modus !== 'justage';
  $('tryonZoom').hidden = modus !== 'justage';
  $('tryonTitel').textContent = modus === 'ergebnis' ? 'Fertig' : 'Anprobe';
  $('tryonUnterzeile').textContent =
    modus === 'ergebnis' ? 'So sieht es an deiner Hand aus' :
    modus === 'anpassen' ? 'Dasselbe Design in anderer Form oder Länge' :
    modus === 'justage'  ? 'Nagel antippen und ziehen, oder mit den Knöpfen verschieben' :
                           'Probier deine Entwürfe an deiner Hand';
  if(tryon){
    tryon.griffe = modus === 'justage';
    if(modus === 'ergebnis') tryon.setVergleich(true);
    else tryon.setVergleich(false);
    if(modus !== 'justage') tryon.resetView();
  }
}

async function openTryon(designId){
  const t = ensureTryon();
  alleEntwuerfe = await listDesigns();
  if(!alleEntwuerfe.length){
    toast('Gestalte zuerst einen Entwurf – den kannst du dann anprobieren');
    return;
  }
  bevorzugterEntwurf = designId || null;
  t.setDesigns(alleEntwuerfe);
  forgetTextures();
  await t.refreshTextures();
  showView('tryon');
  renderDesignStrip(alleEntwuerfe);
  renderNailChips();
  setTryonModus(t.photo && t.nails.length ? 'ergebnis' : 'leer');
  if(designId && t.nails.length){ await t.assignAll(designId); renderDesignStrip(alleEntwuerfe); }
  requestAnimationFrame(() => t.render());
}

async function loadPhoto(file){
  const url = URL.createObjectURL(file);
  tryonUrls.push(url);
  try{
    const img = await loadImage(url);
    await fotoVerwenden(img);
  }catch(err){
    toast('Foto konnte nicht geladen werden');
  }
}

async function fotoVerwenden(quelle){
  const t = ensureTryon();
  showView('tryon');
  await t.setPhoto(quelle);
  $('tryonEmpty').hidden = true;
  $('btnTryonShare').disabled = false;
  await runDetection();
}

async function runDetection(){
  const t = ensureTryon();
  try{
    tryonStatus('Nägel werden gesucht …');
    const res = await t.detect(tryonStatus);
    if(!res.nails){
      tryonStatus(null);
      toast('Keine Hand erkannt – setz die Nägel von Hand');
      setTryonModus('justage');
      renderNailChips();
      return;
    }
    const chip = $('erkanntChip');
    chip.textContent = '✓ ' + res.nails + ' Nägel erkannt';
    chip.hidden = false;
    tryonStatus('Design wird aufgetragen …');

    const designs = alleEntwuerfe.length ? alleEntwuerfe : await listDesigns();
    const ziel = (bevorzugterEntwurf && designs.find(d => d.id === bevorzugterEntwurf)) || designs[0];
    if(ziel) await t.assignAll(ziel.id);
    tryonStatus(null);
    setTimeout(() => { chip.hidden = true; }, 2200);

    renderNailChips();
    renderDesignStrip(designs);
    setTryonModus('ergebnis');
    t.vergleich = 0.12;            // fast alles "Nachher" -- laedt zum Wischen ein
    t.render();
  }catch(err){
    tryonStatus(null);
    toast('Erkennung fehlgeschlagen: ' + (err.message || 'unbekannter Fehler'));
  }
}

function renderNailChips(){
  const box = $('nailChips');
  if(!tryon) return;
  box.innerHTML = '';
  const mehrereHaende = tryon.nails.some(n => n.handName && n.handName !== 'von Hand');
  tryon.nails.forEach(n => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nail-chip' + (n.id === tryon.selected ? ' is-active' : '') + (n.visible ? '' : ' is-off');
    b.textContent = n.name;
    if(mehrereHaende && n.handName){
      const tag = document.createElement('span');
      tag.className = 'hand-tag';
      tag.textContent = n.handName;
      b.appendChild(tag);
    }
    b.addEventListener('click', () => { tryon.select(n.id); renderNailChips(); });
    box.appendChild(b);
  });
  const sel = tryon.selectedNail;
  $('btnNailHide').textContent = sel && !sel.visible ? 'Einblenden' : 'Ausblenden';
  $('btnManualNails').textContent = tryon.nails.length ? 'Nagel hinzufügen' : 'Von Hand setzen';
}

function aktiverEntwurfId(){
  if(!tryon) return null;
  const n = tryon.selectedNail || tryon.nails.find(x => x.designId);
  return n ? n.designId : null;
}

function renderDesignStrip(designs){
  const box = $('designStrip');
  box.querySelectorAll('img').forEach(img => releaseUrl(img.src));
  box.innerHTML = '';
  const aktiv = aktiverEntwurfId();
  designs.forEach(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'design-tile' + (aktiv === d.id ? ' is-active' : '');
    const img = document.createElement('img');
    img.alt = '';
    img.src = d.thumb ? imageToUrl(d.thumb) : placeholderThumb('mandel');
    const name = document.createElement('span');
    name.textContent = d.name || 'Ohne Namen';
    b.append(img, name);
    b.addEventListener('click', async () => {
      // Ein Entwurf ist ein ganzer Satz -- jeder Finger bekommt seinen Nagel.
      await tryon.assignAll(d.id);
      renderDesignStrip(designs);
      renderNailChips();
    });
    box.appendChild(b);
  });
}

/* ---------- Laenge & Form auf der Hand ---------- */

function buildAnpassen(){
  const box = $('anpassenFormen');
  box.innerHTML = '';
  SHAPES.forEach(sh => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shape-item';
    b.dataset.shape = sh.id;
    const bild = document.createElement('span');
    bild.className = 'shape-bild';
    const name = document.createElement('span');
    name.className = 'shape-name';
    name.textContent = sh.name;
    b.append(bild, name);
    b.addEventListener('click', async () => {
      const v = Object.assign({}, tryon.vorgabe || {}, { shape: sh.id });
      await tryon.setVorgabe(v);
      syncAnpassen();
    });
    box.appendChild(b);
  });
}

function syncAnpassen(){
  if(!tryon) return;
  const v = tryon.vorgabe || {};
  const probe = tryon.nails.find(n => n.designId);
  const design = probe ? tryon.designs.get(probe.designId) : null;
  const eigen = design && design.nails ? design.nails[probe.finger] || {} : {};
  const form = v.shape || eigen.shape || 'mandel';
  const laenge = effectiveLength(form, v.length != null ? v.length : eigen.length);

  document.querySelectorAll('#anpassenFormen .shape-item').forEach(b => {
    b.classList.toggle('is-active', b.dataset.shape === form);
    const slot = b.querySelector('.shape-bild');
    slot.innerHTML = '';
    slot.appendChild(fingerCanvas(44, 72, { shape: b.dataset.shape, length: laenge }));
  });
  $('anpassenLaenge').value = Math.round(laenge * 100);
  $('anpassenLaengeOut').textContent = lengthLabel(laenge) + (tryon.vorgabe ? '' : ' · wie im Entwurf');
}

/* ---------- Ergebnis sichern und teilen ---------- */

function ergebnisBlob(maxKante){
  return new Promise(resolve => {
    let canvas = tryon.exportImage();
    if(maxKante && Math.max(canvas.width, canvas.height) > maxKante){
      const k = maxKante / Math.max(canvas.width, canvas.height);
      const klein = document.createElement('canvas');
      klein.width = Math.round(canvas.width * k);
      klein.height = Math.round(canvas.height * k);
      klein.getContext('2d').drawImage(canvas, 0, 0, klein.width, klein.height);
      canvas = klein;
    }
    canvas.toBlob(b => resolve(b), 'image/jpeg', 0.9);
  });
}

async function shareTryon(){
  if(!tryon || !tryon.photo) return;
  tryonStatus('Bild wird erzeugt …');
  const blob = await ergebnisBlob();
  tryonStatus(null);
  if(!blob){ toast('Bild konnte nicht erzeugt werden'); return; }
  const d = new Date();
  const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
              + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  const res = await shareBlob('anprobe-' + stamp + '.jpg', blob);
  if(res === 'gespeichert') toast('Bild gespeichert');
  else if(res === 'geteilt') toast('Geteilt');
}

/** Anprobe beim Entwurf ablegen -- so laesst sie sich spaeter wieder zeigen. */
async function speichereAnprobe(){
  const id = aktiverEntwurfId();
  if(!tryon || !tryon.photo || !id){ toast('Leg zuerst einen Entwurf auf'); return; }
  const blob = await ergebnisBlob(1600);
  const design = await getDesign(id);
  if(!design || !blob){ toast('Speichern hat nicht geklappt'); return; }
  design.anproben = [{ id: 'a' + Date.now().toString(36), bild: blob, datum: Date.now() }]
    .concat(design.anproben || []).slice(0, 12);
  await putDesign(design);
  toast('Bei „' + (design.name || 'Ohne Namen') + '“ gespeichert');
}

function closeTryon(){
  tryonUrls.forEach(releaseUrl);
  tryonUrls = [];
  if(kamera) kamera.stop();
  showView('gallery');
  renderGallery();
}

/* ---------- Live-Kamera ---------- */

let kamera = null;

function ensureKamera(){
  if(kamera) return kamera;
  kamera = new LiveKamera({
    video: $('camVideo'),
    overlay: $('camOverlay'),
    onStatus: kameraStatus,
    onAufnahme: (canvas) => {
      $('viewCamera').classList.add('blitz');
      setTimeout(() => $('viewCamera').classList.remove('blitz'), 260);
      kamera.stop();
      fotoVerwenden(canvas);
    }
  });
  return kamera;
}

function kameraStatus(info){
  const pill = $('camStatus');
  const ring = $('camRing');
  if(info.laden){
    const l = info.laden;
    pill.textContent = (l.text || 'Lädt …') + (l.anteil != null ? ' ' + Math.round(l.anteil * 100) + '%' : '');
    pill.className = 'cam-status';
    return;
  }
  const b = info.bewertung;
  pill.textContent = b.ok ? 'Perfekt ✓' : b.hinweis;
  pill.className = 'cam-status' + (b.ok ? ' ok' : b.fastOk ? ' fast' : '');
  const umfang = 2 * Math.PI * 36;
  ring.style.strokeDasharray = umfang;
  ring.style.strokeDashoffset = umfang * (1 - (info.fortschritt || 0));
  $('btnCamShot').classList.toggle('bereit', !!b.ok);

  // Wie bei naild: gruene Ecken und ein 3-2-1, solange die Haltung stimmt
  $('viewCamera').classList.toggle('perfekt', !!b.ok);
  const cd = $('camCountdown');
  const rest = b.ok && kamera && kamera.auto ? Math.ceil(3 - (info.fortschritt || 0) * 3) : 0;
  cd.hidden = !(rest > 0 && rest <= 3);
  if(!cd.hidden) cd.textContent = rest;
}

async function starteKamera(){
  const k = ensureKamera();
  showView('camera');
  $('camStatus').textContent = 'Kamera startet …';
  $('camStatus').className = 'cam-status';
  try{
    await k.start();
  }catch(err){
    showView('tryon');
    const verweigert = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    toast(verweigert ? 'Kamerazugriff verweigert – nimm stattdessen ein Foto auf' : 'Kamera nicht verfügbar – nimm stattdessen ein Foto auf');
    $('filePhotoCam').click();
  }
}

/* ---------- Anproben in der Satz-Uebersicht ---------- */

let anprobeUrls = [];
function renderAnproben(){
  anprobeUrls.forEach(releaseUrl);
  anprobeUrls = [];
  const box = $('anprobenBox');
  const reihe = $('anprobenReihe');
  const liste = (current && current.anproben) || [];
  box.hidden = !liste.length;
  reihe.innerHTML = '';
  liste.forEach((a, i) => {
    const url = imageToUrl(a.bild);
    anprobeUrls.push(url);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'anprobe-kachel';
    b.setAttribute('aria-label', 'Anprobe vom ' + new Date(a.datum).toLocaleDateString('de-DE'));
    const img = document.createElement('img');
    img.src = url; img.alt = '';
    b.appendChild(img);
    b.addEventListener('click', () => zeigeAnprobe(i));
    reihe.appendChild(b);
  });
}

function zeigeAnprobe(i){
  const a = current && current.anproben && current.anproben[i];
  if(!a) return;
  const url = imageToUrl(a.bild);
  $('bildGross').src = url;
  $('bildDatum').textContent = new Date(a.datum).toLocaleString('de-DE', { dateStyle:'medium', timeStyle:'short' });
  $('bildansicht').hidden = false;
  $('bildTeilen').onclick = () => shareBlob('anprobe.jpg', a.bild);
  $('bildLoeschen').onclick = async () => {
    current.anproben.splice(i, 1);
    await putDesign(current);
    $('bildansicht').hidden = true;
    releaseUrl(url);
    renderAnproben();
  };
}

/* ================= Start ================= */

function wire(){
  // Galerie
  $('btnNew').addEventListener('click', newDesign);
  $('btnShareAll').addEventListener('click', async () => {
    const all = await listDesigns();
    shareDesigns(all, 'nagelstudio-alle');
  });
  $('btnImport').addEventListener('click', () => $('fileImport').click());
  $('fileImport').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if(f) importFile(f);
  });

  // Editor
  $('btnBack').addEventListener('click', closeEditor);
  $('designName').addEventListener('input', () => { dirty = true; scheduleSave(); });
  $('btnUndo').addEventListener('click', () => ensureEditor().undo());
  $('btnRedo').addEventListener('click', () => ensureEditor().redo());

  document.querySelectorAll('.tool[data-tool]').forEach(b => {
    b.addEventListener('click', () => selectTool(b.dataset.tool));
  });
  $('btnFill').addEventListener('click', () => { ensureEditor().fillLayer(); dirty = true; scheduleSave(); });
  $('btnClearLayer').addEventListener('click', () => {
    askModal('Ebene leeren?', 'Alles auf der aktiven Ebene wird entfernt. Rückgängig geht noch.', 'Leeren', () => {
      editor.clearLayer(); dirty = true; scheduleSave();
    });
  });

  $('sizeRange').addEventListener('input', (e) => {
    ensureEditor().setSize(Number(e.target.value));
    $('sizeOut').textContent = e.target.value;
  });
  $('opacityRange').addEventListener('input', (e) => {
    ensureEditor().setOpacity(Number(e.target.value) / 100);
    $('opacityOut').textContent = e.target.value + '%';
  });
  $('pressureToggle').addEventListener('change', (e) => ensureEditor().setPressure(e.target.checked));
  $('colorPicker').addEventListener('input', (e) => setColor(e.target.value));
  $('colorPicker').addEventListener('change', (e) => rememberColor(e.target.value));



  // Laenge
  $('laengeRange').addEventListener('input', (e) => {
    const ed = ensureEditor();
    ed.setLength(Number(e.target.value) / 100);
    if($('formFuerAlle').checked) formAufAlle({ length: ed.length });
    syncShapeList();
    dirty = true; scheduleSave();
  });

  // Muster und Stempel
  $('patternStrength').addEventListener('input', (e) => {
    patternStrength = Number(e.target.value) / 100;
    $('patternStrengthOut').textContent = e.target.value + '%';
    refreshPatternPreviews();
  });
  $('color2').addEventListener('input', (e) => {
    ensureEditor().setColor2(e.target.value);
    refreshPatternPreviews();
  });

  $('btnAddLayer').addEventListener('click', () => {
    ensureEditor().addLayer();
    refreshLayerList();
    dirty = true; scheduleSave();
  });

  $('btnZoomIn').addEventListener('click', () => ensureEditor().zoomBy(1.25));
  $('btnZoomOut').addEventListener('click', () => ensureEditor().zoomBy(0.8));
  $('btnZoomReset').addEventListener('click', () => ensureEditor().resetView());

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      // Auf schmalen Bildschirmen zaehlt jeder Pixel: nochmal auf den
      // aktiven Reiter tippen klappt das Panel weg und gibt der
      // Zeichenflaeche den Platz. Auf grossen Bildschirmen gibt es den
      // Platz ohnehin -- dort waere das nur ein Klick, der nichts tut.
      if(t.classList.contains('is-active')){
        if(window.innerWidth <= 820) $('panel').classList.toggle('collapsed');
        return;
      }
      $('panel').classList.remove('collapsed');
      document.querySelectorAll('.tab').forEach(x => {
        const on = x === t;
        x.classList.toggle('is-active', on);
        x.setAttribute('aria-selected', String(on));
      });
      const id = 'panel' + t.dataset.tab.charAt(0).toUpperCase() + t.dataset.tab.slice(1);
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === id));
    });
  });




  // Suchen, Favoriten, Notizen
  $('suche').addEventListener('input', (e) => {
    suchText = e.target.value.trim().toLowerCase();
    renderGallery();
  });
  $('btnNurFavoriten').addEventListener('click', (e) => {
    nurFavoriten = !nurFavoriten;
    e.currentTarget.setAttribute('aria-pressed', String(nurFavoriten));
    renderGallery();
  });
  $('btnFavorit').addEventListener('click', (e) => {
    if(!current) return;
    current.favorit = !current.favorit;
    e.currentTarget.setAttribute('aria-pressed', String(current.favorit));
    e.currentTarget.textContent = current.favorit ? '★' : '☆';
    dirty = true; scheduleSave();
  });
  $('notiz').addEventListener('input', () => { dirty = true; scheduleSave(); });
  $('schlagworte').addEventListener('input', () => { dirty = true; scheduleSave(); });

  // Satz-Übersicht
  $('btnSetBack').addEventListener('click', closeSet);
  $('btnSetTryon').addEventListener('click', async () => { await saveNow(); openTryon(current && current.id); });

  // Grundfarbe
  $('baseColor').addEventListener('input', (e) => {
    ensureEditor().setBase(e.target.value);
    syncBaseColor();
    dirty = true; scheduleSave();
  });
  $('btnBaseNone').addEventListener('click', () => {
    const ed = ensureEditor();
    ed.setBase(ed.base ? null : ($('baseColor').value || NATURAL));
    syncBaseColor();
    dirty = true; scheduleSave();
  });

  $('btnCopyToAll').addEventListener('click', () => {
    askModal('Auf alle Nägel übertragen?',
      'Alle anderen Nägel dieses Entwurfs werden durch den aktuellen ersetzt.',
      'Übertragen', async () => {
        await stashNail();
        const quelle = current.nails[currentFinger];
        FINGER_KEYS.forEach(k => {
          if(k === currentFinger) return;
          current.nails[k] = {
            shape: quelle.shape,
            length: quelle.length,
            base: quelle.base,
            layers: quelle.layers.map(l => ({ ...l, pattern: l.pattern ? { ...l.pattern } : undefined }))
          };
        });
        await saveNow();
        toast('Auf alle Nägel übertragen');
      });
  });

  // Anprobe
  $('btnTryon').addEventListener('click', () => openTryon());
  $('btnTryonBack').addEventListener('click', closeTryon);
  $('btnLiveKamera').addEventListener('click', starteKamera);
  $('btnNochmal').addEventListener('click', starteKamera);
  $('btnPhotoLibrary2').addEventListener('click', () => $('filePhoto').click());
  ['filePhoto', 'filePhotoCam'].forEach(id => {
    $(id).addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if(f) loadPhoto(f);
    });
  });

  $('btnAnprobeSpeichern').addEventListener('click', speichereAnprobe);
  $('btnTryonShare').addEventListener('click', shareTryon);
  $('btnFormAnpassen').addEventListener('click', () => { setTryonModus('anpassen'); syncAnpassen(); });
  $('btnNachjustieren').addEventListener('click', () => { setTryonModus('justage'); renderNailChips(); });
  $('btnAnpassenFertig').addEventListener('click', () => setTryonModus('ergebnis'));
  $('btnJustageFertig').addEventListener('click', () => setTryonModus('ergebnis'));
  $('btnWieEntwurf').addEventListener('click', async () => { await tryon.setVorgabe(null); syncAnpassen(); });
  $('anpassenLaenge').addEventListener('input', async (e) => {
    const v = Object.assign({}, tryon.vorgabe || {}, { length: Number(e.target.value) / 100 });
    await tryon.setVorgabe(v);
    syncAnpassen();
  });

  $('btnTryonZoomIn').addEventListener('click', () => ensureTryon().zoomBy(1.3));
  $('btnTryonZoomOut').addEventListener('click', () => ensureTryon().zoomBy(0.77));
  $('btnTryonZoomReset').addEventListener('click', () => ensureTryon().resetView());

  const NUDGE = {
    left:['left',0], right:['right',0], up:['up',0], down:['down',0],
    bigger:['grow',0.06], smaller:['grow',-0.06],
    wider:['wider',0.06], narrower:['wider',-0.06],
    turnleft:['turn',-0.05], turnright:['turn',0.05]
  };
  let scopeAll = false;
  $('btnScope').addEventListener('click', (e) => {
    scopeAll = !scopeAll;
    e.currentTarget.setAttribute('aria-pressed', String(scopeAll));
    e.currentTarget.textContent = scopeAll ? 'alle Nägel' : 'nur dieser';
  });
  document.querySelectorAll('.nudge[data-nudge]').forEach(b => {
    b.addEventListener('click', () => {
      if(!tryon || (!scopeAll && !tryon.selectedNail)){ toast('Wähle zuerst einen Nagel'); return; }
      const key = b.dataset.nudge;
      if(key === 'forward'){ tryon.slide(0.12, scopeAll); return; }
      if(key === 'backward'){ tryon.slide(-0.12, scopeAll); return; }
      const [what, amount] = NUDGE[key];
      tryon.nudge(what, amount, scopeAll);
    });
  });

  $('btnRedetect').addEventListener('click', runDetection);
  $('btnManualNails').addEventListener('click', () => {
    const n = ensureTryon().addManualNails();
    renderNailChips();
    toast(n === 1 ? 'Nagel hinzugefügt – zieh ihn auf den Finger'
                  : 'Fünf Nägel gesetzt – zieh sie auf die Finger');
  });
  $('btnNailHide').addEventListener('click', () => {
    if(!tryon) return;
    tryon.toggleVisible();
    renderNailChips();
  });
  $('tryonOpacity').addEventListener('input', (e) => ensureTryon().setOpacity(Number(e.target.value) / 100));
  $('glossToggle').addEventListener('change', (e) => ensureTryon().setGloss(e.target.checked));
  $('schattenToggle').addEventListener('change', (e) => ensureTryon().setSchatten(e.target.checked));

  // Live-Kamera
  $('btnCamClose').addEventListener('click', () => { if(kamera) kamera.stop(); showView('tryon'); });
  $('btnCamFlip').addEventListener('click', async () => {
    const k = ensureKamera();
    try{ await k.start(k.facing === 'user' ? 'environment' : 'user'); }
    catch(e){ toast('Kamera lässt sich nicht wechseln'); }
  });
  $('btnCamAuto').addEventListener('click', (e) => {
    const k = ensureKamera();
    k.auto = !k.auto;
    e.currentTarget.setAttribute('aria-pressed', String(k.auto));
    e.currentTarget.textContent = k.auto ? 'Auto-Auslöser an' : 'Auto-Auslöser aus';
  });
  $('btnCamShot').addEventListener('click', () => { if(kamera) kamera.ausloesen(); });
  $('btnCamFotos').addEventListener('click', () => { if(kamera) kamera.stop(); showView('tryon'); $('filePhoto').click(); });

  // Anproben ansehen
  $('bildZu').addEventListener('click', () => { $('bildansicht').hidden = true; });

  // Modal
  $('modalCancel').addEventListener('click', closeModal);
  $('modalOk').addEventListener('click', () => { const fn = modalAction; closeModal(); if(fn) fn(); });
  $('modal').addEventListener('click', (e) => { if(e.target === $('modal')) closeModal(); });

  // Tastatur (Magic Keyboard am iPad, Desktop)
  document.addEventListener('keydown', (e) => {
    if(e.target.matches('input,textarea')) return;
    const mod = e.metaKey || e.ctrlKey;
    if(mod && e.key.toLowerCase() === 'z'){
      e.preventDefault();
      if(e.shiftKey) ensureEditor().redo(); else ensureEditor().undo();
    }
    if(e.key === 'Escape'){
      if(!$('modal').hidden) closeModal();
      else if(!$('viewEditor').hidden) closeEditor();
      else if(!$('viewSet').hidden) closeSet();
      else if(!$('viewCamera').hidden){ if(kamera) kamera.stop(); showView('tryon'); }
      else if(!$('viewTryon').hidden) closeTryon();
    }
  });

  // Nichts verlieren, wenn die App in den Hintergrund geht
  window.addEventListener('pagehide', () => { if(dirty) saveNow(); });
  document.addEventListener('visibilitychange', () => { if(document.hidden && dirty) saveNow(); });
}

async function init(){
  wire();
  buildShapeList();
  ensureEditor();
  buildPatterns();
  buildStamps();
  buildAnpassen();
  buildColorBar();
  buildPalette();
  setColor(PALETTE[0]);
  await renderGallery();
  purgeDeleted().catch(() => {});

  const emptyArt = $('emptyArt');
  if(emptyArt) emptyArt.innerHTML = shapeSvg('mandel');

  if('serviceWorker' in navigator && location.protocol === 'https:'){
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
