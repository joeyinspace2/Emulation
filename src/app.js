'use strict';
/* ---------- state ---------- */
const BRUSH_DEF = { size: 90, feather: 60, flow: 60, erase: false, spot: 2.5, spotFeather: 40 };
const PROXY = 2048, CROP_DY = 36; // long edge used for interactive rendering when zoomed out
const st = {
  photos: [], list: [], cur: null, S: newSettings(), module: 'library', tool: 'none', sel: new Set(), anchor: null,
  view: { fit: true, zoom: 1, cx: 0, cy: 0 }, compare: 0, split: 0.5, clip: false, overlay: true,
  lib: null, filter: { q: '', rating: 0, flag: 'all', kind: 'all', edited: 'all', folder: null }, sort: 'name',
  clipboard: null, presets: [], luts: {}, selMask: -1, selSpot: -1, pendingMask: null, cropView: null, cropBase: null,
  loadToken: 0, srcFull: false, brush: clone(BRUSH_DEF), geo: null, zoomNow: 1, fitZoom: 1
};
let engine, glc, ov, octx, stage, rafPending = false, histT = 0, drag = null, hover = null, spaceDown = false;
const maskRT = new Map();

/* ---------- rendering ---------- */
function renderOpts(S, o) { o = o || {}; o.film = STOCK_BY_ID[S.film] || FILM_NONE; o.lut = S.lut ? st.luts[S.lut] : null; return o; }
function requestRender() { if (rafPending) return; rafPending = true; requestAnimationFrame(frame); }
function frame() {
  rafPending = false;
  if (st.module !== 'develop' || !engine || !engine.src || !st.cur) return;
  const dpr = window.devicePixelRatio || 1, vw = stage.clientWidth, vh = stage.clientHeight; if (vw < 4 || vh < 4) return;
  const cw = Math.round(vw * dpr), ch = Math.round(vh * dpr);
  if (glc.width !== cw || glc.height !== ch) { glc.width = cw; glc.height = ch; ov.width = cw; ov.height = ch; }
  const S = st.S, crop = st.tool === 'crop', g = st.geo = geoInfo(S, engine.src.w, engine.src.h, crop), v = st.view;
  let Vc;
  if (crop) {
    if (!st.cropView) fitCropView(); const c = st.cropView;
    Vc = M3.chain(M3.sc(1 / g.ow, 1 / g.oh), M3.tr(c.C0[0], c.C0[1]), M3.rot(c.a), M3.sc(1 / c.zoom, 1 / c.zoom), M3.tr(-vw / 2, -(vh / 2 - CROP_DY))); st.zoomNow = c.zoom;
  } else {
    const fit = Math.min((vw - 40) / g.outW, (vh - 40) / g.outH); st.fitZoom = fit;
    if (v.fit) { v.zoom = fit; v.cx = g.outW / 2; v.cy = g.outH / 2; }
    Vc = M3.chain(M3.sc(1 / g.outW, 1 / g.outH), M3.tr(v.cx, v.cy), M3.sc(1 / v.zoom, 1 / v.zoom), M3.tr(-vw / 2, -vh / 2)); st.zoomNow = v.zoom;
  }
  st.Vc = Vc; st.VcInv = M3.inv(Vc);
  const proxy = Math.min(1, PROXY / Math.max(g.outW, g.outH)), scale = st.zoomNow * dpr > proxy * 1.2 ? 1 : proxy;
  try { engine.render(S, scale, renderOpts(S, { uncropped: crop, selMask: st.tool === 'mask' ? st.selMask : -1 })); st.renderErr = false; }
  catch (e) { if (!st.renderErr) { st.renderErr = true; toast(e.message, 'err'); console.error(e); } return; }
  engine.present(M3.mul(Vc, M3.sc(1 / dpr, 1 / dpr)), crop ? 0 : st.compare, st.split * cw, st.clip && !crop, st.tool === 'mask' && st.overlay && st.selMask >= 0);
  drawOverlay();
  if (!histT) histT = setTimeout(() => { histT = 0; if (engine.last) drawHistogram(engine.histogram()); }, 100);
  $('#zoomLabel').textContent = Math.round(st.zoomNow * dpr * 100) + '%';
}
const toOut = (x, y) => M3.ap(st.Vc, x, y);
const toSrc = (x, y) => { const o = toOut(x, y); return M3.ap(st.geo.M, o[0], o[1]); };
const srcToScr = (u, v) => { const o = M3.ap(st.geo.Minv, u, v); return M3.ap(st.VcInv, o[0], o[1]); };
function zoomAt(x, y, z) {
  const v = st.view, vw = stage.clientWidth, vh = stage.clientHeight; z = clamp(z, st.fitZoom * 0.5, 24);
  const ox = (x - vw / 2) / v.zoom + v.cx, oy = (y - vh / 2) / v.zoom + v.cy;
  v.zoom = z; v.cx = ox - (x - vw / 2) / z; v.cy = oy - (y - vh / 2) / z; v.fit = false; requestRender();
}

/* ---------- overlay: crop frame, mask handles, heal spots, brush cursor ---------- */
function drawOverlay() {
  if (!octx || !st.geo || !engine.src) return;
  const dpr = window.devicePixelRatio || 1, x = octx, vw = stage.clientWidth, vh = stage.clientHeight;
  x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, vw, vh);
  const handle = (p, sel) => { x.beginPath(); x.arc(p[0], p[1], 6, 0, 7); x.fillStyle = sel ? '#f0a53a' : '#fff'; x.fill(); x.lineWidth = 1.5; x.strokeStyle = 'rgba(0,0,0,.7)'; x.stroke(); };
  const line = (a, b, dash) => { x.setLineDash(dash || []); x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.45)'; x.stroke(); x.lineWidth = 1.25; x.strokeStyle = '#fff'; x.stroke(); x.setLineDash([]); };
  if (st.tool === 'crop' && st.cropView) {
    const R = cropRectScr(); x.fillStyle = 'rgba(8,8,9,.62)'; x.beginPath(); x.rect(0, 0, vw, vh); x.rect(R.l, R.t, R.r - R.l, R.b - R.t); x.fill('evenodd');
    x.strokeStyle = 'rgba(255,255,255,.28)'; x.lineWidth = 1; x.beginPath();
    for (let i = 1; i < 3; i++) { const px = R.l + (R.r - R.l) * i / 3, py = R.t + (R.b - R.t) * i / 3; x.moveTo(px, R.t); x.lineTo(px, R.b); x.moveTo(R.l, py); x.lineTo(R.r, py); } x.stroke();
    x.strokeStyle = '#fff'; x.lineWidth = 1.25; x.strokeRect(R.l, R.t, R.r - R.l, R.b - R.t);
    x.lineWidth = 3.5; x.beginPath(); const k = 18;
    for (const [cx, cy, sx, sy] of [[R.l, R.t, 1, 1], [R.r, R.t, -1, 1], [R.r, R.b, -1, -1], [R.l, R.b, 1, -1]]) { x.moveTo(cx + sx * k, cy); x.lineTo(cx, cy); x.lineTo(cx, cy + sy * k); } x.stroke();
    return;
  }
  if (st.tool === 'mask') {
    st.S.masks.forEach((m, i) => {
      const sel = i === st.selMask;
      if (m.type === 'linear') { const a = srcToScr(m.a[0], m.a[1]), b = srcToScr(m.a[2], m.a[3]); if (sel) { const d = [b[0] - a[0], b[1] - a[1]], n = [-d[1], d[0]], L = Math.hypot(n[0], n[1]) || 1, e = [n[0] / L * 2000, n[1] / L * 2000]; line([a[0] - e[0], a[1] - e[1]], [a[0] + e[0], a[1] + e[1]]); line([b[0] - e[0], b[1] - e[1]], [b[0] + e[0], b[1] + e[1]], [6, 5]); line(a, b, [2, 4]); handle(b, false); } handle(a, sel); }
      else if (m.type === 'radial') {
        const c = srcToScr(m.a[0], m.a[1]);
        if (sel) { x.beginPath(); for (let k = 0; k <= 72; k++) { const t = k / 72 * Math.PI * 2, p = srcToScr(m.a[0] + Math.cos(t) * m.a[2], m.a[1] + Math.sin(t) * m.a[3]); k ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); } x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.45)'; x.stroke(); x.lineWidth = 1.25; x.strokeStyle = '#fff'; x.stroke();
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) handle(srcToScr(m.a[0] + dx * m.a[2], m.a[1] + dy * m.a[3]), false); }
        handle(c, sel);
      }
    });
    const m = curMask();
    if (m && m.type === 'brush' && hover && !st.pendingMask) { x.beginPath(); x.arc(hover[0], hover[1], st.brush.size / 2, 0, 7); x.lineWidth = 2.5; x.strokeStyle = 'rgba(0,0,0,.5)'; x.stroke(); x.lineWidth = 1; x.strokeStyle = '#fff'; x.stroke(); x.beginPath(); x.arc(hover[0], hover[1], st.brush.size / 2 * (1 - st.brush.feather / 100), 0, 7); x.setLineDash([3, 3]); x.stroke(); x.setLineDash([]); }
  }
  if (st.tool === 'heal') {
    const long = Math.max(engine.src.w, engine.src.h);
    st.S.spots.forEach((s, i) => {
      const a = srcToScr(s.x, s.y), b = srcToScr(s.sx, s.sy), r = s.r * long * st.zoomNow, sel = i === st.selSpot;
      const ring = (p, dash) => { x.setLineDash(dash || []); x.beginPath(); x.arc(p[0], p[1], r, 0, 7); x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.45)'; x.stroke(); x.lineWidth = 1.25; x.strokeStyle = sel ? '#f0a53a' : '#fff'; x.stroke(); x.setLineDash([]); };
      ring(a); if (sel) { ring(b, [4, 4]); const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d; if (d > 2 * r) line([a[0] + ux * r, a[1] + uy * r], [b[0] - ux * r, b[1] - uy * r], [2, 4]); }
    });
    if (hover) { x.beginPath(); x.arc(hover[0], hover[1], st.brush.spot / 100 * long * st.zoomNow, 0, 7); x.lineWidth = 1; x.strokeStyle = 'rgba(255,255,255,.7)'; x.stroke(); }
  }
}

