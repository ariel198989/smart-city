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
  const [liveLabel, setLiveLabel] = useState<{ name: string; score: number } | null>(null);
  const [scanning, setScanning] = useState(false);

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
    runningRef.current = true;
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
        liveLoop();
      } catch (e: any) {
        setCamErr(e?.name === 'NotAllowedError'
          ? 'אין הרשאת מצלמה — אפשרו מצלמה לאתר בהגדרות הדפדפן'
          : 'המצלמה לא נפתחה: ' + (e?.message || e));
      }
    })();
    return () => {
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
          const { boxes } = await detectOnDataURL(durl, 0.35);
          if (!runningRef.current) break;
          ov.width = v.clientWidth; ov.height = v.clientHeight;
          drawDetections(ov, boxes);
          setLiveHits(boxes.length);
          const names = modelStore.get().classes;
          // 🔴 live readout — the strongest detection's CLASS NAME, big
          const top = [...boxes].sort((a: any, b: any) => b.score - a.score)[0];
          setLiveLabel(top ? { name: names[top.cls] || ('קטגוריה ' + (top.cls + 1)), score: top.score } : null);
          if (boxes.length && navigator.vibrate) navigator.vibrate(30);
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

      {/* 🔴 live class readout — updates as you point (e.g. "אצבע אחת") */}
      {model.ready && liveLabel && (
        <div className="sc-live-label">
          <b>{liveLabel.name}</b>
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
          : liveLabel ? `נראה: ${liveLabel.name} — צלמו לשמור`
          : 'כוונו על משהו כדי לזהות'}
      </div>
    </div>
  );
}
