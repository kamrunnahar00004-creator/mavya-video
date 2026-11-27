// Video page steps (founder 2026-11-27): white cards with a square number box and a black border on the open step
// (any step opens any time, no Next buttons); 3 hooks and 3 characters above today's buttons (same wording); a
// click opens them big. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const rv = fs.readFileSync('src/components/run-view.tsx', 'utf8');
ok(/border-2 bg-panel px-5 transition-colors \$\{open \? "space-y-4 border-ink py-5" : "border-line py-4/.test(rv), 'each step is a card; the open one has a black border');
ok(/relative flex h-8 w-8 shrink-0 items-center justify-center text-\[13\.5px\]/.test(rv) && !/h-7 w-7 shrink-0 items-center justify-center rounded-full/.test(rv), 'square number box, not a circle');
ok(/max-w-\[760px\] space-y-3 px-8/.test(rv) && !/Next: pick/.test(rv), 'cards stacked; no Next buttons (steps open any time)');
ok(rv.indexOf('<SuggestedHooks') < rv.indexOf('Browse hooks') && /"Upload a video" : "Describe your own"/.test(rv), '3 hooks above today\'s buttons, same wording');
ok(/onPick=\{\(\) => setView\(r\)\}/.test(rv) && /<HookPreview r=\{view\}/.test(rv), 'a hook opens big with its numbers (the existing preview)');
ok(rv.indexOf('<SuggestedCharacters') < rv.indexOf('Browse characters') && /Use this character<\/button>/.test(rv), '3 characters above today\'s buttons; one opens big with Use this character');

const s = load('src/lib/suggest-hooks.ts');
const refs = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, views: 1000 * (30 - i) }));
const a = s.suggestHooks(refs, 'run-a'), b = s.suggestHooks(refs, 'run-a'), c = s.suggestHooks(refs, 'run-b');
ok(a.length === 3 && JSON.stringify(a) === JSON.stringify(b), 'same video: the same 3 every time');
ok(JSON.stringify(a.map((r) => r.id)) !== JSON.stringify(c.map((r) => r.id)), 'another video gets a different 3');
ok(a.every((r) => Number(r.id.slice(1)) < 24) && s.suggestHooks([{ id: 'x', views: 5, owner: 'u1' }], 's').length === 0, 'only top library hooks (no users\' own uploads)');

const EXPECTED = 9;
assert.equal(checks, EXPECTED, `step-ui-checks: ${checks} of ${EXPECTED}`);
console.log(`step-ui-checks: ${checks} checks pass`);
