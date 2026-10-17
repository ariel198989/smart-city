'use client';
import { sb } from './db';
import { ADMINS } from './config';
import { createStore } from './store';

export interface AuthState {
  user: { id: string; email?: string } | null;
  team: string;
  admin: boolean;
  viewer: boolean;
  loaded: boolean;
}

export const authStore = createStore<AuthState>({ user: null, team: '', admin: false, viewer: false, loaded: false });

const teamOf = (u: { email?: string; user_metadata?: Record<string, any> } | null) =>
  (u?.user_metadata?.class_name as string) || u?.email?.split('@')[0] || '';

// the cached JWT's class_name goes stale when an instructor moves a student
// to another group (rewritten server-side) — getUser() reads it fresh.
// Runs AFTER first render and is never awaited by initAuth, so it adds no
// blocking round-trip; offline/error → keep the session's team.
async function refreshTeam(uid: string) {
  try {
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user || data.user.id !== uid) return;
    const team = teamOf(data.user);
    const cur = authStore.get();
    if (cur.user?.id === uid && cur.team !== team) authStore.set({ team });
  } catch { /* offline — the session's team stays */ }
}

export async function initAuth() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const user = session?.user || null;
    const team = teamOf(user);
    const admin = !!(user && ADMINS.includes((user.email || '').toLowerCase()));
    authStore.set({ user, team, admin, loaded: true });
    if (user) void refreshTeam(user.id);
  } catch {
    authStore.set({ loaded: true });
  }
}

export async function login(email: string, pass: string) {
  const r = await sb.auth.signInWithPassword({ email, password: pass });
  if (r.error) throw r.error;
  await initAuth();
}

export async function signup(email: string, pass: string, team: string) {
  const r = await sb.auth.signUp({ email, password: pass, options: { data: { class_name: team } } });
  if (r.error) throw r.error;
  if (!r.data.session) return false; // email confirm required
  await initAuth();
  return true;
}

export async function logout() {
  await sb.auth.signOut();
  location.reload();
}
