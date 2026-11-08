// Character photos (founder 2026-11-08: Summer redone from a text description on a white wall). Checks the three copies
// of her photo are the new picture at the sizes the app uses, and that the hook cache never serves a clip made with
// her old photo (PHOTO_SINCE). Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { load } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 8;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const ff = require(path.join(process.cwd(), 'node_modules/ffmpeg-static'));
const size = (file) => { try { execFileSync(ff, ['-hide_banner', '-i', file], { stdio: 'pipe' }); } catch (e) { const m = String(e.stderr).match(/, (\d{3,4})x(\d{3,4})/); return m ? `${m[1]}x${m[2]}` : null; } return null; };

ok(size('public/characters/summer.jpg') === '768x1376', 'the photo sent to generation is 768x1376 like the others');
ok(fs.statSync('public/characters/summer.jpg').size > 250_000, 'and saved at full quality (it is what the hook is made from)');
ok(size('public/characters/thumbs/summer.jpg') === '300x538', 'thumbnail 300x538');
ok(size('public/characters/view/summer.webp') === '614x1100', 'view copy 614x1100');
const sha = (buf) => require('node:crypto').createHash('sha256').update(buf).digest('hex');
ok(sha(fs.readFileSync('public/characters/summer.jpg')) !== sha(execFileSync('git', ['show', '802e23b:public/characters/summer.jpg'], { maxBuffer: 1 << 26 })), 'the photo is not the 2026-11-07 one');

const chars = load('src/lib/characters.ts');
const since = Date.parse(chars.PHOTO_SINCE.summer);
ok(Number.isFinite(since) && since >= Date.parse('2026-11-08T06:00:00Z'), 'Summer has a photo-replaced time from 2026-11-08');
const jobs = fs.readFileSync('src/lib/server/generation-jobs.ts', 'utf8');
ok(/const since = PHOTO_SINCE\[hook\.face\.id\] \?\? "1970-01-01T00:00:00Z";/.test(jobs), 'the hook cache looks up the character\'s photo time');
ok(/\.eq\("input->hook->face->>id", hook\.face\.id\)\s*\n\s*\.gte\("created_at", since\)/.test(jobs), 'and reuses only clips made after it');

if (checks !== EXPECTED) { console.error(`character-photo-checks: ${checks} checks ran, expected ${EXPECTED}`); process.exit(1); }
console.log(`character-photo-checks: ${checks} checks pass`);
