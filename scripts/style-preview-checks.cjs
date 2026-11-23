// The text style picker's previews stay visible (founder 2026-11-23: a white outline color made every preview white
// on white). Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('./check-module.cjs');
const { previewSecond } = load('src/lib/text-styles.ts', { react: {} });
let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
ok(previewSecond('#ffffff') === '#111111' && previewSecond('#FFF') === '#111111' && previewSecond('#eeeeee') === '#111111', 'white or near-white turns dark');
ok(previewSecond('#ffe600') === '#111111', 'a very light yellow too');
ok(previewSecond('#000000') === '#000000' && previewSecond('#7b4cfa') === '#7b4cfa' && previewSecond('#e11d48') === '#e11d48', 'a visible color stays the text\'s own');
ok(previewSecond(undefined) === '#7b4cfa', 'none set: purple as before');
ok(previewSecond('rgba(0,0,0,0.5)') === 'rgba(0,0,0,0.5)', 'a non-hex color passes through');
const src = fs.readFileSync('src/components/text-controls.tsx', 'utf8');
ok(src.includes('p.look("#ffffff", previewSecond(t.second))'), 'the picker uses it');
if (n !== 6) { console.error(`style-preview-checks: ${n} checks ran, expected 6`); process.exit(1); }
console.log(`style-preview-checks: ${n} checks pass`);
