'use client';
// 🏷️ Mobile Tagger — "training starts on the phone" made real:
// swipe through YOUR untagged series shots, drag ONE box around the
// object with a finger, save → the photo becomes real YOLO data in the
// city pool. Desktop studio stays for fine work; this covers the 90%.
import { useEffect, useRef, useState } from 'react';
import { updateDetection, publicUrl } from '@/lib/db';
import { authStore } from '@/lib/auth';
import { useStore, toast } from '@/lib/store';
import { sb } from '@/lib/db';

interface Row { id: string; class_name: string; frame_path: string; created_at: string }

async function fetchMineUntagged(userId: string, limit = 200): Promise<Row[]> {
  const { data, error } = await sb.from('sc_detections')
    .select('id, class_name, frame_path, created_at')
    .eq('detected_by', userId).is('bbox', null).not('frame_path', 'is', null)
    .neq('status', 'rejected')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []) as Row[];
}

type Box = { x: number; y: number; w: number; h: number } | null;

export default function MobileTagger({ onClose, classNames = [] }: { onClose: () => void; classNames?: string[] }) {
  const auth = useStore(authStore);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [box, setBox] = useState<Box>(null);
  const [lastBox, setLastBox] = useState<Box>(null);   // series photos → similar boxes; reuse
  // multi-class: the label being drawn (defaults to the photo's own class)
  const [label, setLabel] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [doneN, setDoneN] = useState(0);
  const imgWrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!auth.user) return;
    fetchMineUntagged(auth.user.id).then(setRows).catch((e) => { toast('טעינה: ' + e.message); setRows([]); });
  }, [auth.user]);

  const cur = rows && rows[idx];
  // label follows each photo's own class by default; the chips can override
  useEffect(() => { if (cur) setLabel(cur.class_name); }, [cur?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  // chips: this photo's class + the session's objects (unique, order kept)
  const labelChoices = [...new Set([...(cur ? [cur.class_name] : []), ...classNames])];

  function relPoint(e: React.TouchEvent | React.MouseEvent): { x: number; y: number } {
    const r = imgWrap.current!.getBoundingClientRect();
    const p = 'touches' in e ? (e.touches[0] || (e as React.TouchEvent).changedTouches[0]) : (e as React.MouseEvent);
    return {
      x: Math.min(1, Math.max(0, (p.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (p.clientY - r.top) / r.height)),
    };
  }
  function start(e: React.TouchEvent | React.MouseEvent) { drag.current = relPoint(e); setBox(null); }
  function move(e: React.TouchEvent | React.MouseEvent) {
    if (!drag.current) return;
    const p = relPoint(e);
    setBox({
      x: Math.min(drag.current.x, p.x), y: Math.min(drag.current.y, p.y),
      w: Math.abs(p.x - drag.current.x), h: Math.abs(p.y - drag.current.y),
    });
  }
  function end() {
    drag.current = null;
    setBox((b) => (b && b.w > 0.04 && b.h > 0.04 ? b : null));  // tiny smudge ≠ box
  }

  async function save(useBox: Box) {
    if (!cur || !useBox) return;
    setBusy(true);
    try {
      // bbox + the chosen label (multi-class: the chips may override the
      // class the photo was shot under)
      const patch: any = { bbox: useBox };
      if (label && label !== cur.class_name) patch.class_name = label;
      await updateDetection(cur.id, patch);
      setLastBox(useBox);
      setDoneN((n) => n + 1);
      if (navigator.vibrate) navigator.vibrate(30);
      next();
    } catch (e: any) { toast('שמירה: ' + (e.message || e)); }
    setBusy(false);
  }

  async function reject() {
    if (!cur) return;
    setBusy(true);
    try { await updateDetection(cur.id, { status: 'rejected' }); next(); }
    catch (e: any) { toast((e.message || e)); }
    setBusy(false);
  }

  function next() { setBox(null); setIdx((i) => i + 1); }

  const total = rows?.length || 0;
  const finished = rows !== null && idx >= total;

  return (
    <div className="modal-back" style={{ padding: 0, placeItems: 'stretch' }}>
      <div className="tagger">
        <header className="hub-head" style={{ backgroundImage: 'none', background: 'rgba(4,11,22,.98)' }}>
          <button className="ghost hub-close" aria-label="סגירה" onClick={onClose}>✕</button>
          <b>🏷️ תיוג בטלפון</b>
          <span>{total ? `תמונה ${Math.min(idx + 1, total)} מתוך ${total} · תויגו ${doneN}` : 'סמנו תיבה סביב האובייקט באצבע'}</span>
        </header>

        {rows === null && <div className="hint" style={{ padding: 20, textAlign: 'center' }}>טוען את התמונות שלך…</div>}

        {rows !== null && total === 0 && (
          <div className="tg-empty">
            <div style={{ fontSize: 40 }}>📭</div>
            <b>אין תמונות שמחכות לתיוג</b>
            <p className="hint">צלמו סדרה (🧠 אימון ← "📸 צלמו סדרה") — וחזרו לכאן לתייג.</p>
            <button className="primary" onClick={onClose}>סגור</button>
          </div>
        )}

        {finished && total > 0 && (
          <div className="tg-empty">
            <div style={{ fontSize: 40 }}>🎉</div>
            <b>סיימתם! {doneN} תמונות תויגו</b>
            <p className="hint">הן כבר במאגר העיר — צעד אחד קרוב יותר למודל. 🧠 אימון ← "🚀 התחל אימון" כשהמאגר מוכן.</p>
            <button className="primary" onClick={onClose}>מעולה</button>
          </div>
        )}

        {cur && !finished && (
          <>
            {/* multi-object: pick which label this photo gets */}
            {labelChoices.length > 1 && (
              <div className="tg-classes">
                {labelChoices.map((c) => (
                  <button key={c} className={'sr-cls' + (label === c ? ' on' : '')} onClick={() => setLabel(c)}>{c}</button>
                ))}
              </div>
            )}
            <div className="tg-stage" ref={imgWrap}
              onTouchStart={start} onTouchMove={move} onTouchEnd={end}
              onMouseDown={start} onMouseMove={move} onMouseUp={end}>
              <img src={publicUrl(cur.frame_path)} alt="" draggable={false} />
              {box && (
                <div className="tg-box" style={{
                  left: box.x * 100 + '%', top: box.y * 100 + '%',
                  width: box.w * 100 + '%', height: box.h * 100 + '%',
                }}>
                  <span>{label || cur.class_name}</span>
                </div>
              )}
              {!box && <div className="tg-guide">✍️ גררו אצבע מסביב ל<b>{label || cur.class_name}</b></div>}
            </div>
            <div className="tg-actions">
              <button className="hot" disabled={!box || busy} onClick={() => save(box)}>
                {busy ? '…' : '✓ שמור והבא'}
              </button>
              {lastBox && !box && (
                <button className="primary" disabled={busy} onClick={() => save(lastBox)}>
                  ⧉ אותה תיבה כמו הקודמת
                </button>
              )}
              <button className="ghost" disabled={busy} onClick={next}>דלג</button>
              <button className="ghost" style={{ color: 'var(--gold)' }} disabled={busy} onClick={reject}>🗑 מחק</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