/* ---------- crop ---------- */
function orientedSize() { const r = st.S.rot90 & 1, s = engine.src; return r ? [s.h, s.w] : [s.w, s.h]; }
function fitCropView() { const S = st.S, [ow, oh] = orientedSize(), vw = stage.clientWidth, vh = stage.clientHeight; st.cropView = { C0: [S.crop.cx * ow, S.crop.cy * oh], a: S.angle * Math.PI / 180, zoom: Math.min((vw - 120) / (S.crop.w * ow), (vh - 190) / (S.crop.h * oh)) }; }
function cropRectScr() {
  const c = st.cropView, S = st.S, [ow, oh] = orientedSize(), vw = stage.clientWidth, vh = stage.clientHeight;
  const d = M3.ap(M3.rot(-c.a), S.crop.cx * ow - c.C0[0], S.crop.cy * oh - c.C0[1]), w = S.crop.w * ow * c.zoom, h = S.crop.h * oh * c.zoom, x = vw / 2 + d[0] * c.zoom, y = vh / 2 - CROP_DY + d[1] * c.zoom;
  return { l: x - w / 2, t: y - h / 2, r: x + w / 2, b: y + h / 2 };
}
function cropValid(c, ang, ow, oh) {
  const R = M3.rot(ang * Math.PI / 180), hw = c.w * ow / 2, hh = c.h * oh / 2;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const d = M3.ap(R, sx * hw, sy * hh), x = c.cx * ow + d[0], y = c.cy * oh + d[1]; if (x < -0.5 || y < -0.5 || x > ow + 0.5 || y > oh + 0.5) return false; }
  return c.w * ow >= 16 && c.h * oh >= 16;
}
function aspectRatio() { const a = st.S.aspect, [ow, oh] = orientedSize(); if (a === 'free') return null; if (a === 'original') return ow / oh; const m = a.split(':'); return (+m[0]) / (+m[1]); }
function cropDrag(p) {
  const R = cropRectScr(), m = 14; if (p[0] < R.l - m || p[0] > R.r + m || p[1] < R.t - m || p[1] > R.b + m) return null;
  const L = Math.abs(p[0] - R.l) < m, Rt = !L && Math.abs(p[0] - R.r) < m, T = Math.abs(p[1] - R.t) < m, B = !T && Math.abs(p[1] - R.b) < m, edge = L || Rt || T || B;
  const cv = st.cropView, [ow, oh] = orientedSize(), ratio = aspectRatio(), vw = stage.clientWidth, vh = stage.clientHeight;
  return {
    move(q) {
      const dx = q[0] - p[0], dy = q[1] - p[1], n = { l: R.l, t: R.t, r: R.r, b: R.b };
      if (!edge) { n.l += dx; n.r += dx; n.t += dy; n.b += dy; }
      else {
        if (L) n.l = Math.min(R.l + dx, R.r - 24); if (Rt) n.r = Math.max(R.r + dx, R.l + 24); if (T) n.t = Math.min(R.t + dy, R.b - 24); if (B) n.b = Math.max(R.b + dy, R.t + 24);
        if (ratio) {
          let w = n.r - n.l, h = n.b - n.t; const hz = L || Rt, vt = T || B;
          if (hz && !vt) { h = w / ratio; const cy = (R.t + R.b) / 2; n.t = cy - h / 2; n.b = cy + h / 2; }
          else if (vt && !hz) { w = h * ratio; const cx = (R.l + R.r) / 2; n.l = cx - w / 2; n.r = cx + w / 2; }
          else { if (w / h > ratio) w = h * ratio; else h = w / ratio; if (L) n.l = n.r - w; else n.r = n.l + w; if (T) n.t = n.b - h; else n.b = n.t + h; }
        }
      }
      const d = M3.ap(M3.rot(cv.a), ((n.l + n.r) / 2 - vw / 2) / cv.zoom, ((n.t + n.b) / 2 - (vh / 2 - CROP_DY)) / cv.zoom);
      const c = { cx: (cv.C0[0] + d[0]) / ow, cy: (cv.C0[1] + d[1]) / oh, w: (n.r - n.l) / cv.zoom / ow, h: (n.b - n.t) / cv.zoom / oh };
      if (cropValid(c, st.S.angle, ow, oh)) { st.S.crop = c; drawOverlay(); }
    },
    up() { fitCropView(); requestRender(); commit('Crop'); }
  };
}
function constrainCrop() {
  const S = st.S, [ow, oh] = orientedSize(), b = st.cropBase || (st.cropBase = clone(S.crop)), mk = s => ({ cx: b.cx, cy: b.cy, w: b.w * s, h: b.h * s });
  if (cropValid(mk(1), S.angle, ow, oh)) { S.crop = mk(1); return; }
  let lo = 0.02, hi = 1; for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; cropValid(mk(m), S.angle, ow, oh) ? lo = m : hi = m; } S.crop = mk(lo);
}
function setAspect(a) {
  if (!st.cur) return; const S = st.S; S.aspect = a; const r = aspectRatio(), [ow, oh] = orientedSize();
  if (r) { let w = S.crop.w * ow, h = S.crop.h * oh; if (w / h > r) w = h * r; else h = w / r; S.crop.w = w / ow; S.crop.h = h / oh; }
  st.cropView = null; requestRender(); commit('Aspect ' + a); syncUI();
}
function rotate90(dir) {
  if (!st.cur) return; const S = st.S, k = (S.flipH !== S.flipV) ? -dir : dir, c = S.crop; S.rot90 = (S.rot90 + k + 4) % 4;
  S.crop = dir > 0 ? { cx: 1 - c.cy, cy: c.cx, w: c.h, h: c.w } : { cx: c.cy, cy: 1 - c.cx, w: c.h, h: c.w };
  if (/^\d/.test(S.aspect)) S.aspect = S.aspect.split(':').reverse().join(':');
  st.cropView = null; requestRender(); commit(dir > 0 ? 'Rotate right' : 'Rotate left'); syncUI();
}
function flip(h) { if (!st.cur) return; const S = st.S; if (h) { S.flipH = !S.flipH; S.crop.cx = 1 - S.crop.cx; } else { S.flipV = !S.flipV; S.crop.cy = 1 - S.crop.cy; } S.angle = -S.angle; st.cropView = null; requestRender(); commit(h ? 'Flip horizontal' : 'Flip vertical'); syncUI(); }
function resetCrop() { if (!st.cur) return; const S = st.S; S.crop = clone(DEF.crop); S.angle = 0; S.aspect = 'free'; st.cropView = null; requestRender(); commit('Reset crop'); syncUI(); }

