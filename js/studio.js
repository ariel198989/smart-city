// Smart City — training studio (proven thinkCV flow, adapted):
// intake (video/images/city pool) → tag → YOLO ZIP → Colab → load model → register
import { COLAB, CLASS_PALETTE, POOL_BUCKET, BUCKET } from './config.js';
import { sb, fetchRoutes, fetchFrames, publicUrl, insertModel } from './db.js';
import { extractFrames } from './video.js';
import { MODEL, onModel, loadModelFromZip, detectOnDataURL, drawDetections } from './infer.js';
import { AUTH, requireAuth } from './auth.js';
import { $, toast, wireDrop, LS } from './util.js';

const IMG_W = 640, IMG_H = 480;
let CLASSES = [];
let images = [];
let activeId = null;
let selClass = 0;
let lastExportBlob = null;

const clsOf = (i) => CLASSES[i] || { name: 'קטגוריה ' + (i + 1), color: CLASS_PALETTE[i % CLASS_PALETTE.length] };

// ---------- persistence (IndexedDB per user) ----------
const DB = 'smartcity', ST = 'state';
const stKey = () => `cur_${AUTH.user ? AUTH.user.id : 'anon'}`;
const openDB = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(ST);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function save() {
  try {
    const db = await openDB();
    db.transaction(ST, 'readwrite').objectStore(ST)
      .put({ subject: $('#subjectName')?.value || '', images, classes: CLASSES, savedAt: Date.now() }, stKey());
  } catch (e) { console.warn(e); }
}
async function load() {
  try {
    const db = await openDB();
    const store = db.transaction(ST, 'readonly').objectStore(ST);
    return await new Promise((r) => { const rq = store.get(stKey()); rq.onsuccess = () => r(rq.result); rq.onerror = () => r(null); });
  } catch { return null; }
}

export async function initStudio() {
  wireIntake();
  wireTagging();
  wireExport();
  wireModel();
  const s = await load();
  if (s) {
    CLASSES = Array.isArray(s.classes) ? s.classes : [];
    images = Array.isArray(s.images) ? s.images : [];
    activeId = images.length ? images[0].id : null;
    $('#subjectName').value = s.subject || '';
  }
  renderClasses(); renderAll();
  loadPool();
}

// ============ 1: intake ============
function wireIntake() {
  const handleMediaFiles = (fileList) => {
    const files = [...fileList];
    const vids = files.filter((f) => f.type.startsWith('video/'));
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (vids.length) handleVideos(vids);
    imgs.forEach((f) => {
      const r = new FileReader();
      r.onload = (ev) => {
        const im = new Image();
        im.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = IMG_W; cv.height = IMG_H;
          cv.getContext('2d').drawImage(im, 0, 0, IMG_W, IMG_H);
          addImage(cv.toDataURL('image/jpeg', 0.85));
        };
        im.src = ev.target.result;
      };
      r.readAsDataURL(f);
    });
  };
  $('#fileInput').onchange = (e) => { handleMediaFiles(e.target.files); e.target.value = ''; };
  $('#uploadBtn').onclick = () => $('#fileInput').click();
  $('#videoBtn').onclick = () => $('#videoInput').click();
  $('#videoInput').onchange = (e) => { handleVideos([...e.target.files].filter((f) => f.type.startsWith('video/'))); e.target.value = ''; };
  wireDrop('imgDrop', handleMediaFiles);
  $('#imgDrop').onclick = () => $('#fileInput').click();
  $('#subjectName').oninput = () => save();

  // city pool intake
  $('#cityPoolBtn').onclick = async () => {
    const box = $('#cityPoolPick');
    box.style.display = box.style.display === 'none' ? '' : 'none';
    if (box.style.display === 'none') return;
    const sel = $('#poolRouteSel');
    sel.innerHTML = '<option>טוען…</option>';
    try {
      const routes = await fetchRoutes();
      sel.innerHTML = '';
      if (!routes.length) { sel.innerHTML = '<option>אין עדיין מסלולים במאגר</option>'; return; }
      routes.forEach((r) => {
        const o = document.createElement('option');
        o.value = r.id; o.textContent = `${r.name} (${r.frame_count} 📷)`;
        sel.appendChild(o);
      });
    } catch (e) { toast(e.message || e); }
  };
  $('#poolRouteLoad').onclick = async () => {
    const routeId = $('#poolRouteSel').value;
    if (!routeId) return;
    $('#videoProgress').textContent = 'טוען פריימים מהמאגר…';
    try {
      const frames = await fetchFrames(routeId, 200);
      let n = 0;
      for (const f of frames) {
        const durl = await urlToDataURL(publicUrl(f.storage_path));
        addImage(durl, { lat: f.lat, lng: f.lng, frameId: f.id });
        n++;
        if (n % 10 === 0) $('#videoProgress').textContent = `נטענו ${n}/${frames.length}…`;
      }
      $('#videoProgress').innerHTML = `✅ נטענו ${n} פריימים עירוניים — לתייג! 👇`;
    } catch (e) { toast(e.message || e); }
  };
}

