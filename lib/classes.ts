'use client';
// managed workshop classes — signup picks from this list, the admin
// console (/admin) opens/closes them. RLS: read=everyone, write=admin.
import { sb } from './db';

export interface WorkshopClass { id: string; name: string; active: boolean; created_at: string }

export async function fetchClasses(activeOnly = false): Promise<WorkshopClass[]> {
  let q = sb.from('sc_classes').select('*').order('created_at', { ascending: false });
  if (activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as WorkshopClass[];
}

export async function createClass(name: string): Promise<void> {
  const { error } = await sb.from('sc_classes').insert({ name: name.trim() });
  if (error) throw error;
}

export async function setClassActive(id: string, active: boolean): Promise<void> {
  const { error } = await sb.from('sc_classes').update({ active }).eq('id', id);
  if (error) throw error;
}
