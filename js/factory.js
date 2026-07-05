// Smart City — data factory (admin): drive video + GPX → sharp geotagged
// frames → Supabase Storage + sc_frames rows
import { BUCKET } from './config.js';
import { sb, fetchRoutes, insertRoute, insertFrames, uploadBlob } from './db.js';
import { extractFrames } from './video.js';
import { AUTH } from './auth.js';
import { MAPSTATE, refreshMapData } from './map.js';
import { $, toast, dataURLtoBlob, fmtWhen } from './util.js';

const FAC = { video: null, gpx: null, points: [] };

export function initFactory() {
  $('#facVideoBtn').onclick = () => $('#facVideo').click();
  $('#facGpxBtn').onclick = () => $('#facGpx').click();
  $('#facVideo').onchange = (e) => { FAC.video = e.target.files[0] || null; updateState(); };
  $('#facGpx').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      FAC.points = parseGPX(await f.text());
      FAC.gpx = f;
      if (!FAC.points.length) throw new Error('לא נמצאו נקודות במסלול (trkpt)');
      updateState();
    } catch (err) { toast('GPX: ' + (err.message || err)); FAC.gpx = null; FAC.points = []; }
  };
  $('#facGo').onclick = processRoute;
  loadFacRoutes();
}

function updateState() {
  const ok = FAC.video && FAC.points.length;
  $('#facGo').disabled = !ok;
  $('#facState').textContent = ok
    ? `✓ מוכן: ${Math.round(FAC.video.size / 1e6)}MB · ${FAC.points.length} נק׳ GPS`
    : FAC.video ? 'עכשיו GPX' : FAC.points.length ? 'עכשיו סרטון' : 'בחרו סרטון + GPX';
  if (FAC.points.length) {
    const p0 = FAC.points[0], p1 = FAC.points[FAC.points.length - 1];
    const durS = (p1.time - p0.time) / 1000;
    $('#facInfo').textContent = `מסלול GPS: ${FAC.points.length} נקודות · ${isFinite(durS) ? Math.round(durS) + ' שניות' : 'ללא זמנים (יפוזר לפי מרחק)'}`;
  }
}

// GPX → [{lat, lng, time(ms) | null}]
export function parseGPX(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('קובץ GPX לא תקין');
  const pts = [...doc.querySelectorAll('trkpt, rtept, wpt')].map((pt) => {
    const t = pt.querySelector('time');
    return {
      lat: parseFloat(pt.getAttribute('lat')),
      lng: parseFloat(pt.getAttribute('lon')),
      time: t ? Date.parse(t.textContent) : null,
    };
  }).filter((p) => isFinite(p.lat) && isFinite(p.lng));
  return pts;
}

// interpolate position at fraction u∈[0,1] of the track
// (time-weighted when timestamps exist, index-weighted otherwise)
export function interpolate(points, u) {
  if (points.length === 1) return { ...points[0], heading: 0 };
  const hasTime = points[0].time != null && points[points.length - 1].time != null && points[points.length - 1].time > points[0].time;
  let idxF;
  if (hasTime) {
    const t0 = points[0].time, t1 = points[points.length - 1].time;
    const target = t0 + u * (t1 - t0);
    let i = points.findIndex((p) => p.time >= target);
    if (i <= 0) i = 1;
    const a = points[i - 1], b = points[i];
    const f = b.time > a.time ? (target - a.time) / (b.time - a.time) : 0;
    return lerpPt(a, b, f);
  }
  idxF = u * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(idxF));
  return lerpPt(points[i], points[i + 1], idxF - i);
}
function lerpPt(a, b, f) {
  const lat = a.lat + (b.lat - a.lat) * f;
  const lng = a.lng + (b.lng - a.lng) * f;
  const heading = Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180 / Math.PI;
  return { lat, lng, heading: (heading + 360) % 360 };
}

async function processRoute() {
  const name = $('#routeName').value.trim() || 'מסלול ' + new Date().toLocaleDateString('he-IL');
  const want = parseInt($('#facCount').value) || 80;
  const bar = $('#facBar'), fill = $('#facBarFill'), lbl = $('#facBarLbl');
  bar.style.display = ''; fill.style.width = '2%'; lbl.textContent = 'מחלץ פריימים…';
  $('#facGo').disabled = true;
  try {
    // 1. sharp frames with timestamps
    const { frames, duration } = await extractFrames(FAC.video, {
      want, sharpOnly: true, maxW: 960,
      onProgress: (d, t) => { fill.style.width = Math.round(d / t * 40) + '%'; lbl.textContent = `סורק ${d}/${t}`; },
    });
    // 2. route row
    const cityId = MAPSTATE.city?.id || null;
    const route = await insertRoute({ city_id: cityId, name, uploaded_by: AUTH.user.id, frame_count: frames.length, gpx: null });
    // 3. geotag (frame time fraction ↔ GPX track fraction) + upload
    const rows = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const pos = interpolate(FAC.points, Math.min(1, f.t / duration));
      const path = `frames/${route.id}/f_${String(i).padStart(4, '0')}.jpg`;  // ASCII-only key
      await uploadBlob(path, dataURLtoBlob(f.url), 'image/jpeg');
      rows.push({
        route_id: route.id, storage_path: path,
        lat: pos.lat, lng: pos.lng, heading: pos.heading, seq: i,
      });
      fill.style.width = (40 + Math.round((i + 1) / frames.length * 55)) + '%';
      lbl.textContent = `מעלה ${i + 1}/${frames.length}`;
    }
    // 4. insert rows (batched)
    for (let i = 0; i < rows.length; i += 100) await insertFrames(rows.slice(i, i + 100));
    fill.style.width = '100%'; lbl.textContent = '✓';
    toast(`המסלול "${name}" עלה: ${frames.length} פריימים ממופים 🛰️`, true);
    FAC.video = null; FAC.points = []; FAC.gpx = null;
    $('#routeName').value = '';
    updateState();
    loadFacRoutes();
    refreshMapData();
  } catch (e) {
    console.error(e);
    toast('מפעל: ' + (e.message || e));
    $('#facGo').disabled = false;
  }
}

async function loadFacRoutes() {
  try {
    const routes = await fetchRoutes();
    const el = $('#facRoutes');
    if (!routes.length) { el.innerHTML = '<span class="muted" style="font-size:13px">אין עדיין מסלולים.</span>'; return; }
    el.innerHTML = '';
    routes.forEach((r) => {
      const d = document.createElement('div');
      d.className = 'pool-row';
      d.innerHTML = `<div class="meta"><div class="nm"></div><div class="cls"></div></div>
        <button class="ghost fdel" style="color:var(--danger);font-size:12px">מחק</button>`;
      d.querySelector('.nm').textContent = r.name;
      d.querySelector('.cls').textContent = `${r.frame_count} פריימים · ${fmtWhen(r.created_at)}`;
      d.querySelector('.fdel').onclick = async () => {
        if (!confirm(`למחוק את "${r.name}" וכל הפריימים שלו?`)) return;
        const del = await sb.from('sc_routes').delete().eq('id', r.id);
        if (del.error) toast(del.error.message);
        else { loadFacRoutes(); refreshMapData(); }
      };
      el.appendChild(d);
    });
  } catch (e) { console.warn(e); }
}
