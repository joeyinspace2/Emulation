'use strict';
/* ---------- control plumbing: every slider is bound to a settings path ---------- */
const CONTROLS = [], WIDGETS = [];
const MASK_DEF = { feather: 50, amount: 100, adj: MASK_ADJ };
const curMask = () => st.S.masks[st.selMask] || null;
function pathRoot(path, defaults) { return path[0] === '@' ? (defaults ? MASK_DEF : curMask()) : path[0] === '#' ? (defaults ? BRUSH_DEF : st.brush) : (defaults ? DEF : st.S); }
function getP(path, defaults) { let o = pathRoot(path, defaults); for (const k of path.replace(/^[@#]/, '').split('.')) { if (o == null) return undefined; o = o[k]; } return o; }
function setP(path, v) { let o = pathRoot(path); if (!o) return; const ks = path.replace(/^[@#]/, '').split('.'); for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; }
const fmt = (v, step) => step < 0.1 ? (v > 0 ? '+' : '') + v.toFixed(2) : step < 1 ? v.toFixed(1) : String(Math.round(v));

function slider(label, path, min, max, step, o) {
  step = step || 1; o = o || {};
  const range = el('input', { type: 'range', min, max, step, class: o.track ? 'trk ' + o.track : '', 'aria-label': label });
  const num = el('input', { type: 'text', class: 'num', inputmode: 'decimal', 'aria-label': label + ' value' });
  const lab = el('label', { title: 'Double-click to reset', text: label });
  const row = el('div', { class: 'row' }, lab, range, num);
  if (o.style) range.style.cssText = o.style;
  const ui = path[0] === '#';
  const c = { path, range, num, row, step, label, sync() { const v = getP(path); row.classList.toggle('off', v === undefined); if (v === undefined) return; range.value = v; num.value = fmt(+v, step); } };
  const apply = (v, final) => {
    v = clamp(Math.round(v / step) * step, min, max); if (step < 1) v = +v.toFixed(2);
    setP(path, v); range.value = v; num.value = fmt(v, step);
    if (o.on) o.on(v, final);
    if (ui) { if (typeof drawOverlay === 'function') drawOverlay(); return; }
    requestRender(); if (final) commit(o.commit || label);
  };
  range.addEventListener('input', () => apply(+range.value, false));
  range.addEventListener('change', () => apply(+range.value, true));
  num.addEventListener('change', () => { const v = parseFloat(num.value); isNaN(v) ? c.sync() : apply(v, true); });
  num.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); apply((+getP(path) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), true); } e.stopPropagation(); });
  lab.addEventListener('dblclick', () => apply(getP(path, true), true));
  CONTROLS.push(c); return row;
}
function section(title, open, ...kids) { const d = el('details', { class: 'sec' }, el('summary', {}, title), el('div', { class: 'secbody' }, kids)); d.open = !!open; return d; }
function btn(label, on, cls, title) { return el('button', { class: 'btn ' + (cls || ''), type: 'button', onclick: on, title: title || null }, label); }
function syncUI() { for (const c of CONTROLS) c.sync(); for (const w of WIDGETS) w(); }

/* ---------- tone curve editor ---------- */
function curveEditor() {
  const cv = el('canvas', { class: 'curve', width: 480, height: 480 }), x = cv.getContext('2d');
  let ch = 'rgb', drag = -1; const cols = { rgb: '#e8e8ea', r: '#ff5d5d', g: '#5fd475', b: '#5b9bff' };
  const tabs = el('div', { class: 'seg' }, ['rgb', 'r', 'g', 'b'].map(k => el('button', { type: 'button', 'data-ch': k, onclick: () => { ch = k; draw(); } }, k === 'rgb' ? 'RGB' : k.toUpperCase())));
  const pts = () => st.S.curve[ch];
  function draw() {
    $$('button', tabs).forEach(b => b.classList.toggle('on', b.dataset.ch === ch));
    const W = cv.width, H = cv.height; x.clearRect(0, 0, W, H); x.lineWidth = 1; x.strokeStyle = 'rgba(255,255,255,.08)';
    for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(i * W / 4, 0); x.lineTo(i * W / 4, H); x.moveTo(0, i * H / 4); x.lineTo(W, i * H / 4); x.stroke(); }
    x.strokeStyle = 'rgba(255,255,255,.14)'; x.beginPath(); x.moveTo(0, H); x.lineTo(W, 0); x.stroke();
    for (const k of ['r', 'g', 'b', 'rgb']) {
      if (k !== ch && curveIsId({ rgb: st.S.curve[k], r: st.S.curve[k], g: st.S.curve[k], b: st.S.curve[k] })) continue;
      const l = curveLUT(st.S.curve[k]); x.strokeStyle = cols[k]; x.globalAlpha = k === ch ? 1 : 0.35; x.lineWidth = k === ch ? 3 : 2; x.beginPath();
      for (let i = 0; i < 256; i++) { const px = i / 255 * W, py = H - l[i] * H; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
    }
    x.globalAlpha = 1; x.fillStyle = cols[ch];
    for (const p of pts()) { x.beginPath(); x.arc(p[0] * W, H - p[1] * H, 8, 0, 7); x.fill(); x.strokeStyle = '#111'; x.lineWidth = 2; x.stroke(); }
  }
  const pos = e => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, 0, 1)]; };
  const hit = (p, e) => { const r = cv.getBoundingClientRect(); let best = -1, bd = 14; pts().forEach((q, i) => { const d = Math.hypot((q[0] - p[0]) * r.width, (q[1] - p[1]) * r.height); if (d < bd) { bd = d; best = i; } }); return best; };
  cv.addEventListener('pointerdown', e => {
    if (!st.cur) return; cv.setPointerCapture(e.pointerId); const p = pos(e); drag = hit(p, e);
    if (drag < 0 && pts().length < 14) { const a = pts(); a.push([p[0], p[1]]); a.sort((m, n) => m[0] - n[0]); drag = a.findIndex(q => q[0] === p[0] && q[1] === p[1]); requestRender(); draw(); }
  });
  cv.addEventListener('pointermove', e => {
    if (drag < 0) return; const p = pos(e), a = pts(), last = a.length - 1;
    const lo = drag === 0 ? 0 : a[drag - 1][0] + 0.01, hi = drag === last ? 1 : a[drag + 1][0] - 0.01;
    a[drag] = [drag === 0 ? 0 : drag === last ? 1 : clamp(p[0], lo, hi), p[1]]; requestRender(); draw();
  });
  cv.addEventListener('pointerup', () => { if (drag >= 0) { drag = -1; commit('Tone curve'); } });
  cv.addEventListener('dblclick', e => { const i = hit(pos(e), e), a = pts(); if (i > 0 && i < a.length - 1) { a.splice(i, 1); requestRender(); draw(); commit('Tone curve'); } });
  WIDGETS.push(draw);
  return el('div', {}, el('div', { class: 'rowline' }, tabs, btn('Reset', () => { st.S.curve[ch] = [[0, 0], [1, 1]]; requestRender(); draw(); commit('Reset curve'); }, 'tiny')), cv,
    el('p', { class: 'hint', text: 'Click to add a point, drag to shape, double-click a point to remove it.' }));
}

