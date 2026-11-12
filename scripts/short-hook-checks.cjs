// Short hooks (founder 2026-11-08): Kling v3 refuses a reference with under 3 s of continuous motion (a frozen frame
// does not count). A short clip is slowed to 3.2 s of real motion, and the result is sped back to the original length.
// Checks the factor, the task id round trip, the wiring in hookgen, and a real ffmpeg round trip. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { load } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 30;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.equal(a, b, msg); };
const near = (a, b, tol, msg) => { checks++; assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); };

const h = load('src/lib/short-hook.ts');

// The factor.
eq(h.slowFactor(3), 1, 'a 3 s hook is sent as is');
eq(h.slowFactor(7.47), 1, 'a long hook is sent as is');
eq(h.slowFactor(0), 1, 'an unknown length is not slowed');
eq(h.slowFactor(NaN), 1, 'a bad length is not slowed');
ok(2.43 * h.slowFactor(2.43) >= 3.2, 'a 2.43 s hook is slowed to at least 3.2 s');
ok(1.4 * h.slowFactor(1.4) >= 3.2 && 1.4 * h.slowFactor(1.4) < 3.21, 'the shortest library hook (1.4 s) reaches 3.2 s, not much more');
ok(2.99 * h.slowFactor(2.99) >= 3.2, 'just under 3 s is slowed too (Kling counts motion, not padding)');

// The task id carries the factor; old ids still read.
const id = 'fal-ai/kling-video/v3/standard/motion-control|01a1ba0a-8fe9-7d42-9a10-fe17bfcef787';
eq(h.withSlow(id, 1), id, 'a normal hook keeps the plain task id');
const slowed = h.withSlow(id, 1.3169);
eq(JSON.stringify(h.parseTask(slowed)), JSON.stringify({ model: 'fal-ai/kling-video/v3/standard/motion-control', id: '01a1ba0a-8fe9-7d42-9a10-fe17bfcef787', factor: 1.3169 }), 'the slowdown comes back from the task id');
eq(h.parseTask(id).factor, 1, 'a task id from before has no slowdown');
eq(h.parseTask(`${id}|slowabc`).factor, 1, 'a malformed slowdown is ignored');
eq(h.parseTask(`${id}|slow50`).factor, 1, 'an absurd slowdown is ignored');

// The database must accept the slowed task id (founder 2026-11-12: a 2.53 s library hook "stuck": Kling made and charged
// for it, then mavya_generation_transition refused "<model>|<id>|slow<factor>" and the job hung). Checked against the
// rule in the newest migration that defines it, read from the file.
const migrations = fs.readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
const newest = migrations.filter((f) => /create or replace function public\.mavya_generation_transition/.test(fs.readFileSync(`supabase/migrations/${f}`, 'utf8'))).pop();
const rule = fs.readFileSync(`supabase/migrations/${newest}`, 'utf8').split('create or replace function public.mavya_generation_transition')[1];
const patterns = [...rule.slice(0, rule.indexOf('Invalid provider task')).matchAll(/p_value (~\*?) '([^']+)'/g)].map((m) => new RegExp(m[2], m[1] === '~*' ? 'i' : ''));
ok(patterns.length === 2, `the database's task id rule was found (${newest}: ${patterns.length} patterns)`);
const accepted = (v) => patterns.some((r) => r.test(v));
ok(accepted(id) && accepted('cache/3.03|cc4afb16-d2cc-446f-b9fa-ba09688dc4df'), 'plain and reused task ids pass the database rule');
for (const len of [2.53, 1.4, 2.99]) ok(accepted(h.withSlow(id, h.slowFactor(len))), `a slowed ${len} s hook's task id passes the database rule (${h.withSlow(id, h.slowFactor(len))})`);
ok(accepted(h.withSlow('fal-ai/kling-video/v2.6/standard/motion-control|01a1cf34-6b31-7a62-be12-061715922f09', h.slowFactor(2.53))), 'the fallback model too');
ok(!accepted(`${id}|slow1.2649`), 'the old format is what the database refused');
eq(JSON.stringify(h.parseTask(`${id}|slow1.2649`)), JSON.stringify({ model: 'fal-ai/kling-video/v3/standard/motion-control', id: '01a1ba0a-8fe9-7d42-9a10-fe17bfcef787', factor: 1.2649 }), 'an old-format id still reads');

// hookgen uses it.
const g = fs.readFileSync('src/lib/server/hookgen.ts', 'utf8');
ok(/const factor = slowFactor\(len\);/.test(g) && /factor > 1 \? referenceArgs\(factor\)/.test(g), 'the reference is slowed when the clip is short');
ok(/return withSlow\(await falSubmit\(simple \? MOTION_FALLBACK : MOTION, \{[\s\S]{0,400}\}\), reference\.factor\);/.test(g), 'the task id carries the slowdown (main and fallback model)');
ok(/const \{ model, id, factor \} = parseTask\(taskId\);/.test(g) && /const video = factor > 1 \? await restoreSpeed\(generated, factor\) : generated;/.test(g), 'the result is sped back before it is saved');
ok(/share\(reference\.bytes, "mp4", who\)/.test(g), 'the slowed reference is what Kling gets');

// A real round trip with ffmpeg: a 2.43 s moving clip.
const ff = require(path.join(process.cwd(), 'node_modules/ffmpeg-static'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'short-hook-'));
const run = (...a) => execFileSync(ff, ['-nostdin', '-v', 'error', '-y', ...a]);
const seconds = (f) => { try { execFileSync(ff, ['-hide_banner', '-i', f], { stdio: 'pipe' }); } catch (e) { const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(e.stderr)); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN; } return NaN; };
const hashes = (f) => execFileSync(ff, ['-v', 'error', '-i', f, '-f', 'framemd5', '-'], { encoding: 'utf8' }).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop().trim());
const clip = path.join(dir, 'hook.mp4');
run('-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30', '-t', '2.43', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip);
const factor = h.slowFactor(seconds(clip));
const ref = path.join(dir, 'reference.mp4');
run('-i', clip, '-an', ...h.referenceArgs(factor), '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ref);
const refLen = seconds(ref);
ok(refLen >= 3.15, `the reference is at least 3.15 s (${refLen})`);
const fr = hashes(ref);
let still = 0, longest = 0;
for (let i = 1; i < fr.length; i++) { still = fr[i] === fr[i - 1] ? still + 1 : 0; longest = Math.max(longest, still); }
ok(longest <= 2, `no frozen stretch: the picture changes at least every 3 frames (longest repeat ${longest})`);
ok(new Set(fr.slice(-30)).size > 15, 'the last second still moves (no frozen ending)');
const back = path.join(dir, 'back.mp4');
run('-i', ref, '-an', ...h.restoreArgs(factor), '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', back);
near(seconds(back), 2.43, 0.07, 'sped back, the clip has the original length');
const frames = hashes(back).length;
near(frames, Math.round(2.43 * 30), 3, 'and the original frame count at 30 fps');
eq(h.restoreArgs(factor).join(' '), `-vf setpts=PTS/${factor},fps=30`, 'the restore is the exact inverse of the slowdown');
fs.rmSync(dir, { recursive: true, force: true });

if (checks !== EXPECTED) { console.error(`short-hook-checks: ${checks} checks ran, expected ${EXPECTED}`); process.exit(1); }
console.log(`short-hook-checks: ${checks} checks pass`);
