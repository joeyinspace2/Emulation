'use strict';
/* ---------- settings model ---------- */
const z8 = () => [0, 0, 0, 0, 0, 0, 0, 0];
const DEF = {
  temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0, bw: false,
  curve: { rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] },
  hslH: z8(), hslS: z8(), hslL: z8(),
  grade: { sh: { h: 220, s: 0, l: 0 }, mid: { h: 40, s: 0, l: 0 }, hi: { h: 45, s: 0, l: 0 }, blend: 50, balance: 0 },
  sharpen: 0, sharpRadius: 1, sharpMask: 0, nrLuma: 0, nrColor: 0,
  distort: 0, caR: 0, caB: 0, lensVig: 0,
  vigAmount: 0, vigMid: 50, vigRound: 0, vigFeather: 50,
  film: 'none', filmAmt: 100,
  halation: 0, halThresh: 78, halRadius: 35, halHue: 12,
  bloom: 0, bloomThresh: 70, bloomRadius: 40,
  grain: 0, grainSize: 30, grainRough: 40, grainColor: 25,
  fade: 0, leak: 0, leakSeed: 1, leakHue: 22, dust: 0, scratches: 0, fxSeed: 1,
  border: 0, borderRound: 0, borderColor: 'white',
  lut: null, lutAmt: 100,
  scan: 'none',
  frontier: { d: 0, c: 0, m: 0, y: 0, hiTone: 0, shTone: 0, hyperHi: 2, hyperSh: 2, sat: 0, sharp: 2, grainSup: 2 },
  noritsu: { d: 0, c: 0, m: 0, y: 0, acOverall: 0, acShadow: 0, acHighlight: 0, chroma: 100, sharp: 4, grainSup: 10 },
  crop: { cx: 0.5, cy: 0.5, w: 1, h: 1 }, angle: 0, rot90: 0, flipH: false, flipV: false, aspect: 'free',
  masks: [], spots: []
};
const MASK_ADJ = { exposure: 0, contrast: 0, saturation: 0, clarity: 0, temp: 0, tint: 0 };
const GEO_KEYS = ['crop', 'angle', 'rot90', 'flipH', 'flipV', 'aspect'];
const clone = o => JSON.parse(JSON.stringify(o));
const newSettings = () => clone(DEF);
/* fill in anything missing (older catalogs, partial presets) */
function normalize(S) {
  const out = clone(DEF);
  for (const k in S) if (k in out) out[k] = (S[k] && typeof S[k] === 'object' && !Array.isArray(S[k]) && out[k]) ? Object.assign(out[k], clone(S[k])) : clone(S[k]);
  return out;
}
function diffSettings(S) { const d = {}; let n = 0; for (const k in DEF) if (JSON.stringify(S[k]) !== JSON.stringify(DEF[k])) { d[k] = S[k]; n++; } return n ? d : null; }

