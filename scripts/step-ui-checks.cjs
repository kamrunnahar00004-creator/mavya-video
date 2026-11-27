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
ok(/\{brief && \(brief\.camera \|\| brief\.steps\?\.length \|\| brief\.example\) \? \(/.test(ed) && ed.indexOf('<ShotBrief clip={brief} />') < ed.indexOf('{clipSrc(selected) && selSeg ? <div className="p-3">{renderEditor(selSeg)}</div>'), 'what to film and Like this stay above the clip once filled');
ok(/onOwn=\{\(\) => \{ setViralNotice\(null\); save\(\{ demo: \{ \.\.\.run\.demo, mode: "clips", clips: \[\{ id: uid\(\), label: "Clip 1" \}\] \} \}\); \}\}/.test(rv), 'Upload on your own: one empty slot to start, no instructions');
ok(/Add your website or a description in step 1\./.test(rv) && /Pick a hook first \(step 2\)\./.test(rv) && /requestScript\(\);/.test(rv) && !/clips: shotList\(source, run\)\.map\(\(x\) => \(\{ \.\.\.x, id: uid\(\) \}\)\) \} \}\);\n\s*\}\}/.test(rv.slice(rv.indexOf('onClips={() => {'), rv.indexOf('onClips={() => {') + 300)), 'Get viral script: never placeholder shots; asks for step 1 or a hook, else writes the script');
const route = fs.readFileSync('src/app/api/runs/[id]/script/route.ts', 'utf8');
ok(/run\.product\?\.brief \?\? \(typed \?/.test(route) && /Add your website or a description in step 1\./.test(route), 'a script from the website, the description, or both');
ok(/const placeInSlots = /.test(rv) && /const slots = target \? \[target, \.\.\.rest\] : rest;/.test(rv) && /else \{\n\s*const seconds = clipSeconds\(c\.length\);\n\s*const count = demoClips/.test(rv), 'clips fill the chosen slot, then empty ones; extras become new slots');
ok(/placeInSlots\(got, phoneTarget\.current\)/.test(rv) && /placeInSlots\(cs, target\)/.test(rv), 'phone and My files both start at the slot they were opened from');

// Founder 2026-11-27: uploading into a slot showed a second tile with the file name ("looks broken").
ok(/slot: slots\[i\]\?\.id/.test(ed) && /pending\.find\(\(p\) => p\.slot === c\.id\)/.test(ed) && /pending\.filter\(\(p\) => !p\.slot \|\| !clips\.some\(\(c\) => c\.id === p\.slot\)\)/.test(ed), 'an upload shows inside the slot it fills; only extras get their own tile');
ok(/>Uploading<\/p>/.test(ed) && !/leading-tight text-muted">\{p\.name\}<\/p>/.test(ed), 'an extra tile says Uploading, not the file name');
ok(/replace\(selected\.id, list\[0\]\)\.then\(\(ok\) => \(ok && list\.length > 1 \? takeMany\(list\.slice\(1\)\) : undefined\)\)/.test(ed) && /try \{ await onUpload\(id, f\); return true; \}/.test(ed), 'Computer on a filled slot replaces its clip');
ok(/clipSrc\(selected\) && replaceFor !== selected\.id \? \(/.test(ed) && /\n\s*Replace\n/.test(ed) && /setReplaceFor\(selected\.id\)/.test(ed), 'a filled slot shows only Replace; clicking it shows Phone, Computer, From My files');
ok(/onAddSlot\?\.\(nid\); setOpenId\(nid\)/.test(ed) && /onAddSlot=\{\(nid\) => insertClips\(\[\{ id: nid, label: `Clip \$\{demoClips/.test(rv), '+ Add clip adds an empty slot and opens it (its 3 ways in), not the file picker');
ok(/\{manyPhone && phonePanel\}/.test(ed) && /border-2 border-dashed px-4 py-3/.test(ed) && /onPhoneFor\?\.\(undefined\)/.test(ed), '"or upload multiple videos at once" opens Phone (QR) or Computer, not the file picker straight away');
ok(/aria-label="Play the example bigger"/.test(ed) && /<MomentVideo example=\{example\} className="aspect-\[9\/16\] w-full bg-ink object-cover" \/>/.test(ed), 'clicking Like this plays it big, like a character');
ok(/fallbackExamples\?\.\[at\]/.test(ed) && /fallbackExamples=\{exampleShots\(source\)\}/.test(rv), 'older clips with no saved example take the reel\'s shot at their place');
// Founder 2026-11-27: at the end of the preview the sound kept playing (clock stuck at 0:09 / 0:09).
const prev = fs.readFileSync('src/components/run-preview.tsx', 'utf8');
ok(/held < 1 && !m\.v\.ended\) \{ held \+= dt; next = tNow\.current; \}/.test(prev) && /else if \(vt > tNow\.current && vt < tNow\.current \+ 0\.5\) \{ held = 0; next = vt; \}/.test(prev), 'a stopped or finished video never holds the preview clock: it reaches the end, stops, and the sound stops');
ok(/x\.label === selected\.label/.test(ed) && /return false; \} finally \{ setBusy\(null\); \}/.test(ed), 'borrowed example by the shot\'s name first; a failed replace stops the rest (Codex)');
const EXPECTED = 21;
assert.equal(checks, EXPECTED, `step-ui-checks: ${checks} of ${EXPECTED}`);
console.log(`step-ui-checks: ${checks} checks pass`);
