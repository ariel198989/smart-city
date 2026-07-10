'use client';
// 🚀 Real training, started from the phone:
// 1) build+upload the city dataset, open a job
// 2) open the Colab notebook (it auto-fetches the pending job)
// 3) come back and upload the trained model — the whole city gets it
import { useEffect, useState } from 'react';
import { COLAB } from '@/lib/config';
import { authStore } from '@/lib/auth';
import { useStore, toast, bumpData } from '@/lib/store';
import { startTrainingJob, registerTrainedModel, fetchJobs, cancelJob, type TrainJob } from '@/lib/trainjobs';
import { fetchPoolStats, fetchMyTaggedCount, type PoolStats } from '@/lib/citypool';

// scope 'mine' = a student's personal model on her own photos;
// 'all' = the class-merged city dataset
export default function TrainReal({ onClose, scope = 'all' }: { onClose: () => void; scope?: 'mine' | 'all' }) {
  const auth = useStore(authStore);
  const [jobs, setJobs] = useState<TrainJob[]>([]);
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [regBusy, setRegBusy] = useState(false);

  const [pool, setPool] = useState<PoolStats | null>(null);
  const [mine, setMine] = useState<number | null>(null);
  // scope-aware job fetch — see only MY (or my team's) jobs, so another
  // student's pending job never blocks or gets claimed as mine
  const jobsFor = () => fetchJobs(5, { userId: auth.user?.id, team: auth.team || null, scope });
  useEffect(() => {
    jobsFor().then(setJobs).catch(() => {});
    if (scope === 'all') fetchPoolStats().then(setPool).catch(() => {});
    else if (auth.user) fetchMyTaggedCount(auth.user.id).then(setMine).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, auth.user?.id]);
  const pending = jobs.find((j) => j.status === 'pending' || j.status === 'running');
  // readiness: YOLO starts being useful ~50 imgs/class, strong at 150+
  const weakest = pool?.byClass.length ? Math.min(...pool.byClass.map((c) => c.count)) : 0;
  const readiness = !pool ? null
    : !pool.total ? { level: 'none', msg: 'הפול ריק — צאו לצלם בפטרול (דרך שער AI) או תייגו בדסקטופ' }
    : weakest < 50 ? { level: 'low', msg: `יש ${pool.total} תמונות מ-${pool.contributors} תלמידים, אבל לקטגוריה הדלה ביותר רק ${weakest}. מומלץ 50+ לקטגוריה — כל הכיתה מצלמת ביחד ומגיעים לזה מהר! 🤝` }
    : weakest < 150 ? { level: 'ok', msg: `${pool.total} תמונות מ-${pool.contributors} תלמידים · הקטגוריה הדלה: ${weakest}. אפשר לאמן — ו-150+ ייתן מודל חזק באמת.` }
    : { level: 'great', msg: `${pool.total} תמונות מ-${pool.contributors} תלמידים — דאטהסט מעולה! 🔥` };

  async function start() {
    if (!auth.user) { toast('צריך להתחבר', true); authStore.set({ viewer: false }); return; }
    setBusy(true); setProgress('');
    const r = await startTrainingJob(auth.user, auth.team || null, setProgress, scope);
    if ('error' in r) { setProgress('⚠️ ' + r.error); }
    else {
      setProgress('');
      setJobs(await jobsFor());
      if (navigator.vibrate) navigator.vibrate(150);
    }
    setBusy(false);
  }

  async function register(f: File) {
    if (!auth.user) { toast('צריך להתחבר', true); return; }
    setRegBusy(true);
    const r = await registerTrainedModel(f, auth.user, auth.team || null, pending?.id);
    if ('error' in r) toast('רישום: ' + r.error);
    else {
      toast('🎉 מודל העיר עודכן — כל טלפון יקבל אותו עכשיו!', true);
      bumpData();
      setJobs(await jobsFor());
      if (navigator.vibrate) navigator.vibrate([100, 60, 200]);
    }
    setRegBusy(false);
  }

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="card hud det-modal">
        <button className="ghost mclose" onClick={onClose} disabled={busy}>✕</button>
        <img src="/art/training-core.jpg" alt="" className="art-banner" />
        <div className="phase-head" style={{ marginBottom: 10 }}>
          <span className="ph-n">🚀</span>
          <div>
            <b>{scope === 'mine' ? 'אימון אישי אמיתי — על התמונות שלך' : 'אימון כיתתי — מודל YOLO מהמאגר המשותף'}</b>
            <span className="why">3 צעדים: ① פתיחת משימה (הדאטה עולה לענן) ② הרצת המחברת — היא מוצאת את המשימה לבד ③ העלאת המודל שיורד. אפשר מהטלפון; המחברת נוחה יותר במחשב.</span>
          </div>
        </div>

        {/* step 1 */}
        <div className="tr-step">
          <b>① פתחו משימת אימון</b>
          {scope === 'all' && readiness && (
            <div className={'ai-verdict ' + (readiness.level === 'great' ? 'pass' : readiness.level === 'low' || readiness.level === 'none' ? 'fail' : '')} style={{ marginTop: 6 }}>
              {readiness.level === 'none' ? '📭 ' : readiness.level === 'low' ? '📈 ' : '✅ '}{readiness.msg}
            </div>
          )}
          {scope === 'mine' && mine !== null && (
            <div className={'ai-verdict ' + (mine >= 20 ? 'pass' : 'fail')} style={{ marginTop: 6 }}>
              {mine === 0 ? '📭 אין לך עדיין תמונות מתויגות — צלמו סדרה ותייגו קודם.'
                : `🧒 המודל יתאמן על ${mine} התמונות שתייגת. ${mine < 20 ? 'זה מעט — הוא יהיה חלש, וזה בדיוק הלקח לקראת האיחוד הכיתתי 🎓' : 'יפה! יש עם מה לעבוד.'}`}
            </div>
          )}
          {pending ? (
            <div className="ai-verdict pass" style={{ marginTop: 6 }}>
              {pending.status === 'running' ? '🏃 מתאמן עכשיו' : '✅ משימה ממתינה'}: {pending.image_count} תמונות · {(pending.classes || []).join(' · ')}
              {pending.status === 'pending' && (
                <button className="ghost" style={{ display: 'block', width: '100%', marginTop: 6, fontSize: 11.5 }}
                  onClick={async () => { await cancelJob(pending.id); setJobs(await jobsFor()); }}>
                  ביטול המשימה (כדי לפתוח חדשה)
                </button>
              )}
            </div>
          ) : (
            <button className="hot" style={{ width: '100%', marginTop: 6 }} disabled={busy} onClick={start}>
              {busy ? '⏳ ' + (progress || 'מכין…') : '🚀 התחל אימון אמיתי'}
            </button>
          )}
          {progress && !busy && <div className="hint" style={{ marginTop: 6 }}>{progress}</div>}
        </div>

        {/* step 2 — the only manual action; the notebook does the rest */}
        <div className="tr-step">
          <b>② הריצו את המחברת (GPU חינם) — וזהו!</b>
          <div className="hint" style={{ margin: '4px 0 6px' }}>
            נפתחת בטאב חדש → ‏Runtime ← Run all. המחברת מוצאת את המשימה שלכם, מתאמנת (~15 דק'),
            <b> ורושמת את המודל בחזרה לעיר לבד</b> — בלי הורדה, בלי העלאה ידנית. כשהמשימה למטה תהפוך ל-🟢 — סיימתם.
          </div>
          <button className="primary" style={{ width: '100%' }} disabled={!pending}
            onClick={() => window.open(COLAB, '_blank')}>
            ☁️ פתח מחברת אימון
          </button>
        </div>

        {/* step 3 — fallback only */}
        <details className="tr-step" style={{ opacity: .9 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--muted)' }}>
            המחברת לא הצליחה לרשום לבד? העלו ידנית ⏷
          </summary>
          <label className="ghost" style={{ display: 'block', textAlign: 'center', cursor: 'pointer', padding: '11px', marginTop: 8, border: '1px solid var(--cy-faint)', opacity: regBusy ? 0.5 : 1 }}>
            {regBusy ? '🧠 בודק ומפרסם…' : '📂 בחר את yolo_tfjs_model.zip'}
            <input type="file" accept=".zip" style={{ display: 'none' }} disabled={regBusy}
              onChange={(e) => { if (e.target.files?.[0]) register(e.target.files[0]); e.target.value = ''; }} />
          </label>
          <div className="hint" style={{ marginTop: 4 }}>המודל נבדק לפני פרסום — ואז כל העיר מקבלת אותו אוטומטית. 🏙️</div>
        </details>

        {jobs.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {jobs.slice(0, 3).map((j) => (
              <div key={j.id} className="boxrow" style={{ fontSize: 12 }}>
                <span>{j.status === 'done' ? '🟢' : j.status === 'pending' ? '⏳' : '✖'}</span>
                <span>{j.image_count} תמונות</span>
                <span className="muted" style={{ marginInlineStart: 'auto' }}>
                  {new Date(j.created_at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
