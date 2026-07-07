'use client';
// 🎮 City Patrol — Pokémon-GO-style mobile game mode:
// GPS avatar on the real city map, real crosswalk spawn points from OSM,
// photo-capture gated by the trained model, credits + monthly prizes.
import { useEffect, useRef, useState } from 'react';
import { MAP_STYLE, DEFAULT_CITY, CLASS_PALETTE } from '@/lib/config';
import { insertDetection, uploadBlob, fetchMyCatches, publicUrl } from '@/lib/db';
import { STATUS_META } from '@/lib/status';
import { modelStore, detectOnDataURL, clsOf, cropDetection } from '@/lib/infer';
import { authStore } from '@/lib/auth';
import { useStore, toast, bumpData } from '@/lib/store';
import { classColor, dataURLtoBlob, fileToDataURL } from '@/lib/util';
import { fetchCrossingSpawns, isCrossingClass, calcCredits, ensureCityModel, fetchMonthlyLeaderboard, distM, fetchCoveredSectors, estimateObjectDistanceM, projectForward, type Spawn } from '@/lib/patrol';
import { touchStreak, dailyProgress, dailyCatch, DAILY_TARGET, DAILY_BONUS } from '@/lib/daily';
import { assessFrameQuality } from '@/lib/quality';
import { fetchMyContribution } from '@/lib/citypool';
import { pocketStore, initPocket, classifyPocket, POCKET_PASS_CONF } from '@/lib/pocket';
import PocketTrainer from '@/components/PocketTrainer';
import TrainReal from '@/components/TrainReal';
import { startCompass, requestCompassPermission, getHeading, sectorOf, SECTOR_NAMES } from '@/lib/compass';
import StreetCam from '@/components/StreetCam';
import { BottomBar, TrainingHub, MeHub, type MobileTab } from '@/components/MobileHubs';
import SeriesCollect from '@/components/SeriesCollect';
import MobileTagger from '@/components/MobileTagger';
import { sb } from '@/lib/db';

import ResultCards, { type CatchResult } from '@/components/ResultCards';

