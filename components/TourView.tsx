'use client';
import { useEffect, useRef, useState } from 'react';
import { MAP_STYLE, DEFAULT_CITY } from '@/lib/config';
import { fetchRoutes, fetchFrames, publicUrl, insertDetection, uploadBlob } from '@/lib/db';
import { modelStore, detectOnDataURL, drawDetections, clsOf, cropDetection, type Box } from '@/lib/infer';
import { authStore } from '@/lib/auth';
import { useStore, toast, bumpData } from '@/lib/store';
import { dataURLtoBlob, urlToDataURL, fileToDataURL } from '@/lib/util';

// optional Google Maps Embed API key → enables inline Street View.
// keyless embeds were deprecated by Google, so without a key we fall back
// to opening the real pano in a new tab.
const GMAPS_KEY = process.env.NEXT_PUBLIC_GMAPS_KEY || '';

export type TourTarget =
  | { kind: 'street'; lat: number; lng: number; at: number }
  | { kind: 'route'; routeId: string; frameId?: string; at: number };

interface TFrame { id?: string; url: string; lat: number; lng: number; seq: number }
interface FeedItem { crop: string; name: string; score: number; at: number }

export default function TourView({ target }: { target: TourTarget | null }) {
  const model = useStore(modelStore);
  const auth = useStore(authStore);
  const [tab, setTab] = useState<'street' | 'frames'>('street');
  const [sv, setSv] = useState({ lat: DEFAULT_CITY.center_lat, lng: DEFAULT_CITY.center_lng });
  const [routes, setRoutes] = useState<any[]>([]);
  const [frames, setFrames] = useState<TFrame[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [live, setLive] = useState(false);
  const [conf, setConf] = useState('0.35');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [upMsg, setUpMsg] = useState('');
  const [scanning, setScanning] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const miniEl = useRef<HTMLDivElement>(null);
  const miniRef = useRef<any>(null);
  const miniMarker = useRef<any>(null);
  const miniClick = useRef<((lat: number, lng: number) => void) | null>(null);
  const savedKeys = useRef(new Set<string>());
  const stateRef = useRef({ frames, idx, live, playing, conf });
  stateRef.current = { frames, idx, live, playing, conf };

  useEffect(() => { fetchRoutes().then(setRoutes).catch(() => {}); }, []);

  // handle external target (map interactions)
  useEffect(() => {
    if (!target) return;
    if (target.kind === 'street') {
      setTab('street');
      setSv({ lat: target.lat, lng: target.lng });
    } else {
      setTab('frames');
      loadRoute(target.routeId, target.frameId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.at]);

  // mini map init (frames tab)
  useEffect(() => {
    if (tab !== 'frames' || miniRef.current || !miniEl.current) return;
    let disposed = false;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      if (disposed || !miniEl.current || miniRef.current) return;
      const m = new maplibregl.Map({
        container: miniEl.current, style: MAP_STYLE as any,
        center: [DEFAULT_CITY.center_lng, DEFAULT_CITY.center_lat], zoom: 13,
        attributionControl: false,
      });
      m.on('click', (e: any) => miniClick.current?.(e.lngLat.lat, e.lngLat.lng));
      miniRef.current = { m, maplibregl };
    })();
    return () => { disposed = true; };
  }, [tab]);

  function setMiniPos(lat: number, lng: number) {
    const mm = miniRef.current;
    if (!mm) return;
    if (!miniMarker.current) {
      const el = document.createElement('div');
      el.className = 'pin';
      el.style.color = '#35E1FF';
      miniMarker.current = new mm.maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(mm.m);
    } else miniMarker.current.setLngLat([lng, lat]);
    mm.m.easeTo({ center: [lng, lat], duration: 500 });
  }

  async function loadRoute(routeId: string, frameId?: string) {
    try {
      const fr = await fetchFrames(routeId);
      if (!fr.length) { toast('אין פריימים במסלול'); return; }
      const list: TFrame[] = fr.map((f: any) => ({ id: f.id, url: publicUrl(f.storage_path), lat: f.lat, lng: f.lng, seq: f.seq }));
      setFrames(list);
      const start = frameId ? Math.max(0, list.findIndex((f) => f.id === frameId)) : 0;
      setIdx(start);
      setTab('frames');
    } catch (e: any) { toast('טעינת מסלול: ' + (e.message || e)); }
  }

  async function handleUpload(fileList: FileList | File[]) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    setTab('frames');
    setUpMsg('בחרו נקודה במיני-מפה — איפה צולמו התמונות?');
    toast('בחרו נקודה במיני-מפה למיקום התמונות', true);
    const point = await new Promise<{ lat: number; lng: number }>((res) => {
      miniClick.current = (lat, lng) => { miniClick.current = null; res({ lat, lng }); };
    });
    const urls = await Promise.all(files.map((f) => fileToDataURL(f, 900, 675)));
    // spread ≈8m apart so pins don't stack
    setFrames(urls.map((url, i) => ({ url, lat: point.lat + 0.00007 * i, lng: point.lng + 0.00004 * i, seq: i })));
    setIdx(0);
    setUpMsg(`✓ ${urls.length} תמונות מוכנות לסיור`);
  }

  // render current frame + optional live inference
  useEffect(() => {
    if (!frames.length) return;
    const f = frames[idx];
    const img = imgRef.current, cv = cvRef.current;
    if (!img || !cv) return;
    let cancelled = false;
    (async () => {
      img.src = f.url;
      await new Promise((r) => { if (img.complete && img.naturalWidth) r(null); else img.onload = () => r(null); });
      if (cancelled) return;
      cv.width = img.clientWidth; cv.height = img.clientHeight;
      cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height);
      setMiniPos(f.lat, f.lng);
      if (stateRef.current.live) await liveDetect(f, cv);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, frames, live]);

  // play loop
  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => {
      const s = stateRef.current;
      if (!s.frames.length) return;
      setIdx((i) => (i + 1) % s.frames.length);
    }, live ? 1400 : 900);
    return () => clearInterval(h);
  }, [playing, live]);

  async function liveDetect(f: TFrame, cv: HTMLCanvasElement) {
    setScanning(true);
    try {
      const c = parseFloat(stateRef.current.conf) || 0.35;
      const durl = f.url.startsWith('data:') ? f.url : await urlToDataURL(f.url);
      const { boxes } = await detectOnDataURL(durl, c);
      drawDetections(cv, boxes);
      for (const b of boxes) await saveDetection(f, b, durl);
    } catch (e) { console.warn('live detect', e); }
    setScanning(false);
  }

  async function saveDetection(f: TFrame, b: Box, durl: string) {
    const cl = clsOf(b.cls);
    const key = `${cl.name}_${f.lat.toFixed(4)}_${f.lng.toFixed(4)}`;
    if (savedKeys.current.has(key)) return;
    savedKeys.current.add(key);
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
        detected_by: authStore.get().user?.id || null,
        team_name: authStore.get().team || null,
      });
      setFeed((prev) => [{ crop: cropURL, name: cl.name, score: b.score, at: Date.now() }, ...prev].slice(0, 30));
      bumpData();
    } catch (e) { console.warn('save detection', e); }
  }

  function toggleLive() {
    if (!model.ready) { toast('טענו מודל בסטודיו קודם'); return; }
    if (!live && !auth.user) { authStore.set({ viewer: false }); toast('צריך להתחבר בשביל סיור חי', true); return; }
    setLive((v) => !v);
    if (!live) setFeed([]);
  }

  return (
    <section className="view">
      <div className="phase-head">
        <span className="ph-n">7</span>
        <div>
          <b>ניטור — סיור ברחובות</b>
          <span className="why">למה זה חשוב? מודל שעובד במעבדה חייב להיבדק ברחוב האמיתי. כאן רואים אם ה-AI שלכם באמת מזהה.</span>
        </div>
      </div>
      <div className="tour-grid">
        <div className="tour-main hud">
          <div className="tour-tabs">
            <button className={tab === 'street' ? 'on' : ''} onClick={() => setTab('street')}>Street View</button>
            <button className={tab === 'frames' ? 'on' : ''} onClick={() => setTab('frames')}>הצילומים שלנו</button>
          </div>
          {tab === 'street' ? (
            <div id="svWrap">
              {GMAPS_KEY ? (
                // official Google Maps Embed API (Street View) — needs a free key
                <iframe
                  id="svFrame"
                  src={`https://www.google.com/maps/embed/v1/streetview?key=${GMAPS_KEY}&location=${sv.lat},${sv.lng}&language=iw`}
                  allow="accelerometer; gyroscope"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                // keyless fallback — Google killed the old output=svembed embed.
                // open the real Street View pano in a new tab (always works, no key).
                <div className="sv-fallback">
                  <div className="svf-eye">◉</div>
                  <div className="svf-title">Street View של גוגל</div>
                  <p className="svf-hint">
                    גוגל חסמה הטמעה ישירה בלי מפתח. לחצו לפתוח את התצוגה האמיתית של הרחוב בטאב חדש —
                    או השתמשו ב״הצילומים שלנו״ לסיור עם המודל.
                  </p>
                  <a
                    href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${sv.lat},${sv.lng}`}
                    target="_blank" rel="noopener noreferrer"
                  >
                    <button className="primary">🌍 פתח Street View במיקום הזה ↗</button>
                  </a>
                  <div className="svf-coords">📍 {sv.lat.toFixed(5)}, {sv.lng.toFixed(5)}</div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className={'stage' + (scanning ? ' scanning' : '')} style={{ minHeight: 380 }}>
                {frames.length ? (
                  <>
                    <img ref={imgRef} alt="" />
                    <canvas ref={cvRef} />
                  </>
                ) : (
                  <div className="empty">בחרו מסלול מצולם, או העלו תמונות רחוב ↓</div>
                )}
              </div>
              <div className="tour-ctl">
                <button className="ghost" onClick={() => setIdx((i) => (i - 1 + frames.length) % Math.max(frames.length, 1))}>→ אחורה</button>
                <button className="primary" onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ עצור' : '▶ נגן'}</button>
                <button className="ghost" onClick={() => setIdx((i) => (i + 1) % Math.max(frames.length, 1))}>קדימה ←</button>
                <span className="pill">{frames.length ? `${idx + 1} / ${frames.length}` : '—'}</span>
                <span style={{ flex: 1 }} />
                <button className="hot" disabled={!model.ready || !frames.length} onClick={toggleLive}>
                  {live ? '⏹ עצור סיור חי' : '🔴 סיור חי'}
                </button>
                <span className="pill">
                  {model.ready ? <><span className="status-dot live" />{model.name || 'מודל טעון'}</> : 'אין מודל'}
                </span>
              </div>
              <div className="hint" style={{ margin: '8px 2px 0' }}>
                🔴 סיור חי = המודל המאומן שלכם רץ על כל תמונה. זיהוי מעל הסף → נשמר אוטומטית כנעץ במפה!
                <label style={{ marginInlineStart: 10 }}>
                  סף ביטחון: <input type="text" value={conf} onChange={(e) => setConf(e.target.value)} style={{ width: 52, padding: '3px 7px' }} />
                </label>
              </div>
            </div>
          )}
        </div>
        <div className="tour-side">
          <div className="card hud slim" style={{ display: tab === 'frames' ? '' : 'none' }}>
            <h3>מיני-מפה</h3>
            <div ref={miniEl} id="miniMap" />
          </div>
          <div className="card hud slim">
            <h3>מסלולים מצולמים</h3>
            <div className="route-list">
              {routes.length ? routes.map((r) => (
                <div key={r.id} className="rt" onClick={() => loadRoute(r.id)}>
                  <span className="n">{r.frame_count}📷</span>
                  <span>{r.name}</span>
                </div>
              )) : <span className="muted" style={{ fontSize: 12.5 }}>אין עדיין מסלולים — מפעל הדאטה ימלא אותם.</span>}
            </div>
          </div>
          <div className="card hud slim">
            <h3>העלאת תמונות רחוב</h3>
            <p className="hint" style={{ margin: '0 0 8px' }}>
              צילמתם מפגעים בטלפון? העלו, בחרו נקודה במיני-מפה, וסיירו עליהן עם המודל.
            </p>
            <label className="dropzone" style={{ display: 'block' }}>
              גררו תמונות לכאן<br /><b>או לחצו לבחירה</b>
              <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files?.length) handleUpload(e.target.files); e.target.value = ''; }} />
            </label>
            {upMsg && <div className="hint" style={{ marginTop: 6 }}>{upMsg}</div>}
          </div>
          {live && (
            <div className="card hud slim">
              <h3>זיהויים חיים</h3>
              <div className="live-feed">
                {feed.map((f) => (
                  <div key={f.at} className="lf">
                    <img src={f.crop} alt="" />
                    <div>
                      <b>{f.name}</b>
                      <div className="muted" style={{ fontSize: 11 }}>{Math.round(f.score * 100)}% · נשמר במפה 📍</div>
                    </div>
                  </div>
                ))}
                {!feed.length && <span className="muted" style={{ fontSize: 12 }}>סורק…</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
