// Provider/database/auth imports are explicit stubs. Unexpected dependencies fail before any network call.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, stubs = {}, env = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require(id) {
    if (id === 'server-only') return {};
    if (Object.hasOwn(stubs, id)) return stubs[id];
    throw new Error(`Unstubbed import: ${id}`);
  }, Buffer, Response, Request, URL, AbortSignal, process: { env }, console: { error() {} } }, { filename: file });
  return module.exports;
}
const client = load('src/lib/client.ts', { '@/lib/studio-data': { DEFAULT_FONT: 'TikTok Sans' } });
const adjust = load('src/lib/adjust.ts');
const edit = load('src/lib/edit.ts', { '@/lib/adjust': adjust });
const { generationPatch } = load('src/lib/generation-edit.ts', { '@/lib/client': client, '@/lib/adjust': adjust, '@/lib/edit': edit, '@/lib/studio-data': { DEFAULT_FONT: 'TikTok Sans' } });
const run = { id: 'run', sourceRefId: 'ref', updatedAt: 'now', hook: { mode: 'generate', source: 'library', face: { kind: 'ai', index: 1 }, text: '', generated: { src: '/old.mp4', seconds: 6, at: 'old' } }, demo: { clip: null, frame: 'none' }, texts: [{ id: 'hook', text: 'My edited text', start: 0, end: 6, x: 50, y: 22, size: 4.6, font: 'Arial', color: '#fff', style: 'outline' }] };
const generated = { src: '/new.mp4', seconds: 6, at: 'new' };
const patch = generationPatch(run, run, generated, 'Suggested');
assert.equal(patch.hook.generated.src, '/new.mp4');
assert.equal(patch.texts[0].text, 'My edited text');
assert.equal(patch.hook.versions.length, 1);
assert.equal(generationPatch({ ...run, ...patch }, run, generated, '').hook.versions.length, 1);
// The demo script lands during generation (same click): the clip still becomes the hook.
const scripted = { ...run, script: { refId: 'ref', hookText: 'Product line', hookAlternatives: [], hookBeats: [{ start: 0, end: 1, action: 'x' }], shots: [] } };
assert.equal(generationPatch(scripted, run, generated, 'Product line').hook.generated.src, '/new.mp4');
// The stolen caption is a placeholder and gives way to the product line; text the seller typed stays.
const stolenText = { ...run, texts: [{ ...run.texts[0], text: 'Stolen caption' }] };
assert.equal(generationPatch(stolenText, run, generated, 'Product line', ['Stolen caption']).texts[0].text, 'Product line');
assert.equal(generationPatch(run, run, generated, 'Product line', ['Stolen caption']).texts[0].text, 'My edited text');
const changed = { ...run, hook: { ...run.hook, source: 'describe' } };
assert.equal(generationPatch(changed, run, generated, '').hook.generated.src, '/old.mp4');
assert.equal(generationPatch(changed, run, generated, '').hook.versions[0].src, '/new.mp4');

