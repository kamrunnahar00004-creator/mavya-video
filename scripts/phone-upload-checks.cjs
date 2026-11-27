// Upload from phone (founder 2026-11-27): a QR code opens /phone/<token> on the phone; it picks several videos from its
// library at once; they land in the video's clips on the computer, in order. The token is signed, names one user and
// one video, and expires; the computer places clips with its own upload code. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const pl = load('src/lib/server/phone-link.ts', { '@/lib/supabase/server': {}, '@/lib/server/usage': {}, 'node:crypto': require('node:crypto') }, { SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40) });
const U = 'c4d71805-588e-4af9-acf0-d42b7eb80941', R = '039d0323-1b2a-4cc1-ace8-d4a649ca406e';
const now = Date.parse('2026-11-27T00:00:00Z');
const { token, expiresAt } = pl.makePhoneToken(U, R, now);
ok(JSON.stringify(pl.readPhoneToken(token, now + 1000)) === JSON.stringify({ user: U, run: R }) && expiresAt === now + 3600_000, 'a link names the user and the video, for an hour');
ok(pl.readPhoneToken(token, now + 3601_000) === null, 'expired after an hour');
const [body] = token.split('.');
const forged = Buffer.from(`${U}.${'0'.repeat(8)}-1b2a-4cc1-ace8-d4a649ca406e.${now + 3600_000}`).toString('base64url');
ok(pl.readPhoneToken(`${forged}.${token.split('.')[1]}`, now) === null && pl.readPhoneToken(`${body}.xxxx`, now) === null && pl.readPhoneToken('', now) === null, 'a changed or unsigned link is refused');

const api = fs.readFileSync('src/app/api/phone/[token]/route.ts', 'utf8');
ok(/readPhoneToken\(token\)/.test(api) && /mayUpload\(who\.user\)/.test(api) && /getRun\(who\.run, who\.user\)/.test(api), 'phone uploads: token, paid plan and the video checked on every call');
ok(/startUpload\(who\.user/.test(api) && /finishUpload\(who\.user/.test(api) && /ownMedia\(b\.mediaId, who\.user\)/.test(api) && /addToInbox\(who\.run/.test(api), 'same upload steps as the computer; only your own file goes in your video\'s inbox');
ok(/\/\^\\\/api\\\/phone\\\/\[\^\/\]\+\$\/\.test\(pathname\)/.test(fs.readFileSync('src/lib/supabase/session.ts', 'utf8')), 'the phone needs no sign-in for its upload route');
const link = fs.readFileSync('src/app/api/runs/[id]/phone-link/route.ts', 'utf8');
ok(/getRun\(id, who\)/.test(link) && /mayUpload\(who\)/.test(link), 'only the video\'s owner, on a plan, gets a QR link');
const inbox = fs.readFileSync('src/app/api/runs/[id]/phone-inbox/route.ts', 'utf8');
ok(/getRun\(id, who\)/.test(inbox) && /clearInbox\(id/.test(inbox), 'the inbox is read and cleared only by the video\'s owner');
ok(/k\.startsWith\(`phone:\$\{run\}:`\)/.test(fs.readFileSync('src/lib/server/phone-link.ts', 'utf8')), 'clearing touches only that video\'s notes');

const page = fs.readFileSync('src/app/phone/[token]/phone-upload.tsx', 'utf8');
ok(/accept="video\/\*" multiple/.test(page) && !/capture=/.test(page) && /Upload from phone/.test(page), 'phone: one button, several videos at once from the library (no filming step)');
ok(/for \(let i = 0; i < list\.length; i\+\+\)/.test(page) && /order \}\)/.test(page), 'uploads in the order picked');
const rv = fs.readFileSync('src/components/run-view.tsx', 'utf8');
ok(/placedPhone\.current\.has\(x\.key\)/.test(rv) && /if \(i < empty\.length\) placeClip\(empty\[i\]\.id, c\)/.test(rv) && /phone-inbox`, \{ method: "POST"/.test(rv), 'computer: fills the shots still to film, then new clips, each note once, then clears them');
ok(/setInterval\(async \(\) => \{/.test(rv) && /QR\.toString\(json\.url, \{ type: "svg"/.test(rv), 'QR code drawn on the page; checks for new videos every few seconds while open');
const ed = fs.readFileSync('src/components/editor-tools.tsx', 'utf8');
ok(/From your phone/.test(ed) && /From this computer/.test(ed) && /\{uploadOpen && uploadWays\}/.test(ed), 'Add your demo: Upload your demo opens From this computer and From your phone');

const pl2 = fs.readFileSync('src/lib/server/phone-link.ts', 'utf8');
ok(/like\("id", `phone:\$\{run\}:%:\$\{mediaId\}:%`\)/.test(pl2) && /\(count \?\? 0\) >= 60\) return "full"/.test(pl2) && /=== "full"\) return Response\.json\(\{ error: "Too many videos/.test(api), 'the same video once per video; at most 60 an hour (Codex)');
ok(/media\.mime\.startsWith\("video\/"\)/.test(api) && /step === "finish"[\s\S]{0,160}mime\.startsWith\("video\/"\)/.test(api), 'videos only, at finish and add (Codex)');
ok(/!inVideo\.has\(x\.mediaId\)/.test(rv) && /if \(!\(await waitRunSaves\(id\)\)\)/.test(rv) && /if \(!res\?\.ok\) keys\.forEach\(\(k\) => placedPhone\.current\.delete\(k\)\)/.test(rv), 'cleared only after the clips are saved; never placed twice, even after a reload (Codex)');
const EXPECTED = 17;
assert.equal(checks, EXPECTED, `phone-upload-checks: ${checks} of ${EXPECTED}`);
console.log(`phone-upload-checks: ${checks} checks pass`);
