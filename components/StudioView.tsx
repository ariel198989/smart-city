'use client';
// Training studio — proven thinkCV flow as React:
// intake (video/images/city pool) → tag → YOLO ZIP → Colab → load model → register
import { useEffect, useRef, useState } from 'react';
import { COLAB, CLASS_PALETTE, POOL_BUCKET, BUCKET } from '@/lib/config';
import { sb, fetchRoutes, fetchFrames, publicUrl, insertModel } from '@/lib/db';
import { extractFrames } from '@/lib/video';
import { modelStore, loadModelFromZip, detectOnDataURL, drawDetections, type Box } from '@/lib/infer';
import { authStore } from '@/lib/auth';
import { useStore, toast } from '@/lib/store';
import { fileToDataURL, urlToDataURL, fmtWhen, download } from '@/lib/util';
import { fetchPoolStats, buildCityPoolZip } from '@/lib/citypool';

const IMG_W = 640, IMG_H = 480;

interface TagBox { cls: number; x: number; y: number; w: number; h: number }
interface TagImage {
  id: number; dataURL: string; boxes: TagBox[]; subject: string;
  negative?: boolean; lat?: number; lng?: number; frameId?: string;
}
interface TagClass { id: string; name: string; color: string }

// ---------- IndexedDB persistence ----------
const DB = 'smartcity', ST = 'state';
const openDB = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(ST);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const stKey = () => `cur_${authStore.get().user?.id || 'anon'}`;
async function idbSave(data: object) {
  try {
    const db = await openDB();
    db.transaction(ST, 'readwrite').objectStore(ST).put({ ...data, savedAt: Date.now() }, stKey());
  } catch (e) { console.warn(e); }
}
async function idbLoad(): Promise<any> {
  try {
    const db = await openDB();
    const store = db.transaction(ST, 'readonly').objectStore(ST);
    return await new Promise((r) => {
      const rq = store.get(stKey());
      rq.onsuccess = () => r(rq.result);
      rq.onerror = () => r(null);
    });
  } catch { return null; }
}

