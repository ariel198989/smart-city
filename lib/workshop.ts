'use client';
// 🏫 Workshops OS bridge — the sibling console lives in the same Supabase
// project; ws_my_context() tells a student which group/sub-problem she was
// assigned. City users get NULL back and see no change at all.
import { sb } from './db';
import { authStore } from './auth';
import { createStore } from './store';

export interface WsSubproblem {
  title: string;
  statement?: string;
  task_type?: string;            // detect | classify | count
  target_classes?: string[];
  success_metric?: string;
}

export interface WsContext {
  workshop: { id: string; title: string; format?: string; starts_on?: string; ends_on?: string; status?: string };
  me: { participant_id: string; full_name: string; roles?: string[] };
  group: { id: string; number?: number; display_name?: string; team_name?: string };
  teammates?: { full_name: string; roles?: string[] }[];
  problem: { title: string; statement?: string; client_name?: string } | null;
  subproblem: WsSubproblem | null;
  sessions?: unknown[];
  progress?: unknown | null;
  certificate?: unknown | null;
}

// uid = whose context is cached (a re-login as someone else refetches);
// prefilled = the one-shot class prefill was already decided this session
export const wsContextStore = createStore<{ ctx: WsContext | null; uid: string; prefilled: boolean }>({
  ctx: null, uid: '', prefilled: false,
});

export const TASK_HE: Record<string, string> = { detect: 'זיהוי', classify: 'סיווג', count: 'ספירה' };

export async function fetchWorkshopContext(): Promise<WsContext | null> {
  const uid = authStore.get().user?.id || '';
  if (!uid) return null;
  const cached = wsContextStore.get();
  if (cached.uid === uid) return cached.ctx;   // fetched once per session
  try {
    const { data, error } = await sb.rpc('ws_my_context');
    if (error) return null;                     // not cached → retried next open
    wsContextStore.set({ ctx: (data as WsContext | null) || null, uid, prefilled: false });
    return wsContextStore.get().ctx;
  } catch {
    return null;
  }
}
