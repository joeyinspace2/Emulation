'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const recipe = require('../src/recipe.js');
const { DEF, newSettings, STOCKS, LOOKS, MASK_ADJ } = require('../src/film.js');
const partial = settings => ({ format: 'emulsion-recipe', version: 1, settings });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=';
const mask = (type = 'linear') => ({id:'mask-1',type,a:type==='radial'?[0.5,0.5,0.2,0.3]:[0,0,1,1],feather:50,invert:false,amount:100,adj:{...MASK_ADJ},data:type==='brush'?png:null});
const lut = () => ({name:'identity',size:2,data:[0,0,0,1,0,0,0,1,0,1,1,0,0,0,1,1,0,1,0,1,1,1,1,1]});

test('partial settings become complete independent defaults without mutation', () => {
  const input = partial({exposure:0.75, grade:{sh:{s:15}}});
  const before = JSON.stringify(input);
  const actual = recipe.validate(input);
  assert.deepEqual(actual.settings,{...newSettings(), exposure:0.75,grade:{...DEF.grade,sh:{...DEF.grade.sh,s:15}}});
  actual.settings.curve.rgb[0][0] = 0.2;
  assert.equal(JSON.stringify(input),before);
  assert.equal(recipe.defaults().curve.rgb[0][0],0);
  assert.deepEqual(recipe.defaults(),newSettings());
});

test('all existing default settings, films and built-in looks validate', () => {
  assert.deepEqual(recipe.create(newSettings()).settings,newSettings());
  for(const stock of STOCKS) assert.equal(recipe.create({film:stock.id}).settings.film,stock.id);
  for(const [name,settings] of LOOKS) assert.equal(recipe.create(settings,{name}).name,name);
  const metadata = recipe.looks();
  assert.deepEqual(metadata.films[0],{id:'none',name:'None',group:'',description:'No film emulation'});
  assert.deepEqual(metadata.looks.map(x=>x.name),LOOKS.map(x=>x[0]));
  metadata.looks[0].settings.contrast = -50;
  assert.equal(recipe.looks().looks[0].settings.contrast,12);
});

test('metadata and output options round trip and default independently', () => {
  const input = {name:'Night edit',source:{name:'picture.raw'},output:{type:'image/png'}};
  const result = recipe.create({exposure:1},input);
  assert.deepEqual(result.output,{type:'image/png',quality:0.92,max:0});
  assert.equal(result.name,input.name);
  assert.deepEqual(result.source,input.source);
  assert.notEqual(result.source,input.source);
  assert.deepEqual(recipe.validate(result),result);
});

test('rejects invalid metadata, unknown keys and unsafe object shapes at every level', () => {
  for (const value of [null,[],{}, {...partial({}),format:'other'}, {...partial({}),version:2}, {...partial({}),extra:1},partial({film:'missing'}),partial({brightness:1}),partial({grade:{sh:{unknown:0}}}),partial({curve:{alpha:[[0,0],[1,1]]}}),{...partial({}),name:''},{...partial({}),name:'a'.repeat(257)},{...partial({}),source:{name:'x',path:'file:///x'}},partial({lut:'constructor'})]) {
    assert.throws(()=>recipe.validate(value),Error);
  }
  for (const input of [JSON.parse('{"format":"emulsion-recipe","version":1,"settings":{"__proto__":{}}}'),JSON.parse('{"format":"emulsion-recipe","version":1,"settings":{"constructor":{}}}'),partial(Object.create({exposure:1})),partial({grade:{prototype:{}}})]) assert.throws(()=>recipe.validate(input),Error);
  const getter = {};
  Object.defineProperty(getter,'exposure',{enumerable:true,get(){throw new Error('getter executed');}});
  assert.throws(()=>recipe.validate(partial(getter)),/plain|data|accessor/i);
  assert.throws(()=>recipe.create({}, {settings:{}}),/unknown/i);
  assert.equal({}.polluted,undefined);
});

