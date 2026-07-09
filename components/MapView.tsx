'use client';
import { useEffect, useRef, useState } from 'react';
import { MAP_STYLE, CLASS_PALETTE, DEFAULT_CITY } from '@/lib/config';
import { fetchDetections, fetchCoverage, publicUrl } from '@/lib/db';
import { classColor, fmtWhen } from '@/lib/util';
import { createStore, useStore, dataVersion, toast } from '@/lib/store';
import { STATUS_META, OPEN_STATUSES } from '@/lib/status';
import { openVerify } from '@/components/VerifyModal';
import { DEMO_HAZARDS, fmtAgoMin } from '@/lib/demoHazards';

export const cityStore = createStore<{ city: any; flyAt: number }>({ city: DEFAULT_CITY, flyAt: 0 });

// centroid + zoom that frames all demo incidents (they sit on real Sderot
// streets ~1km apart). Used as the initial camera so the map OPENS on the
// pins — no dependence on post-load fly animations.
const DEMO_CENTER: [number, number] = [
  DEMO_HAZARDS.reduce((s, h) => s + h.lng, 0) / DEMO_HAZARDS.length,
  DEMO_HAZARDS.reduce((s, h) => s + h.lat, 0) / DEMO_HAZARDS.length,
];
const DEMO_ZOOM = 15.1;

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
  const prevIdsRef = useRef<Set<string>>(new Set());
  const focusCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement>(null);
  const cinematic = useRef({ done: false, rm: false, desktop: false });
  const [legend, setLegend] = useState<{ name: string; n: number }[]>([]);
  const [showHeat, setShowHeat] = useState(false);
  const [showCover, setShowCover] = useState(true);
  const [showSat, setShowSat] = useState(true);   // satellite basemap by default
  // 🎭 demo hazard pins with visible info tags — the target look of the
  // live map while real street data is still thin. Clearly badged "דמו".
  const [showDemo, setShowDemo] = useState(true);
  const demoRef = useRef<any[]>([]);
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
      cinematic.current.rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      cinematic.current.desktop = window.matchMedia('(min-width: 768px)').matches;
      const cine = cinematic.current.desktop && !cinematic.current.rm;
      // demo on → open already framed on the incidents (no fly needed);
      // demo off → the usual cinematic descent into the city.
      const demoStart = showDemoRef.current;
      const map = new maplibregl.Map({
        container: mapEl.current,
        style: MAP_STYLE as any,
        center: demoStart ? DEMO_CENTER : [DEFAULT_CITY.center_lng, DEFAULT_CITY.center_lat],
        zoom: demoStart ? DEMO_ZOOM : (cine ? 11.8 : DEFAULT_CITY.zoom),
        pitch: 0,
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

        // satellite is the default basemap — apply immediately on load
        // (the showSat effect can fire before the style is ready)
        if (showSat) {
          ['satellite', 'labels'].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', 'visible'));
          if (map.getLayer('carto')) map.setLayoutProperty('carto', 'visibility', 'none');
        }

        // 🎬 entrance: when the demo incident layer is on, frame the
        // incidents themselves (that's the whole point of this view). Only
        // fall back to the generic cinematic descent when demo is off.
        if (!cinematic.current.done) {
          cinematic.current.done = true;
          if (showDemoRef.current) {
            setTimeout(() => fitDemoBounds(map, maplibregl), 400);
          } else if (cinematic.current.desktop && !cinematic.current.rm) {
            setTimeout(() => {
              map.flyTo({
                center: [DEFAULT_CITY.center_lng, DEFAULT_CITY.center_lat],
                zoom: DEFAULT_CITY.zoom, pitch: 52, bearing: -14,
                duration: 3600, essential: false,
              });
            }, 450);
          }
        }

        // marching-ants border on the focus zone (dasharray step animation)
        if (!cinematic.current.rm) {
          const seq = [[0, 4, 3], [1, 4, 2], [2, 4, 1], [3, 4, 0], [0, 0, 4, 3]];
          let step = 0;
          setInterval(() => {
            if (!map.getLayer('focus-line')) return;
            step = (step + 1) % seq.length;
            try { map.setPaintProperty('focus-line', 'line-dasharray', seq[step]); } catch { /* style reload */ }
          }, 140);
        }
      });
      map.on('contextmenu', (e: any) => cbRef.current.onStreetView(e.lngLat.lat, e.lngLat.lng));
      mapRef.current = { map, maplibregl };
      startFx(map);
      renderDemo(map, maplibregl);   // demo layer never waits on data/style
    })();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✨ ambient FX layer: data particles converging on the focus zone
  const activeRef = useRef(active);
  activeRef.current = active;
  function startFx(map: any) {
    if (cinematic.current.rm || !cinematic.current.desktop) return;
    const cv = fxCanvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    type P = { x: number; y: number; vx: number; vy: number; life: number; gold: boolean };
    let parts: P[] = [];
    const spawn = (w: number, h: number): P => {
      const edge = Math.floor(Math.random() * 4);
      const x = edge === 0 ? 0 : edge === 1 ? w : Math.random() * w;
      const y = edge < 2 ? Math.random() * h : (edge === 2 ? 0 : h);
      return { x, y, vx: 0, vy: 0, life: 0.4 + Math.random() * 0.6, gold: Math.random() < 0.25 };
    };
    const loop = () => {
      requestAnimationFrame(loop);
      if (document.hidden || !activeRef.current) { return; }
      const shell = cv.parentElement!;
      const w = shell.clientWidth, h = shell.clientHeight;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      ctx.clearRect(0, 0, w, h);
      const fc = focusCenterRef.current;
      if (!fc) { parts = []; return; }
      let target;
      try { target = map.project([fc.lng, fc.lat]); } catch { return; }
      while (parts.length < 46) parts.push(spawn(w, h));
      ctx.globalCompositeOperation = 'lighter';
      parts.forEach((p) => {
        const dx = target.x - p.x, dy = target.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        p.vx += (dx / d) * 0.05; p.vy += (dy / d) * 0.05;
        p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy;
        p.life -= 0.0022;
        const near = d < 26;
        if (near || p.life <= 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
          Object.assign(p, spawn(w, h));
          return;
        }
        ctx.beginPath();
        ctx.fillStyle = p.gold ? `rgba(255,182,39,${0.5 * p.life})` : `rgba(53,225,255,${0.45 * p.life})`;
        ctx.arc(p.x, p.y, p.gold ? 1.6 : 1.2, 0, 7);
        ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
    };
    requestAnimationFrame(loop);
  }

  // 🎭 demo hazard pins — rendered as a MANUALLY-PROJECTED overlay, not
  // maplibregl.Marker. Markers freeze at a stale screen position when the
  // map is created in a hidden/0-size tab (and RTL mirrors their origin),
  // leaving every pin stacked at one edge. Here we position each pin from
  // map.project() on every map 'render', which is always correct.
  const demoElsRef = useRef<{ el: HTMLDivElement; h: typeof DEMO_HAZARDS[number] }[]>([]);
  const demoLayerRef = useRef<HTMLDivElement | null>(null);
  const demoOnRenderRef = useRef<(() => void) | null>(null);
  function renderDemo(map: any, _maplibregl?: any) {
    // build the overlay + pin elements once
    if (!demoLayerRef.current) {
      const layer = document.createElement('div');
      layer.className = 'demo-layer';
      (map.getCanvasContainer() as HTMLElement).appendChild(layer);
      demoLayerRef.current = layer;
      const sevColor: Record<string, string> = { 'גבוהה': '#FF6B6B', 'בינונית': '#FFB627', 'נמוכה': '#35E1FF' };
      demoElsRef.current = DEMO_HAZARDS.map((h) => {
        const el = document.createElement('div');
        el.className = 'demo-pin';
        el.innerHTML =
          `<svg viewBox="0 0 24 34" width="38" height="54" aria-hidden="true">` +
          `<path d="M12 1C6 1 1.5 5.6 1.5 11.4c0 7.6 8.6 19 10.5 21.6 1.9-2.6 10.5-14 10.5-21.6C22.5 5.6 18 1 12 1Z" ` +
          `fill="#e63946" stroke="#7f1d1d" stroke-width="1.2"/>` +
          `<circle cx="12" cy="11.4" r="4.4" fill="#fff"/></svg>` +
          `<div class="pin-tag"><span class="pt-demo">דמו</span><b>${esc(h.class_name)}</b>` +
          `<span class="pt-trait">${esc(h.trait)}</span>` +
          `<span class="pt-meta"><i style="background:${sevColor[h.severity]}"></i>חומרה ${h.severity} · ${fmtAgoMin(h.agoMin)}</span></div>`;
        layer.appendChild(el);
        return { el, h };
      });
      const reposition = () => {
        for (const { el, h } of demoElsRef.current) {
          const p = map.project([h.lng, h.lat]);
          // anchor the teardrop tip at the coordinate (bottom-center)
          el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
        }
      };
      demoOnRenderRef.current = reposition;
      map.on('render', reposition);
      map.on('move', reposition);
      reposition();
    }
    demoLayerRef.current.style.display = showDemoRef.current ? '' : 'none';
    demoOnRenderRef.current?.();
  }
  // 🎯 frame the incidents so "open the map → see them spread across the
  // streets" always holds. Deterministic setCenter+zoom on the incident
  // centroid — fitBounds' padding math is unreliable on this short map
  // (it zoomed way out, clustering the pins to a few px).
  function fitDemoBounds(map: any, _maplibregl?: any) {
    try {
      map.easeTo({ center: DEMO_CENTER, zoom: DEMO_ZOOM, pitch: 0, bearing: 0,
        duration: cinematic.current.rm ? 0 : 1200 });
    } catch { /* map not ready — pins are still placed correctly */ }
  }
  const showDemoRef = useRef(showDemo);
  showDemoRef.current = showDemo;
  useEffect(() => {
    // DOM markers don't need the style loaded — never gate on it
    // (isStyleLoaded() flickers false on slow tiles → pins silently vanish)
    const m = mapRef.current;
    if (m) {
      renderDemo(m.map, m.maplibregl);
      // real detection pins hide (demo on) / reappear (demo off) — re-run refresh
      if (m.map.isStyleLoaded()) refresh(m.map, m.maplibregl);
      if (showDemo) setTimeout(() => fitDemoBounds(m.map, m.maplibregl), 60);  // frame incidents on enable
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDemo]);

  // 📡 radar ping where a new detection just landed (realtime moment)
  function pingAt(map: any, maplibregl: any, lat: number, lng: number) {
    if (cinematic.current.rm) return;
    const el = document.createElement('div');
    el.className = 'ping';
    el.innerHTML = '<i></i><i></i>';
    const mk = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    setTimeout(() => mk.remove(), 2100);
  }

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

  // resize when shown — the map often inits while its tab is hidden
  // (0-size container → every marker projects to one edge). On show:
  // resize to the real size, THEN frame the demo incidents so they're
  // spread across the streets, not stacked at the edge.
  useEffect(() => {
    if (!active || !mapRef.current) return;
    const m = mapRef.current;
    const t = setTimeout(() => {
      m.map.resize();
      // markers created while the tab was hidden (0-size container) freeze
      // at a stale screen position — RE-CREATE them now that the map has
      // its real size, so they land on the correct streets.
      if (showDemoRef.current) {
        renderDemo(m.map, m.maplibregl);
        setTimeout(() => renderDemo(m.map, m.maplibregl), 260);   // once more after tiles settle
      }
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // city-scoped: national scale must not leak other cities' pins here
      const scope = { lat: DEFAULT_CITY.center_lat, lng: DEFAULT_CITY.center_lng };
      const [dets, cov] = await Promise.all([fetchDetections({ limit: 500, scope }), fetchCoverage(1500, scope)]);
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
      // pins — dense mode: past ~150 pins the per-pin infinite animations
      // (ring pulse + beam) tank the frame rate; freeze them, keep the glow
      const dense = visible.length > 150;
      map.getContainer().classList.toggle('dense', dense);
      markersRef.current.forEach((m) => m.remove());
      // demo incident view: hide the raw detection pins (they're mostly
      // finger/mouse TRAINING shots at one GPS → a stacked colored line).
      // Show only the curated demo hazards. Toggle demo off for real pins.
      markersRef.current = showDemoRef.current ? [] : visible.map((d: any) => {
        const el = document.createElement('div');
        const cls = d.status === 'approved' ? ' approved'
          : d.status === 'awaiting_verify' || d.status === 'verifying' ? ' verify' : '';
        el.className = 'pin' + cls;
        el.style.color = classColor(d.class_name, CLASS_PALETTE);
        // volumetric light pillar rising from the hazard (desktop, motion ok)
        if (!dense && cinematic.current.desktop && !cinematic.current.rm) {
          const beam = document.createElement('i');
          beam.className = 'pin-beam';
          el.appendChild(beam);
        }
        return new maplibregl.Marker({ element: el })
          .setLngLat([d.lng, d.lat])
          .setPopup(new maplibregl.Popup({ offset: 18, maxWidth: '280px' }).setHTML(popupHTML(d)))
          .addTo(map);
      });
      // 📡 radar ping for detections that JUST arrived (cross-device magic)
      const prev = prevIdsRef.current;
      if (prev.size) {
        visible.filter((d: any) => !prev.has(d.id)).slice(0, 3)
          .forEach((d: any) => pingAt(map, maplibregl, d.lat, d.lng));
      }
      prevIdsRef.current = new Set(visible.map((d: any) => d.id));
      // coverage dots (thin to ~400) — also hidden in the demo incident view
      covRef.current.forEach((m) => m.remove());
      const step = Math.max(1, Math.floor(cov.length / 400));
      covRef.current = showDemoRef.current ? [] : cov.filter((_: any, i: number) => i % step === 0).map((f: any) => {
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
      renderDemo(map, maplibregl);
    } catch (e: any) { toast('טעינת מפה: ' + (e.message || e)); }
  }

  // gold hatched "focus zone" over the densest hazard cluster + labeled callout
  function updateFocusZone(map: any, maplibregl: any, visible: any[]) {
    const fsrc = map.getSource('focus-zone');
    if (!fsrc) return;
    if (focusRef.current) { focusRef.current.remove(); focusRef.current = null; }
    focusCenterRef.current = null;
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
    focusCenterRef.current = { lat: (s + n) / 2, lng: (w + e) / 2 };  // particle target
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
        <canvas ref={fxCanvasRef} className="map-fx" aria-hidden="true" />
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
          <label className="hud-toggle">
            <input type="checkbox" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} /> תרחיש דמו
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
