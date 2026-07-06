'use client';
// 🎮 City Patrol — Pokémon-GO-style mobile game mode:
// GPS avatar on the real city map, real crosswalk spawn points from OSM,
// photo-capture gated by the trained model, credits + monthly prizes.
import { useEffect, useRef, useState } from 'react';
import { MAP_STYLE, DEFAULT_CITY, CLASS_PALETTE } from '@/lib/config';
import { insertDetection, uploadBlob } from '@/lib/db';
import { modelStore, detectOnDataURL, clsOf, cropDetection } from '@/lib/infer';
import { authStore } from '@/lib/auth';
import { useStore, toast, bumpData } from '@/lib/store';
import { classColor, dataURLtoBlob, fileToDataURL } from '@/lib/util';
import { fetchCrossingSpawns, isCrossingClass, calcCredits, ensureCityModel, fetchMonthlyLeaderboard, distM, type Spawn } from '@/lib/patrol';
import StreetCam from '@/components/StreetCam';

type CatchResult =
  | { kind: 'pass'; cls: string; conf: number; credits: number }
  | { kind: 'blocked'; mission: string; found: string | null }
  | { kind: 'ungated'; credits: number };

export default function PatrolView() {
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
  const [showBoard, setShowBoard] = useState(false);
  const [board, setBoard] = useState<{ name: string; credits: number; catches: number }[]>([]);
  const [briefed, setBriefed] = useState(true);
  const [briefReady, setBriefReady] = useState(false);
  const [camMode, setCamMode] = useState(false);

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

    ensureCityModel().then((r) => {
      setModelMsg(r.ok ? '' : (r.error || ''));
      const cls = modelStore.get().classes;
      // default mission: first model class, or crosswalks (OSM spawns work even without a model)
      setMission(cls.length ? cls[0] : 'מעבר חציה');
      // mission briefing — once per session, after we know what the model knows
      setBriefReady(true);
      try { setBriefed(sessionStorage.getItem('sc_briefed') === '1'); } catch { setBriefed(false); }
    });

    return () => {
      disposed = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
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
      const gated = modelStore.get().ready;
      const nearSpawn = nearest != null && nearest <= 60;

      if (gated) {
        // 🧠 THE GATE: the city model judges the photo on-device
        const { boxes } = await detectOnDataURL(durl, 0.3);
        const relevant = mission
          ? boxes.filter((b) => clsOf(b.cls).name === mission)
          : boxes;
        if (!relevant.length) {
          const found = boxes.length ? clsOf(boxes[0].cls).name : null;
          setResult({ kind: 'blocked', mission: mission || 'מפגע', found });
          if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
          setBusy(false);
          return;
        }
        const best = relevant.sort((a, b) => b.score - a.score)[0];
        const cr = calcCredits({ conf: best.score, nearSpawn, gated: true });
        const cropURL = await cropDetection(durl, best);
        const path = `crops/p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;  // ASCII-only key
        await uploadBlob(path, dataURLtoBlob(cropURL), 'image/jpeg');
        await insertDetection({
          lat: at.lat, lng: at.lng,
          class_name: mission || clsOf(best.cls).name,
          confidence: best.score, crop_path: path,
          detected_by: auth.user.id, team_name: auth.team || null,
          credits: cr,
        });
        setCredits((c) => c + cr);
        setResult({ kind: 'pass', cls: mission || clsOf(best.cls).name, conf: best.score, credits: cr });
        if (navigator.vibrate) navigator.vibrate(200);
        bumpData();
      } else {
        // no model yet — accept unfiltered, small reward
        const cr = calcCredits({ gated: false });
        const path = `crops/p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
        await uploadBlob(path, dataURLtoBlob(durl), 'image/jpeg');
        await insertDetection({
          lat: at.lat, lng: at.lng,
          class_name: mission || 'מפגע כללי', confidence: 0,
          crop_path: path, detected_by: auth.user.id, team_name: auth.team || null,
          credits: cr,
        });
        setCredits((c) => c + cr);
        setResult({ kind: 'ungated', credits: cr });
        bumpData();
      }
    } catch (e: any) { toast('תפיסה: ' + (e.message || e)); }
    setBusy(false);
  }

  async function openBoard() {
    setShowBoard(true);
    try { setBoard(await fetchMonthlyLeaderboard()); } catch (e: any) { toast(e.message || e); }
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

        {/* top HUD: mission + credits */}
        <div className="pt-top">
          <div className="pt-chip pt-credits" onClick={openBoard} title="לוח מובילים חודשי">
            <b>{credits}</b> קרדיטים · 🏆
          </div>
          {model.ready ? (
            <select className="pt-mission" value={mission} onChange={(e) => setMission(e.target.value)} title="המשימה">
              {model.classes.map((c) => <option key={c} value={c}>🎯 {c}</option>)}
            </select>
          ) : (
            <div className="pt-chip" style={{ maxWidth: 230, fontSize: 10.5 }}>{modelMsg || 'טוען מודל…'}</div>
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
        {result?.kind === 'pass' && (
          <div className="pt-result pass" onAnimationEnd={() => {}}>
            <div className="ptr-big">+{result.credits} 💎</div>
            <div>נתפס: <b>{result.cls}</b> · {Math.round(result.conf * 100)}% · נשלח לאישור מדריך</div>
            <button className="ghost" style={{ fontSize: 12 }} onClick={share}>📣 שתפו</button>
            <button className="ghost" style={{ fontSize: 12 }} onClick={() => setResult(null)}>המשך</button>
          </div>
        )}
        {result?.kind === 'blocked' && (
          <div className="pt-result blocked">
            <div className="ptr-big">🙅</div>
            <div>זה לא <b>{result.mission}</b>!{result.found ? ` ה-AI רואה כאן "${result.found}".` : ' ה-AI לא מזהה כאן את המשימה.'} נסו שוב מזווית אחרת.</div>
            <button className="ghost" style={{ fontSize: 12 }} onClick={() => setResult(null)}>סגור</button>
          </div>
        )}
        {result?.kind === 'ungated' && (
          <div className="pt-result pass">
            <div className="ptr-big">+{result.credits} 💎</div>
            <div>נשמר בלי סינון AI (אין עדיין מודל עירוני) — מדריך יבדוק.</div>
            <button className="ghost" style={{ fontSize: 12 }} onClick={() => setResult(null)}>המשך</button>
          </div>
        )}

        {/* mission briefing — what YOUR model is trained on */}
        {briefReady && !briefed && (
          <div className="pt-brief">
            <div className="ptb-inner">
              <div className="ptb-agent">🕵️</div>
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
              ) : (
                <div className="ptb-hint">עוד אין מודל עירוני רשום — אפשר לצלם מפגעים חופשי (בלי סינון AI), מדריך יבדוק. {modelMsg}</div>
              )}
              <button className="primary ptb-go" onClick={() => {
                setBriefed(true);
                try { sessionStorage.setItem('sc_briefed', '1'); } catch { /* private mode */ }
              }}>
                יאללה, לסיור! 🎮
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
          />
        )}

        {/* big capture buttons */}
        {!camMode && (
          <>
            <button className="pt-streetmode" onClick={() => setCamMode(true)}>
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

      {/* monthly leaderboard + city prizes */}
      {showBoard && (
        <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) setShowBoard(false); }}>
          <div className="card hud det-modal">
            <button className="ghost mclose" onClick={() => setShowBoard(false)}>✕</button>
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
            <div className="hint" style={{ marginTop: 10 }}>
              קרדיטים = תפיסה שעברה את מסנן ה-AI (10-20) + בונוס אזור משימה (+5). מתאפס כל חודש — 3 הראשונים זוכים.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