async function urlToDataURL(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const cv = document.createElement('canvas');
  cv.width = IMG_W; cv.height = IMG_H;
  cv.getContext('2d').drawImage(img, 0, 0, IMG_W, IMG_H);
  return cv.toDataURL('image/jpeg', 0.85);
}

async function handleVideos(files) {
  const prog = $('#videoProgress');
  for (let i = 0; i < files.length; i++) {
    const tag = files.length > 1 ? `סרטון ${i + 1}/${files.length} · ` : '';
    try {
      const { frames } = await extractFrames(files[i], {
        want: parseInt($('#frameCount').value) || 60,
        sharpOnly: $('#vidBlur').checked,
        videoEl: $('#vidScratch'),
        onProgress: (done, total) => { prog.textContent = `${tag}סורק… ${done}/${total}`; },
      });
      frames.forEach((f) => addImage(f.url));
      prog.innerHTML = `✅ <b>נוספו ${frames.length} תמונות</b> — גללו לתייג 👇`;
      $('#stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { prog.textContent = '⚠️ ' + (e.message || e); }
  }
}

function addImage(dataURL, extra = {}) {
  const id = Date.now() + Math.random();
  images.push({ id, dataURL, boxes: [], subject: ($('#subjectName')?.value || '').trim(), ...extra });
  activeId = id;
  renderAll(); save();
}

// ============ 2+3: classes + tagging (proven canvas UX) ============
let drawing = false, startX = 0, startY = 0, curBox = null, curPos = null;

function wireTagging() {
  $('#addClassBtn').onclick = () => { const el = $('#newClassName'); addClass(el.value); el.value = ''; el.focus(); };
  $('#newClassName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#addClassBtn').click(); } });
  document.addEventListener('keydown', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const n = parseInt(e.key);
    if (n >= 1 && n <= CLASSES.length) { selClass = n - 1; renderClasses(); }
  });
  $('#markBgBtn').onclick = () => {
    const im = images.find((i) => i.id === activeId);
    if (!im) { toast('בחרו קודם תמונה'); return; }
    im.negative = !im.negative;
    if (im.negative) im.boxes = [];
    renderAll(); save();
  };
  (function antLoop() { if (drawing || curPos) drawBoxes(); requestAnimationFrame(antLoop); })();
}

function addClass(name) {
  name = (name || '').trim();
  if (!name) return;
  if (CLASSES.some((c) => c.name === name)) { selClass = CLASSES.findIndex((c) => c.name === name); renderClasses(); return; }
  CLASSES = [...CLASSES, { id: 'c' + Date.now().toString(36), name, color: CLASS_PALETTE[CLASSES.length % CLASS_PALETTE.length] }];
  selClass = CLASSES.length - 1;
  renderClasses(); save();
}

