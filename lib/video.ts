'use client';
// video → sharp frames (proven thinkCV pipeline: decoder priming,
// rVFC seek settle, black-frame retry, Laplacian sharpness)

export function blurScore(srcCtx: CanvasRenderingContext2D, W: number, H: number): number {
  const sw = Math.min(W, 256), sh = Math.max(1, Math.round(H * sw / W));
  const tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  const tctx = tmp.getContext('2d')!;
  tctx.drawImage(srcCtx.canvas, 0, 0, sw, sh);
  const d = tctx.getImageData(0, 0, sw, sh).data;
  const g = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) {
    const i = y * sw + x;
    const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - sw] - g[i + sw];
    sum += lap; sum2 += lap * lap; n++;
  }
  return sum2 / n - (sum / n) * (sum / n);
}

export interface ExtractedFrame { url: string; t: number; score: number; i: number }

export async function extractFrames(
  file: File,
  { want = 60, sharpOnly = true, maxW = 640, onProgress = (_d: number, _t: number) => {} } = {},
): Promise<{ frames: ExtractedFrame[]; duration: number }> {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true;
  const url = URL.createObjectURL(file);
  v.src = url;
  try {
    await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error('הווידאו לא נטען')); });
    let dur = v.duration;
    if (!isFinite(dur) || dur <= 0) {
      await new Promise<void>((res) => { const to = setTimeout(res, 2000); v.onseeked = () => { clearTimeout(to); res(); }; v.currentTime = 1e7; });
      dur = v.duration;
    }
    if (!isFinite(dur) || dur <= 0) throw new Error('לא הצלחתי לקרוא את אורך הווידאו');
    if (!v.videoWidth || !v.videoHeight) throw new Error('הדפדפן לא מפענח את הווידאו (קודק לא נתמך — HEVC מאייפון? הגדירו Most Compatible)');

    const cw = Math.min(v.videoWidth, maxW);
    const ch = Math.round(v.videoHeight * cw / v.videoWidth);
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d')!;

    // prime the decoder — phone videos paint BLACK until playback started once
    try { await v.play(); await new Promise((r) => setTimeout(r, 150)); v.pause(); } catch { /* autoplay block ok */ }

    const t0 = Math.min(0.3, dur * 0.05), t1 = dur - Math.min(0.3, dur * 0.05);
    const span = Math.max(t1 - t0, 0.1);
    const seek = (t: number) => new Promise<void>((res) => {
      let done = false;
      const settle = () => {
        if (done) return;
        done = true; clearTimeout(to);
        if ('requestVideoFrameCallback' in v) {
          let fired = false;
          const t2 = setTimeout(() => { if (!fired) { fired = true; res(); } }, 400);
          (v as any).requestVideoFrameCallback(() => { if (!fired) { fired = true; clearTimeout(t2); res(); } });
        } else setTimeout(res, 60);
      };
      const to = setTimeout(settle, 2500);
      v.onseeked = settle;
      try { v.currentTime = t; } catch { settle(); }
    });
    const frameLooksBlack = () => {
      const d = ctx.getImageData(0, 0, Math.min(cw, 32), Math.min(ch, 24)).data;
      let s = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { s += d[i] + d[i + 1] + d[i + 2]; n++; }
      return (s / n / 3) < 4;
    };

    const tries = sharpOnly ? Math.min(want * 2, want + 80) : want;
    const cands: ExtractedFrame[] = [];
    for (let i = 0; i < tries; i++) {
      const t = Math.min(t0 + span * (i / (tries - 1 || 1)), t1);
      await seek(t);
      ctx.drawImage(v, 0, 0, cw, ch);
      if (frameLooksBlack()) {
        await new Promise((r) => setTimeout(r, 200));
        ctx.drawImage(v, 0, 0, cw, ch);
        if (frameLooksBlack()) continue;
      }
      cands.push({ url: cv.toDataURL('image/jpeg', 0.85), t, score: sharpOnly ? blurScore(ctx, cw, ch) : 1, i });
      onProgress(i + 1, tries);
      await new Promise((r) => setTimeout(r, 0));
    }
    if (!cands.length) throw new Error('כל הפריימים יצאו שחורים — הדפדפן לא מפענח את הסרטון (iPhone: Formats → Most Compatible)');
    const chosen = sharpOnly
      ? cands.slice().sort((a, b) => b.score - a.score).slice(0, want).sort((a, b) => a.i - b.i)
      : cands.slice(0, want);
    return { frames: chosen, duration: dur };
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute('src');
  }
}