/* ---------- healing ---------- */
function healDrag(p) {
  const S = st.S, src = engine.src, long = Math.max(src.w, src.h), [u, v] = toSrc(p[0], p[1]); let hit = -1, part = '';
  S.spots.forEach((s, i) => { const a = srcToScr(s.x, s.y), b = srcToScr(s.sx, s.sy), r = s.r * long * st.zoomNow + 4; if (Math.hypot(p[0] - a[0], p[1] - a[1]) < r) { hit = i; part = 'd'; } else if (i === st.selSpot && Math.hypot(p[0] - b[0], p[1] - b[1]) < r) { hit = i; part = 's'; } });
  if (hit < 0) {
    if (u < 0 || v < 0 || u > 1 || v > 1) return null;
    if (S.spots.length >= 16) { toast('A photo can have up to 16 heal spots.'); return null; }
    const r = st.brush.spot / 100; let off = 2.4 * r * long / src.w; if (u + off > 0.98) off = -off;
    S.spots.push({ x: u, y: v, r, f: st.brush.spotFeather / 100, sx: u + off, sy: v, o: 1 }); hit = S.spots.length - 1; part = 'new';
  }
  st.selSpot = hit; const s = S.spots[hit], s0 = Object.assign({}, s); requestRender();
  return {
    move(q) {
      const [a, b] = toSrc(q[0], q[1]), du = a - u, dv = b - v;
      if (part === 'd') { s.x = s0.x + du; s.y = s0.y + dv; s.sx = s0.sx + du; s.sy = s0.sy + dv; }
      else if (part === 's') { s.sx = s0.sx + du; s.sy = s0.sy + dv; }
      else if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 6) { s.sx = a; s.sy = b; }
      requestRender();
    },
    up() { commit(part === 'new' ? 'Heal spot' : 'Move heal spot'); }
  };
}