function renderClasses() {
  const c = $('#classBtns');
  c.innerHTML = '';
  if (!CLASSES.length) {
    c.innerHTML = '<span class="muted" style="font-size:12.5px">אין עדיין קטגוריות — הוסיפו את המפגעים שה-AI ילמד לזהות ✨ (בור, מעבר דהוי, פסולת…)</span>';
    return;
  }
  CLASSES.forEach((cl, i) => {
    const b = document.createElement('button');
    b.className = 'class-btn' + (i === selClass ? ' sel' : '');
    b.innerHTML = `<span class="sw" style="background:${cl.color}"></span><span class="cname"></span> <span class="key">[${i + 1}]</span>`;
    b.querySelector('.cname').textContent = cl.name;
    b.onclick = () => { selClass = i; renderClasses(); };
    c.appendChild(b);
  });
}

const needClass = () => { if (!CLASSES.length) { toast('קודם הוסיפו קטגוריה'); return true; } return false; };

function stageFlash() {
  const st = $('#stage');
  st.classList.remove('flash'); void st.offsetWidth;
  st.classList.add('flash');
  setTimeout(() => st.classList.remove('flash'), 600);
}

function renderStage() {
  const stage = $('#stage');
  const im = images.find((i) => i.id === activeId);
  if (!im) { stage.innerHTML = '<div class="empty">העלו סרטון או תמונות בשלב 1 — הפריימים יופיעו כאן לתיוג</div>'; return; }
  stage.innerHTML = `<img id="stageImg"><canvas id="overlay"></canvas>`;
  const img = $('#stageImg'), cv = $('#overlay');
  img.src = im.dataURL;
  img.onload = () => { cv.width = img.clientWidth; cv.height = img.clientHeight; drawBoxes(); };
  if (img.complete) { cv.width = img.clientWidth || IMG_W; cv.height = img.clientHeight || IMG_H; drawBoxes(); }

  const getXY = (e) => {
    const r = cv.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x: Math.max(0, Math.min(1, cx / r.width)), y: Math.max(0, Math.min(1, cy / r.height)) };
  };
  const down = (e) => { if (needClass()) return; e.preventDefault(); drawing = true; const p = getXY(e); startX = p.x; startY = p.y; curBox = null; };
  const move = (e) => {
    const p = getXY(e); curPos = p;
    if (!drawing) { drawBoxes(); return; }
    e.preventDefault();
    curBox = { x: Math.min(startX, p.x), y: Math.min(startY, p.y), w: Math.abs(p.x - startX), h: Math.abs(p.y - startY) };
    drawBoxes();
  };
  const up = () => {
    if (!drawing) return;
    drawing = false;
    if (curBox && curBox.w > 0.02 && curBox.h > 0.02) {
      im.boxes = [...im.boxes, { cls: selClass, ...curBox }];
      im.negative = false;
      save(); stageFlash();
    }
    curBox = null; renderAll();
  };
  cv.onmousedown = down; cv.onmousemove = move; window.onmouseup = up;
  cv.onmouseleave = () => { curPos = null; drawBoxes(); };
  cv.ontouchstart = down; cv.ontouchmove = move; cv.ontouchend = up;
}

function drawBoxes() {
  const cv = $('#overlay');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const im = images.find((i) => i.id === activeId);
  if (!im) return;
  const sel = clsOf(selClass);
  if (curPos && CLASSES.length) {
    ctx.save();
    ctx.strokeStyle = sel.color + '55'; ctx.lineWidth = 1; ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(curPos.x * W, 0); ctx.lineTo(curPos.x * W, H);
    ctx.moveTo(0, curPos.y * H); ctx.lineTo(W, curPos.y * H);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = sel.color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(curPos.x * W, curPos.y * H, 7, 0, 7); ctx.stroke();
    ctx.restore();
  }
  const all = [...im.boxes];
  if (curBox) all.push({ cls: selClass, ...curBox, _temp: true });
  all.forEach((b) => {
    const cl = clsOf(b.cls);
    ctx.lineWidth = b._temp ? 2.5 : 2; ctx.strokeStyle = cl.color;
    if (b._temp) {
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = -((performance.now() / 40) % 12);
      ctx.shadowColor = cl.color; ctx.shadowBlur = 10;
    } else ctx.setLineDash([]);
    ctx.strokeRect(b.x * W, b.y * H, b.w * W, b.h * H);
    ctx.shadowBlur = 0; ctx.lineDashOffset = 0;
    if (!b._temp) {
      ctx.fillStyle = cl.color; ctx.font = 'bold 12px sans-serif';
      const tw = ctx.measureText(cl.name).width + 8;
      ctx.fillRect(b.x * W, b.y * H - 16, tw, 16);
      ctx.fillStyle = '#0f1419'; ctx.fillText(cl.name, b.x * W + 4, b.y * H - 4);
    }
  });
}

