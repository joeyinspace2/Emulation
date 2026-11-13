import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,readdirSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {zipSync} from 'fflate';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), payload={};
function add(source,dest=source){
  const full=path.join(root,source);
  if(statSync(full).isDirectory())for(const name of readdirSync(full).sort())add(path.join(source,name),path.join(dest,name));
  else payload['emulsion/'+dest.split(path.sep).join('/')]=[new Uint8Array(readFileSync(full)),{mtime:new Date('2026-01-01T00:00:00Z')}];
}
for(const entry of ['.codex-plugin','.claude-plugin','skills','examples','README.md','LICENSE','THIRD_PARTY_NOTICES.md','third_party','docs/recipe-format.md','docs/raw-decoder-build.md','scripts/emulsion.mjs'])add(entry);
for(const entry of ['Emulsion.html','package.json','package-lock.json','bin','lib','src/film.js','src/recipe.js'])add(entry,path.join('runtime',entry));
const zip=zipSync(payload,{level:6});
if(zip.length>100*1024*1024)throw new Error('Plugin exceeds the 100 MiB archive limit.');
mkdirSync(path.join(root,'dist'),{recursive:true});
const archive=path.join(root,'dist/emulsion-plugin.zip');writeFileSync(archive,zip);
const sha=createHash('sha256').update(zip).digest('hex');
writeFileSync(archive+'.sha256',sha+'  emulsion-plugin.zip\n');
process.stdout.write(JSON.stringify({archive,bytes:zip.length,sha256:sha})+'\n');