/* ---------- masks ---------- */
function ensureMaskRT(m) {
  let rt = maskRT.get(m.id); if (rt) return rt; const s = engine.src; if (!s) return null;
  const k = 1024 / Math.max(s.w, s.h), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(s.w * k)); c.height = Math.max(1, Math.round(s.h * k));
  rt = { canvas: c, ctx: c.getContext('2d'), ref: null }; maskRT.set(m.id, rt); engine.updateMask(m.id, c); return rt;
}
function syncMaskRT() {
  const ids = new Set();
  for (const m of st.S.masks) {
    if (m.type !== 'brush') continue; ids.add(m.id); const rt = ensureMaskRT(m); if (!rt || rt.ref === (m.data || null)) continue;
    const d = rt.ref = m.data || null; rt.ctx.globalCompositeOperation = 'source-over'; rt.ctx.clearRect(0, 0, rt.canvas.width, rt.canvas.height); engine.updateMask(m.id, rt.canvas);
    if (d) { const img = new Image(); img.onload = () => { if (rt.ref !== d) return; rt.ctx.globalCompositeOperation = 'source-over'; rt.ctx.clearRect(0, 0, rt.canvas.width, rt.canvas.height); rt.ctx.drawImage(img, 0, 0, rt.canvas.width, rt.canvas.height); engine.updateMask(m.id, rt.canvas); requestRender(); }; img.src = d; }
  }
  for (const id of [...maskRT.keys()]) if (!ids.has(id)) { maskRT.delete(id); engine.dropMask(id); }
}
async function prepMasks(S) { // load brush masks for a photo that is not the one on screen
  const made = [];
  for (const m of (S.masks || [])) { if (m.type !== 'brush' || engine.maskTex.has(m.id) || !m.data) continue; const img = new Image(); img.src = m.data; try { await img.decode(); } catch (e) { continue; } const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); engine.updateMask(m.id, c); made.push(m.id); }
  return () => made.forEach(id => engine.dropMask(id));
}
function addMask(type) {
  if (!st.cur || !engine.src) return; if (st.S.masks.length >= 6) return toast('A photo can have up to 6 masks.');
  setTool('mask'); showTab('local'); st.overlay = true;
  if (type === 'brush') { const m = { id: 'm' + Date.now().toString(36), type, a: [0, 0, 0, 0], feather: 50, invert: false, amount: 100, adj: clone(MASK_ADJ), data: null }; st.S.masks.push(m); st.selMask = st.S.masks.length - 1; st.pendingMask = null; ensureMaskRT(m); commit('Add brush mask'); }
  else st.pendingMask = type;
  syncUI(); requestRender();
}
function deleteMask(i) { if (i < 0 || !st.S.masks[i]) return; st.S.masks.splice(i, 1); st.selMask = Math.min(st.selMask, st.S.masks.length - 1); syncMaskRT(); requestRender(); commit('Delete mask'); syncUI(); }
function dab(rt, x, y, r, hard, flow, erase) {
  const c = rt.ctx; c.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  const g = c.createRadialGradient(x, y, Math.min(r * hard, r * 0.98), x, y, r); g.addColorStop(0, 'rgba(255,255,255,' + flow + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
}
function maskDrag(p, e) {
  const S = st.S, [u, v] = toSrc(p[0], p[1]);
  if (st.pendingMask) {
    const type = st.pendingMask, m = { id: 'm' + Date.now().toString(36), type, a: type === 'linear' ? [u, v, u, v] : [u, v, 0.004, 0.004], feather: 50, invert: false, amount: 100, adj: clone(MASK_ADJ), data: null };
    S.masks.push(m); st.selMask = S.masks.length - 1; st.pendingMask = null; syncUI();
    return {
      move(q) { const [a, b] = toSrc(q[0], q[1]); if (type === 'linear') { m.a[2] = a; m.a[3] = b; } else { m.a[2] = Math.max(0.004, Math.abs(a - u)); m.a[3] = Math.max(0.004, Math.abs(b - v)); } requestRender(); },
      up() { if (type === 'linear' && Math.hypot(m.a[2] - m.a[0], m.a[3] - m.a[1]) < 0.01) m.a[3] = m.a[1] + 0.25; if (type === 'radial' && m.a[2] < 0.01) { m.a[2] = 0.2; m.a[3] = 0.2 * engine.src.w / engine.src.h; } requestRender(); commit('Add ' + type + ' gradient'); syncUI(); }
    };
  }
  const near = (x, y) => { const s = srcToScr(x, y); return Math.hypot(p[0] - s[0], p[1] - s[1]) < 13; };
  // click another mask's pin to select it
  const m = curMask();
  if (m && m.type === 'brush') return brushDrag(m, p, e);
  if (m && m.type === 'linear') {
    const w = near(m.a[0], m.a[1]) ? 0 : near(m.a[2], m.a[3]) ? 2 : -1;
    if (w >= 0) return { move(q) { const [a, b] = toSrc(q[0], q[1]); m.a[w] = a; m.a[w + 1] = b; requestRender(); }, up() { commit('Move gradient'); } };
  }
  if (m && m.type === 'radial') {
    const a0 = m.a.slice();
    if (near(m.a[0], m.a[1])) return { move(q) { const [a, b] = toSrc(q[0], q[1]); m.a[0] = a0[0] + a - u; m.a[1] = a0[1] + b - v; requestRender(); }, up() { commit('Move gradient'); } };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (near(m.a[0] + dx * m.a[2], m.a[1] + dy * m.a[3])) return { move(q) { const [a, b] = toSrc(q[0], q[1]); if (dx) m.a[2] = Math.max(0.004, Math.abs(a - m.a[0])); else m.a[3] = Math.max(0.004, Math.abs(b - m.a[1])); requestRender(); }, up() { commit('Resize gradient'); } };
  }
  for (let i = 0; i < S.masks.length; i++) { const o = S.masks[i]; if (o.type !== 'brush' && i !== st.selMask && near(o.a[0], o.a[1])) { st.selMask = i; syncUI(); requestRender(); return {}; } }
  return null;
}
function brushDrag(m, p, e) {
  const rt = ensureMaskRT(m); if (!rt) return null; let last = null; const erase = st.brush.erase || e.altKey;
  const paint = q => {
    const [u, v] = toSrc(q[0], q[1]), x = u * rt.canvas.width, y = v * rt.canvas.height;
    const r = Math.max(1, st.brush.size / 2 / st.zoomNow * (rt.canvas.width / engine.src.w)), hard = 1 - st.brush.feather / 100, flow = st.brush.flow / 100, step = Math.max(1, r * 0.25);
    if (last) { const d = Math.hypot(x - last[0], y - last[1]), n = Math.floor(d / step); if (n < 1) return; for (let i = 1; i <= n; i++) dab(rt, last[0] + (x - last[0]) * i / n, last[1] + (y - last[1]) * i / n, r, hard, flow * 0.5, erase); }
    else dab(rt, x, y, r, hard, flow, erase);
    last = [x, y]; engine.updateMask(m.id, rt.canvas); requestRender();
  };
  paint(p);
  return { move: paint, up() { m.data = rt.canvas.toDataURL('image/webp', 0.9); rt.ref = m.data; commit(erase ? 'Erase mask' : 'Paint mask'); } };
}

/* ---------- white balance picker, auto tone ---------- */
function pickWB(p) {
  const [u, v] = toOut(p[0], p[1]); if (u < 0 || v < 0 || u > 1 || v > 1) return; const c = engine.sampleG(u, v);
  if (!c || c[0] <= 1e-4 || c[1] <= 1e-4 || c[2] <= 1e-4) return toast('That spot is too dark to measure.');
  st.S.temp = clamp(Math.round(0.5 * Math.log2(c[2] / c[0]) / 0.5 * 100), -100, 100); st.S.tint = clamp(Math.round(Math.log2(c[1] / Math.sqrt(c[0] * c[2])) / 0.35 * 100), -100, 100);
  setTool('none'); requestRender(); commit('White balance'); syncUI();
}
function autoTone() {
  if (!st.cur || !engine.last) return; const l = engine.statsG(), n = l.length, q = f => l[Math.floor(clamp(f, 0, 0.9999) * n)], S = st.S, base = engine.src.base ? 1.15 : 1;
  const ev = clamp(Math.log2(0.19 / Math.max(1e-4, q(0.5) * base)) * 0.7, -2.5, 2.5), k = Math.pow(2, ev) * base, e = x => Math.pow(clamp(x, 0, 4), 1 / 2.2);
  S.exposure = +ev.toFixed(2); const hi = e(q(0.995) * k), lo = e(q(0.005) * k), sh = e(q(0.12) * k);
  S.highlights = hi > 0.97 ? -Math.round(clamp((hi - 0.97) * 160 + 15, 0, 80)) : 0; S.whites = hi < 0.9 ? Math.round(clamp((0.92 - hi) * 160, 0, 45)) : 0;
  S.shadows = Math.round(clamp((0.3 - sh) * 180, 0, 50)); S.blacks = Math.round(clamp((0.035 - lo) * 400, -30, 12)); S.contrast = 8; S.vibrance = Math.max(S.vibrance, 10);
  requestRender(); commit('Auto tone'); syncUI();
}

/* ---------- pointer handling on the stage ---------- */
function setTool(t) {
  if (st.tool === 'crop' && t !== 'crop') { st.cropView = null; st.cropBase = null; }
  if (t !== 'mask') st.pendingMask = null;
  st.tool = t; document.body.dataset.tool = t; if (t === 'crop') { st.cropView = null; st.compare = 0; }
  if (t === 'mask' || t === 'heal') showTab('local');
  $$('#toolbar [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  ov.style.cursor = t === 'wb' ? 'crosshair' : t === 'heal' ? 'none' : t === 'mask' ? 'crosshair' : t === 'crop' ? 'default' : 'grab';
  syncUI(); requestRender();
}
function panDrag(p) { if (st.tool === 'crop') return null; const v = st.view, s = { cx: v.cx, cy: v.cy }; return { move(q) { if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 3 && v.fit) return; v.fit = false; v.cx = s.cx - (q[0] - p[0]) / v.zoom; v.cy = s.cy - (q[1] - p[1]) / v.zoom; requestRender(); } }; }
function beginDrag(p, e) {
  const t = st.tool;
  if (e.button === 1 || spaceDown) return panDrag(p);
  if (st.compare === 2 && t !== 'crop' && Math.abs(p[0] - st.split * stage.clientWidth) < 10) return { move(q) { st.split = clamp(q[0] / stage.clientWidth, 0.02, 0.98); requestRender(); } };
  if (t === 'crop') return cropDrag(p);
  if (t === 'wb') return { up(q) { pickWB(q); } };
  if (t === 'heal') return healDrag(p);
  if (t === 'mask') return maskDrag(p, e) || panDrag(p);
  return panDrag(p);
}
function bindStage() {
  const pt = e => { const r = ov.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  ov.addEventListener('pointerdown', e => { if (!engine.src || !st.geo || e.button === 2) return; ov.setPointerCapture(e.pointerId); drag = beginDrag(pt(e), e); });
  ov.addEventListener('pointermove', e => { hover = pt(e); if (drag) { if (drag.move) drag.move(hover, e); } else if (st.tool === 'mask' || st.tool === 'heal') drawOverlay(); });
  const end = e => { if (drag) { const d = drag; drag = null; if (d.up) d.up(pt(e), e); } };
  ov.addEventListener('pointerup', end); ov.addEventListener('pointercancel', end);
  ov.addEventListener('pointerleave', () => { hover = null; if (!drag) drawOverlay(); });
  ov.addEventListener('dblclick', e => { if (st.tool !== 'none' || !engine.src) return; const p = pt(e); if (st.view.fit) zoomAt(p[0], p[1], 1 / (window.devicePixelRatio || 1)); else { st.view.fit = true; requestRender(); } });
  stage.addEventListener('wheel', e => { e.preventDefault(); if (st.tool === 'crop' || !engine.src || !st.geo) return; const r = stage.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, st.view.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0025))); }, { passive: false });
  new ResizeObserver(() => { if (st.tool === 'crop') st.cropView = null; requestRender(); }).observe(stage);
}

