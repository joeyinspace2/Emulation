'use strict';
/* Pure, portable recipe contract. Keep declarations inside the closure: browser builds
   concatenate this file with film.js and the rest of the editor. */
(function (root, factory) {
  const model = typeof module !== 'undefined' && module.exports
    ? require('./film.js') : { DEF, newSettings, STOCKS, LOOKS, MASK_ADJ };
  const api = factory(model);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EmulsionRecipe = api;
})(globalThis, function (model) {
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const bad = (path, message) => { throw new Error(path + ': ' + message); };
  const dangerous = new Set(['__proto__', 'prototype', 'constructor']);
  const copy = value => JSON.parse(JSON.stringify(value));
  function object(value, allowed, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) bad(path, 'expected a plain object');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || dangerous.has(key) || !allowed.includes(key)) bad(path, 'unknown or unsafe key ' + String(key));
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (!own(desc, 'value') || !desc.enumerable) bad(path + '.' + key, 'expected an enumerable data property, not an accessor');
    }
    return value;
  }
  function array(value, min, max, path) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) bad(path, 'expected array length ' + min + (min === max ? '' : '..' + max));
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1) bad(path, 'array must be dense with no extra keys');
    for (let i = 0; i < value.length; i++) {
      const desc = Object.getOwnPropertyDescriptor(value, String(i));
      if (!desc || !own(desc, 'value') || !desc.enumerable) bad(path, 'expected dense array of data properties');
    }
    return value;
  }
  function number(value, min, max, path, integer) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) bad(path, 'expected ' + (integer ? 'integer' : 'finite number') + ' in [' + min + ', ' + max + ']');
    return value;
  }
  function boolean(value, path) { if (typeof value !== 'boolean') bad(path, 'expected boolean'); return value; }
  function string(value, max, path) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) bad(path, 'expected nonempty text up to ' + max + ' characters without control characters');
    return value;
  }
  function choice(value, values, path) { if (!values.includes(value)) bad(path, 'unsupported value; expected one of ' + values.join(', ')); return value; }
  const ranges = {};
  const add = (names, min, max, integer = false) => names.split(' ').forEach(key => { ranges[key] = [min, max, integer]; });
  add('temp tint contrast highlights shadows whites blacks texture clarity dehaze vibrance saturation distort caR caB lensVig vigAmount vigRound', -100, 100);
  add('exposure', -5, 5);
  add('sharpen', 0, 150); add('sharpRadius', 0.5, 3);
  add('sharpMask nrLuma nrColor vigMid vigFeather filmAmt halation halRadius bloom bloomThresh bloomRadius grain grainSize grainRough grainColor fade leak dust scratches border borderRound lutAmt', 0, 100);
  add('halThresh', 20, 100); add('halHue', -20, 60); add('leakHue', 0, 360);
  add('leakSeed fxSeed', 1, 997, true); add('angle', -45, 45); add('rot90', 0, 3, true);
  const coordinate = (value, path) => number(value, -1000000, 1000000, path);
  function curve(value, path, base) {
    object(value, ['rgb', 'r', 'g', 'b'], path);
    const out = copy(base);
    for (const key of Object.keys(value)) {
      const p = path + '.' + key, points = array(value[key], 2, 14, p);
      out[key] = points.map((point, i) => {
        array(point, 2, 2, p + '[' + i + ']');
        return point.map((v, j) => number(v, 0, 1, p + '[' + i + '][' + j + ']'));
      });
      if (out[key][0][0] !== 0 || out[key].at(-1)[0] !== 1 || out[key].some((v, i, list) => i > 0 && v[0] <= list[i - 1][0])) bad(p, 'x coordinates must increase strictly from 0 to 1');
    }
    return out;
  }
  function grade(value, path, base) {
    object(value, ['sh', 'mid', 'hi', 'blend', 'balance'], path);
    const out = copy(base);
    for (const key of Object.keys(value)) {
      const p = path + '.' + key;
      if (key === 'blend' || key === 'balance') out[key] = number(value[key], key === 'balance' ? -100 : 0, 100, p);
      else {
        object(value[key], ['h', 's', 'l'], p);
        for (const channel of Object.keys(value[key])) out[key][channel] = number(value[key][channel], channel === 'l' ? -100 : 0, channel === 'h' ? 360 : 100, p + '.' + channel);
      }
    }
    return out;
  }
  // PNG framing and CRC checks bound asset decoding before any browser allocation.
  const crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  function png(value, path) {
    if (value === null) return null;
    const prefix = 'data:image/png;base64,', limit = 4 * 1024 * 1024;
    if (typeof value !== 'string' || !value.startsWith(prefix)) bad(path, 'expected embedded PNG data URL or null');
    const data = value.slice(prefix.length);
    if (data.length > Math.ceil(limit / 3) * 4) bad(path, 'PNG exceeds 4 MiB byte limit');
    if (!data.length || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) bad(path, 'malformed PNG base64');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bytes = new Uint8Array(data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0));
    if (bytes.length > limit) bad(path, 'PNG exceeds 4 MiB byte limit');
    let pos = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = alphabet.indexOf(data[i]), b = alphabet.indexOf(data[i + 1]), c = alphabet.indexOf(data[i + 2]), d = alphabet.indexOf(data[i + 3]);
      if (i === data.length - 4 && ((c < 0 && (b & 15)) || (d < 0 && c >= 0 && (c & 3)))) bad(path, 'noncanonical PNG base64');
      bytes[pos++] = a << 2 | b >> 4;
      if (pos < bytes.length) bytes[pos++] = b << 4 | c >> 2;
      if (pos < bytes.length) bytes[pos++] = c << 6 | d;
    }
    if (bytes.length < 57 || [137,80,78,71,13,10,26,10].some((b, i) => bytes[i] !== b)) bad(path, 'invalid PNG signature or structure');
    const u32 = i => (bytes[i] * 0x1000000 + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]) >>> 0;
    let offset = 8, header = false, image = false, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = u32(offset), end = offset + 12 + length;
      if (end > bytes.length) bad(path, 'truncated PNG chunk');
      const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      let crc = 0xffffffff;
      for (let i = offset + 4; i < end - 4; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
      if (((crc ^ 0xffffffff) >>> 0) !== u32(end - 4)) bad(path, 'invalid PNG chunk checksum');
      if (!header) {
        if (type !== 'IHDR' || length !== 13) bad(path, 'PNG must start with IHDR');
        const w = u32(offset + 8), h = u32(offset + 12), depth = bytes[offset + 16], color = bytes[offset + 17];
        if (w < 1 || h < 1 || w > 1024 || h > 1024) bad(path, 'PNG dimensions must be 1..1024 pixels');
        const depths = {0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
        if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) bad(path, 'unsupported PNG header');
        header = true;
      } else if (type === 'IHDR') bad(path, 'duplicate PNG header');
      if (type === 'IDAT' && length) image = true;
      offset = end;
      if (type === 'IEND') { if (length !== 0 || !image || offset !== bytes.length) bad(path, 'invalid PNG end'); ended = true; break; }
      if (!/^[A-Za-z]{4}$/.test(type) || (!['IHDR','PLTE','IDAT','IEND'].includes(type) && type[0] === type[0].toUpperCase()) || type === 'acTL' || type === 'fcTL' || type === 'fdAT') bad(path, 'unsupported PNG chunk');
    }
    if (!ended) bad(path, 'incomplete PNG');
    return value;
  }
  function masks(value, path) {
    array(value, 0, 6, path);
    const ids = new Set();
    return value.map((mask, i) => {
      const p = path + '[' + i + ']';
      object(mask, ['id','type','a','feather','invert','amount','adj','data'], p);
      const id = string(mask.id, 128, p + '.id');
      if (dangerous.has(id) || ids.has(id)) bad(p + '.id', 'unsafe or duplicate mask ID');
      ids.add(id);
      const type = choice(mask.type, ['linear','radial','brush'], p + '.type');
      array(mask.a, 4, 4, p + '.a');
      const a = mask.a.map((v, j) => coordinate(v, p + '.a[' + j + ']'));
      if (type === 'radial' && (a[2] < 0.004 || a[3] < 0.004)) bad(p + '.a', 'radial radii must be at least 0.004');
      const adj = { ...model.MASK_ADJ };
      object(mask.adj, Object.keys(adj), p + '.adj');
      for (const key of Object.keys(mask.adj)) adj[key] = number(mask.adj[key], key === 'exposure' ? -4 : -100, key === 'exposure' ? 4 : 100, p + '.adj.' + key);
      const data = own(mask, 'data') ? mask.data : null;
      if (type !== 'brush' && data !== null) bad(p + '.data', 'only brush masks can contain PNG data');
      return { id, type, a, feather: number(mask.feather, 0, 100, p + '.feather'), invert: boolean(mask.invert, p + '.invert'), amount: number(mask.amount, 0, 100, p + '.amount'), adj, data: type === 'brush' ? png(data, p + '.data') : null };
    });
  }
  function spots(value, path) {
    array(value, 0, 16, path);
    return value.map((spot, i) => {
      const p = path + '[' + i + ']', out = {};
      object(spot, ['x','y','r','f','sx','sy','o'], p);
      for (const key of ['x','y','sx','sy']) out[key] = coordinate(spot[key], p + '.' + key);
      out.r = number(spot.r, 0.003, 0.1, p + '.r');
      out.f = number(spot.f, 0, 1, p + '.f'); out.o = number(spot.o, 0, 1, p + '.o');
      return out;
    });
  }
  function settings(value) {
    object(value, Object.keys(model.DEF), 'settings');
    const out = model.newSettings();
    for (const key of Object.keys(value)) {
      const v = value[key], p = 'settings.' + key;
      if (own(ranges, key)) { const [min, max, integer] = ranges[key]; out[key] = number(v, min, max, p, integer); }
      else if (['bw','flipH','flipV'].includes(key)) out[key] = boolean(v, p);
      else if (key === 'film') out[key] = choice(v, model.STOCKS.map(s => s.id), p);
      else if (key === 'borderColor') out[key] = choice(v, ['white','cream','black'], p);
      else if (key === 'aspect') out[key] = choice(v, ['free','original','1:1','5:4','4:5','4:3','3:4','3:2','2:3','16:9','9:16','2:1','1:2'], p);
      else if (key === 'lut') {
        out[key] = v === null ? null : string(v, 256, p);
        if (v !== null && (dangerous.has(v) || own(Object.prototype, v))) bad(p, 'reserved LUT name');
      }
      else if (key === 'curve') out[key] = curve(v, p, out[key]);
      else if (key === 'grade') out[key] = grade(v, p, out[key]);
      else if (['hslH','hslS','hslL'].includes(key)) { array(v, 8, 8, p); out[key] = v.map((n, i) => number(n, -100, 100, p + '[' + i + ']')); }
      else if (key === 'crop') {
        object(v, ['cx','cy','w','h'], p);
        for (const k of Object.keys(v)) out.crop[k] = number(v[k], ['w','h'].includes(k) ? 0.000001 : 0, 1, p + '.' + k);
      } else if (key === 'masks') out[key] = masks(v, p);
      else if (key === 'spots') out[key] = spots(v, p);
      else bad(p, 'setting has no validator');
    }
    return out;
  }
  function validate(recipe) {
    object(recipe, ['format','version','name','source','settings','assets','output'], 'recipe');
    for (const key of ['format', 'version', 'settings']) if (!own(recipe, key)) bad(key, 'required field');
    if (recipe.format !== 'emulsion-recipe') bad('format', 'expected emulsion-recipe');
    if (recipe.version !== 1) bad('version', 'unsupported recipe version');
    const out = { format: 'emulsion-recipe', version: 1 };
    if (own(recipe, 'name')) out.name = string(recipe.name, 256, 'name');
    if (own(recipe, 'source')) { object(recipe.source, ['name'], 'source'); out.source = { name: string(recipe.source.name, 1024, 'source.name') }; }
    out.settings = settings(recipe.settings);
    if (own(recipe, 'assets')) {
      object(recipe.assets, ['lut'], 'assets');
      if (!own(recipe.assets, 'lut')) bad('assets', 'expected selected LUT asset');
      const lut = recipe.assets.lut;
      object(lut, ['name','size','data'], 'assets.lut');
      const name = string(lut.name, 256, 'assets.lut.name'), size = number(lut.size, 2, 64, 'assets.lut.size', true);
      if (name !== out.settings.lut) bad('assets.lut.name', 'LUT must match settings.lut');
      const count = size ** 3 * 3;
      array(lut.data, count, count, 'assets.lut.data');
      out.assets = { lut: { name, size, data: lut.data.map((v, i) => number(v, -65504, 65504, 'assets.lut.data[' + i + ']')) } };
    } else if (out.settings.lut !== null) bad('assets.lut', 'selected LUT must be embedded');
    if (own(recipe, 'output')) {
      object(recipe.output, ['type','quality','max'], 'output');
      const o = recipe.output;
      out.output = { type: own(o, 'type') ? choice(o.type, ['image/jpeg','image/png','image/webp'], 'output.type') : 'image/jpeg', quality: own(o, 'quality') ? number(o.quality, 0.4, 1, 'output.quality') : 0.92, max: own(o, 'max') ? number(o.max, 0, 32768, 'output.max', true) : 0 };
    }
    return out;
  }
  function create(value, options = {}) {
    object(options, ['name','source','assets','output'], 'options');
    return validate({ format: 'emulsion-recipe', version: 1, settings: value, ...options });
  }
  return Object.freeze({ validate, create, defaults: () => model.newSettings(), looks: () => ({ films: model.STOCKS.map(s => ({ id: s.id, name: s.name, group: s.group, description: s.desc })), looks: model.LOOKS.map(([name, settings]) => ({ name, settings: copy(settings) })) }) });
});
