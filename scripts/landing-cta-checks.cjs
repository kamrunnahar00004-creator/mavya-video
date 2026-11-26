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

const x = fs.readFileSync('src/components/hook-demo-explainer.tsx', 'utf8');
ok(/const WHY = \["fastest", "cheapest", "easiest"\]/.test(x) && /<RotatingWord words=\{WHY\} \/>/.test(x) && !/What’s a/.test(x), 'explainer heading: the fastest / cheapest / easiest way to go viral (founder 2026-11-26)');
ok(/<span className="sr-only">The fastest way to go viral<\/span>/.test(x) && /<span aria-hidden className="block sm:whitespace-nowrap">\s*The <RotatingWord/.test(x), 'one line from sm up; screen readers read one sentence, not the rotating words');
ok(/mq\.addEventListener\("change", follow\)/.test(x) && /if \(still\) return;\s*const id = setInterval\(\(\) => setI\(\(n\) => \(n \+ 1\) % words\.length\), 2500\)/.test(x) && /const shown = still \? 0 : i;/.test(x), 'changes every 2.5 s; still under reduced motion, followed live');
ok(/style=\{\{ width: widths\[shown\] \|\| undefined \}\}/.test(x) && /inline-grid overflow-hidden/.test(x) && !/delay-/.test(x.slice(x.indexOf('function RotatingWord'), x.indexOf('const MX_HOOKS'))), 'one move: words and width on the same curve, no staged delays; the slot clips, so no overlap');
ok(/>Hook \+ demo videos:<\/span> a scroll-stopping face/.test(x) && !/videos are the/.test(x), 'the line under the heading names the format');
ok(/<span className="flex items-center gap-x-4 sm:gap-x-8">\s*<span className=\{op\}>=<\/span>/.test(x), '"= 100" wraps as one piece on a phone');
ok(/<span className=\{op\}>×<\/span>\s*<Hand cards=\{MX_DEMOS\}/.test(x), '× travels with the demos');
const EXPECTED = 14;
assert.equal(checks, EXPECTED, `landing-cta-checks: ${checks} of ${EXPECTED}`);
console.log(`landing-cta-checks: ${checks} checks pass`);