export default function PatrolView({ defaultCam = false }: { defaultCam?: boolean }) {
  const auth = useStore(authStore);
  const model = useStore(modelStore);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const avatarRef = useRef<any>(null);
  const spawnMarks = useRef<any[]>([]);
  const posRef = useRef<{ lat: number; lng: number } | null>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsErr, setGpsErr] = useState('');
  const [mission, setMission] = useState<string>('');
  const [modelMsg, setModelMsg] = useState('טוען את מודל העיר…');
  const [spawns, setSpawns] = useState<Spawn[]>([]);
  const [nearest, setNearest] = useState<number | null>(null);
  const [result, setResult] = useState<CatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [credits, setCredits] = useState(0);
  const [streak, setStreak] = useState(1);
  const [dailyN, setDailyN] = useState(0);
  useEffect(() => { setStreak(touchStreak()); setDailyN(dailyProgress()); }, []);
  const [hub, setHub] = useState<'train' | 'me' | null>(null);
  // 📸 series capture + 🏷️ phone tagging (the group-training machine)
  const [series, setSeries] = useState(false);
  const [tagger, setTagger] = useState(false);
  const [myUntagged, setMyUntagged] = useState<number | null>(null);
  useEffect(() => {
    if (hub !== 'train' || !auth.user) return;
    sb.from('sc_detections').select('id', { count: 'exact', head: true })
      .eq('detected_by', auth.user.id).is('bbox', null).not('frame_path', 'is', null).neq('status', 'rejected')
      .then(({ count }) => setMyUntagged(count ?? 0));
  }, [hub, tagger, series, auth.user]);
  // 🗂️ personal catch log — the sync made visible ("where did my photos go?")
  const [myLog, setMyLog] = useState(false);
  const [myRows, setMyRows] = useState<any[] | null>(null);
  useEffect(() => {
    if (!myLog || !auth.user) return;
    setMyRows(null);
    fetchMyCatches(auth.user.id).then(setMyRows).catch(() => setMyRows([]));
  }, [myLog, auth.user]);
  const [showBoard, setShowBoard] = useState(false);
  const [board, setBoard] = useState<{ name: string; credits: number; catches: number }[]>([]);
  const [myPool, setMyPool] = useState<number | null>(null);
  const pocket = useStore(pocketStore);
  const [showTrainer, setShowTrainer] = useState(false);
  const [showTrainReal, setShowTrainReal] = useState(false);
  const [briefed, setBriefed] = useState(true);
  const [briefReady, setBriefReady] = useState(false);
  const [camMode, setCamMode] = useState(false);
  // 📱 mobile bottom tab bar — 'map' is the game itself
  const activeTab: MobileTab = camMode ? 'cam' : hub === 'train' ? 'train' : hub === 'me' ? 'me' : 'map';
  function onTab(t: MobileTab) {
    if (t === 'map') { setCamMode(false); setHub(null); }
    else if (t === 'cam') { setHub(null); requestCompassPermission(); setCamMode(true); }
    else { setCamMode(false); setHub(t); }
  }

  // boot: map + GPS + auto-load registered city model ("המטריצה כבר אצלך")
  useEffect(() => {
    let disposed = false;
    let watchId: number | null = null;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      if (disposed || !mapEl.current || mapRef.current) return;
      const map = new maplibregl.Map({
        container: mapEl.current, style: MAP_STYLE as any,
        center: [DEFAULT_CITY.center_lng, DEFAULT_CITY.center_lat],
        zoom: 16, pitch: 45, attributionControl: false,
      });
      mapRef.current = { map, maplibregl };
      // avatar — הסוכן שלך
      const el = document.createElement('div');
      el.className = 'agent';
      el.innerHTML = '<div class="agent-ring"></div><div class="agent-body">🕵️</div>';
      avatarRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([DEFAULT_CITY.center_lng, DEFAULT_CITY.center_lat]).addTo(map);

      startCompass();  // heading for angle-diversity (iOS asks on street-mode tap)

      // no GPS? tap the map to walk (desktop demo / kids indoors)
      map.on('click', (e: any) => {
        if (!posRef.current || gpsErr) moveAgent(e.lngLat.lat, e.lngLat.lng, true);
      });

      // GPS follow
      if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(
          (p) => moveAgent(p.coords.latitude, p.coords.longitude, false),
          () => setGpsErr('אין GPS — לחצו על המפה כדי "ללכת" 🚶'),
          { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 },
        );
      } else setGpsErr('אין GPS — לחצו על המפה כדי "ללכת" 🚶');

      // real crosswalk spawns from OpenStreetMap
      try {
        const sp = await fetchCrossingSpawns(DEFAULT_CITY.center_lat, DEFAULT_CITY.center_lng);
        if (!disposed) setSpawns(sp);
      } catch { /* overpass down — game still works without spawns */ }
    })();

    initPocket();   // restore the personal on-device model, if trained
    ensureCityModel().then((r) => {
      setModelMsg(r.ok ? '' : (r.error || ''));
      const cls = modelStore.get().classes;
      // default mission: first model class, or crosswalks (OSM spawns work even without a model)
      setMission(cls.length ? cls[0] : 'מעבר חציה');
      // mission briefing — once per session, after we know what the model knows
      setBriefReady(true);
      let seen = false;
      try { seen = sessionStorage.getItem('sc_briefed') === '1'; } catch { /* private mode */ }
      setBriefed(seen);
      // 📱 mobile default = street camera (returning user goes straight in)
      if (seen && defaultCam) setCamMode(true);
    });

    return () => {
      disposed = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      // WebGL contexts are precious on cheap phones — release the map
      try { mapRef.current?.map?.remove(); } catch { /* already gone */ }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function moveAgent(lat: number, lng: number, fly: boolean) {
    posRef.current = { lat, lng };
    setPos({ lat, lng });
    const m = mapRef.current;
    if (!m) return;
    avatarRef.current?.setLngLat([lng, lat]);
    if (fly) m.map.easeTo({ center: [lng, lat], duration: 600 });
    else m.map.easeTo({ center: [lng, lat], duration: 900 });
  }

  // render spawn markers when mission is a crossing-type class
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    spawnMarks.current.forEach((mk) => mk.remove());
    spawnMarks.current = [];
    if (!mission || !isCrossingClass(mission) || !spawns.length) return;
    spawnMarks.current = spawns.map((s) => {
      const el = document.createElement('div');
      el.className = 'spawn';
      el.title = 'מעבר חציה — משימה!';
      return new m.maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m.map);
    });
  }, [mission, spawns]);

  // nearest spawn distance (mission-zone bonus)
  useEffect(() => {
    if (!pos || !spawns.length || !isCrossingClass(mission)) { setNearest(null); return; }
    const d = Math.min(...spawns.map((s) => distM(pos.lat, pos.lng, s.lat, s.lng)));
    setNearest(Math.round(d));
  }, [pos, spawns, mission]);

  async function capture(f: File) {
    const durl = await fileToDataURL(f, 900, 675);
    await captureFromDataURL(durl);
  }

  async function captureFromDataURL(durl: string) {
    if (!auth.user) { toast('נכנסים עם משתמש — ותופסים מפגעים 🎮', true); authStore.set({ viewer: false }); return; }
    const at = posRef.current;
    if (!at) { toast('אין מיקום עדיין — הפעילו GPS או לחצו על המפה'); return; }
    setBusy(true); setResult(null);
    try {
      // 📷 GATE 0: instant quality check — junk photos never reach the AI
      // (blurry/dark frames poison the city training pool)
      const q = await assessFrameQuality(durl);
      if (!q.ok) {
        toast(q.reason!, true);
        if (navigator.vibrate) navigator.vibrate([50, 40, 50]);
        setBusy(false);
        return;
      }
      const gated = modelStore.get().ready;
      const nearSpawn = nearest != null && nearest <= 60;

      if (gated) {
        // 🧠 GATE 1: the city model judges the photo on-device
        const { boxes } = await detectOnDataURL(durl, 0.3);
        const relevant = mission
          ? boxes.filter((b) => clsOf(b.cls).name === mission)
          : boxes;
        if (!relevant.length) {
          const found = boxes.length ? clsOf(boxes[0].cls).name : null;
          // keep the frame — a blocked photo is training gold either way
          setResult({ kind: 'blocked', mission: mission || 'מפגע', found, durl });
          if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
          setBusy(false);
          return;
        }
        const best = relevant.sort((a, b) => b.score - a.score)[0];
        const cls = mission || clsOf(best.cls).name;

        // 📐 GATE 2: angle diversity — the agent knows which viewpoints it
        // already has here; a repeated angle is worthless training data
        const heading = getHeading();
        let newAngle = false;
        if (heading != null) {
          try {
            const covered = await fetchCoveredSectors(at.lat, at.lng, cls);
            const cur = sectorOf(heading);
            if (covered.includes(cur)) {
              setResult({ kind: 'angle', covered, current: heading });
              if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 60]);
              setBusy(false);
              return;
            }
            newAngle = covered.length > 0;   // bonus only when filling a gap
          } catch { /* angle service down — capture proceeds */ }
        }

        // 🎯 daily challenge: first 3 gated catches today earn +10 each
        const daily = dailyCatch();
        setDailyN(daily.count);
        const cr = calcCredits({ conf: best.score, nearSpawn, gated: true, newAngle }) + daily.bonus;
        const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const cropURL = await cropDetection(durl, best);
        const path = `crops/p_${stamp}.jpg`;        // crop for the map pin
        const framePath = `pool/f_${stamp}.jpg`;    // full frame → city training pool
        await uploadBlob(path, dataURLtoBlob(cropURL), 'image/jpeg');
        await uploadBlob(framePath, dataURLtoBlob(durl), 'image/jpeg');
        // 🎯 auto-pin ON the object: GPS gives the photographer's position;
        // project forward along the compass heading by the distance the
        // bbox geometry implies — the pin lands on the hazard itself
        let pinAt = { lat: at.lat, lng: at.lng };
        if (heading != null) {
          pinAt = projectForward(at.lat, at.lng, heading, estimateObjectDistanceM(best));
        }
        await insertDetection({
          lat: pinAt.lat, lng: pinAt.lng,
          class_name: cls,
          confidence: best.score, crop_path: path,
          frame_path: framePath,                    // full photo (training data)
          bbox: { x: best.x, y: best.y, w: best.w, h: best.h },  // YOLO label
          detected_by: auth.user.id, team_name: auth.team || null,
          credits: cr, heading,
        });
        setCredits((c) => c + cr);
        setResult({ kind: 'pass', cls, conf: best.score, credits: cr, newAngle, daily: daily.bonus });
        if (navigator.vibrate) navigator.vibrate(200);
        bumpData();
      } else if (pocketStore.get().ready) {
        // 🎓 no city YOLO — the resident's own pocket model is the gate
        const pk = pocketStore.get();
        const { label, confidence } = await classifyPocket(durl);
        if (label !== 'target' || confidence < POCKET_PASS_CONF) {
          setResult({
            kind: 'blocked', mission: pk.className, durl,
            found: label === 'target' ? `לא בטוח מספיק — רק ${Math.round(confidence * 100)}%` : null,
          });
          if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
          setBusy(false);
          return;
        }
        const daily = dailyCatch();
        setDailyN(daily.count);
        const cr = calcCredits({ conf: confidence, nearSpawn, gated: true }) + daily.bonus;
        const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const path = `crops/p_${stamp}.jpg`;
        const framePath = `pool/f_${stamp}.jpg`;   // frame kept — taggable later
        await uploadBlob(path, dataURLtoBlob(durl), 'image/jpeg');
        await uploadBlob(framePath, dataURLtoBlob(durl), 'image/jpeg');
        const heading = getHeading();
        let pinAt = { lat: at.lat, lng: at.lng };
        if (heading != null) pinAt = projectForward(at.lat, at.lng, heading, 5);
        await insertDetection({
          lat: pinAt.lat, lng: pinAt.lng,
          class_name: pk.className, confidence,
          crop_path: path, frame_path: framePath,   // no bbox (classifier) — excluded from auto-pool, tag on desktop
          detected_by: auth.user.id, team_name: auth.team || null,
          credits: cr, heading,
        });
        setCredits((c) => c + cr);
        setResult({ kind: 'pass', cls: pk.className + ' (מודל כיס 🎓)', conf: confidence, credits: cr, daily: daily.bonus });
        if (navigator.vibrate) navigator.vibrate(200);
        bumpData();
      } else {
        // no model at all — accept unfiltered, small reward
        const cr = calcCredits({ gated: false });
        const path = `crops/p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
        await uploadBlob(path, dataURLtoBlob(durl), 'image/jpeg');
        await insertDetection({
          lat: at.lat, lng: at.lng,
          class_name: mission || 'מפגע כללי', confidence: 0,
          crop_path: path, detected_by: auth.user.id, team_name: auth.team || null,
          credits: cr, heading: getHeading(),
        });
        setCredits((c) => c + cr);
        setResult({ kind: 'ungated', credits: cr });
        bumpData();
      }
    } catch (e: any) { toast('תפיסה: ' + (e.message || e)); }
    setBusy(false);
  }

  // 🎓 field feedback on a blocked photo — the missing half of training
  async function sendFeedback(durl: string, claimedClass: string, kind: 'dispute' | 'negative') {
    if (!auth.user) { toast('צריך להתחבר', true); authStore.set({ viewer: false }); return; }
    setBusy(true);
    try {
      const path = `feedback/fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;  // ASCII-only key
      await uploadBlob(path, dataURLtoBlob(durl), 'image/jpeg');
      const at = posRef.current;
      const { error } = await (await import('@/lib/db')).sb.from('sc_feedback').insert({
        frame_path: path, claimed_class: claimedClass, kind,
        lat: at?.lat ?? null, lng: at?.lng ?? null, heading: getHeading(),
        submitted_by: auth.user.id, team_name: auth.team || null,
      });
      if (error) throw error;
      setResult({
        kind: 'feedback_sent',
        msg: kind === 'dispute'
          ? 'נשלח למדריך! אם צדקתם — המודל ילמד מהתמונה הזאת ותקבלו 💎'
          : 'תודה! התמונה תלמד את המודל מה זה "לא מפגע" 🧠',
      });
      if (navigator.vibrate) navigator.vibrate(120);
    } catch (e: any) { toast('משוב: ' + (e.message || e)); }
    setBusy(false);
  }

  async function openBoard() {
    setShowBoard(true);
    try {
      setBoard(await fetchMonthlyLeaderboard());
      if (auth.user) setMyPool(await fetchMyContribution(auth.user.id));
    } catch (e: any) { toast(e.message || e); }
  }

  function share() {
    const txt = `תפסתי מפגע עירוני ב-Smart City שדרות! 🏙️ יש לי כבר ${credits} קרדיטים החודש. בואו לשחק:`;
    if (navigator.share) navigator.share({ title: 'Smart City פטרול', text: txt, url: location.origin }).catch(() => {});
    else { navigator.clipboard?.writeText(txt + ' ' + location.origin); toast('הועתק — הדביקו בוואטסאפ 📋', true); }
  }

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <section className="view patrol">
      <div className="patrol-shell hud">
        <div ref={mapEl} id="patrolMap" />

        {/* top HUD: mission + credits + streak + daily challenge */}
        <div className="pt-top">
          <div className="pt-chip pt-credits" onClick={openBoard} title="לוח מובילים חודשי">
            <b>{credits}</b> קרדיטים · 🏆
          </div>
          {streak > 1 && (
            <div className="pt-chip" style={{ color: 'var(--gold)' }} title={`רצף של ${streak} ימים — אל תשברו אותו!`}>
              🔥 {streak}
            </div>
          )}
          <div className="pt-chip" style={{ fontSize: 11 }}
            title={`אתגר יומי: ${DAILY_TARGET} תפיסות דרך שער ה-AI = +${DAILY_BONUS} קרדיטים כל אחת`}>
            🎯 {dailyN}/{DAILY_TARGET}{dailyN >= DAILY_TARGET ? ' ✓' : ''}
          </div>
          {!defaultCam && (
            <div className="pt-chip" style={{ fontSize: 11 }} onClick={() => setMyLog(true)} title="כל התמונות שצילמתם">🗂️ שלי</div>
          )}
          {model.ready ? (
            <select className="pt-mission" value={mission} onChange={(e) => setMission(e.target.value)} title="המשימה">
              {model.classes.map((c) => <option key={c} value={c}>🎯 {c}</option>)}
            </select>
          ) : pocket.ready ? (
            <div className="pt-chip" style={{ fontSize: 11 }} onClick={() => setShowTrainer(true)}>🎓 {pocket.className}</div>
          ) : (
            <div className="pt-chip" style={{ fontSize: 11 }} onClick={() => setShowTrainer(true)}>🎓 אמן מודל כיס</div>
          )}
        </div>

        {/* mission-zone hint */}
        {nearest != null && (
          <div className={'pt-near' + (nearest <= 60 ? ' in' : '')}>
            {nearest <= 60 ? '🎯 בטווח משימה! בונוס +5' : `מעבר החציה הקרוב: ${nearest} מ׳`}
          </div>
        )}
        {gpsErr && (
          <button className="pt-gps" onClick={() => {
            navigator.geolocation?.getCurrentPosition(
              (p) => { setGpsErr(''); moveAgent(p.coords.latitude, p.coords.longitude, true); },
              () => toast('הדפדפן חוסם מיקום — אפשרו "מיקום" לאתר בהגדרות', true),
              { enableHighAccuracy: true, timeout: 10000 },
            );
          }}>
            {gpsErr} · נסו שוב 🛰️
          </button>
        )}

        {/* capture result */}
        <ResultCards result={result} busy={busy}
          onClose={() => setResult(null)} onShare={share}
          onMyLog={() => setMyLog(true)} onFeedback={sendFeedback} />

        {/* mission briefing — what YOUR model is trained on */}
        {briefReady && !briefed && (
          <div className="pt-brief" onClick={(e) => {
            // tap outside the card = skip the briefing (kid-proof escape)
            if (e.target === e.currentTarget) {
              setBriefed(true);
              try { sessionStorage.setItem('sc_briefed', '1'); } catch { /* private mode */ }
            }
          }}>
            <div className="ptb-inner">
              <img src="/agent.jpg" alt="" className="ptb-agent-img" />
              <div className="ptb-title">ברוך הבא לפטרול{auth.team ? ', ' + auth.team : ''}!</div>
              {model.ready ? (
                <>
                  <div className="ptb-sub">המודל שלך מאומן לזהות:</div>
                  <div className="ptb-classes">
                    {model.classes.map((c) => (
                      <span key={c} className="ptb-cls" style={{ borderColor: classColor(c, CLASS_PALETTE) }}>
                        <i style={{ background: classColor(c, CLASS_PALETTE) }} />{c}
                      </span>
                    ))}
                  </div>
                  <div className="ptb-hint">הסתובבו בעיר וצלמו בדיוק את אלה — ה-AI בודק כל תמונה. צילום לא רלוונטי ייחסם 🙅. כל תפיסה = 💎 קרדיטים.</div>
                </>
              ) : pocket.ready ? (
                <div className="ptb-hint">🎓 המודל האישי שלך פעיל: מזהה <b>{pocket.className}</b> — הוא ישמש כשער עד שיהיה מודל עירוני.</div>
              ) : (
                <>
                  {/* copy rule (Ariel): a button promises an OUTCOME, not a feature */}
                  <div className="ptb-hint">
                    רואים מפגע ברחוב? מצלמים — <b>והוא הופך לנעץ על מפת העיר שהעירייה רואה.</b>
                  </div>
                  <button className="hot" style={{ width: '100%', marginTop: 10 }}
                    onClick={() => setShowTrainer(true)}>
                    🎓 קודם משהו מגניב: למדו את הטלפון לזהות בעצמו (30 שניות)
                  </button>
                </>
              )}
              <button className="primary ptb-go" onClick={() => {
                setBriefed(true);
                try { sessionStorage.setItem('sc_briefed', '1'); } catch { /* private mode */ }
                // mobile: the button tap is the user gesture → open the live camera now
                if (defaultCam) { requestCompassPermission(); setCamMode(true); }
              }}>
                {defaultCam ? '📸 יציאה לרחוב — מצלמים מפגע ראשון' : '🎮 יציאה לסיור במפה'}
              </button>
            </div>
          </div>
        )}

        {/* 🎥 street mode — live camera with real-time AI */}
        {camMode && (
          <StreetCam
            mission={mission}
            busy={busy}
            onCapture={captureFromDataURL}
            onClose={() => setCamMode(false)}
            getPos={() => posRef.current}
            blockReason={() => {
              if (!authStore.get().user) return 'login';
              if (!posRef.current) return '🛰️ עוד אין מיקום GPS — צאו לאזור פתוח או אשרו הרשאת מיקום';
              return null;
            }}
            onNeedLogin={() => { toast('התחברו כדי לתפוס מפגעים 🎮', true); authStore.set({ viewer: false }); }}
          />
        )}

        {/* big capture buttons */}
        {!camMode && (
          <>
            <button className="pt-streetmode" onClick={() => { requestCompassPermission(); setCamMode(true); }}>
              🎥 מצב רחוב — מצלמה חיה
            </button>
            <label className={'pt-capture' + (busy ? ' busy' : '')}>
              {busy ? '🤖' : '📸'}
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files?.[0]) capture(e.target.files[0]); e.target.value = ''; }} />
            </label>
            <div className="pt-capture-lbl">{busy ? 'ה-AI בודק…' : mission ? `צלמו ${mission}` : 'צלמו מפגע'}</div>
          </>
        )}
      </div>

      <p className="hint center">
        🕵️ הסוכן זז עם ה-GPS שלכם (או בלחיצה על המפה) · נקודות 🟡 = מעברי חציה אמיתיים מ-OpenStreetMap · צילום נבדק ע"י מודל ה-AI לפני שנשלח
      </p>

      {showTrainer && <PocketTrainer mission={mission} onClose={() => setShowTrainer(false)} />}
      {showTrainReal && <TrainReal onClose={() => setShowTrainReal(false)} />}

      {/* 📱 mobile hubs — slide up above the map, below the tab bar */}
      {defaultCam && hub === 'train' && (
        <TrainingHub onClose={() => setHub(null)}
          mission={mission || 'מעבר חציה'} myUntagged={myUntagged}
          onTrainer={() => setShowTrainer(true)} onTrainReal={() => setShowTrainReal(true)}
          onSeries={() => setSeries(true)} onTagger={() => setTagger(true)} />
      )}
      {series && (
        <SeriesCollect className={mission || 'מעבר חציה'} getPos={() => posRef.current}
          onClose={(n) => {
            setSeries(false);
            if (n > 0) { toast(`📸 ${n} תמונות נשמרו — עכשיו מתייגים!`, true); setTagger(true); }
          }} />
      )}
      {tagger && <MobileTagger onClose={() => { setTagger(false); bumpData(); }} />}
      {defaultCam && hub === 'me' && (
        <MeHub onClose={() => setHub(null)}
          onMyLog={() => setMyLog(true)} onBoard={openBoard}
          credits={credits} streak={streak} dailyN={dailyN} />
      )}
      {defaultCam && <BottomBar active={activeTab} onTab={onTab} />}

      {/* 🗂️ my catch log — every photo + exactly where it is in the pipeline */}
      {myLog && (
        <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) setMyLog(false); }}>
          <div className="card hud det-modal">
            <button className="ghost mclose" onClick={() => setMyLog(false)}>✕</button>
            <h3 style={{ fontSize: 14, letterSpacing: '.2em' }}>🗂️ התמונות שלי — ומה קרה עם כל אחת</h3>
            {!auth.user && <div className="hint">התחברו כדי לראות את היומן שלכם</div>}
            {auth.user && myRows === null && <div className="hint">טוען…</div>}
            {auth.user && myRows?.length === 0 && <div className="hint">עוד לא צילמתם — צאו לפטרול! 📸</div>}
            {myRows?.map((r: any) => (
              <div key={r.id} className="boxrow" style={{ gap: 10, alignItems: 'center' }}>
                {(r.crop_path || r.frame_path)
                  ? <img src={publicUrl(r.crop_path || r.frame_path)} alt="" style={{ width: 46, height: 46, objectFit: 'cover', border: '1px solid var(--cy-line)' }} />
                  : <span style={{ fontSize: 22 }}>📷</span>}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5 }}><b>{r.class_name}</b>{r.confidence ? ` · ${Math.round(r.confidence * 100)}%` : ''} · {r.credits || 0} 💎</div>
                  <div className="hint" style={{ fontSize: 11 }}>
                    {(STATUS_META[r.status]?.label || r.status)}
                    {r.frame_path && r.status !== 'rejected' ? ' · 🧠 בפול האימון' : ''}
                  </div>
                </div>
                <span className="muted" style={{ marginInlineStart: 'auto', fontSize: 10, whiteSpace: 'nowrap' }}>
                  {new Date(r.created_at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
            <div className="hint" style={{ marginTop: 8 }}>
              אותם נתונים בדיוק מופיעים במפה ובלוח בדסקטופ — הכל מסונכרן חי 🔄
            </div>
          </div>
        </div>
      )}

      {/* monthly leaderboard + city prizes */}
      {showBoard && (
        <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) setShowBoard(false); }}>
          <div className="card hud det-modal">
            <button className="ghost mclose" onClick={() => setShowBoard(false)}>✕</button>
            <img src="/art/podium.jpg" alt="" className="art-banner" />
            <h3 style={{ fontSize: 14, letterSpacing: '.2em' }}>🏆 מובילי החודש — פרסים מהעירייה</h3>
            <div className="podium">
              {board.slice(0, 3).map((t, i) => (
                <div key={t.name} className={'pod pod-' + i}>
                  <div className="pod-medal">{medals[i]}</div>
                  <div className="pod-name">{t.name}</div>
                  <div className="pod-credits">{t.credits} 💎</div>
                  <div className="pod-prize">פרס מהעירייה</div>
                </div>
              ))}
              {!board.length && <div className="hint">עוד אין תפיסות החודש — היו הראשונים! 🚀</div>}
            </div>
            {board.slice(3, 10).map((t, i) => (
              <div key={t.name} className="boxrow">
                <span className="muted" style={{ fontFamily: 'Space Grotesk' }}>{i + 4}</span>
                <span>{t.name}</span>
                <span className="muted" style={{ marginInlineStart: 'auto' }}>{t.credits} 💎 · {t.catches} תפיסות</span>
              </div>
            ))}
            {/* progress-to-podium: why collect credits, made visible */}
            {auth.team && board.length > 0 && (() => {
              const meIdx = board.findIndex((t) => t.name === auth.team);
              const me = meIdx >= 0 ? board[meIdx] : null;
              const bar3 = board[Math.min(2, board.length - 1)]?.credits || 0;
              if (me && meIdx < 3) return (
                <div className="my-pool" style={{ borderColor: 'rgba(255,182,39,.5)' }}>
                  🏆 אתם על הפודיום — מקום {meIdx + 1}! שמרו עליו עד סוף החודש
                </div>
              );
              const gap = me ? Math.max(1, bar3 - me.credits + 1) : bar3 + 1;
              return (
                <div className="my-pool">
                  🎯 {me ? <>אתם במקום <b>{meIdx + 1}</b> · </> : null}
                  עוד <b>{gap} 💎</b> (~{Math.max(1, Math.ceil(gap / 15))} תפיסות) לפודיום ולפרס מהעירייה!
                </div>
              );
            })()}
            {myPool != null && (
              <div className="my-pool">
                🧠 תרמת <b>{myPool}</b> תמונות למאגר האימון של העיר — המודל הבא ילמד מהן!
              </div>
            )}
            <button className="hot" style={{ width: '100%', marginTop: 10 }}
              onClick={() => { setShowBoard(false); setShowTrainReal(true); }}>
              🚀 התחל אימון אמיתי — מודל YOLO לעיר
            </button>
            <div className="hint" style={{ marginTop: 10 }}>
              קרדיטים = תפיסה שעברה את מסנן ה-AI (10-20) + בונוס אזור משימה (+5). מתאפס כל חודש — 3 הראשונים זוכים.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
