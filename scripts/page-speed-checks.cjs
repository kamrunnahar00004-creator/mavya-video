// Page speed (founder 2026-11-26, before paid ads): Lighthouse showed Meta's script and Clarity as the largest blocks
// on a phone, the first row of videos loading lazily, and landing files re-downloaded each visit. Source checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const read = (f) => fs.readFileSync(f, 'utf8');

const px = read('src/components/meta-pixel.tsx');
ok(/requestIdleCallback\(addScript, \{ timeout: 1500 \}\)/.test(px), 'Meta script loads when the page is idle, within 1.5 s');
ok(px.indexOf('fbq("init", id)') < px.indexOf('if (now ||') && /if \(added\) return;/.test(px), 'fbq is set up first, so events queue; the script is added once');
ok(/load\(id, Boolean\(signup \|\| conversion\)\)/.test(px) && /if \(!window\.fbq\) \{[\s\S]*?\}\n  if \(now \|\| /.test(px), 'a signup or purchase loads it at once, even with an idle load pending (Codex)');
ok(/<Script id="clarity-init" strategy="lazyOnload">/.test(read('src/app/layout.tsx')), 'Clarity loads after the page');

const list = read('src/components/runs-list.tsx');
ok((list.match(/<Cover run=\{r\} first=\{i < 6\} \/>/g) || []).length === 2, 'grid and list: first 6 pictures load right away');
ok(/loading=\{first \? "eager" : "lazy"\}/.test(list) && /eager=\{first\}/.test(list), 'cover image and hook still follow it');
ok(/loading=\{eager \? "eager" : "lazy"\} fetchPriority=\{eager \? "high" : undefined\}/.test(read('src/components/thumb-img.tsx')), 'ThumbImg: eager, high priority only when asked');

const cfg = read('next.config.ts');
ok(/"\/landing\/:path\*", "\/characters\/:path\*"/.test(cfg) && /public, max-age=86400, stale-while-revalidate=3600/.test(cfg), 'landing and character files cached a day');

const EXPECTED = 8;
assert.equal(checks, EXPECTED, `page-speed-checks: ${checks} of ${EXPECTED}`);
console.log(`page-speed-checks: ${checks} checks pass`);