test('finite numeric ranges, scalar types and array lengths are strict', () => {
  for(const settings of [{exposure:NaN},{contrast:Infinity},{exposure:5.01},{temp:-101},{sharpRadius:0},{sharpen:151},{halThresh:19},{halHue:61},{angle:46},{rot90:0.5},{leakSeed:0},{fxSeed:998},{bw:1},{hslH:[0]},{hslS:Array(8).fill(101)},{crop:{w:0}},{crop:{cx:2}},{grade:{mid:{h:361}}}]) assert.throws(()=>recipe.create(settings),Error);
  const sparse = Array(8); assert.throws(()=>recipe.create({hslH:sparse}),Error);
  assert.throws(()=>recipe.create({hslH:Object.assign(Array(8).fill(0),{surprise:1})}),Error);
});

test('curves preserve channels and reject malformed geometry', () => {
  const result=recipe.create({curve:{rgb:[[0,0.1],[0.5,0.6],[1,0.9]]}});
  assert.deepEqual(result.settings.curve.r,[[0,0],[1,1]]);
  for(const points of [[],[[0,0]],[[0,0],[0,1]],[[0.2,0],[1,1]],[[0,0],[1,2]],[[0,0,1],[1,1]],Array.from({length:15},(_,i)=>[i/14,i/14])]) assert.throws(()=>recipe.create({curve:{rgb:points}}),Error);
  assert.equal(recipe.create({aspect:'9:16',rot90:3,flipH:true,crop:{cx:0.5,cy:0.5,w:0.4,h:0.8}}).settings.aspect,'9:16');
  assert.throws(()=>recipe.create({aspect:'3:7'}),Error);
});

test('all mask kinds, out-of-frame coordinates and heal spots survive round trip', () => {
  const masks = [mask('linear'),{...mask('radial'),id:'mask-2',a:[-2,3,1.5,0.01]},{...mask('brush'),id:'mask-3'}];
  const spots=[{x:-1,y:2,r:0.025,f:0.4,sx:1.2,sy:-0.2,o:1}];
  const result=recipe.create({masks,spots});
  assert.deepEqual(result.settings.masks,masks);
  assert.deepEqual(result.settings.spots,spots);
  assert.notEqual(result.settings.masks[0].adj,masks[0].adj);
  assert.deepEqual(recipe.validate(result),result);
  assert.equal(recipe.create({masks:[{...mask('brush'),data:null}]}).settings.masks[0].data,null);
});

test('mask and spot malformed fields or counts fail without silent truncation', () => {
  for(const masks of [[mask(),mask()],Array.from({length:7},(_,i)=>({...mask(),id:String(i)})),[{...mask(),type:'script'}],[{...mask(),a:[0,0,1]}],[{...mask('radial'),a:[0,0,0,1]}],[{...mask(),adj:{exposure:5}}],[{...mask(),unknown:1}],[{...mask('brush'),data:'https://example.com/mask.png'}],[{...mask('brush'),data:'data:image/svg+xml;base64,AAAA'}],[{...mask('brush'),data:'data:image/png;base64,AAAA'}],[{...mask(),data:png}]]) assert.throws(()=>recipe.create({masks}),Error);
  const spot={x:0.5,y:0.5,r:0.025,f:0.4,sx:0.6,sy:0.5,o:1};
  for(const spots of [Array(17).fill(spot),[{...spot,r:0}],[{...spot,f:2}],[{...spot,o:2}],[{...spot,sx:NaN}],[{...spot,extra:1}]]) assert.throws(()=>recipe.create({spots}),Error);
});

test('PNG brush assets are bounded and structurally checked', () => {
  assert.throws(()=>recipe.create({masks:[{...mask('brush'),data:'data:image/png;base64,'+'A'.repeat(6*1024*1024)}]}),/limit|large|bytes/i);
  const damaged=Buffer.from(png.split(',')[1],'base64'); damaged[20]=255;
  assert.throws(()=>recipe.create({masks:[{...mask('brush'),data:'data:image/png;base64,'+damaged.toString('base64')}]}),Error);
});

