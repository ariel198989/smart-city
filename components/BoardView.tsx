'use client';
// Hazard board: moderation (approve/reject), leaderboard, city CSV report
import { useEffect, useState } from 'react';
import { fetchDetections, setDetectionStatus, publicUrl } from '@/lib/db';
import { authStore } from '@/lib/auth';
import { CLASS_PALETTE } from '@/lib/config';
import { classColor, fmtWhen, download } from '@/lib/util';
import { useStore, toast, bumpData } from '@/lib/store';

const csvSafe = (s: unknown) => '"' + String(s ?? '').replace(/"/g, '""') + '"';

export default function BoardView() {
  const auth = useStore(authStore);
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState<any>(null);

  const load = async (f = filter) => {
    try {
      setRows(await fetchDetections({ status: f, limit: 400 }));
    } catch (e: any) { toast('לוח: ' + (e.message || e)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  async function moderate(id: string, status: string) {
    try {
      await setDetectionStatus(id, status);
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
  const byTeam: Record<string, { total: number; approved: number; rejected: number }> = {};
  rows.forEach((d) => {
    const t = d.team_name || 'ללא קבוצה';
    byTeam[t] = byTeam[t] || { total: 0, approved: 0, rejected: 0 };
    byTeam[t].total++;
    if (d.status === 'approved') byTeam[t].approved++;
    if (d.status === 'rejected') byTeam[t].rejected++;
  });
  const teams = Object.entries(byTeam)
    .map(([tm, s]) => ({
      tm, ...s,
      precision: (s.approved + s.rejected) ? Math.round(s.approved / (s.approved + s.rejected) * 100) : null,
    }))
    .sort((a, b) => b.approved - a.approved || b.total - a.total);
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <section className="view">
      <div className="phase-head">
        <span className="ph-n">7</span>
        <div>
          <b>ניטור — לוח מפגעים</b>
          <span className="why">למה זה חשוב? מודל טועה לפעמים (False Positive). אישור אנושי = השלב שהופך זיהוי AI לדיווח אמיתי לעירייה.</span>
        </div>
      </div>
      <div className="board-stats">
        {teams.length ? teams.slice(0, 6).map((t, i) => (
          <div key={t.tm} className={'lb-card' + (i === 0 ? ' first' : '')}>
            <span className="rank">{medals[i] || '·'}</span>
            <div className="tm">{t.tm}</div>
            <div className="nums">
              <span><b>{t.approved}</b>מאושרים</span>
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
            <option value="pending">⏳ ממתינים</option>
            <option value="approved">✅ מאושרים</option>
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
                <span className={'st-pill st-' + d.status}>
                  {d.status === 'pending' ? '⏳ ממתין' : d.status === 'approved' ? '✅ מאושר' : '❌ נדחה'}
                </span>
                {auth.admin && d.status === 'pending' && (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button className="primary" style={{ fontSize: 12 }} onClick={() => moderate(d.id, 'approved')}>✓ אשר</button>
                    <button className="ghost" style={{ fontSize: 12, color: 'var(--danger)' }} onClick={() => moderate(d.id, 'rejected')}>✕ דחה</button>
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
