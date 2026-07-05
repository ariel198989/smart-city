// Smart City — shared utilities
export const $ = (s) => document.querySelector(s);
export const $$ = (s) => [...document.querySelectorAll(s)];

export function toast(msg, info = false) {
  const t = $('#toast');
  t.textContent = (info ? 'ℹ️ ' : '⚠️ ') + msg;
  t.className = info ? 'info' : '';
  t.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.style.display = 'none'; }, 6000);
}

window.addEventListener('error', (e) => toast('שגיאה: ' + (e.message || 'לא ידועה')));
window.addEventListener('unhandledrejection', (e) => toast('שגיאה: ' + ((e.reason && e.reason.message) || e.reason || 'לא ידועה')));

// safe localStorage (private mode / data: URLs throw)
const _mem = {};
export const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return k in _mem ? _mem[k] : null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { _mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch { delete _mem[k]; } },
};

export function wireDrop(zoneId, onFiles) {
  const z = document.getElementById(zoneId);
  if (!z) return;
  ['dragenter', 'dragover'].forEach((ev) => z.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); z.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => z.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); z.classList.remove('over');
  }));
  z.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length) onFiles(files);
  });
}

export const fmtWhen = (iso) => new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function classColor(name, palette) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export function dataURLtoBlob(dataURL) {
  const [head, b64] = dataURL.split(',');
  const mime = (head.match(/data:([^;]+)/) || [, 'image/jpeg'])[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
