'use client';
// 🚀 real-training queue: the phone builds the YOLO dataset ZIP in the
// browser, uploads it, and opens a job; the Colab notebook auto-fetches
// the pending job (no manual upload); the app registers the result.
import { sb, uploadBlob, insertModel } from './db';
import { buildCityPoolZip } from './citypool';
import { loadModelFromZip, modelStore } from './infer';

export interface TrainJob {
  id: string; status: string; image_count: number;
  classes: string[]; team_name: string | null; created_at: string;
}

// jobs scoped to the requester — a student's pending job must not block
// (or get claimed by) a different student/class. 'mine' = my personal
// jobs; 'all' = this team's merged-training jobs.
export async function fetchJobs(
  limit = 5,
  who?: { userId?: string; team?: string | null; scope?: 'mine' | 'all' },
): Promise<TrainJob[]> {
  let q = sb.from('sc_training_jobs')
    .select('*').order('created_at', { ascending: false }).limit(limit);
  if (who?.scope === 'mine' && who.userId) q = q.eq('requested_by', who.userId);
  else if (who?.scope === 'all' && who.team) q = q.eq('team_name', who.team);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// let a requester cancel their own stale pending job (frees the queue)
export async function cancelJob(id: string): Promise<void> {
  await sb.from('sc_training_jobs').update({ status: 'cancelled' }).eq('id', id).eq('status', 'pending');
}

// phone-side: build the dataset and open a job.
// scope 'mine' = personal training (only MY tagged photos — a student
// completes the full cycle solo first); 'all' = the class-merged pool.
export async function startTrainingJob(
  user: { id: string }, team: string | null,
  onProgress: (msg: string) => void,
  scope: 'mine' | 'all' = 'all',
): Promise<{ job: TrainJob } | { error: string }> {
  onProgress(scope === 'mine' ? 'אוסף את התמונות שלך…' : 'אוסף את מאגר העיר…');
  const built = await buildCityPoolZip(
    (d, t) => onProgress(`אורז ${d}/${t} תמונות…`),
    scope === 'mine' ? user.id : undefined,
  );
  if (built && (built as any).error) return { error: (built as any).error };
  if (!built || !built.count) {
    return { error: scope === 'mine'
      ? 'אין לך עדיין תמונות מתויגות — צלמו סדרה ותייגו קודם.'
      : 'אין עדיין תמונות מתויגות (עם תיבות) בפול — צריך תפיסות דרך מודל YOLO, או תיוג בדסקטופ.' };
  }
  onProgress('מעלה את הדאטה לענן…');
  const path = `jobs/j_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.zip`;  // ASCII-only key
  await uploadBlob(path, built.blob, 'application/zip');
  const { data, error } = await sb.from('sc_training_jobs').insert({
    pool_zip_path: path, image_count: built.count, classes: built.classes,
    requested_by: user.id,
    team_name: scope === 'mine' ? `אישי · ${team || 'ללא קבוצה'}` : team,
  }).select().single();
  if (error) return { error: error.message };
  return { job: data };
}

// phone-side: register the model the Colab run produced (authenticated!)
export async function registerTrainedModel(
  file: File, user: { id: string }, team: string | null, jobId?: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    // validate it actually loads before publishing to the whole city
    await loadModelFromZip(file, 'מודל העיר · ' + (team || ''));
    const path = `models/m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.zip`;
    await uploadBlob(path, file, 'application/zip');
    const model = await insertModel({
      owner: user.id, team_name: team || 'קבוצה',
      name: 'מודל העיר · ' + (team || ''),
      classes: modelStore.get().classes, zip_path: path,
    });
    if (jobId) {
      await sb.from('sc_training_jobs')
        .update({ status: 'done', result_model_id: model.id, completed_at: new Date().toISOString() })
        .eq('id', jobId);
    }
    return { ok: true };
  } catch (e: any) {
    return { error: e.message || String(e) };
  }
}
