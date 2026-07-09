'use client';
// 🛠️ Workshop admin console (/admin) — gated to SUPER_ADMIN only.
// One screen to RUN parallel workshops: open/close classes, watch each
// class's live funnel (students → photos → tagged → model), see training
// jobs, and approve/block models.
import { useEffect, useState } from 'react';
import { authStore, initAuth, login, logout } from '@/lib/auth';
import { useStore, toast } from '@/lib/store';
import { sb } from '@/lib/db';
import { SUPER_ADMIN } from '@/lib/config';
import { fetchClasses, createClass, setClassActive, type WorkshopClass } from '@/lib/classes';
import { publicUrl } from '@/lib/db';

interface ClassStats {
  students: number; photos: number; tagged: number; today: number;
  model: { id: string; name: string; accuracy: number | null; approved: boolean; created_at: string } | null;
}
interface JobRow { id: string; team_name: string; status: string; image_count: number; created_at: string; completed_at: string | null }
interface PhotoRow { id: string; frame_path: string; class_name: string; team_name: string | null; created_at: string }

const PAGE = 60;

export default function AdminView() {
  const auth = useStore(authStore);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [classes, setClasses] = useState<WorkshopClass[]>([]);
  const [stats, setStats] = useState<Record<string, ClassStats>>({});
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const isSuper = !!auth.user && (auth.user.email || '').toLowerCase() === SUPER_ADMIN;
  useEffect(() => { initAuth(); }, []);   // /admin is a standalone page — boot auth here too

  async function loadAll() {
    try {
      const cls = await fetchClasses();
      setClasses(cls);
      // live stats per class, straight from the source tables
      const [dets, models, jobRows] = await Promise.all([
        sb.from('sc_detections').select('team_name, detected_by, bbox, created_at').limit(5000),
        sb.from('sc_models').select('id, name, team_name, accuracy, approved, created_at').order('created_at', { ascending: false }).limit(100),
        sb.from('sc_training_jobs').select('id, team_name, status, image_count, created_at, completed_at').order('created_at', { ascending: false }).limit(12),
      ]);
      const dayAgo = Date.now() - 864e5;
      const st: Record<string, ClassStats> = {};
      for (const c of cls) {
        const mine = (dets.data || []).filter((d: any) =>
          d.team_name === c.name || d.team_name === 'אישי · ' + c.name);
        const m = (models.data || []).find((x: any) =>
          x.team_name === c.name || x.team_name === 'אישי · ' + c.name);
        st[c.name] = {
          students: new Set(mine.map((d: any) => d.detected_by).filter(Boolean)).size,
          photos: mine.length,
          tagged: mine.filter((d: any) => d.bbox).length,
          today: mine.filter((d: any) => new Date(d.created_at).getTime() > dayAgo).length,
          model: m ? { id: m.id, name: m.name, accuracy: m.accuracy, approved: m.approved, created_at: m.created_at } : null,
        };
      }
      setStats(st);
      setJobs((jobRows.data || []) as JobRow[]);
    } catch (e: any) { toast('טעינה: ' + (e.message || e), true); }
  }

  useEffect(() => { if (isSuper) loadAll(); }, [isSuper]);
  useEffect(() => {
    if (!isSuper) return;
    const h = setInterval(loadAll, 20000);   // live-ish refresh while open
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper]);

  async function addClass() {
    const n = newName.trim();
    if (!n) return;
    setBusy(true);
    try { await createClass(n); setNewName(''); await loadAll(); toast('כיתה נפתחה: ' + n); }
    catch (e: any) { toast('יצירה: ' + (e.message || e), true); }
    setBusy(false);
  }
  async function toggleClass(c: WorkshopClass) {
    try { await setClassActive(c.id, !c.active); await loadAll(); }
    catch (e: any) { toast('עדכון: ' + (e.message || e), true); }
  }
  async function toggleModel(id: string, approved: boolean) {
    const { error } = await sb.from('sc_models').update({ approved: !approved }).eq('id', id);
    if (error) toast('מודל: ' + error.message, true); else await loadAll();
  }

  // ── photo gallery: every saved frame, filter by class, download ────
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [photoTeam, setPhotoTeam] = useState('');       // '' = all classes
  const [photoTotal, setPhotoTotal] = useState(0);
  const [zipBusy, setZipBusy] = useState('');
  async function loadPhotos(team = photoTeam, offset = 0) {
    let q = sb.from('sc_detections')
      .select('id, frame_path, class_name, team_name, created_at', { count: 'exact' })
      .not('frame_path', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (team) q = q.or(`team_name.eq."${team}",team_name.eq."אישי · ${team}"`);
    const { data, count, error } = await q;
    if (error) { toast('גלריה: ' + error.message, true); return; }
    setPhotoTotal(count || 0);
    setPhotos(offset === 0 ? (data || []) as PhotoRow[] : [...photos, ...(data || []) as PhotoRow[]]);
  }
  useEffect(() => { if (isSuper) loadPhotos(photoTeam, 0); /* eslint-disable-next-line */ }, [isSuper, photoTeam]);

  // download everything matching the filter as one ZIP (up to 1000)
  async function downloadZip() {
    setZipBusy('אוסף רשימה…');
    try {
      let q = sb.from('sc_detections')
        .select('frame_path, class_name, created_at')
        .not('frame_path', 'is', null)
        .order('created_at', { ascending: false }).limit(1000);
      if (photoTeam) q = q.or(`team_name.eq."${photoTeam}",team_name.eq."אישי · ${photoTeam}"`);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      let ok = 0;
      for (let i = 0; i < rows.length; i++) {
        setZipBusy(`מוריד ${i + 1}/${rows.length}…`);
        try {
          const res = await fetch(publicUrl(rows[i].frame_path));
          if (!res.ok) continue;
          const safe = (rows[i].class_name || 'ללא').replace(/[\\/:*?"<>|]/g, '_');
          zip.file(`${safe}/${String(i).padStart(4, '0')}.jpg`, await res.arrayBuffer());
          ok++;
        } catch { /* skip broken frame */ }
      }
      setZipBusy('אורז…');
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `smartcity-photos${photoTeam ? '-' + photoTeam : ''}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`✅ ${ok} תמונות ירדו כ-ZIP`);
    } catch (e: any) { toast('ZIP: ' + (e.message || e), true); }
    setZipBusy('');
  }

  // ── gate ────────────────────────────────────────────────────────────
  if (!auth.loaded) return <div className="admin-gate"><p>טוען…</p></div>;
  if (!auth.user) {
    return (
      <div className="admin-gate hud">
        <h2>🛠️ קונסולת ניהול סדנאות</h2>
        <p>כניסה למנהל בלבד</p>
        <input type="text" placeholder="אימייל" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="סיסמה" value={pass} onChange={(e) => setPass(e.target.value)} />
        <button className="primary" onClick={async () => {
          try { await login(email.trim(), pass); } catch (e: any) { toast(e.message || 'כניסה נכשלה', true); }
        }}>כניסה</button>
      </div>
    );
  }
  if (!isSuper) {
    return (
      <div className="admin-gate hud">
        <h2>⛔ אין גישה</h2>
        <p>הקונסולה זמינה רק למנהל המערכת ({SUPER_ADMIN})</p>
        <button className="ghost" onClick={() => logout()}>התנתקות</button>
      </div>
    );
  }

  // ── console ─────────────────────────────────────────────────────────
  return (
    <div className="admin">
      <header className="admin-head">
        <div>
          <h1>🛠️ ניהול סדנאות</h1>
          <p>{classes.filter((c) => c.active).length} כיתות פתוחות · רענון אוטומטי כל 20 שנ'</p>
        </div>
        <div className="admin-actions">
          <button className="ghost" onClick={loadAll}>רענן</button>
          <button className="ghost" onClick={() => logout()}>יציאה</button>
        </div>
      </header>

      {/* open a new class */}
      <div className="admin-new hud">
        <input type="text" placeholder='שם כיתה חדשה… למשל: "ט3 מקיף ד"' value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addClass(); }} />
        <button className="primary" disabled={busy || !newName.trim()} onClick={addClass}>+ פתח כיתה</button>
      </div>

      {/* per-class live funnel */}
      <div className="admin-grid">
        {classes.map((c) => {
          const s = stats[c.name];
          return (
            <div key={c.id} className={'admin-card hud' + (c.active ? '' : ' off')}>
              <div className="ac-head">
                <b>{c.name}</b>
                <button className={'ac-toggle' + (c.active ? ' on' : '')} onClick={() => toggleClass(c)}>
                  {c.active ? 'פתוחה' : 'סגורה'}
                </button>
              </div>
              {s ? (
                <>
                  <div className="ac-stats">
                    <span><b>{s.students}</b>תלמידים</span>
                    <span><b>{s.photos}</b>תמונות</span>
                    <span><b>{s.tagged}</b>מתויגות</span>
                    <span><b>{s.today}</b>היום</span>
                  </div>
                  {s.model ? (
                    <div className="ac-model">
                      <span className={'acm-dot' + (s.model.approved ? ' ok' : '')} />
                      <span className="acm-name">{s.model.name}</span>
                      <span className="acm-acc">{s.model.accuracy != null ? Math.round(+s.model.accuracy * 100) + '%' : '—'}</span>
                      <button className="acm-btn" onClick={() => toggleModel(s.model!.id, s.model!.approved)}>
                        {s.model.approved ? 'חסום' : 'אשר'}
                      </button>
                    </div>
                  ) : <div className="ac-model none">אין מודל עדיין</div>}
                </>
              ) : <div className="ac-model none">…</div>}
            </div>
          );
        })}
        {classes.length === 0 && <p className="hint">אין כיתות עדיין — פתחו אחת למעלה ⬆️</p>}
      </div>

      {/* training queue */}
      <h2 className="admin-sub">אימונים אחרונים</h2>
      <div className="admin-jobs hud">
        {jobs.map((j) => (
          <div key={j.id} className="aj-row">
            <span className={'aj-status ' + j.status}>{j.status === 'done' ? '✓ הושלם' : j.status === 'pending' ? '⏳ ממתין' : j.status}</span>
            <span className="aj-team">{j.team_name}</span>
            <span className="aj-n">{j.image_count} תמונות</span>
            <span className="aj-when">{new Date(j.created_at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
        {jobs.length === 0 && <p className="hint">אין אימונים עדיין</p>}
      </div>

      {/* 📸 photo gallery — every saved frame, filter by class, download */}
      <h2 className="admin-sub">גלריית תמונות <span className="admin-count">{photoTotal}</span></h2>
      <div className="admin-galbar hud">
        <select value={photoTeam} onChange={(e) => setPhotoTeam(e.target.value)}>
          <option value="">כל הכיתות</option>
          {classes.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <button className="primary" disabled={!!zipBusy || photoTotal === 0} onClick={downloadZip}>
          {zipBusy || `⬇️ הורד הכל כ-ZIP (${Math.min(photoTotal, 1000)})`}
        </button>
      </div>
      <div className="admin-gallery">
        {photos.map((ph) => (
          <a key={ph.id} className="ag-item" href={publicUrl(ph.frame_path)} download target="_blank" rel="noreferrer"
            title={`${ph.class_name} · ${ph.team_name || ''} · לחיצה = פתיחה/הורדה`}>
            <img src={publicUrl(ph.frame_path)} alt={ph.class_name} loading="lazy" />
            <span className="ag-cls">{ph.class_name}</span>
          </a>
        ))}
        {photos.length === 0 && <p className="hint">אין תמונות בסינון הזה</p>}
      </div>
      {photos.length < photoTotal && (
        <button className="ghost admin-more" onClick={() => loadPhotos(photoTeam, photos.length)}>
          טען עוד ({photos.length}/{photoTotal})
        </button>
      )}
    </div>
  );
}
