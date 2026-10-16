// Focused regressions for the 2026-10-15 review. No packages or user data needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {};
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2)) + '.ts';
  return originalLoad.call(this, id, parent, main);
};
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const load = (p) => require(path.join(root, 'src', p));

async function main() {
  const { retimeTexts, cutOutTexts, runSteps, remapTexts, timeline, moveClipPiece, removeDemoClip, storeParts, fileAt, videoLength } = load('lib/edit.ts');
  const { soundPieces } = load('lib/sound.ts');
  const run = { hook: { mode: 'upload', text: '', clip: null }, demo: { clip: null, frame: 'none' }, sound: { kind: 'upload', src: '/api/media/a.mp3', start: 1, at: 2, end: 4, volume: 80 }, sounds: [] };
  assert.deepEqual(soundPieces(run, 8), []);
  assert.equal(runSteps(run)[4], false);
  delete run.sounds;
  assert.equal(soundPieces(run, 8)[0].at, 2);
  assert.equal(soundPieces(run, 8)[0].end, 4);
  const text = { id: 'one', text: 'hello', start: 1.333, end: 4.666, x: 50, y: 50, size: 4, font: 'Arial', color: '#fff', style: 'plain' };
  const [retimed] = retimeTexts([text], 1.333, { start: 0, end: 3.333, speed: 1 }, { start: 0.4, end: 3.333, speed: 1.3 });
  assert.equal(retimed.start, 1.333);
  assert.ok(Math.abs(retimed.end - (1.333 + 2.933 / 1.3)) < 0.001);
  assert.equal(cutOutTexts([{ ...text, start: 6.333, end: 7.333 }], 1, 2.777)[0].start, 3.556);

  const pieces = [{id:'a', start:0, end:1}, {id:'b', start:3, end:4}];
  assert.equal(remapTexts([{...text,start:0,end:1}],0,{parts:pieces,speed:1},{parts:[pieces[1]],speed:1}).length,0);
  const short = remapTexts([{...text,start:0,end:2}],0,{parts:pieces,speed:1},{parts:[{id:'a',start:0,end:0.1}],speed:1});
  assert.equal(short[0].end,0.1);
  assert.equal(storeParts([pieces[1]]).parts[0].id,'b');
  const sample = { ...run, hook:{...run.hook,generated:{src:'/samples/hook-sample.mp4',seconds:2,at:'now'},start:0,end:2}, demo:{clip:null,frame:'none',clips:[{id:'d1',label:'First',src:'/samples/hook-sample.mp4',seconds:4,start:0,end:4,parts:pieces,gap:1},{id:'d2',label:'Second',src:'/samples/hook-sample.mp4',seconds:2,start:0,end:2,gap:2}]}};
  assert.equal(videoLength(timeline(sample,null)),9);
  assert.equal(fileAt(timeline(sample,null)[1],1.5).file,3.5);
  const attached = [{...text,id:'a-text',start:3,end:4},{...text,id:'b-text',start:4,end:5},{...text,id:'last',start:7,end:9}];
  const moved = moveClipPiece(sample,attached,'d1','b',null,'extracted');
  const movedSegs=timeline({...sample,...moved},null);
  const movedText=moved.texts.find(t=>t.id==='b-text');
  assert.equal(movedText.start,movedSegs.find(s=>s.id==='extracted').offset);
  assert.equal(moved.texts.find(t=>t.id==='last').start,movedSegs.find(s=>s.id==='d2').offset);
  assert.equal(movedSegs.find(s=>s.id==='extracted').gap,0);
  const removed=removeDemoClip(sample,'d1',attached,false);
  assert.equal(removed.texts.find(t=>t.id==='last').start,4);
  assert.equal(removed.texts.some(t=>t.id==='a-text'),false);
  const held=removeDemoClip(sample,'d1',attached,true);
  assert.equal(timeline({...sample,...held},null)[1].offset,7);
  assert.equal(held.texts.find(t=>t.id==='last').start,7);
  assert.equal(removeDemoClip(sample,'d2',attached).texts.some(t=>t.id==='last'),false);

  const { validRunPatch, validAnalysis } = load('lib/server/run-validation.ts');
  assert.equal(validRunPatch({hook: run.hook, demo: run.demo, texts: [text]}), true);
  for (const bad of [[], null, {hook: []}, {hook: {mode: 'upload'}}, {demo: {clip: null, frame: 'none', clips: [null]}}, {texts: [null]}, {texts: [{...text, end: -1}]}, {hook: {...run.hook, adjust: {keys: null}}}, {sounds: [null]}, {hook: {...run.hook, generated: {src: 'https://example.com/a.mp4', seconds: 3, at: 'now'}}}]) assert.equal(validRunPatch(bad), false, JSON.stringify(bad));
  for(const bad of [{hook:{...run.hook,face:{kind:'ai',index:6}}},{texts:[text,text]},{texts:[{...text,second:{}}]},{demo:{...sample.demo,clips:[{...sample.demo.clips[0],id:'hook'}]}},{demo:{...sample.demo,clips:[sample.demo.clips[0],sample.demo.clips[0]]}},{hook:{...sample.hook,parts:[{id:'a',start:0,end:5}]}},{demo:{...sample.demo,clips:[{...sample.demo.clips[0],parts:[pieces[0],pieces[0]]}]}}]) assert.equal(validRunPatch(bad),false,JSON.stringify(bad));
  assert.equal(validAnalysis({segments:{}}),false);
  assert.equal(validAnalysis({duration:3,width:1080,height:1920,cuts:[],segments:[{start:0,end:3,role:'hook',note:''}],analyzedAt:'now'}),true);

  const previous = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mavya-review-'));
  try {
    process.chdir(dir);
    const store = load('lib/server/store.ts');
    const runs = await Promise.all(Array.from({length: 8}, () => store.createRun()));
    assert.equal((await store.listRuns()).length, 8);
    fs.writeFileSync('.data/db.json', '{broken');
    await assert.rejects(store.updateRun(runs[0].id, {title: 'Do not erase'}));
    assert.equal(fs.readFileSync('.data/db.json', 'utf8'), '{broken');
    fs.writeFileSync('.data/db.json', JSON.stringify({references: [], runs, assets: []}));
    assert.equal((await store.updateRun(runs[0].id, {title: 'Recovered'})).title, 'Recovered');
    assert.equal((await store.listRuns()).length, 8);

    const { fileResponse } = load('lib/server/file-response.ts');
    fs.writeFileSync('audio', '0123456789');
    for (const [range, status, body] of [['bytes=2-4', 206, '234'], ['bytes=-3', 206, '789'], ['bytes=8-', 206, '89'], ['bytes=99-', 416, ''], ['bytes=-0', 416, ''], ['bytes=bad', 416, '']]) {
      const response = fileResponse(new Request('http://local', {headers:{range}}), path.join(dir, 'audio'), 10, 'audio/mp4');
      assert.equal(response.status, status); assert.equal(await response.text(), body);
    }
  } finally { process.chdir(previous); fs.rmSync(dir, {recursive: true, force: true}); }

  const fetchBefore = global.fetch;
  let calls = [], concurrent = 0, maxConcurrent = 0;
  global.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body)); maxConcurrent = Math.max(maxConcurrent, ++concurrent);
    await new Promise(r => setTimeout(r, 30)); concurrent--;
    return Response.json({id:'test'});
  };
  try {
    const { patchRun } = load('lib/client.ts');
    await Promise.all(Array.from({length:21}, (_, volume) => patchRun('test', {sounds:[{volume}]})));
    assert.equal(calls.length, 1); assert.equal(calls[0].sounds[0].volume, 20);
    await Promise.all([patchRun('test', {title:'last'}), patchRun('test', {texts:[text]})]);
    assert.equal(calls.length, 2); assert.equal(calls[1].title, 'last'); assert.equal(calls[1].texts[0].text, 'hello');
    assert.equal(maxConcurrent, 1);
  } finally { global.fetch = fetchBefore; }
  const documentBefore = global.document;
  let drawings = 0, retained = 0;
  const videos = [];
  class FrameVideo extends EventTarget {
    constructor() { super(); this.readyState=0; this.duration=10; this.videoWidth=640; this.videoHeight=480; this.time=0; this.source=''; this.listeners=new Map(); }
    addEventListener(name, fn) { super.addEventListener(name,fn); if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { super.removeEventListener(name,fn); this.listeners.get(name)?.delete(fn); }
    set src(value) { this.source=value;retained++;queueMicrotask(()=>{if(value.includes('missing')){this.error={};this.dispatchEvent(new Event('error'));}else{this.readyState=2;this.dispatchEvent(new Event('loadedmetadata'));this.dispatchEvent(new Event('loadeddata'));}}); }
    set currentTime(value) { this.time=value;queueMicrotask(()=>this.dispatchEvent(new Event('seeked'))); }
    get currentTime() { return this.time; }
    pause() {}
    load() {}
    removeAttribute(name) { if(name==='src'&&this.source){this.source='';retained--;} }
  }
  global.document={createElement(tag){if(tag==='video'){const v=new FrameVideo();videos.push(v);return v;}return {getContext:()=>({drawImage(){drawings++;}}),toDataURL:()=> 'frame'+drawings};}};
  try {
    const {frameAt}=load('lib/filmstrip.ts');
    const first=frameAt('one',0);assert.equal(frameAt('one',0),first);assert.ok(await first);
    assert.ok(await frameAt('one',0.0001));assert.equal(drawings,1);
    for(let i=1;i<280;i++) await frameAt('one',i/100);
    await frameAt('one',0);assert.equal(drawings,281);
    for(let i=0;i<16;i++) await frameAt('file'+i,0);
    assert.ok(retained<=8);
    const started=Date.now();assert.deepEqual(await Promise.all(Array.from({length:6},(_,i)=>frameAt('missing',i))),Array(6).fill(null));
    assert.ok(Date.now()-started<500);
    assert.ok(videos.every(v=>[...v.listeners.values()].every(set=>set.size===0)));
  } finally { global.document=documentBefore; }
  console.log('PASS: sound migration, piece/gap timing, malformed sections, storage recovery/concurrency, byte ranges, coalesced saves, bounded filmstrip cleanup');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
