#!/usr/bin/env node
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFile, stat, lstat, realpath, mkdtemp, writeFile, rename, link, rm } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const recipeModel = require('../src/recipe.js');
const commands = ['help', 'looks', 'validate', 'inspect', 'render', 'preview'];
const outputTypes = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
const print = value => process.stdout.write(JSON.stringify(value) + '\n');

function parse(args) {
  let command = args.shift() || 'help';
  if (command === '--help' || command === '-h') command = 'help';
  if (!commands.includes(command)) throw new Error('Unknown command: ' + command + '. Use emulsion help.');
  const allowed = {
    help: [], looks: [], validate: [], inspect: ['browser','software-gl'],
    render: ['recipe','output','max','overwrite','browser','software-gl'], preview: ['recipe','port','allow-host'],
  }[command];
  const flags = {}, positionals = [];
  let literal = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--' && !literal) { literal = true; continue; }
    if (!literal && arg.startsWith('-')) {
      const key = arg.slice(2);
      if (!arg.startsWith('--') || !allowed.includes(key)) throw new Error('Unsupported option for ' + command + ': ' + arg);
      if (Object.hasOwn(flags,key)) throw new Error('Duplicate option: ' + arg);
      if (key === 'overwrite' || key === 'software-gl') flags[key] = true;
      else {
        const value = args[++i];
        if (!value || value.startsWith('--')) throw new Error('Missing value for ' + arg);
        flags[key] = value;
      }
    } else positionals.push(arg);
  }
  const count = ['validate','inspect','render'].includes(command) ? 1 : 0;
  if (command === 'preview') {
    if (positionals.length > 1) throw new Error('preview expects at most one photo. Use emulsion help.');
    if (positionals.length && !flags.recipe) throw new Error('preview with a photo requires --recipe, the file that holds its edits.');
    if (!positionals.length && (flags.recipe || flags['allow-host'])) throw new Error('--recipe and --allow-host need a photo to preview.');
    if (flags['allow-host'] && !/^[a-z0-9.-]+$/i.test(flags['allow-host'])) throw new Error('--allow-host must be a host name without a scheme or port.');
  } else if (positionals.length !== count) throw new Error(command + ' expects ' + count + ' file argument' + (count === 1 ? '' : 's') + '. Use emulsion help.');
  if (command === 'render' && (!flags.recipe || !flags.output)) throw new Error('render requires --recipe and --output.');
  for (const [key,min,max] of [['max',0,32768],['port',1,65535]]) {
    if (flags[key] !== undefined) {
      if (!/^\d+$/.test(flags[key]) || !Number.isSafeInteger(Number(flags[key])) || Number(flags[key]) < min || Number(flags[key]) > max) throw new Error('--' + key + ' must be an integer in [' + min + ', ' + max + '].');
      flags[key] = Number(flags[key]);
    }
  }
  return {command,flags,positionals};
}

