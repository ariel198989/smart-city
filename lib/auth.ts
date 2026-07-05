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

export async function initAuth() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const user = session?.user || null;
    const team = (user?.user_metadata?.class_name as string) || user?.email?.split('@')[0] || '';
    const admin = !!(user && ADMINS.includes((user.email || '').toLowerCase()));
    authStore.set({ user, team, admin, loaded: true });
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