/* ---------- colour grading wheels ---------- */
function gradeWheel(key, title) {
  const dot = el('i', { class: 'dot' }), wheel = el('div', { class: 'wheel', role: 'slider', 'aria-label': title + ' tint', tabindex: 0 }, dot);
  const g = () => st.S.grade[key];
  const draw = () => { const a = g().h * Math.PI / 180, r = g().s / 100 * 50; dot.style.left = 50 + Math.cos(a) * r + '%'; dot.style.top = 50 + Math.sin(a) * r + '%'; };
  let down = false;
  const set = e => { const r = wheel.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2; g().h = Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360); g().s = Math.round(clamp(Math.hypot(dx, dy) / (r.width / 2), 0, 1) * 100); draw(); requestRender(); };
  wheel.addEventListener('pointerdown', e => { if (!st.cur) return; down = true; wheel.setPointerCapture(e.pointerId); set(e); });
  wheel.addEventListener('pointermove', e => { if (down) set(e); });
  wheel.addEventListener('pointerup', () => { if (down) { down = false; commit(title + ' tint'); } });
  wheel.addEventListener('dblclick', () => { g().s = 0; draw(); requestRender(); commit('Reset ' + title.toLowerCase() + ' tint'); });
  WIDGETS.push(draw);
  return el('div', { class: 'wheelbox' }, wheel, el('span', { text: title }));
}

