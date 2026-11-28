// "Like this" examples (founder 2026-11-27): every demo shot plays the viral reel's matching moment beside it. The
// script says which reel shot each new shot copies; that shot's start/end (after the hook) becomes the example;
// without a script, each recipe shot is its own example. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const edit = load('src/lib/edit.ts', { '@/lib/adjust': load('src/lib/adjust.ts') });
const route = load('src/app/api/runs/[id]/script/route.ts', { '@/lib/edit': edit, '@/lib/server/ai-budget': {}, '@/lib/server/gemini': { PRO_MODEL: 'p' }, '@/lib/server/store': {}, '@/lib/server/who': {}, '@/lib/script-rules': { scriptRulesText: () => '' }, 'node:fs/promises': {}, 'node:os': {}, 'node:path': {} });
const src = { id: 'r1', sourceUrl: 'https://www.instagram.com/reel/DcOiTp0xxTK/', recipe: { demo: { shots: [{ start: 3.3, end: 6.5 }, { start: 6.5, end: 12.5 }, { label: 'no times' }] } } };
ok(JSON.stringify(route.exampleOf(src, 1)) === JSON.stringify({ code: 'DcOiTp0xxTK', start: 3.3, end: 6.5 }), 'copies 1: the reel\'s first demo shot is the example');
ok(route.exampleOf(src, 0) === undefined && route.exampleOf(src, 9) === undefined && route.exampleOf(src, 3) === undefined && route.exampleOf(src, '1') === undefined && route.exampleOf(null, 1) === undefined, 'no example for 0, out of range, no times, or no reel');
const r = fs.readFileSync('src/app/api/runs/[id]/script/route.ts', 'utf8');
ok(/copies: \{ type: "INTEGER"/.test(r) && /required: \["label", "hint", "steps", "camera", "text", "seconds", "copies"\]/.test(r) && /n: i \+ 1/.test(r), 'the script must say which numbered reel shot each shot copies');
ok(/as close to it as THIS product allows/.test(r), 'each shot copies its reel shot as closely as the product allows');

const list = edit.shotList({ ...src, recipe: { demo: { shots: [{ label: 'a', start: 3.3, end: 6.5 }, { label: 'b' }] } } });
ok(list[0].example && list[0].example.start === 3.3 && list[1].example === undefined, 'no script yet: recipe shots carry their own moment');
const scripted = edit.shotList(src, { script: { refId: 'r1', shots: [{ label: 'x', hint: '', steps: [], camera: '', text: '', seconds: 2, example: { code: 'DcOiTp0xxTK', start: 6.5, end: 12.5 } }] } });
ok(scripted[0].example.start === 6.5, 'the script\'s example reaches the demo clips');
ok(/text: s\.text, \.\.\.\(s\.example \? \{ example: s\.example \} : \{\}\)/.test(fs.readFileSync('src/components/run-view.tsx', 'utf8')), 'writing the script copies examples into the clips');

const client = load('src/lib/client.ts', { '@/lib/studio-data': load('src/lib/studio-data.ts') });
const v = load('src/lib/server/run-validation.ts', { '@/lib/client': client, '../../../render/constraints.json': require('../render/constraints.json') });
const run = (ex) => v.validRunPatch({ demo: { clip: null, frame: 'none', clips: [{ id: 'c1', label: 'x', example: ex }] } });
ok(run({ code: 'DcOiTp0xxTK', start: 3.3, end: 6.5 }) && !run({ code: '../x', start: 1, end: 2 }) && !run({ code: 'DcOiTp0xxTK', start: 5, end: 4 }), 'saved examples are checked (real code, end after start)');

const ed = fs.readFileSync('src/components/editor-tools.tsx', 'utf8');
ok(/`\/api\/examples\/\$\{code\}`\}#t=/.test(ed) && /v\.currentTime >= end/.test(ed) && /Like this<\/figcaption>/.test(ed), '"Like this" plays only the moment, on a loop');
ok(/brief\.camera \|\| brief\.steps\?\.length \|\| brief\.example/.test(ed) && /<ExampleClip example=\{clip\.example\} \/>/.test(ed), 'shown beside the shot to film');
const ex = fs.readFileSync('src/app/api/examples/[code]/route.ts', 'utf8');
ok(/\^\[A-Za-z0-9_-\]\{5,40\}\$/.test(ex) && /currentUser\(\)\)\) return signInFirst/.test(ex) && /libraryLink\("sources", code\)/.test(ex), 'example route: valid codes only, signed in, the library reel');

ok(edit.reelCode('https://www.instagram.com/reel/ABC123x/?igsh=xyz') === 'ABC123x' && edit.reelCode('https://www.instagram.com/reel/ABC123x/') === 'ABC123x' && edit.reelCode('not a url') === '' && edit.reelCode('https://x.com/a/../') === '', 'reel code from the link path, ?igsh ignored (Codex)');
ok(/: <p className="text-\[13\.5px\] text-muted">\{clip\.hint\}<\/p>/.test(ed), 'a shot with only a hint still shows it beside the example (Codex)');
const shots = edit.exampleShots({ sourceUrl: 'https://www.instagram.com/reel/DcOiTp0xxTK/', recipe: { demo: { shots: [{ start: 3.3, end: 6.5 }, { label: 'no times' }, { start: 9, end: 12 }] } } });
ok(shots.length === 3 && shots[0].start === 3.3 && shots[1] === undefined && shots[2].end === 12 && edit.exampleShots(null).length === 0, 'the reel\'s shots as examples, by position (gaps stay gaps)');
const EXPECTED = 14;
assert.equal(checks, EXPECTED, `shot-example-checks: ${checks} of ${EXPECTED}`);
console.log(`shot-example-checks: ${checks} checks pass`);