function renderBoxList() {
  const el = $('#boxList');
  const im = images.find((i) => i.id === activeId);
  if (!im || !im.boxes.length) { el.innerHTML = '<span class="muted" style="font-size:12px">אין עדיין מלבנים</span>'; return; }
  el.innerHTML = '';
  im.boxes.forEach((b, i) => {
    const cl = clsOf(b.cls);
    const r = document.createElement('div');
    r.className = 'boxrow';
    r.innerHTML = `<span class="sw" style="background:${cl.color}"></span><span class="bn"></span>
      <span class="muted" style="font-size:11px">#${i + 1}</span><button class="del">×</button>`;
    r.querySelector('.bn').textContent = cl.name;
    r.querySelector('.del').onclick = () => { im.boxes = im.boxes.filter((_, j) => j !== i); renderAll(); save(); };
    el.appendChild(r);
  });
}

function renderStrip() {
  const el = $('#strip');
  el.innerHTML = '';
  images.forEach((im) => {
    const f = document.createElement('div');
    f.className = 'frame' + (im.id === activeId ? ' active' : '');
    const n = im.boxes.length;
    const badge = im.negative ? '<span class="cnt has">🚫</span>' : `<span class="cnt ${n ? 'has' : 'none'}">${n ? n + ' ✓' : '0'}</span>`;
    f.innerHTML = `<img src="${im.dataURL}">${badge}<button class="x">×</button>`;
    f.querySelector('img').onclick = () => { activeId = im.id; renderAll(); };
    f.querySelector('.x').onclick = (e) => {
      e.stopPropagation();
      images = images.filter((x) => x.id !== im.id);
      if (activeId === im.id) activeId = images.length ? images[0].id : null;
      renderAll(); save();
    };
    el.appendChild(f);
  });
}

function renderStats() {
  const el = $('#stats');
  el.innerHTML = '';
  const totalBoxes = images.reduce((s, i) => s + i.boxes.length, 0);
  const labeled = images.filter((i) => i.boxes.length).length;
  const neg = images.filter((i) => i.negative).length;
  [{ v: images.length, l: 'תמונות' }, { v: labeled, l: 'מתויגות' }, { v: neg, l: 'רקע' }, { v: totalBoxes, l: 'מלבנים' }]
    .forEach((s) => {
      const d = document.createElement('div');
      d.className = 'stat';
      d.innerHTML = `<div class="v">${s.v}</div><div class="l">${s.l}</div>`;
      el.appendChild(d);
    });
  const bar = $('#tagbar');
  const doneCnt = labeled + neg, total = images.length;
  bar.style.display = total ? '' : 'none';
  const pct = total ? Math.round(doneCnt / total * 100) : 0;
  $('#tagbarFill').style.width = pct + '%';
  $('#tagbarLbl').textContent = `${doneCnt}/${total}${pct === 100 && total ? ' 🎉' : ''}`;
}

function renderAll() { renderStage(); renderBoxList(); renderStrip(); renderStats(); }

