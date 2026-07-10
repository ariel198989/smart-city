'use client';
// 🎯 "מה מאמנים השבוע" — the admin's weekly city training mission.
// Define target classes + a date window + a photo goal; activate to make
// it THE live mission every phone sees; watch the data pour in per class.
import { useEffect, useState } from 'react';
import { toast } from '@/lib/store';
import {
  fetchCampaigns, createCampaign, setCampaignStatus, fetchCampaignProgress,
  type Campaign, type CampaignProgress,
} from '@/lib/campaigns';
import { buildCityPoolZip } from '@/lib/citypool';
import { download } from '@/lib/util';

const STATUS_LABEL: Record<Campaign['status'], string> = {
  draft: '📝 טיוטה', active: '🔴 חי עכשיו', done: '✓ הסתיים', cancelled: '✕ בוטל',
};

export default function AdminCampaigns() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [progress, setProgress] = useState<Record<string, CampaignProgress>>({});
  const [title, setTitle] = useState('');
  const [classesTxt, setClassesTxt] = useState('');
  const [goal, setGoal] = useState(500);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const rows = await fetchCampaigns();
      setItems(rows);
      // progress only where photos can exist (active/done)
      const live = rows.filter((c) => c.status === 'active' || c.status === 'done').slice(0, 6);
      const entries = await Promise.all(live.map(async (c) => {
        try { return [c.id, await fetchCampaignProgress(c.id)] as const; }
        catch { return null; }
      }));
      setProgress(Object.fromEntries(entries.filter(Boolean) as [string, CampaignProgress][]));
    } catch (e: any) { toast('קמפיינים: ' + (e.message || e), true); }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    const classes = classesTxt.split(',').map((s) => s.trim()).filter(Boolean);
    if (!title.trim() || classes.length === 0) { toast('צריך כותרת + לפחות קטגוריה אחת', true); return; }
    setBusy(true);
    try {
      const now = new Date();
      await createCampaign({
        title: title.trim(), classes, goal_images: goal,
        starts_at: now.toISOString(),
        ends_at: new Date(now.getTime() + days * 86400000).toISOString(),
      });
      setTitle(''); setClassesTxt('');
      await load();
      toast('קמפיין נוצר כטיוטה — הפעילו כשמוכנים');
    } catch (e: any) { toast('יצירה: ' + (e.message || e), true); }
    setBusy(false);
  }

  // ⬇️ the payoff: a week of city-wide shooting → ONE focused YOLO dataset
  const [zipBusy, setZipBusy] = useState('');
  async function downloadDataset(c: Campaign) {
    setZipBusy(c.id);
    try {
      const built = await buildCityPoolZip(() => {}, undefined, c.id);
      if (!built || (built as any).error || !built.blob) {
        toast((built as any)?.error || 'אין עדיין תמונות מתויגות בקמפיין (תיוג = תיבה על התמונה)', true);
      } else {
        download(built.blob, `campaign_${c.title.replace(/\s+/g, '_')}.zip`);
        toast(`⬇️ ${built.count} תמונות מתויגות · ${built.classes.length} קטגוריות — ל-Colab!`);
      }
    } catch (e: any) { toast('הורדה: ' + (e.message || e), true); }
    setZipBusy('');
  }

  async function setStatus(c: Campaign, status: Campaign['status']) {
    try {
      await setCampaignStatus(c.id, status);
      await load();
      if (status === 'active') toast('🔴 "' + c.title + '" חי — כל טלפון בעיר רואה את המשימה');
    } catch (e: any) { toast('עדכון: ' + (e.message || e), true); }
  }

  return (
    <>
      <h2 className="admin-sub">🎯 מה מאמנים השבוע</h2>
      <div className="admin-new hud" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input type="text" placeholder='כותרת המשימה… למשל: "שבוע הבורות בכביש"' value={title}
          onChange={(e) => setTitle(e.target.value)} style={{ flex: '2 1 220px' }} />
        <input type="text" placeholder="קטגוריות, מופרדות בפסיק: בור בכביש, מדרכה שקועה" value={classesTxt}
          onChange={(e) => setClassesTxt(e.target.value)} style={{ flex: '2 1 220px' }} />
        <select value={goal} onChange={(e) => setGoal(+e.target.value)}>
          <option value={200}>יעד: 200 תמונות</option>
          <option value={500}>יעד: 500 תמונות</option>
          <option value={1000}>יעד: 1000 תמונות</option>
          <option value={2000}>יעד: 2000 תמונות</option>
        </select>
        <select value={days} onChange={(e) => setDays(+e.target.value)}>
          <option value={7}>שבוע</option>
          <option value={14}>שבועיים</option>
        </select>
        <button className="primary" disabled={busy} onClick={add}>+ צור משימה</button>
      </div>

      <div className="admin-jobs hud">
        {items.map((c) => {
          const p = progress[c.id];
          const pct = p ? Math.min(100, Math.round((p.total / Math.max(1, c.goal_images)) * 100)) : 0;
          return (
            <div key={c.id} className="aj-row" style={{ flexWrap: 'wrap', rowGap: 6 }}>
              <span className={'aj-status ' + (c.status === 'active' ? 'done' : c.status)}>{STATUS_LABEL[c.status]}</span>
              <span className="aj-team" style={{ fontWeight: 700 }}>{c.title}</span>
              <span className="aj-n">{c.classes.join(' · ')}</span>
              <span className="aj-when">
                עד {new Date(c.ends_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}
              </span>
              {p && (
                <span className="aj-n" title={p.by_class.map((b) => `${b.name}: ${b.count}`).join(' · ')}>
                  📸 {p.total}/{c.goal_images} ({pct}%) · 👥 {p.contributors}
                </span>
              )}
              {c.status === 'draft' && (
                <span style={{ display: 'flex', gap: 6 }}>
                  <button className="acm-btn" onClick={() => setStatus(c, 'active')}>🔴 הפעל</button>
                  <button className="acm-btn" onClick={() => setStatus(c, 'cancelled')}>בטל</button>
                </span>
              )}
              {c.status === 'active' && (
                <button className="acm-btn" onClick={() => setStatus(c, 'done')}>סיים</button>
              )}
              {(c.status === 'active' || c.status === 'done') && (
                <button className="acm-btn" disabled={zipBusy === c.id} onClick={() => downloadDataset(c)}>
                  {zipBusy === c.id ? 'אורז…' : '⬇️ דאטהסט'}
                </button>
              )}
            </div>
          );
        })}
        {items.length === 0 && <p className="hint">אין משימות עדיין — צרו את "מה מאמנים השבוע" הראשון ⬆️</p>}
      </div>
    </>
  );
}
