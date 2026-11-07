// The 2026-11-06 speed fixes and the problems their reviews found: New video opens at once (create in the
// background, Try again on failure), hover prefetch (never hangs the editor, dropped on rename/delete, expires),
// the editor-projection create API, and the 2 s preview recheck with shared in-flight lookups. Offline.
const assert = require('node:assert/strict');
const path = require('node:path');
const { load } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

// Fake clock: setTimeout / AbortSignal.timeout run when `tick` passes their time.
function clock() {
  let now = 0;
  const timers = [];
  const setTimeout = (fn, ms) => { timers.push({ at: now + ms, fn }); return timers.length; };
  const tick = async (ms) => { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); now = t.at; t.fn(); await Promise.resolve(); } now = end; for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const AbortSignalFake = { timeout: (ms) => { const c = new AbortController(); setTimeout(() => c.abort(new Error('timeout')), ms); return c.signal; } };
  return { setTimeout, tick, AbortSignal: AbortSignalFake };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

(async () => {
  // 1. pending-runs: create, prefetch, expiry, drop.
  {
    const c = clock();
    const calls = [];
    let respond = {};
    const fetch = (url, init = {}) => {
      calls.push([init.method ?? 'GET', url]);
      const r = respond[url];
      if (r === 'hang') return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason)));
      return Promise.resolve(typeof r === 'function' ? r() : r ?? json({}, 500));
    };
    const pr = load('src/lib/pending-runs.ts', {}, {}, { fetch, setTimeout: c.setTimeout, AbortSignal: c.AbortSignal });
    const run = (id, title = 't') => ({ id, title });
    // Create succeeds: the page takes { run, source } without loading it again.
    respond['/api/runs?view=editor'] = json({ run: run('a'), source: null }, 201);
    const created = await pr.startCreate('a');
    ok(created.run?.id === 'a' && pr.peekLoad('a')?.kind === 'create', 'create: the page finds the result to use');
    // A create that fails: the page offers Try again with the same hook.
    respond['/api/runs?view=editor'] = json({ error: 'x' }, 503);
    const failed = await pr.startCreate('b', '33333333-3333-4333-8333-333333333333');
    ok(failed.error === true && failed.sourceRefId === '33333333-3333-4333-8333-333333333333', 'create failure keeps the hook for Try again');
    respond['/api/runs?view=editor'] = json({}, 402);
    ok((await pr.startCreate('c')).pricing === true, 'no plan: the page goes to pricing');
    // A prefetch that never answers stops after 4 s and is gone 10 s after the hover (Codex: it held the editor).
    respond['/api/runs/h?view=editor'] = 'hang';
    pr.prefetchRun('h');
    const hung = pr.peekLoad('h');
    let settled = 'waiting';
    hung.job.then((v) => { settled = v; });
    await c.tick(3900);
    ok(settled === 'waiting', 'a hung prefetch is still waiting before 4 s');
    await c.tick(100);
    ok(settled === null, 'a hung prefetch resolves to null after 4 s (the page then loads it normally)');
    await c.tick(6000);
    ok(pr.peekLoad('h') === undefined, 'a prefetch entry expires 10 s after the hover, answered or not');
    // Rename after a hover: the prefetched old title is dropped (Codex: the editor opened the old title).
    respond['/api/runs/r?view=editor'] = json({ run: run('r', 'old'), source: null });
    pr.prefetchRun('r');
    ok(pr.peekLoad('r')?.kind === 'prefetch', 'hover prefetches');
    pr.dropLoad('r');
    ok(pr.peekLoad('r') === undefined, 'rename / delete drops the prefetched data');
    // dropLoad never removes a create in flight; forgetLoad only removes the entry it was given.
    respond['/api/runs?view=editor'] = json({ run: run('k'), source: null }, 201);
    void pr.startCreate('k');
    pr.dropLoad('k');
    ok(pr.peekLoad('k')?.kind === 'create', 'dropLoad keeps a create');
    pr.forgetLoad('k', { kind: 'create', job: Promise.resolve(null) });
    ok(pr.peekLoad('k')?.kind === 'create', 'forgetLoad of another entry keeps this one');
    pr.forgetLoad('k', pr.peekLoad('k'));
    ok(pr.peekLoad('k') === undefined, 'forgetLoad removes its own entry');
    // A prefetch never replaces a create in flight.
    void pr.startCreate('m');
    pr.prefetchRun('m');
    ok(pr.peekLoad('m')?.kind === 'create', 'prefetch leaves a create alone');
  }

  // 2. POST /api/runs?view=editor answers the editor's own projection; a retry returns the stored run's hook;
  //    a missing hook is 404; plain POST is unchanged.
  {
    const stored = new Map();
    const refs = { '33333333-3333-4333-8333-333333333333': { id: '33333333-3333-4333-8333-333333333333', title: 'Hook one', analysis: null } };
    const route = load('src/app/api/runs/route.ts', {
      '@/lib/server/who': { currentUser: async () => 'u', signInFirst: () => json({}, 401) },
      '@/lib/server/store': {
        createRun: async (_who, id, source) => { if (!stored.has(id)) stored.set(id, { id, sourceRefId: source?.id ?? null, hook: {} }); return stored.get(id); },
        getReference: async (id) => refs[id] ?? null,
      },
      'next/server': { connection: async () => undefined },
      '@/lib/server/list-pages': { listPage: async () => ({ items: [], next: null }), pageResponse: () => json({}), listError: () => json({}, 500) },
    });
    const post = (url, body) => route.POST(new Request('http://x' + url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
    const id = '11111111-1111-4111-8111-111111111111';
    let res = await post('/api/runs?view=editor', { id, sourceRefId: '33333333-3333-4333-8333-333333333333' });
    let body = await res.json();
    ok(res.status === 201 && body.run.id === id && body.source?.id === '33333333-3333-4333-8333-333333333333', 'editor projection: { run, source }');
    res = await post('/api/runs?view=editor', { id });
    body = await res.json();
    ok(body.source?.id === '33333333-3333-4333-8333-333333333333', 'a retried id returns the stored run with its own hook');
    delete refs['33333333-3333-4333-8333-333333333333'];
    res = await post('/api/runs?view=editor', { id });
    ok(res.status === 404, 'the stored hook gone: 404');
    res = await post('/api/runs', { id: '22222222-2222-4222-8222-222222222222' });
    body = await res.json();
    ok(res.status === 201 && body.id === '22222222-2222-4222-8222-222222222222' && !('run' in body), 'plain POST still answers the run itself');
  }

  // 3. previews.ts: a missing copy is checked again after 2 s (was 20 s); checks at the same moment share one
  //    storage request (Codex).
  {
    let now = 0;
    let heads = 0;
    let exists = false;
    let release;
    const gate = () => new Promise((r) => { release = r; });
    let pending = null;
    const r2 = { objectInfo: async () => { heads++; if (pending) await pending; return exists ? { size: 1 } : null; } };
    const previews = load('src/lib/server/previews.ts', { '@/lib/server/r2': r2 }, {}, { Date: { now: () => now } });
    pending = gate();
    const both = Promise.all([previews.previewReady('a.mp4'), previews.previewReady('a.mp4'), previews.previewReady('a.mp4')]);
    release();
    await both;
    pending = null;
    ok(heads === 1, `three simultaneous checks share one storage request (${heads})`);
    await previews.previewReady('a.mp4');
    ok(heads === 1, 'a missing copy is not checked again within 2 s');
    exists = true;
    now += 2001;
    ok(await previews.previewReady('a.mp4'), 'after 2 s the finished copy is found');
    ok(heads === 2, 'one more request');
    now += 60_000;
    await previews.previewReady('a.mp4');
    ok(heads === 2, 'a found copy is remembered');
  }

  console.log(`speed-fix-checks: ${checks} checks pass`);
})().catch((e) => { console.error(e); process.exit(1); });
