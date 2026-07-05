// Smart City — TF.js inference engine (proven thinkCV pipeline:
// ZIP model loader, letterbox scale+pad 114, NMS)
import { CLASS_PALETTE } from './config.js';
import { classColor } from './util.js';

export const MODEL = { tf: null, inputSize: 640, classes: [], name: '', ready: false };
const listeners = [];
export const onModel = (fn) => listeners.push(fn);
const emit = () => listeners.forEach((fn) => { try { fn(MODEL); } catch (e) { console.error(e); } });

export function clsOf(i) {
  const name = MODEL.classes[i] || ('קטגוריה ' + (i + 1));
  return { name, color: classColor(name, CLASS_PALETTE) };
}

function parseYamlNames(y) {
  const m = y.match(/names:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

export async function loadModelFromZip(fileOrBlob, name = 'model') {
  const zip = await JSZip.loadAsync(fileOrBlob);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const fileMap = {};
  for (const n of names) {
    const base = n.split('/').pop();
    fileMap[base] = URL.createObjectURL(await zip.files[n].async('blob'));
  }
  const modelJsonName = names.find((n) => n.endsWith('model.json'));
  if (!modelJsonName) throw new Error('לא נמצא model.json ב-ZIP');
  const modelArtifacts = JSON.parse(await zip.files[modelJsonName].async('text'));

  // classes: metadata.yaml / data.yaml / classes.txt if bundled
  let classes = [];
  const yamlName = names.find((n) => /(?:^|\/)(metadata|data)\.ya?ml$/i.test(n));
  if (yamlName) classes = parseYamlNames(await zip.files[yamlName].async('text'));
  const clsTxt = names.find((n) => n.endsWith('classes.txt'));
  if (!classes.length && clsTxt) {
    classes = (await zip.files[clsTxt].async('text')).split('\n').map((s) => s.trim()).filter(Boolean);
  }

  MODEL.tf = await tf.loadGraphModel(makeLoader(modelArtifacts, fileMap));
  const inShape = MODEL.tf.inputs[0].shape;
  MODEL.inputSize = inShape[1] === 3 ? inShape[2] : inShape[1];
  MODEL.classes = classes;
  MODEL.name = name;
  MODEL.ready = true;
  emit();
  return MODEL;
}

function makeLoader(modelArtifacts, fileMap) {
  return {
    load: async () => {
      const weightSpecs = [], weightUrls = [];
      for (const group of modelArtifacts.weightsManifest) {
        for (const w of group.weights) weightSpecs.push(w);
        for (const path of group.paths) weightUrls.push(fileMap[path.split('/').pop()]);
      }
      const buffers = await Promise.all(weightUrls.map((u) => fetch(u).then((r) => r.arrayBuffer())));
      const total = buffers.reduce((s, b) => s + b.byteLength, 0);
      const weightData = new Uint8Array(total);
      let off = 0;
      buffers.forEach((b) => { weightData.set(new Uint8Array(b), off); off += b.byteLength; });
      return {
        modelTopology: modelArtifacts.modelTopology,
        weightSpecs,
        weightData: weightData.buffer,
        format: modelArtifacts.format,
        generatedBy: modelArtifacts.generatedBy,
        convertedBy: modelArtifacts.convertedBy,
      };
    },
  };
}

export async function detectOnDataURL(dataURL, conf = 0.25) {
  if (!MODEL.tf) throw new Error('אין מודל טעון');
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataURL; });
  const S = MODEL.inputSize;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const scale = Math.min(S / iw, S / ih);
  const nw = Math.round(iw * scale), nh = Math.round(ih * scale);
  const padX = Math.floor((S - nw) / 2), padY = Math.floor((S - nh) / 2);
  const input = tf.tidy(() => {
    let t = tf.browser.fromPixels(img).toFloat();
    t = tf.image.resizeBilinear(t, [nh, nw]);
    t = t.pad([[padY, S - nh - padY], [padX, S - nw - padX], [0, 0]], 114);
    return t.div(255).expandDims(0);
  });
  let out = MODEL.tf.execute(input);
  if (Array.isArray(out)) out = out[0];
  const sq = out.squeeze();
  const chFirst = sq.shape[0] < sq.shape[1];
  const data = tf.tidy(() => (chFirst ? sq.transpose() : sq.clone()));
  const arr = await data.array();
  input.dispose(); out.dispose(); sq.dispose(); data.dispose();

  const nc = Math.max(0, (arr[0] ? arr[0].length : 4) - 4);
  const mapB = (cx, cy, w, h, bestC, best) => ({
    x: ((cx - w / 2) - padX) / scale / iw, y: ((cy - h / 2) - padY) / scale / ih,
    w: (w / scale) / iw, h: (h / scale) / ih, cls: bestC, score: best,
  });
  let boxes = []; let top = null;
  for (const row of arr) {
    const cx = row[0], cy = row[1], w = row[2], h = row[3];
    let best = 0, bestC = 0;
    for (let c = 0; c < nc; c++) { if (row[4 + c] > best) { best = row[4 + c]; bestC = c; } }
    if (!top || best > top.score) top = mapB(cx, cy, w, h, bestC, best);
    if (best >= conf) boxes.push(mapB(cx, cy, w, h, bestC, best));
  }
  boxes = nms(boxes, 0.45);
  return { boxes, top, lowGuess: boxes.length === 0 };
}

function nms(boxes, iouThr) {
  boxes.sort((a, b) => b.score - a.score);
  const keep = [];
  let rest = boxes;
  while (rest.length) {
    const b = rest.shift();
    keep.push(b);
    rest = rest.filter((o) => iou(b, o) < iouThr);
  }
  return keep;
}
function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}

export function drawDetections(cv, boxes) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  boxes.forEach((b) => {
    const cl = clsOf(b.cls);
    ctx.lineWidth = 2.5; ctx.strokeStyle = cl.color;
    ctx.shadowColor = cl.color; ctx.shadowBlur = 8;
    ctx.strokeRect(b.x * W, b.y * H, b.w * W, b.h * H);
    ctx.shadowBlur = 0;
    const lbl = `${cl.name} ${Math.round(b.score * 100)}%`;
    ctx.font = 'bold 12px Rubik,sans-serif';
    const tw = ctx.measureText(lbl).width + 8;
    ctx.fillStyle = cl.color; ctx.fillRect(b.x * W, b.y * H - 17, tw, 17);
    ctx.fillStyle = '#0f1419'; ctx.fillText(lbl, b.x * W + 4, b.y * H - 4);
  });
}

// crop a detection box from a dataURL (for map pins / board)
export async function cropDetection(dataURL, b, pad = 0.08) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataURL; });
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const x = Math.max(0, (b.x - pad * b.w) * iw), y = Math.max(0, (b.y - pad * b.h) * ih);
  const w = Math.min(iw - x, b.w * (1 + 2 * pad) * iw), h = Math.min(ih - y, b.h * (1 + 2 * pad) * ih);
  const cv = document.createElement('canvas');
  cv.width = Math.max(32, Math.round(w));
  cv.height = Math.max(32, Math.round(h));
  cv.getContext('2d').drawImage(img, x, y, w, h, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.82);
}