// ============ 4: export + pool (proven YOLO ZIP + merge) ============
function splitTrainVal(items) {
  if (items.length < 5) return { flat: true, valSet: [] };
  const groups = {};
  items.forEach((im) => { const k = ((im.subject || '').trim()) || '_'; (groups[k] = groups[k] || []).push(im); });
  const keys = Object.keys(groups);
  const val = new Set();
  if (keys.length >= 3) {
    const nVal = Math.max(1, Math.round(keys.length * 0.2));
    keys.slice(0, nVal).forEach((k) => groups[k].forEach((im) => val.add(im.id)));
  } else {
    keys.forEach((k) => {
      const g = groups[k];
      const nVal = Math.max(1, Math.round(g.length * 0.2));
      g.slice(g.length - nVal).forEach((im) => val.add(im.id));
    });
  }
  const valSet = items.filter((im) => val.has(im.id));
  const trainSet = items.filter((im) => !val.has(im.id));
  if (!trainSet.length || !valSet.length) return { flat: true, valSet: [] };
  return { flat: false, valSet, trainSet };
}

async function buildDatasetZip() {
  const labeled = images.filter((i) => i.boxes.length || i.negative);
  if (!labeled.length) { toast('אין תמונות מתויגות — סמנו לפחות מלבן אחד.'); return null; }
  if (!CLASSES.length) { toast('הוסיפו לפחות קטגוריה אחת.'); return null; }
  const name = (AUTH.team || 'team').replace(/\s+/g, '_');
  const split = splitTrainVal(labeled);
  const valIds = new Set(split.valSet.map((im) => im.id));
  const zip = new JSZip();
  const yaml = `# YOLO dataset - Smart City\npath: .\n` +
    (split.flat ? `train: images\nval: images\n` : `train: images/train\nval: images/val\n`) +
    `\nnc: ${CLASSES.length}\nnames: [${CLASSES.map((c) => `'${c.name}'`).join(', ')}]\n`;
  zip.file('data.yaml', yaml);
  const slug = (s) => (s || '').trim().replace(/\s+/g, '-').replace(/[^\w֐-׿-]/g, '') || '';
  const usedNames = {};
  let idx = 0, count = 0;
  for (const im of labeled) {
    const subj = slug(im.subject);
    const base = subj ? `${subj}_${slug(name) || 'team'}` : (slug(name) || 'team');
    let fn = `${base}_${String(idx).padStart(3, '0')}`;
    while (usedNames[fn]) fn = `${base}_${String(++idx).padStart(3, '0')}`;
    usedNames[fn] = 1;
    const seg = split.flat ? '' : (valIds.has(im.id) ? '/val' : '/train');
    zip.file(`images${seg}/${fn}.jpg`, im.dataURL.split(',')[1], { base64: true });
    const lines = im.negative ? '' : im.boxes.map((b) => {
      const xc = (b.x + b.w / 2).toFixed(6), yc = (b.y + b.h / 2).toFixed(6);
      return `${b.cls} ${xc} ${yc} ${b.w.toFixed(6)} ${b.h.toFixed(6)}`;
    }).join('\n');
    zip.file(`labels${seg}/${fn}.txt`, lines ? lines + '\n' : '');
    idx++; count++;
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, name, count };
}

function wireExport() {
  $('#exportBtn').onclick = async () => {
    const btn = $('#exportBtn');
    const orig = btn.innerHTML;
    btn.textContent = 'אורז…'; btn.disabled = true;
    const built = await buildDatasetZip();
    btn.innerHTML = orig; btn.disabled = false;
    if (!built) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(built.blob);
    a.download = `smartcity_dataset_${Date.now()}.zip`;
    a.click();
    lastExportBlob = built;
    $('#shareBtn').disabled = false;
  };

  $('#shareBtn').onclick = async () => {
    if (!requireAuth()) return;
    let built = lastExportBlob;
    if (!built) { built = await buildDatasetZip(); if (!built) return; lastExportBlob = built; }
    const st = $('#shareState');
    st.style.display = ''; st.textContent = '☁️ מעלה…';
    $('#shareBtn').disabled = true;
    try {
      const path = `datasets/sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.zip`;  // ASCII-only key
      const up = await sb.storage.from(POOL_BUCKET).upload(path, built.blob, { contentType: 'application/zip' });
      if (up.error) throw up.error;
      const ins = await sb.from('thinkcv_datasets').insert({
        owner: AUTH.user.id,
        team_name: AUTH.team || 'קבוצה',
        student_name: null,
        subject: 'Smart City: ' + (($('#subjectName')?.value || '').trim() || 'מפגעים'),
        classes: CLASSES.map((c) => c.name),
        zip_path: path,
        image_count: built.count,
      });
      if (ins.error) throw ins.error;
      st.textContent = `🌐 שותף ✓ (${built.count})`;
      loadPool();
    } catch (e) { console.error(e); st.textContent = '⚠️ נכשל: ' + (e.message || e); }
    $('#shareBtn').disabled = false;
  };

  $('#colabBtn').onclick = () => window.open(COLAB, '_blank');
  $('#poolRefreshBtn').onclick = loadPool;
  $('#mergeBtn').onclick = () => { const sel = selectedPool(); if (sel.length) mergeAndDownload(sel, $('#mergeProgress')); };
}

