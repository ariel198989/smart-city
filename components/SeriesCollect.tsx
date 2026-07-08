'use client';
// 📸 Series Collect — ANGLE-AWARE burst capture for training data.
// You circle the object; the camera auto-shoots every ~1.5s, BUT it
// tracks which of 8 compass sectors you've already captured and stops
// shooting from a covered angle — steering you to the sides you're
// missing. Angle-diverse data is what makes a YOLO model actually work.
import { useEffect, useRef, useState } from 'react';
import { insertDetection, uploadBlob } from '@/lib/db';
import { authStore } from '@/lib/auth';
import { useStore, toast } from '@/lib/store';
import { dataURLtoBlob } from '@/lib/util';
import { getHeading, sectorOf, requestCompassPermission, SECTOR_NAMES } from '@/lib/compass';
import { DEFAULT_CITY } from '@/lib/config';
import { assessFrameQuality } from '@/lib/quality';

const INTERVAL_MS = 1500;
const PER_SECTOR = 8;      // shots per angle before it's "covered" (8×8 ≈ 64)

// top-down radar: which sides of the object are covered (cyan) vs missing (gold dashed)
function AngleRing({ cov, cur }: { cov: number[]; cur: number | null }) {
  const wedge = (i: number) => {
    const a0 = ((i * 45 - 22.5) - 90) * Math.PI / 180;
    const a1 = ((i * 45 + 22.5) - 90) * Math.PI / 180;
    const r = 42, cx = 50, cy = 50;
    return `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 0 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`;
  };
  return (
    <svg viewBox="0 0 100 100" className="sr-ring" width="118" height="118">
      {Array.from({ length: 8 }, (_, i) => {
        const full = cov[i] >= PER_SECTOR;
        const partial = cov[i] > 0 && !full;
        return (
          <path key={i} d={wedge(i)}
            fill={full ? 'rgba(53,225,255,.4)' : partial ? 'rgba(53,225,255,.15)' : 'rgba(255,182,39,.06)'}
            stroke={full ? 'rgba(53,225,255,.8)' : 'rgba(255,182,39,.45)'}
            strokeWidth=".8" strokeDasharray={full ? '0' : '2 2'} />
        );
      })}
      {cur != null && (
        <line x1="50" y1="50"
          x2={50 + 46 * Math.cos((cur - 90) * Math.PI / 180)}
          y2={50 + 46 * Math.sin((cur - 90) * Math.PI / 180)}
          stroke="#FFB627" strokeWidth="2.6" strokeLinecap="round" />
      )}
      <circle cx="50" cy="50" r="4" fill="#FFB627" />
    </svg>
  );
}

