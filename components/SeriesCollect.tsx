'use client';
// 📸 Series Collect — the group-training data machine:
// pick the class the group agreed on → the camera shoots a frame every
// ~1.5s while you circle the object → 60 photos with zero taps.
// Frames land in YOUR tagging queue (no bbox yet, no credits — this is
// dataset work, not the game).
import { useEffect, useRef, useState } from 'react';
import { insertDetection, uploadBlob } from '@/lib/db';
import { authStore } from '@/lib/auth';
import { useStore, toast } from '@/lib/store';
import { dataURLtoBlob } from '@/lib/util';
import { getHeading } from '@/lib/compass';
import { DEFAULT_CITY } from '@/lib/config';

const INTERVAL_MS = 1500;

interface Props {
  className: string;                       // the class the group decided on
  getPos: () => { lat: number; lng: number } | null;
  onClose: (collected: number) => void;
}

export default function SeriesCollect({ className, getPos, onClose }: Props) {
  const auth = useStore(authStore);
  const videoRef = useRef<HTMLVideoElement>(null);
  const grabRef = useRef<HTMLCanvasElement | null>(null);
  const [camErr, setCamErr] = useState('');
  const [running, setRunning] = useState(false);
  const [shots, setShots] = useState(0);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const runningRef = useRef(false);
  const shotsRef = useRef(0);

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

  async function saveFrame(durl: string) {
    const at = getPos() || { lat: DEFAULT_CITY.center_lat, lng: DEFAULT_CITY.center_lng };
    const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const framePath = `pool/s_${stamp}.jpg`;
    await uploadBlob(framePath, dataURLtoBlob(durl), 'image/jpeg');
    await insertDetection({
      lat: at.lat, lng: at.lng, class_name: className, confidence: 0,
      frame_path: framePath, detected_by: authStore.get().user!.id,
      team_name: authStore.get().team || null, credits: 0, heading: getHeading(),
    });
  }

  async function loop() {
    while (runningRef.current) {
      const durl = grab();
      if (durl) {
        try {
          await saveFrame(durl);
          shotsRef.current += 1;
          setShots(shotsRef.current);
          setThumbs((t) => [durl, ...t].slice(0, 6));
          if (navigator.vibrate) navigator.vibrate(20);
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
        <button className="ghost sc-close" onClick={() => { runningRef.current = false; onClose(shotsRef.current); }}>✕ סיום</button>
        <div className="pt-chip">📸 סדרת אימון: {className}</div>
      </div>

      <div className="series-hud">
        <div className="series-count"><b>{shots}</b><span>תמונות</span></div>
        {running && <div className="series-live">● מצלם כל {INTERVAL_MS / 1000} שנ' — הסתובבו סביב האובייקט</div>}
        {!running && shots === 0 && <div className="hint" style={{ textAlign: 'center' }}>לחצו התחל, ולכו לאט סביב ה{className} — מכל הזוויות, מכל המרחקים</div>}
        {thumbs.length > 0 && (
          <div className="series-thumbs">
            {thumbs.map((t, i) => <img key={i} src={t} alt="" />)}
          </div>
        )}
      </div>

      {camErr && <div className="sc-err">{camErr}</div>}

      <button className={'pt-capture sc-shutter' + (running ? ' rec' : '')} onClick={toggle}>
        {running ? '⏸' : '▶'}
      </button>
      <div className="pt-capture-lbl" style={{ zIndex: 12 }}>
        {running ? 'לחצו להפסקה' : shots ? 'המשך צילום · או ✕ לסיום ותיוג' : 'התחל צילום אוטומטי'}
      </div>
    </div>
  );
}