let poolRows = [];
async function loadPool() {
  const st = $('#poolState');
  st.textContent = 'טוען…';
  const { data, error } = await sb.from('thinkcv_datasets')
    .select('id, team_name, student_name, subject, classes, zip_path, image_count, created_at')
    .order('created_at', { ascending: false }).limit(100);
  const el = $('#poolList');
  el.innerHTML = '';
  if (error) { st.textContent = 'שגיאה'; el.innerHTML = '<span class="hint">' + error.message + '</span>'; return; }
  poolRows = data || [];
  st.textContent = poolRows.length + ' דאטהסטים';
  if (!poolRows.length) { el.innerHTML = '<span class="muted" style="font-size:13px">עוד אין — היו הראשונים לשתף! 🚀</span>'; updateMergeBtn(); return; }
  poolRows.forEach((r) => {
    const d = document.createElement('label');
    d.className = 'pool-row';
    const when = new Date(r.created_at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    d.innerHTML = `<input type="checkbox" data-id="${r.id}">
      <div class="meta"><div class="nm"></div><div class="cls"></div></div>`;
    d.querySelector('.nm').textContent = `${r.team_name}${r.subject ? ' — ' + r.subject : ''}`;
    d.querySelector('.cls').textContent = `${r.image_count} תמונות · ${(Array.isArray(r.classes) ? r.classes : []).join(' · ') || '—'} · ${when}`;
    d.querySelector('input').onchange = updateMergeBtn;
    el.appendChild(d);
  });
  updateMergeBtn();
}
const selectedPool = () => [...document.querySelectorAll('#poolList input:checked')].map((i) => poolRows.find((r) => r.id === i.dataset.id)).filter(Boolean);
const updateMergeBtn = () => { $('#mergeBtn').disabled = selectedPool().length < 1; };

function parseYamlNames(y) {
  const m = y.match(/names:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

async function mergeAndDownload(sel, prog) {
  try {
    const merged = new JSZip();
    const union = []; const unionIdx = {};
    const addName = (n) => { if (unionIdx[n] == null) { unionIdx[n] = union.length; union.push(n); } return unionIdx[n]; };
    let totalImgs = 0, valCount = 0;
    for (let s = 0; s < sel.length; s++) {
      const row = sel[s];
      prog.textContent = `מוריד ${s + 1}/${sel.length} — ${row.team_name}…`;
      const url = sb.storage.from(POOL_BUCKET).getPublicUrl(row.zip_path).data.publicUrl;
      const res = await fetch(url);
      if (!res.ok) throw new Error('הורדה נכשלה: ' + row.team_name);
      const zip = await JSZip.loadAsync(await res.blob());
      const yamlFile = Object.keys(zip.files).find((n) => n.endsWith('data.yaml'));
      const names = yamlFile ? parseYamlNames(await zip.files[yamlFile].async('text')) : [];
      const map = names.map(addName);
      const teamSlug = 't' + s;
      const files = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
      for (const n of files) {
        const isImg = /^images\//.test(n) && /\.(jpe?g|png)$/i.test(n);
        if (!isImg) continue;
        const seg = /\/val\//.test(n) ? 'val' : 'train';
        const base = n.split('/').pop().replace(/\.(jpe?g|png)$/i, '');
        const ext = (n.match(/\.(jpe?g|png)$/i) || ['.jpg'])[0];
        const newBase = `${teamSlug}_${base}`;
        merged.file(`images/${seg}/${newBase}${ext}`, await zip.files[n].async('uint8array'));
        totalImgs++; if (seg === 'val') valCount++;
        const labelCands = [
          n.replace(/^images\//, 'labels/').replace(/\.(jpe?g|png)$/i, '.txt'),
          `labels/${base}.txt`, `labels/train/${base}.txt`, `labels/val/${base}.txt`,
        ];
        let lbl = '';
        for (const lc of labelCands) { if (zip.files[lc]) { lbl = await zip.files[lc].async('text'); break; } }
        const remapped = lbl.split('\n').map((line) => {
          const t = line.trim().split(/\s+/);
          if (t.length < 5) return '';
          const old = parseInt(t[0], 10);
          if (isNaN(old) || old < 0 || old >= map.length) return '';
          return [String(map[old]), ...t.slice(1)].join(' ');
        }).filter(Boolean).join('\n');
        merged.file(`labels/${seg}/${newBase}.txt`, remapped ? remapped + '\n' : '');
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    const yaml = `# Smart City merged dataset (${sel.length} sets)\npath: .\ntrain: images/train\nval: ${valCount > 0 ? 'images/val' : 'images/train'}\n\nnc: ${union.length}\nnames: [${union.map((n) => `'${n}'`).join(', ')}]\n`;
    merged.file('data.yaml', yaml);
    prog.textContent = 'אורז ZIP מאוחד…';
    const blob = await merged.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `smartcity_city_model_${sel.length}sets.zip`;
    a.click();
    prog.innerHTML = `✅ <b>ירד "מודל העיר"</b>: ${totalImgs} תמונות · ${union.length} קטגוריות (${union.join(' · ')}) — ל-Colab! 🚀`;
  } catch (e) { console.error(e); prog.textContent = '⚠️ שגיאה במיזוג: ' + (e.message || e); }
}

// ============ 5: model load + test + register ============
function wireModel() {
  $('#loadModelBtn').onclick = () => $('#modelFile').click();
  $('#modelFile').onchange = (e) => { if (e.target.files[0]) loadModel(e.target.files[0]); };
  wireDrop('modelDrop', (files) => { if (files[0]) loadModel(files[0]); });
  $('#modelDrop').onclick = () => $('#modelFile').click();
  $('#testDrop').onclick = () => $('#testFile').click();
  wireDrop('testDrop', (files) => { if (files[0]) handleTestFile(files[0]); });
  $('#testFile').onchange = (e) => { if (e.target.files[0]) handleTestFile(e.target.files[0]); e.target.value = ''; };

  let lastModelFile = null;
  async function loadModel(f) {
    $('#modelStatus').innerHTML = '<span class="status-dot"></span>טוען…';
    try {
      await loadModelFromZip(f, (AUTH.team || '') + ' מודל');
      if (!MODEL.classes.length) MODEL.classes = CLASSES.map((c) => c.name);
      lastModelFile = f;
      $('#modelStatus').innerHTML = '<span class="status-dot live"></span>מודל טעון ✓';
      $('#registerModelBtn').disabled = false;
    } catch (err) {
      console.error(err);
      $('#modelStatus').innerHTML = '<span class="status-dot"></span>שגיאה: ' + err.message;
    }
  }

  $('#registerModelBtn').onclick = async () => {
    if (!requireAuth() || !lastModelFile) return;
    const btn = $('#registerModelBtn');
    btn.disabled = true; btn.textContent = 'מעלה…';
    try {
      const path = `models/m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.zip`;  // ASCII-only key
      const up = await sb.storage.from(BUCKET).upload(path, lastModelFile, { contentType: 'application/zip' });
      if (up.error) throw up.error;
      await insertModel({
        owner: AUTH.user.id,
        team_name: AUTH.team || 'קבוצה',
        name: (($('#subjectName')?.value || '').trim() || 'מודל') + ' · ' + (AUTH.team || ''),
        classes: MODEL.classes,
        zip_path: path,
      });
      btn.textContent = '✓ נרשם! זמין לסיור חי';
      toast('המודל נרשם — עכשיו לסיור ברחובות! 🔴', true);
    } catch (e) {
      toast('רישום מודל: ' + (e.message || e));
      btn.disabled = false; btn.textContent = '🚀 רשום כמודל הקבוצה';
    }
  };

  onModel(() => { /* studio state already updated inline */ });
}

async function handleTestFile(f) {
  if (!MODEL.ready) { toast('טענו מודל קודם'); return; }
  if (!f.type.startsWith('image/')) { toast('צריך תמונה'); return; }
  const r = new FileReader();
  r.onload = async (ev) => {
    const dataURL = ev.target.result;
    const stage = $('#testStage');
    stage.innerHTML = `<img id="testImg"><canvas id="testOverlay"></canvas>`;
    const img = $('#testImg');
    img.src = dataURL;
    await new Promise((res) => { if (img.complete) res(); else img.onload = res; });
    stage.classList.add('scanning');
    $('#detList').innerHTML = '<span class="muted" style="font-size:12px">🔎 סורק…</span>';
    try {
      const conf = parseFloat($('#confInput').value) || 0.25;
      const { boxes, top, lowGuess } = await detectOnDataURL(dataURL, conf);
      const cv = $('#testOverlay');
      cv.width = img.clientWidth; cv.height = img.clientHeight;
      const list = boxes.length ? boxes : (top ? [top] : []);
      drawDetections(cv, list);
      renderDetList(list, lowGuess);
    } catch (e) { toast(e.message || e); }
    stage.classList.remove('scanning');
  };
  r.readAsDataURL(f);
}

function renderDetList(list, lowGuess) {
  const el = $('#detList');
  el.innerHTML = '';
  const best = list.length ? Math.max(...list.map((b) => b.score)) : 0;
  const pct = Math.round(best * 100);
  let color, msg, emoji;
  if (best >= 0.6) { color = 'var(--ok)'; emoji = '🎯'; msg = 'המודל בטוח! אימנתם מצוין.'; }
  else if (best >= 0.25) { color = 'var(--ok)'; emoji = '🙂'; msg = 'מזהה — ועוד לומד. עוד תמונות = ביטחון גבוה יותר.'; }
  else if (best >= 0.05) { color = 'var(--warn)'; emoji = '🤔'; msg = 'מנחש. צריך עוד תמונות מגוונות.'; }
  else { color = 'var(--danger)'; emoji = '🐣'; msg = 'עוד תינוק — תאכילו בעוד סרטונים, או מזגו את מאגר הקבוצות!'; }
  const meter = document.createElement('div');
  meter.style.cssText = 'margin-bottom:10px';
  meter.innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px">
      <span style="font-size:12px;color:var(--muted)">ביטחון ${emoji}</span>
      <span style="font-size:22px;font-weight:800;color:${color}">${pct}%</span>
    </div>
    <div style="height:8px;border-radius:99px;background:#ffffff14;overflow:hidden">
      <div style="height:100%;width:${Math.max(pct, 2)}%;background:${color};transition:width .5s"></div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-top:6px;line-height:1.5">${msg}</div>`;
  el.appendChild(meter);
  list.forEach((b) => {
    const cl = MODEL.classes[b.cls] || clsOf(b.cls).name;
    const r = document.createElement('div');
    r.className = 'boxrow';
    r.innerHTML = `<span class="dn"></span><span class="muted" style="margin-inline-start:auto">${Math.round(b.score * 100)}%</span>`;
    r.querySelector('.dn').textContent = typeof cl === 'string' ? cl : cl.name;
    el.appendChild(r);
  });
}
