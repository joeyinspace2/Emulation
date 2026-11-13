import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync, existsSync} from 'node:fs';
import {chromium} from 'playwright';
import fixtures from './fixtures.cjs';

let browser, server, url;
before(async () => {
  const html = readFileSync(new URL('../Emulsion.html', import.meta.url));
  server = createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({headless: true,
    executablePath: process.env.EMULSION_BROWSER || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
});
after(async () => { await browser?.close(); await new Promise(r => server ? server.close(r) : r()); });

async function open(t) {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('#panels input', {state:'attached'});
  assert.equal(await page.evaluate(() => typeof window.Emulsion), 'object', 'public browser API is available');
  await page.evaluate(() => Emulsion.ready);
  await context.setOffline(true);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 320, 240);
    g.addColorStop(0, '#304050'); g.addColorStop(1, '#c09070'); x.fillStyle = g; x.fillRect(0, 0, 320, 240);
    const blob = await new Promise(r => c.toBlob(r));
    await Emulsion.openFiles([new File([blob], 'sample.png', {type:'image/png'})]);
  });
  t.after(() => assert.deepEqual(errors, [], 'no browser runtime exceptions'));
  return page;
}

test('recipes round-trip through UI, history and offline browser rendering', async t => {
  const page = await open(t);
  const result = await page.evaluate(async () => {
    const base = await Emulsion.render({type:'image/png'});
    await Emulsion.applyRecipe({format:'emulsion-recipe',version:1,settings:{exposure:1}});
    const changed = await Emulsion.render({type:'image/png'});
    const recipe = await Emulsion.getRecipe();
    const bytes = async blob => Array.from(new Uint8Array(await blob.arrayBuffer()));
    return {base:await bytes(base.blob),changed:await bytes(changed.blob),width:changed.width,height:changed.height,recipe,info:Emulsion.inspect()};
  });
  assert.equal(result.width, 320); assert.equal(result.height, 240);
  assert.notDeepEqual(result.base, result.changed);
  assert.equal(result.recipe.settings.exposure, 1);
  assert.equal(await page.locator('#panels input[aria-label="Exposure value"]').first().inputValue(), '+1.00');
  await page.evaluate(() => Emulsion.undo());
  assert.equal(await page.evaluate(async () => (await Emulsion.getRecipe()).settings.exposure), 0);
  await page.evaluate(() => Emulsion.redo());
  const renderedAgain = await page.evaluate(async recipe => {
    await Emulsion.applyRecipe(recipe);
    const out = await Emulsion.render({type:'image/png'});
    return Array.from(new Uint8Array(await out.blob.arrayBuffer()));
  }, result.recipe);
  assert.deepEqual(renderedAgain, result.changed, 'same renderer and recipe reproduce the PNG');
  await page.locator('#panels input[aria-label="Exposure value"]').first().fill('0.5');
  await page.locator('#panels input[aria-label="Exposure value"]').first().press('Tab');
  await page.getByRole('button', {name:'Recipes', exact:true}).click();
  await page.getByRole('button', {name:'Use current edits', exact:true}).click();
  const json = JSON.parse(await page.getByLabel('Photo recipe JSON').inputValue());
  assert.equal(json.settings.exposure, 0.5, 'manual edits are reflected in exported recipe');
  json.settings.exposure = 0.7;
  await page.getByLabel('Photo recipe JSON').fill(JSON.stringify(json));
  await page.getByRole('dialog', {name:'Photo recipes'}).getByRole('button', {name:'Apply recipe', exact:true}).click();
  await page.waitForFunction(() => st.S.exposure === 0.7);
  assert.equal(await page.locator('#panels input[aria-label="Exposure value"]').first().inputValue(), '+0.70');
});

test('invalid recipes leave current edits intact', async t => {
  const page = await open(t);
  const out = await page.evaluate(async () => {
    await Emulsion.applyRecipe({format:'emulsion-recipe',version:1,settings:{exposure:0.3}});
    const before = JSON.stringify(await Emulsion.getRecipe());
    let error;
    try { await Emulsion.applyRecipe({format:'emulsion-recipe',version:99,settings:{exposure:3}}); }
    catch(e) { error = e.message; }
    return {error,before,after:JSON.stringify(await Emulsion.getRecipe())};
  });
  assert.ok(out.error); assert.equal(out.before, out.after);
});

test('portable brush masks and LUTs reproduce edits, including LUT undo', async t => {
  const page = await open(t);
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width=32; canvas.height=24;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='white'; ctx.fillRect(0,0,16,24);
    const data=canvas.toDataURL('image/png');
    const values=[]; for(let b=0;b<2;b++)for(let g=0;g<2;g++)for(let r=0;r<2;r++)values.push(r,g,b);
    const recipe={format:'emulsion-recipe',version:1,settings:{lut:'Test LUT',masks:[{
      id:'brush-1',type:'brush',a:[0,0,0,0],feather:50,invert:false,amount:100,
      adj:{exposure:1,contrast:0,saturation:0,clarity:0,temp:0,tint:0},data
    }]},assets:{lut:{name:'Test LUT',size:2,data:values}}};
    const bytes=async()=>Array.from(new Uint8Array(await (await Emulsion.render({type:'image/png'})).blob.arrayBuffer()));
    const base=await bytes();
    await Emulsion.applyRecipe(recipe); const first=await bytes();
    const saved=await Emulsion.getRecipe();
    await Emulsion.applyRecipe({format:'emulsion-recipe',version:1,settings:{}});
    await Emulsion.applyRecipe(saved); const replay=await bytes();
    const changed=JSON.parse(JSON.stringify(saved)); changed.assets.lut.data=values.map((v,i)=>i%3===0?0:v);
    await Emulsion.applyRecipe(changed); const second=await bytes();
    await Emulsion.undo(); const undone=await bytes();
    await Emulsion.redo(); const redone=await bytes();
    return {base,first,replay,second,undone,redone,saved};
  });
  assert.notDeepEqual(result.base,result.first,'brush exposure changes pixels');
  assert.deepEqual(result.replay,result.first,'embedded assets round trip');
  assert.notDeepEqual(result.second,result.first,'changed LUT content takes effect');
  assert.deepEqual(result.undone,result.first,'undo retains the old LUT content');
  assert.deepEqual(result.redone,result.second);
  assert.ok(result.saved.settings.masks[0].data.startsWith('data:image/png;base64,'));
});

