'use client';
// 🎥 Street Mode — walk with the camera OPEN, see the street live,
// and the trained model detects hazards on the live feed in real time.
// IMU angle guidance: a live AR compass band shows which shooting
// angles are already covered (red = blocked) and steers you to the
// open ones (green) BEFORE you shoot. Shutter locks on red.
import { useEffect, useRef, useState } from 'react';
import { modelStore, detectOnDataURL, drawDetections } from '@/lib/infer';
import { useStore, toast } from '@/lib/store';
import { getHeading, sectorOf, SECTOR_NAMES, requestCompassPermission } from '@/lib/compass';
import { fetchCoveredSectors, distM } from '@/lib/patrol';

interface Props {
  mission: string;
  onCapture: (dataURL: string) => void;   // hands the frame to the patrol gate
  onClose: () => void;
  busy: boolean;
  getPos: () => { lat: number; lng: number } | null;
  blockReason: () => string | null;       // null = ok to shoot; else why not
  onNeedLogin: () => void;
}

// live AR compass band: 180° field, sectors slide as you rotate.
// green = open angle (shoot here), red = already covered (blocked).
function CompassBand({ heading, covered }: { heading: number; covered: number[] }) {
  const W = 264, FOV = 180;
  return (
    <div className="cband" style={{ width: W }}>
      {Array.from({ length: 8 }, (_, i) => {
        const d = ((i * 45 - heading + 540) % 360) - 180;      // sector center vs view
        if (Math.abs(d) > FOV / 2 + 22.5) return null;
        const w = 45 / FOV * W;
        const x = W / 2 + (d / FOV) * W - w / 2;
        return (
          <div key={i}
            className={'cb-sec ' + (covered.includes(i) ? 'red' : 'green')}
            style={{ left: x, width: w }}>
            {i === 0 ? 'צ' : ''}
          </div>
        );
      })}
      <div className="cb-needle" />
    </div>
  );
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
  const [scanning, setScanning] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [covered, setCovered] = useState<number[] | null>(null);

  // IMU heading poll (~8Hz — smooth band, cheap renders).
  // noCompass flips on only after a grace period — sensors need a moment.
  const [noCompass, setNoCompass] = useState(false);
  useEffect(() => {
    const t0 = Date.now();
    const h = setInterval(() => {
      const g = getHeading();
      if (g != null) { setHeading(Math.round(g / 2) * 2); setNoCompass(false); }
      else if (Date.now() - t0 > 3000) setNoCompass(true);
    }, 120);
    return () => clearInterval(h);
  }, []);

  // angle coverage around me — refetch after moving >20m (checked every 4s)
  useEffect(() => {
    let stop = false;
    let last: { lat: number; lng: number } | null = null;
    const tick = async () => {
      if (stop) return;
      const p = getPos();
      if (p && mission && (!last || distM(last.lat, last.lng, p.lat, p.lng) > 20)) {
        last = p;
        try { setCovered(await fetchCoveredSectors(p.lat, p.lng, mission)); } catch { /* keep old */ }
      }
      setTimeout(tick, 4000);
    };
    tick();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission]);

  const curSector = heading != null ? sectorOf(heading) : null;
  const zone: 'green' | 'red' | null =
    heading != null && covered != null && curSector != null
      ? (covered.includes(curSector) ? 'red' : 'green')
      : null;

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
    // login / GPS gate — surface the reason LOUDLY, not a fleeting toast
    const reason = blockReason();
    if (reason === 'login') { onNeedLogin(); return; }
    if (reason) {
      toast(reason, true);
      if (navigator.vibrate) navigator.vibrate([50, 40, 50]);
      return;
    }
    // IMU gate: pointing into an already-covered angle → blocked before the shot
    if (zone === 'red') {
      toast('⛔ הזווית הזאת כבר מכוסה — סובבו עד שהפס יהיה ירוק', true);
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
      return;
    }
    const durl = grabFrame(0.85, 900);
    if (!durl) { toast('המצלמה עוד לא מוכנה — חכו רגע'); return; }
    onCapture(durl);
  }

  return (
    <div className={'streetcam' + (zone ? ' zone-' + zone : '')}>
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

      {/* IMU angle guidance — ALWAYS visible with an explicit state, so
          "does the meter even work?" is answerable at a glance:
          live degrees prove the compass is alive as you rotate */}
      <div className="sc-angle">
        {heading != null && covered != null ? (
          <>
            <CompassBand heading={heading} covered={covered} />
            <div className={'sc-zone ' + (zone || '')}>
              {zone === 'red'
                ? `⛔ ${SECTOR_NAMES[curSector!]} (${heading}°) כבר מכוסה — סובבו לירוק`
                : covered.length
                  ? `✅ ${SECTOR_NAMES[curSector!]} (${heading}°) — זווית פתוחה, צלמו!`
                  : `🧭 ${SECTOR_NAMES[curSector!]} (${heading}°) · אין עדיין צילומים ב-30מ' — כל הזוויות פתוחות`}
            </div>
          </>
        ) : heading != null ? (
          <div className="sc-zone">
            🧭 מצפן פעיל — {SECTOR_NAMES[curSector!]} ({heading}°) · {gpsReady ? 'טוען מפת כיסוי…' : 'ממתין ל-GPS לכיסוי זוויות'}
          </div>
        ) : noCompass ? (
          <div className="sc-zone red" onClick={() => requestCompassPermission()} style={{ cursor: 'pointer' }}>
            🧭 אין מצפן — הנחיית הזוויות כבויה (iPhone: הקישו לאישור חיישנים)
          </div>
        ) : null}
      </div>

      {camErr && <div className="sc-err">{camErr}</div>}

      {/* live readiness — so 'nothing happens' never happens silently */}
      <div className="sc-ready">
        <span className={'scr-chip' + (gpsReady ? ' ok' : '')}>
          {gpsReady ? '🛰️ GPS מוכן' : '🛰️ מחפש מיקום…'}
        </span>
      </div>

      <button
        className={'pt-capture sc-shutter' + (busy ? ' busy' : '') + (zone === 'red' ? ' locked' : '') + (!gpsReady ? ' waiting' : '')}
        onClick={shutter} disabled={busy}>
        {busy ? '🤖' : zone === 'red' ? '⛔' : !gpsReady ? '🛰️' : '📸'}
      </button>
      <div className="pt-capture-lbl" style={{ zIndex: 12 }}>
        {busy ? 'ה-AI בודק…'
          : zone === 'red' ? 'זווית חסומה — סובבו'
          : !gpsReady ? 'ממתין ל-GPS — צאו החוצה / אשרו מיקום'
          : 'צלמו כשהמפגע בפריים'}
      </div>
    </div>
  );
}