async function main() {
  let calls = [], claimed = null, providerError = null, poll = { state: 'running' }, completeError = null;
  class HookStartUncertain extends Error {}
  const job = { id: 'job', user_id: 'owner', run_id: 'run', state: 'starting', input: run, reference: null, fallback_used: false, lease_token: 'lease', created_at: 'now', task_id: 'primary' };
  const db = { async rpc(name, args) {
    calls.push([name, args]);
    if (name === 'mavya_claim_generation') return { data: claimed, error: null };
    if (name === 'mavya_generation_transition') return { data: true, error: null };
    if (name === 'mavya_complete_generation') return { data: completeError ? null : generated, error: completeError };
    if (name === 'mavya_reserve_generation') return { data: null, error: new Error('DB unavailable') };
    throw new Error(name);
  } };
  const jobs = load('src/lib/server/generation-jobs.ts', {
    '@/lib/server/account-state': { accountClosing: async () => false },
    '@/lib/supabase/server': { createSupabaseAdminClient: () => db },
    '@/lib/server/usage': { adminUser: async () => false },
    '@/lib/server/store': { cloud: () => true, getRun: async () => run, mediaAccess: async () => null, registerMedia: async (...args) => calls.push(['register', args]) },
    '@/lib/server/r2': { putObject: async (...args) => calls.push(['put', args]) },
    '@/lib/server/hookgen': { HookStartUncertain, startHook: async (...args) => { calls.push(['start', args]); if (providerError) throw providerError; return 'task'; }, checkHook: async () => { calls.push(['poll']); return poll; } },
    '@/lib/generation-edit': { generationPatch },
  });
  await assert.rejects(jobs.reserveGeneration('owner', 'run', 'key'));
  assert.equal(calls.some(c => c[0] === 'start'), false);
  calls = []; await jobs.advanceGeneration('owner', 'job'); assert.equal(calls.length, 1);
  claimed = job; calls = []; await jobs.advanceGeneration('owner', 'job');
  assert.equal(calls.filter(c => c[0] === 'start').length, 1);
  assert.equal(calls.at(-1)[1].p_action, 'started');
  providerError = new Error('Refused'); calls = []; await jobs.advanceGeneration('owner', 'job');
  assert.equal(calls.at(-1)[1].p_action, 'fallback');
  claimed = { ...job, fallback_used: true }; calls = []; await jobs.advanceGeneration('owner', 'job');
  assert.equal(calls.at(-1)[1].p_action, 'failed');
  providerError = new HookStartUncertain(); calls = []; await jobs.advanceGeneration('owner', 'job');
  assert.equal(calls.at(-1)[1].p_action, 'uncertain');
  providerError = null; claimed = { ...job, state: 'running' }; calls = []; await jobs.advanceGeneration('owner', 'job');
  assert.equal(calls.at(-1)[1].p_action, 'release');
  poll = { state: 'done', video: Buffer.from('fixture'), seconds: 4.7 }; calls = []; await jobs.advanceGeneration('owner', 'job');
  assert.equal(calls.find(c => c[0] === 'put')[1][0], 'media/job.mp4');
  assert.equal(calls.at(-1)[0], 'mavya_complete_generation');
  completeError = new Error('DB unavailable'); calls = []; await jobs.advanceGeneration('owner', 'job');
  assert.equal(calls.at(-1)[1].p_action, 'release');
  assert.equal(calls.some(c => c[1]?.p_action === 'fallback' || c[1]?.p_action === 'failed'), false);

  // Reuse: a library hook + built-in character + same cut made before is served from a copy, with no provider call.
  const earlier = '40000000-0000-4000-8000-000000000001';
  const fresh = { id: 'run', sourceRefId: 'ref', updatedAt: 'now', hook: { mode: 'avatar', source: 'library', face: { kind: 'character', id: 'olivia' }, start: 0, end: 4, text: '' }, demo: { clip: null, frame: 'none' }, texts: [] };
  const reuseJob = { ...job, id: '40000000-0000-4000-8000-000000000002', input: fresh, note: null, created_at: '2020-01-01T00:00:00Z' };
  async function reuse({ input = fresh, note = null, curated = true, rows, file = true, fails = false } = {}) {
    const log = [], filters = [], states = [{ ...reuseJob, input, note }];
    const list = rows ?? [{ id: earlier, start: 0, end: 4, result: { src: `/api/media/${earlier}.mp4`, seconds: 4.2 } }];
    const chain = table => ({ select() { return this; }, eq(column, value) { filters.push([table, column, value]); return this; }, is(column, value) { filters.push([table, column, value]); return this; }, order() { return this; },
      async limit() { if (fails) throw new Error('DB unavailable'); return { data: list, error: null }; },
      async maybeSingle() { return table === 'library' ? { data: curated ? { id: 'ref' } : null, error: null } : { data: { result: list[0]?.result ?? null }, error: null }; } });
    const client = { from: chain, async rpc(name, args) {
      log.push([name, args]);
      if (name === 'mavya_claim_generation') return { data: states.shift() ?? null, error: null };
      if (name === 'mavya_generation_transition') { if (args.p_action === 'started') states.push({ ...reuseJob, input, note, state: 'running', task_id: args.p_value }); return { data: true, error: null }; }
      if (name === 'mavya_complete_generation') return { data: {}, error: null };
      throw new Error(name);
    } };
    const api = load('src/lib/server/generation-jobs.ts', {
      '@/lib/server/account-state': { accountClosing: async () => false },
      '@/lib/supabase/server': { createSupabaseAdminClient: () => client },
      '@/lib/server/usage': { adminUser: async () => false },
      '@/lib/server/store': { cloud: () => true, getRun: async () => input, mediaAccess: async () => null, registerMedia: async (...args) => log.push(['register', args]) },
      '@/lib/server/r2': { putObject: async (...args) => log.push(['put', args]), objectInfo: async () => (file ? { size: 9, mime: 'video/mp4', etag: 'etag' } : null), copyObject: async (...args) => log.push(['copy', args]) },
      '@/lib/server/hookgen': { HookStartUncertain, startHook: async () => { log.push(['start']); return 'model|task'; }, checkHook: async () => { log.push(['poll']); return { state: 'running' }; } },
      '@/lib/generation-edit': { generationPatch },
    });
    await api.advanceGeneration('owner', reuseJob.id);
    return { log, filters, did: name => log.some(c => c[0] === name) };
  }
  const hit = await reuse();
  assert.deepEqual(hit.log.find(c => c[0] === 'copy')[1], [`media/${earlier}.mp4`, `media/${reuseJob.id}.mp4`, 'etag']);
  assert.equal(hit.log.find(c => c[0] === 'register')[1][0], `${reuseJob.id}.mp4`, 'the new seller owns their own copy');
  assert.equal(hit.log.find(c => c[1]?.p_action === 'started')[1].p_value, `cache|${earlier}`);
  const done = hit.log.find(c => c[0] === 'mavya_complete_generation')[1];
  assert.equal(done.p_result.src, `/api/media/${reuseJob.id}.mp4`); assert.equal(done.p_result.seconds, 4.2);
  assert.equal(hit.did('start') || hit.did('poll') || hit.did('put'), false, 'no provider call and no upload');
  assert.ok(hit.filters.some(f => f[0] === 'library' && f[1] === 'owner' && f[2] === 'curated'), 'only library hooks');
  const real = async (label, options) => { const r = await reuse(options); assert.equal(r.did('start'), true, label); assert.equal(r.did('copy'), false, label); };
  await real('Regenerate with a hook in the video', { input: { ...fresh, hook: { ...fresh.hook, generated: { src: '/old.mp4', seconds: 4, at: 'old' } } } });
  await real('Regenerate with a note', { note: 'smile less' });
  await real('an uploaded hook is never shared', { curated: false });
  await real('a photo is never shared', { input: { ...fresh, hook: { ...fresh.hook, face: { kind: 'photo', mediaId: 'x.jpg' } } } });
  await real('a described character is never shared', { input: { ...fresh, hook: { ...fresh.hook, face: { kind: 'described', text: 'x' } } } });
  await real('a different cut of the hook', { rows: [{ id: earlier, start: 0, end: 7, result: { src: `/api/media/${earlier}.mp4`, seconds: 7 } }] });
  await real('nothing made yet', { rows: [] });
  await real('the earlier file is gone', { file: false });
  await real('a lookup failure falls back to generating', { fails: true });

  // A hook save made before the clip landed cannot erase it: the clip and its timing stay, the words are taken.
  const withClip = { ...fresh, updatedAt: 'now', hook: { ...fresh.hook, start: 0, end: 7.47, text: 'old', generated: { src: '/api/media/x.mp4', seconds: 7.47, at: 'a' }, versions: [] }, texts: [{ id: 'hook', text: 'old', start: 0, end: 7.47 }, { id: 'b', text: 'demo', start: 8, end: 9 }] };
  let patched = null;
  const runRoute = load('src/app/api/runs/[id]/route.ts', {
    '@/lib/server/store': { deleteRun: async () => {}, getRun: async () => withClip, updateRun: async (id, p) => { patched = p; return { ...withClip, ...p }; } },
    '@/lib/server/run-validation': { validRunPatch: () => true },
    '@/lib/server/who': { currentUser: async () => 'owner', signInFirst: () => new Response(null, { status: 401 }) },
    '@/lib/render-limits': { renderLimitError: () => null },
    '@/lib/edit': { timeline: () => [], videoLength: () => 0 },
  });
  const put = body => runRoute.PATCH(new Request('https://fixture.invalid/api', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'run' }) });
  assert.equal((await put({ hook: { ...fresh.hook, end: 3, text: 'new line' }, texts: [{ id: 'hook', text: 'new line', start: 0, end: 3 }] })).status, 200);
  assert.equal(patched.hook.generated.src, '/api/media/x.mp4'); assert.equal(patched.hook.end, 7.47); assert.equal(patched.hook.text, 'new line');
  assert.deepEqual(patched.texts.map(t => [t.id, t.text, t.end]), [['hook', 'new line', 7.47], ['b', 'demo', 9]]);
  // A save that carries a clip is normal: another hook picked from My files still replaces it.
  await put({ hook: { ...fresh.hook, generated: { src: '/api/media/y.mp4', seconds: 5, at: 'b' }, end: 5, text: 't' } });
  assert.equal(patched.hook.generated.src, '/api/media/y.mp4'); assert.equal(patched.hook.end, 5);

  let scheduled = 0, reserved = 0;
  const route = load('src/app/api/runs/[id]/generate/route.ts', {
    '@/lib/server/temp-cleanup': { expireTemporaryObjects: async () => 0 },
    'next/server': { after: () => scheduled++ },
    '@/lib/server/generation-jobs': { advanceGeneration() {}, generationJob: async () => null, generationReply: async j => ({ job: j.id }), reserveGeneration: async () => { reserved++; throw new Error('DB unavailable'); } },
    '@/lib/server/store': { cloud: () => true, getRun: async () => run },
    '@/lib/server/who': { currentUser: async () => 'owner', signInFirst: () => new Response(null, { status: 401 }) },
  });
  const ctx = { params: Promise.resolve({ id: 'run' }) };
  assert.equal((await route.GET(new Request('https://fixture.invalid/api?task=leaked&gen=foreign&fallback=1'), ctx)).status, 400);
  assert.equal((await route.GET(new Request('https://fixture.invalid/api?job=30000000-0000-4000-8000-000000000001'), ctx)).status, 404);
  assert.equal((await route.POST(new Request('https://fixture.invalid/api', { method: 'POST', body: JSON.stringify({ key: '30000000-0000-4000-8000-000000000001' }) }), ctx)).status, 503);
  assert.equal(reserved, 1); assert.equal(scheduled, 0);

  let queries = 0, recovered = 0;
  const filters=[];
  const chain = { select() { return this; }, neq() { return this; }, in() { return this; }, or(value) { filters.push(value); return this; }, order() { return this; }, async limit() { return { data: [{ id: 'job', user_id: 'owner' }], error: null }; } };
  const secret = 'fixture-only-cron-secret-32-characters';
  const cron = load('src/app/api/internal/generations/route.ts', {
    'node:crypto': require('node:crypto'),
    '@/lib/supabase/server': { createSupabaseAdminClient: () => ({ from(table) { queries++; return table === 'account_deletions' || table === 'export_jobs' ? {...chain, async limit(){return {data:[],error:null};}} : chain; } }) },
    '@/lib/server/account-deletion': { advanceDeletion: async () => {throw Error('unexpected deletion');} },
    '@/lib/server/uploads': { expireUploads: async () => 0 },
    '@/lib/server/export-jobs': { advanceExport: async () => { throw Error('unexpected export'); } },
    '@/lib/server/temp-cleanup': { expireTemporaryObjects: async () => 0 },
    '@/lib/server/generation-jobs': { advanceGeneration: async (who, id) => { assert.equal(who, 'owner'); assert.equal(id, 'job'); recovered++; } },
  }, { CRON_SECRET: secret });
  assert.equal((await cron.GET(new Request('https://fixture.invalid/cron'))).status, 401);
  assert.equal(queries, 0);
  assert.equal((await cron.GET(new Request('https://fixture.invalid/cron', { headers: { authorization: `Bearer ${secret}` } }))).status, 200);
  assert.equal(recovered, 1);
  // The recovery order rotates each minute; the deletion query must still skip deletions waiting for cleanup_after.
  assert.match(fs.readFileSync(path.join(root, 'src/app/api/internal/generations/route.ts'), 'utf8'), /state.eq.cancel,cleanup_after.lte/, 'waiting deletion must not monopolize recovery');

  console.log('PASS: preserved edits/history, stale-input guard, no unreserved spend, server fallback/refund decisions, uncertain start, deterministic output, finalization retry, job-only API, authenticated recovery cron');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