/* ---------- history ---------- */
function touchPhoto(p) { const d = p.settings && diffSettings(p.settings); if (!d) { p.sig = ''; return; } const s = JSON.stringify(d); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; p.sig = s.length + ':' + h; }
function commit(label) {
  const p = st.cur; if (!p) return; const j = JSON.stringify(st.S);
  if (p.hist[p.hi] && p.hist[p.hi].j === j) return;
  p.hist.length = p.hi + 1; p.hist.push({ label, j }); if (p.hist.length > 120) p.hist.shift(); p.hi = p.hist.length - 1;
  p.settings = st.S; p.edited = Date.now(); touchPhoto(p); saveCatalogSoon(); renderHistory(); thumbSoon(); updateCells(p);
}
function gotoHist(i) { const p = st.cur; if (!p || !p.hist[i]) return; p.hi = i; st.S = p.settings = JSON.parse(p.hist[i].j); p.edited = Date.now(); touchPhoto(p); afterReplace(); renderHistory(); }
function afterReplace() { st.selMask = Math.min(st.selMask, st.S.masks.length - 1); st.selSpot = -1; st.cropView = null; if (engine.src) syncMaskRT(); syncUI(); requestRender(); saveCatalogSoon(); thumbSoon(); if (st.cur) updateCells(st.cur); }
const undo = () => { const p = st.cur; if (p && p.hi > 0) gotoHist(p.hi - 1); }, redo = () => { const p = st.cur; if (p && p.hi < p.hist.length - 1) gotoHist(p.hi + 1); };
function resetAll() { if (!st.cur) return; st.S = st.cur.settings = newSettings(); commit('Reset all'); afterReplace(); }

/* ---------- opening a photo ---------- */
function setBusy(msg) { const b = $('#busy'); b.textContent = msg || ''; b.classList.toggle('hide', !msg); }
async function openPhoto(p) {
  showModule('develop');
  if (st.cur === p && engine.src) { requestRender(); return; }
  st.cur = p; p.loadError = null; st.S = p.settings ? p.settings : newSettings();
  if (!p.hist) { p.hist = [{ label: 'Opened', j: JSON.stringify(st.S) }]; p.hi = 0; }
  st.selMask = -1; st.selSpot = -1; st.view.fit = true; st.compare = 0; st.srcFull = false; setTool('none');
  engine.setSource(null); for (const id of [...maskRT.keys()]) { maskRT.delete(id); engine.dropMask(id); }
  octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, ov.width, ov.height); engine.gl.bindFramebuffer(engine.gl.FRAMEBUFFER, null); engine.gl.clearColor(0.075, 0.075, 0.08, 1); engine.gl.clear(engine.gl.COLOR_BUFFER_BIT);
  syncUI(); renderHistory(); renderInfo(); markCurrent();
  const token = ++st.loadToken; setBusy(p.kind === 'raw' ? 'Reading raw file…' : 'Loading…');
  const ready = () => { syncMaskRT(); renderInfo(); requestRender(); };
  try {
    if (p.kind === 'raw') {
      const prev = await loadPreviewBitmap(p); if (token !== st.loadToken) return;
      if (prev) { const b = await limitBitmap(prev, engine.maxTex); if (token !== st.loadToken) return; engine.setSource(engine.makeSource({ kind: 'img', bitmap: b })); b.close(); ready(); }
      setBusy('Developing raw… (camera preview shown)');
    }
    const spec = await loadSourceSpec(p, engine.maxTex);
    if (token !== st.loadToken) { if (spec.bitmap) spec.bitmap.close(); return; }
    engine.setSource(engine.makeSource(spec)); if (spec.bitmap) spec.bitmap.close(); p.meta = spec.meta; st.srcFull = true; ready(); setBusy(null);
  } catch (e) { if (token === st.loadToken) { p.loadError = e.message || String(e); setBusy(null); toast('Could not open ' + p.name + ': ' + p.loadError, 'err'); console.error(e); } }
}
function step(d) { if (!st.cur) return; const i = st.list.indexOf(st.cur), n = st.list[i + d]; if (n) openPhoto(n); }

