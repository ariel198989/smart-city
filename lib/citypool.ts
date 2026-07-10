'use client';
// 🏙️ City training pool — the flywheel:
// every resident catch (full frame + bbox + class, AI-gated) becomes
// crowd-sourced YOLO training data. Admin exports → Colab → better city
// model → auto-loaded to every phone. More players = smarter model.
import { sb, publicUrl } from './db';

export interface PoolStats {
  total: number;
  byClass: { name: string; count: number }[];
  contributors: number;
}

// only AI-passed catches with a full frame + box are training-grade.
// SCALE CEILING: the ZIP is assembled in device memory (~200KB/img →
// 1500 ≈ 300MB). Beyond that the export must move server-side
// (Edge Function / worker) — newest-first keeps the freshest data in.
async function fetchPoolRows(limit = 1500, ownerId?: string) {
  // training-grade = full frame + a bbox. NOT confidence>0: human-tagged
  // phone photos carry confidence 0 and are exactly the data we want —
  // that filter silently excluded the whole series→tag flow.
  // ownerId: personal training — a student trains on HER photos first,
  // the class merge comes as its own later step (pedagogy, Ariel).
  let q = sb.from('sc_detections')
    .select('class_name, frame_path, bbox, confidence, detected_by, created_at')
    .not('frame_path', 'is', null)
    .not('bbox', 'is', null)
    .neq('status', 'rejected');
  if (ownerId) q = q.eq('detected_by', ownerId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// how many TAGGED (training-grade) photos are mine
export async function fetchMyTaggedCount(userId: string): Promise<number> {
  const { count } = await sb.from('sc_detections')
    .select('id', { count: 'exact', head: true })
    .eq('detected_by', userId)
    .not('frame_path', 'is', null).not('bbox', 'is', null).neq('status', 'rejected');
  return count || 0;
}

// phone shots awaiting desktop tagging: full frames without a bbox
// (pocket-gated + ungated catches) — "training starts on the phone,
// continues on the web"
export async function fetchUntaggedPhoneShots(limit = 100, ownerId?: string) {
  // ownerId: a student tags only HER OWN phone shots (classroom isolation).
  // Without it every user would pull everyone else's untagged photos.
  let q = sb.from('sc_detections')
    .select('id, class_name, frame_path, crop_path, created_at, team_name')
    .is('bbox', null)
    .neq('status', 'rejected');
  if (ownerId) q = q.eq('detected_by', ownerId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).filter((r: any) => r.frame_path || r.crop_path);
}

// recent pool photos — make the invisible dataset visible to everyone
export async function fetchPoolGallery(limit = 12, ownerId?: string) {
  let q = sb.from('sc_detections')
    .select('frame_path, class_name, created_at')
    .not('frame_path', 'is', null)
    .neq('status', 'rejected');
  if (ownerId) q = q.eq('detected_by', ownerId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// how many training photos did *I* contribute
export async function fetchMyContribution(userId: string) {
  const { count, error } = await sb.from('sc_detections')
    .select('id', { count: 'exact', head: true })
    .eq('detected_by', userId)
    .not('frame_path', 'is', null)
    .neq('status', 'rejected');
  if (error) return 0;
  return count || 0;
}

export async function fetchPoolStats(ownerId?: string): Promise<PoolStats> {
  const rows = await fetchPoolRows(1500, ownerId);
  const byClass: Record<string, number> = {};
  const people = new Set<string>();
  rows.forEach((r: any) => {
    byClass[r.class_name] = (byClass[r.class_name] || 0) + 1;
    if (r.detected_by) people.add(r.detected_by);
  });
  return {
    total: rows.length,
    contributors: people.size,
    byClass: Object.entries(byClass).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

// ---- field feedback (blocked photos: disputes + negatives) ----
export async function fetchFeedback(status = 'pending', limit = 200) {
  const { data, error } = await sb.from('sc_feedback')
    .select('*').eq('status', status).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function setFeedbackStatus(id: string, status: 'accepted' | 'rejected') {
  const { error } = await sb.from('sc_feedback').update({ status }).eq('id', id);
  if (error) throw error;
}

// accepted negatives = background training images (empty YOLO labels)
async function fetchAcceptedNegatives(limit = 800) {
  const { data, error } = await sb.from('sc_feedback')
    .select('frame_path').eq('kind', 'negative').eq('status', 'accepted').limit(limit);
  if (error) return [];
  return data || [];
}

// build a YOLO dataset ZIP from the whole city pool (full images + labels)
export async function buildCityPoolZip(onProgress: (d: number, t: number) => void, ownerId?: string) {
  const JSZip = (await import('jszip')).default;
  const rows = await fetchPoolRows(1500, ownerId);
  if (!rows.length) return null;

  // class index map
  const names: string[] = [];
  const idx: Record<string, number> = {};
  rows.forEach((r: any) => { if (idx[r.class_name] == null) { idx[r.class_name] = names.length; names.push(r.class_name); } });

  const zip = new JSZip();
  zip.file('data.yaml',
    `# Smart City — community training pool\npath: .\ntrain: images/train\nval: images/val\n\n` +
    `nc: ${names.length}\nnames: [${names.map((n) => `'${n}'`).join(', ')}]\n`);

  // GROUP-AWARE 80/20 split: a burst series produces near-duplicate
  // frames — scattering them across train AND val inflates val metrics
  // (the model "recognizes" its own training frames). Whole groups
  // (same shooter + class + 10-minute window) go to one side only.
  //
  // STRATIFIED PER CLASS (critical): a naive global split can send ALL of
  // a class's groups to val, leaving that class with ZERO training images
  // → the model never learns it (ap50=0, "dead class") and then predicts
  // garbage with confidence. So we hold out val groups WITHIN each class,
  // and never take a class's last remaining train group.
  const groupOf = (r: any) =>
    `${r.detected_by || 'anon'}|${r.class_name}|${Math.floor(new Date(r.created_at).getTime() / 600000)}`;
  const groupsByClass: Record<string, string[]> = {};
  rows.forEach((r: any) => {
    const g = groupOf(r);
    (groupsByClass[r.class_name] ||= []);
    if (!groupsByClass[r.class_name].includes(g)) groupsByClass[r.class_name].push(g);
  });
  const valGroups = new Set<string>();
  for (const cls of Object.keys(groupsByClass)) {
    const gs = groupsByClass[cls];
    if (gs.length <= 1) continue;                       // one group → keep in TRAIN (stay learnable)
    const take = Math.min(Math.max(1, Math.floor(gs.length * 0.2)), gs.length - 1); // never empty the train side
    for (let i = 0; i < take; i++) valGroups.add(gs[i]);
  }

  let ok = 0, failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const r: any = rows[i];
    onProgress(i + 1, rows.length);
    try {
      const res = await fetch(publicUrl(r.frame_path));
      if (!res.ok) { failed++; continue; }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const seg = valGroups.has(groupOf(r)) ? 'val' : 'train';
      const base = `pool_${String(i).padStart(4, '0')}`;
      zip.file(`images/${seg}/${base}.jpg`, bytes);
      const b = r.bbox || {};
      const xc = (b.x + b.w / 2).toFixed(6), yc = (b.y + b.h / 2).toFixed(6);
      zip.file(`labels/${seg}/${base}.txt`, `${idx[r.class_name]} ${xc} ${yc} ${(b.w || 0).toFixed(6)} ${(b.h || 0).toFixed(6)}\n`);
      ok++;
    } catch { failed++; /* skip unreadable frame */ }
    await new Promise((res) => setTimeout(res, 0));
  }
  // a mostly-failed pack would open a training job that trains on almost
  // nothing — abort loudly instead (>25% of frames failed to download)
  if (ok === 0 || failed > rows.length * 0.25) {
    return { blob: null as any, count: 0, negatives: 0, classes: names,
      error: `${failed}/${rows.length} תמונות לא ירדו (רשת?) — האימון בוטל, נסו שוב` };
  }

  // negatives: accepted "ה-AI צדק" photos → background images, empty labels
  // (~quarter negatives; and for a personal 'mine' pool, cap at ~25% of the
  // positives so a student's small dataset isn't swamped by city-wide bg)
  const negs = (await fetchAcceptedNegatives()).slice(0, ownerId ? Math.ceil(ok / 4) : 1000);
  let negOk = 0;
  for (let i = 0; i < negs.length; i++) {
    try {
      const res = await fetch(publicUrl(negs[i].frame_path));
      if (!res.ok) continue;
      const seg = (i % 5 === 0) ? 'val' : 'train';
      const base = `neg_${String(i).padStart(4, '0')}`;
      zip.file(`images/${seg}/${base}.jpg`, new Uint8Array(await res.arrayBuffer()));
      zip.file(`labels/${seg}/${base}.txt`, '');
      negOk++;
    } catch { /* skip */ }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, count: ok, negatives: negOk, classes: names };
}
