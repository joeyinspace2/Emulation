'use strict';
/* ---------- 3x3 affine helpers (row-major, p' = M p) ---------- */
const M3 = {
  mul(a, b) { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; },
  tr: (x, y) => [1, 0, x, 0, 1, y, 0, 0, 1],
  sc: (x, y) => [x, 0, 0, 0, y, 0, 0, 0, 1],
  rot: a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; },
  ap: (m, x, y) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]],
  inv(m) { const [a, b, c, d, e, f] = m, det = a * e - b * d; return [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det, 0, 0, 1]; },
  gl: m => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]),
  chain(...ms) { return ms.reduce((a, b) => M3.mul(a, b)); }
};

/* Output uv -> source uv for the current crop / rotation / flips. */
function geoInfo(S, sw, sh, uncropped) {
  const r = S.rot90 & 3, ow = r & 1 ? sh : sw, oh = r & 1 ? sw : sh;
  let cw = ow, ch = oh, cx = ow / 2, cy = oh / 2, a = 0;
  if (!uncropped) { cw = S.crop.w * ow; ch = S.crop.h * oh; cx = S.crop.cx * ow; cy = S.crop.cy * oh; a = S.angle * Math.PI / 180; }
  let m = M3.chain(M3.sc(1 / ow, 1 / oh), M3.tr(cx, cy), M3.rot(a), M3.sc(cw, ch), M3.tr(-0.5, -0.5));
  if (S.flipH) m = M3.mul([-1, 0, 1, 0, 1, 0, 0, 0, 1], m);
  if (S.flipV) m = M3.mul([1, 0, 0, 0, -1, 1, 0, 0, 1], m);
  const R = [[1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 1, 0, -1, 0, 1, 0, 0, 1], [-1, 0, 1, 0, -1, 1, 0, 0, 1], [0, -1, 1, 1, 0, 0, 0, 0, 1]][r];
  m = M3.mul(R, m);
  return { M: m, Minv: M3.inv(m), outW: Math.max(1, Math.round(cw)), outH: Math.max(1, Math.round(ch)), ow, oh };
}

function wbMul(temp, tint) {
  const T = temp / 100 * 0.5, G = tint / 100 * 0.35;
  const w = [Math.pow(2, T), Math.pow(2, -G), Math.pow(2, -T)];
  const l = 0.2126 * w[0] + 0.7152 * w[1] + 0.0722 * w[2];
  return [w[0] / l, w[1] / l, w[2] / l];
}
function hsv2rgb(h, s, v) { const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; }
function gradeOffset(g) { const c = hsv2rgb(((g.h % 360) + 360) % 360 / 360, 1, 1), l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], k = g.s / 100 * 0.3; return [(c[0] - l) * k, (c[1] - l) * k, (c[2] - l) * k]; }

/* Monotone cubic through control points -> 256 samples */
function curveLUT(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0]), n = p.length, out = new Float32Array(256);
  if (n < 2) { for (let i = 0; i < 256; i++) out[i] = i / 255; return out; }
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (p[i + 1][1] - p[i][1]) / Math.max(1e-6, p[i + 1][0] - p[i][0]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
  let k = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    if (x <= p[0][0]) { out[i] = p[0][1]; continue; }
    if (x >= p[n - 1][0]) { out[i] = p[n - 1][1]; continue; }
    while (k < n - 2 && x > p[k + 1][0]) k++;
    const h = p[k + 1][0] - p[k][0], t = (x - p[k][0]) / h, t2 = t * t, t3 = t2 * t;
    out[i] = Math.min(1, Math.max(0, (2 * t3 - 3 * t2 + 1) * p[k][1] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * p[k + 1][1] + (t3 - t2) * h * m[k + 1]));
  }
  return out;
}
const curveIsId = c => ['rgb', 'r', 'g', 'b'].every(k => c[k].length === 2 && c[k][0][0] === 0 && c[k][0][1] === 0 && c[k][1][0] === 1 && c[k][1][1] === 1);