/* ---------- library: catalog, grid, thumbnails ---------- */
function setSaveState(t) { $('#saveState').textContent = t; }
function catalogData() {
  const photos = {};
  for (const p of st.photos) { const d = p.settings ? diffSettings(p.settings) : null; if (d || p.rating || p.flag) photos[p.id] = { rating: p.rating || 0, flag: p.flag || 0, settings: d, edited: p.edited || 0 }; }
  return { app: 'Emulsion', version: 1, saved: new Date().toISOString(), photos };
}
async function saveCatalog() {
  if (!st.lib) return; const data = catalogData(); idb.set('kv', 'catalog:' + st.lib.key, data);
  if (st.lib.handle && st.lib.writable) {
    try { await writeFile(st.lib.handle, CATALOG_FILE, new Blob([JSON.stringify(data)], { type: 'application/json' })); setSaveState('Saved to ' + CATALOG_FILE); }
    catch (e) { st.lib.writable = false; setSaveState('Saved in this browser only'); toast('Could not write the catalog file into the folder. Edits are being kept in this browser instead.', 'err'); }
  } else setSaveState('Saved in this browser');
}
const saveCatalogSoon = debounce(saveCatalog, 900);
const photoKey = p => st.lib.key + '|' + p.id;
function setPhotos(photos, cat) {
  const c = (cat && cat.photos) || {};
  for (const p of photos) { const r = c[p.id]; p.rating = r ? r.rating || 0 : 0; p.flag = r ? r.flag || 0 : 0; p.settings = r && r.settings ? normalize(r.settings) : null; p.edited = r ? r.edited || 0 : 0; touchPhoto(p); }
  st.photos = photos; st.sel.clear(); st.cur = null; st.filter.folder = null; engine.setSource(null);
  document.body.dataset.empty = photos.length ? '0' : '1';
  $('#libName').textContent = st.lib ? st.lib.name : ''; renderFolders(); applyFilter(); showModule('library');
  setSaveState(st.lib && st.lib.handle && st.lib.writable ? 'Edits save to ' + CATALOG_FILE : 'Edits save in this browser');
}
async function openLibraryHandle(h, ask) {
  let writable = false;
  try { writable = (await h.queryPermission({ mode: 'readwrite' })) === 'granted' || (ask && (await h.requestPermission({ mode: 'readwrite' })) === 'granted'); } catch (e) { }
  if (!writable) { let ok = false; try { ok = (await h.queryPermission({ mode: 'read' })) === 'granted' || (await h.requestPermission({ mode: 'read' })) === 'granted'; } catch (e) { } if (!ok) return toast('Permission to read that folder was not granted.', 'err'); }
  st.lib = { name: h.name, key: 'dir:' + h.name, handle: h, writable };
  $('#welcomeMsg').textContent = 'Scanning ' + h.name + '…';
  let photos; try { photos = await scanDirectory(h, '', [], n => { $('#welcomeMsg').textContent = 'Scanning ' + h.name + '… ' + n + ' photos'; }); } catch (e) { return toast('Could not read that folder: ' + e.message, 'err'); }
  $('#welcomeMsg').textContent = '';
  let cat = null; try { const fh = await h.getFileHandle(CATALOG_FILE); cat = JSON.parse(await (await fh.getFile()).text()); } catch (e) { cat = await idb.get('kv', 'catalog:' + st.lib.key); }
  setPhotos(photos, cat); idb.set('kv', 'lastLib', h);
  if (!photos.length) toast('No photos found in ' + h.name + '.');
}
async function pickFolder() {
  if (!window.showDirectoryPicker) return $('#dirInput').click();
  try { const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'emulsion-library' }); await openLibraryHandle(h, true); } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'err'); }
}
async function addLoose(photos, name) {
  if (!photos.length) return toast('No supported photos in that selection.');
  const session = st.lib && !st.lib.handle && !name;
  const all = session ? st.photos.concat(photos.filter(p => !st.photos.some(o => o.id === p.id))) : photos;
  st.lib = { name: name || 'Loose photos', key: name ? 'files:' + name : 'session', handle: null, writable: false };
  const cat = session ? catalogData() : await idb.get('kv', 'catalog:' + st.lib.key);
  setPhotos(all, cat);
}
function sortList(a) {
  const col = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }), byName = (x, y) => col.compare(x.id, y.id);
  if (st.sort === 'rating') a.sort((x, y) => (y.rating || 0) - (x.rating || 0) || byName(x, y)); else if (st.sort === 'edited') a.sort((x, y) => (y.edited || 0) - (x.edited || 0) || byName(x, y)); else if (st.sort === 'type') a.sort((x, y) => x.kind.localeCompare(y.kind) || byName(x, y)); else a.sort(byName);
}
function applyFilter() {
  const f = st.filter, q = f.q.trim().toLowerCase();
  st.list = st.photos.filter(p => (!q || p.id.toLowerCase().includes(q)) && (p.rating || 0) >= f.rating && (f.flag === 'all' || (f.flag === 'pick' ? p.flag === 1 : f.flag === 'reject' ? p.flag === -1 : !p.flag)) && (f.kind === 'all' || p.kind === f.kind) && (f.edited === 'all' || (!!p.sig) === (f.edited === 'yes')) && (f.folder == null || p.folder === f.folder || p.folder.startsWith(f.folder + '/')));
  sortList(st.list); renderGrid();
}
function renderFolders() {
  const box = $('#folders'), counts = new Map(); for (const p of st.photos) { let f = p.folder; counts.set(f, (counts.get(f) || 0)); for (; ;) { counts.set(f, counts.get(f) + 1); const i = f.lastIndexOf('/'); if (i < 0) break; f = f.slice(0, i); if (!counts.has(f)) counts.set(f, 0); } }
  const item = (label, val, n, depth) => el('button', { type: 'button', class: 'item' + (st.filter.folder === val ? ' on' : ''), style: 'padding-left:' + (10 + depth * 12) + 'px', onclick: () => { st.filter.folder = val; renderFolders(); applyFilter(); } }, el('span', { text: label }), el('em', { text: n }));
  box.replaceChildren(item('All photos', null, st.photos.length, 0), ...[...counts.keys()].filter(k => k).sort().map(k => item(k.split('/').pop(), k, counts.get(k), k.split('/').length)));
}
const thumbIO = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { thumbIO.unobserve(e.target); const p = st.photos.find(q => q.id === e.target.dataset.id); if (p) ensureThumb(p); } }, { rootMargin: '300px' });
function starsEl(p) { return el('span', { class: 'stars' }, [1, 2, 3, 4, 5].map(n => el('i', { 'data-star': n, class: (p.rating || 0) >= n ? 'on' : '', text: '★' }))); }
function decorate(c, p) {
  c.classList.toggle('edited', !!p.sig); c.classList.toggle('pick', p.flag === 1); c.classList.toggle('reject', p.flag === -1); c.classList.toggle('sel', st.sel.has(p.id)); c.classList.toggle('cur', st.cur === p); c.classList.toggle('fail', !!p.thumbFail);
  $$('.stars i', c).forEach(s => s.classList.toggle('on', (p.rating || 0) >= +s.dataset.star));
}
function makeCell(p, strip) {
  const img = el('img', { alt: '', draggable: 'false', loading: 'lazy' }); if (p.thumbUrl) img.src = p.thumbUrl;
  const c = el('div', { class: 'cell', tabindex: 0, 'data-id': p.id, title: p.id }, el('div', { class: 'ph' }, img, p.kind === 'raw' && el('span', { class: 'badge raw', text: 'RAW' }), el('span', { class: 'badge ed', text: 'Edited' }), el('span', { class: 'flagmark' })), !strip && el('div', { class: 'cap' }, el('span', { class: 'nm', text: p.name }), starsEl(p)));
  decorate(c, p); if (!p.thumbUrl && !p.thumbFail) thumbIO.observe(c); return c;
}
function updateCells(p) { for (const c of $$('.cell')) if (c.dataset.id === p.id) { const img = $('img', c); if (p.thumbUrl && img.getAttribute('src') !== p.thumbUrl) img.src = p.thumbUrl; decorate(c, p); } }
function markCurrent() { for (const c of $$('.cell')) c.classList.toggle('cur', !!st.cur && c.dataset.id === st.cur.id); const c = $('#strip .cell.cur'); if (c) c.scrollIntoView({ block: 'nearest', inline: 'center' }); }
function renderGrid() {
  thumbIO.disconnect();
  $('#grid').replaceChildren(...st.list.map(p => makeCell(p, false)));
  $('#strip').replaceChildren(...st.list.map(p => makeCell(p, true)));
  $('#count').textContent = st.list.length === st.photos.length ? st.photos.length + ' photos' : st.list.length + ' of ' + st.photos.length + ' photos';
  $('#noMatch').classList.toggle('hide', !st.photos.length || !!st.list.length); updateSelBar(); markCurrent();
}
function updateSelBar() { const n = st.sel.size; $('#selInfo').textContent = n ? n + ' selected' : 'Nothing selected'; $$('#selbar button').forEach(b => { b.disabled = b.dataset.need === 'clip' ? !(n && st.clipboard) : !n; }); for (const c of $$('#grid .cell')) c.classList.toggle('sel', st.sel.has(c.dataset.id)); }
function setThumb(p, blob, sig) { if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl); p.thumbUrl = URL.createObjectURL(blob); p.thumbSig = sig; p.thumbFail = false; updateCells(p); }
async function ensureThumb(p) {
  if (p.thumbBusy || !st.lib) return; p.thumbBusy = true;
  try {
    const key = photoKey(p), sig = p.sig || '';
    if (sig) { const e = await idb.get('thumbs', key + '|e'); if (e && e.sig === sig) { setThumb(p, e.blob, sig); return; } }
    let base = await idb.get('thumbs', key);
    if (!base) { base = await thumbQueue.add(() => makeBaseThumb(p)); if (base) idb.set('thumbs', key, base); }
    if (!base) { p.thumbFail = true; updateCells(p); return; }
    if (!p.thumbUrl || !sig) setThumb(p, base, '');
    if (sig) { editedQ.push({ p, base, sig }); pumpEdited(); }
  } catch (e) { p.thumbFail = true; updateCells(p); } finally { p.thumbBusy = false; }
}
const editedQ = []; let editedBusy = false;
async function pixelsToBlob(o, type, q) { const c = new OffscreenCanvas(o.W, o.H); c.getContext('2d').putImageData(new ImageData(o.px, o.W, o.H), 0, 0); return await c.convertToBlob({ type, quality: q }); }
async function pumpEdited() {
  if (editedBusy) return; editedBusy = true;
  while (editedQ.length) {
    const { p, base, sig } = editedQ.shift(); if ((p.sig || '') !== sig || !p.settings) continue;
    try {
      const bmp = await createImageBitmap(base), S = p.settings, undoMasks = await prepMasks(S), src = engine.makeSource({ kind: 'img', bitmap: bmp }); bmp.close(); let out;
      try { out = engine.readPixels(S, 480, renderOpts(S), src); } finally { engine.freeSource(src); undoMasks(); }
      const blob = await pixelsToBlob(out, 'image/jpeg', 0.82); idb.set('thumbs', photoKey(p) + '|e', { blob, sig }); setThumb(p, blob, sig); requestRender();
    } catch (e) { console.warn('thumbnail', e); }
    await new Promise(r => setTimeout(r, 0));
  }
  editedBusy = false;
}
function refreshThumb(p) { if ((p.sig || '') !== (p.thumbSig || '')) ensureThumb(p); }
const thumbSoon = debounce(() => { if (st.cur) refreshThumb(st.cur); }, 1200);

