'use client';
// ☰ Command Drawer — the mobile home for everything that isn't
// "shoot now": training, pool, leaderboard, my log, account.
// Premium feel: brand-art hero, staggered item reveal, glass backdrop,
// swipe-to-close, safe-area aware. RTL: slides in from the right.
import { useEffect, useRef, useState } from 'react';
import { authStore, logout } from '@/lib/auth';
import { useStore } from '@/lib/store';
import { getHeading, SECTOR_NAMES, sectorOf } from '@/lib/compass';
import { fetchPoolStats, fetchPoolGallery, type PoolStats } from '@/lib/citypool';
import { publicUrl } from '@/lib/db';
import { DAILY_TARGET, DAILY_BONUS } from '@/lib/daily';

interface Props {
  open: boolean;
  onClose: () => void;
  credits: number;
  streak: number;
  dailyN: number;
  modelName: string;      // '' when no city model
  pocketClass: string;    // '' when no pocket model
  onTrainer: () => void;
  onTrainReal: () => void;
  onBoard: () => void;
  onMyLog: () => void;
}

export default function SideDrawer(p: Props) {
  const auth = useStore(authStore);
  const [pool, setPool] = useState(false);
  const [sensors, setSensors] = useState(false);

  // swipe right (RTL: toward the edge) closes
  const touchX = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) { touchX.current = e.touches[0].clientX; }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current != null && e.changedTouches[0].clientX - touchX.current > 70) p.onClose();
    touchX.current = null;
  }

  useEffect(() => {
    if (p.open && navigator.vibrate) navigator.vibrate(15);
  }, [p.open]);

  function go(fn: () => void) { p.onClose(); setTimeout(fn, 180); }  // let the drawer slide out first

  async function install() {
    const evt = (window as any).__scInstall;
    if (!evt) { alert('פתחו בתפריט הדפדפן: "הוספה למסך הבית"'); return; }
    evt.prompt(); await evt.userChoice;
    (window as any).__scInstall = null;
  }

  const item = (icon: string, label: string, sub: string, onClick: () => void, cls = '', badge = '') => (
    <button className={'dw-item ' + cls} onClick={onClick}>
      <span className="dw-ico">{icon}</span>
      <span className="dw-txt"><b>{label}</b><i>{sub}</i></span>
      {badge && <span className="dw-badge">{badge}</span>}
      <span className="dw-chev">‹</span>
    </button>
  );

  return (
    <>
      <div className={'drawer-back' + (p.open ? ' open' : '')} onClick={p.onClose} />
      <aside className={'drawer' + (p.open ? ' open' : '')} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {/* hero: brand art + identity + the numbers that matter */}
        <div className="dw-hero">
          <button className="dw-close" onClick={p.onClose}>✕</button>
          <div className="dw-team">{auth.team || 'אורח'}</div>
          <div className="dw-stats">
            <div className="dw-stat"><b>{p.credits}</b><span>💎 קרדיטים</span></div>
            <div className="dw-stat"><b>{p.streak}</b><span>🔥 ימים רצוף</span></div>
            <div className="dw-stat"><b>{p.dailyN}/{DAILY_TARGET}</b><span>🎯 היום</span></div>
          </div>
          <div className="dw-model">
            {p.modelName ? `🧠 מודל העיר: ${p.modelName}` : p.pocketClass ? `🎓 מודל כיס: ${p.pocketClass}` : '🧠 עוד אין מודל — אמנו אחד!'}
          </div>
        </div>

        <div className="dw-body">
          <div className="dw-sec">🧠 אימון</div>
          {item('🎓', 'מאמן הכיס', 'אמנו מודל אישי ב-30 שניות', () => go(p.onTrainer), 'd1')}
          {item('🚀', 'אימון אמיתי לעיר', 'הדאטה של כולם → מודל YOLO בענן', () => go(p.onTrainReal), 'd2 gold')}
          {item('🏙️', 'מאגר העיר', 'כל התמונות שהקהילה אספה', () => setPool(true), 'd3')}

          <div className="dw-sec">🎮 משחק</div>
          {item('🏆', 'מובילי החודש', '3 הראשונים זוכים בפרס מהעירייה', () => go(p.onBoard), 'd4')}
          {item('🗂️', 'התמונות שלי', 'כל צילום — ומה קרה איתו', () => go(p.onMyLog), 'd5')}
          {item('🎯', 'האתגר היומי', `${DAILY_TARGET} תפיסות = +${DAILY_BONUS} 💎 כל אחת`, () => { }, 'd6', p.dailyN >= DAILY_TARGET ? 'הושלם ✓' : `${p.dailyN}/${DAILY_TARGET}`)}

          <div className="dw-sec">⚙️ אני</div>
          {item('📲', 'התקנת האפליקציה', 'למסך הבית — כמו אפליקציה אמיתית', install, 'd7')}
          {item('🧭', 'בדיקת חיישנים', 'מצפן · GPS · מצלמה', () => setSensors(true), 'd8')}
          {auth.user
            ? item('👤', auth.user.email || 'החשבון שלי', 'התנתקות', () => { logout(); p.onClose(); }, 'd9')
            : item('👤', 'התחברות', 'כדי לתפוס ולצבור קרדיטים', () => { authStore.set({ viewer: false }); p.onClose(); }, 'd9')}
        </div>
      </aside>

      {pool && <PoolModal onClose={() => setPool(false)} />}
      {sensors && <SensorsModal onClose={() => setSensors(false)} />}
    </>
  );
}

// 🏙️ the community dataset, visible from the phone (was desktop-only)
function PoolModal({ onClose }: { onClose: () => void }) {
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
            <div><b>{stats.total}</b><span>תמונות</span></div>
            <div><b>{stats.byClass.length}</b><span>קטגוריות</span></div>
            <div><b>{stats.contributors}</b><span>תורמים</span></div>
          </div>
        )}
        {gallery.length > 0 && (
          <div className="dw-gallery">
            {gallery.map((g, i) => (
              <div key={i} className="dw-gimg">
                <img src={publicUrl(g.frame_path)} alt="" loading="lazy" />
                <span>{g.class_name}</span>
              </div>
            ))}
          </div>
        )}
        {!gallery.length && <div className="hint">הפול עוד ריק — כל תפיסה דרך שער ה-AI נכנסת לכאן אוטומטית 📸</div>}
        <div className="hint" style={{ marginTop: 8 }}>מכאן נולד המודל הבא: המאגר יורד לקולאב, מתאמן על GPU, וחוזר לכל טלפון בעיר.</div>
      </div>
    </div>
  );
}

// 🧭 live sensors self-test — "does my phone even have what the game needs?"
function SensorsModal({ onClose }: { onClose: () => void }) {
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
          ? <b style={{ color: 'var(--cy)' }}>{SECTOR_NAMES[sectorOf(heading)]} ({Math.round(heading)}°) — סובבו את הטלפון ותראו</b>
          : <span className="muted">אין אות — ייתכן שנדרש אישור חיישנים (iPhone) או שאין מגנטומטר</span>}
        </div>
        <div className="boxrow">🛰️ GPS: {gps === 'ok' ? <b style={{ color: 'var(--cy)' }}>פעיל</b> : gps === 'fail' ? <span style={{ color: 'var(--gold)' }}>חסום — אשרו מיקום בהגדרות הדפדפן</span> : <span className="muted">בודק…</span>}</div>
        <div className="hint" style={{ marginTop: 8 }}>שני החיישנים דרושים לשער הזוויות ולנעיצה האוטומטית של הפינים.</div>
      </div>
    </div>
  );
}