interface Props {
  classNames: string[];   // multi-object session: shoot a series PER object
  getPos: () => { lat: number; lng: number } | null;
  onClose: (collected: number) => void;
}

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

  // 🎯 which object is being photographed right now
  const [activeIdx, setActiveIdx] = useState(0);
  const activeRef = useRef(0);
  const className = classNames[activeIdx] || classNames[0] || 'מפגע';
  // per-object shot counts (shown on the switcher chips)
  const perClassRef = useRef<Record<string, number>>({});
  const [perClass, setPerClass] = useState<Record<string, number>>({});

  // 🧭 angle coverage — per OBJECT, 8 compass sectors each
  // (switching object switches to ITS radar; coming back restores it)
  const covMapRef = useRef<Record<string, number[]>>({});
  const covFor = (cls: string) => (covMapRef.current[cls] ||= Array(8).fill(0));
  const covRef = { get current() { return covFor(classNames[activeRef.current] || 'מפגע'); } };
  const [cov, setCov] = useState<number[]>(Array(8).fill(0));

  function switchClass(i: number) {
    activeRef.current = i;
    setActiveIdx(i);
    setCov([...covFor(classNames[i])]);
    if (navigator.vibrate) navigator.vibrate(15);
  }
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    requestCompassPermission();
    const h = setInterval(() => setHeading(getHeading()), 150);
    return () => clearInterval(h);
  }, []);

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

  async function saveFrame(durl: string, hd: number | null, cls: string) {
    const at = getPos() || { lat: DEFAULT_CITY.center_lat, lng: DEFAULT_CITY.center_lng };
    const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const framePath = `pool/s_${stamp}.jpg`;
    await uploadBlob(framePath, dataURLtoBlob(durl), 'image/jpeg');
    await insertDetection({
      lat: at.lat, lng: at.lng, class_name: cls, confidence: 0,
      frame_path: framePath, detected_by: authStore.get().user!.id,
      team_name: authStore.get().team || null, credits: 0, heading: hd,
    });
  }

  async function loop() {
    while (runningRef.current) {
      const hd = getHeading();
      const sec = hd != null ? sectorOf(hd) : null;
      // 🧭 angle gate: if we know the direction and this side is already
      // covered, DON'T shoot — nudge to a missing angle instead
      if (sec != null && covRef.current[sec] >= PER_SECTOR) {
        if (navigator.vibrate) navigator.vibrate(8);
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }
      const durl = grab();
      if (durl) {
        const q = await assessFrameQuality(durl);
        if (!q.ok) { setSkipped((n) => n + 1); await new Promise((r) => setTimeout(r, INTERVAL_MS)); continue; }
        try {
          const cls = classNames[activeRef.current] || classNames[0] || 'מפגע';
          await saveFrame(durl, hd, cls);
          shotsRef.current += 1;
          setShots(shotsRef.current);
          perClassRef.current[cls] = (perClassRef.current[cls] || 0) + 1;
          setPerClass({ ...perClassRef.current });
          if (sec != null) { covRef.current[sec] += 1; setCov([...covRef.current]); }
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

  const hasCompass = heading != null;
  const curSector = heading != null ? sectorOf(heading) : null;
  const coveredCount = covRef.current.filter((c) => c >= PER_SECTOR).length;
  const zone: 'green' | 'red' | null =
    curSector != null ? (covRef.current[curSector] >= PER_SECTOR ? 'red' : 'green') : null;
  const missing = Array.from({ length: 8 }, (_, i) => i).filter((i) => covRef.current[i] < PER_SECTOR);

  return (
    <div className={'streetcam' + (running && zone ? ' zone-' + zone : '')} style={{ zIndex: 70 }}>
      <video ref={videoRef} playsInline muted />
      <div className="sc-top">
        <button className="ghost sc-close" onClick={() => { runningRef.current = false; onClose(shotsRef.current); }}>✕ סיום</button>
        <div className="pt-chip">📸 סדרת אימון: {className}</div>
      </div>

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

        {hasCompass ? (
          <>
            <AngleRing cov={cov} cur={heading} />
            <div className="series-count" style={{ padding: '6px 18px', borderColor: 'rgba(53,225,255,.4)' }}>
              <b style={{ fontSize: 22, color: 'var(--cy)' }}>{coveredCount}/8</b><span>זוויות כוסו</span>
            </div>
            {running && (
              <div className={'sc-zone ' + (zone || '')} style={{ maxWidth: 300 }}>
                {zone === 'red'
                  ? `⛔ ${SECTOR_NAMES[curSector!]} כבר מכוסה — סובבו לצד שחסר`
                  : `✅ ${SECTOR_NAMES[curSector!]} — צלמו! חסרים: ${missing.map((i) => SECTOR_NAMES[i]).join(' · ') || 'סיימתם! 🎉'}`}
              </div>
            )}
          </>
        ) : (
          running && <div className="series-live">● מצלם כל {INTERVAL_MS / 1000} שנ' — הסתובבו סביב האובייקט (אין מצפן — צלמו מכל הזוויות ידנית)</div>
        )}

        {skipped > 0 && <div className="hint" style={{ fontSize: 10.5 }}>🧹 {skipped} פריימים מטושטשים/חשוכים סוננו</div>}
        {!running && shots === 0 && <div className="hint" style={{ textAlign: 'center' }}>לחצו התחל, ולכו לאט סביב ה{className} — הרדאר יראה אילו זוויות כבר כיסיתם.</div>}
        {thumbs.length > 0 && (
          <div className="series-thumbs">{thumbs.map((t, i) => <img key={i} src={t} alt="" />)}</div>
        )}
      </div>

      {camErr && <div className="sc-err">{camErr}</div>}

      <button className={'pt-capture sc-shutter' + (running ? ' rec' : '')} onClick={toggle}>
        {running ? '⏸' : '▶'}
      </button>
      <div className="pt-capture-lbl" style={{ zIndex: 12 }}>
        {running ? (zone === 'red' ? 'זווית מכוסה — סובבו' : 'לחצו להפסקה') : shots ? 'המשך · או ✕ לסיום ותיוג' : 'התחל צילום אוטומטי'}
      </div>
    </div>
  );
}