/* ---------- WebGL2 engine ---------- */
class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This GPU/browser cannot render to floating-point textures.');
    gl.getExtension('OES_texture_float_linear');
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.P = {}; this.T = {}; this.maskTex = new Map(); this.src = null; this.srcN = 0; this.lut = null; this.luts = new Map();
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    this.dummy = this.tex2d(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]), gl.NEAREST);
    this.dummy3 = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, this.dummy3);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.curveTex = this.tex2d(256, 1, gl.RGBA16F, gl.RGBA, gl.FLOAT, null, gl.LINEAR);
    this.invalidate();
  }
  invalidate() { this.kG = this.kD = this.kCurve = null; }
  tex2d(w, h, ifmt, fmt, type, data, filter) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  /* named render targets, reallocated when the size changes */
  rt(name, w, h, kind) {
    const gl = this.gl; let t = this.T[name];
    if (t && t.w === w && t.h === h && t.kind === kind) return t;
    if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    const tex = kind === 'u8' ? this.tex2d(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR) : this.tex2d(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.LINEAR);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Could not allocate a ' + w + '×' + h + ' render target (out of GPU memory?)');
    return this.T[name] = { tex, fb, w, h, kind };
  }
  trim() { const gl = this.gl; for (const k in this.T) { gl.deleteTexture(this.T[k].tex); gl.deleteFramebuffer(this.T[k].fb); } this.T = {}; this.invalidate(); }
  prog(name) {
    if (this.P[name]) return this.P[name];
    const gl = this.gl, mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader "' + name + '": ' + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS_HEAD + SH[name]));
    gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link "' + name + '": ' + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const inf = gl.getActiveUniform(p, i); u[inf.name.replace(/\[0\]$/, '')] = { loc: gl.getUniformLocation(p, inf.name), type: inf.type, size: inf.size }; }
    return this.P[name] = { p, u };
  }
  draw(target, name, uni) {
    const gl = this.gl, P = this.prog(name);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    gl.useProgram(P.p); let unit = 0;
    for (const k in P.u) {
      const d = P.u[k]; let v = uni[k];
      switch (d.type) {
        case gl.SAMPLER_2D: case gl.UNSIGNED_INT_SAMPLER_2D: gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v || this.dummy); gl.uniform1i(d.loc, unit++); break;
        case gl.SAMPLER_3D: gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_3D, v || this.dummy3); gl.uniform1i(d.loc, unit++); break;
        case gl.FLOAT: if (v === undefined) v = 0; d.size > 1 ? gl.uniform1fv(d.loc, v) : gl.uniform1f(d.loc, v); break;
        case gl.INT: case gl.BOOL: if (v === undefined) v = 0; d.size > 1 ? gl.uniform1iv(d.loc, v) : gl.uniform1i(d.loc, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(d.loc, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(d.loc, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(d.loc, v); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(d.loc, false, M3.gl(v)); break;
      }
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ----- sources ----- */
  makeSource(spec) {
    const gl = this.gl; let tex, w, h;
    if (spec.kind === 'raw') {
      w = spec.w; h = spec.h;
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > this.maxTex || h > this.maxTex) throw new Error('Decoded RAW dimensions exceed this browser GPU limit (' + this.maxTex + ' px per edge).');
      if (!(spec.data instanceof Uint16Array) || spec.data.length < w * h * 3) throw new Error('Decoded RAW pixels are incomplete.');
      const it = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, it);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16UI, w, h, 0, gl.RGB_INTEGER, gl.UNSIGNED_SHORT, spec.data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      tex = this.tex2d(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.LINEAR);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.draw({ fb, w, h }, 'convert', { u_t: it });
      gl.deleteFramebuffer(fb); gl.deleteTexture(it);
    } else {
      w = spec.bitmap.width; h = spec.bitmap.height;
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, spec.bitmap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const uploadError = gl.getError();
    if (uploadError !== gl.NO_ERROR) { gl.deleteTexture(tex); throw new Error('GPU image upload failed (WebGL ' + uploadError + '). Try a smaller photo or reload the editor.'); }
    return { tex, w, h, gain: spec.gain || 1, base: spec.kind === 'raw' ? 1 : 0, id: ++this.srcN };
  }
  freeSource(s) { if (s) this.gl.deleteTexture(s.tex); }
  setSource(s) { if (this.src && this.src !== s) this.freeSource(this.src); this.src = s; this.invalidate(); }

  setLut(name, lut) { // lut: {size, data: Float32Array rgb}
    const gl = this.gl;
    if (!lut) return null;
    let t = this.luts.get(name);
    if (!t) {
      t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
      this.luts.set(name, t);
    }
    return t;
  }
  updateMask(id, canvas) {
    const gl = this.gl; let t = this.maskTex.get(id);
    if (!t) { t = gl.createTexture(); this.maskTex.set(id, t); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
    gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }
  dropMask(id) { const t = this.maskTex.get(id); if (t) { this.gl.deleteTexture(t); this.maskTex.delete(id); } }

  /* blur `src` (w×h) with a gaussian of `sigma` px (measured at w×h); result may be lower resolution */
  blur(name, src, w, h, sigma, prep) {
    let lvl = 0; while (sigma / (1 << lvl) > 3.3) lvl++;
    let cur = src, cw = w, ch = h;
    if (lvl === 0 && prep) { const t = this.rt(name + '_d0', cw, ch, 'f16'); this.draw(t, 'down', { u_t: cur, u_prep: 1 }); cur = t.tex; }
    for (let i = 1; i <= lvl; i++) { cw = Math.max(1, Math.ceil(cw / 2)); ch = Math.max(1, Math.ceil(ch / 2)); const t = this.rt(name + '_d' + i, cw, ch, 'f16'); this.draw(t, 'down', { u_t: cur, u_prep: prep && i === 1 ? 1 : 0 }); cur = t.tex; }
    const s = Math.max(0.6, sigma / (1 << lvl));
    const th = this.rt(name + '_h', cw, ch, 'f16'); this.draw(th, 'gauss', { u_t: cur, u_dir: [1 / cw, 0], u_sigma: s });
    const tv = this.rt(name, cw, ch, 'f16'); this.draw(tv, 'gauss', { u_t: th.tex, u_dir: [0, 1 / ch], u_sigma: s });
    return tv.tex;
  }

  /* Run the full pipeline. Returns the display-encoded result. */
  render(S, scale, o = {}) {
    const src = this.src; if (!src) return null;
    const g = geoInfo(S, src.w, src.h, o.uncropped);
    const cap = Math.min(1, this.maxTex / Math.max(g.outW, g.outH)); scale = Math.min(scale, cap);
    const W = Math.max(1, Math.round(g.outW * scale)), H = Math.max(1, Math.round(g.outH * scale)), long = Math.max(W, H);
    const film = o.film || FILM_NONE;
    // 1. geometry, lens, healing
    const spots = (S.spots || []).slice(0, 16), sp = new Float32Array(64), ss = new Float32Array(64);
    spots.forEach((s, i) => { sp.set([s.x, s.y, s.r, s.f], i * 4); ss.set([s.sx, s.sy, s.o, 0], i * 4); });
    const kG = JSON.stringify([src.id, W, H, g.M, S.distort, S.caR, S.caB, S.lensVig, spots]);
    const G = this.rt('G', W, H, 'f16');
    if (kG !== this.kG) {
      this.draw(G, 'geo', { u_src: src.tex, u_M: g.M, u_srcSize: [src.w, src.h], u_gain: src.gain, u_distort: S.distort / 100 * 0.25, u_ca: [S.caR / 100 * 0.006, S.caB / 100 * 0.006], u_lensVig: S.lensVig / 100 * 0.6, u_nSpots: spots.length, u_spot: sp, u_spotSrc: ss });
      this.kG = kG; this.kD = null;
    }
    // 2. noise reduction + the two blur radii used for local contrast
    const nr = S.nrLuma > 0 || S.nrColor > 0, kD = kG + '|' + S.nrLuma + ',' + S.nrColor;
    if (kD !== this.kD) {
      let D = G;
      if (nr) { D = this.rt('D', W, H, 'f16'); this.draw(D, 'denoise', { u_t: G.tex, u_px: [1 / W, 1 / H], u_nl: S.nrLuma / 100, u_nc: S.nrColor / 100 }); }
      this.Dtex = D.tex;
      this.b1 = this.blur('b1', D.tex, W, H, long * 0.0028, false);
      this.b2 = this.blur('b2', D.tex, W, H, long * 0.022, true);
      this.kD = kD;
    }
    // 3. develop
    const kC = JSON.stringify(S.curve);
    if (kC !== this.kCurve) {
      const gl = this.gl, m = curveLUT(S.curve.rgb), r = curveLUT(S.curve.r), gg = curveLUT(S.curve.g), b = curveLUT(S.curve.b), d = new Float32Array(1024), at = (l, x) => { const f = Math.min(255, Math.max(0, x * 255)), i = Math.floor(f), j = Math.min(255, i + 1); return l[i] + (l[j] - l[i]) * (f - i); };
      for (let i = 0; i < 256; i++) { d[i * 4] = at(r, m[i]); d[i * 4 + 1] = at(gg, m[i]); d[i * 4 + 2] = at(b, m[i]); d[i * 4 + 3] = 1; }
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 1, 0, gl.RGBA, gl.FLOAT, d);
      this.kCurve = kC; this.curveOn = curveIsId(S.curve) ? 0 : 1;
    }
    const masks = (S.masks || []).slice(0, 6), mType = new Int32Array(6), mA = new Float32Array(24), mB = new Float32Array(24), mAdj = new Float32Array(24), mWb = new Float32Array(18), mT = [];
    mWb.fill(1);
    masks.forEach((m, i) => {
      if (m.off) return;
      mType[i] = m.type === 'linear' ? 1 : m.type === 'radial' ? 2 : 3;
      mA.set(m.a || [0, 0, 0, 0], i * 4); mB.set([Math.max(0.001, m.feather / 100), m.invert ? 1 : 0, m.amount / 100, 0], i * 4);
      const a = m.adj; mAdj.set([a.exposure, a.contrast / 100, a.saturation / 100, a.clarity / 100], i * 4); mWb.set(wbMul(a.temp, a.tint), i * 3);
      mT[i] = this.maskTex.get(m.id);
    });
    const gr = S.grade, gradeOn = (gr.sh.s || gr.mid.s || gr.hi.s || gr.sh.l || gr.mid.l || gr.hi.l) ? 1 : 0;
    const hslOn = (S.hslH.some(v => v) || S.hslS.some(v => v) || S.hslL.some(v => v)) ? 1 : 0;
    const A = this.rt('A', W, H, 'f16');
    this.draw(A, 'develop', {
      u_img: this.Dtex, u_b1: this.b1, u_b2: this.b2, u_curve: this.curveTex, u_px: [1 / W, 1 / H], u_M: g.M, u_srcSize: [src.w, src.h],
      u_mT0: mT[0], u_mT1: mT[1], u_mT2: mT[2], u_mT3: mT[3], u_mT4: mT[4], u_mT5: mT[5],
      u_wb: wbMul(S.temp, S.tint), u_exp: S.exposure, u_con: S.contrast / 100, u_hi: S.highlights / 100, u_sh: S.shadows / 100, u_wh: S.whites / 100, u_bl: S.blacks / 100,
      u_tex: S.texture / 100, u_cla: S.clarity / 100, u_deh: S.dehaze / 100, u_vib: S.vibrance / 100, u_sat: S.saturation / 100, u_base: src.base,
      u_sharp: [S.sharpen / 100, S.sharpRadius * Math.max(0.6, scale * 1.0 + 0.0), S.sharpMask / 100],
      u_hH: S.hslH.map(v => v / 100), u_hS: S.hslS.map(v => v / 100), u_hL: S.hslL.map(v => v / 100), u_hslOn: hslOn, u_bw: S.bw ? 1 : 0, u_curveOn: this.curveOn, u_gradeOn: gradeOn,
      u_gS: gradeOffset(gr.sh), u_gM: gradeOffset(gr.mid), u_gH: gradeOffset(gr.hi), u_gLum: [gr.sh.l / 100, gr.mid.l / 100, gr.hi.l / 100], u_gBal: gr.balance / 100, u_gBlend: gr.blend / 100,
      u_mType: mType, u_mA: mA, u_mB: mB, u_mAdj: mAdj, u_mWb: mWb, u_selMask: o.selMask == null ? -1 : o.selMask
    });
    // 4. halation & bloom
    let h1 = null, h2 = null, bm = null; const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2), hl = Math.max(hw, hh);
    const thr = t => { const v = t / 100; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    if (S.halation > 0) {
      const x = this.rt('hx', hw, hh, 'f16'); this.draw(x, 'extract', { u_t: A.tex, u_thr: thr(S.halThresh), u_knee: 0.12 * thr(S.halThresh) + 0.01 });
      const s = hl * (0.002 + S.halRadius / 100 * 0.012);
      h1 = this.blur('h1', x.tex, hw, hh, s, false); h2 = this.blur('h2', x.tex, hw, hh, s * 3.2, false);
    }
    if (S.bloom > 0) {
      const x = this.rt('bx', hw, hh, 'f16'); this.draw(x, 'extract', { u_t: A.tex, u_thr: thr(S.bloomThresh), u_knee: 0.3 * thr(S.bloomThresh) + 0.01 });
      bm = this.blur('bm', x.tex, hw, hh, hl * (0.004 + S.bloomRadius / 100 * 0.04), false);
    }
    // 5. film, finishing
    const lutTex = S.lut && o.lut ? this.setLut(S.lut, o.lut) : null;
    const scan = scanParams(S, !!film.mono || S.bw);
    const border = { u_border: o.uncropped ? 0 : S.border / 100 * 0.18, u_borderRound: S.borderRound / 100, u_borderCol: S.borderColor === 'black' ? [0.02, 0.02, 0.02] : S.borderColor === 'cream' ? [0.96, 0.94, 0.88] : [1, 1, 1], u_full: [g.outW, g.outH] };
    // With a scanner, the film frame is finished at full precision and the scan pass makes the final image.
    const F = this.rt('F', W, H, 'u8'), filmOut = scan ? this.rt('Fs', W, H, 'f16') : F;
    const ht = hsv2rgb(((S.halHue % 360) + 360) % 360 / 360, 0.85, 1);
    this.draw(filmOut, 'finish', {
      u_a: A.tex, u_h1: h1, u_h2: h2, u_bm: bm, u_lut: lutTex, u_lutAmt: lutTex ? S.lutAmt / 100 : 0,
      u_halTint: ht, u_halAmt: h1 ? S.halation / 100 * 1.6 : 0, u_bloomAmt: bm ? S.bloom / 100 * 0.9 : 0,
      u_filmAmt: film.id === 'none' ? 0 : S.filmAmt / 100, u_fSat: film.sat, u_fShoulder: film.shoulder, u_fExp: film.exp, u_fMono: film.mono ? 1 : 0,
      u_fM: film.m, u_fGamma: film.gamma, u_fLo: film.lo, u_fHi: film.hi, u_fShT: film.sh, u_fHiT: film.hl, u_fMonoW: film.mono || [0.3, 0.6, 0.1], u_fTone: film.tone,
      u_vig: [S.vigAmount / 100, S.vigMid / 100, S.vigRound / 100, Math.max(0.02, S.vigFeather / 100)], u_fade: S.fade / 100,
      u_grain: [S.grain / 100, 0.6 + S.grainSize / 100 * 3.4, S.grainRough / 100, S.grainColor / 100], u_seed: S.fxSeed,
      u_leak: [S.leak / 100, S.leakSeed, ((S.leakHue % 360) + 360) % 360 / 360], u_dust: [S.dust / 100, S.scratches / 100],
      ...border, u_border: scan ? 0 : border.u_border
    });
    if (scan) {
      const wide = this.blur('sm', filmOut.tex, W, H, long * 0.03, false);
      this.draw(F, 'scan', {
        u_t: filmOut.tex, u_m: wide, u_px: [1 / W, 1 / H], u_r: Math.max(0.6, scale),
        u_sM: scan.m, u_sGain: scan.gain, u_sShT: scan.shT, u_sHiT: scan.hlT, u_sK: [scan.kS, scan.kH], u_sHyper: [scan.hyS, scan.hyH],
        u_sBW: [scan.black, scan.white], u_sEdge: scan.edge, u_sKnee: scan.knee, u_sSat: scan.sat, u_sSharp: [scan.sharp, scan.grainSup, scan.floor], ...border
      });
    }
    return this.last = { F, G, W, H, geo: g, scale };
  }

  present(V, mode, splitX, clip, overlay) {
    const r = this.last; if (!r) return;
    this.draw(null, 'display', { u_f: r.F.tex, u_g: r.G.tex, u_V: V, u_res: [this.canvas.width, this.canvas.height], u_split: splitX, u_mode: mode, u_clip: clip ? 1 : 0, u_overlay: overlay ? 1 : 0, u_bg: [0.075, 0.075, 0.08] });
  }
  histogram() {
    const r = this.last; if (!r) return null; const gl = this.gl, t = this.rt('hist', 256, 160, 'u8');
    this.draw(t, 'copy', { u_t: r.F.tex });
    const px = new Uint8Array(256 * 160 * 4); gl.readPixels(0, 0, 256, 160, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const h = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256) };
    for (let i = 0; i < px.length; i += 4) { h.r[px[i]]++; h.g[px[i + 1]]++; h.b[px[i + 2]]++; h.l[(px[i] * 54 + px[i + 1] * 183 + px[i + 2] * 19) >> 8]++; }
    return h;
  }
  /* linear scene values straight after geometry: used for the WB picker and auto tone */
  sampleG(u, v) {
    const r = this.last; if (!r) return null; const gl = this.gl;
    const w = Math.min(5, r.W), h = Math.min(5, r.H);
    const x = Math.max(0, Math.min(r.W - w, Math.round(u * r.W) - Math.floor(w / 2))), y = Math.max(0, Math.min(r.H - h, Math.round(v * r.H) - Math.floor(h / 2)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.G.fb); const px = new Float32Array(w * h * 4); gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, px);
    const c = [0, 0, 0]; for (let i = 0; i < px.length; i += 4) { c[0] += px[i]; c[1] += px[i + 1]; c[2] += px[i + 2]; } return c.map(v => v / (w * h));
  }
  statsG() {
    const r = this.last; if (!r) return null; const gl = this.gl, t = this.rt('st', 96, 96, 'f16');
    this.draw(t, 'down', { u_t: r.G.tex, u_prep: 0 });
    const px = new Float32Array(96 * 96 * 4); gl.readPixels(0, 0, 96, 96, gl.RGBA, gl.FLOAT, px);
    const l = []; for (let i = 0; i < px.length; i += 4) l.push(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
    return l.sort((a, b) => a - b);
  }
  /* render with given settings and read back 8-bit pixels (top row first) */
  readPixels(S, maxLong, o = {}, srcOverride) {
    const keep = this.src; if (srcOverride) { this.src = srcOverride; this.invalidate(); }
    try {
      const g = geoInfo(S, this.src.w, this.src.h), long = Math.max(g.outW, g.outH);
      const r = this.render(S, maxLong ? Math.min(1, maxLong / long) : 1, o), gl = this.gl;
      const px = new Uint8ClampedArray(r.W * r.H * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, r.F.fb); gl.readPixels(0, 0, r.W, r.H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const renderError = gl.getError();
      if (renderError !== gl.NO_ERROR) throw new Error('GPU export failed (WebGL ' + renderError + '). Try a smaller export size.');
      for (let i = 3; i < px.length; i += 4) px[i] = 255;
      return { px, W: r.W, H: r.H };
    } finally { if (srcOverride) { this.src = keep; this.invalidate(); } }
  }
}
