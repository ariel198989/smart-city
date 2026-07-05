// Smart City — hazard board: moderation (approve/reject), leaderboard, city CSV report
import { fetchDetections, setDetectionStatus, publicUrl } from './db.js';
import { AUTH } from './auth.js';
import { refreshMapData } from './map.js';
import { CLASS_PALETTE } from './config.js';
import { $, toast, classColor, fmtWhen } from './util.js';

let rows = [];

export function initBoard() {
  $('#boardRefresh').onclick = loadBoard;
  $('#boardFilter').onchange = loadBoard;
  $('#csvBtn').onclick = exportCSV;
  $('#detModalClose').onclick = () => { $('#detModal').style.display = 'none'; };
  $('#detModal').onclick = (e) => { if (e.target.id === 'detModal') $('#detModal').style.display = 'none'; };
}

export async function loadBoard() {
  try {
    rows = await fetchDetections({ status: $('#boardFilter').value, limit: 400 });
    renderLeaderboard();
    renderList();
  } catch (e) { toast('לוח: ' + (e.message || e)); }
}

function renderLeaderboard() {
  // leaderboard needs ALL statuses — compute from a full fetch only when filter=all,
  // otherwise from what we have (good enough for the workshop scale)
  const byTeam = {};
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
  $('#leaderboard').innerHTML = teams.slice(0, 6).map((t, i) => `
    <div class="lb-card ${i === 0 ? 'first' : ''}">
      <span class="rank">${medals[i] || '·'}</span>
      <div class="tm">${esc(t.tm)}</div>
      <div class="nums">
        <span><b>${t.approved}</b>מאושרים</span>
        <span><b>${t.total}</b>זיהויים</span>
        <span><b>${t.precision == null ? '—' : t.precision + '%'}</b>דיוק</span>
      </div>
    </div>`).join('') || '<div class="hint">אין עדיין זיהויים — צאו לסיור חי! 🔴</div>';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderList() {
  const el = $('#boardList');
  if (!rows.length) { el.innerHTML = '<div class="hint">אין זיהויים בסינון הזה.</div>'; return; }
  el.innerHTML = '';
  rows.forEach((d) => {
    const div = document.createElement('div');
    div.className = 'brow';
    const img = d.crop_path ? `<img src="${publicUrl(d.crop_path)}" loading="lazy" alt="">` : '<div style="width:86px"></div>';
    const conf = Math.round(d.confidence * 100);
    const confCol = conf >= 60 ? 'var(--ok)' : conf >= 35 ? 'var(--warn)' : 'var(--danger)';
    div.innerHTML = `${img}
      <div class="bmeta">
        <div class="bcls"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${classColor(d.class_name, CLASS_PALETTE)};margin-inline-end:6px"></i>${esc(d.class_name)}</div>
        <div class="bsub">${d.team_name ? 'קבוצת ' + esc(d.team_name) + ' · ' : ''}${fmtWhen(d.created_at)} · ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}</div>
      </div>
      <span class="conf" style="color:${confCol}">${conf}%</span>
      <span class="st-pill st-${d.status}">${d.status === 'pending' ? '⏳ ממתין' : d.status === 'approved' ? '✅ מאושר' : '❌ נדחה'}</span>
      <span class="modbtns"></span>`;
    if (d.crop_path) div.querySelector('img').onclick = () => showModal(d);
    if (AUTH.admin && d.status === 'pending') {
      const wrap = div.querySelector('.modbtns');
      const ok = document.createElement('button');
      ok.className = 'primary'; ok.textContent = '✓ אשר'; ok.style.fontSize = '12px';
      ok.onclick = () => moderate(d.id, 'approved');
      const no = document.createElement('button');
      no.className = 'ghost'; no.textContent = '✕ דחה'; no.style.cssText = 'font-size:12px;color:var(--danger)';
      no.onclick = () => moderate(d.id, 'rejected');
      wrap.append(ok, no);
    }
    el.appendChild(div);
  });
}

async function moderate(id, status) {
  try {
    await setDetectionStatus(id, status);
    loadBoard();
    refreshMapData();
  } catch (e) { toast(e.message || e); }
}

function showModal(d) {
  $('#detModalBody').innerHTML = `
    <h3 style="margin:4px 0 10px">${esc(d.class_name)} · ${Math.round(d.confidence * 100)}%</h3>
    <img src="${publicUrl(d.crop_path)}" style="width:100%;border-radius:10px" alt="">
    <div class="hint" style="margin-top:8px">📍 ${d.lat.toFixed(6)}, ${d.lng.toFixed(6)}<br>
    ${d.team_name ? 'קבוצת ' + esc(d.team_name) + ' · ' : ''}${fmtWhen(d.created_at)}</div>
    <a href="https://maps.google.com/maps?layer=c&cbll=${d.lat},${d.lng}&output=svembed" target="_blank" rel="noopener">
      <button class="ghost" style="margin-top:10px">🌍 פתח ב-Street View</button></a>`;
  $('#detModal').style.display = 'grid';
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
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `smartcity_report_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast(`דוח לעירייה: ${list.length} מפגעים 📄`, true);
}
const csvSafe = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
