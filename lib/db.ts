import { createClient } from '@supabase/supabase-js';
import { SB_URL, SB_KEY, BUCKET } from './config';
import type { Detection, CityModel, City, RouteRow, FrameRow } from './types';

export const sb = createClient(SB_URL, SB_KEY);

export const publicUrl = (path: string, bucket = BUCKET) =>
  sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;

export async function fetchCities(): Promise<City[]> {
  const { data, error } = await sb.from('sc_cities').select('*').order('created_at');
  if (error) throw error;
  return data as City[];
}

export async function fetchRoutes(cityId?: string): Promise<RouteRow[]> {
  let q = sb.from('sc_routes').select('*').order('created_at', { ascending: false }).limit(200);
  if (cityId) q = q.eq('city_id', cityId);
  const { data, error } = await q;
  if (error) throw error;
  return data as RouteRow[];
}

export async function fetchFrames(routeId: string, limit = 1000): Promise<FrameRow[]> {
  const { data, error } = await sb.from('sc_frames')
    .select('*').eq('route_id', routeId).order('seq').limit(limit);
  if (error) throw error;
  return data as FrameRow[];
}

// city scoping: at national scale every query must be bounded to the
// active city, or Sderot's map would pull Haifa's newest pins.
// ~0.2° ≈ 22km — generous box around the city center (geo index backed).
export interface GeoScope { lat: number; lng: number; radiusDeg?: number }
function scoped(q: any, s?: GeoScope | null) {
  if (!s) return q;
  const r = s.radiusDeg ?? 0.2;
  return q.gte('lat', s.lat - r).lte('lat', s.lat + r)
          .gte('lng', s.lng - r).lte('lng', s.lng + r);
}

export async function fetchCoverage(limit = 2000, scope?: GeoScope | null) {
  // sampled coverage points for the map (scale: don't pull every frame)
  const q = sb.from('sc_frames')
    .select('id, route_id, lat, lng, storage_path, seq')
    .order('created_at', { ascending: false }).limit(limit);
  const { data, error } = await scoped(q, scope);
  if (error) throw error;
  return data;
}

export async function insertRoute(row: object) {
  const { data, error } = await sb.from('sc_routes').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function insertFrames(rows: object[]) {
  const { error } = await sb.from('sc_frames').insert(rows);
  if (error) throw error;
}

export async function fetchModels(): Promise<CityModel[]> {
  const { data, error } = await sb.from('sc_models').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data as CityModel[];
}

export async function insertModel(row: object) {
  const { data, error } = await sb.from('sc_models').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function fetchDetections({ status = null as string | null, limit = 400, scope = null as GeoScope | null } = {}): Promise<Detection[]> {
  let q = sb.from('sc_detections').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status && status !== 'all') q = q.eq('status', status);
  const { data, error } = await scoped(q, scope);
  if (error) throw error;
  return data as Detection[];
}

// "where did MY photos go" — the resident's personal catch log
export async function fetchMyCatches(userId: string, limit = 20) {
  const { data, error } = await sb.from('sc_detections')
    .select('id, class_name, status, confidence, credits, crop_path, frame_path, created_at')
    .eq('detected_by', userId)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function insertDetection(row: object) {
  const { data, error } = await sb.from('sc_detections').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function setDetectionStatus(id: string, status: string) {
  const { error } = await sb.from('sc_detections').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function updateDetection(id: string, patch: object) {
  const { error } = await sb.from('sc_detections').update(patch).eq('id', id);
  if (error) throw error;
}

export async function uploadBlob(path: string, blob: Blob, contentType: string, bucket = BUCKET) {
  const up = await sb.storage.from(bucket).upload(path, blob, { contentType, upsert: false });
  if (up.error) throw up.error;
  return path;
}
