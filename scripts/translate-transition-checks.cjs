// Tailwind v4 moves elements with the CSS `translate` property, not `transform` (founder 2026-11-26: the landing word
// swap and the pricing list jumped instead of sliding). Any element that transitions while using translate-* classes
// must list `translate` in its transition, never only `transform`. Source scan of src/.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p); } };
walk('src');
const bad = [];
for (const f of files) {
  for (const [n, line] of fs.readFileSync(f, 'utf8').split('\n').entries()) {
    if (/transition-\[[^\]]*transform[^\]]*\]/.test(line) && !/transition-\[[^\]]*translate/.test(line) && /\btranslate-[xy]-/.test(line)) bad.push(`${f}:${n + 1}`);
  }
}
ok(bad.length === 0, `translate-* classes animated with transition-[...transform] (they jump): ${bad.join(', ')}`);
const x = fs.readFileSync('src/components/hook-demo-explainer.tsx', 'utf8');
ok(/transition-\[opacity,translate\]/.test(x) && /-translate-y-\[115%\] opacity-100/.test(x), 'rotating word rolls: old word up and out, solid');
ok((fs.readFileSync('src/components/pricing-page.tsx', 'utf8').match(/transition-\[opacity,translate\]/g) || []).length === 2, 'pricing list and Mavya row slide');

const EXPECTED = 3;
assert.equal(checks, EXPECTED, `translate-transition-checks: ${checks} of ${EXPECTED}`);
console.log(`translate-transition-checks: ${checks} checks pass`);
