'use client';
// 🎥 Street Mode / Recognize — walk with the camera OPEN and see the
// trained model's live verdict on whatever it's pointed at. Pure
// recognition: no "aim at X" instruction, no angle-coverage radar —
// those live in SeriesCollect (the dedicated training-capture screen).
// Here you point, it tells you what it sees, live.
import { useEffect, useRef, useState } from 'react';
import { modelStore, detectOnDataURL, drawDetections } from '@/lib/infer';
import { useStore, toast } from '@/lib/store';

interface Props {
  mission: string;
  onCapture: (dataURL: string) => void;   // hands the frame to the patrol gate
  onClose: () => void;
  busy: boolean;
  getPos: () => { lat: number; lng: number } | null;
  blockReason: () => string | null;       // null = ok to shoot; else why not
  onNeedLogin: () => void;
}

export default function StreetCam({ mission, onCapture, onClose, busy, getPos, blockReason, onNeedLogin }: Props) {
  const model = useStore(modelStore);
  const [gpsReady, setGpsReady] = useState(false);
  useEffect(() => {
    const h = setInterval(() => setGpsReady(!!getPos()), 500);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const grabRef = useRef<HTMLCanvasElement | null>(null);
  const runningRef = useRef(true);
  const [camErr, setCamErr] = useState('');
  const [liveHits, setLiveHits] = useState(0);
  const [liveLabel, setLiveLabel] = useState<{ name: string; score: number; unsure: boolean } | null>(null);
  const [scanning, setScanning] = useState(false);

  // 🧮 temporal smoothing: single frames are noisy (a weak model flickers
  // its top guess every tick). We show the MAJORITY class of the last 6
  // frames instead — and if nothing clears a real floor (0.2) we honestly
  // show "not recognizing" rather than a sticky random guess at 10%.
  const histRef = useRef<{ cls: number; score: number }[]>([]);
  function smoothedTop(): { cls: number; score: number } | null {
    const good = histRef.current.filter((h) => h.score >= 0.2);
    if (good.length < 3) return null;               // not enough signal yet
    const byCls: Record<number, { n: number; sum: number }> = {};
    good.forEach((h) => {
      byCls[h.cls] = byCls[h.cls] || { n: 0, sum: 0 };
      byCls[h.cls].n++; byCls[h.cls].sum += h.score;
    });
    const bestCls = Object.entries(byCls).sort((a, b) => b[1].n - a[1].n || b[1].sum - a[1].sum)[0];
    return { cls: +bestCls[0], score: bestCls[1].sum / bestCls[1].n };
  }

  // 🎉 wow moment: a strong hit gets a big center flash, not just the
  // small top chip — the "look, it actually recognized it!" demo beat.
  const [wow, setWow] = useState<{ name: string; score: number; k: number } | null>(null);
  const wowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wowLastNameRef = useRef<{ name: string; at: number } | null>(null);
  function fireWow(name: string, score: number) {
    // re-trigger the pop even on the same class (new key), but don't
    // spam it every ~450ms loop tick while the hand stays still
    const last = wowLastNameRef.current;
    if (last && last.name === name && Date.now() - last.at < 1800) return;
    wowLastNameRef.current = { name, at: Date.now() };
    setWow({ name, score, k: Date.now() });
    if (wowTimerRef.current) clearTimeout(wowTimerRef.current);
    wowTimerRef.current = setTimeout(() => setWow(null), 1400);
  }
  useEffect(() => () => { if (wowTimerRef.current) clearTimeout(wowTimerRef.current); }, []);

  // 🎯 AI auto-capture: the live model already judges every frame — when
  // it's ≥85% sure it sees the mission target, it takes the shot itself
  // (1.5s cancellable countdown, 15s cooldown).
  const [autoCap, setAutoCap] = useState<string | null>(null);   // pending frame
  const autoLastRef = useRef(0);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  function armAutoCapture(durl: string) {
    if (autoTimerRef.current) return;
    setAutoCap(durl);
    if (navigator.vibrate) navigator.vibrate([40, 30, 40]);
    autoTimerRef.current = setTimeout(() => {
      autoTimerRef.current = null;
      setAutoCap(null);
      autoLastRef.current = Date.now();
      if (busyRef.current) return;   // a manual capture is already in flight — don't double-submit
      const full = grabFrame(0.85, 900) || durl;   // freshest full-res frame
      onCapture(full);
    }, 1500);
  }
  function cancelAutoCapture() {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    autoTimerRef.current = null;
    setAutoCap(null);
    autoLastRef.current = Date.now();              // cancel also cools down
  }
  useEffect(() => () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); }, []);

  // open the rear camera
  useEffect(() => {
    let stream: MediaStream | null = null;
    let disposed = false;              // set true if we unmount mid-getUserMedia
    runningRef.current = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        const v = videoRef.current;
        // unmounted while the permission prompt was open, or StrictMode
        // double-mount → kill this stream now (else the camera LED stays on)
        if (disposed || !v) { stream.getTracks().forEach((t) => t.stop()); return; }
        v.srcObject = stream;
        await v.play();
        liveLoop();
      } catch (e: any) {
        setCamErr(e?.name === 'NotAllowedError'
          ? 'אין הרשאת מצלמה — אפשרו מצלמה לאתר בהגדרות הדפדפן'
          : 'המצלמה לא נפתחה: ' + (e?.message || e));
      }
    })();
    return () => {
      disposed = true;
      runningRef.current = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function grabFrame(quality = 0.8, maxW = 900): string | null {
    const v = videoRef.current;
    if (!v || !v.videoWidth || v.readyState < 2) return null;  // camera gone mid-session
    if (!grabRef.current) grabRef.current = document.createElement('canvas');
    const cv = grabRef.current;
    const w = Math.min(v.videoWidth, maxW);
    const h = Math.round(v.videoHeight * w / v.videoWidth);
    cv.width = w; cv.height = h;
    cv.getContext('2d')!.drawImage(v, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', quality);
  }

  // live detection loop (~1fps — walking pace, phone-friendly).
  // paused while the tab is hidden: inference in the background only
  // burns battery on a kid's phone in a pocket.
  async function liveLoop() {
    while (runningRef.current) {
      const v = videoRef.current, ov = overlayRef.current;
      if (document.hidden || !v || !ov || !modelStore.get().ready) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      try {
        setScanning(true);
        const durl = grabFrame(0.7, 640);
        if (durl) {
          // low floor (0.15): a weak/small-dataset model's TRUE best guess
          // often sits under the old 0.35 gate — that gate was silently
          // hiding it and showing nothing at all. We still draw a solid
          // box only for confident hits, but the LABEL always shows the
          // model's actual best guess (honest: flagged "unsure" if weak).
          const { boxes, top } = await detectOnDataURL(durl, 0.15);
          if (!runningRef.current) break;
          ov.width = v.clientWidth; ov.height = v.clientHeight;
          const confident = boxes.filter((b) => b.score >= 0.35);
          drawDetections(ov, confident);
          setLiveHits(confident.length);
          const names = modelStore.get().classes;
          // feed the smoothing window, then display the MAJORITY of the
          // last 6 frames — not the raw per-frame guess (which flickers,
          // or worse, sits frozen on class-prior noise at ~10%).
          if (top) {
            histRef.current.push({ cls: top.cls, score: top.score });
            if (histRef.current.length > 6) histRef.current.shift();
          }
          const sm = smoothedTop();
          setLiveLabel(sm
            ? { name: names[sm.cls] || ('קטגוריה ' + (sm.cls + 1)), score: sm.score, unsure: sm.score < 0.35 }
            : null);
          if (confident.length && navigator.vibrate) navigator.vibrate(30);
          if (sm && sm.score >= 0.55) {
            fireWow(names[sm.cls] || ('קטגוריה ' + (sm.cls + 1)), sm.score);
            if (navigator.vibrate) navigator.vibrate([25, 40, 60]);
          }
          // auto-capture: any confident detection, gates permitting
          // (pure recognition — no single "mission" class restriction,
          // since a model can now hold several trained objects at once)
          if (top && top.score >= 0.85
              && !busyRef.current && !autoTimerRef.current
              && Date.now() - autoLastRef.current > 15000
              && !blockReason()) {
            armAutoCapture(durl);
          }
        }
      } catch { /* frame skipped */ }
      setScanning(false);
      await new Promise((r) => setTimeout(r, 450));
    }
  }

  function shutter() {
    // login / GPS gate — surface the reason LOUDLY, not a fleeting toast
    const reason = blockReason();
    if (reason === 'login') { onNeedLogin(); return; }
    if (reason) {
      toast(reason, true);
      if (navigator.vibrate) navigator.vibrate([50, 40, 50]);
      return;
    }
    const durl = grabFrame(0.85, 900);
    if (!durl) { toast('המצלמה עוד לא מוכנה — חכו רגע'); return; }
    onCapture(durl);
  }

  return (
    <div className="streetcam">
      <video ref={videoRef} playsInline muted />
      <canvas ref={overlayRef} className="sc-overlay" />

      <div className="sc-top">
        <button className="ghost sc-close" onClick={onClose}>✕ מפה</button>
        <div className="pt-chip">
          {model.ready ? (scanning && !liveHits ? '🤖 סורק…' : '🎥 זיהוי חי') : '🎥 בלי AI חי — אין מודל'}
        </div>
      </div>

      {/* 🎉 the wow moment — big center flash on a strong hit */}
      {wow && (
        <div className="sc-wow" key={wow.k}>
          <b>{wow.name}</b>
          <span>{Math.round(wow.score * 100)}% בטוח</span>
        </div>
      )}

      {/* 🔴 live class readout — updates as you point (e.g. "אצבע אחת").
          honest about weak guesses instead of showing nothing at all. */}
      {model.ready && liveLabel && (
        <div className={'sc-live-label' + (liveLabel.unsure ? ' unsure' : '')}>
          <b>{liveLabel.unsure ? `אולי ${liveLabel.name}?` : liveLabel.name}</b>
          <span>{Math.round(liveLabel.score * 100)}%{liveHits > 1 ? ` · ${liveHits} עצמים` : ''}</span>
        </div>
      )}
      {/* pure recognition: nothing else is prescribed. No target text,
          no angle radar — you point, it tells you what it sees. */}
      {!model.ready && <div className="sc-mission">אין מודל עדיין — אמנו אחד ב-🧠 אימון</div>}

      {camErr && <div className="sc-err">{camErr}</div>}

      {/* 🎯 auto-capture countdown — tap anywhere on it to cancel */}
      {autoCap && (
        <button className="sc-autocap" onClick={cancelAutoCapture}>
          🎯 זיהוי חזק! צולם אוטומטית… <b>הקישו לביטול</b>
        </button>
      )}

      {/* live readiness — so 'nothing happens' never happens silently */}
      <div className="sc-ready">
        <span className={'scr-chip' + (gpsReady ? ' ok' : '')}>
          {gpsReady ? '🛰️ GPS מוכן' : '🛰️ מחפש מיקום…'}
        </span>
      </div>

      <button
        className={'pt-capture sc-shutter' + (busy ? ' busy' : '') + (!gpsReady ? ' waiting' : '')}
        onClick={shutter} disabled={busy}>
        {busy ? '🤖' : !gpsReady ? '🛰️' : '📸'}
      </button>
      <div className="pt-capture-lbl" style={{ zIndex: 12 }}>
        {busy ? 'ה-AI בודק…'
          : !gpsReady ? 'ממתין ל-GPS — צאו החוצה / אשרו מיקום'
          : liveLabel ? (liveLabel.unsure ? `לא בטוח (${liveLabel.name}?) — התקרבו או שנו זווית` : `נראה: ${liveLabel.name} — צלמו לשמור`)
          : 'כוונו על משהו כדי לזהות'}
      </div>
    </div>
  );
}
