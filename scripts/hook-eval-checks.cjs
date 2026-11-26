// Hook eval (founder 2026-11-26): every library hook made with a built-in character from now on is scored after it is
// delivered (its own cron, never the generation's wait), its maker can rate it, and passing + thumbs up makes the
// founder's shortlist. No new generation is ever made by the eval. Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 33;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const eq = (a, b, m) => { checks++; assert.equal(JSON.stringify(a), JSON.stringify(b), m); };

const rules = load('src/lib/hook-eval.ts');
const good = { face: 9, motion: 8, clean: 9, noText: 10 };

finish('hook-eval-checks', EXPECTED, () => checks, async () => {
  // Scores and passing.
  eq(rules.readScores({ ...good, notes: 'x' }), good, 'scores read');
  eq(rules.readScores({ face: 12.4, motion: -3, clean: 7.6, noText: 10 }), { face: 10, motion: 0, clean: 8, noText: 10 }, 'clamped to whole 0..10');
  eq(rules.readScores({ face: 9, motion: 8, clean: 9 }), null, 'a missing score: unreadable');
  eq(rules.readScores({ ...good, face: '9' }), null, 'a score that is not a number: unreadable');
  ok(rules.passes(good), 'every score 7 or more: pass');
  ok(!rules.passes({ ...good, face: 6 }), 'one score under 7: fail (a wrong face is never cached)');
  ok(rules.shortlisted({ eval: { scores: good, pass: true }, rating: 1 }), 'passed + thumbs up: shortlisted');
  ok(!rules.shortlisted({ eval: { scores: good, pass: true }, rating: null }) && !rules.shortlisted({ eval: { scores: good, pass: true }, rating: -1 }), 'no thumbs up: not shortlisted');
  ok(!rules.shortlisted({ eval: { scores: { ...good, face: 3 }, pass: false }, rating: 1 }) && !rules.shortlisted({ eval: { failed: 'x' }, rating: 1 }), 'failed eval: not shortlisted even with a thumbs up');

  // The eval itself, against stubs: one judge call, no generation.
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'evalchk-'));
  const clip = path.join(tmp, 'c.mp4'); fs.writeFileSync(clip, 'made');
  const orig = path.join(tmp, 'o.mp4'); fs.writeFileSync(orig, 'orig');
  let updates = [];
  const rows = [{ id: 'g1', user_id: 'u', input: { hook: { face: { kind: 'character', id: 'olivia' } }, sourceRefId: 'r' }, reference: { id: 'r' }, result: { src: '/api/media/11111111-2222-3333-4444-555555555555.mp4' } }];
  const query = { select() { return query; }, eq() { return query; }, is() { return query; }, gte() { return query; }, not() { return query; }, order() { return query; }, limit: async () => ({ data: rows, error: null }), update(p) { const u = { patch: p, filters: [] }; updates.push(u); const q2 = { eq(...f) { u.filters.push(f); return q2; }, is(...f) { u.filters.push(f); return Promise.resolve({ error: null }); } }; return q2; } };
  const ev = load('src/lib/server/hook-eval.ts', {
    '@/lib/supabase/server': { createSupabaseAdminClient: () => ({ from: () => query }) },
    '@/lib/server/gemini': { geminiJSON: async () => { throw new Error('the real model is never called in checks'); } },
    '@/lib/server/hookgen': { hookVideo: async () => orig, characterOf: async () => ({ image: { data: 'aGk=', mime: 'image/jpeg' }, words: '' }) },
    '@/lib/server/store': { mediaToFile: async (id) => (id.endsWith('.mp4') ? { file: clip, mime: 'video/mp4' } : null) },
    '@/lib/hook-eval': rules,
    'node:fs/promises': require('node:fs/promises'), 'node:os': require('node:os'), 'node:path': require('node:path'),
  }, {}, {});
  let parts = null;
  const judge = async (p) => { parts = p; return { ...good, notes: 'fine' }; };
  const r = await ev.evalGeneration(rows[0], judge);
  ok(r.pass === true && r.scores.face === 9 && r.notes === 'fine', 'a good clip passes with its scores');
  eq(parts.map((x) => (x.text ? 'text' : x.inline_data.mime_type)), ['text', 'video/mp4', 'video/mp4', 'image/jpeg'], 'the judge sees the made clip, the original hook and the character photo');
  ok(Buffer.from(parts[1].inline_data.data, 'base64').toString() === 'made' && Buffer.from(parts[2].inline_data.data, 'base64').toString() === 'orig', 'made clip first, original second');
  ok((await ev.evalGeneration(rows[0], async () => ({ ...good, face: 4, notes: 'face drifts' }))).pass === false, 'a wrong face fails');
  ok('failed' in (await ev.evalGeneration(rows[0], async () => ({ notes: 'x' }))), 'an unreadable answer is saved as failed, not passed');
  ok('failed' in (await ev.evalGeneration(rows[0], async () => { throw new Error('Gemini 500'); })), 'a judge error is saved as failed, never thrown (the cron does not loop)');
  ok('failed' in (await ev.evalGeneration({ ...rows[0], result: { src: '/api/media/x.mov' } }, judge)), 'no made clip: failed');
  updates = [];
  eq(await ev.evalDue(2, judge), 1, 'the cron scores what is due');
  ok(updates.length === 1 && updates[0].patch.eval.pass === true && JSON.stringify(updates[0].filters).includes('"eval",null'), 'saved only if still unscored');
  const src = fs.readFileSync('src/lib/server/hook-eval.ts', 'utf8');
  ok(!/startHook|falSubmit|fal\.run|kling/i.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')), 'the eval never starts a generation (founder: "don\'t run a single generation")');
  ok(/\.gte\("created_at", EVAL_SINCE\)/.test(src) && /"input->hook->face->>kind", "character"/.test(src), 'only new clips (from now on), only built-in characters');
  ok(/\.not\("task_id", "like", "cache\/%"\)/.test(src), 'cache-served copies are not scored again');
  ok(await ev.rateHook('u', 'run', '/api/media/x.mp4', 1) === false && await ev.rateHook('u', 'run', '/api/media/11111111-2222-3333-4444-555555555555.mp4', 5) === false, 'a bad clip path or rating is refused');

  // Wiring.
  const crons = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons;
  eq(crons.find((c) => c.path === '/api/internal/hook-eval')?.schedule, '*/5 * * * *', 'its own cron every 5 minutes');
  eq(crons.find((c) => c.path === '/api/internal/generations')?.schedule, '* * * * *', 'the generation cron is unchanged');
  ok(/"\/api\/internal\/hook-eval"/.test(fs.readFileSync('src/lib/supabase/session.ts', 'utf8')) && /CRON_SECRET/.test(fs.readFileSync('src/app/api/internal/hook-eval/route.ts', 'utf8')), 'the cron passes the proxy and checks its secret');
  const gen = fs.readFileSync('src/lib/server/generation-jobs.ts', 'utf8');
  ok(!/hook-eval/.test(gen), 'generation itself never waits for the eval (founder: never slower)');
  ok(/APPROVED_HOOK_CLIPS/.test(gen), 'the cache still serves only founder-confirmed clips');
  const mig = fs.readFileSync('supabase/migrations/0023_hook_review.sql', 'utf8');
  ok(/add column if not exists eval jsonb/.test(mig) && /rating smallint check \(rating in \(-1, 1\)\)/.test(mig), 'migration 0023 adds eval and rating');
  const view = fs.readFileSync('src/components/run-view.tsx', 'utf8');
  ok(/<HookRating key=\{hook\.generated\.src\} runId=\{run\.id\} src=\{hook\.generated\.src\} \/>/.test(view) && /button\(1, "Good hook", ThumbsUp\)/.test(view) && /button\(-1, "Bad hook", ThumbsDown\)/.test(view), 'every account sees thumbs up and down on its generated hook');
  ok(/onSubmit=\{\(e\) => \{[\s\S]{0,80}generate\(fix\)/.test(view) && /Regenerate/.test(view), 'Regenerate still goes to a new generation');
  const shortlist = fs.readFileSync('scripts/hook-shortlist.mjs', 'utf8');
  ok(/rating=eq\.1&eval->>pass=eq\.true&id=not\.in\./.test(shortlist) && /offset \+= 500/.test(shortlist) && !/method: "(POST|PATCH|DELETE)"/.test(shortlist), 'the shortlist: passed + thumbs up + not cached, filtered in the query and paged (nothing cut off), read-only');
  ok(/hook-rating\?src=/.test(view) && /disabled=\{saving\}/.test(view) && /if \(saving\) return;/.test(view), 'the thumbs show the saved vote after a reload, one write at a time');
  ok(/rateHook\(who, id, body\.src, body\.rating\)/.test(fs.readFileSync('src/app/api/runs/[id]/hook-rating/route.ts', 'utf8')), 'ratings are saved for the signed-in maker only');
});
