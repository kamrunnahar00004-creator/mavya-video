// A user's own uploaded reel gets the library breakdown (founder 2026-11-28): Gemini Flash writes its recipe in the
// background (plan/trial/admin only, 10 a day), so "Get viral script" copies THEIR reel and each shot gets a "Like
// this" moment played from their own file. Offline: Gemini, storage and the ledger are fakes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const eq = (a, b, m) => { checks++; assert.equal(JSON.stringify(a), JSON.stringify(b), m); };

const store = { access: {}, downloads: 0 };
const ur = load('src/lib/server/user-recipe.ts', {
  '@/lib/server/gemini': { geminiJSON: async () => { throw new Error('unused'); } },
  '@/lib/server/store': { mediaAccess: async (id) => (store.access[id] ?? null), mediaToFile: async () => { store.downloads++; return null; }, updateReference: async () => null },
  '@/lib/server/usage': { allowance: async () => ({ plan: null, admin: false, limit: 0 }) },
  '@/lib/supabase/server': { createSupabaseAdminClient: () => null },
  'node:fs/promises': require('node:fs/promises'), 'node:os': require('node:os'), 'node:path': require('node:path'),
}, { GEMINI_API_KEY: 'k' }, { Date, JSON, Math, Uint8Array, fetch: async () => { throw new Error('no network in tests'); } });
const adjust = load('src/lib/adjust.ts');
const edit = load('src/lib/edit.ts', { '@/lib/adjust': adjust });

const MEDIA = '0f8b2c1e-1111-4222-8333-944455556666.mp4';
const ref = { id: 'r1', owner: 'user', mediaId: MEDIA, title: 'my reel', caption: '' };
const answer = { hook: { end: 2.5 }, onScreenText: [], sound: '', whyItWorks: '', hookPrompt: '', demo: { method: 'mixed', product: '', duration: 9, pacing: '', spoken: '', resultReveal: '', shots: [
  { start: 6, end: 8, label: 'Second', hint: 'h', steps: [], camera: 'c', text: '', seconds: 2 },
  { start: 1, end: 4, label: 'First', hint: 'h', steps: [], camera: 'c', text: '', seconds: 3 },
  { start: 0.5, end: 2, label: 'Inside hook', hint: 'h', steps: [], camera: 'c', text: '', seconds: 1.5 },
] } };

