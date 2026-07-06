'use client';
// 🎓 Pocket Trainer wizard — shoot ~8 target photos + ~4 "other" photos,
// and the phone trains a personal gate model on-device in seconds.
import { useState } from 'react';
import { pocketStore, addExample, classifyPocket, finishPocket, clearPocket } from '@/lib/pocket';
import { useStore, toast } from '@/lib/store';
import { fileToDataURL } from '@/lib/util';

const TARGET_MIN = 8, OTHER_MIN = 4;

export default function PocketTrainer({ mission, onClose }: { mission: string; onClose: () => void }) {
  const pocket = useStore(pocketStore);
  const [step, setStep] = useState<'target' | 'other' | 'done'>(pocket.ready ? 'done' : 'target');
  const [className, setClassName] = useState(pocket.className || mission || 'בור בכביש');
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ label: string; confidence: number; durl: string } | null>(null);

  async function shoot(f: File) {
    setBusy(true);
    try {
      const durl = await fileToDataURL(f, 480, 360);
      if (step === 'done') {
        // live test mode
        const r = await classifyPocket(durl);
        setTest({ ...r, durl });
        if (navigator.vibrate) navigator.vibrate(r.label === 'target' ? 150 : [60, 40, 60]);
      } else {
        await addExample(durl, step);
        setThumbs((t) => [durl, ...t].slice(0, 12));
        if (navigator.vibrate) navigator.vibrate(40);
      }
    } catch (e: any) { toast('מאמן: ' + (e.message || e)); }
    setBusy(false);
  }

  const count = step === 'target' ? pocket.targetCount : pocket.otherCount;
  const need = step === 'target' ? TARGET_MIN : OTHER_MIN;

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card hud det-modal pocket">
        <button className="ghost mclose" onClick={onClose}>✕</button>
        <div className="phase-head" style={{ marginBottom: 8 }}>
          <span className="ph-n">🎓</span>
          <div>
            <b>מאמן כיס — AI אישי בטלפון</b>
            <span className="why">מאמנים מודל אמיתי על המכשיר, בלי מחשב ובלי ענן. הוא יהיה השער האישי שלכם במשחק.</span>
          </div>
        </div>

        {step !== 'done' && (
          <>
            {step === 'target' && (
              <div className="row" style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 13 }}>מה מאמנים לזהות?</label>
                <input type="text" value={className} onChange={(e) => setClassName(e.target.value)}
                  style={{ flex: 1, minWidth: 120 }} />
              </div>
            )}
            <div className="pk-step">
              {step === 'target'
                ? <>📸 צלמו <b>{className}</b> מזוויות ומרחקים שונים — {pocket.targetCount}/{TARGET_MIN}</>
                : <>🚫 עכשיו צלמו דברים <b>אחרים</b> (כביש נקי, קיר, עץ) — {pocket.otherCount}/{OTHER_MIN}</>}
            </div>
            <div className="tagbar" style={{ marginTop: 4 }}>
              <div className="bar"><i style={{ width: Math.min(100, Math.round(count / need * 100)) + '%' }} /></div>
              <b>{count}/{need}</b>
            </div>
            {thumbs.length > 0 && (
              <div className="pk-thumbs">
                {thumbs.map((t, i) => <img key={i} src={t} alt="" />)}
              </div>
            )}
            <label className={'pt-capture pk-shutter' + (busy || pocket.netLoading ? ' busy' : '')}>
              {pocket.netLoading ? '⏳' : busy ? '🧠' : '📸'}
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files?.[0]) shoot(e.target.files[0]); e.target.value = ''; }} />
            </label>
            <div className="hint center" style={{ marginTop: 4 }}>
              {pocket.netLoading ? 'טוען את מנוע ה-AI (פעם ראשונה בלבד)…' : busy ? 'לומד את התמונה…' : 'לחצו לצילום'}
            </div>
            {count >= need && (
              <button className="primary" style={{ width: '100%', marginTop: 10 }}
                onClick={async () => {
                  if (step === 'target') setStep('other');
                  else { await finishPocket(className.trim() || 'מפגע'); setStep('done'); if (navigator.vibrate) navigator.vibrate(250); }
                }}>
                {step === 'target' ? 'הבא: צילומי "משהו אחר" ←' : '🎉 סיים אימון — המודל שלי מוכן!'}
              </button>
            )}
          </>
        )}

        {step === 'done' && (
          <>
            <div className="pk-done">
              <div className="ptr-big">🎉</div>
              <b>המודל שלך מאומן על "{pocket.className}"</b>
              <div className="hint" style={{ marginTop: 4 }}>
                ‏{pocket.targetCount} דוגמאות חיוביות · {pocket.otherCount} דוגמאות רקע · חי על הטלפון שלך
              </div>
            </div>
            <div className="pk-step" style={{ marginTop: 10 }}>🔬 בדקו אותו — צלמו משהו:</div>
            <label className={'pt-capture pk-shutter' + (busy ? ' busy' : '')}>
              {busy ? '🧠' : '🔬'}
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files?.[0]) shoot(e.target.files[0]); e.target.value = ''; }} />
            </label>
            {test && (
              <div className={'ai-verdict ' + (test.label === 'target' ? 'pass' : 'fail')} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <img src={test.durl} alt="" style={{ width: 64, height: 48, objectFit: 'cover', border: '1px solid var(--cy-faint)' }} />
                <span>
                  {test.label === 'target'
                    ? `✅ זה ${pocket.className}! (${Math.round(test.confidence * 100)}%)`
                    : `🙅 זה לא ${pocket.className} (${Math.round(test.confidence * 100)}%)`}
                </span>
              </div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" style={{ flex: 1 }} onClick={onClose}>🎮 לפטרול — המודל שלי שומר עליי</button>
              <button className="ghost" style={{ fontSize: 12, color: 'var(--danger)' }}
                onClick={() => { clearPocket(); setStep('target'); setThumbs([]); setTest(null); }}>
                אמן מחדש
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
