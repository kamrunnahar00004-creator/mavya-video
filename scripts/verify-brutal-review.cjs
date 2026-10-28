const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('./check-module.cjs');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function covers() {
  const signed = [];
  const covers = load('src/lib/server/covers.ts', { '@/lib/server/r2': { signedGet: async key => { signed.push(key); return 'signed:' + key; } } });
  const ref = { id: id(1), owner: 'curated', smallCover: true, thumbUrl: '/api/media/' + id(5) + '.jpg' };
  assert.equal(covers.thumbMediaId(ref), id(5) + '.jpg');
  assert.equal(covers.thumbMediaId({ ...ref, thumbUrl: 'https://foreign.invalid' + ref.thumbUrl }), null);
  const links = await covers.coverLinks([ref, { ...ref, id: id(2), owner: 'user' }, { ...ref, id: id(3), smallCover: false }]);
  assert.equal(links.size, 1); assert.deepEqual(Array.from(signed), ['covers/' + id(5) + '.jpg.webp']);
  assert.ok(!fs.readFileSync('src/app/api/references/route.ts', 'utf8').includes('fillCovers'));
}

async function auth() {
  let user = { id: id(1) }, closing = false, checks = 0;
  const who = load('src/lib/server/who.ts', { '@/lib/supabase/server': { authEnabled: () => true, getSessionUser: async () => { checks++; return user; } }, '@/lib/server/account-state': { accountClosing: async () => closing } });
  assert.equal(await who.currentUser(), id(1));
  user = null; assert.equal(await who.currentUser(), null);
  user = { id: id(1) }; closing = true; assert.equal(await who.currentUser(), null);
  assert.equal(checks, 3);
  const usage = load('src/lib/server/usage.ts', { '@/lib/server/store': {}, '@/lib/supabase/server': { getSessionUser: async () => user } }, { ADMIN_USER_IDS: id(1) });
  assert.equal(await usage.adminUser(id(1)), true);
  user = { id: id(2), email: 'founder@invalid.test' }; assert.equal(await usage.adminUser(id(2)), false);
  user = null; assert.equal(await usage.adminUser(id(1)), false);
}

async function library() {
  let calls = 0, account = 'one';
  const cache = load('src/lib/library-cache.ts', { '@/lib/list-client': { fetchPage: async () => { calls++; return { items: [account], next: null }; } } });
  assert.deepEqual(Array.from((await cache.loadLibrary()).items), ['one']);
  account = 'two'; assert.deepEqual(Array.from((await cache.loadLibrary()).items), ['two']);
  assert.equal(calls, 2, 'no module data from the previous account or a stale upload');
  const refs = Array.from({ length: 2301 }, (_, n) => ({ id: id(n), owner: 'curated', createdAt: '2026-10-28T00:00:00Z', analysis: { segments: [{ role: 'hook', start: 0, end: 3, thumb: 'data:image/png;base64,AAAA' }] } }));
  const lists = load('src/lib/server/list-pages.ts', { '@/lib/server/store': { cloud: () => false, listReferences: async () => refs }, '@/lib/server/covers': {}, '@/lib/supabase/server': {} });
  let cursor = null, seen = [];
  do {
    const page = await lists.listPage('references', id(1), new Request('http://fixture?all=1&scope=curated' + (cursor ? '&cursor=' + cursor : '')));
    assert.ok(page.items.length <= 500);
    for (const item of page.items) {
      const u = new URL(item.analysis.segments[0].thumb, 'http://fixture');
      assert.ok(u.searchParams.get('ids').split(',').length <= 24, 'large lists still use valid thumbnail batches');
    }
    seen.push(...page.items.map(r => r.id)); cursor = page.next;
  } while (cursor);
  assert.equal(seen.length, 2301); assert.equal(new Set(seen).size, 2301);
}

