import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {unzipSync,strFromU8} from 'fflate';
const root=fileURLToPath(new URL('../',import.meta.url));
test('plugin archive contains a standalone runtime and both platform manifests',()=>{
  const result=spawnSync(process.execPath,['scripts/package-plugin.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const files=unzipSync(readFileSync(path.join(root,'dist/emulsion-plugin.zip')));
  for(const p of ['.codex-plugin/plugin.json','.claude-plugin/plugin.json','skills/emulsion/SKILL.md','scripts/emulsion.mjs','runtime/Emulsion.html','runtime/bin/emulsion.mjs','runtime/src/recipe.js','runtime/package-lock.json']) assert.ok(files['emulsion/'+p],p);
  assert.equal(JSON.parse(strFromU8(files['emulsion/.codex-plugin/plugin.json'])).name,'emulsion');
  for(const p of ['LICENSE','THIRD_PARTY_NOTICES.md','docs/raw-decoder-build.md']) assert.ok(files['emulsion/'+p],p);
  assert.ok(Object.keys(files).some(x=>x.startsWith('emulsion/third_party/sources/LibRaw-') && x.endsWith('.tar.gz')));
  assert.match(strFromU8(files['emulsion/runtime/Emulsion.html']),/CDDL-1.0/);
  assert.ok(!Object.keys(files).some(x=>x.includes('node_modules')||x.includes('.git/')));
  const dir=mkdtempSync(path.join(os.tmpdir(),'emulsion-plugin-'));
  try{
    for(const [name,content] of Object.entries(files)){const dest=path.join(dir,name);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,content);}
    const helper=path.join(dir,'emulsion/scripts/emulsion.mjs');
    const help=spawnSync(process.execPath,[helper,'--help'],{encoding:'utf8',cwd:dir});
    assert.equal(help.status,0,help.stderr); assert.match(help.stdout,/render/);
    const looks=spawnSync(process.execPath,[helper,'looks'],{encoding:'utf8',cwd:dir});
    assert.equal(looks.status,0,looks.stderr);assert.ok(JSON.parse(looks.stdout).films.some(x=>x.id==='port400'));
    const missingSetup=spawnSync(process.execPath,[helper,'inspect','missing.png'],{encoding:'utf8',cwd:dir,
      env:{...process.env,NODE_PATH:path.join(root,'node_modules'),EMULSION_CACHE:path.join(dir,'empty-cache')}});
    assert.equal(missingSetup.status,1);
    assert.match(missingSetup.stderr,/setup first/,'global CommonJS packages cannot satisfy the ESM runtime');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
