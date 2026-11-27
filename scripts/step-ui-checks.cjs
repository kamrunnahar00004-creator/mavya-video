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
ok(/open \? "space-y-4 border-2 border-ink bg-panel py-5" : "bg-raised py-4/.test(rv), 'open step: white with a dark border; the others on a light shade, no border (founder)');
ok(/relative flex h-6 w-6 shrink-0/.test(rv) && /done \? "bg-accent-tint text-accent"/.test(rv) && !/relative flex h-8 w-8 shrink-0/.test(rv), 'small, quiet check on finished steps');
ok(/relative flex h-6 w-6 shrink-0 items-center justify-center text-\[12\.5px\]/.test(rv) && !/h-7 w-7 shrink-0 items-center justify-center rounded-full/.test(rv), 'square number box, not a circle');
ok(/max-w-\[760px\] space-y-3 px-8/.test(rv) && !/Next: pick/.test(rv), 'cards stacked; no Next buttons (steps open any time)');
ok(!/SuggestedHooks|SuggestedCharacters/.test(rv) && /"Upload a video" : "Describe your own"/.test(rv) && /Browse characters/.test(rv), 'hook and character steps: only today\'s 3 buttons (founder: the 3 picks felt restrictive)');
const ed = fs.readFileSync('src/components/editor-tools.tsx', 'utf8');
const box = ed.slice(ed.indexOf('// One box of choices'), ed.indexOf('// One row of 9:16 tiles'));
ok(/\n\s*Upload your demo\n/.test(box) && /\n\s*Get viral script\n/.test(box) && /\n\s*From My files\n/.test(box) && !/Plan it shot by shot|Check library/.test(box), 'Add your demo: three clear buttons (Upload your demo, Get viral script, From My files)');
ok(/or drop your videos here/.test(box) && /\{\.\.\.dropZone\}/.test(box), 'dropping videos still works, and says so');
const EXPECTED = 7;
assert.equal(checks, EXPECTED, `step-ui-checks: ${checks} of ${EXPECTED}`);
console.log(`step-ui-checks: ${checks} checks pass`);
