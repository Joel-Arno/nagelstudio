/**
 * Verdrahtung der Oberflaeche: Galerie, Editor, Speichern, Austausch.
 */

import { SHAPES, shapeSvg, shapeById } from './shapes.js';
import { NailEditor, IMG_W, IMG_H } from './draw.js';
import { TryOn } from './tryon.js';
import {
  emptyDesign, putDesign, getDesign, listDesigns, deleteDesign, purgeDeleted,
  canvasToImage, imageToUrl, releaseUrl, loadImage,
  exportDesigns, mergeDesigns, shareFile, shareBlob, storageEstimate,
  FINGER_KEYS, FINGER_NAMES, NATURAL
} from './store.js';
import { designTexture, setThumbnail, forgetTextures, SET_LAYOUT } from './compose.js';
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
    shapeSvg(shape, '#3B303A').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') + '</svg>';
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

    const w = Math.round(nailW * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = Math.round(w * IMG_H / IMG_W);
    const tex = await designTexture(current, key);
    canvas.getContext('2d').drawImage(tex, 0, 0, canvas.width, canvas.height);

    canvas.style.transform = 'rotate(' + tilt.toFixed(3) + 'rad)';
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
      image: await canvasToImage(l.canvas)
    });
  }
  current.nails[currentFinger] = { shape: editor.shape, base: editor.base, layers };
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
    b.innerHTML = shapeSvg(s.id) + '<span>' + s.name + '</span>';
    b.addEventListener('click', () => {
      editor.setShape(s.id);
      syncShapeList();
      dirty = true; scheduleSave();
    });
    box.appendChild(b);
  });
}