test('embedded LUTs match selection, retain finite HDR samples, reject oversized/malformed arrays', () => {
  const asset=lut();asset.data[0]=-1;asset.data[1]=2;
  const result=recipe.create({lut:asset.name},{assets:{lut:asset}});
  assert.deepEqual(result.assets.lut,asset);
  assert.notEqual(result.assets.lut.data,asset.data);
  assert.deepEqual(recipe.validate(result),result);
  for(const bad of [{...asset,size:1},{...asset,size:65},{...asset,data:[0]},{...asset,data:asset.data.map((v,i)=>i? v:NaN)},{...asset,name:'other'},{...asset,extra:1}]) assert.throws(()=>recipe.create({lut:'identity'},{assets:{lut:bad}}),Error);
  assert.throws(()=>recipe.create({lut:'identity'}),/LUT|lut/);
  assert.throws(()=>recipe.create({},{assets:{lut:lut()}}),/LUT|lut/);
});

test('output rejects unsupported MIME, nonfinite values and bounds', () => {
  for(const output of [{type:'image/svg+xml'},{quality:0},{quality:1.1},{quality:NaN},{max:-1},{max:1.2},{max:32769},{extra:1}]) assert.throws(()=>recipe.create({}, {output}),Error);
  for(const type of ['image/png','image/jpeg','image/webp']) assert.equal(recipe.create({},{output:{type,quality:0.4,max:2048}}).output.type,type);
});

test('browser concatenation exposes global API without lexical collisions', () => {
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../src/film.js'),'utf8')+'\n'+fs.readFileSync(require.resolve('../src/recipe.js'),'utf8'),context);
  assert.equal(vm.runInContext('EmulsionRecipe.create({exposure:1}).settings.exposure',context),1);
  assert.deepEqual(Object.keys(context.EmulsionRecipe).sort(),['create','defaults','looks','validate']);
});

test('validation rejects symbols, hidden fields and arrays with unsafe prototypes', () => {
  const symbolInput=partial({});symbolInput[Symbol('hidden')]=1;
  assert.throws(()=>recipe.validate(symbolInput),/unknown|unsafe/);
  const hidden={};Object.defineProperty(hidden,'exposure',{value:1});
  assert.throws(()=>recipe.create(hidden),/enumerable/);
  const values=Array(8).fill(0);Object.setPrototypeOf(values,{map(){throw new Error('executed');}});
  assert.throws(()=>recipe.create({hslH:values}),/array/i);
});

test('validation never mutates nested portable assets or output metadata', () => {
  const input={...partial({lut:'identity',masks:[mask('brush')],curve:{rgb:[[0,0.1],[1,0.9]]}}),name:'Portable',assets:{lut:lut()},output:{type:'image/png'},source:{name:'test.png'}};
  const before=JSON.stringify(input);const result=recipe.validate(input);
  result.assets.lut.data[0]=5;result.settings.masks[0].a[0]=7;result.output.max=1;result.source.name='changed';
  assert.equal(JSON.stringify(input),before);
});

test('LUT names cannot address inherited registry properties', () => {
  for (const name of ['__proto__','constructor','prototype','toString']) {
    assert.throws(() => recipe.create({lut:name},{assets:{lut:{...lut(),name}}}), /name|reserved|unsafe|LUT/i);
  }
});

test('crop sizes cannot underflow affine geometry', () => {
  for(const v of [Number.MIN_VALUE,1e-30]) assert.throws(()=>recipe.create({crop:{w:v,h:v}}),/crop/);
});

test('invalid enum errors do not execute object coercion', () => {
  let called=false;
  const input={toString(){called=true;return 'bad';}};
  assert.throws(()=>recipe.create({film:input}),/film/);
  assert.equal(called,false);
});

