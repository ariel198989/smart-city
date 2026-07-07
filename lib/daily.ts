'use client';
// 🔥 streak + daily challenge — the "come back tomorrow" layer.
// Pure client-side (localStorage): zero backend, works offline, and the
// bonus flows through the normal credits path (DB caps credits at 40).

const STREAK_KEY = 'sc_streak_v1';
const DAILY_KEY = 'sc_daily_v1';
export const DAILY_TARGET = 3;    // catches that count for the bonus
export const DAILY_BONUS = 10;    // extra credits per counted catch

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);

// call once when patrol opens: extends / resets the day streak
export function touchStreak(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null') as { last: string; n: number } | null;
    let n = 1;
    if (raw?.last === today()) n = raw.n;
    else if (raw?.last === yesterday()) n = raw.n + 1;
    localStorage.setItem(STREAK_KEY, JSON.stringify({ last: today(), n }));
    return n;
  } catch { return 1; }
}

export function dailyProgress(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(DAILY_KEY) || 'null') as { date: string; count: number } | null;
    return raw?.date === today() ? raw.count : 0;
  } catch { return 0; }
}

// register a successful gated catch; returns the bonus earned (0 if done)
export function dailyCatch(): { bonus: number; count: number } {
  try {
    const count = dailyProgress();
    if (count >= DAILY_TARGET) return { bonus: 0, count };
    localStorage.setItem(DAILY_KEY, JSON.stringify({ date: today(), count: count + 1 }));
    return { bonus: DAILY_BONUS, count: count + 1 };
  } catch { return { bonus: 0, count: 0 }; }
}
