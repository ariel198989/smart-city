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

export async function fetchCrossingSpawns(centerLat: number, centerLng: number, radiusKm = 3): Promise<Spawn[]> {
  const key = `${centerLat.toFixed(2)}_${centerLng.toFixed(2)}`;
  if (spawnCache[key]) return spawnCache[key];
  const d = radiusKm / 111; // ~deg
  const bbox = `${centerLat - d},${centerLng - d},${centerLat + d},${centerLng + d}`;
  const q = `[out:json][timeout:20];node["highway"="crossing"](${bbox});out body 500;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error('Overpass ' + res.status);
  const json = await res.json();
  const spawns: Spawn[] = (json.elements || []).map((e: any) => ({
    id: 'osm' + e.id, lat: e.lat, lng: e.lon, kind: 'crossing',
  }));
  spawnCache[key] = spawns;
  return spawns;
}

// mission class ↔ crossing spawns (Hebrew keyword match)
export const isCrossingClass = (name: string) => /חצי|חציה|crosswalk|crossing/i.test(name);

// ---- credits (variable reward, Pokémon-GO style) ----
export function calcCredits({ conf = 0, nearSpawn = false, gated = true }: { conf?: number; nearSpawn?: boolean; gated?: boolean }) {
  if (!gated) return 5;                                // no AI gate available — small reward
  let c = 10 + Math.round(conf * 10);                  // base + confidence bonus (10-20)
  if (nearSpawn) c += 5;                               // mission-zone bonus
  return c;
}

// ---- auto-load the latest registered city model ("המטריצה הקיימת") ----
let modelLoadTried = false;
export async function ensureCityModel(): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (modelStore.get().ready) return { ok: true, name: modelStore.get().name };
  if (modelLoadTried) return { ok: false, error: 'כבר נוסה' };
  modelLoadTried = true;
  try {
    const models = await fetchModels();
    const m = models.find((x: any) => x.zip_path);
    if (!m) return { ok: false, error: 'אין עדיין מודל רשום — אמנו בסטודיו ולחצו "רשום כמודל הקבוצה"' };
    const res = await fetch(publicUrl(m.zip_path));
    if (!res.ok) throw new Error('הורדת מודל נכשלה');
    await loadModelFromZip(await res.blob(), m.name || m.team_name, Array.isArray(m.classes) ? m.classes : []);
    return { ok: true, name: m.name || m.team_name };
  } catch (e: any) {
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
