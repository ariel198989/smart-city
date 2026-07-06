'use client';
// 🚀 Real training, started from the phone:
// 1) build+upload the city dataset, open a job
// 2) open the Colab notebook (it auto-fetches the pending job)
// 3) come back and upload the trained model — the whole city gets it
import { useEffect, useState } from 'react';
import { COLAB } from '@/lib/config';
import { authStore } from '@/lib/auth';
import { useStore, toast, bumpData } from '@/lib/store';
import { startTrainingJob, registerTrainedModel, fetchJobs, type TrainJob } from '@/lib/trainjobs';
import { fetchPoolStats, type PoolStats } from '@/lib/citypool';

export default function TrainReal({ onClose }: { onClose: () => void }) {
  const auth = useStore(authStore);
  const [jobs, setJobs] = useState<TrainJob[]>([]);
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [regBusy, setRegBusy] = useState(false);

  const [pool, setPool] = useState<PoolStats | null>(null);
  useEffect(() => {
    fetchJobs().then(setJobs).catch(() => {});
    fetchPoolStats().then(setPool).catch(() => {});
  }, []);
  const pending = jobs.find((j) => j.status === 'pending');
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
    const r = await startTrainingJob(auth.user, auth.team || null, setProgress);
    if ('error' in r) { setProgress('⚠️ ' + r.error); }
    else {
      setProgress('');
      setJobs(await fetchJobs());
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
      setJobs(await fetchJobs());
      if (navigator.vibrate) navigator.vibrate([100, 60, 200]);
    }
    setRegBusy(false);
  }

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="card hud det-modal">
        <button className="ghost mclose" onClick={onClose} disabled={busy}>✕</button>
        <div className="phase-head" style={{ marginBottom: 10 }}>
          <span className="ph-n">🚀</span>
          <div>
            <b>אימון אמיתי — מודל YOLO לעיר</b>
            <span className="why">3 צעדים: ① פתיחת משימה (הדאטה עולה לענן) ② הרצת המחברת — היא מוצאת את המשימה לבד ③ העלאת המודל שיורד. הכל מהטלפון.</span>
          </div>
        </div>

        {/* step 1 */}
        <div className="tr-step">
          <b>① פתחו משימת אימון</b>
          {readiness && (
            <div className={'ai-verdict ' + (readiness.level === 'great' ? 'pass' : readiness.level === 'low' || readiness.level === 'none' ? 'fail' : '')} style={{ marginTop: 6 }}>
              {readiness.level === 'none' ? '📭 ' : readiness.level === 'low' ? '📈 ' : '✅ '}{readiness.msg}
            </div>
          )}
          {pending ? (
            <div className="ai-verdict pass" style={{ marginTop: 6 }}>
              ✅ משימה ממתינה: {pending.image_count} תמונות · {(pending.classes || []).join(' · ')}
            </div>
          ) : (
            <button className="hot" style={{ width: '100%', marginTop: 6 }} disabled={busy} onClick={start}>
              {busy ? '⏳ ' + (progress || 'מכין…') : '🚀 התחל אימון אמיתי'}
            </button>
          )}
          {progress && !busy && <div className="hint" style={{ marginTop: 6 }}>{progress}</div>}
        </div>

        {/* step 2 */}
        <div className="tr-step">
          <b>② הריצו את המחברת (GPU חינם)</b>
          <div className="hint" style={{ margin: '4px 0 6px' }}>
            נפתחת בטאב חדש → ‏Runtime ← Run all. המחברת תמצא את המשימה שלכם לבד — בלי להעלות כלום. ‏~15 דק'.
          </div>
          <button className="primary" style={{ width: '100%' }} disabled={!pending}
            onClick={() => window.open(COLAB, '_blank')}>
            ☁️ פתח מחברת אימון
          </button>
        </div>

        {/* step 3 */}
        <div className="tr-step">
          <b>③ העלו את המודל שירד (yolo_tfjs_model.zip)</b>
          <label className="hot" style={{ display: 'block', textAlign: 'center', cursor: 'pointer', padding: '11px', marginTop: 6, opacity: regBusy ? 0.5 : 1 }}>
            {regBusy ? '🧠 בודק ומפרסם…' : '📂 בחר את קובץ המודל'}
            <input type="file" accept=".zip" style={{ display: 'none' }} disabled={regBusy}
              onChange={(e) => { if (e.target.files?.[0]) register(e.target.files[0]); e.target.value = ''; }} />
          </label>
          <div className="hint" style={{ marginTop: 4 }}>המודל נבדק על המכשיר לפני פרסום — ואז כל העיר מקבלת אותו אוטומטית. 🏙️</div>
        </div>

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
