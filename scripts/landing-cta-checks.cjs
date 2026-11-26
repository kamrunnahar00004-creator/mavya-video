// Landing hero (founder 2026-11-26, before paid ads): the subtitle carries the selling point (a viral script rewritten
// for your app); the script card and avatars were removed (founder: cluttered, the video on the right shows it).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const s = fs.readFileSync('src/components/landing.tsx', 'utf8');

ok(/Mavya rewrites its script for your app/.test(s), 'subtitle says the script is rewritten for your app');
ok(!/For your app<\/span>/.test(s) && !/My sister is actually nuts/.test(s), 'no script card: the video on the right explains it');
ok((s.match(/>\s*Start free trial\s*</g) || []).length === 2 && !/>\s*Sign up\s*</.test(s), 'hero and last call say Start free trial');
ok(/>\s*See pricing\s*</.test(s) && !/>\s*Billing\s*</.test(s), 'secondary button says See pricing');
ok(/>3-day free trial\. Cancel anytime\.</.test(s) && !/AI faces/.test(s), 'trial note only, no AI-face count');
ok(!/FACES|landing\/faces/.test(s), 'no avatar row');
ok(!/[–—]/.test(s), 'no em or en dashes');

const EXPECTED = 7;
assert.equal(checks, EXPECTED, `landing-cta-checks: ${checks} of ${EXPECTED}`);
console.log(`landing-cta-checks: ${checks} checks pass`);
