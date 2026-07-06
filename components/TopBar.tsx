'use client';
import { useEffect, useState } from 'react';
import { authStore, logout } from '@/lib/auth';
import { useStore } from '@/lib/store';
import { fetchCities } from '@/lib/db';
import { DEFAULT_CITY } from '@/lib/config';
import { cityStore } from '@/components/MapView';

export type ViewName = 'map' | 'patrol' | 'tour' | 'studio' | 'board' | 'factory';

const TABS: { id: ViewName; label: string; admin?: boolean }[] = [
  { id: 'map', label: 'מפת העיר' },
  { id: 'patrol', label: '🎮 פטרול' },
  { id: 'tour', label: 'סיור ברחובות' },
  { id: 'studio', label: 'סטודיו אימון' },
  { id: 'board', label: 'לוח מפגעים' },
  { id: 'factory', label: 'מפעל הדאטה', admin: true },
];

export default function TopBar({ view, onView }: { view: ViewName; onView: (v: ViewName) => void }) {
  const auth = useStore(authStore);
  const [cities, setCities] = useState<any[]>([DEFAULT_CITY]);

  useEffect(() => {
    fetchCities().then(setCities).catch(() => {});
  }, []);

  return (
    <header className="topbar hud">
      <div className="logo">
        SMART<span className="accent">CITY</span>
        <span className="beacon" />
      </div>
      <nav className="tabs">
        {TABS.filter((t) => !t.admin || auth.admin).map((t) => (
          <button key={t.id} className={view === t.id ? 'on' : ''} onClick={() => onView(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="userbox">
        <select
          title="עיר"
          onChange={(e) => {
            const c = cities[+e.target.value];
            if (c) cityStore.set({ city: c, flyAt: Date.now() });
          }}
        >
          {cities.map((c, i) => (
            <option key={c.name} value={i}>{c.name}</option>
          ))}
        </select>
        {auth.user ? (
          <>
            {auth.team && <span className="pill">{auth.team}</span>}
            <button className="ghost" style={{ fontSize: 12 }} onClick={logout}>יציאה</button>
          </>
        ) : (
          <button className="ghost" style={{ fontSize: 12 }} onClick={() => authStore.set({ viewer: false })}>
            כניסה
          </button>
        )}
      </div>
    </header>
  );
}
