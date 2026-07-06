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

// only AI-passed catches with a full frame + box are training-grade
async function fetchPoolRows(limit = 3000) {
  const { data, error } = await sb.from('sc_detections')
    .select('class_name, frame_path, bbox, confidence, detected_by, created_at')
    .not('frame_path', 'is', null)
    .not('bbox', 'is', null)
    .neq('status', 'rejected')
    .gt('confidence', 0)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function fetchPoolStats(): Promise<PoolStats> {
  const rows = await fetchPoolRows();
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

// build a YOLO dataset ZIP from the whole city pool (full images + labels)
export async function buildCityPoolZip(onProgress: (d: number, t: number) => void) {
  const JSZip = (await import('jszip')).default;
  const rows = await fetchPoolRows();
  if (!rows.length) return null;

  // class index map
  const names: string[] = [];
  const idx: Record<string, number> = {};
  rows.forEach((r: any) => { if (idx[r.class_name] == null) { idx[r.class_name] = names.length; names.push(r.class_name); } });

  const zip = new JSZip();
  zip.file('data.yaml',
    `# Smart City — community training pool\npath: .\ntrain: images/train\nval: images/val\n\n` +
    `nc: ${names.length}\nnames: [${names.map((n) => `'${n}'`).join(', ')}]\n`);

  let ok = 0;
  for (let i = 0; i < rows.length; i++) {
    const r: any = rows[i];
    onProgress(i + 1, rows.length);
    try {
      const res = await fetch(publicUrl(r.frame_path));
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const seg = (i % 5 === 0) ? 'val' : 'train';  // 80/20 split
      const base = `pool_${String(i).padStart(4, '0')}`;
      zip.file(`images/${seg}/${base}.jpg`, bytes);
      const b = r.bbox || {};
      const xc = (b.x + b.w / 2).toFixed(6), yc = (b.y + b.h / 2).toFixed(6);
      zip.file(`labels/${seg}/${base}.txt`, `${idx[r.class_name]} ${xc} ${yc} ${(b.w || 0).toFixed(6)} ${(b.h || 0).toFixed(6)}\n`);
      ok++;
    } catch { /* skip unreadable frame */ }
    await new Promise((res) => setTimeout(res, 0));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, count: ok, classes: names };
}
