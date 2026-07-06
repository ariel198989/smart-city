'use client';
// 🎓 Pocket Trainer wizard v2 — rapid-fire capture, batch learning:
// live camera inside the modal, tap-tap-tap 8 shots (instant, no ML),
// then ONE '🧠 עבד ולמד' pass embeds them all. MobileNet preloads in
// the background while you shoot.
import { useEffect, useRef, useState } from 'react';
import { pocketStore, addExample, classifyPocket, finishPocket, clearPocket, preloadEngine, POCKET_PASS_CONF } from '@/lib/pocket';
import { useStore, toast } from '@/lib/store';
import { fileToDataURL } from '@/lib/util';

// balanced classes — an 8:4 dataset gives the target a built-in
// majority in kNN voting and "everything passes". 8:8 keeps it honest.
const TARGET_MIN = 8, OTHER_MIN = 8;

export default function PocketTrainer({ mission, onClose }: { mission: string; onClose: () => void }) {
  const pocket = useStore(pocketStore);
  const [step, setStep] = useState<'target' | 'other' | 'done'>(pocket.ready ? 'done' : 'target');
  const [className, setClassName] = useState(pocket.className || mission || 'בור בכביש');
  const [queue, setQueue] = useState<string[]>([]);           // unprocessed shots (current step)
  const [processing, setProcessing] = useState<{ done: number; total: number } | null>(null);
  const [test, setTest] = useState<{ label: string; confidence: number; durl: string } | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [camOn, setCamOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const grabCv = useRef<HTMLCanvasElement | null>(null);

  // live camera + engine preload
  useEffect(() => {
    preloadEngine();
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 960 } }, audio: false,
        });
        const v = videoRef.current;
        if (!v) { stream.getTracks().forEach((t) => t.stop()); return; }
        v.srcObject = stream;
        await v.play();
        setCamOn(true);
      } catch { setCamOn(false); /* fallback: file input below */ }
    })();
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  function grab(): string | null {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    if (!grabCv.current) grabCv.current = document.createElement('canvas');
    const cv = grabCv.current;
    const w = Math.min(v.videoWidth, 480);
    const h = Math.round(v.videoHeight * w / v.videoWidth);
    cv.width = w; cv.height = h;
    cv.getContext('2d')!.drawImage(v, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', 0.85);
  }

  // ⚡ instant shot — zero ML work, just bank the frame
  function snap() {
    const durl = grab();
    if (!durl) { toast('המצלמה עוד לא מוכנה'); return; }
    setQueue((q) => [durl, ...q]);
    if (navigator.vibrate) navigator.vibrate(30);
  }

  async function filesToQueue(files: FileList) {
    const durls = await Promise.all([...files].map((f) => fileToDataURL(f, 480, 360)));
    setQueue((q) => [...durls, ...q]);
  }

  // 🧠 ONE batch pass over everything shot in this step
  async function processBatch() {
    const items = [...queue];
    setProcessing({ done: 0, total: items.length });
    try {
      for (let i = 0; i < items.length; i++) {
        await addExample(items[i], step as 'target' | 'other');
        setProcessing({ done: i + 1, total: items.length });
      }
      setQueue([]);
      if (navigator.vibrate) navigator.vibrate(150);
      if (step === 'target') setStep('other');
      else { await finishPocket(className.trim() || 'מפגע'); setStep('done'); if (navigator.vibrate) navigator.vibrate(250); }
    } catch (e: any) { toast('למידה: ' + (e.message || e)); }
    setProcessing(null);
  }

  async function liveTest() {
    const durl = grab();
    if (!durl) { toast('המצלמה עוד לא מוכנה'); return; }
    setTestBusy(true);
    try {
      const r = await classifyPocket(durl);
      setTest({ ...r, durl });
      if (navigator.vibrate) navigator.vibrate(r.label === 'target' ? 150 : [60, 40, 60]);
    } catch (e: any) { toast(e.message || e); }
    setTestBusy(false);
  }

  const need = step === 'target' ? TARGET_MIN : OTHER_MIN;
  const shot = queue.length;

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget && !processing) onClose(); }}>
      <div className="card hud det-modal pocket">
        <button className="ghost mclose" onClick={onClose} disabled={!!processing}>✕</button>
        {(pocket.ready || pocket.targetCount > 0 || pocket.otherCount > 0 || queue.length > 0) && (
          <button className="ghost pk-reset" disabled={!!processing}
            onClick={() => { clearPocket(); setQueue([]); setTest(null); setStep('target'); if (navigator.vibrate) navigator.vibrate(60); }}>
            🔄 אפס מודל
          </button>
        )}
        <div className="phase-head" style={{ marginBottom: 8 }}>
          <span className="ph-n">🎓</span>
          <div>
            <b>מאמן כיס — AI אישי בטלפון</b>
            <span className="why">מודל זמני ללימוד השיטה: צלמו ברצף → למידה אחת על הכל → בדקו. אפשר לאפס ולהתחיל מחדש מתי שרוצים — זה כל הקטע. 🔁</span>
          </div>
        </div>

        {/* live viewfinder (all steps) */}
        <div className="pk-cam">
          <video ref={videoRef} playsInline muted />
          {!camOn && (
            <div className="pk-cam-off">
              אין מצלמה חיה — העלו תמונות:
              <label className="ghost" style={{ cursor: 'pointer', padding: '7px 12px', border: '1px solid var(--cy-faint)', marginTop: 6, display: 'inline-block' }}>
                📁 בחרו כמה תמונות
                <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                  onChange={(e) => { if (e.target.files?.length) filesToQueue(e.target.files); e.target.value = ''; }} />
              </label>
            </div>
          )}
          {pocket.netLoading && <div className="pk-engine">🧠 מנוע ה-AI יורד ברקע… (אפשר להמשיך לצלם)</div>}
        </div>

        {step !== 'done' && (
          <>
            {step === 'target' && (
              <div className="row" style={{ margin: '10px 0 6px' }}>
                <label style={{ fontSize: 13 }}>מה מאמנים לזהות?</label>
                <input type="text" value={className} onChange={(e) => setClassName(e.target.value)}
                  style={{ flex: 1, minWidth: 120 }} disabled={!!processing} />
              </div>
            )}
            <div className="pk-step">
              {step === 'target'
                ? <>📸 צלמו ברצף <b>{className}</b> מזוויות שונות — <b>{shot}</b>/{need}</>
                : <>🚫 עכשיו ברצף <b>{need} דברים שונים</b> שהם לא {className} (שולחן, קיר, יד, רצפה, כוס…) — ככל שמגוון יותר, המודל חכם יותר! <b>{shot}</b>/{need}</>}
            </div>
            <div className="tagbar" style={{ marginTop: 4 }}>
              <div className="bar"><i style={{ width: Math.min(100, Math.round(shot / need * 100)) + '%' }} /></div>
              <b>{shot}/{need}</b>
            </div>
            {queue.length > 0 && (
              <div className="pk-thumbs">
                {queue.slice(0, 12).map((t, i) => (
                  <div key={i} className="pk-th">
                    <img src={t} alt="" />
                    <button onClick={() => setQueue((q) => q.filter((_, j) => j !== i))} disabled={!!processing}>×</button>
                  </div>
                ))}
              </div>
            )}

            {processing ? (
              <div className="tagbar" style={{ marginTop: 12 }}>
                <span>🧠 לומד</span>
                <div className="bar"><i style={{ width: Math.round(processing.done / processing.total * 100) + '%' }} /></div>
                <b>{processing.done}/{processing.total}</b>
              </div>
            ) : (
              <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
                {camOn && (
                  <button className="pt-capture pk-shutter" onClick={snap}>📸</button>
                )}
                {shot >= need && (
                  <button className="hot" style={{ flex: 1, minWidth: 170, fontSize: 14, padding: '12px 8px' }} onClick={processBatch}>
                    🧠 עבד ולמד ({shot} תמונות)
                  </button>
                )}
              </div>
            )}
            {!processing && camOn && <div className="hint center" style={{ marginTop: 4 }}>טאץ׳-טאץ׳-טאץ׳ — צילום מיידי, הלמידה בסוף</div>}
          </>
        )}

        {step === 'done' && (
          <>
            <div className="pk-done">
              <div className="ptr-big">🎉</div>
              <b>המודל שלך מאומן על "{pocket.className}"</b>
              <div className="hint" style={{ marginTop: 4 }}>
                ‏{pocket.targetCount} דוגמאות חיוביות · {pocket.otherCount} רקע · חי על הטלפון שלך
              </div>
            </div>
            <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
              {camOn ? (
                <button className="pt-capture pk-shutter" onClick={liveTest} disabled={testBusy}>{testBusy ? '🧠' : '🔬'}</button>
              ) : (
                <label className="ghost" style={{ cursor: 'pointer', padding: '9px 14px', border: '1px solid var(--cy-faint)' }}>
                  🔬 העלו תמונה לבדיקה
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      setTestBusy(true);
                      try {
                        const durl = await fileToDataURL(f, 480, 360);
                        const r = await classifyPocket(durl);
                        setTest({ ...r, durl });
                      } catch (err: any) { toast(err.message || err); }
                      setTestBusy(false);
                    }} />
                </label>
              )}
            </div>
            <div className="hint center" style={{ marginTop: 4 }}>{camOn ? 'כוונו למשהו ולחצו לבדיקה חיה' : 'בחרו תמונה לבדיקה'}</div>
            {test && (
              <div className={'ai-verdict ' + (test.label === 'target' ? 'pass' : 'fail')} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <img src={test.durl} alt="" style={{ width: 64, height: 48, objectFit: 'cover', border: '1px solid var(--cy-faint)' }} />
                <span>
                  {test.label === 'target' && test.confidence >= POCKET_PASS_CONF
                    ? `✅ זה ${pocket.className}! (${Math.round(test.confidence * 100)}%)`
                    : test.label === 'target'
                      ? `🤔 אולי ${pocket.className}? רק ${Math.round(test.confidence * 100)}% — במשחק זה היה נחסם`
                      : `🙅 זה לא ${pocket.className} (${Math.round(test.confidence * 100)}%)`}
                </span>
              </div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" style={{ flex: 1 }} onClick={onClose}>🎮 לפטרול — המודל שלי שומר עליי</button>
              <button className="ghost" style={{ fontSize: 12, color: 'var(--danger)' }}
                onClick={() => { clearPocket(); setStep('target'); setQueue([]); setTest(null); }}>
                אמן מחדש
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
