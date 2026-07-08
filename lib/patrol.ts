'use client';
// City Patrol game engine bits: real-world spawn points (OSM), credit math,
// distance helpers. Pokémon-GO-style loop grounded on real city data.
import { sb, publicUrl, fetchModels } from './db';
import { loadModelFromZip, modelStore } from './infer';

// ---- geo ----
export function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- spawn points: real crosswalks from OpenStreetMap (Overpass API) ----
export interface Spawn { id: string; lat: number; lng: number; kind: string }
const spawnCache: Record<string, Spawn[]> = {};

// Overpass mirrors — the main .de host often blocks CORS from the
// browser; kumi/coffee send the CORS header. Try each, give up quietly.
const OVERPASS_HOSTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export async function fetchCrossingSpawns(centerLat: number, centerLng: number, radiusKm = 3): Promise<Spawn[]> {
  const key = `${centerLat.toFixed(2)}_${centerLng.toFixed(2)}`;
  if (spawnCache[key]) return spawnCache[key];
  const d = radiusKm / 111; // ~deg
  const bbox = `${centerLat - d},${centerLng - d},${centerLat + d},${centerLng + d}`;
  const q = `[out:json][timeout:20];node["highway"="crossing"](${bbox});out body 500;`;
  const body = 'data=' + encodeURIComponent(q);
  for (const host of OVERPASS_HOSTS) {
    try {
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) continue;
      const json = await res.json();
      const spawns: Spawn[] = (json.elements || []).map((e: any) => ({
        id: 'osm' + e.id, lat: e.lat, lng: e.lon, kind: 'crossing',
      }));
      spawnCache[key] = spawns;   // cache even an empty result — stop retrying
      return spawns;
    } catch { /* try the next mirror */ }
  }
  spawnCache[key] = [];   // all mirrors down — game plays fine without spawns
  return [];
}

// mission class ↔ crossing spawns (Hebrew keyword match)
export const isCrossingClass = (name: string) => /חצי|חציה|crosswalk|crossing/i.test(name);

// ---- auto-pin: project the pin from the PHOTOGRAPHER onto the OBJECT ----
// distance from the bbox bottom edge (ground-plane heuristic: object whose
// base sits low in the frame is close; near the horizon line it's far)
export function estimateObjectDistanceM(bbox: { y: number; h: number }): number {
  const bottom = Math.min(1, bbox.y + bbox.h);       // 1 = frame bottom
  // ground-plane 1/x: base at frame bottom ≈ 2.7m, mid-frame ≈ 10m, near horizon → capped
  const d = 1.5 / Math.max(0.06, bottom - 0.45);
  return Math.min(25, Math.max(2, d));
}

// move lat/lng `meters` forward along compass heading (deg, 0=N)
export function projectForward(lat: number, lng: number, headingDeg: number, meters: number) {
  const rad = headingDeg * Math.PI / 180;
  return {
    lat: lat + (meters * Math.cos(rad)) / 111111,
    lng: lng + (meters * Math.sin(rad)) / (111111 * Math.cos(lat * Math.PI / 180)),
  };
}

// ---- credits (variable reward, Pokémon-GO style) ----
export function calcCredits({ conf = 0, nearSpawn = false, gated = true, newAngle = false }: { conf?: number; nearSpawn?: boolean; gated?: boolean; newAngle?: boolean }) {
  if (!gated) return 5;                                // no AI gate available — small reward
  let c = 10 + Math.round(conf * 10);                  // base + confidence bonus (10-20)
  if (nearSpawn) c += 5;                               // mission-zone bonus
  if (newAngle) c += 5;                                // angle-diversity bonus — new viewpoint!
  return c;
}

// ---- angle coverage: which compass sectors are already photographed
// around this spot for this class (agent's "I already have this angle") ----
export async function fetchCoveredSectors(lat: number, lng: number, className: string, radiusM = 30): Promise<number[]> {
  const d = radiusM / 111000; // ~deg
  const { data, error } = await sb.from('sc_detections')
    .select('lat, lng, heading')
    .eq('class_name', className)
    .neq('status', 'rejected')
    .not('heading', 'is', null)
    .gte('lat', lat - d).lte('lat', lat + d)
    .gte('lng', lng - d * 1.2).lte('lng', lng + d * 1.2)
    .limit(200);
  if (error) throw error;
  const sectors = new Set<number>();
  (data || []).forEach((r: any) => {
    if (distM(lat, lng, r.lat, r.lng) <= radiusM) {
      sectors.add(Math.round(((r.heading % 360) + 360) % 360 / 45) % 8);
    }
  });
  return [...sectors];
}

// ---- auto-load the latest registered city model ("המטריצה הקיימת") ----
let modelLoadTried = false;
export async function ensureCityModel(): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (modelStore.get().ready) return { ok: true, name: modelStore.get().name };
  if (modelLoadTried) return { ok: false, error: 'כבר נוסה' };
  modelLoadTried = true;
  try {
    const models = await fetchModels();
    // supply-chain gate: an ADMIN-approved model wins; before the first
    // approval exists (cold start) the newest registered one still loads
    const m = models.find((x: any) => x.zip_path && x.approved)
      || models.find((x: any) => x.zip_path);
    if (!m) return { ok: false, error: 'אין עדיין מודל רשום — אמנו בסטודיו ולחצו "רשום כמודל הקבוצה"' };
    // model ZIPs are immutable (unique path per version) → cache-first:
    // slow 3G downloads the model ONCE, every later app open is instant
    const url = publicUrl(m.zip_path);
    let res: Response | null = null;
    let cache: Cache | null = null;
    try {
      cache = await caches.open('sc-models-v1');
      res = (await cache.match(url)) || null;
    } catch { /* no Cache API (old webview) — plain fetch below */ }
    if (!res) {
      res = await fetch(url);
      if (!res.ok) throw new Error('הורדת מודל נכשלה');
      try {
        await cache?.keys().then((ks) => Promise.all(ks.map((k) => cache!.delete(k))));  // keep only the newest
        await cache?.put(url, res.clone());
      } catch { /* cache full — model still loads */ }
    }
    await loadModelFromZip(await res.blob(), m.name || m.team_name, Array.isArray(m.classes) ? m.classes : []);
    modelStore.set({ accuracy: (m as any).accuracy ?? null });   // show "how good" in the app
    return { ok: true, name: m.name || m.team_name };
  } catch (e: any) {
    modelLoadTried = false;   // a flaky download shouldn't block retry for the whole session
    return { ok: false, error: e.message || String(e) };
  }
}

// ---- monthly leaderboard (top catchers, city prizes for top 3) ----
export async function fetchMonthlyLeaderboard() {
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const { data, error } = await sb.from('sc_detections')
    .select('team_name, credits, status, created_at')
    .gte('created_at', monthStart.toISOString())
    .neq('status', 'rejected')
    .limit(2000);
  if (error) throw error;
  const byTeam: Record<string, { credits: number; catches: number }> = {};
  (data || []).forEach((d: any) => {
    const t = d.team_name || 'אנונימי';
    byTeam[t] = byTeam[t] || { credits: 0, catches: 0 };
    byTeam[t].credits += d.credits || 0;
    byTeam[t].catches += 1;
  });
  return Object.entries(byTeam)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.credits - a.credits);
}