finish('user-recipe-checks', 30, () => checks, async () => {
  // Answer checks.
  ok(ur.tidy({ ...answer, demo: { ...answer.demo, shots: [null, ...answer.demo.shots] } }).demo.shots.length === 2, 'an empty shot in the answer is skipped, not fatal');
  ok(ur.usable(answer) && !ur.usable({ hook: { end: 0 }, demo: { shots: answer.demo.shots } }) && !ur.usable({ hook: { end: 2 }, demo: { shots: [] } }) && !ur.usable(null), 'only an answer with a hook end and real shots is kept');
  const t = ur.tidy(answer);
  eq(t.demo.shots.map((s) => [s.label, s.start, s.end, s.seconds]), [['First', 2.6, 4, 1.4], ['Second', 6, 8, 2]], 'shots in order, never inside the hook (library rule), hook-only shots dropped, trimmed length recounted');

  // The breakdown, with every outside part faked.
  const saved = [];
  const base = (over = {}) => ({
    may: async () => true, reserveSlot: async () => true,
    read: async () => ({ bytes: Buffer.alloc(1000), mime: 'video/mp4' }),
    ask: async (parts) => { base.parts = parts; return answer; },
    save: async (id, r) => { saved.push([id, r]); },
    ...over,
  });
  eq(await ur.analyzeUpload(ref, 'u1', base()), 'done', 'a user\'s upload gets its breakdown');
  ok(saved[0][0] === 'r1' && saved[0][1].model === 'gemini-flash-latest' && saved[0][1].demo.shots.length === 2 && typeof saved[0][1].at === 'string', 'saved on their reel: tidied shots, the model and the time');
  ok(base.parts[0].inline_data.mime_type === 'video/mp4' && /Break down this HOOK \+ DEMO/.test(base.parts[1].text), 'a small video goes inline with the library prompt');
  eq(await ur.analyzeUpload({ ...ref, owner: 'curated' }, 'u1', base()), 'has', 'library reels are never redone here (the curation pipeline owns them)');
  eq(await ur.analyzeUpload({ ...ref, recipe: { demo: { shots: [{ label: 'x' }] } } }, 'u1', base()), 'has', 'a reel that already has a breakdown is not paid for twice');
  eq(await ur.analyzeUpload(ref, 'u1', base({ may: async () => false })), 'plan', 'no plan, trial or admin: no Gemini spend');
  eq(await ur.analyzeUpload(ref, 'u1', base({ reserveSlot: async () => false })), 'cap', 'over the daily cap: skipped');
  let slots = 0;
  eq(await ur.analyzeUpload(ref, 'u1', base({ read: async () => null, reserveSlot: async () => { slots++; return true; } })), 'file', 'missing file: skipped');
  ok(slots === 0, 'a missing or unusable file never uses a daily slot');
  eq(await ur.analyzeUpload(ref, 'u1', base({ read: async () => ({ bytes: Buffer.alloc(10), mime: 'image/png' }) })), 'file', 'not a video: skipped');
  eq(await ur.analyzeUpload(ref, 'u1', base({ ask: async () => ({ nonsense: true }) })), 'failed', 'an unusable answer is never saved');
  eq(await ur.analyzeUpload(ref, 'u1', base({ save: async () => { throw new Error('db down'); } })), 'failed', 'a failure never throws (the upload already succeeded)');

  // A big video goes through Gemini's Files API, and the copy there is deleted afterwards.
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push([String(url), init.method || 'GET']);
    if (String(url).includes('/upload/v1beta/files')) return { ok: true, status: 200, headers: { get: () => 'https://upload.example/session' } };
    if (String(url) === 'https://upload.example/session') return { ok: true, status: 200, json: async () => ({ file: { uri: 'https://gem/files/abc', name: 'files/abc', state: 'ACTIVE' } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  let bigParts;
  eq(await ur.analyzeUpload(ref, 'u1', base({ fetcher, read: async () => ({ bytes: Buffer.alloc(19 * 1024 * 1024), mime: 'video/mp4' }), ask: async (p) => { bigParts = p; return answer; } })), 'done', 'a big video is analyzed too');
  ok(bigParts[0].file_data.file_uri === 'https://gem/files/abc' && calls.some(([u, m]) => u.endsWith('/v1beta/files/abc') && m === 'DELETE'), 'sent by Files API reference, then deleted from Gemini');

  // The daily cap ledger: numbered slots, each insert fails once taken, so parallel uploads cannot pass the cap.
  const taken = new Set();
  const ledger = { from: () => ({ insert: async (row) => { if (taken.has(row.id)) return { error: { code: '23505' } }; taken.add(row.id); return { error: null }; } }) };
  const now = new Date('2026-11-28T10:00:00Z');
  const results = await Promise.all(Array.from({ length: 14 }, () => ur.reserve('u1', now, ledger)));
  eq(results.filter(Boolean).length, ur.DAILY_CAP, `14 uploads at once: exactly ${ur.DAILY_CAP} analysed`);
  ok(taken.has('user-recipe:u1:2026-11-28:1') && taken.has(`user-recipe:u1:2026-11-28:${ur.DAILY_CAP}`) && taken.size === ur.DAILY_CAP, 'counted per person per day in billing_events');
  eq(await ur.reserve('u1', now, { from: () => ({ insert: async () => ({ error: { code: '500' } }) }) }), false, 'ledger down: nothing spent');

  // Size checked before downloading; a breakdown whose shots all sit in the hook is not saved.
  store.access[MEDIA] = { mime: 'video/mp4', size: 150 * 1024 * 1024 };
  eq(await ur.analyzeUpload(ref, 'u1', base({ read: undefined })), 'file', 'an oversized file is refused');
  ok(store.downloads === 0, '...without downloading it');
  eq(await ur.analyzeUpload(ref, 'u1', base({ ask: async () => ({ ...answer, demo: { ...answer.demo, shots: [{ start: 0.5, end: 2, label: 'Hook only' }] } }) })), 'failed', 'no demo shots left after tidying: not saved');

  // "Like this" moments from the user's own file.
  const own = { owner: 'user', mediaId: MEDIA, sourceUrl: '', recipe: { demo: { shots: [{ start: 3, end: 5, label: 'Open it' }] } } };
  eq(edit.exampleShots(own), [{ code: '', media: MEDIA, start: 3, end: 5, label: 'Open it' }], 'their reel\'s moments play from their own file');
  eq(edit.exampleShots({ ...own, sourceUrl: 'https://www.instagram.com/reel/DfFmWbVhWv2/' })[0].media, MEDIA, 'their own reel plays from their file even when they pasted its link (the times describe their file)');
  eq(edit.exampleShots({ ...own, owner: 'curated', sourceUrl: 'https://www.instagram.com/reel/DfFmWbVhWv2/' })[0].code, 'DfFmWbVhWv2', 'library reels still use the library file');
  const tools = fs.readFileSync('src/components/editor-tools.tsx', 'utf8');
  ok(/src=\{`\$\{media \? `\/api\/media\/\$\{media\}` : `\/api\/examples\/\$\{code\}`\}#t=/.test(tools), 'the player picks their file or the library reel');
  const v = fs.readFileSync('src/lib/server/run-validation.ts', 'utf8');
  ok(/\/\^\[A-Za-z0-9_-\]\{5,40\}\$\/\.test\(x\.code\) \? x\.media === undefined : x\.code === "" && \/\^\[0-9a-f-\]\{36\}\\\.\(mp4\|mov\|webm\)\$\/\.test\(String\(x\.media\)\)/.test(v), 'saved examples: a library code, or a video media id with no code, never both');
  const route = fs.readFileSync('src/app/api/references/route.ts', 'utf8');
  ok(/if \(ref\.owner === "user"\) after\(\(\) => analyzeUpload\(ref, who\)\);/.test(route) && /export const maxDuration = 300;/.test(route), 'every user upload starts it after the answer, with time to finish');
  const script = fs.readFileSync('src/app/api/runs/[id]/script/route.ts', 'utf8');
  ok(/return media \? \{ code: "", media, start: shot\.start, end: shot\.end \}/.test(script) && /THE FOUNDER'S OWN HOOK leads \(its breakdown is not ready yet\)/.test(script), 'the script uses their reel\'s moments; before the breakdown is ready it says so honestly');
});
