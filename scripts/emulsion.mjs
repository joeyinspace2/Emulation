#!/usr/bin/env node
// A plugin is immutable; install its exact runtime into a separate user cache.
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,statSync,mkdirSync,writeFileSync,mkdtempSync,renameSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const plugin=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=existsSync(path.join(plugin,'runtime','Emulsion.html')) ? path.join(plugin,'runtime') : plugin;
const entries=['Emulsion.html','package.json','package-lock.json','bin','lib','src/film.js','src/recipe.js'];
const files=[];
function collect(rel){
  const full=path.join(runtime,rel);
  if(statSync(full).isDirectory()) for(const name of readdirSync(full).sort()) collect(path.join(rel,name));
  else files.push(rel);
}
for(const entry of entries) collect(entry);
const hash=createHash('sha256');
for(const name of files) hash.update(name).update('\0').update(readFileSync(path.join(runtime,name)));
const digest=hash.digest('hex');
const base=path.resolve(process.env.EMULSION_CACHE || path.join(os.homedir(),'.cache','emulsion'));
const cached=path.join(base,digest);
const marker=path.join(cached,'.ready');
const isReady=()=>existsSync(marker) && readFileSync(marker,'utf8')===digest;
function run(program,args,cwd,stdio='inherit'){
  const result=spawnSync(program,args,{cwd,stdio,
    env:{...process.env,npm_config_cache:process.env.npm_config_cache || process.env.NPM_CONFIG_CACHE || path.join(base,'npm-cache')},
    shell:process.platform==='win32' && program==='npm.cmd'});
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error(program+' exited '+(result.status ?? result.signal));
}
function setup(browser){
  if(!isReady()){
    mkdirSync(base,{recursive:true});
    const staging=mkdtempSync(path.join(base,'.install-'));
    try{
      for(const name of files){const dest=path.join(staging,name);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,readFileSync(path.join(runtime,name)));}
      run(process.platform==='win32'?'npm.cmd':'npm',['ci','--omit=dev','--no-audit','--no-fund'],staging,['inherit',2,2]);
      writeFileSync(path.join(staging,'.ready'),digest);
      try{renameSync(staging,cached);}catch(error){if(!isReady())throw error;}
    }finally{rmSync(staging,{recursive:true,force:true});}
  }
  if(browser) run(process.execPath,[path.join(cached,'node_modules/playwright/cli.js'),'install','chromium'],cached,['inherit',2,2]);
  process.stdout.write(JSON.stringify({ready:true,runtime:cached,browserInstalled:browser})+'\n');
}
try{
  const args=process.argv.slice(2);
  if(args[0]==='setup'){
    if(args.length>2 || (args[1] && args[1]!=='--browser')) throw new Error('Usage: node scripts/emulsion.mjs setup [--browser]');
    setup(args[1]==='--browser');
  }else{
    let target=runtime;
    if(['inspect','render'].includes(args[0])){
      // ESM imports do not use NODE_PATH; require.resolve could find a global
      // CommonJS package which the isolated runtime cannot actually import.
      if(!existsSync(path.join(runtime,'node_modules/playwright/package.json'))){
        if(!isReady())throw new Error('Run node '+fileURLToPath(import.meta.url)+' setup first. Use EMULSION_CACHE for a writable cache directory.');
        target=cached;
      }
    }
    // Keep caller cwd: user-provided file paths are relative to their project.
    const result=spawnSync(process.execPath,[path.join(target,'bin/emulsion.mjs'),...args],{stdio:'inherit',env:process.env});
    if(result.error)throw result.error;
    process.exitCode=result.status ?? 1;
  }
}catch(error){process.stderr.write('Emulsion launcher: '+error.message+'\n');process.exitCode=1;}
