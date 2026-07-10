'use client';
// 📸 Series Collect — VARIETY-COACHED burst capture for training data.
// The camera auto-shoots every ~1.5s while a live coach tells you what
// to change NEXT: move the OBJECT (not the phone), swap background,
// change distance, lighting, hands. Variety is what makes a YOLO model
// generalize — and the coach bakes the protocol into the flow, so a
// student never has to remember it. (The old compass radar asked you to
// rotate the PHONE through impossible angles — wrong tool for handheld
// objects. Moving the object/scene is the real diversity.)
import { useEffect, useRef, useState } from 'react';
import { insertDetection, uploadBlob } from '@/lib/db';
import { authStore } from '@/lib/auth';
import { useStore, toast } from '@/lib/store';
import { dataURLtoBlob } from '@/lib/util';
import { DEFAULT_CITY } from '@/lib/config';
import { assessFrameQuality } from '@/lib/quality';

const INTERVAL_MS = 1500;
const PER_STEP = 8;        // shots per variety step (8 steps × 8 ≈ 64/object)

// the variety protocol, one nudge at a time — ordered so the biggest
// generalization wins come first (backgrounds > angles > lighting)
const STEPS = [
  { icon: '🎯', tip: 'צלמו ישר — האובייקט במרכז הפריים' },
  { icon: '🔄', tip: 'סובבו/הטו את האובייקט עצמו — לא את הטלפון!' },
  { icon: '🤏', tip: 'התקרבו — שהאובייקט ימלא חצי מסך' },
  { icon: '🚶', tip: 'התרחקו צעד-שניים — שייראה קטן יותר' },
  { icon: '🖼️', tip: 'עברו לרקע אחר — שולחן / קיר / רצפה' },
  { icon: '↕️', tip: 'הטו את הטלפון מעט מלמעלה, ואחר-כך מעט מלמטה' },
  { icon: '💡', tip: 'עברו למקום עם תאורה שונה — חלון / צל' },
  { icon: '🔁', tip: 'סבב חופשי — שלבו הכל: רקע חדש + מרחק + הטיה' },
];

interface Props {
  classNames: string[];   // multi-object session: shoot a series PER object
  getPos: () => { lat: number; lng: number } | null;
  onClose: (collected: number) => void;
}

// classes that look like real street hazards → offer to register a live
// incident at the measured location when the session ends.
// full-word-ish tokens: 'חציה/חצייה' not 'חצי' (which matches 'חציל').
const HAZARD_WORDS = ['חציה', 'חצייה', 'בור', 'תמרור', 'פסולת', 'ספסל', 'תאורה', 'גרפיטי', 'מדרכה', 'כביש', 'שלולית', 'מפגע'];
const isHazard = (name: string) => HAZARD_WORDS.some((w) => name.includes(w));

