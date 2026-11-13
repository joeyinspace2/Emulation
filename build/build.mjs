// Packs src/* and the LibRaw WebAssembly decoder into one self-contained Emulsion.html
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..'), src = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const dist = path.join(here, 'node_modules/libraw-wasm/dist');

let worker = fs.readFileSync(path.join(dist, 'worker.js'), 'utf8').replace(/\/\/# sourceMappingURL.*$/m, '');
const patch = (from, to) => { if (!worker.includes(from)) throw new Error('LibRaw worker patch point missing: ' + from); worker = worker.replace(from, to); };
patch('(await Kt())', '(await Kt({wasmBinary:Uint8Array.from(atob(self.__b64),c=>c.charCodeAt(0))}))'); // feed the wasm from inline data
patch('new URL("libraw.wasm",import.meta.url).href', '"libraw.wasm"'); // never fetched; avoids resolving against a blob: URL
const wasm = fs.readFileSync(path.join(dist, 'libraw.wasm')).toString('base64');

const js = ['shaders.js', 'engine.js', 'film.js', 'library.js', 'ui.js', 'app.js'].map(src).join('\n');
const safe = s => s.replace(/<\/script/gi, '<\\/script');
const out = src('index.html')
  .replace('/*CSS*/', () => src('style.css'))
  .replace('/*LIBRAW_WORKER*/', () => safe(worker))
  .replace('/*LIBRAW_WASM*/', () => wasm)
  .replace('/*JS*/', () => safe(js));
fs.writeFileSync(path.join(root, 'Emulsion.html'), out);
console.log('Emulsion.html', (out.length / 1048576).toFixed(2) + ' MB');
