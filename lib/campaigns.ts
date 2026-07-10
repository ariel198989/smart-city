'use client';
// 🎯 weekly training campaigns — "מה מאמנים השבוע"
// admin defines the city's training mission (classes + window + goal);
// every participant's photos get campaign_id so a week of city-wide
// shooting lands as ONE focused dataset.
import { sb } from './db';

export interface Campaign {
  id: string;
  title: string;
  description: string | null;
  classes: string[];
  goal_images: number;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'active' | 'done' | 'cancelled';
  result_model_id: string | null;
  created_at: string;
}

export interface CampaignProgress {
  total: number;
  contributors: number;
  by_class: { name: string; count: number }[];
}

// the ONE live city mission (unique index guarantees at most one active)
export async function fetchActiveCampaign(): Promise<Campaign | null> {
  const { data, error } = await sb.from('sc_campaigns')
    .select('*').eq('status', 'active')
    .lte('starts_at', new Date().toISOString())
    .gte('ends_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchCampaigns(limit = 20): Promise<Campaign[]> {
  const { data, error } = await sb.from('sc_campaigns')
    .select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function createCampaign(c: {
  title: string; description?: string; classes: string[];
  goal_images: number; starts_at: string; ends_at: string;
}): Promise<Campaign> {
  const { data, error } = await sb.from('sc_campaigns')
    .insert({ ...c, status: 'draft' }).select().single();
  if (error) throw error;
  return data;
}

// activating a campaign closes any currently-active one first
// (the partial unique index allows only one 'active' row)
export async function setCampaignStatus(id: string, status: Campaign['status']): Promise<void> {
  if (status === 'active') {
    const { error: closeErr } = await sb.from('sc_campaigns')
      .update({ status: 'done' }).eq('status', 'active').neq('id', id);
    if (closeErr) throw closeErr;
  }
  const { error } = await sb.from('sc_campaigns').update({ status }).eq('id', id);
  if (error) throw error;
}

// server-side aggregate — correct at any scale (no PostgREST row caps)
export async function fetchCampaignProgress(id: string): Promise<CampaignProgress> {
  const { data, error } = await sb.rpc('sc_campaign_progress', { cid: id });
  if (error) throw error;
  return data as CampaignProgress;
}
