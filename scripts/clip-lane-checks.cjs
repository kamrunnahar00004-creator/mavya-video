// A clip's text lane (founder 2026-11-23): a text that only grazes the clip's edge is not listed (it showed as a
// squashed sliver hanging past the lane); real overlaps and short texts inside the clip still are. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('./check-module.cjs');
const { clipTexts, MIN_OVERLAP } = load('src/lib/clip-lane.ts');
let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const ids = (xs) => xs.map((x) => x.id).join(',');
// Clip on the timeline from 0.2 s, 14 s long (ends at 14.2).
const texts = [
  { id: 'graze-end', start: 14.05, end: 30 },    // crosses the end by 0.15 s: the next clip's
  { id: 'graze-start', start: 0, end: 0.35 },    // crosses the start by 0.15 s: the previous clip's
  { id: 'real', start: 8.382, end: 14.213 },     // most of it in this clip
  { id: 'short-inside', start: 5, end: 5.15 },   // a deliberately short text inside the clip
  { id: 'outside', start: 20, end: 25 },
  { id: 'whole', start: 0, end: 60 },
];
const lane = clipTexts(texts, 0.2, 14);
ok(ids(lane) === 'real,short-inside,whole', `listed: ${ids(lane)}`);
ok(lane.every((x) => x.start >= 0 && x.end <= 14 && x.end > x.start), 'every bar sits inside the lane, in clip time');
const real = lane.find((x) => x.id === 'real');
ok(Math.abs(real.start - 8.182) < 1e-9 && real.end === 14, 'clip time: shifted by the clip start, cut at its end');
ok(MIN_OVERLAP === 0.25, 'a quarter of a second is the line');
ok(ids(clipTexts([{ id: 'edge', start: 13.95, end: 20 }], 0, 14.2)) === 'edge', 'a text covering 0.25 s of the clip is listed');
const src = fs.readFileSync('src/components/editor-tools.tsx', 'utf8');
ok(src.includes('const local = clipTexts(texts, offset, len);') && src.includes('className="relative h-6 overflow-hidden rounded-md bg-raised/70"'), 'the clip editor uses it, and a bar never hangs past its lane');
if (n !== 6) { console.error(`clip-lane-checks: ${n} checks ran, expected 6`); process.exit(1); }
console.log(`clip-lane-checks: ${n} checks pass`);
