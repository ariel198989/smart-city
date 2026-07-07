'use client';
// Capture result cards — the verdict layer of the patrol game.
// Pure presentation: PatrolView owns the state, this file owns the JSX
// (extracted to shrink the 740-line god component).
import { SECTOR_NAMES } from '@/lib/compass';

export type CatchResult =
  | { kind: 'pass'; cls: string; conf: number; credits: number; newAngle?: boolean; daily?: number }
  | { kind: 'blocked'; mission: string; found: string | null; durl: string }
  | { kind: 'angle'; covered: number[]; current: number }
  | { kind: 'feedback_sent'; msg: string }
  | { kind: 'ungated'; credits: number };

// "המסע של התמונה" — answers the #1 confusion: what HAPPENED to my photo?
export function Journey({ steps }: { steps: { icon: string; label: string; done: boolean }[] }) {
  return (
    <div className="journey">
      {steps.map((s, i) => (
        <span key={i} className={'jy-step' + (s.done ? ' done' : '')}>
          <i>{s.icon}</i>{s.label}
          {i < steps.length - 1 && <b className="jy-arr">←</b>}
        </span>
      ))}
    </div>
  );
}

// radar ring: which shooting angles are already covered around this hazard
export function AngleRadar({ covered, current }: { covered: number[]; current: number | null }) {
  const wedge = (i: number) => {
    const a0 = ((i * 45 - 22.5) - 90) * Math.PI / 180;
    const a1 = ((i * 45 + 22.5) - 90) * Math.PI / 180;
    const r = 42, cx = 50, cy = 50;
    return `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 0 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`;
  };
  return (
    <svg viewBox="0 0 100 100" className="angle-radar">
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} d={wedge(i)}
          fill={covered.includes(i) ? 'rgba(53,225,255,.35)' : 'rgba(255,182,39,.08)'}
          stroke={covered.includes(i) ? 'rgba(53,225,255,.7)' : 'rgba(255,182,39,.45)'}
          strokeWidth=".8" strokeDasharray={covered.includes(i) ? '0' : '2 2'} />
      ))}
      {current != null && (
        <line x1="50" y1="50"
          x2={50 + 46 * Math.cos((current - 90) * Math.PI / 180)}
          y2={50 + 46 * Math.sin((current - 90) * Math.PI / 180)}
          stroke="#FFB627" strokeWidth="2.5" strokeLinecap="round" />
      )}
      <circle cx="50" cy="50" r="4" fill="#FFB627" />
      <text x="50" y="9" textAnchor="middle" fontSize="8" fill="#bfe3f0">צ</text>
    </svg>
  );
}

interface Props {
  result: CatchResult | null;
  busy: boolean;
  onClose: () => void;
  onShare: () => void;
  onMyLog: () => void;
  onFeedback: (durl: string, mission: string, kind: 'dispute' | 'negative') => void;
}

export default function ResultCards({ result, busy, onClose, onShare, onMyLog, onFeedback }: Props) {
  if (!result) return null;
  return (
    <>
      {result.kind === 'pass' && (
        <div className="pt-result pass">
          <div className="ptr-big">+{result.credits} 💎</div>
          {result.newAngle && <div className="ptr-angle-bonus">📐 זווית חדשה! +5 בונוס</div>}
          {!!result.daily && <div className="ptr-angle-bonus">🎯 אתגר יומי! +{result.daily} בונוס</div>}
          <div>נתפס: <b>{result.cls}</b> · {Math.round(result.conf * 100)}%</div>
          <Journey steps={[
            { icon: '📸', label: 'צולם', done: true },
            { icon: '🤖', label: 'AI אישר', done: true },
            { icon: '📍', label: 'פין על המפה', done: true },
            { icon: '🧠', label: 'בפול האימון', done: true },
          ]} />
          <div className="hint" style={{ fontSize: 11, margin: '4px 0' }}>רואים אותה עכשיו גם במפה בדסקטופ · המודל הבא של העיר ילמד ממנה</div>
          <button className="ghost" style={{ fontSize: 12 }} onClick={onShare}>📣 שתפו</button>
          <button className="ghost" style={{ fontSize: 12 }} onClick={onMyLog}>🗂️ התמונות שלי</button>
          <button className="ghost" style={{ fontSize: 12 }} onClick={onClose}>המשך</button>
        </div>
      )}
      {result.kind === 'angle' && (
        <div className="pt-result blocked">
          <div className="ptr-big">📐</div>
          <div><b>הזווית הזאת כבר מצולמת!</b><br />🎓 מודל AI לומד הכי טוב מהרבה זוויות שונות — צילום כפול לא מלמד אותו כלום. זוזו לכיוון פתוח ברדאר:</div>
          <AngleRadar covered={result.covered} current={result.current} />
          <div className="hint" style={{ fontSize: 11 }}>
            חסרות: {Array.from({ length: 8 }, (_, i) => i).filter((i) => !result.covered.includes(i)).map((i) => SECTOR_NAMES[i]).join(' · ')}
          </div>
          <button className="ghost" style={{ fontSize: 12 }} onClick={onClose}>הבנתי</button>
        </div>
      )}
      {result.kind === 'blocked' && (
        <div className="pt-result blocked">
          <div className="ptr-big">🙅</div>
          <div>ה-AI לא מזהה כאן <b>{result.mission}</b>{result.found ? ` (רואה "${result.found}")` : ''}. מי צודק?</div>
          <div className="fb-btns">
            <button className="hot" style={{ fontSize: 12 }} disabled={busy}
              onClick={() => onFeedback(result.durl, result.mission, 'dispute')}>
              🙋 ה-AI טעה — זה כן {result.mission}!
            </button>
            <button className="ghost" style={{ fontSize: 12 }} disabled={busy}
              onClick={() => onFeedback(result.durl, result.mission, 'negative')}>
              🤖 ה-AI צדק — שילמד מזה
            </button>
          </div>
          <button className="ghost" style={{ fontSize: 11 }} onClick={onClose}>סגור ונסה זווית אחרת</button>
        </div>
      )}
      {result.kind === 'feedback_sent' && (
        <div className="pt-result pass">
          <div className="ptr-big">🧠✨</div>
          <div><b>עזרתם ל-AI להשתחכם!</b></div>
          <div>{result.msg}</div>
          <div className="hint" style={{ fontSize: 11, margin: '4px 0' }}>מדריך יבדוק — ואם צדקתם, התמונה שלכם תיכנס לאימון הבא של מודל העיר 🏙️</div>
          <button className="ghost" style={{ fontSize: 12 }} onClick={onClose}>המשך</button>
        </div>
      )}
      {result.kind === 'ungated' && (
        <div className="pt-result pass">
          <div className="ptr-big">+{result.credits} 💎</div>
          <div><b>התמונה נשמרה!</b> (עוד אין מודל עירוני שיבדוק אותה)</div>
          <Journey steps={[
            { icon: '📸', label: 'צולם', done: true },
            { icon: '📍', label: 'פין על המפה', done: true },
            { icon: '🧑‍🏫', label: 'בדיקת מדריך', done: false },
            { icon: '🧠', label: 'אימון', done: false },
          ]} />
          <div className="hint" style={{ fontSize: 11, margin: '4px 0' }}>הפין כבר על המפה (גם בדסקטופ) · מדריך יאשר ואז התמונה תלמד את המודל</div>
          <button className="ghost" style={{ fontSize: 12 }} onClick={onMyLog}>🗂️ התמונות שלי</button>
          <button className="ghost" style={{ fontSize: 12 }} onClick={onClose}>המשך</button>
        </div>
      )}
    </>
  );
}
