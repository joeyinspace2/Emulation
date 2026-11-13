'use strict';
/* ---------- tiny DOM + storage helpers ---------- */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const k in props || {}) {
    const v = props[k];
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function toast(msg, kind) { const t = el('div', { class: 'toast ' + (kind || ''), text: msg }); $('#toasts').append(t); setTimeout(() => t.classList.add('out'), kind === 'err' ? 6500 : 2600); setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3100); }

const idb = {
  open() { return this.p || (this.p = new Promise((res, rej) => { const r = indexedDB.open('emulsion', 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('thumbs'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
  async get(store, key) { try { const db = await this.open(); return await new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch (e) { return undefined; } },
  async set(store, key, val) { try { const db = await this.open(); await new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (e) { /* storage unavailable: carry on without persistence */ } },
  async del(store, key) { try { const db = await this.open(); db.transaction(store, 'readwrite').objectStore(store).delete(key); } catch (e) { } }
};

/* ---------- file types ---------- */
const RAW_EXT = new Set('cr2 cr3 crw nef nrw arw srf sr2 raf orf rw2 dng pef srw x3f erf kdc dcr mrw 3fr iiq mef mos raw rwl fff'.split(' '));
const IMG_EXT = new Set('jpg jpeg jfif png webp avif gif bmp'.split(' '));
const extOf = n => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
const kindOf = n => RAW_EXT.has(extOf(n)) ? 'raw' : IMG_EXT.has(extOf(n)) ? 'img' : null;

/* ---------- raw decoding (LibRaw compiled to WebAssembly, run in a worker built from inline data) ---------- */
const rawDecoder = {
  worker: null, n: 0, pend: new Map(), tail: Promise.resolve(),
  start() {
    if (this.worker) return;
    const blob = new Blob(['self.__b64="', $('#libraw-wasm').textContent.trim(), '";\n', $('#libraw-worker').textContent], { type: 'text/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob), { type: 'module' });
    this.worker.onmessage = ({ data }) => { const p = this.pend.get(data && data.id); if (!p) return; this.pend.delete(data.id); data.error ? p.rej(new Error(data.error)) : p.res(data.out); };
    this.worker.onerror = e => { this.reset(new Error('Raw decoder crashed: ' + (e.message || 'unknown error'))); };
  },
  reset(err) { if (this.worker) this.worker.terminate(); this.worker = null; for (const p of this.pend.values()) p.rej(err); this.pend.clear(); },
  call(fn, ...args) { this.start(); return new Promise((res, rej) => { const id = this.n++; this.pend.set(id, { res, rej }); this.worker.postMessage({ id, fn, args }, args.filter(a => ArrayBuffer.isView(a)).map(a => a.buffer)); }); },
  queue(job) { const p = this.tail.then(job, job); this.tail = p.catch(() => { }); return p; },
  decode(u8) {
    return this.queue(async () => {
      await this.call('open', u8, { outputBps: 16, noAutoBright: true, useCameraWb: true, gamm: [1, 1], outputColor: 1, userQual: 3, highlight: 0 });
      const meta = await this.call('metadata', false).catch(() => ({}));
      const img = await this.call('imageData');
      if (!img || !img.data) throw new Error('LibRaw could not decode this file.');
      return { meta, img };
    });
  },
  thumb(u8) { return this.queue(async () => { await this.call('open', u8, {}); return await this.call('thumbnailData'); }); }
};

/* Find the largest baseline/progressive JPEG embedded in a raw file (the camera's own preview). */
function jpegDims(u8, off) {
  let p = off + 2; const n = u8.length;
  for (let k = 0; k < 80 && p + 9 < n; k++) {
    if (u8[p] !== 0xFF) return null; const m = u8[p + 1];
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
    const len = (u8[p + 2] << 8) | u8[p + 3]; if (len < 2) return null;
    if (m >= 0xC0 && m <= 0xC2) return { h: (u8[p + 5] << 8) | u8[p + 6], w: (u8[p + 7] << 8) | u8[p + 8] };
    if (m === 0xC3 || m === 0xDA) return null; // lossless JPEG is sensor data, not a preview
    p += 2 + len;
  }
  return null;
}
function findEmbeddedJpeg(u8) {
  let best = null; const n = u8.length - 4;
  for (let i = 0; i < n; i++) if (u8[i] === 0xFF && u8[i + 1] === 0xD8 && u8[i + 2] === 0xFF) { const d = jpegDims(u8, i); if (d && d.w >= 160 && (!best || d.w * d.h > best.w * best.h)) best = { off: i, w: d.w, h: d.h }; }
  return best;
}
/* EXIF orientation from a TIFF-structured raw (or the CMT1 box of a CR3) */
function tiffOrientation(u8) {
  let base = 0;
  if (!((u8[0] === 0x49 && u8[1] === 0x49) || (u8[0] === 0x4D && u8[1] === 0x4D))) {
    base = -1; const lim = Math.min(u8.length - 16, 1 << 17);
    for (let i = 0; i < lim; i++) if (u8[i] === 0x43 && u8[i + 1] === 0x4D && u8[i + 2] === 0x54 && u8[i + 3] === 0x31) { base = i + 4; break; }
    if (base < 0) return 1;
  }
  const le = u8[base] === 0x49, r16 = o => le ? u8[o] | (u8[o + 1] << 8) : (u8[o] << 8) | u8[o + 1], r32 = o => le ? (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0 : ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
  const ifd = base + r32(base + 4); if (ifd + 2 > u8.length) return 1;
  const n = r16(ifd);
  for (let i = 0; i < n && ifd + 14 + i * 12 <= u8.length; i++) { const e = ifd + 2 + i * 12; if (r16(e) === 0x0112) return r16(e + 8) || 1; }
  return 1;
}
async function orientBitmap(bmp, orientation) {
  const rot = orientation === 6 ? 1 : orientation === 8 ? 3 : orientation === 3 ? 2 : 0;
  if (!rot || (rot !== 2 && bmp.height > bmp.width)) return bmp; // already upright
  const w = rot === 2 ? bmp.width : bmp.height, h = rot === 2 ? bmp.height : bmp.width, c = new OffscreenCanvas(w, h), x = c.getContext('2d');
  x.translate(w / 2, h / 2); x.rotate(rot * Math.PI / 2); x.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  return await createImageBitmap(c);
}
async function embeddedPreview(u8) {
  const j = findEmbeddedJpeg(u8); if (!j) return null;
  try { return await orientBitmap(await createImageBitmap(new Blob([u8.subarray(j.off)], { type: 'image/jpeg' })), tiffOrientation(u8)); } catch (e) { return null; }
}
async function limitBitmap(bmp, max) {
  const long = Math.max(bmp.width, bmp.height); if (long <= max) return bmp;
  const s = max / long; return await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * s), resizeHeight: Math.round(bmp.height * s), resizeQuality: 'high' });
}
/* mean log-luminance of a bitmap (linear light), used to match raw brightness to the camera preview */
function bitmapLogMean(bmp) {
  const c = new OffscreenCanvas(64, 64), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data; let s = 0;
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  for (let i = 0; i < d.length; i += 4) s += Math.log(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]) + 0.004);
  return s / (d.length / 4);
}
function rawGain(data, w, h, previewLogMean) {
  const step = Math.max(1, Math.floor(Math.sqrt(w * h / 40000))); let s = 0, n = 0; const ls = [];
  const lin = v => { v /= 65535; return v < 0.081 ? v / 4.5 : Math.pow((v + 0.099) / 1.099, 1 / 0.45); }; // undo LibRaw's BT.709 encoding
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) { const i = (y * w + x) * 3, l = 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]); s += Math.log(l + 0.004); ls.push(l); n++; }
  if (previewLogMean != null) return clamp(Math.exp(previewLogMean - s / n) * 0.95, 0.5, 12);
  ls.sort((a, b) => a - b); return clamp(0.8 / Math.max(1e-4, ls[Math.floor(n * 0.99)]), 1, 6);
}

/* ---------- loading full-resolution sources ---------- */
async function loadSourceSpec(photo, maxTex) {
  const file = await photo.getFile();
  if (photo.kind !== 'raw') return { kind: 'img', bitmap: await limitBitmap(await createImageBitmap(file), maxTex), meta: null };
  const u8 = new Uint8Array(await file.arrayBuffer());
  const prev = await embeddedPreview(u8); const plm = prev ? bitmapLogMean(prev) : null; if (prev) prev.close();
  const { meta, img } = await rawDecoder.decode(u8);
  if (img.colors && img.colors !== 3) throw new Error('Unsupported raw colour layout.');
  return { kind: 'raw', data: img.data, w: img.width, h: img.height, gain: rawGain(img.data, img.width, img.height, plm), meta };
}
async function loadPreviewBitmap(photo) {
  const file = await photo.getFile();
  if (photo.kind !== 'raw') return null;
  return await embeddedPreview(new Uint8Array(await file.arrayBuffer()));
}

/* ---------- thumbnails ---------- */
async function bitmapToJpeg(bmp, max, q) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, h);
  return await c.convertToBlob({ type: 'image/jpeg', quality: q || 0.82 });
}
async function makeBaseThumb(photo) {
  const file = await photo.getFile(); let bmp = null;
  if (photo.kind === 'raw') {
    const u8 = new Uint8Array(await file.arrayBuffer());
    bmp = await embeddedPreview(u8);
    if (!bmp) { const t = await rawDecoder.thumb(u8).catch(() => null); if (t && t.data && (t.format === 'jpeg' || t.format === 1)) bmp = await createImageBitmap(new Blob([t.data], { type: 'image/jpeg' })).catch(() => null); }
    if (!bmp) return null;
  } else bmp = await createImageBitmap(file);
  const blob = await bitmapToJpeg(bmp, 480); bmp.close(); return blob;
}
const thumbQueue = {
  q: [], active: 0, max: 3,
  add(job) { return new Promise((res, rej) => { this.q.push({ job, res, rej }); this.pump(); }); },
  pump() { while (this.active < this.max && this.q.length) { const t = this.q.pop(); this.active++; t.job().then(t.res, t.rej).finally(() => { this.active--; this.pump(); }); } }
};

/* ---------- reading folders ---------- */
async function scanDirectory(dir, prefix, out, onProgress) {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (h.kind === 'directory') { if (name !== EXPORT_DIR) await scanDirectory(h, prefix + name + '/', out, onProgress); continue; }
    const kind = kindOf(name); if (!kind) continue;
    out.push({ id: prefix + name, name, folder: prefix.replace(/\/$/, ''), kind, getFile: () => h.getFile() });
    if (onProgress && out.length % 50 === 0) onProgress(out.length);
  }
  return out;
}
const EXPORT_DIR = 'Emulsion Exports', CATALOG_FILE = 'Emulsion Catalog.json';
function photosFromFiles(files) {
  const out = [];
  for (const f of files) { const kind = kindOf(f.name); if (!kind) continue; const rel = f.webkitRelativePath || f.name, parts = rel.split('/'); out.push({ id: rel, name: f.name, folder: parts.slice(0, -1).join('/'), kind, getFile: async () => f }); }
  return out;
}
async function writeFile(dirHandle, name, blob) { const fh = await dirHandle.getFileHandle(name, { create: true }), w = await fh.createWritable(); await w.write(blob); await w.close(); }
function downloadBlob(blob, name) { const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }
