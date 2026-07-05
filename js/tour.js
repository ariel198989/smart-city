// Smart City — street tour: Street View embed, geotagged frame viewer,
// 🔴 LIVE TOUR: model runs on every frame, detections → map pins
import { DEFAULT_CITY } from './config.js';
import { fetchRoutes, fetchFrames, publicUrl, insertDetection, uploadBlob } from './db.js';
import { MODEL, onModel, detectOnDataURL, drawDetections, clsOf, cropDetection } from './infer.js';
import { initMiniMap, setMiniPos, onMiniClick, refreshMapData, MAPSTATE } from './map.js';
import { AUTH, requireAuth } from './auth.js';
import { $, toast, wireDrop, dataURLtoBlob } from './util.js';

const TOUR = {
  frames: [],        // [{id?, url, lat, lng, seq}]
  idx: 0,
  playing: false,
  live: false,
  routeName: '',
  savedKeys: new Set(),  // dedupe: class+rounded latlng already saved this session
};

export function initTour() {
  // sub tabs
  $('#ttStreet').onclick = () => switchTT('street');
  $('#ttFrames').onclick = () => switchTT('frames');
  setStreetView(DEFAULT_CITY.center_lat, DEFAULT_CITY.center_lng);

  $('#tourPrev').onclick = () => step(-1);
  $('#tourNext').onclick = () => step(1);
  $('#tourPlay').onclick = togglePlay;
  $('#liveBtn').onclick = toggleLive;

  onModel(() => {
    $('#liveModelState').innerHTML = MODEL.ready ? '<span class="status-dot live"></span>' + (MODEL.name || 'מודל טעון') : 'אין מודל';
    $('#liveBtn').disabled = !MODEL.ready || !TOUR.frames.length;
  });

  // manual upload of street photos
  wireDrop('tourDrop', handleTourUpload);
  $('#tourDrop').onclick = () => $('#tourFiles').click();
  $('#tourFiles').onchange = (e) => { handleTourUpload(e.target.files); e.target.value = ''; };

  loadRouteList();
}

export function openStreetViewAt(lat, lng) {
  switchView('tour');
  switchTT('street');
  setStreetView(lat, lng);
}

export async function openTourAtFrame(frameLike) {
  switchView('tour');
  switchTT('frames');
  if (frameLike.route_id) {
    await loadRoute(frameLike.route_id, frameLike.id);
  }
}

function switchView(name) {
  document.querySelector(`#mainTabs button[data-view="${name}"]`)?.click();
}

function switchTT(which) {
  $('#ttStreet').classList.toggle('on', which === 'street');
  $('#ttFrames').classList.toggle('on', which === 'frames');
  $('#svWrap').style.display = which === 'street' ? '' : 'none';
  $('#framesWrap').style.display = which === 'frames' ? '' : 'none';
  if (which === 'frames') setTimeout(() => initMiniMap().resize(), 60);
}

function setStreetView(lat, lng) {
  // keyless classic svembed
  $('#svFrame').src = `https://maps.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=11,0,0,0,0&output=svembed&hl=iw`;
}

// ---------- routes ----------
async function loadRouteList() {
  try {
    const routes = await fetchRoutes();
    const el = $('#routeList');
    if (!routes.length) return;
    el.innerHTML = '';
    routes.forEach((r) => {
      const d = document.createElement('div');
      d.className = 'rt';
      d.innerHTML = `<span class="n">${r.frame_count}📷</span><span></span>`;
      d.lastChild.textContent = r.name;
      d.onclick = () => { switchTT('frames'); loadRoute(r.id); };
      el.appendChild(d);
    });
  } catch (e) { console.warn(e); }
}

async function loadRoute(routeId, startFrameId = null) {
  try {
    $('#tourPos').textContent = 'טוען…';
    const frames = await fetchFrames(routeId);
    if (!frames.length) { toast('אין פריימים במסלול'); return; }
    TOUR.frames = frames.map((f) => ({ id: f.id, url: publicUrl(f.storage_path), lat: f.lat, lng: f.lng, seq: f.seq }));
    TOUR.idx = Math.max(0, startFrameId ? TOUR.frames.findIndex((f) => f.id === startFrameId) : 0);
    TOUR.routeName = '';
    initMiniMap();
    show(TOUR.idx);
    $('#liveBtn').disabled = !MODEL.ready;
  } catch (e) { toast('טעינת מסלול: ' + (e.message || e)); }
}

