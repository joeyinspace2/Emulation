import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/emulsion.mjs');
function run(args, cwd = root) {
  return new Promise(resolve => {
    const proc = spawn(process.execPath, [cli, ...args], {cwd, env: process.env});
    let stdout = '', stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), 90000);
    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.stderr.on('data', chunk => { stderr += chunk; });
    proc.on('close', code => { clearTimeout(timer); resolve({code, stdout, stderr}); });
  });
}
function crc(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let j=0;j<8;j++) c=c&1?0xedb88320^(c>>>1):c>>>1; } return (c^0xffffffff)>>>0; }
function png() {
  const chunk=(name,data)=>{const type=Buffer.from(name), len=Buffer.alloc(4), sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([len,type,data,sum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(64);header.writeUInt32BE(48,4);header[8]=8;header[9]=2;
  const pixels=Buffer.alloc(48*(1+64*3));for(let y=0;y<48;y++)for(let x=0;x<64;x++){const i=y*193+1+x*3;pixels[i]=x*3;pixels[i+1]=y*4;pixels[i+2]=120;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
async function fixture(t) {
  const dir=await mkdtemp(path.join(tmpdir(),'emulsion-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const image=path.join(dir,'input.png'),recipe=path.join(dir,'recipe.json');
  await writeFile(image,png());await writeFile(recipe,JSON.stringify({format:'emulsion-recipe',version:1,settings:{exposure:0.4},output:{type:'image/png',max:32}}));
  return {dir,image,recipe,output:path.join(dir,'output.png')};
}
function success(result) { assert.equal(result.code,0,result.stderr);assert.equal(result.stderr,'');return JSON.parse(result.stdout); }
function failure(result, pattern) { assert.equal(result.code,1,result.stderr);assert.equal(result.stdout,'');assert.match(result.stderr,pattern); }
test('help, looks and validation are JSON and work outside package cwd',async t=>{
  const f=await fixture(t); const help=success(await run(['help'],f.dir));assert.ok(help.commands.includes('render'));assert.deepEqual(success(await run(['--help'],f.dir)),help);
  const looks=success(await run(['looks'],f.dir));assert.ok(looks.films.length);assert.ok(looks.looks.length);
  const validated=success(await run(['validate',f.recipe],f.dir));assert.equal(validated.valid,true);assert.equal(validated.recipe.settings.exposure,0.4);
});
test('rejects unknown commands, options, missing arguments and invalid numeric values',async t=>{
 const f=await fixture(t);
 for(const args of [['whoops'],['looks','--wat'],['inspect'],['render',f.image,'--recipe',f.recipe,'--output',f.output,'--max','NaN'],['render',f.image,'--recipe',f.recipe,'--output',f.output,'--max','1.5'],['preview','--port','65536'],['preview','--port','0'],['render',f.image,'--recipe',f.recipe,'--output',f.output,'--overwrite','yes']])failure(await run(args),/./);
});
test('validates recipe and output format before launching a browser',async t=>{
 const f=await fixture(t);await writeFile(f.recipe,'{"format":"emulsion-recipe","version":999,"settings":{}}');
 failure(await run(['render',f.image,'--recipe',f.recipe,'--output',f.output,'--browser','/missing-browser']),/version/);
 await writeFile(f.recipe,JSON.stringify({format:'emulsion-recipe',version:1,settings:{},output:{type:'image/png'}}));
 failure(await run(['render',f.image,'--recipe',f.recipe,'--output',path.join(f.dir,'output.jpg'),'--browser','/missing-browser']),/extension|format|MIME/i);
});
test('refuses source paths and their symlinks and hardlinks even with overwrite',async t=>{
 const f=await fixture(t),before=await readFile(f.image);const alias=path.join(f.dir,'alias.png'),hard=path.join(f.dir,'hard.png');await symlink(f.image,alias);await link(f.image,hard);
 for(const output of [f.image,alias,hard])failure(await run(['render',f.image,'--recipe',f.recipe,'--output',output,'--overwrite','--browser','/missing-browser']),/source|input/i);
 assert.deepEqual(await readFile(f.image),before);
});
test('refuses an existing output without overwrite before browser launch',async t=>{
 const f=await fixture(t);await writeFile(f.output,'original');failure(await run(['render',f.image,'--recipe',f.recipe,'--output',f.output,'--browser','/missing-browser']),/exist|overwrite/i);assert.equal(await readFile(f.output,'utf8'),'original');
});
test('real inspect and PNG render use public API, dimensions and explicit overwrite', {timeout:180000}, async t=>{
 const f=await fixture(t);const before=await readFile(f.image);
 const inspected=success(await run(['inspect',f.image,'--software-gl'],f.dir));assert.equal(inspected.current.loaded,true);assert.equal(inspected.current.width,64);assert.equal(inspected.current.height,48);
 const args=['render',f.image,'--recipe',f.recipe,'--output',f.output,'--software-gl'];const output=success(await run(args,f.dir));assert.equal(output.type,'image/png');assert.equal(output.width,32);assert.equal(output.height,24);assert.equal(output.output,f.output);
 const bytes=await readFile(f.output);assert.deepEqual(bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));assert.equal(bytes.readUInt32BE(16),32);assert.equal(bytes.readUInt32BE(20),24);
 success(await run([...args,'--overwrite','--max','16'],f.dir));const resized=await readFile(f.output);assert.equal(resized.readUInt32BE(16),16);assert.equal(resized.readUInt32BE(20),12);assert.deepEqual(await readFile(f.image),before);
});
test('browser launch and source decoding failures exit and leave no output', {timeout:180000}, async t=>{
 const f=await fixture(t);
 failure(await run(['inspect',f.image,'--browser','/bin/false']),/browser|launch|closed/i);
 await writeFile(f.image,'not a photograph');
 failure(await run(['render',f.image,'--recipe',f.recipe,'--output',f.output,'--software-gl']),/decode|load|image|photo/i);
 await assert.rejects(readFile(f.output),{code:'ENOENT'});
});
test('recipe without output selects JPEG and WebP encoders from extension', {timeout:180000}, async t=>{
 const f=await fixture(t);await writeFile(f.recipe,JSON.stringify({format:'emulsion-recipe',version:1,settings:{}}));
 for(const [extension,type] of [['jpg','image/jpeg'],['webp','image/webp']]) {
  const output=path.join(f.dir,'output.'+extension), result=success(await run(['render',f.image,'--recipe',f.recipe,'--output',output,'--software-gl']));
  assert.equal(result.type,type);assert.equal(result.width,64);assert.equal(result.height,48);
  const bytes=await readFile(output);if(extension==='jpg')assert.deepEqual(bytes.subarray(0,3),Buffer.from([255,216,255]));else {assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');}
 }
});
test('preview serves only built HTML on loopback and shuts down on SIGTERM',{timeout:15000},async t=>{
 const proc=spawn(process.execPath,[cli,'preview'],{cwd:tmpdir()});t.after(()=>proc.kill('SIGKILL'));
 const address=await new Promise((resolve,reject)=>{let stdout='';const timer=setTimeout(()=>reject(new Error('preview did not start')),8000);proc.stdout.on('data',chunk=>{stdout+=chunk;try {const result=JSON.parse(stdout.trim());clearTimeout(timer);resolve(result.url);}catch{}});proc.on('exit',code=>{clearTimeout(timer);reject(new Error('preview exited '+code));});});
 assert.equal(new URL(address).hostname,'127.0.0.1');assert.equal((await fetch(address)).status,200);assert.equal((await fetch(new URL('/package.json',address))).status,404);assert.equal((await fetch(new URL('/../src/app.js',address))).status,404);
 const closed=new Promise(resolve=>proc.once('exit',resolve));proc.kill('SIGTERM');assert.equal(await closed,0);await assert.rejects(fetch(address));
});