async function creation() {
  let who = id(1), created = [], source = null;
  const route = load('src/app/api/runs/route.ts', {
    '@/lib/server/list-pages': {}, 'next/server': {},
    '@/lib/server/who': { currentUser: async () => who, signInFirst: () => new Response(null, { status: 401 }) },
    '@/lib/server/store': { getReference: async () => source, createRun: async (owner, key, ref) => { created.push({ owner, key, source: ref?.id }); return { id: key }; } }
  });
  const post = body => route.POST(new Request('http://fixture/api/runs', { method: 'POST', body: JSON.stringify(body) }));
  assert.equal((await post({ id: 'bad' })).status, 400);
  assert.equal((await post({ id: id(5), sourceRefId: id(2) })).status, 404); assert.equal(created.length, 0);
  source = { id: id(2) }; assert.equal((await post({ id: id(5), sourceRefId: id(2) })).status, 201);
  assert.equal(created[0].source, id(2)); who = null; assert.equal((await post({ id: id(5) })).status, 401);

  // Actual store duplicate insert semantics, including foreign-owner collision and source in initial row.
  const rows = new Map();
  const store = load('src/lib/server/store.ts', {
    'node:crypto': require('node:crypto'), 'node:fs/promises': {}, 'node:path': require('node:path'),
    '@/lib/server/r2': { r2Enabled: () => true },
    '@/lib/supabase/server': { authEnabled: () => true, createSupabaseAdminClient: () => ({ from: () => ({
      async upsert(row, options) { assert.equal(options.ignoreDuplicates, true); if (!rows.has(row.id)) rows.set(row.id, row); return { error: null }; },
      select() { return this; }, eq(key, value) { this[key] = value; return this; },
      async maybeSingle() { const row = rows.get(this.id); return { data: row?.user_id === this.user_id ? { data: row.data } : null, error: null }; }
    }) }) }
  });
  const ref = { id: id(2), title: 'Selected hook', analysis: { segments: [{ role: 'hook', start: 1, end: 4 }] } };
  const [a, b] = await Promise.all([store.createRun(id(1), id(5), ref), store.createRun(id(1), id(5), ref)]);
  assert.equal(a.id, b.id); assert.equal(rows.size, 1); assert.equal(a.sourceRefId, id(2)); assert.equal(a.hook.start, 1);
  await assert.rejects(store.createRun(id(9), id(5)), /identity conflict/); assert.equal(rows.size, 1);
}

async function deletion() {
  let phase = 'storage', cursor = 1; const deleted = [], patches = [];
  const route = load('src/lib/server/account-deletion.ts', {
    '@/lib/server/billing-state': { billingRpc: async () => ({ user_id: id(1), state: phase, media_ids: [id(5) + '.jpg'], extra_keys: [], cursor, cleanup_after: '2026-01-01', lease_token: 'fixture' }) },
    '@/lib/server/account-state': {}, '@/lib/server/stripe': {},
    '@/lib/server/r2': { deleteObjectStrict: async key => deleted.push(key) },
    '@/lib/supabase/server': { createSupabaseAdminClient: () => ({ from: () => ({ update(p) { patches.push(p); return this; }, eq() { return this; }, select: async () => ({ data: [{ user_id: id(1) }], error: null }) }), auth: { admin: { deleteUser: async () => ({ error: null }) } } }) }
  });
  await route.advanceDeletion(id(1)); assert.deepEqual(deleted, ['covers/' + id(5) + '.jpg.webp']);
  deleted.length = 0; phase = 'auth'; cursor = 1;
  await route.advanceDeletion(id(1)); assert.deepEqual(deleted, ['covers/' + id(5) + '.jpg.webp'], 'old auth-phase deletions also finish derivatives before auth removal');
}

(async () => { await covers(); await auth(); await library(); await creation(); await deletion(); console.log('PASS: curated-only grants, fresh authorization, account-safe catalog, 2301-row continuation, valid image batches, atomic retry creation and derivative deletion'); })().catch(error => { console.error(error); process.exitCode = 1; });
