'use client';
// 🎓 Pocket Trainer — a regular resident trains a REAL model on the phone
// in ~30 seconds: MobileNet embeddings + kNN head (Teachable-Machine style).
// Classifier (is/isn't the target), not a detector — good enough to gate
// the game when no city YOLO exists yet. Saved locally, works offline.
import { createStore } from './store';

export interface PocketState {
  ready: boolean;
  className: string;
  targetCount: number;
  otherCount: number;
  netLoading: boolean;
}

export const pocketStore = createStore<PocketState>({
  ready: false, className: '', targetCount: 0, otherCount: 0, netLoading: false,
});

const LS_KEY = 'sc_pocket_v1';
let net: any = null;
let knn: any = null;

async function ensureEngine() {
  if (net && knn) return;
  pocketStore.set({ netLoading: true });
  const [, mobilenet, knnLib] = await Promise.all([
    import('@tensorflow/tfjs'),
    import('@tensorflow-models/mobilenet'),
    import('@tensorflow-models/knn-classifier'),
  ]);
  if (!net) net = await mobilenet.load({ version: 2, alpha: 0.5 });   // phone-friendly
  if (!knn) knn = knnLib.create();
  pocketStore.set({ netLoading: false });
}

function imgFrom(durl: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = durl;
  });
}

async function embed(durl: string) {
  const tf = await import('@tensorflow/tfjs');
  const img = await imgFrom(durl);
  return tf.tidy(() => net.infer(tf.browser.fromPixels(img), true));
}

export async function addExample(durl: string, label: 'target' | 'other') {
  await ensureEngine();
  const act = await embed(durl);
  knn.addExample(act, label);
  act.dispose();
  const s = pocketStore.get();
  pocketStore.set(label === 'target'
    ? { targetCount: s.targetCount + 1 }
    : { otherCount: s.otherCount + 1 });
}

export async function classifyPocket(durl: string): Promise<{ label: string; confidence: number }> {
  await ensureEngine();
  const act = await embed(durl);
  const k = Math.min(10, pocketStore.get().targetCount + pocketStore.get().otherCount);
  const r = await knn.predictClass(act, k);
  act.dispose();
  return { label: r.label, confidence: r.confidences[r.label] ?? 0 };
}

export async function finishPocket(className: string) {
  const tf = await import('@tensorflow/tfjs');
  const dataset = knn.getClassifierDataset();
  const out: Record<string, { data: number[]; shape: number[] }> = {};
  Object.entries(dataset).forEach(([label, t]: [string, any]) => {
    out[label] = { data: Array.from(t.dataSync()), shape: t.shape };
  });
  const s = pocketStore.get();
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      className, dataset: out, counts: { target: s.targetCount, other: s.otherCount },
    }));
  } catch { /* storage full — model still lives in memory this session */ }
  pocketStore.set({ ready: true, className });
  void tf;
}

export async function initPocket() {
  if (pocketStore.get().ready) return;
  let saved: any = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { /* corrupt */ }
  if (!saved?.dataset) return;
  await ensureEngine();
  const tf = await import('@tensorflow/tfjs');
  const ds: Record<string, any> = {};
  Object.entries(saved.dataset).forEach(([label, d]: [string, any]) => {
    ds[label] = tf.tensor2d(d.data, d.shape as [number, number]);
  });
  knn.setClassifierDataset(ds);
  pocketStore.set({
    ready: true, className: saved.className || 'מפגע',
    targetCount: saved.counts?.target || 0, otherCount: saved.counts?.other || 0,
  });
}

export function clearPocket() {
  try { localStorage.removeItem(LS_KEY); } catch { /* private mode */ }
  if (knn) knn.clearAllClasses();
  pocketStore.set({ ready: false, className: '', targetCount: 0, otherCount: 0 });
}
