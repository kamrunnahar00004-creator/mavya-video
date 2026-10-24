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
  const chain = { select() { return this; }, neq() { return this; }, in() { return this; }, or() { return this; }, order() { return this; }, async limit() { return { data: [{ id: 'job', user_id: 'owner' }], error: null }; } };
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

  console.log('PASS: preserved edits/history, stale-input guard, no unreserved spend, server fallback/refund decisions, uncertain start, deterministic output, finalization retry, job-only API, authenticated recovery cron');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