/* ---------- film stocks ----------
   Original emulations tuned by eye. Names describe the look they aim for; they are not manufacturer profiles. */
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function stock(id, name, group, desc, p) {
  const u = v => Array.isArray(v) ? v : [v, v, v];
  return {
    id, name, group, desc, m: p.m || I3, gamma: u(p.gamma ?? 1), lo: u(p.lo ?? 0), hi: u(p.hi ?? 1), sh: p.sh || [0, 0, 0], hl: p.hl || [0, 0, 0],
    sat: p.sat ?? 1, shoulder: p.shoulder ?? 0.4, exp: p.exp ?? 0, mono: p.mono || null, tone: p.tone || [1, 1, 1],
    grain: p.grain || [0, 30, 40, 25], hal: p.hal || 0
  };
}
const FILM_NONE = stock('none', 'None', '', 'No film emulation', {});
const STOCKS = [
  FILM_NONE,
  stock('port400', 'Portrait 400', 'Colour negative', 'Soft contrast, warm skin, pastel greens', { m: [1.03, 0, -0.03, -0.01, 1, 0.01, -0.02, 0.06, 0.96], gamma: [1.05, 1.05, 1.02], lo: [0.035, 0.03, 0.04], hi: [1, 0.985, 0.95], sh: [0, 0.006, 0.012], hl: [0.012, 0.006, -0.01], sat: 0.9, shoulder: 0.55, grain: [22, 32, 35, 25], hal: 12 }),
  stock('port800', 'Portrait 800', 'Colour negative', 'Punchier, warmer, visible grain', { m: [1.05, 0, -0.05, -0.01, 1, 0.01, -0.02, 0.05, 0.97], gamma: [1.14, 1.12, 1.08], lo: [0.045, 0.038, 0.045], hi: [1, 0.98, 0.93], sh: [0.004, 0.004, 0.012], hl: [0.016, 0.006, -0.014], sat: 0.96, shoulder: 0.6, grain: [38, 40, 45, 30], hal: 18 }),
  stock('gold200', 'Golden 200', 'Colour negative', 'Sunny yellows, saturated reds, holiday snapshots', { m: [1.06, 0.02, -0.08, 0, 1.02, -0.02, -0.03, 0.02, 1.01], gamma: [1.16, 1.12, 1.08], lo: [0.03, 0.025, 0.02], hi: [1, 0.98, 0.9], sh: [0.01, 0.004, -0.004], hl: [0.02, 0.01, -0.02], sat: 1.12, shoulder: 0.5, grain: [26, 34, 40, 30], hal: 15 }),
  stock('vivid100', 'Vivid 100', 'Colour negative', 'Fine grain, deep saturated colour', { m: [1.1, -0.06, -0.04, -0.04, 1.08, -0.04, -0.02, -0.08, 1.1], gamma: 1.24, lo: 0.01, sat: 1.28, shoulder: 0.35, grain: [10, 22, 30, 20], hal: 5 }),
  stock('mint400', 'Mint 400', 'Colour negative', 'Airy, cool greens and soft highlights', { m: [1, 0, 0, -0.03, 1.02, 0.01, 0, 0.06, 0.94], gamma: 1.0, lo: [0.04, 0.045, 0.045], hi: [0.97, 1, 0.98], sh: [-0.004, 0.012, 0.01], hl: [0, 0.008, 0.004], sat: 0.88, shoulder: 0.6, exp: 0.2, grain: [20, 30, 35, 25], hal: 8 }),
  stock('super400', 'Drugstore 400', 'Colour negative', 'Green-leaning shadows, hard consumer contrast', { m: [1.06, -0.04, -0.02, -0.02, 1.04, -0.02, 0, -0.02, 1.02], gamma: [1.2, 1.18, 1.16], lo: [0.02, 0.03, 0.025], sh: [-0.006, 0.012, 0.004], hl: [0.01, 0, -0.006], sat: 1.1, shoulder: 0.4, grain: [30, 36, 45, 35], hal: 14 }),
  stock('cine250', 'Cine 250D', 'Motion picture', 'Daylight cinema stock: teal shadows, warm skin', { m: [1.02, 0, -0.02, -0.02, 1, 0.02, -0.02, 0.06, 0.96], gamma: 1.1, lo: 0.03, hi: [1, 0.985, 0.95], sh: [-0.008, 0.006, 0.014], hl: [0.016, 0.008, -0.012], sat: 0.98, shoulder: 0.7, grain: [18, 28, 35, 25], hal: 25 }),
  stock('cine500', 'Cine 500T', 'Motion picture', 'Tungsten stock: cool, cyan-blue cast, glowing lights', { m: [1.02, 0, -0.02, -0.02, 1, 0.02, -0.02, 0.08, 0.94], gamma: 1.08, lo: [0.03, 0.04, 0.055], hi: [0.96, 0.98, 1], sh: [-0.01, 0.008, 0.025], hl: [0.015, 0.005, -0.015], sat: 0.92, shoulder: 0.75, grain: [34, 36, 42, 28], hal: 45 }),
  stock('cine800', 'Cine 800T Night', 'Motion picture', 'Pushed tungsten with heavy red halation', { m: [1.04, 0, -0.04, -0.03, 1, 0.03, -0.03, 0.1, 0.93], gamma: 1.18, lo: [0.035, 0.045, 0.065], hi: [0.97, 0.98, 1], sh: [-0.014, 0.008, 0.032], hl: [0.02, 0.004, -0.018], sat: 1.0, shoulder: 0.8, exp: 0.15, grain: [48, 42, 50, 32], hal: 80 }),
  stock('chrome100', 'Chrome 100', 'Slide', 'Neutral transparency: crisp, clean, true colour', { gamma: 1.3, sat: 1.14, sh: [0, 0, 0.008], shoulder: 0.2, grain: [8, 20, 25, 15], hal: 4 }),
  stock('velvet50', 'Velvet 50', 'Slide', 'Extreme saturation and contrast for landscapes', { m: [1.12, -0.08, -0.04, -0.06, 1.12, -0.06, -0.04, -0.1, 1.14], gamma: 1.45, sat: 1.4, sh: [0.004, -0.004, 0.01], shoulder: 0.15, grain: [6, 18, 25, 15], hal: 3 }),
  stock('classic64', 'Classic 64', 'Slide', 'Mid-century magazine colour: rich reds, deep blues', { m: [1.1, -0.05, -0.05, -0.02, 1, 0.02, -0.04, -0.02, 1.06], gamma: 1.34, hi: [1, 0.98, 0.94], sh: [0, 0, 0.01], sat: 1.1, shoulder: 0.2, grain: [12, 24, 30, 20], hal: 6 }),
  stock('xpro', 'Cross Process', 'Experimental', 'Slide film in negative chemistry: acid greens and yellows', { gamma: [1.4, 1.3, 1.1], lo: [0, 0.02, 0.06], hi: [1, 1, 0.82], sh: [-0.02, 0.02, 0.04], hl: [0.03, 0.03, -0.05], sat: 1.25, shoulder: 0.3, grain: [25, 34, 45, 35], hal: 10 }),
  stock('instant', 'Instant 600', 'Experimental', 'Soft, milky instant print', { gamma: 0.92, lo: [0.07, 0.065, 0.08], hi: [0.96, 0.95, 0.88], sh: [0, 0.01, 0.03], hl: [0.02, 0.01, -0.02], sat: 0.85, shoulder: 0.8, grain: [15, 40, 30, 20], hal: 10 }),
  stock('expired', 'Expired', 'Experimental', 'Fogged base, magenta shadows, washed colour', { gamma: 0.95, lo: [0.09, 0.06, 0.07], hi: [0.94, 0.9, 0.8], sh: [0.03, 0, 0.02], hl: [0.01, 0.01, -0.02], sat: 0.8, shoulder: 0.7, grain: [45, 45, 60, 45], hal: 20 }),
  stock('bw400', 'Press 400', 'Black & white', 'Classic reportage: strong blacks, gritty grain', { mono: [0.3, 0.55, 0.15], gamma: 1.3, lo: 0.02, shoulder: 0.5, grain: [40, 38, 55, 0], hal: 10 }),
  stock('bwsoft', 'Classic 400', 'Black & white', 'Long tonal scale, gentle contrast', { mono: [0.26, 0.6, 0.14], gamma: 1.12, lo: 0.035, hi: 0.98, shoulder: 0.65, grain: [32, 36, 45, 0], hal: 8 }),
  stock('bwfine', 'Fine 100', 'Black & white', 'Smooth, sharp, nearly grainless', { mono: [0.24, 0.62, 0.14], gamma: 1.2, lo: 0.01, shoulder: 0.4, grain: [10, 18, 25, 0], hal: 4 }),
  stock('bw3200', 'Push 3200', 'Black & white', 'Pushed hard: crushed blacks, coarse grain', { mono: [0.32, 0.54, 0.14], gamma: 1.55, lo: 0.04, shoulder: 0.3, exp: 0.2, grain: [80, 60, 70, 0], hal: 18 }),
  stock('ortho', 'Ortho', 'Black & white', 'Red-blind emulsion: dark skin tones and lips, pale skies', { mono: [0.04, 0.6, 0.36], gamma: 1.3, lo: 0.02, shoulder: 0.4, grain: [25, 28, 40, 0], hal: 12 }),
  stock('infra', 'Infrared', 'Black & white', 'Glowing foliage, black skies', { mono: [1.05, 0.35, -0.4], gamma: 1.35, lo: 0.02, shoulder: 0.6, grain: [45, 44, 55, 0], hal: 55 }),
  stock('sepia', 'Sepia Print', 'Black & white', 'Warm toned darkroom print', { mono: [0.28, 0.58, 0.14], gamma: 1.15, lo: [0.05, 0.04, 0.03], hi: [1, 0.97, 0.88], tone: [1.04, 1, 0.9], shoulder: 0.6, grain: [28, 34, 45, 0], hal: 8 }),
  stock('cyan', 'Cyanotype', 'Black & white', 'Prussian-blue sun print', { mono: [0.25, 0.6, 0.15], gamma: 1.2, lo: [0.02, 0.07, 0.18], hi: [0.9, 0.96, 1], sh: [-0.02, 0.01, 0.04], shoulder: 0.5, grain: [18, 30, 40, 0], hal: 0 })
];
const STOCK_BY_ID = Object.fromEntries(STOCKS.map(s => [s.id, s]));

