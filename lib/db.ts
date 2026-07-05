import { createClient } from '@supabase/supabase-js';
import { SB_URL, SB_KEY, BUCKET } from './config';

export const sb = createClient(SB_URL, SB_KEY);

export const publicUrl = (path: string, bucket = BUCKET) =>
  sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;

export async function fetchCities() {
  const { data, error } = await sb.from('sc_cities').select('*').order('created_at');
  if (error) throw error;
  return data;
}

export async function fetchRoutes(cityId?: string) {
  let q = sb.from('sc_routes').select('*').order('created_at', { ascending: false }).limit(200);
  if (cityId) q = q.eq('city_id', cityId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function fetchFrames(routeId: string, limit = 1000) {
  const { data, error } = await sb.from('sc_frames')
    .select('*').eq('route_id', routeId).order('seq').limit(limit);
  if (error) throw error;
  return data;
}

export async function fetchCoverage(limit = 2000) {
  // sampled coverage points for the map (scale: don't pull every frame)
  const { data, error } = await sb.from('sc_frames')
    .select('id, route_id, lat, lng, storage_path, seq')
    .order('created_at', { ascending: false }).limit(limit);
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

export async function fetchModels() {
  const { data, error } = await sb.from('sc_models').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data;
}

export async function insertModel(row: object) {
  const { data, error } = await sb.from('sc_models').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function fetchDetections({ status = null as string | null, limit = 400 } = {}) {
  let q = sb.from('sc_detections').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status && status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data;
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

export async function uploadBlob(path: string, blob: Blob, contentType: string, bucket = BUCKET) {
  const up = await sb.storage.from(bucket).upload(path, blob, { contentType, upsert: false });
  if (up.error) throw up.error;
  return path;
}
