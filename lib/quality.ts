'use client';
// 📷 instant photo quality pre-check — BEFORE the AI gate.
// Garbage in the training pool (blur / darkness) = a worse city model,
// so we reject it in ~30ms on-device instead of teaching the AI junk.
// Conservative thresholds: better to let a borderline photo through
// than to block a legit catch in evening light.

export interface FrameQuality { ok: boolean; reason: string | null }

export async function assessFrameQuality(durl: string): Promise<FrameQuality> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im); im.onerror = rej; im.src = durl;
    });
    // tiny working copy — quality metrics don't need resolution
    const W = 160, H = Math.max(1, Math.round(img.height * W / img.width));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    // grayscale + mean luminance
    const g = new Float32Array(W * H);
    let lum = 0;
    for (let i = 0; i < W * H; i++) {
      const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      g[i] = v; lum += v;
    }
    lum /= W * H;
    if (lum < 28) return { ok: false, reason: '🌑 חשוך מדי — נסו עם יותר אור או התקרבו' };

    // blur: variance of a 4-neighbor Laplacian (sharp edges → high variance)
    let sum = 0, sum2 = 0, n = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
        sum += lap; sum2 += lap * lap; n++;
      }
    }
    const variance = sum2 / n - (sum / n) ** 2;
    if (variance < 20) return { ok: false, reason: '📷 התמונה מטושטשת — החזיקו יציב ונסו שוב' };

    return { ok: true, reason: null };
  } catch {
    return { ok: true, reason: null };  // never let the checker itself block play
  }
}
