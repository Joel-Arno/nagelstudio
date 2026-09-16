/**
 * Verdrahtung der Oberflaeche: Galerie, Editor, Speichern, Austausch.
 */

import { SHAPES, shapeSvg, shapeById } from './shapes.js';
import { NailEditor, IMG_W, IMG_H } from './draw.js';
import {
  emptyDesign, putDesign, getDesign, listDesigns, deleteDesign, purgeDeleted,
  canvasToImage, imageToUrl, releaseUrl, loadImage,
  exportDesigns, mergeDesigns, shareFile, storageEstimate
} from './store.js';

const $ = (id) => document.getElementById(id);

const PALETTE = [
  '#D8456B','#B3123C','#7C1034','#E2727F','#F2A0B8','#F7D6DD',
  '#C4622D','#E8A33D','#E8C07D','#F6E7C8','#FFFFFF','#F3EDE4',
  '#6C8E6A','#2F6F62','#2B4C5C','#4A3F8F','#7A3CFF','#1C1A1E'
];

const RECENT_KEY = 'nagelstudio.farben';

let editor = null;
let current = null;          // aktuell offener Entwurf
let saveTimer = null;
let dirty = false;
let recent = loadRecent();

/* ================= Galerie ================= */

function formatDate(ts){
  const d = new Date(ts);
  const heute = new Date();
  const sameDay = d.toDateString() === heute.toDateString();
  if(sameDay) return 'heute ' + d.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' });
  return d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'2-digit' });
}

async function renderGallery(){
  const designs = await listDesigns();
  const grid = $('galleryGrid');
  grid.querySelectorAll('img').forEach(img => releaseUrl(img.src));
  grid.innerHTML = '';
  $('emptyGallery').hidden = designs.length > 0;

  for(const d of designs){
    const card = document.createElement('article');
    card.className = 'card';

    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'card-preview';
    preview.setAttribute('aria-label', 'Entwurf ' + (d.name || 'ohne Namen') + ' öffnen');
    const img = document.createElement('img');
    img.alt = '';
    img.src = d.thumb ? imageToUrl(d.thumb) : placeholderThumb(d.shape);
    preview.appendChild(img);
    preview.addEventListener('click', () => openDesign(d.id));

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const name = document.createElement('p');
    name.className = 'card-name';
    name.textContent = d.name || 'Ohne Namen';
    const date = document.createElement('span');
    date.className = 'card-date';
    date.textContent = shapeById(d.shape).name + ' · ' + formatDate(d.updatedAt);
    meta.append(name, date);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.append(
      actionBtn('Kopie', () => duplicateDesign(d)),
      actionBtn('Teilen', () => shareDesigns([d], (d.name || 'entwurf'))),
      actionBtn('Löschen', () => confirmDelete(d), 'del')
    );

    card.append(preview, meta, actions);
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
  editor.onChange = () => { dirty = true; scheduleSave(); refreshLayerList(); };
  editor.onHistory = () => {
    $('btnUndo').disabled = !editor.canUndo();
    $('btnRedo').disabled = !editor.canRedo();
  };
  return editor;
}

async function openDesign(id){
  const design = await getDesign(id);
  if(!design) return;
  const ed = ensureEditor();

  const urls = [];
  const images = [];
  for(const l of design.layers || []){
    const url = imageToUrl(l.image);
    urls.push(url);
    try{ images.push(url ? await loadImage(url) : null); }
    catch(e){ images.push(null); }
  }

  current = design;
  ed.loadDesign(design, images);
  urls.forEach(releaseUrl);

  $('designName').value = design.name || '';
  showView('editor');
  syncShapeList();
  refreshLayerList();
  ed.onHistory();
  dirty = false;
  requestAnimationFrame(() => ed.render());
  fadeHint();
}

async function newDesign(){
  const d = emptyDesign('mandel');
  d.name = '';
  await putDesign(d);
  const ed = ensureEditor();
  current = d;
  ed.loadDesign(d, []);            // legt die erste Ebene selbst an
  $('designName').value = '';
  showView('editor');
  syncShapeList();
  refreshLayerList();
  ed.onHistory();
  dirty = false;
  requestAnimationFrame(() => ed.render());
  fadeHint();
}

async function duplicateDesign(d){
  const full = await getDesign(d.id);
  if(!full) return;
  const copy = emptyDesign(full.shape);
  copy.name = (full.name || 'Ohne Namen') + ' (Kopie)';
  copy.layers = (full.layers || []).map(l => ({ ...l }));
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
  $('viewEditor').hidden = which !== 'editor';
}

async function closeEditor(){
  const ed = ensureEditor();
  const name = $('designName').value.trim();
  if(current && !name && ed.isEmpty()){
    await deleteDesign(current.id);      // leerer Entwurf, nicht aufbewahren
    current = null;
  }else{
    await saveNow();
  }
  showView('gallery');
  await renderGallery();
}

/* ---------- Speichern ---------- */

function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1200);
}

async function saveNow(){
  clearTimeout(saveTimer);
  if(!current || !editor) return;
  const layers = [];
  for(const l of editor.layerData()){
    layers.push({
      id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
      image: await canvasToImage(l.canvas)
    });
  }
  current.layers = layers;
  current.shape = editor.shape;
  current.name = $('designName').value.trim();
  current.thumb = await canvasToImage(editor.thumbnail(220));
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

function setColor(c){
  ensureEditor().setColor(c);
  $('colorPicker').value = c;
  if(editor.tool === 'eraser') selectTool('brush');
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
      // Zeichenflaeche den Platz.
      if(t.classList.contains('is-active')){
        $('panel').classList.toggle('collapsed');
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
