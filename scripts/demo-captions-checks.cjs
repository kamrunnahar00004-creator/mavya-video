// The copied reel's demo captions (founder 2026-11-23): uploading into one shot, clip by clip, puts that shot's
// caption on screen; the bulk Upload never does (it added another app's captions, "Helps to Build your resume...").
// Offline source checks of src/components/run-view.tsx.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync('src/components/run-view.tsx', 'utf8');
let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
ok(/const placeClip = \([^)]*withCaptions = false\) =>/.test(src), 'placing a clip adds no captions unless asked');
ok(/if \(withCaptions && now && !old && suggested\) \{/.test(src), 'the captions are added only when asked');
ok(/const fillClip = async \([^)]*\) => placeClip\(clipId, await clipFromFile\(file\), startClips, mode, true\);/.test(src), 'uploading into one shot (clip by clip) asks for them');
ok(/if \(i < slots\.length\) placeClip\(slots\[i\]\.id, c\);/.test(src), 'the bulk Upload fills shots without them');
ok(/onUpload=\{async \(cid, f\) => \{[\s\S]{0,120}await fillClip\(cid, f\);/.test(src) && /onFiles=\{async \(files, from, landed, signal\) => \{[\s\S]{0,120}await fillShots\(files, from, landed, signal\);/.test(src), 'the shot upload and the bulk Upload use those two paths');
if (n !== 5) { console.error(`demo-captions-checks: ${n} checks ran, expected 5`); process.exit(1); }
console.log(`demo-captions-checks: ${n} checks pass`);