export default function SeriesCollect({ classNames, getPos, onClose }: Props) {
  const auth = useStore(authStore);
  const videoRef = useRef<HTMLVideoElement>(null);
  const grabRef = useRef<HTMLCanvasElement | null>(null);
  const [camErr, setCamErr] = useState('');
  const [running, setRunning] = useState(false);
  const [shots, setShots] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const runningRef = useRef(false);
  const shotsRef = useRef(0);

  // 🛰️ OWN high-accuracy GPS watch — the parent's coarse fix isn't good
  // enough to dispatch a repair crew. We collect every good fix during
  // the session and pin the incident at the MEDIAN (beats any single
  // reading, since the student walks around the hazard).
  const fixRef = useRef<{ lat: number; lng: number; acc: number } | null>(null);
  const fixesRef = useRef<{ lat: number; lng: number; acc: number }[]>([]);
  const [gpsAcc, setGpsAcc] = useState<number | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const f = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? 999 };
        fixRef.current = f;
        setGpsAcc(Math.round(f.acc));
        if (f.acc <= 40) {
          fixesRef.current.push(f);
          if (fixesRef.current.length > 400) fixesRef.current.shift();
        }
      },
      () => { /* no permission / no fix — chip stays red, frames still save */ },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  // dispatch-grade position ONLY: centroid of good fixes (≤40m), or a
  // single good last fix. A red-chip 2km reading must NEVER pin an
  // incident — better no pin than a wrong pin the city drives to.
  function bestPos(): { lat: number; lng: number } | null {
    const good = fixesRef.current;
    if (good.length >= 3) {
      return {
        lat: good.reduce((s, f) => s + f.lat, 0) / good.length,
        lng: good.reduce((s, f) => s + f.lng, 0) / good.length,
      };
    }
    const f = fixRef.current;
    return f && f.acc <= 40 ? { lat: f.lat, lng: f.lng } : null;
  }

  // representative frame per class → becomes the incident card's photo
  const lastFrameRef = useRef<Record<string, string>>({});
  // ❓ end-of-session incident confirmation sheet
  const [confirmEvt, setConfirmEvt] = useState<null | { cls: string; pos: { lat: number; lng: number } }>(null);
  const [evtBusy, setEvtBusy] = useState(false);

  // 🎯 which object is being photographed right now
  const [activeIdx, setActiveIdx] = useState(0);
  const activeRef = useRef(0);
  const className = classNames[activeIdx] || classNames[0] || 'מפגע';
  // per-object shot counts — they also drive the coach step per object
  const perClassRef = useRef<Record<string, number>>({});
  const [perClass, setPerClass] = useState<Record<string, number>>({});

  // 🧑‍🏫 coach step for the ACTIVE object (advances every PER_STEP shots)
  const countOf = (cls: string) => perClassRef.current[cls] || 0;
  const stepIdx = Math.min(Math.floor(countOf(className) / PER_STEP), STEPS.length - 1);
  const stepDone = countOf(className) - stepIdx * PER_STEP;
  const allDone = countOf(className) >= STEPS.length * PER_STEP;
  const lastStepRef = useRef(0);

  function switchClass(i: number) {
    activeRef.current = i;
    setActiveIdx(i);
    lastStepRef.current = Math.min(Math.floor(countOf(classNames[i]) / PER_STEP), STEPS.length - 1);
    if (navigator.vibrate) navigator.vibrate(15);
  }

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
      } catch (e: any) {
        setCamErr(e?.name === 'NotAllowedError' ? 'אין הרשאת מצלמה — אפשרו בהגדרות הדפדפן' : 'המצלמה לא נפתחה: ' + (e?.message || e));
      }
    })();
    return () => { runningRef.current = false; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  function grab(): string | null {
    const v = videoRef.current;
    if (!v || !v.videoWidth || v.readyState < 2) return null;
    if (!grabRef.current) grabRef.current = document.createElement('canvas');
    const cv = grabRef.current;
    const w = Math.min(v.videoWidth, 900);
    cv.width = w; cv.height = Math.round(v.videoHeight * w / v.videoWidth);
    cv.getContext('2d')!.drawImage(v, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.82);
  }

  async function saveFrame(durl: string, cls: string) {
    // real fix first (own high-accuracy watch → parent watch → city center)
    const at = fixRef.current || getPos() || { lat: DEFAULT_CITY.center_lat, lng: DEFAULT_CITY.center_lng };
    const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const framePath = `pool/s_${stamp}.jpg`;
    await uploadBlob(framePath, dataURLtoBlob(durl), 'image/jpeg');
    await insertDetection({
      lat: at.lat, lng: at.lng, class_name: cls, confidence: 0,
      frame_path: framePath, detected_by: authStore.get().user!.id,
      team_name: authStore.get().team || null, credits: 0, heading: null,
      // training material, NOT a live incident — keeps hundreds of series
      // frames off the city map. The ONE incident card is created at
      // session end (finishSession) at the median GPS position.
      status: 'dataset',
    });
    lastFrameRef.current[cls] = framePath;
  }

  // ── end of session: register ONE real incident at the measured spot ──
  function finishSession() {
    runningRef.current = false;
    setRunning(false);
    // hazard classes that actually got photographed this session
    const hazardCls = [...classNames]
      .filter((c) => isHazard(c) && countOf(c) > 0)
      .sort((a, b) => countOf(b) - countOf(a))[0];
    if (shotsRef.current > 0 && hazardCls) {
      const pos = bestPos();
      if (pos) {
        setConfirmEvt({ cls: hazardCls, pos });
        return;                     // sheet decides; onClose happens after
      }
      // honest: no dispatch-grade GPS → no incident pin at a wrong spot
      toast('🛰️ אין מיקום מדויק — התמונות נשמרו לאימון, אבל מפגע לא נרשם במפה', true);
    }
    onClose(shotsRef.current);
  }
  const evtBusyRef = useRef(false);
  async function registerIncident() {
    if (!confirmEvt || evtBusyRef.current) return;   // double-tap guard
    evtBusyRef.current = true;
    setEvtBusy(true);
    try {
      await insertDetection({
        lat: confirmEvt.pos.lat, lng: confirmEvt.pos.lng,
        class_name: confirmEvt.cls, confidence: 0,
        frame_path: lastFrameRef.current[confirmEvt.cls] || null,
        detected_by: authStore.get().user!.id,
        team_name: authStore.get().team || null, credits: 0, heading: null,
        // no explicit status → 'pending' → shows on the city map as an
        // open incident the municipality can dispatch to
      });
      toast('📍 המפגע נרשם במפת העיר — העירייה רואה אותו', true);
    } catch (e: any) {
      // keep the sheet open — the student can retry or dismiss explicitly
      toast('רישום נכשל: ' + (e.message || e) + ' — נסו שוב', true);
      evtBusyRef.current = false;
      setEvtBusy(false);
      return;
    }
    evtBusyRef.current = false;
    setEvtBusy(false);
    setConfirmEvt(null);
    onClose(shotsRef.current);
  }

  async function loop() {
    while (runningRef.current) {
      const durl = grab();
      if (durl) {
        const q = await assessFrameQuality(durl);
        if (!q.ok) { setSkipped((n) => n + 1); await new Promise((r) => setTimeout(r, INTERVAL_MS)); continue; }
        try {
          const cls = classNames[activeRef.current] || classNames[0] || 'מפגע';
          await saveFrame(durl, cls);
          shotsRef.current += 1;
          setShots(shotsRef.current);
          perClassRef.current[cls] = (perClassRef.current[cls] || 0) + 1;
          setPerClass({ ...perClassRef.current });
          setThumbs((t) => [durl, ...t].slice(0, 6));
          // step just advanced? big buzz — the coach has a NEW instruction
          const ns = Math.min(Math.floor((perClassRef.current[cls]) / PER_STEP), STEPS.length - 1);
          if (ns !== lastStepRef.current && activeRef.current === classNames.indexOf(cls)) {
            lastStepRef.current = ns;
            if (navigator.vibrate) navigator.vibrate([60, 50, 60]);
          } else if (navigator.vibrate) navigator.vibrate(20);
        } catch (e: any) { toast('שמירה: ' + (e.message || e)); }
      }
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }

  function toggle() {
    if (!auth.user) { toast('צריך להתחבר', true); return; }
    if (running) { runningRef.current = false; setRunning(false); }
    else { runningRef.current = true; setRunning(true); loop(); }
  }

  return (
    <div className="streetcam" style={{ zIndex: 70 }}>
      <video ref={videoRef} playsInline muted />
      <div className="sc-top">
        <button className="ghost sc-close" onClick={finishSession}>✕ סיום</button>
        <div className="pt-chip">📸 סדרת אימון: {className}</div>
        {/* 🛰️ live GPS accuracy — the incident pin is only as good as this */}
        <div className={'pt-chip sr-gps' + (gpsAcc == null ? ' bad' : gpsAcc <= 15 ? ' good' : gpsAcc <= 40 ? ' mid' : ' bad')}>
          {gpsAcc == null ? '🛰️ אין GPS' : `🛰️ ±${gpsAcc} מ'`}
        </div>
      </div>

      {/* ❓ end-of-session: pin the real incident on the city map? */}
      {confirmEvt && (
        <div className="sr-evt">
          <div className="sr-evt-card hud">
            <b>📍 לרשום מפגע אמיתי במפה?</b>
            <p>צילמתם "{confirmEvt.cls}" — {shots} תמונות. אם זה מפגע אמיתי ברחוב, נרשום אירוע במיקום המדויק שנמדד וצוות העירייה יראה אותו במפת העיר.</p>
            <button className="hot" disabled={evtBusy} onClick={registerIncident}>
              {evtBusy ? 'רושם…' : '✅ כן — זה מפגע אמיתי, רשמו במפה'}
            </button>
            <button className="ghost" disabled={evtBusy}
              onClick={() => { setConfirmEvt(null); onClose(shotsRef.current); }}>
              לא — זה אימון בלבד
            </button>
          </div>
        </div>
      )}

      {/* 🎯 object switcher — shoot a series per object, one model learns all */}
      {classNames.length > 1 && (
        <div className="series-classes">
          {classNames.map((c, i) => (
            <button key={c} className={'sr-cls' + (i === activeIdx ? ' on' : '')} onClick={() => switchClass(i)}>
              {c}{perClass[c] ? ` · ${perClass[c]}` : ''}
            </button>
          ))}
        </div>
      )}

      <div className={'series-hud' + (classNames.length > 1 ? ' with-cls' : '')}>
        <div className="series-count"><b>{shots}</b><span>תמונות</span></div>

        {/* 🧑‍🏫 the live variety coach — WHAT to change right now */}
        <div className={'sr-coach' + (allDone ? ' done' : '')} key={allDone ? 'done' : stepIdx}>
          {allDone ? (
            <>
              <b>🏆 {STEPS.length * PER_STEP}+ תמונות מגוונות ל"{className}"!</b>
              <span>{classNames.length > 1 ? 'עברו לאובייקט הבא בצ\'יפים למעלה ⬆️' : 'אפשר לסיים — או להמשיך חופשי'}</span>
            </>
          ) : (
            <>
              <b>{STEPS[stepIdx].icon} {STEPS[stepIdx].tip}</b>
              <span>שלב {stepIdx + 1}/{STEPS.length} · עוד {PER_STEP - stepDone} תמונות ומתקדמים</span>
              <div className="sr-coach-bar"><i style={{ width: (stepDone / PER_STEP) * 100 + '%' }} /></div>
            </>
          )}
        </div>
        <div className="sr-steps">
          {STEPS.map((s, i) => (
            <span key={i} className={'sr-step' + (i < stepIdx || allDone ? ' done' : i === stepIdx ? ' cur' : '')}>{s.icon}</span>
          ))}
        </div>

        {skipped > 0 && <div className="hint" style={{ fontSize: 10.5 }}>🧹 {skipped} פריימים מטושטשים/חשוכים סוננו</div>}
        {!running && shots === 0 && <div className="hint" style={{ textAlign: 'center' }}>לחצו התחל — המאמן יגיד לכם בדיוק מה לשנות בכל שלב: רקע, מרחק, הטיה.</div>}
        {thumbs.length > 0 && (
          <div className="series-thumbs">{thumbs.map((t, i) => <img key={i} src={t} alt="" />)}</div>
        )}
      </div>

      {camErr && <div className="sc-err">{camErr}</div>}

      <button className={'pt-capture sc-shutter' + (running ? ' rec' : '')} onClick={toggle}>
        {running ? '⏸' : '▶'}
      </button>
      <div className="pt-capture-lbl" style={{ zIndex: 12 }}>
        {running ? 'לחצו להפסקה' : shots ? 'המשך · או ✕ לסיום ותיוג' : 'התחל צילום אוטומטי'}
      </div>
    </div>
  );
}
