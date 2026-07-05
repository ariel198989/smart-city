export const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function classColor(name: string, palette: string[]): string {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export function dataURLtoBlob(dataURL: string): Blob {
  const [head, b64] = dataURL.split(',');
  const mime = (head.match(/data:([^;]+)/) || [undefined, 'image/jpeg'])[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function urlToDataURL(url: string, maxW = 0): Promise<string> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const w = maxW ? Math.min(img.naturalWidth, maxW) : img.naturalWidth;
  const h = Math.round(img.naturalHeight * w / img.naturalWidth);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return cv.toDataURL('image/jpeg', 0.85);
}

export function fileToDataURL(file: File, W = 640, H = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = (ev) => {
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        cv.getContext('2d')!.drawImage(im, 0, 0, W, H);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      };
      im.onerror = reject;
      im.src = ev.target!.result as string;
    };
    r.readAsDataURL(file);
  });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
