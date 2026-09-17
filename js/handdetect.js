/**
 * Handerkennung und daraus abgeleitete Nagelflaechen.
 *
 * MediaPipe erkennt Fingergelenke, keine Naegel. Die Nagelflaeche wird aus
 * dem letzten Fingerglied geschaetzt: Richtung und Laenge vom mittleren
 * Gelenk zur Fingerspitze geben Lage und Groesse vor. Das trifft es gut,
 * solange die Hand halbwegs flach zur Kamera steht -- deshalb laesst sich
 * in der Anprobe jeder Nagel von Hand nachziehen.
 */

// Pfade relativ zu diesem Modul aufloesen, nicht zur aufrufenden Seite --
// so stimmen sie unabhaengig davon, von wo die App geladen wurde.
const ROOT = new URL('../', import.meta.url);
const LIB = new URL('vendor/mediapipe/vision_bundle.mjs', ROOT).href;
const WASM_DIR = new URL('vendor/mediapipe/wasm', ROOT).href;
const MODEL = new URL('models/hand_landmarker.task', ROOT).href;

export const FINGERS = [
  { key:'daumen',      name:'Daumen',          dip:3,  tip:4,  mcp:2,  widthK:0.80, lenK:0.82 },
  { key:'zeigefinger', name:'Zeigefinger',     dip:7,  tip:8,  mcp:6,  widthK:0.70, lenK:0.88 },
  { key:'mittelfinger',name:'Mittelfinger',    dip:11, tip:12, mcp:10, widthK:0.70, lenK:0.88 },
  { key:'ringfinger',  name:'Ringfinger',      dip:15, tip:16, mcp:14, widthK:0.68, lenK:0.88 },
  { key:'kleiner',     name:'Kleiner Finger',  dip:19, tip:20, mcp:18, widthK:0.64, lenK:0.84 }
];

let landmarker = null;
let loading = null;

/** Laedt Bibliothek und Modell. Mehrfache Aufrufe teilen sich den Ladevorgang. */
export function loadDetector(onStatus){
  if(landmarker) return Promise.resolve(landmarker);
  if(loading) return loading;

  loading = (async () => {
    if(onStatus) onStatus({ text:'Erkennung wird vorbereitet …' });
    const vision = await import(LIB);
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_DIR);

    // Das Modell selbst laden, damit der Fortschritt sichtbar ist -- beim
    // ersten Mal sind es rund 8 MB, danach kommt es aus dem Zwischenspeicher.
    const buffer = await ladeModell(onStatus);

    if(onStatus) onStatus({ text:'Erkennung wird gestartet …' });
    landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: buffer ? { modelAssetBuffer: buffer } : { modelAssetPath: MODEL },
      runningMode: 'IMAGE',
      numHands: 2,
      minHandDetectionConfidence: 0.35,
      minHandPresenceConfidence: 0.35,
      minTrackingConfidence: 0.35
    });
    return landmarker;
  })();

  loading.catch(() => { loading = null; });
  return loading;
}

/** Laedt die Modelldatei mit Fortschrittsmeldung. */
async function ladeModell(onStatus){
  try{
    const res = await fetch(MODEL);
    if(!res.ok || !res.body) return null;
    const gesamt = Number(res.headers.get('content-length')) || 0;
    const teile = [];
    let geladen = 0;
    const reader = res.body.getReader();
    for(;;){
      const { done, value } = await reader.read();
      if(done) break;
      teile.push(value);
      geladen += value.length;
      if(onStatus){
        onStatus(gesamt
          ? { text:'Erkennung wird geladen …', anteil: geladen / gesamt }
          : { text:'Erkennung wird geladen … ' + (geladen / 1048576).toFixed(1) + ' MB' });
      }
    }
    const buf = new Uint8Array(geladen);
    let pos = 0;
    for(const t of teile){ buf.set(t, pos); pos += t.length; }
    return buf;
  }catch(e){
    return null;     // dann laedt MediaPipe das Modell selbst
  }
}

export function detectorReady(){ return !!landmarker; }

function vec(a, b){ return { x: b.x - a.x, y: b.y - a.y }; }
function len(v){ return Math.hypot(v.x, v.y); }

/**
 * Nagelflaeche eines Fingers als Viereck
 * [Spitze-links, Spitze-rechts, Basis-rechts, Basis-links] in Bildpixeln.
 */
export function nailQuad(landmarks, finger, width, height){
  const dip = landmarks[finger.dip];
  const tip = landmarks[finger.tip];
  if(!dip || !tip) return null;

  const p1 = { x: dip.x * width, y: dip.y * height };
  const p2 = { x: tip.x * width, y: tip.y * height };
  const d = vec(p1, p2);
  const L = len(d);
  if(L < 4) return null;

  const u = { x: d.x / L, y: d.y / L };          // Richtung zur Fingerspitze
  const n = { x: -u.y, y: u.x };                 // quer dazu

  const nailLen = L * finger.lenK;
  const nailW = L * finger.widthK;

  // Der Nagel endet ein Stueck vor der Fingerkuppe
  const center = {
    x: p2.x - u.x * (nailLen * 0.52),
    y: p2.y - u.y * (nailLen * 0.52)
  };
  const tipMid = { x: center.x + u.x * nailLen / 2, y: center.y + u.y * nailLen / 2 };
  const baseMid = { x: center.x - u.x * nailLen / 2, y: center.y - u.y * nailLen / 2 };

  return [
    { x: tipMid.x - n.x * nailW / 2,  y: tipMid.y - n.y * nailW / 2 },
    { x: tipMid.x + n.x * nailW / 2,  y: tipMid.y + n.y * nailW / 2 },
    { x: baseMid.x + n.x * nailW / 2, y: baseMid.y + n.y * nailW / 2 },
    { x: baseMid.x - n.x * nailW / 2, y: baseMid.y - n.y * nailW / 2 }
  ];
}

/** Erkennt Haende in einem Bild und liefert fertige Nagelflaechen. */
export async function detectNails(image, width, height){
  const det = await loadDetector();
  const res = det.detect(image);
  const hands = [];

  (res.landmarks || []).forEach((landmarks, i) => {
    const hd = res.handedness && res.handedness[i] && res.handedness[i][0];
    const side = hd ? hd.categoryName : 'Right';
    // MediaPipes Links/Rechts-Angabe setzt ein gespiegeltes Selfie-Bild
    // voraus und liegt bei normalen Fotos oft daneben -- sie wird deshalb
    // nur durchgereicht, benannt werden die Haende nach ihrer Lage im Bild.
    hands.push({
      side,
      mittelX: landmarks.reduce((a, l) => a + l.x, 0) / landmarks.length,
      score: hd ? hd.score : 0,
      landmarks,
      nails: FINGERS.map(f => {
        const quad = nailQuad(landmarks, f, width, height);
        return quad ? { finger: f.key, name: f.name, quad, visible: true, designId: null } : null;
      }).filter(Boolean)
    });
  });

  return hands;
}
