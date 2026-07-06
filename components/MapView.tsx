'use client';
import { useEffect, useRef, useState } from 'react';
import { MAP_STYLE, CLASS_PALETTE, DEFAULT_CITY } from '@/lib/config';
import { fetchDetections, fetchCoverage, publicUrl } from '@/lib/db';
import { classColor, fmtWhen } from '@/lib/util';
import { createStore, useStore, dataVersion, toast } from '@/lib/store';
import { STATUS_META, OPEN_STATUSES } from '@/lib/status';
import { openVerify } from '@/components/VerifyModal';

export const cityStore = createStore<{ city: any; flyAt: number }>({ city: DEFAULT_CITY, flyAt: 0 });

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

interface Props {
  active: boolean;
  onStreetView: (lat: number, lng: number) => void;
  onTourFrame: (frame: any) => void;
}

export default function MapView({ active, onStreetView, onTourFrame }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const covRef = useRef<any[]>([]);
  const [stats, setStats] = useState({ det: 0, ok: 0, frames: 0, newToday: 0, resolved: 0 });
  const focusRef = useRef<any>(null);
  const byIdRef = useRef<Record<string, any>>({});
  const [legend, setLegend] = useState<{ name: string; n: number }[]>([]);
  const [showHeat, setShowHeat] = useState(false);
  const [showCover, setShowCover] = useState(true);
  const [showSat, setShowSat] = useState(false);
  const dv = useStore(dataVersion);
  const city = useStore(cityStore);
  const cbRef = useRef({ onStreetView, onTourFrame });
  cbRef.current = { onStreetView, onTourFrame };

  // init map once
  useEffect(() => {
    let disposed = false;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      if (disposed || !mapEl.current || mapRef.current) return;
      const map = new maplibregl.Map({
        container: mapEl.current,
        style: MAP_STYLE as any,
        center: [DEFAULT_CITY.center_lng, DEFAULT_CITY.center_lat],
        zoom: DEFAULT_CITY.zoom,
        attributionControl: { compact: true } as any,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
      map.on('load', () => {
        // gold diagonal-hatch pattern (signature Smart Zone zone fill)
        const S = 16;
        const hc = document.createElement('canvas');
        hc.width = hc.height = S;
        const hx = hc.getContext('2d')!;
        hx.strokeStyle = 'rgba(255,182,39,0.55)';
        hx.lineWidth = 2;
        hx.beginPath();
        for (let i = -S; i < S * 2; i += 7) { hx.moveTo(i, 0); hx.lineTo(i + S, S); }
        hx.stroke();
        if (!map.hasImage('hatch')) map.addImage('hatch', hx.getImageData(0, 0, S, S), { pixelRatio: 2 });

        // focus zone — hatched polygon over the densest hazard area
        map.addSource('focus-zone', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'focus-fill', type: 'fill', source: 'focus-zone', paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0.85 } });
        map.addLayer({ id: 'focus-line', type: 'line', source: 'focus-zone', paint: { 'line-color': '#FFB627', 'line-width': 1, 'line-opacity': 0.7, 'line-dasharray': [3, 2] } });

        map.addSource('det-heat', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: 'det-heat', type: 'heatmap', source: 'det-heat',
          layout: { visibility: 'none' },
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'confidence'], 0, 0.2, 1, 1],
            'heatmap-intensity': 1.1,
            'heatmap-radius': 34,
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(0,0,0,0)', 0.25, 'rgba(53,225,255,.25)', 0.5, 'rgba(53,225,255,.5)',
              0.75, 'rgba(255,182,39,.7)', 1, 'rgba(255,182,39,.95)'],
            'heatmap-opacity': 0.85,
          },
        });
        refresh(map, maplibregl);
      });
      map.on('contextmenu', (e: any) => cbRef.current.onStreetView(e.lngLat.lat, e.lngLat.lng));
      mapRef.current = { map, maplibregl };
    })();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refetch when data version bumps
  useEffect(() => {
    const m = mapRef.current;
    if (m && m.map.isStyleLoaded()) refresh(m.map, m.maplibregl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dv.n]);

  // city fly
  useEffect(() => {
    const m = mapRef.current;
    if (m && city.flyAt) {
      m.map.flyTo({ center: [city.city.center_lng, city.city.center_lat], zoom: city.city.zoom, duration: 1800 });
    }
  }, [city.flyAt, city.city]);

  // resize when shown
  useEffect(() => {
    if (active && mapRef.current) setTimeout(() => mapRef.current.map.resize(), 60);
  }, [active]);

  // heat toggle
  useEffect(() => {
    const m = mapRef.current;
    if (m && m.map.getLayer('det-heat')) {
      m.map.setLayoutProperty('det-heat', 'visibility', showHeat ? 'visible' : 'none');
    }
  }, [showHeat]);

  // coverage toggle
  useEffect(() => {
    covRef.current.forEach((mk) => { mk.getElement().style.display = showCover ? '' : 'none'; });
  }, [showCover]);

  // satellite basemap toggle — real aerial photos of the city
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !m.map.isStyleLoaded()) return;
    const set = (id: string, v: boolean) => {
      if (m.map.getLayer(id)) m.map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
    };
    set('satellite', showSat);
    set('labels', showSat);
    set('carto', !showSat);
  }, [showSat]);

  async function refresh(map: any, maplibregl: any) {
    try {
      const [dets, cov] = await Promise.all([fetchDetections({ limit: 500 }), fetchCoverage(1500)]);
      // open events only — resolved hazards come OFF the map (that's the point)
      const visible = dets.filter((d: any) => OPEN_STATUSES.includes(d.status));
      const dayAgo = Date.now() - 864e5;
      byIdRef.current = Object.fromEntries(dets.map((d: any) => [d.id, d]));
      (window as any).__scVerify = (id: string) => { const d = byIdRef.current[id]; if (d) openVerify(d); };
      setStats({
        det: visible.length,
        ok: dets.filter((d: any) => d.status === 'approved').length,
        frames: cov.length,
        newToday: visible.filter((d: any) => new Date(d.created_at).getTime() > dayAgo).length,
        resolved: dets.filter((d: any) => d.status === 'resolved').length,
      });
      // legend
      const counts: Record<string, number> = {};
      visible.forEach((d: any) => { counts[d.class_name] = (counts[d.class_name] || 0) + 1; });
      setLegend(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, n })));
      // pins
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = visible.map((d: any) => {
        const el = document.createElement('div');
        const cls = d.status === 'approved' ? ' approved'
          : d.status === 'awaiting_verify' || d.status === 'verifying' ? ' verify' : '';
        el.className = 'pin' + cls;
        el.style.color = classColor(d.class_name, CLASS_PALETTE);
        return new maplibregl.Marker({ element: el })
          .setLngLat([d.lng, d.lat])
          .setPopup(new maplibregl.Popup({ offset: 18, maxWidth: '280px' }).setHTML(popupHTML(d)))
          .addTo(map);
      });
      // coverage dots (thin to ~400)
      covRef.current.forEach((m) => m.remove());
      const step = Math.max(1, Math.floor(cov.length / 400));
      covRef.current = cov.filter((_: any, i: number) => i % step === 0).map((f: any) => {
        const el = document.createElement('div');
        el.className = 'cov-dot';
        el.title = 'לסיור מכאן';
        el.onclick = (e) => { e.stopPropagation(); cbRef.current.onTourFrame(f); };
        return new maplibregl.Marker({ element: el }).setLngLat([f.lng, f.lat]).addTo(map);
      });
      // heat source
      const src = map.getSource('det-heat');
      if (src) {
        src.setData({
          type: 'FeatureCollection',
          features: visible.map((d: any) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
            properties: { confidence: d.confidence },
          })),
        });
      }
      updateFocusZone(map, maplibregl, visible);
    } catch (e: any) { toast('טעינת מפה: ' + (e.message || e)); }
  }

  // gold hatched "focus zone" over the densest hazard cluster + labeled callout
  function updateFocusZone(map: any, maplibregl: any, visible: any[]) {
    const fsrc = map.getSource('focus-zone');
    if (!fsrc) return;
    if (focusRef.current) { focusRef.current.remove(); focusRef.current = null; }
    if (visible.length < 3) { fsrc.setData({ type: 'FeatureCollection', features: [] }); return; }
    // grid the city into ~250m cells, pick the cell with the most hazards
    const cell = 0.0025;
    const buckets: Record<string, any[]> = {};
    visible.forEach((d) => {
      const k = `${Math.floor(d.lat / cell)}_${Math.floor(d.lng / cell)}`;
      (buckets[k] = buckets[k] || []).push(d);
    });
    const top = Object.values(buckets).sort((a, b) => b.length - a.length)[0];
    if (!top || top.length < 2) { fsrc.setData({ type: 'FeatureCollection', features: [] }); return; }
    // padded bbox around the densest cluster
    const lats = top.map((d) => d.lat), lngs = top.map((d) => d.lng);
    const pad = 0.0012;
    const s = Math.min(...lats) - pad, n = Math.max(...lats) + pad;
    const w = Math.min(...lngs) - pad, e = Math.max(...lngs) + pad;
    fsrc.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      }],
    });
    // callout label at the top-right corner (leader dot + gold text)
    const el = document.createElement('div');
    el.className = 'focus-callout';
    el.innerHTML = `<span class="fc-dot"></span><div class="fc-box"><span class="fc-t">אזור מוקד</span><b>${top.length} מפגעים</b></div>`;
    focusRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom-left' }).setLngLat([e, n]).addTo(map);
  }

  function popupHTML(d: any) {
    const img = d.crop_path ? `<img class="pop-img" src="${publicUrl(d.crop_path)}" alt="">` : '';
    const meta = STATUS_META[d.status] || { label: d.status, pill: '' };
    const verifyBtn = d.status === 'awaiting_verify'
      ? `<button class="pop-verify" onclick="window.__scVerify&&window.__scVerify('${d.id}')">📸 אמת בשטח — צלם ובדוק עם ה-AI</button>`
      : '';
    return `<div class="pop-cls">${esc(d.class_name)}</div>${img}
      <div class="pop-status ${meta.pill}">${meta.label}</div>
      <div class="pop-meta">ביטחון ${Math.round(d.confidence * 100)}%<br>
      ${d.team_name ? 'קבוצת ' + esc(d.team_name) + ' · ' : ''}${fmtWhen(d.created_at)}</div>${verifyBtn}`;
  }

  return (
    <section className="view">
      <div className="map-shell hud">
        <div ref={mapEl} id="cityMap" className={showSat ? 'sat' : ''} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 12, zIndex: 5, pointerEvents: 'none' }}>
          <span style={{ color: 'rgba(53,225,255,.5)', fontSize: 13 }}>〈</span>
          <span style={{ fontSize: 12, letterSpacing: '.34em', color: '#eafbff' }}>מפת העיר החיה</span>
          <span style={{ color: 'rgba(53,225,255,.5)', fontSize: 13 }}>〉</span>
        </div>
        <div className="map-hudbar" style={{ top: 44 }}>
          <div className="hero-stat">
            <div className="hs-label">מפגעים פעילים</div>
            <div className="hs-frame"><b>{stats.det}</b></div>
            <div className="hs-sub"><i /><span>{stats.newToday} חדשים היום</span></div>
          </div>
          <div className="stat-chip"><b>{stats.ok}</b><span>בטיפול</span></div>
          <div className="stat-chip resolved"><b>{stats.resolved}</b><span>טופלו 🟢</span></div>
          <div className="stat-chip"><b>{stats.frames}</b><span>צילומים</span></div>
          <label className="hud-toggle">
            <input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} /> מפת חום
          </label>
          <label className="hud-toggle">
            <input type="checkbox" checked={showCover} onChange={(e) => setShowCover(e.target.checked)} /> כיסוי
          </label>
          <label className="hud-toggle">
            <input type="checkbox" checked={showSat} onChange={(e) => setShowSat(e.target.checked)} /> לוויין
          </label>
        </div>
        {legend.length > 0 && (
          <div className="map-legend">
            {legend.map((l) => (
              <span key={l.name} className="lg">
                <i style={{ background: classColor(l.name, CLASS_PALETTE), color: classColor(l.name, CLASS_PALETTE) }} />
                {l.name} · {l.n}
              </span>
            ))}
          </div>
        )}
      </div>
      <p className="hint center">
        לחיצה על נעץ = פרטי המפגע · לחיצה על נקודת כיסוי כחולה = סיור מאותה נקודה · לחיצה ימנית = פתיחת Street View במקום
      </p>
    </section>
  );
}
