// The studio look (founder 2026-11-10: the violet + lilac greys "is the classic vibe coded color"; "make the button etc
// all square"; "change everything inside the app too"). Navy ink, one accent blue that passes WCAG AA, square corners
// everywhere except true circles and phone mockups. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 10;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

const css = fs.readFileSync('src/app/globals.css', 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const token = (name) => { const t = (root.match(new RegExp(`--${name}: (#[0-9a-f]{6});`)) || [])[1]; assert.ok(t, `token --${name}`); return t; };

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [lo, hi] = [lum(a), lum(b)].sort((x, y) => x - y); return (hi + 0.05) / (lo + 0.05); };

ok(token('accent') === '#1c74b4' && token('ink') === '#1c2633' && token('bg') === '#f7fafc', 'the founder-picked tokens');
ok(contrast(token('accent'), '#ffffff') >= 4.5 && contrast(token('accent'), token('bg')) >= 4.5, 'white on accent and accent on the ground pass AA');
ok(contrast(token('text'), token('bg')) >= 7 && contrast(token('muted'), token('bg')) >= 4.5, 'body and muted text pass');
// Timeline clips: white labels on the track colour, track-colour labels on its tint and hover tint.
ok(['text-track', 'sound-track'].every((t) => contrast(token(t), '#ffffff') >= 4.5 && contrast(token(t), token(`${t}-tint`)) >= 4.5)
  && contrast(token('sound-track'), token('sound-track-hover')) >= 4.5, 'timeline track labels pass AA');

const theme = css.match(/@theme \{([^}]*)\}/);
ok(theme && ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'].every((r) => new RegExp(`--radius-${r}: 0;`).test(theme[1])), 'every Tailwind radius is 0');
ok(/@utility btn-primary \{[^}]*border-radius: 0;/.test(css) && /@utility card \{\s*border-radius: 0;/.test(css), 'the primary button and cards are square');

const files = fs.readdirSync('src', { recursive: true }).filter((f) => /\.(tsx|ts|css)$/.test(f)).map((f) => path.join('src', f));
// The old violet, its lilac greys and the old track colours.
const violet = /#(7b4cfa|6d3ef0|5b2fd6|b69cff|15121f|14121f|1d1a2b|2e1065|f3f3f8|f7f7fb|ebeaf3|e3e2ec|cfcedb|4d4a5e|928fa6|6b6780|2a5bd7|e2ebfd|b02f86|f9e3f1|f3cfe6|221d33|dfdde9|d2d0df|a39eb5)\b|rgba\(123, ?76, ?250/i;
// Caption colours are the seller's content, not the app's chrome.
const leaks = files.filter((f) => f !== path.join('src', 'components', 'text-controls.tsx') && violet.test(fs.readFileSync(f, 'utf8')));
ok(leaks.length === 0, `no old violet palette left in the app: ${leaks.join(', ')}`);

// Every button or link whose class list has rounded-full, except the two on/off switches and the colour swatches.
const ROUND_OK = /^relative h-(5 w-9|6 w-11) rounded-full transition-colors|^h-7 w-7 rounded-full border \$\{value\.toLowerCase\(\) === c/;
const pill = [];
for (const f of files.filter((x) => x.endsWith('.tsx'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/<(button|Link|a)\b[^<]*?className=\{?[`"]([^`"]*)/g)) {
    if (/\brounded-full\b/.test(m[2]) && !ROUND_OK.test(m[2])) pill.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
  }
}
ok(pill.length === 0, `no pill-shaped buttons: ${pill.join(', ')}`);

// Pill shapes in any class string (helpers like chip() too): rounded-full with side padding. The landing page squares
// these with its own rule (.landing-theme), so only app files count.
const LANDING = ['landing.tsx', 'how-it-works.tsx', 'hook-demo-explainer.tsx'].map((f) => path.join('src', 'components', f));
const pills = [];
for (const f of files.filter((x) => x.endsWith('.tsx') && !LANDING.includes(x))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/[`"]([^`"\n]*\brounded-full\b[^`"\n]*)[`"]/g)) if (/\bpx-/.test(m[1])) pills.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
}
// The landing squares everything except elements marked keep-round; only phone geometry and window dots may carry it.
const keep = [];
for (const f of LANDING) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/className=\{?[`"]([^`"]*\bkeep-round\b[^`"]*)/g)) if (/\bpx-/.test(m[1])) keep.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
}
ok(keep.length === 0 && /\.landing-theme \*:not\(\.keep-round\) \{\s*border-radius: 0 !important;/.test(css), `keep-round covers only phone geometry, not its badges: ${keep.join(', ')}`);
ok(pills.length === 0, `no pill-shaped chips or badges: ${pills.join(', ')}`);

assert.equal(checks, EXPECTED, `palette-checks: ran ${checks} of ${EXPECTED}`);
console.log(`palette-checks: ${checks} passed`);