/* ---------- histogram ---------- */
function drawHistogram(h) {
  const cv = $('#hist'), x = cv.getContext('2d'), W = cv.width, H = cv.height; x.clearRect(0, 0, W, H); if (!h) return;
  let mx = 1; for (const k of ['r', 'g', 'b']) for (let i = 3; i < 253; i++) mx = Math.max(mx, h[k][i]);
  x.globalCompositeOperation = 'lighter';
  for (const [k, col] of [['r', 'rgba(235,70,70,.85)'], ['g', 'rgba(70,200,90,.85)'], ['b', 'rgba(70,120,245,.85)']]) {
    x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
    for (let i = 0; i < 256; i++) x.lineTo(i / 255 * W, H - Math.min(1, Math.pow(h[k][i] / mx, 0.6)) * (H - 2));
    x.lineTo(W, H); x.fill();
  }
  x.globalCompositeOperation = 'source-over';
  $('#clipL').classList.toggle('hot', (h.r[0] + h.g[0] + h.b[0]) > 256 * 160 * 3 * 0.002); $('#clipR').classList.toggle('hot', (h.r[255] + h.g[255] + h.b[255]) > 256 * 160 * 3 * 0.002);
}

/* ---------- right-hand panels ---------- */
const HSL_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'], HSL_COL = ['#e5484d', '#f08c2e', '#e6c62f', '#46b85a', '#3fc4c0', '#3d7fe6', '#8a5be0', '#d94fb5'];
function buildPanels() {
  // --- Develop ---
  const hslTabs = el('div', { class: 'seg' }), hslBodies = {};
  [['hslH', 'Hue'], ['hslS', 'Saturation'], ['hslL', 'Luminance']].forEach(([k, name], n) => {
    hslBodies[k] = el('div', { class: n ? 'hide' : '' }, HSL_NAMES.map((nm, i) => slider(nm, k + '.' + i, -100, 100, 1, { style: '--c:' + HSL_COL[i], track: 'hue', commit: name + ' · ' + nm })));
    hslTabs.append(el('button', { type: 'button', class: n ? '' : 'on', onclick: e => { for (const j in hslBodies) hslBodies[j].classList.toggle('hide', j !== k); $$('button', hslTabs).forEach(b => b.classList.toggle('on', b === e.currentTarget)); } }, name));
  });
  const bwBtn = btn('Black & white', () => { st.S.bw = !st.S.bw; requestRender(); commit(st.S.bw ? 'Black & white' : 'Colour'); syncUI(); }, 'tiny tog');
  WIDGETS.push(() => bwBtn.classList.toggle('on', !!st.S.bw));
  const develop = el('div', { class: 'tabbody', id: 'tab-develop' },
    section('Light', true,
      el('div', { class: 'rowline' }, btn('Auto', autoTone, 'tiny', 'Set exposure and tone automatically'), btn('Pick white balance', () => setTool(st.tool === 'wb' ? 'none' : 'wb'), 'tiny', 'Click something that should be neutral grey (W)'), bwBtn),
      slider('Temp', 'temp', -100, 100, 1, { track: 'temp' }), slider('Tint', 'tint', -100, 100, 1, { track: 'tint' }), el('hr'),
      slider('Exposure', 'exposure', -5, 5, 0.01), slider('Contrast', 'contrast', -100, 100), slider('Highlights', 'highlights', -100, 100), slider('Shadows', 'shadows', -100, 100), slider('Whites', 'whites', -100, 100), slider('Blacks', 'blacks', -100, 100)),
    section('Presence', true, slider('Texture', 'texture', -100, 100), slider('Clarity', 'clarity', -100, 100), slider('Dehaze', 'dehaze', -100, 100), el('hr'), slider('Vibrance', 'vibrance', -100, 100), slider('Saturation', 'saturation', -100, 100)),
    section('Tone curve', false, curveEditor()),
    section('Colour mixer', false, hslTabs, Object.values(hslBodies)),
    section('Colour grading', false, el('div', { class: 'wheels' }, gradeWheel('sh', 'Shadows'), gradeWheel('mid', 'Midtones'), gradeWheel('hi', 'Highlights')),
      slider('Shadow lum', 'grade.sh.l', -100, 100), slider('Midtone lum', 'grade.mid.l', -100, 100), slider('Highlight lum', 'grade.hi.l', -100, 100), el('hr'), slider('Blending', 'grade.blend', 0, 100), slider('Balance', 'grade.balance', -100, 100)),
    section('Detail', false, slider('Sharpening', 'sharpen', 0, 150), slider('Radius', 'sharpRadius', 0.5, 3, 0.1), slider('Masking', 'sharpMask', 0, 100), el('hr'), slider('Noise reduction', 'nrLuma', 0, 100), slider('Colour noise', 'nrColor', 0, 100)),
    section('Lens', false, slider('Distortion', 'distort', -100, 100), slider('Red fringe', 'caR', -100, 100), slider('Blue fringe', 'caB', -100, 100), slider('Lens vignetting', 'lensVig', -100, 100)),
    section('Vignette', false, slider('Amount', 'vigAmount', -100, 100, 1, { commit: 'Vignette' }), slider('Midpoint', 'vigMid', 0, 100), slider('Roundness', 'vigRound', -100, 100), slider('Feather', 'vigFeather', 0, 100)));

  // --- Film ---
  const stockList = el('div', { class: 'stocks' }), stockDesc = el('p', { class: 'hint' });
  let grp = null;
  for (const s of STOCKS) {
    if (s.group !== grp && s.group) { grp = s.group; stockList.append(el('h4', { text: grp })); }
    stockList.append(el('button', { type: 'button', class: 'chip', 'data-id': s.id, title: s.desc, onclick: () => pickStock(s) }, s.name));
  }
  WIDGETS.push(() => { $$('.chip', stockList).forEach(b => b.classList.toggle('on', b.dataset.id === st.S.film)); stockDesc.textContent = (STOCK_BY_ID[st.S.film] || FILM_NONE).desc; });
  const borderSeg = el('div', { class: 'seg' }, ['white', 'cream', 'black'].map(c => el('button', { type: 'button', 'data-c': c, onclick: () => { st.S.borderColor = c; requestRender(); commit('Border colour'); syncUI(); } }, c[0].toUpperCase() + c.slice(1))));
  WIDGETS.push(() => $$('button', borderSeg).forEach(b => b.classList.toggle('on', b.dataset.c === st.S.borderColor)));
  const lutSel = el('select', { 'aria-label': 'LUT', onchange: () => { st.S.lut = lutSel.value || null; requestRender(); commit('LUT'); } });
  WIDGETS.push(() => { lutSel.replaceChildren(el('option', { value: '' }, 'None'), ...Object.keys(st.luts).map(n => el('option', { value: n }, n))); lutSel.value = st.S.lut && st.luts[st.S.lut] ? st.S.lut : ''; });
  const lutFile = el('input', { type: 'file', accept: '.cube', class: 'hide', onchange: async () => { const f = lutFile.files[0]; lutFile.value = ''; if (!f) return; try { const l = parseCube(await f.text()), name = f.name.replace(/\.cube$/i, ''); st.luts[name] = l; idb.set('kv', 'luts', st.luts); st.S.lut = name; requestRender(); commit('LUT ' + name); syncUI(); } catch (e) { toast(e.message, 'err'); } } });
  const film = el('div', { class: 'tabbody hide', id: 'tab-film' },
    section('Film stock', true, stockList, stockDesc, slider('Strength', 'filmAmt', 0, 100, 1, { commit: 'Film strength' })),
    section('Halation', true, el('p', { class: 'hint', text: 'Red-orange glow where bright light scatters back through the film base.' }), slider('Amount', 'halation', 0, 100, 1, { commit: 'Halation' }), slider('Threshold', 'halThresh', 20, 100, 1, { commit: 'Halation threshold' }), slider('Radius', 'halRadius', 0, 100, 1, { commit: 'Halation radius' }), slider('Hue', 'halHue', -20, 60, 1, { commit: 'Halation hue', track: 'halhue' })),
    section('Bloom & mist', false, slider('Amount', 'bloom', 0, 100, 1, { commit: 'Bloom' }), slider('Threshold', 'bloomThresh', 0, 100, 1, { commit: 'Bloom threshold' }), slider('Radius', 'bloomRadius', 0, 100, 1, { commit: 'Bloom radius' }), el('p', { class: 'hint', text: 'Lower the threshold for an all-over diffusion filter.' })),
    section('Grain', true, slider('Amount', 'grain', 0, 100, 1, { commit: 'Grain' }), slider('Size', 'grainSize', 0, 100, 1, { commit: 'Grain size' }), slider('Roughness', 'grainRough', 0, 100, 1, { commit: 'Grain roughness' }), slider('Colour', 'grainColor', 0, 100, 1, { commit: 'Grain colour' })),
    section('Print & damage', false, slider('Fade', 'fade', 0, 100), slider('Light leak', 'leak', 0, 100), slider('Leak hue', 'leakHue', 0, 360, 1, { track: 'rainbow' }), slider('Dust', 'dust', 0, 100), slider('Scratches', 'scratches', 0, 100),
      el('div', { class: 'rowline' }, btn('Shuffle leak', () => { st.S.leakSeed = 1 + Math.floor(Math.random() * 997); requestRender(); commit('Shuffle leak'); }, 'tiny'), btn('Shuffle grain & dust', () => { st.S.fxSeed = 1 + Math.floor(Math.random() * 997); requestRender(); commit('Shuffle grain'); }, 'tiny'))),
    section('Border', false, slider('Width', 'border', 0, 100, 1, { commit: 'Border' }), slider('Corner radius', 'borderRound', 0, 100), el('div', { class: 'rowline' }, borderSeg)),
    section('LUT', false, el('div', { class: 'rowline' }, lutSel, btn('Import .cube…', () => lutFile.click(), 'tiny'), lutFile), slider('Strength', 'lutAmt', 0, 100, 1, { commit: 'LUT strength' })));

  // --- Local ---
  const maskList = el('div', { class: 'list', id: 'maskList' }), maskBody = el('div', { id: 'maskBody' });
  const invBtn = btn('Invert', () => { const m = curMask(); if (!m) return; m.invert = !m.invert; requestRender(); commit('Invert mask'); syncUI(); }, 'tiny tog');
  const eraseBtn = btn('Erase', () => { st.brush.erase = !st.brush.erase; syncUI(); }, 'tiny tog', 'Hold Alt while painting to erase');
  const ovBtn = btn('Show overlay', () => { st.overlay = !st.overlay; requestRender(); syncUI(); }, 'tiny tog', 'Toggle the red mask overlay (O)');
  const brushBox = el('div', { id: 'brushBox' }, slider('Brush size', '#size', 4, 400), slider('Brush feather', '#feather', 0, 100), slider('Flow', '#flow', 1, 100));
  maskBody.append(el('div', { class: 'rowline' }, invBtn, eraseBtn, ovBtn, btn('Delete', () => deleteMask(st.selMask), 'tiny danger')), brushBox,
    slider('Amount', '@amount', 0, 100, 1, { commit: 'Mask amount' }), slider('Feather', '@feather', 0, 100, 1, { commit: 'Mask feather' }), el('hr'),
    slider('Exposure', '@adj.exposure', -4, 4, 0.01, { commit: 'Mask exposure' }), slider('Contrast', '@adj.contrast', -100, 100, 1, { commit: 'Mask contrast' }), slider('Saturation', '@adj.saturation', -100, 100, 1, { commit: 'Mask saturation' }),
    slider('Clarity', '@adj.clarity', -100, 100, 1, { commit: 'Mask clarity' }), slider('Temp', '@adj.temp', -100, 100, 1, { commit: 'Mask temp', track: 'temp' }), slider('Tint', '@adj.tint', -100, 100, 1, { commit: 'Mask tint', track: 'tint' }));
  WIDGETS.push(() => {
    const ms = st.S.masks; maskList.replaceChildren(...ms.map((m, i) => el('button', { type: 'button', class: 'item' + (i === st.selMask ? ' on' : ''), onclick: () => { st.selMask = i; setTool('mask'); syncUI(); requestRender(); } }, (m.type === 'linear' ? 'Linear gradient ' : m.type === 'radial' ? 'Radial gradient ' : 'Brush ') + (i + 1))));
    if (!ms.length) maskList.append(el('p', { class: 'hint', text: st.pendingMask ? 'Drag on the photo to place the ' + st.pendingMask + ' gradient.' : 'No masks yet. Add one to adjust part of the photo.' }));
    else if (st.pendingMask) maskList.append(el('p', { class: 'hint', text: 'Drag on the photo to place the ' + st.pendingMask + ' gradient.' }));
    const m = curMask(); maskBody.classList.toggle('hide', !m); if (!m) return;
    invBtn.classList.toggle('on', !!m.invert); eraseBtn.classList.toggle('on', st.brush.erase); ovBtn.classList.toggle('on', st.overlay);
    brushBox.classList.toggle('hide', m.type !== 'brush'); eraseBtn.classList.toggle('hide', m.type !== 'brush');
  });
  const local = el('div', { class: 'tabbody hide', id: 'tab-local' },
    section('Masks', true, el('div', { class: 'rowline' }, btn('+ Linear', () => addMask('linear'), 'tiny'), btn('+ Radial', () => addMask('radial'), 'tiny'), btn('+ Brush', () => addMask('brush'), 'tiny')), maskList, maskBody),
    section('Heal & clone', true, el('p', { class: 'hint', text: 'Choose the Heal tool, then click a blemish. Drag the dashed circle to choose where it copies from.' }),
      slider('Spot size', '#spot', 0.3, 10, 0.1), slider('Spot feather', '#spotFeather', 0, 100),
      el('div', { class: 'rowline' }, btn('Heal tool', () => setTool(st.tool === 'heal' ? 'none' : 'heal'), 'tiny'), btn('Remove all spots', () => { if (!st.S.spots.length) return; st.S.spots = []; st.selSpot = -1; requestRender(); commit('Remove spots'); }, 'tiny danger'))));

  const tabs = el('div', { class: 'tabs', role: 'tablist' }, [['develop', 'Develop'], ['film', 'Film'], ['local', 'Local']].map(([k, n], i) => el('button', { type: 'button', role: 'tab', class: i ? '' : 'on', 'data-tab': k, onclick: () => showTab(k) }, n)));
  $('#panels').append(tabs, develop, film, local);
}
function showTab(k) { $$('#panels .tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === k)); $$('#panels .tabbody').forEach(b => b.classList.toggle('hide', b.id !== 'tab-' + k)); }

function pickStock(s) {
  if (!st.cur) return; st.S.film = s.id;
  if (s.id !== 'none') { [st.S.grain, st.S.grainSize, st.S.grainRough, st.S.grainColor] = s.grain; st.S.halation = s.hal; if (st.S.filmAmt === 0) st.S.filmAmt = 100; }
  requestRender(); commit('Film · ' + s.name); syncUI();
}

/* ---------- left panel: looks, presets, history, info ---------- */
const LOOK_KEEP = ['temp', 'tint', 'exposure', 'nrLuma', 'nrColor', 'distort', 'caR', 'caB', 'lensVig', 'masks', 'spots', ...GEO_KEYS];
function applyLook(name, patch, keepTone) {
  if (!st.cur) return; const S = st.S, keep = {};
  for (const k of LOOK_KEEP) keep[k] = S[k];
  Object.assign(S, clone(DEF), keep, clone(patch));
  const f = STOCK_BY_ID[S.film]; if (f && f.id !== 'none' && !('grain' in patch)) { [S.grain, S.grainSize, S.grainRough, S.grainColor] = f.grain; }
  if (f && f.id !== 'none' && !('halation' in patch)) S.halation = f.hal;
  requestRender(); commit('Look · ' + name); syncUI();
}
function renderPresets() {
  const box = $('#presets'); box.replaceChildren();
  box.append(el('h4', { text: 'Looks' }), ...LOOKS.map(([n, p]) => el('button', { type: 'button', class: 'item', onclick: () => applyLook(n, p) }, n)));
  box.append(el('h4', { text: 'Your presets' }));
  if (!st.presets.length) box.append(el('p', { class: 'hint', text: 'Save the current edit as a preset to reuse it.' }));
  st.presets.forEach((p, i) => box.append(el('div', { class: 'itemrow' }, el('button', { type: 'button', class: 'item', onclick: () => applyLook(p.name, p.s) }, p.name),
    el('button', { type: 'button', class: 'x', title: 'Delete preset', 'aria-label': 'Delete preset ' + p.name, onclick: () => { st.presets.splice(i, 1); idb.set('kv', 'presets', st.presets); renderPresets(); } }, '×'))));
  box.append(el('div', { class: 'rowline' }, btn('Save current…', savePreset, 'tiny'), btn('Export', exportPresets, 'tiny', 'Save your presets to a file'), btn('Import', () => $('#presetFile').click(), 'tiny')));
}
function savePreset() {
  if (!st.cur) return; const name = prompt('Preset name'); if (!name) return;
  const d = diffSettings(st.S) || {}; for (const k of ['masks', 'spots', ...GEO_KEYS]) delete d[k];
  st.presets.push({ name, s: d }); idb.set('kv', 'presets', st.presets); renderPresets(); toast('Preset saved');
}
function exportPresets() { if (!st.presets.length) return toast('No presets to export yet'); downloadBlob(new Blob([JSON.stringify({ app: 'Emulsion', presets: st.presets }, null, 1)], { type: 'application/json' }), 'Emulsion presets.json'); }
async function importPresets(file) { try { const j = JSON.parse(await file.text()); if (!Array.isArray(j.presets)) throw 0; for (const p of j.presets) if (p && p.name && p.s) st.presets.push({ name: String(p.name), s: p.s }); idb.set('kv', 'presets', st.presets); renderPresets(); toast('Presets imported'); } catch (e) { toast('That is not an Emulsion presets file.', 'err'); } }
function renderHistory() {
  const box = $('#history'), p = st.cur; box.replaceChildren(); if (!p || !p.hist) return;
  for (let i = p.hist.length - 1; i >= 0; i--) box.append(el('button', { type: 'button', class: 'item' + (i === p.hi ? ' on' : '') + (i > p.hi ? ' dim' : ''), onclick: () => gotoHist(i) }, p.hist[i].label));
}
function renderInfo() {
  const box = $('#info'), p = st.cur; box.replaceChildren(); if (!p) return;
  const rows = [['File', p.name]]; if (p.folder) rows.push(['Folder', p.folder]);
  if (engine.src) rows.push(['Size', engine.src.w + ' × ' + engine.src.h + (st.srcFull ? '' : ' (preview)')]);
  const m = p.meta;
  if (m) {
    const cam = [m.camera_make, m.camera_model].filter(Boolean).join(' '); if (cam) rows.push(['Camera', cam]);
    const ex = []; if (m.shutter) ex.push(m.shutter >= 1 ? m.shutter.toFixed(1) + 's' : '1/' + Math.round(1 / m.shutter) + 's'); if (m.aperture) ex.push('f/' + (+m.aperture).toFixed(1)); if (m.iso_speed) ex.push('ISO ' + Math.round(m.iso_speed)); if (m.focal_len) ex.push(Math.round(m.focal_len) + 'mm');
    if (ex.length) rows.push(['Exposure', ex.join('  ')]);
  }
  rows.push(['Type', p.kind === 'raw' ? 'Raw (' + extOf(p.name).toUpperCase() + ')' : extOf(p.name).toUpperCase()]);
  for (const [k, v] of rows) box.append(el('div', { class: 'kv' }, el('span', { text: k }), el('b', { text: v })));
}
