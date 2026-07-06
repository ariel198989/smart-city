'use client';
// Hazard board: moderation (approve/reject), leaderboard, city CSV report
import { useEffect, useState } from 'react';
import { fetchDetections, setDetectionStatus, updateDetection, publicUrl } from '@/lib/db';
import { authStore } from '@/lib/auth';
import { CLASS_PALETTE } from '@/lib/config';
import { classColor, fmtWhen, download } from '@/lib/util';
import { useStore, toast, bumpData, dataVersion } from '@/lib/store';
import { STATUS_META } from '@/lib/status';
import { openVerify } from '@/components/VerifyModal';

const csvSafe = (s: unknown) => '"' + String(s ?? '').replace(/"/g, '""') + '"';

export default function BoardView() {
  const auth = useStore(authStore);
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState<any>(null);
  const dv = useStore(dataVersion);

  const load = async (f = filter) => {
    try {
      setRows(await fetchDetections({ status: f, limit: 400 }));
    } catch (e: any) { toast('לוח: ' + (e.message || e)); }
  };
  // reload on filter change AND on live data bumps (realtime sync)
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter, dv.n]);

  async function moderate(id: string, status: string, extra: object = {}) {
    try {
      await updateDetection(id, { status, ...extra });
      load();
      bumpData();
    } catch (e: any) { toast(e.message || e); }
  }

  function exportCSV() {
    const approved = rows.filter((d) => d.status === 'approved');
    const list = approved.length ? approved : rows;
    if (!list.length) { toast('אין זיהויים לייצוא'); return; }
    const head = 'סוג מפגע,ביטחון,קו רוחב,קו אורך,סטטוס,קבוצה,תאריך,קישור לתמונה';
    const lines = list.map((d) => [
      csvSafe(d.class_name), Math.round(d.confidence * 100) + '%', d.lat, d.lng,
      d.status === 'approved' ? 'מאושר' : d.status === 'pending' ? 'ממתין' : 'נדחה',
      csvSafe(d.team_name || ''), new Date(d.created_at).toLocaleString('he-IL'),
      d.crop_path ? publicUrl(d.crop_path) : '',
    ].join(','));
    const csv = '﻿' + [head, ...lines].join('\r\n');  // BOM → Hebrew opens right in Excel
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `smartcity_report_${new Date().toISOString().slice(0, 10)}.csv`);
    toast(`דוח לעירייה: ${list.length} מפגעים 📄`, true);
  }

  // leaderboard
  const byTeam: Record<string, { total: number; approved: number; rejected: number; resolved: number }> = {};
  rows.forEach((d) => {
    const t = d.team_name || 'ללא קבוצה';
    byTeam[t] = byTeam[t] || { total: 0, approved: 0, rejected: 0, resolved: 0 };
    byTeam[t].total++;
    if (d.status === 'approved') byTeam[t].approved++;
    if (d.status === 'rejected') byTeam[t].rejected++;
    if (d.status === 'resolved') byTeam[t].resolved++;
  });
  const teams = Object.entries(byTeam)
    .map(([tm, s]) => ({
      tm, ...s,
      precision: (s.approved + s.resolved + s.rejected)
        ? Math.round((s.approved + s.resolved) / (s.approved + s.resolved + s.rejected) * 100) : null,
    }))
    .sort((a, b) => b.resolved - a.resolved || b.approved - a.approved || b.total - a.total);
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <section className="view">
      <div className="phase-head">
        <span className="ph-n">7</span>
        <div>
          <b>ניטור — לוח מפגעים</b>
          <span className="why">המעגל המלא: ה-AI מזהה → מדריך מאשר → העירייה מטפלת → יוצאים לשטח לצלם → אותו מודל מאמת שהמפגע נעלם → מהנדס חותם → הנעץ יורד מהמפה. לא רק זיהוי — הבנה.</span>
        </div>
      </div>
      <div className="board-stats">
        {teams.length ? teams.slice(0, 6).map((t, i) => (
          <div key={t.tm} className={'lb-card' + (i === 0 ? ' first' : '')}>
            <span className="rank">{medals[i] || '·'}</span>
            <div className="tm">{t.tm}</div>
            <div className="nums">
              <span><b>{t.resolved}</b>טופלו 🟢</span>
              <span><b>{t.approved}</b>בטיפול</span>
              <span><b>{t.total}</b>זיהויים</span>
              <span><b>{t.precision == null ? '—' : t.precision + '%'}</b>דיוק</span>
            </div>
          </div>
        )) : <div className="hint">אין עדיין זיהויים — צאו לסיור חי! 🔴</div>}
      </div>
      <div className="card hud">
        <div className="row" style={{ marginBottom: 10 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">כל הסטטוסים</option>
            <option value="pending">⏳ ממתינים לאישור</option>
            <option value="approved">🔧 בטיפול</option>
            <option value="awaiting_verify">🔍 ממתינים לאימות שטח</option>
            <option value="verifying">🤖 באימות — למהנדס</option>
            <option value="resolved">🟢 טופלו</option>
            <option value="rejected">❌ נדחו</option>
          </select>
          <button className="ghost" onClick={() => load()}>רענן</button>
          <span style={{ flex: 1 }} />
          <button className="primary" onClick={exportCSV}>📄 דוח לעירייה (CSV)</button>
        </div>
        <div className="board-list">
          {rows.length ? rows.map((d) => {
            const conf = Math.round(d.confidence * 100);
            const confCol = conf >= 60 ? 'var(--cy)' : conf >= 35 ? 'var(--warn)' : 'var(--danger)';
            return (
              <div key={d.id} className="brow">
                {d.crop_path
                  ? <img src={publicUrl(d.crop_path)} loading="lazy" alt="" onClick={() => setModal(d)} />
                  : <div style={{ width: 86 }} />}
                <div className="bmeta">
                  <div className="bcls">
                    <i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: classColor(d.class_name, CLASS_PALETTE), marginInlineEnd: 6 }} />
                    {d.class_name}
                  </div>
                  <div className="bsub">
                    {d.team_name ? 'קבוצת ' + d.team_name + ' · ' : ''}{fmtWhen(d.created_at)} · {d.lat.toFixed(5)}, {d.lng.toFixed(5)}
                  </div>
                </div>
                <span className="conf" style={{ color: confCol }}>{conf}%</span>
                <span className={'st-pill ' + (STATUS_META[d.status]?.pill || '')}>
                  {STATUS_META[d.status]?.label || d.status}
                </span>
                {d.status === 'verifying' && d.verify_photo_path && (
                  <span className="vrow" title={d.verify_ai_passed === true ? 'ה-AI אישר: המפגע לא זוהה יותר' : d.verify_ai_passed === false ? 'ה-AI עדיין מזהה את המפגע' : 'ללא בדיקת AI'}>
                    <img src={publicUrl(d.verify_photo_path)} alt="" style={{ width: 56, height: 42, objectFit: 'cover', border: '1px solid var(--cy-faint)' }} />
                    <span style={{ fontSize: 11 }}>{d.verify_ai_passed === true ? '🤖✅' : d.verify_ai_passed === false ? '🤖❌' : '🤖—'}</span>
                  </span>
                )}
                {auth.admin && d.status === 'pending' && (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button className="primary" style={{ fontSize: 12 }} onClick={() => moderate(d.id, 'approved')}>✓ אשר</button>
                    <button className="ghost" style={{ fontSize: 12, color: 'var(--danger)' }} onClick={() => moderate(d.id, 'rejected')}>✕ דחה</button>
                  </span>
                )}
                {auth.admin && d.status === 'approved' && (
                  <button className="hot" style={{ fontSize: 12 }} onClick={() => moderate(d.id, 'awaiting_verify')}>
                    🔧 העבודה הסתיימה → לאימות שטח
                  </button>
                )}
                {d.status === 'awaiting_verify' && (
                  <button className="primary" style={{ fontSize: 12 }} onClick={() => openVerify(d)}>
                    📸 אמת בשטח
                  </button>
                )}
                {auth.admin && d.status === 'verifying' && (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button className="primary" style={{ fontSize: 12 }}
                      onClick={() => moderate(d.id, 'resolved', { resolved_at: new Date().toISOString() })}>
                      🟢 אשר סגירה — הנעץ יורד
                    </button>
                    <button className="ghost" style={{ fontSize: 12 }} onClick={() => moderate(d.id, 'approved')}>↩ החזר לטיפול</button>
                  </span>
                )}
              </div>
            );
          }) : <div className="hint">אין זיהויים בסינון הזה.</div>}
        </div>
      </div>
      {modal && (
        <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="card hud det-modal">
            <button className="ghost mclose" onClick={() => setModal(null)}>✕</button>
            <h3 style={{ margin: '4px 0 10px', fontSize: 15, color: 'var(--ink)' }}>
              {modal.class_name} · {Math.round(modal.confidence * 100)}%
            </h3>
            <img src={publicUrl(modal.crop_path)} style={{ width: '100%', border: '1px solid var(--cy-faint)' }} alt="" />
            <div className="hint" style={{ marginTop: 8 }}>
              📍 {modal.lat.toFixed(6)}, {modal.lng.toFixed(6)}<br />
              {modal.team_name ? 'קבוצת ' + modal.team_name + ' · ' : ''}{fmtWhen(modal.created_at)}
            </div>
            <a href={`https://maps.google.com/maps?layer=c&cbll=${modal.lat},${modal.lng}&output=svembed`} target="_blank" rel="noopener noreferrer">
              <button className="ghost" style={{ marginTop: 10 }}>פתח ב-Street View</button>
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
