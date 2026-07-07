'use client';
// 📱 Mobile navigation done right: bottom tab bar (one-hand reach) +
// two full-screen hubs that slide up from the bottom.
// אימון hub = the END-TO-END journey as a visible stepper: the user
// always knows which step they're on and WHOSE turn it is (phone /
// desktop / Colab). No hidden menus, no dead ends.
import { useEffect, useState } from 'react';
import { authStore, logout } from '@/lib/auth';
import { useStore } from '@/lib/store';
import { modelStore } from '@/lib/infer';
import { pocketStore } from '@/lib/pocket';
import { getHeading, SECTOR_NAMES, sectorOf } from '@/lib/compass';
import { fetchPoolStats, fetchUntaggedPhoneShots, type PoolStats } from '@/lib/citypool';
import { fetchJobs, type TrainJob } from '@/lib/trainjobs';
import { publicUrl } from '@/lib/db';
import { fetchPoolGallery } from '@/lib/citypool';
import { DAILY_TARGET, DAILY_BONUS } from '@/lib/daily';

export type MobileTab = 'map' | 'cam' | 'train' | 'me';

/* ─── bottom tab bar — RTL order: map (home) on the right ─── */
export function BottomBar({ active, onTab }: { active: MobileTab; onTab: (t: MobileTab) => void }) {
  const tab = (id: MobileTab, icon: string, label: string) => (
    <button className={'bb-tab' + (active === id ? ' on' : '')}
      onClick={() => { if (navigator.vibrate) navigator.vibrate(10); onTab(id); }}>
      <span className="bb-ico">{icon}</span>
      <span className="bb-lbl">{label}</span>
    </button>
  );
  return (
    <nav className="bottombar">
      {tab('map', '🗺️', 'מפה')}
      {tab('cam', '🎥', 'מצלמה')}
      {tab('train', '🧠', 'אימון')}
      {tab('me', '👤', 'אני')}
    </nav>
  );
}

/* ─── TWO WORLDS, cleanly separated:
   🎓 personal pocket training (the feel, 30s, on-device) vs
   🏭 the GROUP machine: shoot series → tag on phone → shared pool
   (merging is automatic) → cloud training → model for everyone ─── */
interface TrainHubProps {
  onClose: () => void;
  mission: string;           // the class the group agreed on
  myUntagged: number | null; // my shots waiting for a bbox
  onTrainer: () => void;     // opens PocketTrainer
  onTrainReal: () => void;   // opens the cloud-training modal
  onSeries: () => void;      // opens burst series capture
  onTagger: () => void;      // opens the phone tagger
}