async function loadRecipe(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Recipe must be a regular JSON file no larger than 32 MiB.');
  let recipe;
  try { recipe = JSON.parse(await readFile(file, 'utf8')); } catch (error) { throw new Error('Invalid recipe JSON: ' + error.message); }
  return recipeModel.validate(recipe);
}
async function maybeStat(file, method=stat) {
  try { return await method(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function protectOutput(output, inputs, overwrite) {
  const existing = await maybeStat(output), outputEntry = await maybeStat(output,lstat);
  for (const input of inputs) {
    const info = await stat(input);
    if (path.resolve(input) === output || (existing && existing.dev === info.dev && existing.ino === info.ino) || (existing && await realpath(output) === await realpath(input))) throw new Error('Output must never replace a source/input file, including aliases.');
  }
  if (outputEntry?.isSymbolicLink()) throw new Error('Output is a symbolic link; choose a regular output path.');
  if (existing && !existing.isFile()) throw new Error('Output must be a regular file.');
  if (outputEntry && !overwrite) throw new Error('Output already exists. Pass --overwrite to replace it.');
}
async function saveOutput(output, bytes, inputs, overwrite) {
  await protectOutput(output,inputs,overwrite);
  const temp = await mkdtemp(path.join(path.dirname(output),'.emulsion-'));
  const staged = path.join(temp,'render');
  try {
    await writeFile(staged,bytes,{flag:'wx'});
    await protectOutput(output,inputs,overwrite);
    // link is exclusive: a file created during rendering cannot be overwritten accidentally.
    if (overwrite) await rename(staged,output);
    else await link(staged,output);
  } finally { await rm(temp,{recursive:true,force:true}); }
}

const emptyRecipe = JSON.stringify({format:'emulsion-recipe',version:1,settings:{}}, null, 2) + '\n';
async function preview(flags, photo) {
  const { serveApp } = await import('../lib/server.mjs');
  let session;
  if (photo) {
    const image = path.resolve(photo), recipe = path.resolve(flags.recipe);
    if (!(await stat(image)).isFile()) throw new Error('Input image must be a regular file.');
    // The editor saves edits into the recipe file, so it must never be the photo.
    const existing = await maybeStat(recipe), info = await stat(image);
    if (recipe === image || (existing && existing.dev === info.dev && existing.ino === info.ino)) throw new Error('The recipe file must never be the source photo, including aliases.');
    if (existing) await loadRecipe(recipe);
    else await writeFile(recipe, emptyRecipe, {flag:'wx'});
    session = {photo:image, recipe, allowHosts:flags['allow-host'] ? [flags['allow-host']] : [],
      onBlockedHost: host => process.stderr.write('Emulsion: refused a request for the address "' + host + '". Restart preview with --allow-host ' + host + ' if that is how the editor is opened.\n')};
  }
  const server = await serveApp({port:flags.port, session});
  print(session ? {app:'Emulsion',url:server.url,photo:session.photo,recipe:session.recipe,live:true} : {app:'Emulsion',url:server.url});
  await new Promise(resolve => {
    const stop = () => { process.off('SIGINT',stop); process.off('SIGTERM',stop); resolve(); };
    process.once('SIGINT',stop); process.once('SIGTERM',stop);
  });
  await server.close();
}

async function main() {
  const {command, flags, positionals} = parse(process.argv.slice(2));
  if (command === 'help') return print({app:'Emulsion',commands,usage:[
    'emulsion help', 'emulsion looks', 'emulsion validate <recipe>',
    'emulsion inspect <image> [--browser <executable>] [--software-gl]',
    'emulsion render <image> --recipe <file> --output <file> [--max <pixels>] [--overwrite] [--browser <executable>] [--software-gl]',
    'emulsion preview [<image> --recipe <file> [--allow-host <host>]] [--port <port>]',
  ],browser:'Installed Playwright Chromium, EMULSION_BROWSER, or a detected system Chromium. --software-gl enables SwiftShader.',output:'Use .jpg/.jpeg, .png or .webp. Extension must match recipe.output.type when specified; otherwise it chooses the encoder. --max accepts 0 (full size) through 32768.',preview:'With an image, the editor opens it with the recipe applied. The recipe file is live: changes to the file appear in the editor, and edits made in the editor are saved to the file. A missing recipe file is created empty. The command runs until interrupted.'});
  if (command === 'looks') return print(recipeModel.looks());
  if (command === 'validate') return print({valid:true,recipe:await loadRecipe(path.resolve(positionals[0]))});
  if (command === 'preview') return preview(flags, positionals[0]);
  const image = path.resolve(positionals[0]);
  const browserOptions = {browser:flags.browser,softwareGl:!!flags['software-gl']};
  if (command === 'inspect') {
    const { inspectPhoto } = await import('../lib/automation.mjs');
    return print(await inspectPhoto(image,browserOptions));
  }
  const recipePath = path.resolve(flags.recipe), recipe = await loadRecipe(recipePath);
  const output = path.resolve(flags.output), type = outputTypes[path.extname(output).toLowerCase()];
  if (!type) throw new Error('Unsupported output extension. Use .jpg, .jpeg, .png or .webp.');
  if (recipe.output && recipe.output.type !== type) throw new Error('Output extension does not match recipe output MIME type ' + recipe.output.type + '.');
  const outputOptions = {...(recipe.output || {type,quality:0.92,max:0})};
  if (flags.max !== undefined) outputOptions.max = flags.max;
  await protectOutput(output,[image,recipePath],!!flags.overwrite);
  const { renderPhoto } = await import('../lib/automation.mjs');
  const rendered = await renderPhoto(image,recipe,outputOptions,browserOptions);
  await saveOutput(output,rendered.bytes,[image,recipePath],!!flags.overwrite);
  print({output,type:rendered.type,width:rendered.width,height:rendered.height,bytes:rendered.bytes.length});
}
main().catch(error => {
  process.stderr.write('Emulsion: ' + error.message + '\n');
  process.exitCode = 1;
});
