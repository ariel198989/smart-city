'use client';
// 🎥 Street Mode — walk with the camera OPEN, see the street live,
// and the trained model detects hazards on the live feed in real time.
// Tap the shutter → the current frame goes through the capture gate.
import { useEffect, useRef, useState } from 'react';
import { modelStore, detectOnDataURL, drawDetections } from '@/lib/infer';
import { useStore, toast } from '@/lib/store';

interface Props {
  mission: string;
  onCapture: (dataURL: string) => void;   // hands the frame to the patrol gate
  onClose: () => void;
  busy: boolean;
}

export default function StreetCam({ mission, onCapture, onClose, busy }: Props) {
  const model = useStore(modelStore);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const grabRef = useRef<HTMLCanvasElement | null>(null);
  const runningRef = useRef(true);
  const [camErr, setCamErr] = useState('');
  const [liveHits, setLiveHits] = useState(0);
  const [scanning, setScanning] = useState(false);

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
    if (!v || !v.videoWidth) return null;
    if (!grabRef.current) grabRef.current = document.createElement('canvas');
    const cv = grabRef.current;
    const w = Math.min(v.videoWidth, maxW);
    const h = Math.round(v.videoHeight * w / v.videoWidth);
    cv.width = w; cv.height = h;
    cv.getContext('2d')!.drawImage(v, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', quality);
  }

  // live detection loop (~1fps — walking pace, phone-friendly)
  async function liveLoop() {
    while (runningRef.current) {
      const v = videoRef.current, ov = overlayRef.current;
      if (!v || !ov || !modelStore.get().ready) {
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
          if (boxes.length && navigator.vibrate) navigator.vibrate(30);
        }
      } catch { /* frame skipped */ }
      setScanning(false);
      await new Promise((r) => setTimeout(r, 450));
    }
  }

  function shutter() {
    const durl = grabFrame(0.85, 900);
    if (!durl) { toast('המצלמה עוד לא מוכנה'); return; }
    onCapture(durl);
  }

  return (
    <div className="streetcam">
      <video ref={videoRef} playsInline muted />
      <canvas ref={overlayRef} className="sc-overlay" />

      <div className="sc-top">
        <button className="ghost sc-close" onClick={onClose}>✕ מפה</button>
        <div className="pt-chip">
          {model.ready
            ? (liveHits ? `🎯 ${liveHits} זיהויים בפריים!` : scanning ? '🤖 סורק את הרחוב…' : '🎥 מצב רחוב')
            : '🎥 מצב רחוב (בלי AI חי — אין מודל)'}
        </div>
      </div>
      {mission && <div className="sc-mission">🎯 המשימה: {mission}</div>}

      {camErr && <div className="sc-err">{camErr}</div>}

      <button className={'pt-capture sc-shutter' + (busy ? ' busy' : '')} onClick={shutter} disabled={busy}>
        {busy ? '🤖' : '📸'}
      </button>
      <div className="pt-capture-lbl" style={{ zIndex: 12 }}>{busy ? 'ה-AI בודק…' : 'צלמו כשהמפגע בפריים'}</div>
    </div>
  );
}
