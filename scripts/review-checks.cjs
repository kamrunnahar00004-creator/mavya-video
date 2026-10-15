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
  const { retimeTexts, cutOutTexts, runSteps } = load('lib/edit.ts');
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

  const { validRunPatch } = load('lib/server/run-validation.ts');
  assert.equal(validRunPatch({hook: run.hook, demo: run.demo, texts: [text]}), true);
  for (const bad of [[], null, {hook: []}, {hook: {mode: 'upload'}}, {demo: {clip: null, frame: 'none', clips: [null]}}, {texts: [null]}, {texts: [{...text, end: -1}]}, {hook: {...run.hook, adjust: {keys: null}}}, {sounds: [null]}, {hook: {...run.hook, generated: {src: 'https://example.com/a.mp4', seconds: 3, at: 'now'}}}]) assert.equal(validRunPatch(bad), false, JSON.stringify(bad));

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
  console.log('PASS: sound migration, millisecond timing, malformed sections, storage recovery/concurrency, byte ranges, coalesced saves');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
