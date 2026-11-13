'use strict';
/* Public adapter: the editor and agents share settings, history and the renderer. */
let finishEmulsionInit;
(() => {
  let resolveReady, rejectReady, tail = Promise.resolve();
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {}); // The visible fatal panel also reports initialization failures.
  const outputByPhoto = new WeakMap();
  const defaultOutput = { type: 'image/jpeg', quality: 0.92, max: 0 };
  // Pointer blocking alone does not stop the editor's global keyboard shortcuts
  // or native range-input keys during asynchronous mask decoding.
  window.addEventListener('keydown', event => {
    if (document.body.hasAttribute('data-automation-busy')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  const enqueue = job => {
    const run = tail.then(async () => {
      await ready;
      document.body.dataset.automationBusy = '1';
      try { return await job(); } finally { delete document.body.dataset.automationBusy; }
    });
    tail = run.catch(() => {}); return run;
  };
  function source() {
    if (!st.cur || !engine.src || !st.srcFull) throw new Error(st.cur?.loadError || 'Open a photo and wait for full decoding before editing or rendering.');
    if (engine.gl.isContextLost()) throw new Error('The graphics context was lost. Reload the editor and reopen the photo.');
    return st.cur;
  }
  const snapshot = () => ({
    app: 'Emulsion', version: '0.1.1',
    photos: st.photos.map(p => ({id:p.id,name:p.name,kind:p.kind,rating:p.rating,flag:p.flag})),
    current: st.cur ? {id:st.cur.id,name:st.cur.name,kind:st.cur.kind,loaded:st.srcFull,
      width:engine.src?.w ?? null,height:engine.src?.h ?? null} : null,
    settings: clone(st.S), output: clone(outputByPhoto.get(st.cur) || defaultOutput)
  });
  async function decodeMasks(settings) {
    const images = new Map();
    try {
      for (const m of settings.masks) {
        if (m.type !== 'brush' || !m.data) continue;
        const img = new Image(); img.src = m.data;
        try { await img.decode(); } catch { throw new Error('Brush mask ' + m.id + ' is not a decodable image.'); }
        if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth > 1024 || img.naturalHeight > 1024) throw new Error('Brush mask dimensions must be at most 1024 × 1024.');
        images.set(m.id, img);
      }
      return images;
    } catch (e) { images.clear(); throw e; }
  }
  function installMasks(settings, images) {
    for (const id of [...maskRT.keys()]) { maskRT.delete(id); engine.dropMask(id); }
    for (const m of settings.masks) {
      if (m.type !== 'brush') continue;
      const rt = ensureMaskRT(m), img = images.get(m.id);
      rt.ref = m.data || null;
      if (img) rt.ctx.drawImage(img, 0, 0, rt.canvas.width, rt.canvas.height);
      engine.updateMask(m.id, rt.canvas);
    }
  }
  async function portableRecipe() {
    const p = source(), settings = clone(st.S), selectedLut = settings.lut && st.luts[settings.lut];
    const images = await decodeMasks(settings);
    for (const m of settings.masks) {
      const img = images.get(m.id); if (!img) continue;
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0); m.data = canvas.toDataURL('image/png');
    }
    const options = {source:{name:p.name},output:clone(outputByPhoto.get(p) || defaultOutput)};
    if (selectedLut) options.assets = {lut:{name:settings.lut,size:selectedLut.size,data:Array.from(selectedLut.data)}};
    if (p !== st.cur) throw new Error('The selected photo changed. Try saving the recipe again.');
    return EmulsionRecipe.create(settings, options);
  }
  async function apply(recipe) {
    const r = EmulsionRecipe.validate(recipe), p = source(), token = st.loadToken;
    const images = await decodeMasks(r.settings);
    // Preserve previously referenced LUTs so undo/redo cannot change their pixels.
    let lut = r.assets?.lut;
    const sameLut = (a, b) => a && a.size === b.size && a.data.length === b.data.length && b.data.every((v,i) => a.data[i] === Math.fround(v));
    if (lut) {
      const existing = st.luts[lut.name];
      if (existing && !sameLut(existing, lut)) {
        const bytes = new TextEncoder().encode(JSON.stringify(lut));
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
        let name, index=0;
        do {
          const suffix = ' [' + hash.slice(0,12) + (index ? '-' + index : '') + ']';
          name = lut.name.slice(0,256-suffix.length) + suffix; index++;
        } while (st.luts[name] && !sameLut(st.luts[name],lut));
        lut = {...lut,name}; r.settings.lut = lut.name;
      }
    }
    if (st.cur !== p || st.loadToken !== token) throw new Error('The selected photo changed. Try applying the recipe again.');
    if (lut) { st.luts[lut.name] = {size:lut.size,data:new Float32Array(lut.data)}; idb.set('kv','luts',st.luts); }
    st.S = r.settings;
    outputByPhoto.set(p, r.output || clone(defaultOutput));
    st.selMask = -1; st.selSpot = -1; st.cropView = null;
    installMasks(st.S, images);
    commit(r.name ? 'Recipe: ' + r.name : 'Apply recipe');
    afterReplace();
    $('#exType').value = (r.output || defaultOutput).type;
    $('#exQuality').value = Math.round((r.output || defaultOutput).quality * 100);
    $('#exQv').textContent = $('#exQuality').value;
    const max = (r.output || defaultOutput).max;
    const size = $('#exSize');
    if (max && ![...size.options].some(o => o.value === String(max))) size.add(new Option(max + ' px long edge', String(max)));
    size.value = max ? String(max) : 'full';
    $('#exType').dispatchEvent(new Event('change'));
    return snapshot();
  }
  async function render(options = {}) {
    const p = source(), token = st.loadToken, settings = clone(st.S);
    const output = EmulsionRecipe.validate({format:'emulsion-recipe',version:1,settings:{},output:{...(outputByPhoto.get(p) || defaultOutput),...options}}).output;
    const images = await decodeMasks(settings);
    if (st.cur !== p || st.loadToken !== token) throw new Error('The selected photo changed before rendering.');
    installMasks(settings, images);
    const out = engine.readPixels(settings, output.max, renderOpts(settings));
    const blob = await pixelsToBlob(out, output.type, output.quality);
    if (blob.type !== output.type) throw new Error('This browser cannot encode ' + output.type + '.');
    requestRender();
    return {blob,width:out.W,height:out.H};
  }
  window.Emulsion = Object.freeze({
    ready, inspect: snapshot, listLooks: () => EmulsionRecipe.looks(), validateRecipe: r => EmulsionRecipe.validate(r),
    openFiles: files => enqueue(async () => {
      if (!Array.isArray(files) || !files.length || files.some(f => !(f instanceof File) || !kindOf(f.name))) throw new Error('Provide one or more supported photo Files.');
      const photos = photosFromFiles(files), ids = new Set(st.photos.map(p=>p.id));
      for (const photo of photos) {
        if (ids.has(photo.id)) throw new Error('Photo already imported or duplicate filename: ' + photo.id + '. Select the existing photo or use a unique filename.');
        ids.add(photo.id);
      }
      await addLoose(photos);
      const p = st.photos.find(p => p.id === photos[0].id); await openPhoto(p); source(); return snapshot();
    }),
    selectPhoto: id => enqueue(async () => {
      const p = st.photos.find(p => p.id === id); if (!p) throw new Error('Photo not found: ' + id);
      await openPhoto(p); source(); return snapshot();
    }),
    applyRecipe: recipe => enqueue(() => apply(recipe)),
    getRecipe: () => enqueue(portableRecipe), render: options => enqueue(() => render(options)),
    undo: () => enqueue(async () => { source(); undo(); installMasks(st.S, await decodeMasks(st.S)); return snapshot(); }),
    redo: () => enqueue(async () => { source(); redo(); installMasks(st.S, await decodeMasks(st.S)); return snapshot(); })
  });
  function bindRecipes() {
    const dialog = $('#recipeDlg'), area = $('#recipeJson'), status = $('#recipeStatus');
    const message = (text, error=false) => { status.textContent = text; status.classList.toggle('error', error); };
    const run = async job => { try { await job(); } catch(e) { message(e.message, true); } };
    const current = async () => { area.value = JSON.stringify(await Emulsion.getRecipe(), null, 2); message('Current edits are ready to save or share.'); };
    $('#recipeOpen').onclick = () => { dialog.showModal(); if (!area.value) run(async () => {
      if (st.srcFull) await current(); else { area.value = JSON.stringify({format:'emulsion-recipe',version:1,settings:{}},null,2); message('Open a photo to apply a recipe.'); }
    }); };
    $('#recipeClose').onclick = () => dialog.close();
    $('#recipeCurrent').onclick = () => run(current);
    $('#recipeImport').onclick = () => $('#recipeFile').click();
    $('#recipeFile').onchange = () => run(async () => {
      const file = $('#recipeFile').files[0]; $('#recipeFile').value = ''; if (!file) return;
      if (file.size > 32 * 1024 * 1024) throw new Error('Recipe files must be smaller than 32 MiB.');
      const text = await file.text(); Emulsion.validateRecipe(JSON.parse(text)); area.value = text;
      message('Recipe loaded. Choose Apply recipe to use it on the open photo.');
    });
    $('#recipeValidate').onclick = () => run(async () => { Emulsion.validateRecipe(JSON.parse(area.value)); message('Valid Emulsion recipe.'); });
    $('#recipeApply').onclick = () => run(async () => { await Emulsion.applyRecipe(JSON.parse(area.value)); message('Recipe applied. Use Undo to restore the previous edits.'); });
    $('#recipeSave').onclick = () => run(async () => {
      const recipe = Emulsion.validateRecipe(JSON.parse(area.value));
      downloadBlob(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'}), 'photo.emulsion.json');
      message('Recipe saved. It contains adjustments, not the original photo.');
    });
  }
  finishEmulsionInit = error => {
    if (error) return rejectReady(error);
    try { bindRecipes(); resolveReady(); } catch (e) { rejectReady(e); }
  };
})();