/* ---------- lab scanners ----------
   A minilab scanner is the second half of a film photograph: it lights the developed film, meters it,
   and renders the positive with its own tone curve, colour response, dynamic-range compression and sharpening.
   These are models of the published controls and the widely described character of each machine.
   They are not measured profiles and are not affiliated with either manufacturer.

   Both machines correct colour the way a darkroom printer does, by changing the exposure each colour
   layer receives before the tone curve. One density key is 1/6 stop; one colour key is 1/12 stop. */
const SCANNERS = [
  { id: 'none', name: 'None', desc: 'No scanner stage: the standard rendering.' },
  { id: 'frontier', name: 'Frontier SP-3000', desc: 'Fujifilm minilab scanner. Punchy contrast, deep blacks, cool cyan shadows, golden skin, crisp edges over smoothed grain.',
    // Narrow-band red, green and blue LEDs give strong colour separation; reds lean yellow, greens lean cyan.
    m: [1.04, -0.03, -0.01, -0.02, 1.04, -0.02, -0.035, 0.04, 0.995],
    con: 1.08, black: 0.018, white: 0.965, knee: 0.97, shT: [-0.004, 0.001, 0.003], hlT: [0.003, 0.001, -0.004], sat: 1.05,
    edge: [0.035, 0.11], floor: 0.12 },
  { id: 'noritsu', name: 'Noritsu HS-1800', desc: 'Noritsu line-sensor scanner. Gentler contrast, open shadows and held highlights, neutral shadows, pinker skin, sharpening that keeps the grain.',
    // Broader colour response: reds lean pink, greens lean yellow.
    m: [1.0, 0.04, -0.04, -0.02, 1.02, 0, 0.02, -0.03, 1.01],
    con: 0.95, black: -0.015, white: 0.99, knee: 0.9, shT: [0.001, 0, -0.001], hlT: [0.004, -0.002, 0], sat: 0.99,
    edge: [0.015, 0.06], floor: 0.65 }
];
/* Each machine's own controls: [min, max]. All are whole steps, as on the machines. */
const KEYS = { d: [-15, 15], c: [-15, 15], m: [-15, 15], y: [-15, 15] };
const SCAN_RANGES = {
  frontier: { ...KEYS, hiTone: [-1, 1], shTone: [-1, 1], hyperHi: [0, 4], hyperSh: [0, 4], sat: [-5, 5], sharp: [0, 5], grainSup: [0, 5] },
  noritsu: { ...KEYS, acOverall: [-5, 5], acShadow: [-5, 5], acHighlight: [-5, 5], chroma: [0, 200], sharp: [0, 10], grainSup: [0, 50] }
};
const SCANNER_BY_ID = Object.fromEntries(SCANNERS.map(s => [s.id, s]));
const TONE_STEP = [0.87, 1, 1.15]; // soft, standard, hard
/* Settings -> the numbers the scan pass uses. null means no scanner stage. */
function scanParams(S, mono) {
  const sc = SCANNER_BY_ID[S.scan]; if (!sc || sc.id === 'none') return null;
  const k = S[sc.id], zero = [0, 0, 0];
  // + density prints darker; + cyan, magenta or yellow adds that colour by holding back red, green or blue.
  const gain = [k.c, k.m, k.y].map(v => Math.pow(2, -(k.d / 6 + v / 12)));
  const out = { id: sc.id, m: sc.m, gain, black: sc.black, white: sc.white, knee: sc.knee, shT: mono ? zero : sc.shT, hlT: mono ? zero : sc.hlT, edge: sc.edge, floor: sc.floor };
  if (sc.id === 'frontier') {
    // Tone adjustment (soft / standard / hard, separately for shadows and highlights) and Hypertone levels.
    out.kS = sc.con * TONE_STEP[k.shTone + 1]; out.kH = sc.con * TONE_STEP[k.hiTone + 1];
    out.hyS = k.hyperSh * 0.17; out.hyH = k.hyperHi * 0.08;
    out.sat = sc.sat * (1 + k.sat * 0.05); out.sharp = k.sharp * 0.35; out.grainSup = k.grainSup * 0.18;
  } else {
    // Auto contrast: overall flattens the curve; shadow and highlight open or hold each end.
    out.kS = out.kH = sc.con * (1 - 0.025 * k.acOverall);
    out.hyS = Math.max(0, 0.3 + 0.07 * k.acShadow); out.hyH = Math.max(0, 0.14 + 0.07 * k.acHighlight);
    out.sat = sc.sat * k.chroma / 100; out.sharp = k.sharp * 0.22; out.grainSup = k.grainSup / 50 * 0.9;
  }
  if (mono) out.m = I3;
  return out;
}

