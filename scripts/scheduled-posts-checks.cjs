// Scheduled posts (founder 2026-11-15): captions, spreading times, the owner-only gate, and posting to Instagram Reels
// and the Facebook Page against a simulated Meta, including a tick that dies mid-way never posting twice, the daily
// limit, Meta refusing, network blips, and slow processing. Offline.
const assert = require('node:assert/strict');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 114;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.equal(JSON.stringify(a), JSON.stringify(b), msg); };

const shared = load('src/lib/scheduled-posts.ts');
const OWNER = 'c4d71805-588e-4af9-acf0-d42b7eb80941';
let inserted = null;
const fakeDb = { from: () => ({ insert: (rows) => { inserted = rows; return { select: async () => ({ data: rows.map((r) => ({ ...r, state: 'scheduled', result: {}, error: null, created_at: r.at })), error: null }) }; } }) };
const owned = new Set(['mine.mp4']);
const stubs = {
  '@/lib/supabase/server': { createSupabaseAdminClient: () => fakeDb },
  '@/lib/server/r2': { signedGet: async (key) => `https://r2.example/${key}?sig` },
  '@/lib/server/my-files': { fileSources: async () => ({}) },
  '@/lib/server/store': { getFilePrefs: async () => ({ names: {}, hidden: [] }), mediaAccess: async (id) => (owned.has(id) ? { mime: 'video/mp4', size: 1 } : null) },
  '@/lib/scheduled-posts': shared,
  '@/lib/posts-access': null,
};
const env = { SCHEDULED_POSTS_USERS: ` ${OWNER} ` };
stubs['@/lib/posts-access'] = load('src/lib/posts-access.ts', {}, env);
const sp = load('src/lib/server/scheduled-posts.ts', stubs, env, { URLSearchParams });

/** A simulated Meta: answers by URL, counts every call that would post. */
function meta(opts = {}) {
  const m = { calls: [], creates: 0, publishes: 0, finishes: 0, uploads: 0, igStatus: opts.igStatus ?? ['IN_PROGRESS', 'FINISHED'], fbStatus: opts.fbStatus ?? [], quota: opts.quota ?? 0 };
  m.fetch = async (url, init = {}) => {
    m.calls.push(url);
    if (opts.down) throw new TypeError('fetch failed');
    const u = new URL(url), p = u.pathname, body = new URLSearchParams(init.body ?? '');
    const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
    if (opts.refuse && p.endsWith('/media') && init.method === 'POST') return json({ error: { message: 'The video file is too short.', code: 100 } }, 400);
    if (p.endsWith('/content_publishing_limit')) return json({ data: [{ quota_usage: m.quota, config: { quota_total: 100 } }] });
    if (p.endsWith('/IG/media') && init.method === 'POST') { m.creates++; m.lastCaption = body.get('caption'); m.lastVideoUrl = body.get('video_url'); m.reelType = body.get('media_type'); return json({ id: 'C1' }); }
    if (p.endsWith('/C1')) return json({ status_code: m.igStatus.length > 1 ? m.igStatus.shift() : m.igStatus[0] });
    if (p.endsWith('/IG/media_publish')) { m.publishes++; return json({ id: 'M1' }); }
    if (p.endsWith('/M1')) return json({ permalink: 'https://www.instagram.com/reel/M1/' });
    if (p.endsWith('/PAGE/video_reels')) {
      if (body.get('upload_phase') === 'start') return json({ video_id: 'V1' });
      if (body.get('upload_phase') === 'finish') { m.finishes++; m.fbCaption = body.get('description'); m.fbState = body.get('video_state'); return json({ success: true }); }
    }
    if (u.host === 'rupload.facebook.com') { m.uploads++; m.uploadHeaders = init.headers; return json({ success: true }); }
    if (p.endsWith('/V1')) return json({ status: m.fbStatus.length > 1 ? m.fbStatus.shift() : m.fbStatus[0] ?? {}, permalink_url: '/reel/V1' });
    return json({ error: { message: `unexpected ${p}` } }, 400);
  };
  return m;
}
const creds = { pageId: 'PAGE', pageToken: 'PAGETOKEN', igUserId: 'IG' };
const T0 = Date.parse('2026-11-16T09:00:00Z');
function ctxFor(m, now = T0, saves = []) { return { fetch: m.fetch, creds, now, link: async (id) => `https://r2.example/media/${id}?sig`, save: async (t, r) => { saves.push([t, r]); } }; }
const post = (over = {}) => ({ id: 'P1', mediaId: 'mine.mp4', title: 'x', hook: 'h', captions: { instagram: 'IG caption', facebook: 'FB caption' }, targets: ['instagram'], at: new Date(T0).toISOString(), state: 'posting', result: {}, error: null, createdAt: '', ...over });

