'use strict';
/* Live session: `emulsion preview <photo> --recipe <file>` adds this script to the page it serves.
   The recipe file is the shared state. A changed file is applied here; edits made here are saved to it. */
(() => {
  const config = JSON.parse(document.getElementById('emulsion-session').textContent);
  const say = (message, kind) => { if (typeof toast === 'function') toast(message, kind); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  // What the file holds, and the editor state that matches it.
  let revision = null, synced = null, candidate = null, reported = null;
  let photoId = config.photo;
  const onPhoto = () => { const c = Emulsion.inspect().current; return !!c && c.id === photoId && c.loaded; };
  const state = () => { const s = Emulsion.inspect(); return JSON.stringify([s.settings, s.output]); };
  const report = (message) => { if (reported !== message) { reported = message; say(message, 'err'); } };

  async function openPhoto() {
    if (Emulsion.inspect().photos.some(p => p.id === photoId)) return Emulsion.selectPhoto(photoId);
    const response = await fetch(config.base + 'photo', {cache:'no-store'});
    if (!response.ok) throw new Error(await response.text());
    return Emulsion.openFiles([new File([await response.blob()], config.photo)]);
  }
  async function pull() {
    const response = await fetch(config.base + 'recipe', {cache:'no-store'});
    if (response.status === 422) return report(config.recipe + ' is not a valid recipe yet: ' + await response.text());
    if (!response.ok) throw new Error(await response.text());
    const found = response.headers.get('X-Emulsion-Revision');
    if (found === revision) { reported = null; return false; }
    const first = revision === null;
    await Emulsion.applyRecipe(await response.json());
    revision = found; synced = state(); candidate = null; reported = null;
    say(first ? 'Live session: edits here are saved to ' + config.recipe : 'Edits updated from ' + config.recipe);
    return true;
  }
  async function push() {
    if (revision === null) return;
    const now = state();
    if (now === synced) { candidate = null; return; }
    // Save once a change has held still for a tick, not during a slider drag.
    if (candidate !== now) { candidate = now; return; }
    const recipe = await Emulsion.getRecipe();
    const response = await fetch(config.base + 'recipe', {method:'PUT', cache:'no-store',
      headers:{'Content-Type':'application/json', 'If-Match':revision}, body:JSON.stringify(recipe)});
    candidate = null;
    if (response.status === 409) return; // The file changed first; the next pull applies it.
    if (!response.ok) throw new Error(await response.text());
    revision = response.headers.get('X-Emulsion-Revision'); synced = now;
  }
  (async () => {
    try { await Emulsion.ready; await openPhoto(); }
    catch (error) { return say('Could not open ' + config.photo + ': ' + error.message, 'err'); }
    for (;;) {
      try { if (onPhoto() && !(await pull())) await push(); }
      catch (error) { report('Live session paused: ' + error.message); }
      await wait(700);
    }
  })();
})();
