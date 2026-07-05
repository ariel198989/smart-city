'use client';
// Data factory (admin): drive video + GPX → sharp geotagged frames → sc_frames
import { useEffect, useRef, useState } from 'react';
import { sb, fetchRoutes, insertRoute, insertFrames, uploadBlob } from '@/lib/db';
import { extractFrames } from '@/lib/video';
import { parseGPX, interpolate, type GpxPoint } from '@/lib/gpx';
import { authStore } from '@/lib/auth';
import { cityStore } from '@/components/MapView';
import { useStore, toast, bumpData } from '@/lib/store';
import { dataURLtoBlob, fmtWhen } from '@/lib/util';

export default function FactoryView() {
  const auth = useStore(authStore);
  const city = useStore(cityStore);
  const [routes, setRoutes] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [count, setCount] = useState('80');
  const [video, setVideo] = useState<File | null>(null);
  const [points, setPoints] = useState<GpxPoint[]>([]);
  const [bar, setBar] = useState<{ pct: number; lbl: string } | null>(null);
  const busy = useRef(false);

  const loadRoutes = () => fetchRoutes().then(setRoutes).catch(() => {});
  useEffect(() => { loadRoutes(); }, []);

  const ready = video && points.length > 0;
  const stateLbl = ready
    ? `✓ מוכן: ${Math.round(video!.size / 1e6)}MB · ${points.length} נק׳ GPS`
    : video ? 'עכשיו GPX' : points.length ? 'עכשיו סרטון' : 'בחרו סרטון + GPX';

  async function onGpx(f: File) {
    try {
      const pts = parseGPX(await f.text());
      if (!pts.length) throw new Error('לא נמצאו נקודות במסלול (trkpt)');
      setPoints(pts);
    } catch (err: any) { toast('GPX: ' + (err.message || err)); setPoints([]); }
  }

  async function process() {
    if (!ready || busy.current) return;
    busy.current = true;
    const routeName = name.trim() || 'מסלול ' + new Date().toLocaleDateString('he-IL');
    setBar({ pct: 2, lbl: 'מחלץ פריימים…' });
    try {
      const { frames, duration } = await extractFrames(video!, {
        want: parseInt(count) || 80, sharpOnly: true, maxW: 960,
        onProgress: (d, t) => setBar({ pct: Math.round(d / t * 40), lbl: `סורק ${d}/${t}` }),
      });
      const route = await insertRoute({
        city_id: city.city?.id || null, name: routeName,
        uploaded_by: auth.user!.id, frame_count: frames.length, gpx: null,
      });
      const rows = [];
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        const pos = interpolate(points, Math.min(1, f.t / duration));
        const path = `frames/${route.id}/f_${String(i).padStart(4, '0')}.jpg`;  // ASCII-only key
        await uploadBlob(path, dataURLtoBlob(f.url), 'image/jpeg');
        rows.push({ route_id: route.id, storage_path: path, lat: pos.lat, lng: pos.lng, heading: pos.heading, seq: i });
        setBar({ pct: 40 + Math.round((i + 1) / frames.length * 55), lbl: `מעלה ${i + 1}/${frames.length}` });
      }
      for (let i = 0; i < rows.length; i += 100) await insertFrames(rows.slice(i, i + 100));
      setBar({ pct: 100, lbl: '✓' });
      toast(`המסלול "${routeName}" עלה: ${frames.length} פריימים ממופים 🛰️`, true);
      setVideo(null); setPoints([]); setName('');
      loadRoutes();
      bumpData();
    } catch (e: any) {
      toast('מפעל: ' + (e.message || e));
    }
    busy.current = false;
  }

  async function delRoute(r: any) {
    if (!confirm(`למחוק את "${r.name}" וכל הפריימים שלו?`)) return;
    const del = await sb.from('sc_routes').delete().eq('id', r.id);
    if (del.error) toast(del.error.message);
    else { loadRoutes(); bumpData(); }
  }

  return (
    <section className="view">
      <div className="phase-head">
        <span className="ph-n">🏭</span>
        <div>
          <b>מפעל הדאטה</b>
          <span className="why">סרטון נסיעה + קובץ GPX ← פריימים חדים עם קואורדינטות אמיתיות ← מאגר עירוני שכולם מתאמנים עליו.</span>
        </div>
      </div>
      <div className="card hud">
        <h3>מסלול חדש</h3>
        <div className="row" style={{ marginBottom: 8 }}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="שם המסלול… למשל: שד׳ מנחם בגין צפונה" style={{ flex: 1, minWidth: 200 }} />
        </div>
        <div className="row">
          <label className="primary" style={{ cursor: 'pointer', padding: '9px 16px', border: '1px solid rgba(53,225,255,.7)', background: 'var(--cy-soft)', color: 'var(--ink)', fontWeight: 600 }}>
            🎬 סרטון נסיעה
            <input type="file" accept="video/*" style={{ display: 'none' }}
              onChange={(e) => { setVideo(e.target.files?.[0] || null); }} />
          </label>
          <label style={{ cursor: 'pointer', padding: '9px 16px', border: '1px solid var(--cy-faint)', background: 'rgba(53,225,255,.03)' }}>
            🛰️ קובץ GPX
            <input type="file" accept=".gpx,.xml" style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files?.[0]) onGpx(e.target.files[0]); e.target.value = ''; }} />
          </label>
          <label className="mini">
            פריימים:
            <select value={count} onChange={(e) => setCount(e.target.value)}>
              <option>40</option><option>80</option><option>150</option>
            </select>
          </label>
          <span className="pill">{stateLbl}</span>
        </div>
        <button className="hot" disabled={!ready} onClick={process} style={{ marginTop: 10 }}>
          ⚙️ עבד והעלה למאגר
        </button>
        {bar && (
          <div className="tagbar" style={{ marginTop: 10 }}>
            <span>מעבד</span>
            <div className="bar"><i style={{ width: bar.pct + '%' }} /></div>
            <b>{bar.lbl}</b>
          </div>
        )}
      </div>
      <div className="card hud">
        <h3>מסלולים קיימים</h3>
        {routes.length ? routes.map((r) => (
          <div key={r.id} className="pool-row">
            <div className="meta">
              <div className="nm">{r.name}</div>
              <div className="cls">{r.frame_count} פריימים · {fmtWhen(r.created_at)}</div>
            </div>
            <button className="ghost" style={{ color: 'var(--danger)', fontSize: 12 }} onClick={() => delRoute(r)}>מחק</button>
          </div>
        )) : <span className="muted" style={{ fontSize: 13 }}>אין עדיין מסלולים.</span>}
      </div>
    </section>
  );
}