finish('scheduled-posts-checks', EXPECTED, () => checks, async () => {
  // Captions and times.
  eq(shared.fillCaption(shared.DEFAULT_TEMPLATES.facebook, '  how did he get\n198 users? '), 'how did he get 198 users?\n\nCreate your own video 👉 mavya.app', 'the hook fills {hook}, on one line');
  eq(shared.fillCaption('{hook}\n\nlink in bio', ''), 'link in bio', 'no hook: its line goes, no blank first line');
  ok(shared.fillCaption('{hook}', 'x'.repeat(3000)).length === shared.CAPTION_MAX, 'a caption never exceeds Instagram\'s 2,200 characters');
  eq(shared.spreadTimes(7, 9 * 60, 21 * 60), [540, 660, 780, 900, 1020, 1140, 1260], '7 a day from 9:00 to 21:00: every 2 hours');
  eq(shared.spreadTimes(1, 600, 1200), [600], 'one post: at the first time');
  ok(shared.spreadTimes(10, 540, 1260).every((m) => m % 5 === 0 && m >= 540 && m <= 1260), 'times land on 5 minutes, inside the window');
  eq(shared.rollUp(['instagram', 'facebook'], { instagram: { state: 'done' }, facebook: { state: 'done' } }), 'posted', 'both done: posted');
  eq(shared.rollUp(['instagram', 'facebook'], { instagram: { state: 'failed' }, facebook: { state: 'working' } }), 'posting', 'one failed, one still going: still posting');
  eq(shared.rollUp(['instagram', 'facebook'], { instagram: { state: 'failed' }, facebook: { state: 'done' } }), 'failed', 'one failed, the other done: failed');
  const good = { at: new Date(T0 + 3600e3).toISOString(), targets: ['instagram', 'facebook'], captions: { instagram: 'a', facebook: 'b' } };
  eq(shared.badPost(good, T0), null, 'a good post passes');
  ok(shared.badPost({ ...good, targets: ['tiktok'] }, T0), 'unknown network refused');
  ok(shared.badPost({ ...good, targets: [] }, T0), 'no network refused');
  ok(shared.badPost({ ...good, at: new Date(T0 + 61 * 86400e3).toISOString() }, T0), 'more than 60 days ahead refused');
  ok(shared.badPost({ ...good, captions: { instagram: 'x'.repeat(2201), facebook: 'b' } }, T0), 'over-long caption refused');

  // Owner-only.
  ok(sp.schedulerAllowed(OWNER), 'the owner may use it');
  ok(!sp.schedulerAllowed('someone-else') && !sp.schedulerAllowed(null), 'nobody else may (or a signed-out visitor)');
  const off = load('src/lib/server/scheduled-posts.ts', { ...stubs, '@/lib/posts-access': load('src/lib/posts-access.ts', {}, { SCHEDULED_POSTS_USERS: '' }) }, { SCHEDULED_POSTS_USERS: '' }, { URLSearchParams });
  ok(!off.schedulerAllowed(OWNER), 'empty list: off for everyone');
  const route = load('src/lib/server/posts-route.ts', { '@/lib/server/who': { currentUser: async () => 'someone-else', signInFirst: () => new Response(null, { status: 401 }) }, '@/lib/server/scheduled-posts': sp });
  eq((await route.postsUser()).response?.status, 404, 'API: another signed-in user gets 404, as if it did not exist');
  const routeOwner = load('src/lib/server/posts-route.ts', { '@/lib/server/who': { currentUser: async () => OWNER, signInFirst: () => new Response(null, { status: 401 }) }, '@/lib/server/scheduled-posts': sp });
  eq((await routeOwner.postsUser()).who, OWNER, 'API: the owner gets through');
  eq(sp.metaCreds({ META_PAGE_ID: '1', META_PAGE_TOKEN: 't' }), null, 'missing Instagram id: posting not set up');

  // Sidebar: every other account sees exactly the old menu.
  const navStore = load('src/lib/posts-nav.ts', { react: { useSyncExternalStore: (_s, get) => get() } });
  const nav = load('src/components/nav-links.tsx', { 'react/jsx-runtime': { jsx: () => null, jsxs: () => null }, 'next/navigation': { usePathname: () => null }, 'lucide-react': new Proxy({}, { get: (_, k) => k }), '@/components/pending-link': {}, '@/lib/posts-nav': navStore });
  eq(navStore.usePostsNav(), false, 'menu flag starts off: nothing shows before the owner\'s own profile says so');
  const navSrc = require('node:fs').readFileSync('src/components/nav-links.tsx', 'utf8') + require('node:fs').readFileSync('src/lib/posts-nav.ts', 'utf8');
  ok(!/fetch\(|sessionStorage|localStorage/.test(navSrc), 'the sidebar makes no extra request and keeps nothing across accounts (Codex 2026-11-15)');
  eq(nav.navItems(false).map((i) => i.href), ['/studio', '/library', '/settings'], 'not allowed: the sidebar is unchanged');
  eq(nav.navItems(true).map((i) => i.href), ['/studio', '/library', '/posts', '/settings'], 'owner: Scheduled posts right under Viral library');

  // Thumbnails (2026-11-15: the picker showed black tiles): lists show still pictures, never a video per tile.
  const view = require('node:fs').readFileSync('src/components/scheduled-posts-view.tsx', 'utf8');
  ok((view.match(/<ThumbImg /g) ?? []).length === 2, 'calendar cards and the picker show still pictures');
  ok((view.match(/<video /g) ?? []).length === 1 && /<video [^>]*preload="none"/.test(view), 'the only video is the one opened post, loaded when played');

  // Its own every-minute job (Codex 2026-11-15): the shared recovery cron is exactly as before, so a slow Meta call can
  // never hold up anyone's exports, generations or cleanup.
  const fs = require('node:fs');
  const shared_ = fs.readFileSync('src/app/api/internal/generations/route.ts', 'utf8');
  ok(!/advancePosts|scheduled/.test(shared_), 'the shared recovery cron does not touch scheduled posts');
  const crons = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons;
  ok(crons[0].path === '/api/internal/generations' && crons.some((c) => c.path === '/api/internal/posts' && c.schedule === '* * * * *'), 'posting has its own per-minute cron');
  const secret = 'x'.repeat(40);
  let ran = 0;
  const postsCron = load('src/app/api/internal/posts/route.ts', { 'node:crypto': require('node:crypto'), '@/lib/server/scheduled-posts': { advancePosts: async () => { ran++; return false; } } }, { CRON_SECRET: secret });
  eq((await postsCron.GET(new Request('https://m/api/internal/posts'))).status, 401, 'posting cron: no secret, refused');
  eq((await postsCron.GET(new Request('https://m/api/internal/posts', { headers: { authorization: `Bearer ${secret}` } }))).status, 200, 'posting cron: with the secret, runs');
  ok(ran === 1, 'and runs the posting pass once');
  let queried = false;
  const offDb = { ...stubs, '@/lib/supabase/server': { createSupabaseAdminClient: () => { queried = true; return fakeDb; } } };
  const offPosts = load('src/lib/server/scheduled-posts.ts', offDb, { SCHEDULED_POSTS_USERS: '' }, { URLSearchParams });
  ok((await offPosts.advancePosts()) === false && !queried, 'scheduler off: no database read at all');
  const missing = load('src/lib/server/scheduled-posts.ts', { ...stubs, '@/lib/supabase/server': { createSupabaseAdminClient: () => ({ from: () => { const q = { select: () => q, or: () => q, order: () => q, limit: async () => ({ data: null, error: { code: 'PGRST205' } }), in: () => q }; return q; } }) } }, env, { URLSearchParams });
  ok((await missing.advancePosts()) === false, 'database update not applied yet: quietly nothing to post, not an error every minute');

  // Creating: only the user's own videos, never in the past.
  const item = { mediaId: 'mine.mp4', at: new Date(T0 + 3600e3).toISOString(), targets: ['instagram'], captions: { instagram: 'a', facebook: 'never stored' } };
  const made = await sp.createPosts(OWNER, [item], T0);
  ok(made.posts?.length === 1 && inserted[0].user_id === OWNER, 'a batch is saved for the owner');
  eq(inserted[0].captions, { instagram: 'a' }, 'only the chosen networks\' captions are kept');
  ok((await sp.createPosts(OWNER, [{ ...item, mediaId: 'someone-elses.mp4' }], T0)).error, 'another account\'s video refused');
  ok((await sp.createPosts(OWNER, [{ ...item, at: new Date(T0 - 3600e3).toISOString() }], T0)).error, 'a time that has passed refused');
  ok((await sp.createPosts(OWNER, Array(101).fill(item), T0)).error, 'over 100 in one batch refused');

  // Instagram: container, processing, publish once.
  let m = meta();
  let saves = [];
  let next = await sp.advancePost(post(), 0, ctxFor(m, T0, saves));
  ok(next.state === 'posting' && next.result.instagram.container === 'C1' && m.publishes === 0, 'tick 1: container made, Meta still processing, nothing published');
  ok(m.reelType === 'REELS' && m.lastCaption === 'IG caption' && m.lastVideoUrl.includes('media/mine.mp4'), 'posted as a Reel with its caption, from the video\'s link');
  ok(saves.some(([t, r]) => t === 'instagram' && r.container === 'C1'), 'the container is saved before waiting');
  next = await sp.advancePost(post({ result: next.result }), 0, ctxFor(m, T0 + 60e3));
  ok(next.state === 'posted' && m.publishes === 1 && m.creates === 1, 'tick 2: published exactly once, no second container');
  eq(next.result.instagram.url, 'https://www.instagram.com/reel/M1/', 'the post links to the reel');
  next = await sp.advancePost(post({ result: next.result }), 0, ctxFor(m, T0 + 120e3));
  ok(m.publishes === 1 && next.state === 'posted', 'a done post is never published again');

  // A tick that died right after Meta published: no repost.
  m = meta({ igStatus: ['PUBLISHED'] });
  next = await sp.advancePost(post({ result: { instagram: { state: 'working', step: 'publishing', container: 'C1', since: new Date(T0).toISOString() } } }), 0, ctxFor(m));
  ok(next.state === 'posted' && m.publishes === 0, 'container already PUBLISHED: marked done, not published twice');

  // Instagram's daily limit: wait, don't fail, don't make a container.
  m = meta({ quota: 100 });
  next = await sp.advancePost(post(), 0, ctxFor(m));
  ok(next.state === 'posting' && m.creates === 0 && /daily limit/.test(next.result.instagram.note), 'limit reached: waits with a note, nothing sent');

  // Meta refuses: failed with Meta's reason.
  m = meta({ refuse: true });
  next = await sp.advancePost(post(), 0, ctxFor(m));
  ok(next.state === 'failed' && /too short/.test(next.error) && next.error.startsWith('Instagram:'), 'Meta refuses: failed, with its reason');

  // Network blips: retried each minute, then failed.
  m = meta({ down: true });
  next = await sp.advancePost(post(), 0, ctxFor(m));
  ok(next.state === 'posting' && next.attempts === 1, 'network blip: stays posting, tries again next minute');
  next = await sp.advancePost(post(), 7, ctxFor(m));
  ok(next.state === 'failed' && next.attempts === 8, 'eighth blip in a row: failed');

  // Meta too slow.
  m = meta({ igStatus: ['IN_PROGRESS'] });
  next = await sp.advancePost(post({ result: { instagram: { state: 'working', step: 'processing', container: 'C1', since: new Date(T0).toISOString() } } }), 0, ctxFor(m, T0 + 31 * 60e3));
  ok(next.state === 'failed' && /30 minutes/.test(next.error), 'still processing after 30 minutes: failed');

  // Facebook Page Reels: start, upload from the link, wait, publish once, live.
  const fbPost = (result = {}) => post({ targets: ['facebook'], result });
  m = meta({ fbStatus: [{ uploading_phase: { status: 'in_progress' } }] });
  next = await sp.advancePost(fbPost(), 0, ctxFor(m));
  ok(next.result.facebook.video === 'V1' && next.result.facebook.step === 'uploaded' && m.uploads === 1 && m.finishes === 0, 'tick 1: started and uploaded, waits for Meta to receive it');
  ok(m.uploadHeaders.file_url.includes('media/mine.mp4') && m.uploadHeaders.Authorization === 'OAuth PAGETOKEN', 'uploaded from the video\'s link with the Page token');
  m.fbStatus = [{ uploading_phase: { status: 'complete' } }, { uploading_phase: { status: 'complete' }, publishing_phase: { status: 'complete' }, video_status: 'ready' }];
  next = await sp.advancePost(fbPost(next.result), 0, ctxFor(m, T0 + 60e3));
  ok(next.state === 'posted' && m.finishes === 1 && m.fbState === 'PUBLISHED' && m.fbCaption === 'FB caption', 'tick 2: published once, with its caption');
  eq(next.result.facebook.url, 'https://www.facebook.com/reel/V1', 'the post links to the Facebook reel');
  m = meta({ fbStatus: [{ uploading_phase: { status: 'complete' }, publishing_phase: { status: 'in_progress' } }] });
  next = await sp.advancePost(fbPost({ facebook: { state: 'working', step: 'finishing', video: 'V1', since: new Date(T0).toISOString() } }), 0, ctxFor(m));
  ok(m.finishes === 0 && next.result.facebook.step === 'published', 'a tick that died after publishing: not published twice');
  m = meta({ fbStatus: [{ video_status: 'error', processing_phase: { status: 'error', error: { message: 'Bad aspect ratio' } } }] });
  next = await sp.advancePost(fbPost({ facebook: { state: 'working', step: 'uploaded', video: 'V1', since: new Date(T0).toISOString() } }), 0, ctxFor(m));
  ok(next.state === 'failed' && /Bad aspect ratio/.test(next.error), 'Facebook rejects the video: failed with its reason');

  // Both networks: one failing doesn't undo the other, and a retry never reposts where it went out.
  m = meta({ refuse: true });
  next = await sp.advancePost(post({ targets: ['instagram', 'facebook'], result: { facebook: { state: 'done', id: 'V1', url: 'u' } } }), 0, ctxFor(m));
  ok(next.state === 'failed' && next.result.facebook.state === 'done' && !m.calls.some((u) => u.includes('video_reels') || u.includes('rupload')), 'Facebook already done: untouched while Instagram fails');
  ok(!/Facebook/.test(next.error), 'the error names only the network that failed');

  // Progress is never lost (Codex 2026-11-15 P1): an error after a step was saved keeps that step.
  m = meta();
  const flaky = m.fetch;
  let n = 0;
  m.fetch = async (u, i) => { if (++n > 2) throw new TypeError('fetch failed'); return flaky(u, i); };
  next = await sp.advancePost(post(), 0, ctxFor(m));
  ok(next.result.instagram.container === 'C1' && next.result.instagram.step === 'processing', 'network dies after the container was made: the container is kept, not started over');
  m = meta({ igStatus: ['FINISHED'] });
  const publishFlaky = m.fetch;
  m.fetch = async (u, i) => { if (u.includes('media_publish')) { m.publishes++; throw new TypeError('timeout'); } return publishFlaky(u, i); };
  next = await sp.advancePost(post({ result: { instagram: { state: 'working', step: 'processing', container: 'C1', since: new Date(T0).toISOString() } } }), 0, ctxFor(m));
  ok(next.result.instagram.step === 'publishing' && next.result.instagram.container === 'C1', 'publish call lost in the network: the publish mark stays, so the next pass asks Meta first');
  m = meta({ igStatus: ['PUBLISHED'] });
  next = await sp.advancePost(post({ result: next.result }), 0, ctxFor(m));
  ok(next.state === 'posted' && m.publishes === 0 && m.creates === 0, 'next pass: Meta says it went out, so done without a second post');

  // A run that lost its claim stops before calling Meta again (Codex P1).
  m = meta({ igStatus: ['FINISHED'] });
  const lost = ctxFor(m);
  lost.save = async () => { throw new sp.LostLease('taken over'); };
  let threw = null;
  await sp.advancePost(post(), 0, lost).catch((e) => { threw = e; });
  ok(threw instanceof sp.LostLease && m.publishes === 0 && m.creates === 1, 'lost the claim after making the container: stops, publishes nothing');

  // Time limits (Codex P1): each Meta call has a timeout; nothing starts after the post's deadline.
  m = meta();
  let signals = 0;
  const timed = m.fetch;
  m.fetch = async (u, i) => { if (i?.signal) signals++; return timed(u, i); };
  await sp.advancePost(post(), 0, ctxFor(m));
  ok(signals > 0 && signals === m.calls.length, 'every Meta call carries a timeout');
  m = meta();
  next = await sp.advancePost(post(), 0, { ...ctxFor(m), deadline: Date.now() - 1 });
  ok(m.calls.length === 0 && next.state === 'posting', 'past the deadline: no call to Meta, it carries on next minute');

  // Retry never reposts something that may have gone out (Codex P1).
  const kept = sp.retryResult({
    instagram: { state: 'failed', step: 'publishing', container: 'C1', error: 'x' },
    facebook: { state: 'failed', step: 'uploaded', video: 'V9', error: 'y' },
  });
  ok(kept.instagram?.state === 'working' && kept.instagram.container === 'C1' && kept.instagram.step === 'publishing', 'retry keeps an Instagram attempt that may have published, to check it first');
  ok(kept.facebook === undefined, 'retry starts fresh only where nothing could have gone out');
  const fbKept = sp.retryResult({ facebook: { state: 'failed', step: 'finishing', video: 'V1' }, instagram: { state: 'done', id: 'M1' } });
  ok(fbKept.facebook?.state === 'working' && fbKept.facebook.video === 'V1' && fbKept.instagram.state === 'done', 'retry keeps a Facebook publish that may have happened, and what is done');
  m = meta({ igStatus: ['PUBLISHED'] });
  next = await sp.advancePost(post({ result: kept, targets: ['instagram'] }), 0, ctxFor(m));
  ok(next.state === 'posted' && m.publishes === 0 && m.creates === 0, 'after Retry: Meta says it went out, so no second post');

  // Only listed accounts' posts are ever picked up (Codex P2).
  const filters = [];
  const spyDb = { from: () => { const q = { select: () => q, update: () => q, in: (col, v) => { filters.push([col, v]); return q; }, or: () => q, order: () => q, eq: () => q, limit: async () => ({ data: [], error: null }) }; return q; } };
  const listed = load('src/lib/server/scheduled-posts.ts', { ...stubs, '@/lib/supabase/server': { createSupabaseAdminClient: () => spyDb } }, env, { URLSearchParams });
  await listed.advancePosts();
  ok(filters.some(([c, v]) => c === 'user_id' && JSON.stringify(v) === JSON.stringify([OWNER])), 'the due-posts read is limited to the listed accounts');

  // The page: a real 404 for everyone else, before anything renders (Codex P2).
  const res404 = { status: 404 };
  const next_ = { cookies: { getAll: () => [], set() {} } };
  const NextResponse = { next: () => next_, rewrite: (_u, init) => ({ ...res404, ...init, rewritten: true, cookies: { set() {} } }), redirect: (u) => ({ status: 307, to: String(u), cookies: { set() {} } }), json: (b, i) => ({ status: i?.status ?? 200, body: b, cookies: { set() {} } }) };
  const session = (sub) => load('src/lib/supabase/session.ts', { 'next/server': { NextResponse }, '@supabase/ssr': { createServerClient: () => ({ auth: { getClaims: async () => ({ data: sub ? { claims: { sub } } : null }) } }) }, '@/lib/posts-access': stubs['@/lib/posts-access'], '@/lib/supabase/server': { createSupabaseAdminClient: () => ({}) } }, { ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://s', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' });
  const reqTo = (path) => ({ nextUrl: new URL(`https://mavya.app${path}`), url: `https://mavya.app${path}`, method: 'GET', cookies: { getAll: () => [], set() {} } });
  eq((await session('someone-else').updateSession(reqTo('/posts'))).status, 404, '/posts for another signed-in user: 404');
  eq((await session(null).updateSession(reqTo('/posts'))).status, 404, '/posts signed out: 404, not a sign-in prompt');
  ok((await session(OWNER).updateSession(reqTo('/posts'))) === next_, '/posts for the owner: goes through');
  const proxySrc = fs.readFileSync('src/proxy.ts', 'utf8'), sessionSrc = fs.readFileSync('src/lib/supabase/session.ts', 'utf8');
  ok(proxySrc.includes('"/posts/:path*"') && /PUBLIC_API = \[[^\]]*"\/api\/internal\/posts"/.test(sessionSrc), 'the proxy guards /posts; the posting cron gets through without a session');

  // The profile: everyone else's is exactly as before; only the owner's carries the menu flag (no extra request).
  const profileFor = (id) => load('src/app/api/profile/route.ts', {
    'node:fs/promises': {}, 'node:path': require('node:path'), 'next/server': { connection: async () => {} }, '@/lib/profile': { NO_PROFILE: {} },
    '@/lib/supabase/server': { authEnabled: () => true, getSessionUser: async () => ({ id, email: 'a@b.c' }), createSupabaseServerClient: async () => ({ from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { first_name: 'A', last_name: 'B', avatar_url: '' }, error: null }) }; return q; } }) },
    '@/lib/posts-access': stubs['@/lib/posts-access'],
  }, env);
  const other = await (await profileFor('someone-else').GET()).json();
  eq(Object.keys(other).sort(), ['avatar', 'email', 'firstName', 'lastName'], 'another user\'s profile: the same four fields as before, nothing added');
  eq((await (await profileFor(OWNER).GET()).json()).scheduler, true, 'the owner\'s profile: scheduler: true');

  // Codex round 2: an unreadable or incomplete answer from Meta is "unknown", never success.
  m = meta({ igStatus: ['FINISHED'] });
  const cut = m.fetch;
  m.fetch = async (u, i) => { const r = await cut(u, i); if (u.includes('media_publish')) return { ok: true, status: 200, json: async () => { throw new Error('body timed out'); } }; return r; };
  next = await sp.advancePost(post({ result: { instagram: { state: 'working', step: 'processing', container: 'C1', since: new Date(T0).toISOString() } } }), 0, ctxFor(m));
  ok(next.state === 'posting' && next.result.instagram.step === 'publishing', 'publish answer cut off mid-body: not marked posted, the publish mark stays to check');
  m = meta();
  const noId = m.fetch;
  m.fetch = async (u, i) => (u.endsWith('/IG/media') ? { ok: true, status: 200, json: async () => ({}) } : noId(u, i));
  next = await sp.advancePost(post(), 0, ctxFor(m));
  ok(next.state === 'posting' && !next.result.instagram?.container, 'container answer without an id: nothing saved as made, tried again next minute');
  m = meta({ fbStatus: [{ uploading_phase: { status: 'complete' } }] });
  const noSuccess = m.fetch;
  m.fetch = async (u, i) => (u.includes('rupload') ? { ok: true, status: 200, json: async () => ({ success: false }) } : noSuccess(u, i));
  next = await sp.advancePost(fbPost({ facebook: { state: 'working', step: 'upload', video: 'V1', since: new Date(T0).toISOString() } }), 0, ctxFor(m));
  ok(next.result.facebook.step === 'upload' && next.state === 'posting', 'upload not confirmed: stays at upload, not marked uploaded');

  // Codex round 2: a Facebook publishing error is a failure, never a green check.
  m = meta({ fbStatus: [{ video_status: 'ready', uploading_phase: { status: 'complete' }, publishing_phase: { status: 'error' } }] });
  next = await sp.advancePost(fbPost({ facebook: { state: 'working', step: 'finishing', video: 'V1', since: new Date(T0).toISOString() } }), 0, ctxFor(m));
  ok(next.state === 'failed' && /publish/.test(next.error) && m.finishes === 0, 'publishing phase in error with video "ready": failed, not posted');
  m = meta({ fbStatus: [{ video_status: 'ready', uploading_phase: { status: 'complete' }, publishing_phase: { status: 'in_progress' } }] });
  next = await sp.advancePost(fbPost({ facebook: { state: 'working', step: 'published', video: 'V1', since: new Date(T0).toISOString() } }), 0, ctxFor(m));
  ok(next.state === 'posting', 'video "ready" while publishing is still in progress: not yet posted');

  // Codex round 2: the claim re-checks "due", so a post moved later between the read and the claim is not taken.
  const ors = [];
  const claimDb = { from: () => { const q = { select: () => q, update: () => q, in: () => q, eq: () => q, order: () => q, or: (f) => { ors.push(f); return q; }, limit: async () => ({ data: [{ id: 'P1', user_id: OWNER, targets: ['instagram'], result: {}, attempts: 0, at: new Date(T0).toISOString(), state: 'scheduled' }], error: null }), then: (res) => res({ data: [], error: null }) }; return q; } };
  const claimer = load('src/lib/server/scheduled-posts.ts', { ...stubs, '@/lib/supabase/server': { createSupabaseAdminClient: () => claimDb } }, env, { URLSearchParams });
  const worked = await claimer.advancePosts(T0);
  ok(ors.length === 2 && ors.every((f) => /state\.eq\.scheduled,at\.lte\./.test(f)), 'the claim repeats the due test (time come), not just the state');
  ok(worked === false, 'the row no longer due at claim time: nothing is posted');

  // Per-video times (founder 2026-11-15: "per video, i can schedule anytime i want").
  const spreadT = [T0 + 1e6, T0 + 2e6, T0 + 3e6];
  eq(shared.finalTimes(['a', 'b', 'c'], spreadT, {}), spreadT, 'no hand-set times: each video follows the spread');
  eq(shared.finalTimes(['a', 'b', 'c'], spreadT, { b: T0 + 9e6 }), [T0 + 1e6, T0 + 9e6, T0 + 3e6], 'a hand-set time replaces only that video\'s time');
  eq(shared.finalTimes(['a', 'b'], [T0 + 1e6], {}), [T0 + 1e6, null], 'no spread slot left and no hand-set time: no time (blocked)');
  eq(shared.timeProblem(null, T0), 'Pick a time', 'missing time blocks scheduling');
  ok(shared.timeProblem(T0 + 30e3, T0) && shared.timeProblem(T0 + 120e3, T0) === null, 'a time under a minute ahead is refused, later is fine');
  ok(/type="datetime-local"/.test(view) && /disabled=\{[^}]*problems\.some\(Boolean\)/.test(view), 'each picked video has its own time box; any bad time blocks the Schedule button');
  eq(shared.finalTimes(['a', 'b'], spreadT, { a: null }), [null, T0 + 2e6], 'a time box cleared by hand stays empty (blocks), never falls back to the spread');
  ok(/const passed = now \? null : passedAt\(times\);\s*if \(passed !== null\)/.test(view) && /const passedAt = [^\n]*Date\.now\(\)[^\n]*timeProblem\(t, now\)/.test(view), 'times are checked again at the click, not at the last clock tick');

  // Random spread (founder 2026-11-15, against spam filters): 1.5 to 2 hours apart, never on a round time, rolls over.
  const many = shared.randomSlots(40, 9 * 60, 22 * 60, shared.seeded(11));
  const gaps = many.slice(1).map((x, i) => x - many[i]);
  ok(many.length === 40 && gaps.every((g) => g >= shared.MIN_GAP), '40 videos: every gap at least 1.5 hours, overnight too');
  ok(gaps.filter((g) => g < 600).every((g) => g <= shared.MAX_GAP), 'within a day, gaps at most 2 hours');
  ok(new Set(gaps.filter((g) => g < 600)).size > 5, 'gaps vary (random), not a fixed pattern');
  ok(many.every((m) => m % 1440 >= 9 * 60 && m % 1440 <= 22 * 60), 'every time inside the day\'s window');
  ok(many.every((m) => m % 15 !== 0), 'never on the hour or a quarter hour');
  ok(Math.floor(many[many.length - 1] / 1440) >= 4, 'more than fit in a day roll over to the next days');
  eq(shared.randomSlots(5, 540, 1320, shared.seeded(3)), shared.randomSlots(5, 540, 1320, shared.seeded(3)), 'same seed, same times (the screen doesn\'t jump)');
  ok(shared.randomSlots(3, 540, 1320, shared.seeded(5), 20 * 60)[0] >= 20 * 60, 'starting today: the first time is after now');
  ok(/aria-pressed=\{mode === m\}/.test(view) && /"Now" : "Schedule"/.test(view) && /now \? "Post now"/.test(view) && /Times in \{zone\}/.test(view) && !/[\u2013\u2014]/.test(view), 'one video: Now and Schedule buttons; time zone shown; no dashes in the screen');

  // Clock changes (Codex round 6): spacing and "not in the past" hold on the real clock.
  const H = 3600e3, base = Date.parse('2027-03-14T05:00:00Z');
  const springForward = (m) => base + m * 60e3 + (m >= 120 ? -H : 0) + (m >= 120 && m < 180 ? 2 * H : 0); // 02:00-03:00 doesn't exist
  const sf = shared.slotMoments([68, 158, 254], springForward, 0);
  ok(sf.slice(1).every((t, i) => t - sf[i] >= shared.MIN_GAP * 60e3), 'spring-forward day: posts stay at least 1.5 hours apart on the real clock');
  const fallBack = (m) => base + m * 60e3 + (m >= 120 ? H : 0);
  ok(shared.slotMoments([60, 200], fallBack, base + 5 * H)[0] >= base + 5 * H, 'a time before "now" is moved after now');
  ok(shared.slotMoments([60, 200, 400], fallBack, 0).every((t) => Math.floor(t / 60e3) % 15 !== 0), 'moved times still avoid round times');
  // Codex round 7: final moments stay inside Earliest/Latest; one pushed out rolls to the next window.
  const winFits = (t) => { const m = ((t - base) / 60e3) % 1440; return m >= 60 && m <= 180; };
  const winNext = (t) => base + (Math.floor((t - base) / 86400e3) + 1) * 86400e3 + 60 * 60e3 + 7 * 60e3;
  const inWin = shared.slotMoments([68, 158], springForward, 0, winFits, winNext);
  ok(inWin.every(winFits), 'a spring-forward time pushed past Latest moves into the next day\'s window');
  ok(inWin[1] - inWin[0] >= shared.MIN_GAP * 60e3, 'and keeps the 1.5 hour gap');

  // Caption hook = the video's own on-screen hook (founder 2026-11-15: "the hook should be the hook of my video").
  const texts = [
    { id: 'b', text: 'how tf did i get ', start: 0, end: 2.4, y: 73.8, x: 50 },
    { id: 'hook', text: 'WAIT...', start: 0, end: 2.4, y: 67.2, x: 50 },
    { id: 'c', text: '198 users in 1 day?', start: 0, end: 2.4, y: 79.8, x: 50 },
    { id: 'd', text: 'pick AI face', start: 5.5, end: 7.2, y: 20, x: 50 },
    { id: 'e', text: '', start: 0, end: 2.4, y: 76, x: 50 },
  ];
  eq(shared.hookWords(texts, { start: 0, end: 2.672 }), 'WAIT... how tf did i get 198 users in 1 day?', 'all hook text boxes, top to bottom, on one line');
  ok(!/pick AI face/.test(shared.hookWords(texts, { start: 0, end: 2.672 })), 'demo texts after the hook are left out');
  eq(shared.hookWords([{ id: 'x', text: 'SaaS + Insta reels =', start: 0, end: 3, y: 20 }, { id: 'y', text: '🔥', start: 0.2, end: 3, y: 30 }], { start: 1, end: 3.5 }), 'SaaS + Insta reels = 🔥', 'hook length is its trimmed length (end - start)');
  eq(shared.hookWords([{ id: 'hook', text: 'How is this legal?', start: 0, end: 3, y: 22 }, { id: 'z', text: 'browse', start: 3, end: 5, y: 9 }], {}), 'How is this legal?', 'no hook timing saved: the hook text box\'s own end');
  eq(shared.hookWords([], { end: 2 }), null, 'no text boxes: none (the library words are the fallback)');
  const serverSrc = fs.readFileSync('src/lib/server/scheduled-posts.ts', 'utf8');
  ok(/hook: \(e\.runId && onScreen\.get\(e\.runId\)\) \|\| e\.hookText/.test(serverSrc), 'the export list uses the on-screen hook first, the library words only as a fallback');
  ok((view.match(/<HookLine hook=/g) ?? []).length === 2, 'the dialog shows each picked video\'s hook words, for one video and for several');
  const viewNow = fs.readFileSync('src/components/scheduled-posts-view.tsx', 'utf8');
  ok(!/disabled=\{!editable\}/.test(viewNow) && /\{editable \? \(/.test(viewNow), 'a post that went out shows a summary, never greyed-out form boxes (founder 2026-11-15: "looks broken")');
  ok(/function NetworkLogo/.test(viewNow) && !/Open on \{NAMES\[x\]\}<ExternalLink/.test(viewNow) && (viewNow.match(/<NetworkLogo /g) ?? []).length >= 6, 'Instagram and Facebook logos instead of "Open on Instagram / Open on Facebook" text');
  ok(!/id="ig-grad"/.test(viewNow) && /useId\(\)/.test(viewNow), 'each Instagram logo has its own gradient id');
});