/* ---------- built-in looks ---------- */
const LOOKS = [
  ['Clean boost', { contrast: 12, vibrance: 18, clarity: 8, shadows: 10, highlights: -15, sharpen: 30 }],
  ['Matte fade', { contrast: -8, fade: 45, blacks: 20, saturation: -12, grain: 12, curve: { rgb: [[0, 0.06], [0.3, 0.28], [0.75, 0.78], [1, 0.95]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] } }],
  ['Sunday negative', { film: 'port400', grain: 22, grainSize: 32, halation: 12, exposure: 0.2, shadows: 12 }],
  ['Golden hour', { film: 'gold200', temp: 14, halation: 22, bloom: 12, grain: 26, vigAmount: -12 }],
  ['Night neon', { film: 'cine800', halation: 85, halRadius: 45, halThresh: 70, bloom: 18, grain: 48, grainSize: 42, contrast: 8, vigAmount: -18 }],
  ['Cinema day', { film: 'cine250', halation: 28, grain: 18, grade: { sh: { h: 200, s: 18, l: 0 }, mid: { h: 40, s: 0, l: 0 }, hi: { h: 38, s: 14, l: 0 }, blend: 60, balance: 0 }, vigAmount: -10 }],
  ['Teal & orange', { grade: { sh: { h: 195, s: 45, l: -4 }, mid: { h: 30, s: 10, l: 0 }, hi: { h: 32, s: 35, l: 0 }, blend: 60, balance: 5 }, contrast: 14, vibrance: 12 }],
  ['Slide punch', { film: 'velvet50', clarity: 10, sharpen: 35, vigAmount: -8 }],
  ['Dreamy mist', { bloom: 45, bloomThresh: 25, bloomRadius: 70, contrast: -10, highlights: -20, fade: 15, grain: 10 }],
  ['Disposable camera', { film: 'super400', grain: 40, grainSize: 45, halation: 20, vigAmount: -32, vigMid: 40, leak: 28, dust: 22, contrast: 12, sharpen: 0 }],
  ['Instant day', { film: 'instant', border: 38, borderColor: 'cream', vigAmount: -15, fade: 10, grain: 15 }],
  ['Newsprint', { film: 'bw3200', grain: 85, grainSize: 60, contrast: 18, clarity: 18, vigAmount: -20 }],
  ['Silver portrait', { film: 'bwsoft', grain: 30, halation: 10, clarity: -8, vigAmount: -12 }],
  ['Found in the attic', { film: 'expired', grain: 50, dust: 55, scratches: 45, leak: 40, fade: 30, vigAmount: -25, border: 20, borderColor: 'cream', borderRound: 40 }]
];

/* ---------- .cube 3D LUT parser ---------- */
function parseCube(text) {
  let size = 0; const vals = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim(); if (!t || t[0] === '#') continue;
    if (/^LUT_3D_SIZE/i.test(t)) { size = parseInt(t.split(/\s+/)[1]); continue; }
    if (/^LUT_1D_SIZE/i.test(t)) throw new Error('1D LUTs are not supported, only 3D .cube files.');
    if (/^[A-Za-z_]/.test(t)) continue;
    const p = t.split(/\s+/); if (p.length >= 3) vals.push(+p[0], +p[1], +p[2]);
  }
  if (!size || vals.length !== size * size * size * 3) throw new Error('Not a valid 3D .cube LUT.');
  return { size, data: new Float32Array(vals) };
}

/* Pure model access for the local recipe validator and agent CLI. */
if (typeof module !== 'undefined' && module.exports) module.exports = { DEF, newSettings, STOCKS, LOOKS, MASK_ADJ, SCANNERS, SCAN_RANGES, scanParams };