function syncShapeList(){
  document.querySelectorAll('.shape-item').forEach(b => {
    b.classList.toggle('is-active', b.dataset.shape === (editor ? editor.shape : ''));
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

function ensureTryon(){
  if(tryon) return tryon;
  tryon = new TryOn($('tryonCanvas'));
  tryon.onChange = () => renderNailChips();
  return tryon;
}

function tryonStatus(text){
  const el = $('tryonStatus');
  if(!text){ el.hidden = true; return; }
  el.hidden = false;
  el.textContent = text;
}

async function openTryon(){
  const t = ensureTryon();
  const designs = await listDesigns();
  if(!designs.length){
    toast('Zeichne zuerst einen Entwurf – den kannst du dann anprobieren');
    return;
  }
  t.setDesigns(designs);
  showView('tryon');
  renderDesignStrip(designs);
  renderNailChips();
  requestAnimationFrame(() => t.render());
}

async function loadPhoto(file){
  const t = ensureTryon();
  const url = URL.createObjectURL(file);
  tryonUrls.push(url);
  try{
    const img = await loadImage(url);
    await t.setPhoto(img);
    $('tryonEmpty').hidden = true;
    $('tryonBar').hidden = false;
    $('btnTryonShare').disabled = false;
    await runDetection();
  }catch(err){
    toast('Foto konnte nicht geladen werden');
  }
}

async function runDetection(){
  const t = ensureTryon();
  try{
    tryonStatus('Erkennung wird vorbereitet …');
    const res = await t.detect(tryonStatus);
    tryonStatus(null);
    if(!res.nails){
      toast('Keine Hand erkannt – setze die Nägel von Hand');
      return;
    }
    // Zuletzt geänderten Entwurf gleich auflegen, damit sofort etwas zu sehen ist
    const designs = await listDesigns();
    if(designs.length) await t.assignAll(designs[0].id);
    renderNailChips();
    renderDesignStrip(designs);
    toast(res.hands + (res.hands === 1 ? ' Hand' : ' Hände') + ' erkannt · ' + res.nails + ' Nägel');
  }catch(err){
    tryonStatus(null);
    toast('Erkennung fehlgeschlagen: ' + (err.message || 'unbekannter Fehler'));
  }
}

function renderNailChips(){
  const box = $('nailChips');
  if(!tryon) return;
  box.innerHTML = '';
  const mehrereHaende = new Set(tryon.nails.map(n => n.hand)).size > 1;
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
  $('nudgeBar').hidden = !tryon.nails.length;
  $('btnManualNails').textContent = tryon.nails.length ? 'Nagel hinzufügen' : 'Von Hand setzen';
}

function renderDesignStrip(designs){
  const box = $('designStrip');
  box.querySelectorAll('img').forEach(img => releaseUrl(img.src));
  box.innerHTML = '';
  const sel = tryon ? tryon.selectedNail : null;
  designs.forEach(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'design-tile' + (sel && sel.designId === d.id ? ' is-active' : '');
    const img = document.createElement('img');
    img.alt = '';
    img.src = d.thumb ? imageToUrl(d.thumb) : placeholderThumb(d.shape);
    const name = document.createElement('span');
    name.textContent = d.name || 'Ohne Namen';
    b.append(img, name);
    b.addEventListener('click', async () => {
      // Ein Entwurf ist ein ganzer Satz -- er wird auf alle Nägel gelegt,
      // jeder Finger bekommt dabei seinen eigenen Nagel.
      await tryon.assignAll(d.id);
      renderDesignStrip(designs);
      renderNailChips();
      toast('„' + (d.name || 'Ohne Namen') + '“ aufgelegt');
    });
    box.appendChild(b);
  });
}

async function shareTryon(){
  if(!tryon || !tryon.photo) return;
  tryonStatus('Bild wird erzeugt …');
  const canvas = tryon.exportImage();
  canvas.toBlob(async (blob) => {
    tryonStatus(null);
    if(!blob){ toast('Bild konnte nicht erzeugt werden'); return; }
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
                + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    const res = await shareBlob('anprobe-' + stamp + '.jpg', blob);
    if(res === 'gespeichert') toast('Bild gespeichert');
    else if(res === 'geteilt') toast('Geteilt');
  }, 'image/jpeg', 0.92);
}

function closeTryon(){
  tryonUrls.forEach(releaseUrl);
  tryonUrls = [];
  showView('gallery');
  renderGallery();
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
  $('btnSetTryon').addEventListener('click', async () => { await saveNow(); openTryon(); });

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
            base: quelle.base,
            layers: quelle.layers.map(l => ({ ...l }))
          };
        });
        await saveNow();
        toast('Auf alle Nägel übertragen');
      });
  });

  // Anprobe
  $('btnTryon').addEventListener('click', openTryon);
  $('btnTryonBack').addEventListener('click', closeTryon);
  $('btnPhotoLibrary').addEventListener('click', () => $('filePhoto').click());
  $('btnPhotoLibrary2').addEventListener('click', () => $('filePhoto').click());
  $('btnPhotoCamera').addEventListener('click', () => $('filePhotoCam').click());
  $('btnPhotoCamera2').addEventListener('click', () => $('filePhotoCam').click());
  ['filePhoto', 'filePhotoCam'].forEach(id => {
    $(id).addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if(f) loadPhoto(f);
    });
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
  $('btnApplyAll').addEventListener('click', async () => {
    const sel = tryon && tryon.selectedNail;
    if(!sel || !sel.designId){ toast('Lege zuerst einen Entwurf auf'); return; }
    await tryon.assignAll(sel.designId);
    renderNailChips();
    toast('Auf alle Nägel übertragen');
  });
  $('btnNailHide').addEventListener('click', () => {
    if(!tryon) return;
    tryon.toggleVisible();
    renderNailChips();
  });
  $('tryonOpacity').addEventListener('input', (e) => ensureTryon().setOpacity(Number(e.target.value) / 100));
  $('glossToggle').addEventListener('change', (e) => ensureTryon().setGloss(e.target.checked));
  $('btnTryonShare').addEventListener('click', shareTryon);

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