export default function StudioView() {
  const model = useStore(modelStore);
  const auth = useStore(authStore);
  const [images, setImages] = useState<TagImage[]>([]);
  const [classes, setClasses] = useState<TagClass[]>([]);
  const [selClass, setSelClass] = useState(0);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [subject, setSubject] = useState('');
  const [newClass, setNewClass] = useState('');
  const [frameCount, setFrameCount] = useState('60');
  const [sharpOnly, setSharpOnly] = useState(true);
  const [progress, setProgress] = useState('');
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolRoutes, setPoolRoutes] = useState<any[]>([]);
  const [poolRouteSel, setPoolRouteSel] = useState('');
  const [pool, setPool] = useState<any[]>([]);
  const [poolChecked, setPoolChecked] = useState<Set<string>>(new Set());
  const [mergeMsg, setMergeMsg] = useState('');
  const [cityPool, setCityPool] = useState<import('@/lib/citypool').PoolStats | null>(null);
  const [cpBusy, setCpBusy] = useState(false);
  const [cpMsg, setCpMsg] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const [canShare, setCanShare] = useState(false);
  const [modelMsg, setModelMsg] = useState('');
  const [conf, setConf] = useState('0.25');
  const [testResult, setTestResult] = useState<{ list: Box[]; low: boolean } | null>(null);
  const [registered, setRegistered] = useState(false);
  const [scanning, setScanning] = useState(false);

  const lastExport = useRef<{ blob: Blob; name: string; count: number } | null>(null);
  const lastModelFile = useRef<File | null>(null);
  const stageImg = useRef<HTMLImageElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const testImg = useRef<HTMLImageElement>(null);
  const testOverlay = useRef<HTMLCanvasElement>(null);
  const draw = useRef({ drawing: false, sx: 0, sy: 0, cur: null as null | { x: number; y: number; w: number; h: number }, pos: null as null | { x: number; y: number } });
  const stRef = useRef({ images, classes, selClass, activeId, subject });
  stRef.current = { images, classes, selClass, activeId, subject };
  const loadedFor = useRef<string | null>(null);

  const active = images.find((i) => i.id === activeId) || null;
  const clsOf = (i: number): TagClass =>
    classes[i] || { id: 'x', name: 'קטגוריה ' + (i + 1), color: CLASS_PALETTE[i % CLASS_PALETTE.length] };

  // restore per-user state
  useEffect(() => {
    const uid = auth.user?.id || 'anon';
    if (loadedFor.current === uid) return;
    loadedFor.current = uid;
    idbLoad().then((s) => {
      if (!s) return;
      setClasses(Array.isArray(s.classes) ? s.classes : []);
      const imgs: TagImage[] = Array.isArray(s.images) ? s.images : [];
      setImages(imgs);
      setActiveId(imgs.length ? imgs[0].id : null);
      setSubject(s.subject || '');
    });
    loadPool();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.id]);

  const persist = (imgs: TagImage[], cls: TagClass[], subj: string) =>
    idbSave({ images: imgs, classes: cls, subject: subj });

  // ---------- intake ----------
  function addImages(urls: string[], extra: Partial<TagImage> = {}) {
    setImages((prev) => {
      const added = urls.map((dataURL, k) => ({
        id: Date.now() + Math.random() + k, dataURL, boxes: [] as TagBox[],
        subject: stRef.current.subject.trim(), ...extra,
      }));
      const next = [...prev, ...added];
      if (added.length) setActiveId(added[added.length - 1].id);
      persist(next, stRef.current.classes, stRef.current.subject);
      return next;
    });
  }

  async function handleMedia(fileList: FileList | File[]) {
    const files = [...fileList];
    const vids = files.filter((f) => f.type.startsWith('video/'));
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    for (const f of imgs) addImages([await fileToDataURL(f, IMG_W, IMG_H)]);
    for (let i = 0; i < vids.length; i++) {
      const tag = vids.length > 1 ? `סרטון ${i + 1}/${vids.length} · ` : '';
      try {
        const { frames } = await extractFrames(vids[i], {
          want: parseInt(frameCount) || 60,
          sharpOnly,
          onProgress: (d, t) => setProgress(`${tag}סורק… ${d}/${t}`),
        });
        addImages(frames.map((f) => f.url));
        setProgress(`✓ נוספו ${frames.length} תמונות — גללו לתייג`);
      } catch (e: any) { setProgress('⚠️ ' + (e.message || e)); }
    }
  }

  async function loadCityFrames() {
    if (!poolRouteSel) return;
    setProgress('טוען פריימים מהמאגר…');
    try {
      const frames = await fetchFrames(poolRouteSel, 200);
      let n = 0;
      for (const f of frames) {
        const durl = await urlToDataURL(publicUrl(f.storage_path), IMG_W);
        addImages([durl], { lat: f.lat, lng: f.lng, frameId: f.id });
        n++;
        if (n % 10 === 0) setProgress(`נטענו ${n}/${frames.length}…`);
      }
      setProgress(`✓ נטענו ${n} פריימים עירוניים — לתייג!`);
    } catch (e: any) { toast(e.message || e); }
  }

  // ---------- classes ----------
  function addClass(name: string) {
    name = (name || '').trim();
    if (!name) return;
    const idx = classes.findIndex((c) => c.name === name);
    if (idx >= 0) { setSelClass(idx); return; }
    const next = [...classes, { id: 'c' + Date.now().toString(36), name, color: CLASS_PALETTE[classes.length % CLASS_PALETTE.length] }];
    setClasses(next);
    setSelClass(next.length - 1);
    persist(stRef.current.images, next, stRef.current.subject);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      const n = parseInt(e.key);
      if (n >= 1 && n <= stRef.current.classes.length) setSelClass(n - 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ---------- tagging canvas (imperative drawing on overlay) ----------
  function drawBoxes() {
    const cv = overlay.current, im = stRef.current.images.find((i) => i.id === stRef.current.activeId);
    if (!cv || !im) return;
    const ctx = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const d = draw.current;
    const sel = clsOf(stRef.current.selClass);
    if (d.pos && stRef.current.classes.length) {
      ctx.save();
      ctx.strokeStyle = sel.color + '55'; ctx.lineWidth = 1; ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(d.pos.x * W, 0); ctx.lineTo(d.pos.x * W, H);
      ctx.moveTo(0, d.pos.y * H); ctx.lineTo(W, d.pos.y * H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = sel.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(d.pos.x * W, d.pos.y * H, 7, 0, 7); ctx.stroke();
      ctx.restore();
    }
    const all: (TagBox & { _temp?: boolean })[] = [...im.boxes];
    if (d.cur) all.push({ cls: stRef.current.selClass, ...d.cur, _temp: true });
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

  // marching-ants loop
  useEffect(() => {
    let raf = 0;
    const loop = () => { if (draw.current.drawing || draw.current.pos) drawBoxes(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sync overlay size + redraw when active image changes
  useEffect(() => {
    const img = stageImg.current, cv = overlay.current;
    if (!img || !cv || !active) return;
    const sync = () => { cv.width = img.clientWidth || IMG_W; cv.height = img.clientHeight || IMG_H; drawBoxes(); };
    if (img.complete && img.naturalWidth) sync();
    else img.onload = sync;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, images]);

  const getXY = (e: React.MouseEvent | React.TouchEvent) => {
    const cv = overlay.current!;
    const r = cv.getBoundingClientRect();
    const pt = 'touches' in e ? e.touches[0] : e;
    return {
      x: Math.max(0, Math.min(1, (pt.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (pt.clientY - r.top) / r.height)),
    };
  };
  const onDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!classes.length) { toast('קודם הוסיפו קטגוריה'); return; }
    e.preventDefault();
    const p = getXY(e);
    draw.current.drawing = true; draw.current.sx = p.x; draw.current.sy = p.y; draw.current.cur = null;
  };
  const onMove = (e: React.MouseEvent | React.TouchEvent) => {
    const p = getXY(e);
    draw.current.pos = p;
    if (!draw.current.drawing) { drawBoxes(); return; }
    e.preventDefault();
    draw.current.cur = {
      x: Math.min(draw.current.sx, p.x), y: Math.min(draw.current.sy, p.y),
      w: Math.abs(p.x - draw.current.sx), h: Math.abs(p.y - draw.current.sy),
    };
    drawBoxes();
  };
  const onUp = () => {
    if (!draw.current.drawing) return;
    draw.current.drawing = false;
    const cur = draw.current.cur;
    draw.current.cur = null;
    if (cur && cur.w > 0.02 && cur.h > 0.02) {
      setImages((prev) => {
        const next = prev.map((im) => im.id === stRef.current.activeId
          ? { ...im, boxes: [...im.boxes, { cls: stRef.current.selClass, ...cur }], negative: false }
          : im);
        persist(next, stRef.current.classes, stRef.current.subject);
        return next;
      });
    } else drawBoxes();
  };

  function removeBox(i: number) {
    setImages((prev) => {
      const next = prev.map((im) => im.id === activeId ? { ...im, boxes: im.boxes.filter((_, j) => j !== i) } : im);
      persist(next, classes, subject);
      return next;
    });
  }
  function toggleNegative() {
    if (!active) { toast('בחרו קודם תמונה'); return; }
    setImages((prev) => {
      const next = prev.map((im) => im.id === activeId
        ? { ...im, negative: !im.negative, boxes: !im.negative ? [] : im.boxes }
        : im);
      persist(next, classes, subject);
      return next;
    });
  }
  function removeImage(id: number) {
    setImages((prev) => {
      const next = prev.filter((x) => x.id !== id);
      if (activeId === id) setActiveId(next.length ? next[0].id : null);
      persist(next, classes, subject);
      return next;
    });
  }

  // ---------- export + pool ----------
  function splitTrainVal(items: TagImage[]) {
    if (items.length < 5) return { flat: true, valSet: [] as TagImage[] };
    const groups: Record<string, TagImage[]> = {};
    items.forEach((im) => { const k = (im.subject || '').trim() || '_'; (groups[k] = groups[k] || []).push(im); });
    const keys = Object.keys(groups);
    const val = new Set<number>();
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
    if (!trainSet.length || !valSet.length) return { flat: true, valSet: [] as TagImage[] };
    return { flat: false, valSet };
  }

  async function buildZip() {
    const labeled = images.filter((i) => i.boxes.length || i.negative);
    if (!labeled.length) { toast('אין תמונות מתויגות — סמנו לפחות מלבן אחד.'); return null; }
    if (!classes.length) { toast('הוסיפו לפחות קטגוריה אחת.'); return null; }
    const JSZip = (await import('jszip')).default;
    const name = (auth.team || 'team').replace(/\s+/g, '_');
    const split = splitTrainVal(labeled);
    const valIds = new Set(split.valSet.map((im) => im.id));
    const zip = new JSZip();
    const yaml = `# YOLO dataset - Smart City\npath: .\n` +
      (split.flat ? `train: images\nval: images\n` : `train: images/train\nval: images/val\n`) +
      `\nnc: ${classes.length}\nnames: [${classes.map((c) => `'${c.name}'`).join(', ')}]\n`;
    zip.file('data.yaml', yaml);
    const slug = (s: string) => (s || '').trim().replace(/\s+/g, '-').replace(/[^\w֐-׿-]/g, '') || '';
    const used: Record<string, number> = {};
    let idx = 0, count = 0;
    for (const im of labeled) {
      const subj = slug(im.subject);
      const base = subj ? `${subj}_${slug(name) || 'team'}` : (slug(name) || 'team');
      let fn = `${base}_${String(idx).padStart(3, '0')}`;
      while (used[fn]) fn = `${base}_${String(++idx).padStart(3, '0')}`;
      used[fn] = 1;
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

  async function exportZip() {
    const built = await buildZip();
    if (!built) return;
    download(built.blob, `smartcity_dataset_${Date.now()}.zip`);
    lastExport.current = built;
    setCanShare(true);
  }

  async function share() {
    if (!auth.user) { authStore.set({ viewer: false }); toast('צריך להתחבר כדי לשתף', true); return; }
    let built = lastExport.current;
    if (!built) { built = await buildZip(); if (!built) return; lastExport.current = built; }
    setShareMsg('☁️ מעלה…');
    try {
      const path = `datasets/sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.zip`;  // ASCII-only key
      const up = await sb.storage.from(POOL_BUCKET).upload(path, built.blob, { contentType: 'application/zip' });
      if (up.error) throw up.error;
      const ins = await sb.from('thinkcv_datasets').insert({
        owner: auth.user.id,
        team_name: auth.team || 'קבוצה',
        student_name: null,
        subject: 'Smart City: ' + (subject.trim() || 'מפגעים'),
        classes: classes.map((c) => c.name),
        zip_path: path,
        image_count: built.count,
      });
      if (ins.error) throw ins.error;
      setShareMsg(`🌐 שותף ✓ (${built.count})`);
      loadPool();
    } catch (e: any) { setShareMsg('⚠️ נכשל: ' + (e.message || e)); }
  }

  async function loadPool() {
    const { data, error } = await sb.from('thinkcv_datasets')
      .select('id, team_name, student_name, subject, classes, zip_path, image_count, created_at')
      .order('created_at', { ascending: false }).limit(100);
    if (!error) setPool(data || []);
  }

  async function loadCityPool() {
    try { setCityPool(await fetchPoolStats()); } catch (e: any) { toast(e.message || e); }
  }

  async function exportCityPool() {
    setCpBusy(true); setCpMsg('אוסף את מאגר העיר…');
    try {
      const built = await buildCityPoolZip((d, t) => setCpMsg(`אורז ${d}/${t} תמונות…`));
      if (!built) { setCpMsg('הפול ריק.'); setCpBusy(false); return; }
      download(built.blob, `smartcity_pool_${Date.now()}.zip`);
      setCpMsg(`✓ ירד מאגר עירוני: ${built.count} תמונות · ${built.classes.length} קטגוריות (${built.classes.join(' · ')}) — ל-Colab, אמנו, וטענו כמודל העיר! 🔁`);
    } catch (e: any) { setCpMsg('⚠️ ' + (e.message || e)); }
    setCpBusy(false);
  }

  function parseYamlNames(y: string): string[] {
    const m = y.match(/names:\s*\[([^\]]*)\]/);
    if (!m) return [];
    return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }

  async function mergeSelected() {
    const sel = pool.filter((r) => poolChecked.has(r.id));
    if (!sel.length) return;
    try {
      const JSZip = (await import('jszip')).default;
      const merged = new JSZip();
      const union: string[] = []; const unionIdx: Record<string, number> = {};
      const addName = (n: string) => { if (unionIdx[n] == null) { unionIdx[n] = union.length; union.push(n); } return unionIdx[n]; };
      let totalImgs = 0, valCount = 0;
      for (let s = 0; s < sel.length; s++) {
        const row = sel[s];
        setMergeMsg(`מוריד ${s + 1}/${sel.length} — ${row.team_name}…`);
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
          const base = n.split('/').pop()!.replace(/\.(jpe?g|png)$/i, '');
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
      setMergeMsg('אורז ZIP מאוחד…');
      const blob = await merged.generateAsync({ type: 'blob' });
      download(blob, `smartcity_city_model_${sel.length}sets.zip`);
      setMergeMsg(`✓ ירד "מודל העיר": ${totalImgs} תמונות · ${union.length} קטגוריות (${union.join(' · ')}) — ל-Colab!`);
    } catch (e: any) { setMergeMsg('⚠️ שגיאה במיזוג: ' + (e.message || e)); }
  }

  // ---------- model ----------
  async function loadModel(f: File) {
    setModelMsg('טוען…');
    try {
      await loadModelFromZip(f, (auth.team || '') + ' מודל', classes.map((c) => c.name));
      lastModelFile.current = f;
      setRegistered(false);
      setModelMsg('');
    } catch (err: any) {
      setModelMsg('שגיאה: ' + err.message);
    }
  }

  async function registerModel() {
    if (!auth.user) { authStore.set({ viewer: false }); toast('צריך להתחבר', true); return; }
    if (!lastModelFile.current) return;
    try {
      const path = `models/m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.zip`;  // ASCII-only key
      const up = await sb.storage.from(BUCKET).upload(path, lastModelFile.current, { contentType: 'application/zip' });
      if (up.error) throw up.error;
      await insertModel({
        owner: auth.user.id,
        team_name: auth.team || 'קבוצה',
        name: (subject.trim() || 'מודל') + ' · ' + (auth.team || ''),
        classes: modelStore.get().classes,
        zip_path: path,
      });
      setRegistered(true);
      toast('המודל נרשם — עכשיו לסיור ברחובות! 🔴', true);
    } catch (e: any) { toast('רישום מודל: ' + (e.message || e)); }
  }

  async function handleTest(f: File) {
    if (!model.ready) { toast('טענו מודל קודם'); return; }
    if (!f.type.startsWith('image/')) { toast('צריך תמונה'); return; }
    const dataURL = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = (ev) => res(ev.target!.result as string);
      r.readAsDataURL(f);
    });
    const img = testImg.current!, cv = testOverlay.current!;
    img.src = dataURL;
    await new Promise((r) => { if (img.complete && img.naturalWidth) r(null); else img.onload = () => r(null); });
    setScanning(true);
    try {
      const { boxes, top, lowGuess } = await detectOnDataURL(dataURL, parseFloat(conf) || 0.25);
      cv.width = img.clientWidth; cv.height = img.clientHeight;
      const list = boxes.length ? boxes : (top ? [top] : []);
      drawDetections(cv, list);
      setTestResult({ list, low: lowGuess });
    } catch (e: any) { toast(e.message || e); }
    setScanning(false);
  }

  // ---------- derived ----------
  const totalBoxes = images.reduce((s, i) => s + i.boxes.length, 0);
  const labeled = images.filter((i) => i.boxes.length).length;
  const neg = images.filter((i) => i.negative).length;
  const doneCnt = labeled + neg;
  const pct = images.length ? Math.round(doneCnt / images.length * 100) : 0;
  const best = testResult?.list.length ? Math.max(...testResult.list.map((b) => b.score)) : 0;
  const bestPct = Math.round(best * 100);
  const meter = best >= 0.6
    ? { color: 'var(--cy)', emoji: '🎯', msg: 'המודל בטוח! אימנתם מצוין.' }
    : best >= 0.25
      ? { color: 'var(--cy)', emoji: '🙂', msg: 'מזהה — ועוד לומד. עוד תמונות = ביטחון גבוה יותר.' }
      : best >= 0.05
        ? { color: 'var(--warn)', emoji: '🤔', msg: 'מנחש. צריך עוד תמונות מגוונות.' }
        : { color: 'var(--danger)', emoji: '🐣', msg: 'עוד תינוק — תאכילו בעוד סרטונים, או מזגו את מאגר הקבוצות!' };

  return (
    <section className="view">
      {/* 1: collect */}
      <div className="card hud">
        <div className="phase-head">
          <span className="ph-n">1</span>
          <div>
            <b>איסוף</b>
            <span className="why">למה זה חשוב? מודל לומד רק ממה שהוא רואה. מגוון = חוכמה: זוויות, מרחקים, תאורה.</span>
          </div>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>מה מזהים עכשיו?</label>
          <input type="text" value={subject}
            onChange={(e) => { setSubject(e.target.value); persist(stRef.current.images, stRef.current.classes, e.target.value); }}
            placeholder="למשל: בור בכביש / מעבר חציה דהוי" style={{ flex: 1, minWidth: 170, maxWidth: 300 }} />
        </div>
        <div className="row">
          <label className="primary" style={{ cursor: 'pointer', padding: '9px 16px', border: '1px solid rgba(53,225,255,.7)', background: 'var(--cy-soft)', color: 'var(--ink)', fontWeight: 600 }}>
            🎬 בחר סרטונים
            <input type="file" accept="video/*" multiple style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files?.length) handleMedia(e.target.files); e.target.value = ''; }} />
          </label>
          <label style={{ cursor: 'pointer', padding: '9px 16px', border: '1px solid var(--cy-faint)', background: 'rgba(53,225,255,.03)' }}>
            העלה תמונות
            <input type="file" accept="image/*" multiple style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files?.length) handleMedia(e.target.files); e.target.value = ''; }} />
          </label>
          <button className="ghost" onClick={() => { setPoolOpen((v) => !v); if (!poolOpen) fetchRoutes().then(setPoolRoutes).catch(() => {}); }}>
            מהמאגר העירוני
          </button>
          <label className="mini">
            תמונות מסרטון:
            <select value={frameCount} onChange={(e) => setFrameCount(e.target.value)}>
              <option>30</option><option>60</option><option>100</option>
            </select>
          </label>
          <label className="mini">
            <input type="checkbox" checked={sharpOnly} onChange={(e) => setSharpOnly(e.target.checked)} /> רק חדות
          </label>
        </div>
        {poolOpen && (
          <div className="row" style={{ marginTop: 10 }}>
            <select value={poolRouteSel} onChange={(e) => setPoolRouteSel(e.target.value)} style={{ minWidth: 220 }}>
              <option value="">בחרו מסלול…</option>
              {poolRoutes.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.frame_count} 📷)</option>)}
            </select>
            <button className="primary" onClick={loadCityFrames}>טען פריימים</button>
          </div>
        )}
        {progress && <div className="hint" style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: progress }} />}
        <label className="dropzone" style={{ display: 'block', marginTop: 10 }}>
          <b>או גררו לכאן</b> סרטונים / תמונות
          <input type="file" accept="video/*,image/*" multiple style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files?.length) handleMedia(e.target.files); e.target.value = ''; }} />
        </label>
      </div>

      {/* 2+3: curate + tag */}
      <div className="card hud">
        <div className="phase-head">
          <span className="ph-n">2·3</span>
          <div>
            <b>אוצרות ותיוג</b>
            <span className="why">למה זה חשוב? "זבל נכנס — זבל יוצא". מחקו תמונות גרועות (✕), תייגו מלבן צמוד, וסמנו רקע (~רבע מהתמונות) כדי שהמודל ילמד מה זה "אין מפגע".</span>
          </div>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <input type="text" value={newClass} onChange={(e) => setNewClass(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { addClass(newClass); setNewClass(''); } }}
            placeholder="קטגוריית מפגע חדשה… למשל: בור" style={{ flex: 1, minWidth: 170, maxWidth: 280 }} />
          <button className="primary" onClick={() => { addClass(newClass); setNewClass(''); }}>הוסף קטגוריה</button>
          <button className="ghost" onClick={toggleNegative}>🚫 רקע — אין מפגע</button>
        </div>
        <div className="classes">
          {classes.length ? classes.map((cl, i) => (
            <button key={cl.id} className={'class-btn' + (i === selClass ? ' sel' : '')} onClick={() => setSelClass(i)}>
              <span className="sw" style={{ background: cl.color }} />
              {cl.name} <span className="key">[{i + 1}]</span>
            </button>
          )) : <span className="muted" style={{ fontSize: 12.5 }}>אין עדיין קטגוריות — הוסיפו את המפגעים שה-AI ילמד לזהות (בור, מעבר דהוי, פסולת…)</span>}
        </div>
        <div className="stage-wrap" style={{ marginTop: 12 }}>
          <div className="stage-col">
            <div className="stage">
              {active ? (
                <>
                  <img ref={stageImg} src={active.dataURL} alt="" />
                  <canvas ref={overlay}
                    onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
                    onMouseLeave={() => { draw.current.pos = null; drawBoxes(); }}
                    onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp} />
                </>
              ) : (
                <div className="empty">העלו סרטון או תמונות בשלב 1 — הפריימים יופיעו כאן לתיוג</div>
              )}
            </div>
            {images.length > 0 && (
              <div className="tagbar">
                <span>התקדמות</span>
                <div className="bar"><i style={{ width: pct + '%' }} /></div>
                <b>{doneCnt}/{images.length}{pct === 100 ? ' 🎉' : ''}</b>
              </div>
            )}
            <div className="strip">
              {images.map((im) => (
                <div key={im.id} className={'frame' + (im.id === activeId ? ' active' : '')}>
                  <img src={im.dataURL} alt="" onClick={() => setActiveId(im.id)} />
                  {im.negative
                    ? <span className="cnt has">🚫</span>
                    : <span className={'cnt ' + (im.boxes.length ? 'has' : 'none')}>{im.boxes.length ? im.boxes.length + ' ✓' : '0'}</span>}
                  <button className="x" onClick={() => removeImage(im.id)}>×</button>
                </div>
              ))}
            </div>
          </div>
          <div className="side-col">
            <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>מלבנים בתמונה:</div>
            <div className="boxlist">
              {active?.boxes.length ? active.boxes.map((b, i) => (
                <div key={i} className="boxrow">
                  <span className="sw" style={{ background: clsOf(b.cls).color }} />
                  <span>{clsOf(b.cls).name}</span>
                  <span className="muted" style={{ fontSize: 11 }}>#{i + 1}</span>
                  <button className="del" onClick={() => removeBox(i)}>×</button>
                </div>
              )) : <span className="muted" style={{ fontSize: 12 }}>אין עדיין מלבנים</span>}
            </div>
            <div className="stat-grid" style={{ marginTop: 12 }}>
              {[{ v: images.length, l: 'תמונות' }, { v: labeled, l: 'מתויגות' }, { v: neg, l: 'רקע' }, { v: totalBoxes, l: 'מלבנים' }].map((s) => (
                <div key={s.l} className="stat"><div className="v">{s.v}</div><div className="l">{s.l}</div></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 4: train + pool */}
      <div className="card hud">
        <div className="phase-head">
          <span className="ph-n">4</span>
          <div>
            <b>אימון</b>
            <span className="why">למה זה חשוב? כאן הדאטה הופך למודל. GPU בענן לומד את הדוגמאות שלכם ב~10 דקות.</span>
          </div>
        </div>
        <div className="row">
          <button className="primary" onClick={exportZip}>📦 שמור דאטהסט (ZIP)</button>
          <button className="hot" disabled={!canShare} onClick={share}>🌐 שתף למאגר הקבוצות</button>
          <button onClick={() => window.open(COLAB, '_blank')}>☁️ פתח מחברת אימון</button>
          {shareMsg && <span className="pill">{shareMsg}</span>}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Colab: ‏Runtime ← Run all ← העלו את ה-ZIP ← יורד <code>yolo_tfjs_model.zip</code>. ודאו T4 GPU.
        </p>
        <div className="poolbox">
          <div className="row" style={{ marginBottom: 8 }}>
            <b style={{ fontSize: 14 }}>🤝 מאגר הקבוצות — מודל העיר</b>
            <button className="ghost" style={{ fontSize: 12 }} onClick={loadPool}>רענן</button>
            <button className="hot" style={{ fontSize: 12.5 }} disabled={!poolChecked.size} onClick={mergeSelected}>⚡ מזג והורד</button>
            <span className="pill">{pool.length} דאטהסטים</span>
          </div>
          {pool.length ? pool.map((r) => (
            <label key={r.id} className="pool-row">
              <input type="checkbox" checked={poolChecked.has(r.id)}
                onChange={(e) => {
                  setPoolChecked((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(r.id); else next.delete(r.id);
                    return next;
                  });
                }} />
              <div className="meta">
                <div className="nm">{r.team_name}{r.subject ? ' — ' + r.subject : ''}</div>
                <div className="cls">{r.image_count} תמונות · {(Array.isArray(r.classes) ? r.classes : []).join(' · ') || '—'} · {fmtWhen(r.created_at)}</div>
              </div>
            </label>
          )) : <span className="muted" style={{ fontSize: 13 }}>עוד אין — היו הראשונים לשתף! 🚀</span>}
          {mergeMsg && <div className="hint">{mergeMsg}</div>}
        </div>

        {/* 🏙️ community pool — every resident catch trains the city model */}
        {auth.admin && (
          <div className="poolbox" style={{ borderTopColor: 'rgba(255,182,39,.35)' }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <b style={{ fontSize: 14 }}>🏙️ מאגר העיר — אימון קהילתי</b>
              <button className="ghost" style={{ fontSize: 12 }} onClick={loadCityPool}>רענן</button>
              <button className="hot" style={{ fontSize: 12.5 }} disabled={!cityPool || !cityPool.total || cpBusy} onClick={exportCityPool}>
                {cpBusy ? 'אורז…' : '📦 ייצא מאגר עירוני (ZIP)'}
              </button>
            </div>
            <p className="hint" style={{ margin: '0 0 8px' }}>
              כל צילום של תושב שעבר את שער ה-AI בפטרול = דוגמת אימון (תמונה מלאה + תיבה). ייצוא ← Colab ← מודל עיר משופר ← נטען אוטומטית לכל טלפון. 🔁
            </p>
            {cityPool ? (
              cityPool.total ? (
                <div>
                  <div className="stat-grid" style={{ marginBottom: 8 }}>
                    <div className="stat"><div className="v">{cityPool.total}</div><div className="l">תמונות בפול</div></div>
                    <div className="stat"><div className="v">{cityPool.byClass.length}</div><div className="l">קטגוריות</div></div>
                    <div className="stat"><div className="v">{cityPool.contributors}</div><div className="l">תושבים תרמו</div></div>
                  </div>
                  <div className="classes">
                    {cityPool.byClass.map((c) => (
                      <span key={c.name} className="class-btn" style={{ cursor: 'default' }}>
                        <span className="sw" style={{ background: 'var(--gold)' }} />{c.name} · {c.count}
                      </span>
                    ))}
                  </div>
                </div>
              ) : <span className="muted" style={{ fontSize: 13 }}>הפול ריק — כשתושבים יצלמו בפטרול, התמונות ייכנסו לכאן.</span>
            ) : <span className="muted" style={{ fontSize: 13 }}>לחצו "רענן" לראות את מאגר העיר.</span>}
            {cpMsg && <div className="hint">{cpMsg}</div>}
          </div>
        )}
      </div>

      {/* 5+6: evaluate + deploy */}
      <div className="card hud">
        <div className="phase-head">
          <span className="ph-n">5·6</span>
          <div>
            <b>הערכה ופריסה</b>
            <span className="why">למה זה חשוב? מודל נמדד על תמונות שלא ראה. טענו את המודל, בדקו — ואז פרסו אותו לסיור חי בעיר.</span>
          </div>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="ghost" style={{ cursor: 'pointer', padding: '9px 16px', border: '1px solid var(--cy-faint)' }}>
            📂 טען מודל (ZIP)
            <input type="file" accept=".zip" style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files?.[0]) loadModel(e.target.files[0]); e.target.value = ''; }} />
          </label>
          <span className="pill">
            {model.ready ? <><span className="status-dot live" />מודל טעון ✓</> : modelMsg || <><span className="status-dot" />אין מודל</>}
          </span>
          <button className="primary" disabled={!model.ready || registered} onClick={registerModel}>
            {registered ? '✓ נרשם! זמין לסיור חי' : '🚀 רשום כמודל הקבוצה'}
          </button>
          <label className="mini">
            רגישות: <input type="text" value={conf} onChange={(e) => setConf(e.target.value)} style={{ width: 50 }} />
          </label>
        </div>
        <div className="stage-wrap">
          <div className="stage-col">
            <div className={'stage' + (scanning ? ' scanning' : '')}>
              {testResult !== null || scanning ? (
                <>
                  <img ref={testImg} alt="" />
                  <canvas ref={testOverlay} />
                </>
              ) : (
                <>
                  <img ref={testImg} alt="" style={{ display: 'none' }} />
                  <canvas ref={testOverlay} style={{ display: 'none' }} />
                  <div className="empty">טענו מודל ← העלו תמונה לבדיקה</div>
                </>
              )}
            </div>
            <label className="dropzone" style={{ display: 'block', marginTop: 8 }}>
              גררו <b>תמונה</b> לבדיקה או לחצו
              <input type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files?.[0]) handleTest(e.target.files[0]); e.target.value = ''; }} />
            </label>
          </div>
          <div className="side-col">
            <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>מה זוהה:</div>
            {testResult ? (
              <div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>ביטחון {meter.emoji}</span>
                    <span style={{ fontSize: 22, fontWeight: 800, color: meter.color }}>{bestPct}%</span>
                  </div>
                  <div style={{ height: 8, background: '#ffffff14', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: Math.max(bestPct, 2) + '%', background: meter.color, transition: 'width .5s' }} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>{meter.msg}</div>
                </div>
                {testResult.list.map((b, i) => (
                  <div key={i} className="boxrow">
                    <span>{model.classes[b.cls] || 'קטגוריה ' + (b.cls + 1)}</span>
                    <span className="muted" style={{ marginInlineStart: 'auto' }}>{Math.round(b.score * 100)}%</span>
                  </div>
                ))}
              </div>
            ) : <span className="muted" style={{ fontSize: 12 }}>—</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
