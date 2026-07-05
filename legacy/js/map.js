// Smart City — city map (MapLibre): detection pins, heatmap, coverage, popups
import { MAP_STYLE, CLASS_PALETTE, DEFAULT_CITY } from './config.js';
import { fetchCities, fetchDetections, fetchCoverage, publicUrl } from './db.js';
import { $, toast, classColor, fmtWhen } from './util.js';

export const MAPSTATE = { city: DEFAULT_CITY, cities: [], detections: [], coverage: [] };
let map = null;
let markers = [];
let covMarkers = [];
let onTourRequest = null;   // callback(frameLike) — set by tour module
let onStreetView = null;    // callback(lat,lng)

export function setTourHandlers({ tourRequest, streetView }) {
  onTourRequest = tourRequest;
  onStreetView = streetView;
}

export function getMap() { return map; }

export async function initMap() {
  map = new maplibregl.Map({
    container: 'cityMap',
    style: MAP_STYLE,
    center: [DEFAULT_CITY.center_lng, DEFAULT_CITY.center_lat],
    zoom: DEFAULT_CITY.zoom,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');

  map.on('load', () => {
    map.addSource('det-heat', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'det-heat', type: 'heatmap', source: 'det-heat',
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'confidence'], 0, 0.2, 1, 1],
        'heatmap-intensity': 1.1,
        'heatmap-radius': 34,
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)', 0.2, 'rgba(34,211,238,.25)', 0.45, 'rgba(167,139,250,.5)',
          0.7, 'rgba(244,114,182,.75)', 1, 'rgba(251,191,36,.95)'],
        'heatmap-opacity': 0.85,
      },
    });
    refreshMapData();
  });

  // right click / long-press → open Street View there
  map.on('contextmenu', (e) => { if (onStreetView) onStreetView(e.lngLat.lat, e.lngLat.lng); });

  $('#tglHeat').onchange = (e) => {
    if (map.getLayer('det-heat')) map.setLayoutProperty('det-heat', 'visibility', e.target.checked ? 'visible' : 'none');
  };
  $('#tglCover').onchange = (e) => {
    covMarkers.forEach((m) => m.getElement().style.display = e.target.checked ? '' : 'none');
  };

  // cities dropdown
  try {
    MAPSTATE.cities = await fetchCities();
  } catch { MAPSTATE.cities = [DEFAULT_CITY]; }
  const sel = $('#citySel');
  sel.innerHTML = '';
  MAPSTATE.cities.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = '📍 ' + c.name;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    MAPSTATE.city = MAPSTATE.cities[+sel.value];
    map.flyTo({ center: [MAPSTATE.city.center_lng, MAPSTATE.city.center_lat], zoom: MAPSTATE.city.zoom, duration: 1800 });
  };
}

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

export async function refreshMapData() {
  try {
    const [dets, cov] = await Promise.all([fetchDetections({ limit: 500 }), fetchCoverage(1500)]);
    MAPSTATE.detections = dets.filter((d) => d.status !== 'rejected');
    MAPSTATE.coverage = cov;
    renderPins();
    renderCoverage();
    renderHeat();
    renderLegend();
    const lc = $('#liveCount');
    if (lc) lc.textContent = `LIVE · ${cov.length} צילומים`;
    $('#mStatDet').textContent = MAPSTATE.detections.length;
    $('#mStatOk').textContent = dets.filter((d) => d.status === 'approved').length;
    $('#mStatFrames').textContent = cov.length;
  } catch (e) { toast('טעינת מפה: ' + (e.message || e)); }
}

function renderPins() {
  markers.forEach((m) => m.remove());
  markers = [];
  MAPSTATE.detections.forEach((d) => {
    const el = document.createElement('div');
    el.className = 'pin' + (d.status === 'approved' ? ' approved' : '');
    el.style.color = classColor(d.class_name, CLASS_PALETTE);
    const m = new maplibregl.Marker({ element: el })
      .setLngLat([d.lng, d.lat])
      .setPopup(new maplibregl.Popup({ offset: 18, maxWidth: '260px' }).setHTML(popupHTML(d)))
      .addTo(map);
    markers.push(m);
  });
}

function popupHTML(d) {
  const img = d.crop_path ? `<img class="pop-img" src="${publicUrl(d.crop_path)}" alt="">` : '';
  const st = d.status === 'approved' ? '✅ מאושר' : d.status === 'pending' ? '⏳ ממתין לאישור' : '❌';
  return `<div class="pop-cls">${escapeHTML(d.class_name)}</div>${img}
    <div class="pop-meta">ביטחון ${Math.round(d.confidence * 100)}% · ${st}<br>
    ${d.team_name ? 'קבוצת ' + escapeHTML(d.team_name) + ' · ' : ''}${fmtWhen(d.created_at)}</div>`;
}
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderCoverage() {
  covMarkers.forEach((m) => m.remove());
  covMarkers = [];
  const show = $('#tglCover').checked;
  // thin out for display: at most ~400 dots
  const step = Math.max(1, Math.floor(MAPSTATE.coverage.length / 400));
  MAPSTATE.coverage.filter((_, i) => i % step === 0).forEach((f) => {
    const el = document.createElement('div');
    el.className = 'cov-dot';
    el.title = 'לסיור מכאן';
    if (!show) el.style.display = 'none';
    el.onclick = (e) => { e.stopPropagation(); if (onTourRequest) onTourRequest(f); };
    covMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([f.lng, f.lat]).addTo(map));
  });
}

function renderHeat() {
  const src = map.getSource('det-heat');
  if (!src) return;
  src.setData({
    type: 'FeatureCollection',
    features: MAPSTATE.detections.map((d) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
      properties: { confidence: d.confidence },
    })),
  });
}

function renderLegend() {
  const counts = {};
  MAPSTATE.detections.forEach((d) => { counts[d.class_name] = (counts[d.class_name] || 0) + 1; });
  $('#mapLegend').innerHTML = Object.entries(counts)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, n]) => `<span class="lg"><i style="background:${classColor(name, CLASS_PALETTE)}"></i>${escapeHTML(name)} · ${n}</span>`)
    .join('');
}

// mini map for the tour view
let mini = null, miniMarker = null, miniClickCb = null;
export function initMiniMap() {
  if (mini) return mini;
  mini = new maplibregl.Map({
    container: 'miniMap', style: MAP_STYLE,
    center: [DEFAULT_CITY.center_lng, DEFAULT_CITY.center_lat],
    zoom: 13, attributionControl: false, interactive: true,
  });
  mini.on('click', (e) => { if (miniClickCb) miniClickCb(e.lngLat.lat, e.lngLat.lng); });
  return mini;
}
export function setMiniPos(lat, lng, fly = true) {
  if (!mini) return;
  if (!miniMarker) {
    const el = document.createElement('div');
    el.className = 'pin';
    el.style.color = '#22D3EE';
    miniMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(mini);
  } else miniMarker.setLngLat([lng, lat]);
  if (fly) mini.easeTo({ center: [lng, lat], duration: 500 });
}
export function onMiniClick(cb) { miniClickCb = cb; }
