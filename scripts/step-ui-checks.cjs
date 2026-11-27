// Video page steps and Add your demo (founder 2026-11-27, final): steps look as before (round number, no cards);
// hook and character steps have only their 3 buttons; Add your demo has 2 buttons (Upload on your own, Get viral
// script), every slot has Phone / Computer / From My files, the instruction and "Like this" stay once a slot is
// filled, extra clips become new slots, and "or upload multiple videos at once" always ends the card. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const rv = fs.readFileSync('src/components/run-view.tsx', 'utf8');
const ed = fs.readFileSync('src/components/editor-tools.tsx', 'utf8');

ok(/h-7 w-7 shrink-0 items-center justify-center rounded-full/.test(rv) && /max-w-\[760px\] divide-y divide-line px-8/.test(rv) && !/border-ink py-5/.test(rv), 'steps as before: round number, dividers, no cards or borders');
ok(!/SuggestedHooks|SuggestedCharacters/.test(rv) && /"Upload a video" : "Describe your own"/.test(rv) && /Browse characters/.test(rv), 'hook and character steps: only their 3 buttons');

const box = ed.slice(ed.indexOf('// One box of choices'), ed.indexOf('// One row of 9:16 tiles'));
ok(/\n\s*Upload on your own\n/.test(box) && /\n\s*Get viral script\n/.test(box) && !/From My files|Plan it shot by shot|Check library/.test(box), 'Add your demo: 2 buttons, Upload on your own and Get viral script');
ok(/\{many\}/.test(box) && /or upload multiple videos at once/.test(ed) && (ed.match(/\{many\}/g) || []).length === 2, '"or upload multiple videos at once" ends the card, before and after the slots');
ok(/\n\s*Phone\n/.test(ed) && /\n\s*Computer\n/.test(ed) && /onFilesFor\?\.\(selected\.id\)/.test(ed), 'every slot: Phone, Computer, From My files');
ok(/\{selected\.camera \|\| selected\.steps\?\.length \|\| selected\.example \? \(/.test(ed) && ed.indexOf('<ShotBrief clip={selected} />') < ed.indexOf('{clipSrc(selected) && selSeg ? <div className="p-3">{renderEditor(selSeg)}</div>'), 'what to film and Like this stay above the clip once filled');
ok(/onOwn=\{\(\) => \{ setViralNotice\(null\); save\(\{ demo: \{ \.\.\.run\.demo, mode: "clips", clips: \[\{ id: uid\(\), label: "Clip 1" \}\] \} \}\); \}\}/.test(rv), 'Upload on your own: one empty slot to start, no instructions');
ok(/Add your website or a description in step 1\./.test(rv) && /Pick a hook first \(step 2\)\./.test(rv) && /requestScript\(\);/.test(rv) && !/clips: shotList\(source, run\)\.map\(\(x\) => \(\{ \.\.\.x, id: uid\(\) \}\)\) \} \}\);\n\s*\}\}/.test(rv.slice(rv.indexOf('onClips={() => {'), rv.indexOf('onClips={() => {') + 300)), 'Get viral script: never placeholder shots; asks for step 1 or a hook, else writes the script');
const route = fs.readFileSync('src/app/api/runs/[id]/script/route.ts', 'utf8');
ok(/run\.product\?\.brief \?\? \(typed \?/.test(route) && /Add your website or a description in step 1\./.test(route), 'a script from the website, the description, or both');
ok(/const placeInSlots = /.test(rv) && /const slots = target \? \[target, \.\.\.rest\] : rest;/.test(rv) && /else \{\n\s*const seconds = clipSeconds\(c\.length\);\n\s*const count = demoClips/.test(rv), 'clips fill the chosen slot, then empty ones; extras become new slots');
ok(/placeInSlots\(got, phoneTarget\.current\)/.test(rv) && /placeInSlots\(cs, target\)/.test(rv), 'phone and My files both start at the slot they were opened from');

const EXPECTED = 11;
assert.equal(checks, EXPECTED, `step-ui-checks: ${checks} of ${EXPECTED}`);
console.log(`step-ui-checks: ${checks} checks pass`);