/* ---------- selection actions ---------- */
const targets = () => st.module === 'develop' ? (st.cur ? [st.cur] : []) : st.photos.filter(p => st.sel.has(p.id));
function setRating(n) { const t = targets(); if (!t.length) return; for (const p of t) { p.rating = n; updateCells(p); } saveCatalogSoon(); if (st.filter.rating || st.sort === 'rating') applyFilter(); }
function setFlag(f) { const t = targets(); if (!t.length) return; for (const p of t) { p.flag = f; updateCells(p); } saveCatalogSoon(); if (st.filter.flag !== 'all') applyFilter(); }
function copySettings() { const p = st.module === 'develop' ? st.cur : targets()[0]; if (!p) return; const S = clone(p === st.cur ? st.S : (p.settings || DEF)); for (const k of GEO_KEYS.concat('spots')) delete S[k]; st.clipboard = S; toast('Settings copied from ' + p.name); updateSelBar(); }
function assignSettings(p, S) { p.settings = S; p.edited = Date.now(); p.hist = null; touchPhoto(p); if (p === st.cur) { st.S = S; p.hist = [{ label: 'Pasted settings', j: JSON.stringify(S) }]; p.hi = 0; afterReplace(); renderHistory(); } else refreshThumb(p); updateCells(p); }
function pasteSettings() { if (!st.clipboard) return toast('Copy settings from a photo first.'); const t = targets(); for (const p of t) { const cur = p === st.cur ? st.S : (p.settings || newSettings()), S = normalize(Object.assign(clone(cur), clone(st.clipboard))); S.masks.forEach((m, i) => { m.id = 'm' + Date.now().toString(36) + i + Math.floor(Math.random() * 1e4); }); assignSettings(p, S); } saveCatalogSoon(); if (t.length) toast('Settings pasted to ' + t.length + ' photo' + (t.length > 1 ? 's' : '')); }
function resetSelected() { const t = targets(); for (const p of t) assignSettings(p, newSettings()); saveCatalogSoon(); }

/* ---------- export ---------- */
async function exportPhotos(list, o) {
  if (!list.length) return; const prog = $('#exportProg'); let dir = null, done = 0, failed = 0;
  try {
    if (st.lib && st.lib.handle && st.lib.writable) dir = await st.lib.handle.getDirectoryHandle(EXPORT_DIR, { create: true });
    else if (window.showDirectoryPicker && list.length > 1) dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'emulsion-export' });
  } catch (e) { if (e.name === 'AbortError') return; dir = null; }
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[o.type];
  for (const p of list) {
    prog.textContent = 'Exporting ' + (done + failed + 1) + ' of ' + list.length + ': ' + p.name; prog.classList.remove('hide'); await new Promise(r => setTimeout(r, 30));
    try {
      const S = p === st.cur ? st.S : (p.settings || newSettings()); let out;
      if (p === st.cur && st.srcFull) out = engine.readPixels(S, o.max, renderOpts(S));
      else { const spec = await loadSourceSpec(p, engine.maxTex), src = engine.makeSource(spec), undoMasks = await prepMasks(S); if (spec.bitmap) spec.bitmap.close(); try { out = engine.readPixels(S, o.max, renderOpts(S), src); } finally { engine.freeSource(src); undoMasks(); } }
      const blob = await pixelsToBlob(out, o.type, o.quality), name = p.name.replace(/\.[^.]+$/, '') + (o.suffix || '') + '.' + ext;
      if (dir) await writeFile(dir, name, blob); else downloadBlob(blob, name);
      done++;
    } catch (e) { failed++; console.error(e); toast('Export failed for ' + p.name + ': ' + (e.message || e), 'err'); }
  }
  engine.trim(); requestRender(); prog.classList.add('hide');
  if (done) toast(done + ' photo' + (done > 1 ? 's' : '') + ' exported' + (dir ? ' to “' + dir.name + '”' : ' to your downloads'));
}
function openExport() {
  const t = targets(); if (!t.length) return toast(st.module === 'develop' ? 'Open a photo first.' : 'Select the photos to export first.');
  $('#exportWhat').textContent = t.length === 1 ? t[0].name : t.length + ' photos';
  $('#exportWhere').textContent = st.lib && st.lib.handle && st.lib.writable ? 'Saved into “' + EXPORT_DIR + '” inside ' + st.lib.name + '.' : t.length > 1 && window.showDirectoryPicker ? 'You will be asked to choose a destination folder.' : 'Saved to your downloads folder.';
  $('#exportDlg').showModal();
}