export function TrainingHub({ onClose, mission, myUntagged, onTrainer, onTrainReal, onSeries, onTagger }: TrainHubProps) {
  const model = useStore(modelStore);
  const pocket = useStore(pocketStore);
  const [pool, setPool] = useState<PoolStats | null>(null);
  const [job, setJob] = useState<TrainJob | null | 'none'>(null);
  useEffect(() => {
    fetchPoolStats().then(setPool).catch(() => {});
    fetchJobs(1).then((j) => setJob(j[0] || 'none')).catch(() => setJob('none'));
  }, []);

  const tagged = pool?.total || 0;
  const contributors = pool?.contributors || 0;
  const pendingJob = job && job !== 'none' && job.status === 'pending' ? job : null;
  const weakest = pool?.byClass.length ? Math.min(...pool.byClass.map((c) => c.count)) : 0;
  const ready = tagged > 0 && weakest >= 50;

  // the group machine, step by step — each tagged with WHOSE turn it is
  const steps = [
    {
      icon: '📸', who: '📱 אתם', title: `צלמו סדרה של ${mission}`,
      body: 'המצלמה צולמת לבד כל 1.5 שניות — פשוט מסתובבים סביב האובייקט. 60 תמונות בדקה וחצי, מכל הזוויות.',
      cta: { label: '📸 צלמו סדרה', run: onSeries, hot: false },
      done: (myUntagged || 0) > 0 || tagged > 0,
    },
    {
      icon: '🏷️', who: '📱 אתם', title: 'תייגו בטלפון',
      body: myUntagged
        ? `${myUntagged} תמונות שלכם מחכות לתיבה — גוררים אצבע סביב האובייקט, שמור, הבא. דקות ספורות.`
        : 'אין תמונות בהמתנה כרגע. אחרי צילום סדרה — התיוג כאן. (תיוג עדין יותר אפשרי גם בדסקטופ בסטודיו.)',
      cta: myUntagged ? { label: `🏷️ תייגו ${myUntagged} תמונות`, run: onTagger, hot: true } : null,
      done: tagged > 0 && !myUntagged,
    },
    {
      icon: '🤝', who: '🤖 אוטומטי', title: 'המאגר המשותף — האיחוד קורה לבד',
      body: `כל תמונה מתויגת של כל חבר קבוצה נכנסת לאותו מאגר: כרגע ${tagged} תמונות מ-${contributors} תורמים` +
        (pool && tagged > 0 ? ` · הקטגוריה הדלה: ${weakest} (יעד 50+, ‏150+ = מצוין)` : '') +
        '. 60 תמונות שלך לבד = מודל חלש; 400 של כולם = מודל אמיתי.',
      cta: null,
      done: ready,
    },
    {
      icon: '🚀', who: pendingJob ? '☁️ הענן — תורו' : '📱 אתם', title: 'אימון בענן (GPU)',
      body: pendingJob
        ? `משימה פתוחה (${pendingJob.image_count} תמונות) — פתחו את המחברת, Run all, ‏~15 דק'. היא מוצאת את המשימה לבד.`
        : 'כפתור אחד: הטלפון אורז את המאגר המשותף ופותח משימת אימון. ההמשך במחברת (מחשב או טלפון).',
      cta: { label: pendingJob ? '☁️ המשך במחברת' : '🚀 התחל אימון קבוצתי', run: onTrainReal, hot: true },
      done: !!(job && job !== 'none' && job.status === 'done'),
    },
    {
      icon: '📲', who: '🤖 אוטומטי', title: 'המודל אצל כולם',
      body: model.ready
        ? `✅ פעיל: ${model.name} — כל טלפון בעיר משתמש בו עכשיו.`
        : 'כשהמודל נרשם — כל טלפון מקבל אותו אוטומטית, והמשחק נהיה חכם.',
      cta: null,
      done: model.ready,
    },
  ];

  return (
    <section className="hub">
      <header className="hub-head">
        <button className="ghost hub-close" onClick={onClose}>✕</button>
        <b>🧠 אימון</b>
        <span>שני עולמות: להרגיש איך AI לומד · ולבנות מודל אמיתי ביחד</span>
      </header>
      <div className="hub-body">
        {/* world 1: the personal feel — deliberately small and separate */}
        <div className="world hud">
          <div className="world-head">
            <b>🎓 אימון אישי — להרגיש את זה</b>
            <span className="step-who">📱 30 שניות · במכשיר</span>
          </div>
          <p>{pocket.ready ? `המודל האישי שלכם מזהה "${pocket.className}".` : 'מודל צעצוע שלומד על הטלפון — בלי ענן. ככה מבינים מה זה אימון.'}</p>
          <button className="primary" style={{ width: '100%' }} onClick={onTrainer}>
            {pocket.ready ? '🎓 אמן מחדש / שחק איתו' : '🎓 נסו — 30 שניות'}
          </button>
        </div>

        {/* world 2: the group machine */}
        <div className="world-sep">🏭 אימון קבוצתי אמיתי — המכונה</div>
        {steps.map((s, i) => (
          <div key={i} className={'step' + (s.done ? ' done' : '')}>
            <div className="step-rail">
              <span className="step-dot">{s.done ? '✓' : i + 1}</span>
              {i < steps.length - 1 && <span className="step-line" />}
            </div>
            <div className="step-card hud">
              <div className="step-top">
                <span className="step-ico">{s.icon}</span>
                <b>{s.title}</b>
                <span className="step-who">{s.who}</span>
              </div>
              <p>{s.body}</p>
              {s.cta && <button className={s.cta.hot ? 'hot' : 'primary'} style={{ width: '100%' }} onClick={s.cta.run}>{s.cta.label}</button>}
            </div>
          </div>
        ))}
        <div className="hint" style={{ margin: '4px 2px 14px' }}>
          💡 מחליפים קטגוריה? בוחרים 🎯 משימה במסך המפה — הסדרה מצטלמת לקטגוריה הנבחרת.
        </div>
      </div>
    </section>
  );
}

/* ─── אני hub: my stuff + community + device ─── */
interface MeHubProps {
  onClose: () => void;
  onMyLog: () => void;
  onBoard: () => void;
  credits: number; streak: number; dailyN: number;
}

export function MeHub({ onClose, onMyLog, onBoard, credits, streak, dailyN }: MeHubProps) {
  const auth = useStore(authStore);
  const [pool, setPool] = useState(false);
  const [sensors, setSensors] = useState(false);

  async function install() {
    const evt = (window as any).__scInstall;
    if (!evt) { alert('פתחו בתפריט הדפדפן: "הוספה למסך הבית"'); return; }
    evt.prompt(); await evt.userChoice;
    (window as any).__scInstall = null;
  }

  const row = (icon: string, label: string, sub: string, run: () => void, badge = '') => (
    <button className="me-row" onClick={run}>
      <span className="dw-ico">{icon}</span>
      <span className="dw-txt"><b>{label}</b><i>{sub}</i></span>
      {badge && <span className="dw-badge">{badge}</span>}
      <span className="dw-chev">‹</span>
    </button>
  );

  return (
    <section className="hub">
      <header className="hub-head">
        <button className="ghost hub-close" onClick={onClose}>✕</button>
        <b>👤 {auth.team || 'אורח'}</b>
        <span>{auth.user?.email || 'לא מחוברים — הצטרפו למשחק'}</span>
      </header>
      <div className="hub-body">
        <div className="dw-stats" style={{ margin: '2px 2px 12px' }}>
          <div className="dw-stat"><b>{credits}</b><span>💎 קרדיטים</span></div>
          <div className="dw-stat"><b>{streak}</b><span>🔥 רצף ימים</span></div>
          <div className="dw-stat"><b>{dailyN}/{DAILY_TARGET}</b><span>🎯 אתגר היום</span></div>
        </div>
        {row('🗂️', 'התמונות שלי', 'כל צילום — ומה קרה איתו', onMyLog)}
        {row('🏆', 'מובילי החודש', '3 הראשונים זוכים בפרס מהעירייה', onBoard)}
        {row('🏙️', 'מאגר העיר', 'התמונות של כל הקהילה', () => setPool(true))}
        {row('🎯', 'האתגר היומי', `${DAILY_TARGET} תפיסות = +${DAILY_BONUS} 💎 כל אחת`, () => {}, dailyN >= DAILY_TARGET ? 'הושלם ✓' : `${dailyN}/${DAILY_TARGET}`)}
        {row('📲', 'התקנת האפליקציה', 'למסך הבית — כמו אפליקציה אמיתית', install)}
        {row('🧭', 'בדיקת חיישנים', 'מצפן · GPS — לפני יציאה לשטח', () => setSensors(true))}
        {auth.user
          ? row('🚪', 'התנתקות', auth.user.email || '', () => { logout(); onClose(); })
          : row('🔑', 'התחברות', 'כדי לתפוס ולצבור קרדיטים', () => { authStore.set({ viewer: false }); onClose(); })}
      </div>
      {pool && <PoolModal onClose={() => setPool(false)} />}
      {sensors && <SensorsModal onClose={() => setSensors(false)} />}
    </section>
  );
}

/* 🏙️ community pool — stats + gallery, phone-sized */
export function PoolModal({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [gallery, setGallery] = useState<any[]>([]);
  useEffect(() => {
    fetchPoolStats().then(setStats).catch(() => {});
    fetchPoolGallery(9).then(setGallery).catch(() => {});
  }, []);
  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card hud det-modal">
        <button className="ghost mclose" onClick={onClose}>✕</button>
        <h3 style={{ fontSize: 14, letterSpacing: '.2em' }}>🏙️ מאגר האימון של העיר</h3>
        {stats && (
          <div className="dw-poolstats">
            <div><b>{stats.total}</b><span>מתויגות</span></div>
            <div><b>{stats.byClass.length}</b><span>קטגוריות</span></div>
            <div><b>{stats.contributors}</b><span>תורמים</span></div>
          </div>
        )}
        {gallery.length > 0 ? (
          <div className="dw-gallery">
            {gallery.map((g, i) => (
              <div key={i} className="dw-gimg">
                <img src={publicUrl(g.frame_path)} alt="" loading="lazy" />
                <span>{g.class_name}</span>
              </div>
            ))}
          </div>
        ) : <div className="hint">כל תפיסה דרך שער ה-AI נכנסת לכאן אוטומטית 📸</div>}
        <div className="hint" style={{ marginTop: 8 }}>מכאן נולד המודל הבא: המאגר יורד לענן, מתאמן, וחוזר לכל טלפון בעיר.</div>
      </div>
    </div>
  );
}

/* 🧭 live sensors self-test */
export function SensorsModal({ onClose }: { onClose: () => void }) {
  const [heading, setHeading] = useState<number | null>(null);
  const [gps, setGps] = useState<'wait' | 'ok' | 'fail'>('wait');
  useEffect(() => {
    const h = setInterval(() => setHeading(getHeading()), 300);
    navigator.geolocation?.getCurrentPosition(() => setGps('ok'), () => setGps('fail'), { timeout: 8000 });
    return () => clearInterval(h);
  }, []);
  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card hud det-modal">
        <button className="ghost mclose" onClick={onClose}>✕</button>
        <h3 style={{ fontSize: 14, letterSpacing: '.2em' }}>🧭 בדיקת חיישנים</h3>
        <div className="boxrow">🧭 מצפן: {heading != null
          ? <b style={{ color: 'var(--cy)' }}>{SECTOR_NAMES[sectorOf(heading)]} ({Math.round(heading)}°) — סובבו ותראו</b>
          : <span className="muted">אין אות — ייתכן שנדרש אישור חיישנים (iPhone)</span>}
        </div>
        <div className="boxrow">🛰️ GPS: {gps === 'ok' ? <b style={{ color: 'var(--cy)' }}>פעיל</b> : gps === 'fail' ? <span style={{ color: 'var(--gold)' }}>חסום — אשרו מיקום בהגדרות</span> : <span className="muted">בודק…</span>}</div>
        <div className="hint" style={{ marginTop: 8 }}>שניהם דרושים לשער הזוויות ולנעיצת פינים אוטומטית.</div>
      </div>
    </div>
  );
}
