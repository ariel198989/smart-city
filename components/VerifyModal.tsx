'use client';
// Field verification — closes the hazard loop:
// kid goes to the spot, photographs it, the SAME model that found the
// hazard re-checks the photo, and an engineer signs off. Pin comes down.
import { useEffect, useState } from 'react';
import { publicUrl, uploadBlob, updateDetection } from '@/lib/db';
import { modelStore, detectOnDataURL, clsOf } from '@/lib/infer';
import { authStore } from '@/lib/auth';
import { createStore, useStore, toast, bumpData } from '@/lib/store';
import { dataURLtoBlob, fileToDataURL } from '@/lib/util';

export const verifyStore = createStore<{ det: any | null }>({ det: null });
export const openVerify = (det: any) => verifyStore.set({ det });

interface AiVerdict { checked: boolean; passed: boolean | null; conf: number; note: string }

export default function VerifyModal() {
  const { det } = useStore(verifyStore);
  const model = useStore(modelStore);
  const auth = useStore(authStore);
  const [photo, setPhoto] = useState<string>('');
  const [ai, setAi] = useState<AiVerdict | null>(null);
  const [busy, setBusy] = useState(false);

  // reset when a new detection opens
  useEffect(() => { setPhoto(''); setAi(null); setBusy(false); }, [det?.id]);

  if (!det) return null;
  const close = () => verifyStore.set({ det: null });

  async function onPhoto(f: File) {
    const durl = await fileToDataURL(f, 900, 675);
    setPhoto(durl);
    // AI re-check: does the model still see this hazard class in the photo?
    if (!modelStore.get().ready) {
      setAi({ checked: false, passed: null, conf: 0, note: 'אין מודל טעון — האימות יעבור למהנדס בלי בדיקת AI. (טענו מודל בסטודיו לחוויה המלאה)' });
      return;
    }
    const knows = modelStore.get().classes.includes(det.class_name);
    if (!knows) {
      setAi({ checked: false, passed: null, conf: 0, note: `המודל הטעון לא מכיר את הקטגוריה "${det.class_name}" — בדיקת AI דולגה.` });
      return;
    }
    setAi({ checked: false, passed: null, conf: 0, note: '🤖 ה-AI בודק את התמונה…' });
    try {
      const { boxes } = await detectOnDataURL(durl, 0.3);
      const same = boxes.filter((b) => clsOf(b.cls).name === det.class_name);
      const conf = same.length ? Math.max(...same.map((b) => b.score)) : 0;
      if (same.length) {
        setAi({ checked: true, passed: false, conf, note: `❌ ה-AI עדיין מזהה "${det.class_name}" בתמונה (${Math.round(conf * 100)}%). נראה שהמפגע עוד שם — אפשר לשלוח למהנדס בכל זאת, הוא יכריע.` });
      } else {
        setAi({ checked: true, passed: true, conf: 0, note: `✅ ה-AI לא מזהה יותר "${det.class_name}" — נראה שתוקן! נשאר רק אישור מהנדס.` });
      }
    } catch (e: any) {
      setAi({ checked: false, passed: null, conf: 0, note: 'בדיקת AI נכשלה: ' + (e.message || e) });
    }
  }

  async function submit() {
    if (!auth.user) { toast('צריך להתחבר כדי לאמת בשטח', true); authStore.set({ viewer: false }); return; }
    if (!photo) { toast('צלמו/העלו תמונה של המקום קודם'); return; }
    setBusy(true);
    try {
      const path = `verify/v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;  // ASCII-only key
      await uploadBlob(path, dataURLtoBlob(photo), 'image/jpeg');
      await updateDetection(det.id, {
        status: 'verifying',
        verify_photo_path: path,
        verify_ai_passed: ai?.checked ? ai.passed : null,
        verify_ai_conf: ai?.checked ? ai.conf : null,
        verified_by: auth.user.id,
      });
      toast(ai?.passed ? 'האימות נשלח — ממתין לחתימת מהנדס 🟢' : 'האימות נשלח למהנדס', true);
      bumpData();
      close();
    } catch (e: any) { toast('אימות: ' + (e.message || e)); }
    setBusy(false);
  }

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="card hud det-modal">
        <button className="ghost mclose" onClick={close}>✕</button>
        <div className="phase-head" style={{ marginBottom: 10 }}>
          <span className="ph-n">📸</span>
          <div>
            <b>אימות בשטח — {det.class_name}</b>
            <span className="why">הגיעו לנקודה, צלמו את המקום מאותה זווית — וה-AI יבדוק אם המפגע באמת תוקן.</span>
          </div>
        </div>

        <div className="verify-compare">
          <div>
            <div className="vc-lbl">לפני — הזיהוי המקורי</div>
            {det.crop_path
              ? <img src={publicUrl(det.crop_path)} alt="" />
              : <div className="vc-empty">אין תמונה</div>}
          </div>
          <div>
            <div className="vc-lbl">עכשיו — התמונה שלכם</div>
            {photo
              ? <img src={photo} alt="" />
              : (
                <label className="dropzone vc-drop">
                  📷 צלמו / העלו תמונה של המקום
                  <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={(e) => { if (e.target.files?.[0]) onPhoto(e.target.files[0]); e.target.value = ''; }} />
                </label>
              )}
          </div>
        </div>

        {ai && (
          <div className={'ai-verdict' + (ai.passed === true ? ' pass' : ai.passed === false ? ' fail' : '')}>
            {ai.note}
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={!photo || busy} onClick={submit}>
            {busy ? 'שולח…' : '🚀 שלח אימות למהנדס'}
          </button>
          {photo && (
            <label className="ghost" style={{ cursor: 'pointer', padding: '9px 14px', border: '1px solid var(--cy-faint)' }}>
              צלם שוב
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files?.[0]) onPhoto(e.target.files[0]); e.target.value = ''; }} />
            </label>
          )}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          📍 {Number(det.lat).toFixed(5)}, {Number(det.lng).toFixed(5)} ·{' '}
          <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${det.lat},${det.lng}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cy)' }}>
            ניווט למקום ↗
          </a>
        </div>
      </div>
    </div>
  );
}