/* ---------- modules, shortcuts, startup ---------- */
function showModule(m) { st.module = m; document.body.dataset.mod = m; $$('header [data-mod]').forEach(b => b.classList.toggle('on', b.dataset.mod === m)); if (m === 'develop') requestRender(); else { if (st.cur) refreshThumb(st.cur); updateSelBar(); } }
function setModule(m) {
  if (m === 'develop') {
    const pick = st.photos.find(q => st.sel.has(q.id));
    if (!st.cur) { const p = pick || st.list[0]; if (!p) return toast('Open a folder or add photos first.'); return openPhoto(p); }
    if (st.module === 'library' && pick && !st.sel.has(st.cur.id)) return openPhoto(pick);
  }
  showModule(m);
}
function bindUI() {
  $$('header [data-mod]').forEach(b => b.addEventListener('click', () => setModule(b.dataset.mod)));
  $$('#toolbar [data-tool]').forEach(b => b.addEventListener('click', () => { if (st.cur) setTool(st.tool === b.dataset.tool ? 'none' : b.dataset.tool); }));
  const act = { undo, redo, reset: resetAll, fit: () => { st.view.fit = true; requestRender(); }, one: () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / (window.devicePixelRatio || 1)), before: () => { st.compare = st.compare === 1 ? 0 : 1; syncChrome(); }, split: () => { st.compare = st.compare === 2 ? 0 : 2; syncChrome(); }, clip: () => { st.clip = !st.clip; syncChrome(); },
    open: pickFolder, add: () => $('#fileInput').click(), export: openExport, copy: copySettings, paste: pasteSettings, resetSel: resetSelected, prev: () => step(-1), next: () => step(1), reopen: async () => { const h = await idb.get('kv', 'lastLib'); if (h) openLibraryHandle(h, true); },
    rotL: () => rotate90(-1), rotR: () => rotate90(1), flipH: () => flip(true), flipV: () => flip(false), cropReset: resetCrop, cropDone: () => setTool('none'), swapAspect: () => { const a = st.S.aspect; if (/^\d/.test(a)) setAspect(a.split(':').reverse().join(':')); } };
  document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && act[b.dataset.act]) act[b.dataset.act](); });
  $('#fileInput').addEventListener('change', e => { addLoose(photosFromFiles(e.target.files)); e.target.value = ''; });
  $('#dirInput').addEventListener('change', e => { const fs = [...e.target.files]; if (fs.length) addLoose(photosFromFiles(fs), (fs[0].webkitRelativePath || '').split('/')[0] || 'Folder'); e.target.value = ''; });
  $('#presetFile').addEventListener('change', e => { if (e.target.files[0]) importPresets(e.target.files[0]); e.target.value = ''; });
  $('#aspect').addEventListener('change', e => setAspect(e.target.value)); WIDGETS.push(() => { const a = st.S.aspect, s = $('#aspect'), r = a.split(':').reverse().join(':'); s.value = [...s.options].some(o => o.value === a) ? a : [...s.options].some(o => o.value === r) ? r : 'free'; });
  $('#cropAngle').append(slider('Straighten', 'angle', -45, 45, 0.1, { on: (v, final) => { constrainCrop(); if (final) st.cropBase = null; st.cropView = null; } }));
  // library filters
  const f = st.filter, bind = (id, fn) => $(id).addEventListener('input', e => { fn(e.target.value); applyFilter(); });
  bind('#search', v => f.q = v); bind('#fRating', v => f.rating = +v); bind('#fFlag', v => f.flag = v); bind('#fKind', v => f.kind = v); bind('#fEdited', v => f.edited = v); bind('#sort', v => st.sort = v);
  $('#thumbSize').addEventListener('input', e => $('#grid').style.setProperty('--cell', e.target.value + 'px'));
  // grid interactions
  const pOf = e => { const c = e.target.closest('.cell'); return c ? st.photos.find(p => p.id === c.dataset.id) : null; };
  $('#grid').addEventListener('click', e => {
    const p = pOf(e); if (!p) { if (!e.target.closest('.cell')) { st.sel.clear(); updateSelBar(); } return; }
    if (e.target.dataset.star) { const n = +e.target.dataset.star; if (!st.sel.has(p.id)) { st.sel.clear(); st.sel.add(p.id); } const v = p.rating === n ? 0 : n; for (const q of targets()) { q.rating = v; updateCells(q); } saveCatalogSoon(); updateSelBar(); return; }
    if (e.shiftKey && st.anchor) { const a = st.list.indexOf(st.anchor), b = st.list.indexOf(p); if (a >= 0) { if (!e.metaKey && !e.ctrlKey) st.sel.clear(); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) st.sel.add(st.list[i].id); } }
    else if (e.metaKey || e.ctrlKey) { st.sel.has(p.id) ? st.sel.delete(p.id) : st.sel.add(p.id); st.anchor = p; }
    else { st.sel.clear(); st.sel.add(p.id); st.anchor = p; }
    updateSelBar();
  });
  $('#grid').addEventListener('dblclick', e => { const p = pOf(e); if (p && !e.target.dataset.star) openPhoto(p); });
  $('#grid').addEventListener('keydown', e => { if (e.key === 'Enter') { const p = pOf(e); if (p) openPhoto(p); } });
  $('#strip').addEventListener('click', e => { const p = pOf(e); if (p) openPhoto(p); });
  // export dialog
  const q = $('#exQuality'), ty = $('#exType'); ty.addEventListener('change', () => { q.closest('label').classList.toggle('hide', ty.value === 'image/png'); });
  q.addEventListener('input', () => $('#exQv').textContent = q.value);
  $('#exportForm').addEventListener('submit', e => { e.preventDefault(); $('#exportDlg').close(); const mx = $('#exSize').value; exportPhotos(targets(), { type: ty.value, quality: +q.value / 100, max: mx === 'full' ? 0 : +mx, suffix: $('#exSuffix').value.replace(/[\\/:*?"<>|]/g, '') }); });
  $('#exCancel').addEventListener('click', () => $('#exportDlg').close());
  // drag & drop
  window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dropping'); });
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
  window.addEventListener('drop', async e => {
    e.preventDefault(); document.body.classList.remove('dropping'); const items = [...e.dataTransfer.items].filter(i => i.kind === 'file');
    if (items.length && items[0].getAsFileSystemHandle) { const hs = await Promise.all(items.map(i => i.getAsFileSystemHandle().catch(() => null))); const d = hs.find(h => h && h.kind === 'directory'); if (d) return openLibraryHandle(d, true); const out = []; for (const h of hs) if (h && h.kind === 'file' && kindOf(h.name)) out.push({ id: h.name, name: h.name, folder: '', kind: kindOf(h.name), getFile: () => h.getFile() }); return addLoose(out); }
    addLoose(photosFromFiles(e.dataTransfer.files));
  });
  // keyboard
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !e.target.closest('input,select,textarea,button')) { spaceDown = true; e.preventDefault(); }
    if (e.target.closest('input:not([type=range]),select,textarea,dialog')) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'e') { e.preventDefault(); openExport(); return; }
    if (mod && e.shiftKey && k === 'c') { e.preventDefault(); copySettings(); return; }
    if (mod && e.shiftKey && k === 'v') { e.preventDefault(); pasteSettings(); return; }
    if (mod && k === 'a' && st.module === 'library') { e.preventDefault(); for (const p of st.list) st.sel.add(p.id); updateSelBar(); return; }
    if (mod || e.altKey) return;
    if (k >= '0' && k <= '5') return setRating(+k);
    const dev = st.module === 'develop';
    switch (k) {
      case 'g': setModule('library'); break; case 'd': setModule('develop'); break;
      case 'p': setFlag(1); break; case 'x': setFlag(-1); break; case 'u': setFlag(0); break;
      case 'c': if (dev && st.cur) setTool(st.tool === 'crop' ? 'none' : 'crop'); break;
      case 'm': if (dev && st.cur) setTool(st.tool === 'mask' ? 'none' : 'mask'); break;
      case 'q': if (dev && st.cur) setTool(st.tool === 'heal' ? 'none' : 'heal'); break;
      case 'w': if (dev && st.cur) setTool(st.tool === 'wb' ? 'none' : 'wb'); break;
      case 'o': if (dev) { st.overlay = !st.overlay; syncUI(); requestRender(); } break;
      case '\\': if (dev) act.before(); break; case 'y': if (dev) act.split(); break; case 'j': if (dev) act.clip(); break;
      case 'f': if (dev) act.fit(); break; case 'z': if (dev) (st.view.fit ? act.one() : act.fit()); break;
      case 'arrowright': if (dev && e.target.type !== 'range') step(1); break; case 'arrowleft': if (dev && e.target.type !== 'range') step(-1); break;
      case 'enter': if (dev && st.tool === 'crop') setTool('none'); break;
      case 'escape': if (dev && st.tool !== 'none') setTool('none'); break;
      case 'delete': case 'backspace': if (dev && st.tool === 'heal' && st.selSpot >= 0) { st.S.spots.splice(st.selSpot, 1); st.selSpot = -1; requestRender(); commit('Remove heal spot'); } else if (dev && st.tool === 'mask' && st.selMask >= 0) deleteMask(st.selMask); break;
      case '[': st.brush.size = clamp(st.brush.size - 10, 4, 400); syncUI(); drawOverlay(); break; case ']': st.brush.size = clamp(st.brush.size + 10, 4, 400); syncUI(); drawOverlay(); break;
    }
  });
  document.addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });
  window.addEventListener('beforeunload', () => { saveCatalog(); });
}
function syncChrome() { $$('[data-act=before]').forEach(b => b.classList.toggle('on', st.compare === 1)); $$('[data-act=split]').forEach(b => b.classList.toggle('on', st.compare === 2)); $$('[data-act=clip]').forEach(b => b.classList.toggle('on', st.clip)); requestRender(); }

async function init() {
  glc = $('#gl'); ov = $('#ov'); octx = ov.getContext('2d'); stage = $('#stage');
  try { engine = new Engine(glc); } catch (e) { $('#fatal').textContent = e.message + ' Emulsion needs a recent version of Chrome, Edge, Safari or Firefox with graphics acceleration turned on.'; $('#fatal').classList.remove('hide'); throw e; }
  glc.addEventListener('webglcontextlost', e => { e.preventDefault(); toast('The graphics card ran out of memory. Reload the page to continue; your edits are saved.', 'err'); });
  buildPanels(); bindUI(); bindStage();
  st.presets = (await idb.get('kv', 'presets')) || []; st.luts = (await idb.get('kv', 'luts')) || {};
  renderPresets(); syncUI(); setTool('none'); document.body.dataset.empty = '1'; document.body.dataset.mod = 'library';
  if (!window.showDirectoryPicker) $('#fsNote').classList.remove('hide');
  const h = await idb.get('kv', 'lastLib'); if (h && h.name && window.showDirectoryPicker) { const b = $('#reopen'); b.textContent = 'Reopen “' + h.name + '”'; b.classList.remove('hide'); }
  if (location.hash === '#selftest') { // developer aid: confirms the raw decoder and storage work where the page is opened from
    let w; try { rawDecoder.start(); w = await Promise.race([rawDecoder.call('metadata', false).then(() => 'worker ok', e => 'worker replied'), new Promise(r => setTimeout(() => r('worker timeout'), 8000))]); } catch (e) { w = 'worker error ' + e.message; }
    await idb.set('kv', 'selftest', 1); document.title = 'SELFTEST ' + JSON.stringify({ proto: location.protocol, secure: isSecureContext, picker: !!window.showDirectoryPicker, w, db: await idb.get('kv', 'selftest') });
  }
  const demo = new URLSearchParams(location.search).get('demo'); // developer aid: ?demo=a.jpg,b.arw loads files served next to the page
  if (demo) addLoose(demo.split(',').map(u => ({ id: u.split('/').pop(), name: u.split('/').pop(), folder: '', kind: kindOf(u) || 'img', getFile: async () => new File([await (await fetch(u)).blob()], u.split('/').pop()) })), 'Demo');
}
window.addEventListener('DOMContentLoaded', () => init().then(() => finishEmulsionInit(), finishEmulsionInit));