test('failed photo decode is rejected rather than reported as a successful import', async t => {
  const page = await open(t);
  const result=await page.evaluate(async()=>{
    try { await Emulsion.openFiles([new File(['broken image'],'broken.png',{type:'image/png'})]); return {error:null}; }
    catch(e){return {error:e.message,info:Emulsion.inspect()};}
  });
  assert.match(result.error,/decod|photo/i);
  assert.equal(result.info.current.loaded,false);
});

test('small exports respect maximum dimensions and aspect ratio', async t => {
  const page=await open(t);
  const sizes=await page.evaluate(async()=>{
    const a=await Emulsion.render({type:'image/png',max:4});
    const b=await Emulsion.render({type:'image/png',max:1});
    return [[a.width,a.height],[b.width,b.height]];
  });
  assert.deepEqual(sizes,[[4,3],[1,1]]);
});

test('LibRaw decodes a synthetic DNG and exports the developed image offline', async t => {
  const page=await open(t);
  const out=await page.evaluate(async base64=>{
    const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    await Emulsion.openFiles([new File([data],'synthetic.dng')]);
    await Emulsion.applyRecipe({format:'emulsion-recipe',version:1,settings:{film:'port400',exposure:0.4}});
    const output=await Emulsion.render({type:'image/png'});
    return {info:Emulsion.inspect(),width:output.width,height:output.height,bytes:output.blob.size};
  },fixtures.syntheticDng().toString('base64'));
  assert.equal(out.info.current.kind,'raw');assert.equal(out.info.current.loaded,true);
  assert.equal(out.width,64);assert.equal(out.height,48);assert.ok(out.bytes>100);
});

test('duplicate photo names fail explicitly without selecting stale pixels', async t => {
  const page=await open(t);
  const result=await page.evaluate(async()=>{
    const before=Emulsion.inspect(); let error;
    try{await Emulsion.openFiles([new File(['new pixels'],'sample.png')]);}catch(e){error=e.message;}
    return {before,after:Emulsion.inspect(),error};
  });
  assert.match(result.error,/already|duplicate/i);
  assert.deepEqual(result.before,result.after);
});

test('conflicting maximum-length LUT names stay portable', async t => {
  const page=await open(t);
  const recipe=await page.evaluate(async()=>{
    const name='X'.repeat(256), data=[];
    for(let b=0;b<2;b++)for(let g=0;g<2;g++)for(let r=0;r<2;r++)data.push(r,g,b);
    const recipe={format:'emulsion-recipe',version:1,settings:{lut:name},assets:{lut:{name,size:2,data}}};
    await Emulsion.applyRecipe(recipe);
    recipe.assets.lut.data=recipe.assets.lut.data.map((v,i)=>i%3===0?0:v);
    await Emulsion.applyRecipe(recipe);
    return Emulsion.getRecipe();
  });
  assert.ok(recipe.assets.lut.name.length<=256);
  assert.equal(recipe.settings.lut,recipe.assets.lut.name);
});

test('keyboard edits cannot race an asynchronous render', async t => {
  const page=await open(t);
  await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=16;c.height=16;
    c.getContext('2d').fillRect(0,0,16,16);
    await Emulsion.applyRecipe({format:'emulsion-recipe',version:1,settings:{masks:[{
      id:'test-mask',type:'brush',a:[0,0,0,0],feather:50,invert:false,amount:100,
      adj:{exposure:1},data:c.toDataURL('image/png')
    }]}});
    const original=Image.prototype.decode;
    Image.prototype.decode=function(){
      window.decodeEntered=true;
      return new Promise(resolve=>{window.releaseDecode=()=>{Image.prototype.decode=original;resolve(original.call(this));};});
    };
    window.pendingRender=Emulsion.render({type:'image/png'});
  });
  await page.waitForFunction(()=>window.decodeEntered);
  await page.keyboard.press('Control+z');
  await page.evaluate(async()=>{window.releaseDecode();await window.pendingRender;});
  assert.equal(await page.evaluate(()=>Emulsion.inspect().settings.masks.length),1);
  await page.evaluate(()=>Emulsion.undo());
  assert.equal(await page.evaluate(()=>Emulsion.inspect().settings.masks.length),0);
});

test('RAW dimensions beyond GPU capacity reject instead of exporting black pixels', async t => {
  const page=await open(t);
  const width=await page.evaluate(()=>engine.maxTex+2);
  const result=await page.evaluate(async base64=>{
    let error;
    try{await Emulsion.openFiles([new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'oversized.dng')]);}
    catch(e){error=e.message;}
    return {error,info:Emulsion.inspect()};
  },fixtures.syntheticDng({width}).toString('base64'));
  assert.ok(result.error,'oversized RAW import must fail');
  assert.equal(result.info.current.loaded,false);
});