test('lab scanner settings validate per machine and default to no scanner', () => {
  const { SCANNERS, SCAN_RANGES } = require('../src/film.js');
  assert.equal(newSettings().scan, 'none');
  assert.deepEqual(SCANNERS.map(s => s.id), ['none', 'frontier', 'noritsu']);
  const settings = s => recipe.validate({format:'emulsion-recipe',version:1,settings:s}).settings;
  const partial = settings({scan:'frontier',frontier:{d:-2,hiTone:1}});
  assert.equal(partial.scan, 'frontier');
  assert.deepEqual(partial.frontier, {...DEF.frontier, d:-2, hiTone:1}, 'omitted machine controls keep their defaults');
  assert.deepEqual(partial.noritsu, DEF.noritsu);
  for (const [id, limits] of Object.entries(SCAN_RANGES)) for (const [key, [min, max]] of Object.entries(limits)) {
    assert.equal(settings({[id]:{[key]:min}})[id][key], min); assert.equal(settings({[id]:{[key]:max}})[id][key], max);
    for (const value of [min - 1, max + 1, min + 0.5, '1', null, NaN]) assert.throws(() => settings({[id]:{[key]:value}}), new RegExp('settings\\.' + id + '\\.' + key), id + '.' + key + ' rejects ' + value);
    assert.ok(DEF[id][key] >= min && DEF[id][key] <= max);
  }
  assert.throws(() => settings({scan:'imacon'}), /settings\.scan/);
  assert.throws(() => settings({frontier:{chroma:100}}), /unknown or unsafe key/);
  assert.throws(() => settings({noritsu:[]}), /plain object/);
  assert.deepEqual(recipe.looks().scanners.map(s => s.id), ['none', 'frontier', 'noritsu']);
});
test('scanner keys follow lab conventions and each machine keeps its character', () => {
  const { scanParams } = require('../src/film.js');
  const params = (scan, extra = {}) => scanParams({...newSettings(), scan, ...extra});
  assert.equal(params('none'), null);
  const frontier = params('frontier'), noritsu = params('noritsu');
  assert.deepEqual(frontier.gain, [1, 1, 1]);
  for (const p of [frontier, noritsu]) for (let row = 0; row < 3; row++) assert.ok(Math.abs(p.m[row*3] + p.m[row*3+1] + p.m[row*3+2] - 1) < 1e-9, 'neutral greys stay neutral');
  assert.ok(frontier.kS > 1 && noritsu.kS < 1, 'Frontier is the more contrasty machine');
  assert.ok(frontier.black > 0 && noritsu.black < 0, 'Frontier sets a deeper black point; Noritsu keeps shadow detail');
  assert.ok(frontier.shT[2] > frontier.shT[0], 'Frontier shadows lean cyan-blue');
  assert.ok(frontier.floor < noritsu.floor, 'Noritsu sharpening reaches the grain');
  const darker = params('frontier', {frontier:{...DEF.frontier, d:6}});
  assert.ok(darker.gain.every(g => Math.abs(g - 0.5) < 1e-9), 'six density keys are one stop darker');
  const cyan = params('noritsu', {noritsu:{...DEF.noritsu, c:12}});
  assert.ok(Math.abs(cyan.gain[0] - 0.5) < 1e-9 && cyan.gain[1] === 1 && cyan.gain[2] === 1, 'cyan holds back red only');
  const hard = params('frontier', {frontier:{...DEF.frontier, hiTone:1, shTone:-1}});
  assert.ok(hard.kH > frontier.kH && hard.kS < frontier.kS);
  assert.equal(params('frontier', {frontier:{...DEF.frontier, hyperHi:0, hyperSh:0}}).hyS, 0);
  const flat = params('noritsu', {noritsu:{...DEF.noritsu, acOverall:5, acShadow:5, chroma:0}});
  assert.ok(flat.kS < noritsu.kS && flat.hyS > noritsu.hyS); assert.equal(flat.sat, 0);
  const mono = scanParams({...newSettings(), scan:'frontier'}, true);
  assert.deepEqual([mono.shT, mono.hlT], [[0,0,0],[0,0,0]], 'black-and-white film is scanned without colour casts');
});
