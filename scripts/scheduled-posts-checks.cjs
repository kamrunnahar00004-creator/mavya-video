// Scheduled posts (founder 2026-11-15): captions, spreading times, the owner-only gate, and posting to Instagram Reels
// and the Facebook Page against a simulated Meta, including a tick that dies mid-way never posting twice, the daily
// limit, Meta refusing, network blips, and slow processing. Offline.
const assert = require('node:assert/strict');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 52;
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
};
const env = { SCHEDULED_POSTS_USERS: ` ${OWNER} ` };
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
  const off = load('src/lib/server/scheduled-posts.ts', stubs, { SCHEDULED_POSTS_USERS: '' }, { URLSearchParams });
  ok(!off.schedulerAllowed(OWNER), 'empty list: off for everyone');
  const route = load('src/lib/server/posts-route.ts', { '@/lib/server/who': { currentUser: async () => 'someone-else', signInFirst: () => new Response(null, { status: 401 }) }, '@/lib/server/scheduled-posts': sp });
  eq((await route.postsUser()).response?.status, 404, 'API: another signed-in user gets 404, as if it did not exist');
  const routeOwner = load('src/lib/server/posts-route.ts', { '@/lib/server/who': { currentUser: async () => OWNER, signInFirst: () => new Response(null, { status: 401 }) }, '@/lib/server/scheduled-posts': sp });
  eq((await routeOwner.postsUser()).who, OWNER, 'API: the owner gets through');
  eq(sp.metaCreds({ META_PAGE_ID: '1', META_PAGE_TOKEN: 't' }), null, 'missing Instagram id: posting not set up');

  // Sidebar: every other account sees exactly the old menu.
  const React = { useEffect() {}, useState: (v) => [typeof v === 'function' ? v() : v, () => {}] };
  const nav = load('src/components/nav-links.tsx', { 'react': React, 'react/jsx-runtime': { jsx: () => null, jsxs: () => null }, 'next/navigation': { usePathname: () => null }, 'lucide-react': new Proxy({}, { get: (_, k) => k }), '@/components/pending-link': {} }, {}, { sessionStorage: { getItem: () => null, setItem() {} } });
  eq(nav.navItems(false).map((i) => i.href), ['/studio', '/library', '/settings'], 'not allowed: the sidebar is unchanged');
  eq(nav.navItems(true).map((i) => i.href), ['/studio', '/library', '/posts', '/settings'], 'owner: Scheduled posts right under Viral library');

  // The every-minute job: posting failing never stops exports, generations or cleanup, and posting off costs nothing.
  const steps = [];
  const cronStubs = (postsImpl) => ({
    '@/lib/supabase/server': { createSupabaseAdminClient: () => ({ from: () => { const q = { select: () => q, neq: () => q, or: () => q, in: () => q, order: () => q, limit: async () => ({ data: [], error: null }) }; return q; } }) },
    '@/lib/server/generation-jobs': { advanceGeneration: async () => {} }, '@/lib/server/account-deletion': { advanceDeletion: async () => {} },
    '@/lib/server/uploads': { expireUploads: async () => { steps.push('uploads'); return 0; } }, '@/lib/server/export-jobs': { advanceExport: async () => {} },
    '@/lib/server/temp-cleanup': { expireTemporaryObjects: async () => { steps.push('temp'); return 0; } },
    '@/lib/server/scheduled-posts': { advancePosts: postsImpl }, 'node:crypto': require('node:crypto'),
  });
  const secret = 'x'.repeat(40), req = new Request('https://m/api/internal/generations', { headers: { authorization: `Bearer ${secret}` } });
  const cron = load('src/app/api/internal/generations/route.ts', cronStubs(async () => { throw new Error('Meta down'); }), { CRON_SECRET: secret }, { Date });
  const res = await cron.GET(req);
  ok(steps.includes('uploads') && steps.includes('temp'), 'posting throws: the other work still runs this minute');
  eq(res.status, 503, 'and the minute is reported as failed (visible in logs)');
  steps.length = 0;
  const calm = load('src/app/api/internal/generations/route.ts', cronStubs(async () => false), { CRON_SECRET: secret }, { Date });
  eq((await calm.GET(req)).status, 200, 'nothing to post: the minute succeeds as before');
  let queried = false;
  const offDb = { ...stubs, '@/lib/supabase/server': { createSupabaseAdminClient: () => { queried = true; return fakeDb; } } };
  const offPosts = load('src/lib/server/scheduled-posts.ts', offDb, { SCHEDULED_POSTS_USERS: '' }, { URLSearchParams });
  ok((await offPosts.advancePosts()) === false && !queried, 'scheduler off: no database read at all');
  const missing = load('src/lib/server/scheduled-posts.ts', { ...stubs, '@/lib/supabase/server': { createSupabaseAdminClient: () => ({ from: () => { const q = { select: () => q, or: () => q, order: () => q, limit: async () => ({ data: null, error: { code: 'PGRST205' } }) }; return q; } }) } }, env, { URLSearchParams });
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
});
