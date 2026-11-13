// Packs src/* and the LibRaw WebAssembly decoder into one self-contained Emulsion.html
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..'), src = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve('libraw-wasm'));

let worker = fs.readFileSync(path.join(dist, 'worker.js'), 'utf8').replace(/\/\/# sourceMappingURL.*$/m, '');
const patch = (from, to) => { if (!worker.includes(from)) throw new Error('LibRaw worker patch point missing: ' + from); worker = worker.replace(from, to); };
patch('(await Kt())', '(await Kt({wasmBinary:Uint8Array.from(atob(self.__b64),c=>c.charCodeAt(0))}))'); // feed the wasm from inline data
patch('new URL("libraw.wasm",import.meta.url).href', '"libraw.wasm"'); // never fetched; avoids resolving against a blob: URL
const wasm = fs.readFileSync(path.join(dist, 'libraw.wasm')).toString('base64');

const js = ['shaders.js', 'engine.js', 'film.js', 'recipe.js', 'library.js', 'ui.js', 'app.js', 'automation.js'].map(src).join('\n');
const safe = s => s.replace(/<\/script/gi, '<\\/script');
// Keep redistribution notices attached when the standalone HTML is shared.
const licenseRoot = path.join(root, 'third_party', 'licenses');
const notices = ['LICENSE', 'THIRD_PARTY_NOTICES.md'].map(name =>
  name + '\n\n' + fs.readFileSync(path.join(root, name), 'utf8'))
  .concat(fs.readdirSync(licenseRoot).sort().map(name =>
    name + '\n\n' + fs.readFileSync(path.join(licenseRoot, name), 'utf8'))).join('\n\n');
const out = src('index.html')
  .replace('/*LICENSES*/', () => safe(notices))
  .replace('/*CSS*/', () => src('style.css'))
  .replace('/*LIBRAW_WORKER*/', () => safe(worker))
  .replace('/*LIBRAW_WASM*/', () => wasm)
  .replace('/*JS*/', () => safe(js));
fs.writeFileSync(path.join(root, 'Emulsion.html'), out);
console.log('Emulsion.html', (out.length / 1048576).toFixed(2) + ' MB');
