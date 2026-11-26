// Landing hero (founder 2026-11-26, before paid ads): the selling point (a viral script rewritten for your app) shown
// with real lines from the first hero pair, trial-first buttons, small avatars (no heavy images), no em/en dashes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const s = fs.readFileSync('src/components/landing.tsx', 'utf8');

ok(/Mavya rewrites its script for your app/.test(s), 'subtitle says the script is rewritten for your app');
ok(/For your app<\/span>/.test(s) && /my app finally got 100 visitors/.test(s) && /My sister is actually nuts/.test(s), 'script card: the viral line and the line for your app');
ok((s.match(/>\s*Start free trial\s*</g) || []).length === 2 && !/>\s*Sign up\s*</.test(s), 'hero and last call say Start free trial');
ok(/>\s*See pricing\s*</.test(s) && !/>\s*Billing\s*</.test(s), 'secondary button says See pricing');
ok(/3-day free trial\. 70 AI faces\. Cancel anytime\./.test(s), 'trial note under the buttons');
const faces = (s.match(/const FACES = \[([^\]]+)\]/) || [])[1].split(',').map((f) => f.trim().replace(/"/g, ''));
ok(faces.length === 5 && faces.every((f) => fs.statSync(`public/landing/faces/${f}.webp`).size < 8000), 'five avatar files exist, each under 8 KB');
ok(/flex shrink-0 -space-x-2/.test(s), 'avatars never shrink under the note on a phone');
ok(!/[–—]/.test(s), 'no em or en dashes');

const EXPECTED = 8;
assert.equal(checks, EXPECTED, `landing-cta-checks: ${checks} of ${EXPECTED}`);
console.log(`landing-cta-checks: ${checks} checks pass`);