// ---------- manual street photos (MVP live tour source) ----------
async function handleTourUpload(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  switchTT('frames');
  initMiniMap();
  $('#tourUpState').innerHTML = `📍 <b>בחרו נקודה במיני-מפה</b> — איפה צולמו התמונות?`;
  toast('בחרו נקודה במיני-מפה למיקום התמונות', true);
  const point = await new Promise((res) => onMiniClick((lat, lng) => { onMiniClick(null); res({ lat, lng }); }));
  const urls = await Promise.all(files.map((f) => new Promise((res) => {
    const r = new FileReader();
    r.onload = (ev) => {
      const im = new Image();
      im.onload = () => {
        const maxW = 900;
        const w = Math.min(im.naturalWidth, maxW), h = Math.round(im.naturalHeight * w / im.naturalWidth);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(im, 0, 0, w, h);
        res(cv.toDataURL('image/jpeg', 0.85));
      };
      im.src = ev.target.result;
    };
    r.readAsDataURL(f);
  })));
  // spread points slightly so pins don't stack (≈8m apart)
  TOUR.frames = urls.map((url, i) => ({
    url, lat: point.lat + 0.00007 * i, lng: point.lng + 0.00004 * i, seq: i,
  }));
  TOUR.idx = 0;
  $('#tourUpState').textContent = `✅ ${urls.length} תמונות מוכנות לסיור`;
  show(0);
  $('#liveBtn').disabled = !MODEL.ready;
}

// ---------- viewer ----------
async function show(i) {
  if (!TOUR.frames.length) return;
  TOUR.idx = (i + TOUR.frames.length) % TOUR.frames.length;
  const f = TOUR.frames[TOUR.idx];
  const stage = $('#tourStage');
  stage.innerHTML = `<img id="tourImg"><canvas id="tourOverlay"></canvas>`;
  const img = $('#tourImg');
  img.src = f.url;
  await new Promise((r) => { if (img.complete) r(); else img.onload = r; });
  const cv = $('#tourOverlay');
  cv.width = img.clientWidth; cv.height = img.clientHeight;
  $('#tourPos').textContent = `${TOUR.idx + 1} / ${TOUR.frames.length}`;
  setMiniPos(f.lat, f.lng);
  if (TOUR.live) await liveDetect(f, cv);
}

function step(dir) { show(TOUR.idx + dir); }

function togglePlay() {
  TOUR.playing = !TOUR.playing;
  $('#tourPlay').textContent = TOUR.playing ? '⏸ עצור' : '▶ נגן';
  if (TOUR.playing) playLoop();
}

async function playLoop() {
  while (TOUR.playing && TOUR.frames.length) {
    await show(TOUR.idx + 1);
    await new Promise((r) => setTimeout(r, TOUR.live ? 350 : 900));
    if (TOUR.idx === TOUR.frames.length - 1 && !TOUR.live) break;
  }
  TOUR.playing = false;
  $('#tourPlay').textContent = '▶ נגן';
}

// ---------- 🔴 live tour ----------
function toggleLive() {
  if (!MODEL.ready) { toast('טענו מודל בסטודיו קודם'); return; }
  if (!TOUR.live && !AUTH.user) { requireAuth(); return; }
  TOUR.live = !TOUR.live;
  $('#liveBtn').textContent = TOUR.live ? '⏹ עצור סיור חי' : '🔴 סיור חי';
  $('#liveFeedCard').style.display = TOUR.live ? '' : 'none';
  if (TOUR.live) { $('#liveFeed').innerHTML = ''; show(TOUR.idx); }
}

async function liveDetect(f, overlay) {
  const stage = $('#tourStage');
  stage.classList.add('scanning');
  try {
    const conf = parseFloat($('#liveConf').value) || 0.35;
    // remote frames must go through canvas → dataURL (public bucket = CORS ok)
    const durl = f.url.startsWith('data:') ? f.url : await toDataURL(f.url);
    const { boxes } = await detectOnDataURL(durl, conf);
    drawDetections(overlay, boxes);
    for (const b of boxes) await saveLiveDetection(f, b, durl);
  } catch (e) { console.warn('live detect', e); }
  stage.classList.remove('scanning');
}

async function toDataURL(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  cv.getContext('2d').drawImage(img, 0, 0);
  return cv.toDataURL('image/jpeg', 0.85);
}

async function saveLiveDetection(f, b, durl) {
  const cl = clsOf(b.cls);
  // session dedupe — same class within ~20m → skip
  const key = `${cl.name}_${f.lat.toFixed(4)}_${f.lng.toFixed(4)}`;
  if (TOUR.savedKeys.has(key)) return;
  TOUR.savedKeys.add(key);
  try {
    const cropURL = await cropDetection(durl, b);
    const path = `crops/c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;  // ASCII-only key
    await uploadBlob(path, dataURLtoBlob(cropURL), 'image/jpeg');
    await insertDetection({
      frame_id: f.id || null,
      lat: f.lat, lng: f.lng,
      class_name: cl.name,
      confidence: b.score,
      crop_path: path,
      detected_by: AUTH.user?.id || null,
      team_name: AUTH.team || null,
    });
    // feed
    const el = document.createElement('div');
    el.className = 'lf';
    el.innerHTML = `<img src="${cropURL}"><div><b></b><div class="muted" style="font-size:11px">${Math.round(b.score * 100)}% · נשמר במפה 📍</div></div>`;
    el.querySelector('b').textContent = cl.name;
    $('#liveFeed').prepend(el);
    refreshMapData();
  } catch (e) { console.warn('save detection', e); }
}
