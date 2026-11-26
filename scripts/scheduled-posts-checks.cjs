// Content calendar (founder 2026-11-26; was owner-only "Scheduled posts", 2026-11-15): every account plans exported
// videos for Instagram, Facebook, TikTok and YouTube Shorts, copies a caption per platform (hook, app domain, niche
// hashtags), posts by hand and marks each one posted with its link and views. No auto-posting. The app analyzer is
// AI, so paid or trial only. Views are typed in for every platform (founder 2026-11-26: no automatic views). Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 171;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.equal(JSON.stringify(a), JSON.stringify(b), msg); };

const shared = load('src/lib/scheduled-posts.ts');
const ME = 'c4d71805-588e-4af9-acf0-d42b7eb80941';
const T0 = Date.parse('2026-11-26T09:00:00Z');

/** An in-memory Supabase table store with just the query calls the server module makes. */
function fakeDb() {
  const tables = { scheduled_posts: [], scheduled_post_settings: [] };
  const get = (row, col) => {
    const m = col.match(/^(\w+)->(\w+)->>(\w+)$/);
    if (!m) return row[col];
    const v = row[m[1]]?.[m[2]]?.[m[3]];
    return v === undefined ? null : v;
  };
  function query(name) {
    let rows = null, op = 'select', patch = null, filters = [], limit = Infinity;
    const q = {
      select() { return q; },
      insert(r) { op = 'insert'; rows = Array.isArray(r) ? r : [r]; return q; },
      update(p) { op = 'update'; patch = p; return q; },
      delete() { op = 'delete'; return q; },
      upsert(r) { op = 'upsert'; rows = [r]; return q; },
      eq(c, v) { filters.push((x) => get(x, c) === v); return q; },
      in(c, v) { filters.push((x) => v.includes(get(x, c))); return q; },
      gte(c, v) { filters.push((x) => get(x, c) >= v); return q; },
      lt(c, v) { filters.push((x) => get(x, c) < v); return q; },
      not(c) { filters.push((x) => get(x, c) !== null); return q; },
      or(expr) {
        // "col.is.null,col.lt.value": any one of them.
        const parts = expr.split(',').map((p) => { const m = p.match(/^(.+?)\.(is|lt)\.(.+)$/); return m; });
        filters.push((x) => parts.some(([, c, op, v]) => (op === 'is' ? get(x, c) === null : get(x, c) !== null && get(x, c) < v)));
        return q;
      },
      order() { return q; },
      limit(n) { limit = n; return q; },
      abortSignal() { return q; },
      maybeSingle() { return run().then((r) => ({ data: r.data[0] ?? null, error: r.error })); },
      then(res, rej) { return run().then(res, rej); },
    };
    async function run() {
      const table = tables[name];
      const hit = () => table.filter((x) => filters.every((f) => f(x))).slice(0, limit);
      if (op === 'insert' && name === 'scheduled_post_settings' && rows.some((r) => table.some((x) => x.user_id === r.user_id))) return { data: null, error: { code: '23505' } };
      if (op === 'insert') { const made = rows.map((r) => ({ created_at: r.at, ...structuredClone(r) })); table.push(...made); return { data: structuredClone(made), error: null }; }
      if (op === 'upsert') { const r = rows[0]; const i = table.findIndex((x) => x.user_id === r.user_id); if (i >= 0) table[i] = structuredClone(r); else table.push(structuredClone(r)); return { data: null, error: null }; }
      if (op === 'update') { const h = hit(); for (const x of h) Object.assign(x, structuredClone(patch)); return { data: structuredClone(h), error: null }; }
      if (op === 'delete') { const h = hit(); tables[name] = table.filter((x) => !h.includes(x)); return { data: structuredClone(h), error: null }; }
      return { data: structuredClone(hit()), error: null };
    }
    return q;
  }
  return { tables, from: query };
}
const store = fakeDb();
const owned = new Set(['mine.mp4']);
const stubs = {
  '@/lib/supabase/server': { createSupabaseAdminClient: () => store },
  '@/lib/server/my-files': { fileSources: async () => ({}) },
  '@/lib/server/store': { getFilePrefs: async () => ({ names: {}, hidden: [] }), mediaAccess: async (id) => (owned.has(id) ? { mime: 'video/mp4', size: 1 } : null) },
  '@/lib/scheduled-posts': shared,
};
const sp = load('src/lib/server/scheduled-posts.ts', stubs, {}, { structuredClone });
const app = { domain: 'cybershield.app', hashtags: ['#appmarketing', '#indiehacker', '#buildinpublic', '#saasmarketing', '#ugcads', '#startup'] };

finish('scheduled-posts-checks', EXPECTED, () => checks, async () => {
  // Four platforms, one caption format (founder 2026-11-26).
  eq(shared.TARGETS, ['instagram', 'facebook', 'tiktok', 'youtube'], 'Instagram, Facebook, TikTok and YouTube Shorts');
  const hook = 'my app had 0 users… then i found this 😳';
  const ig = shared.captionFor('instagram', shared.DEFAULT_TEMPLATES.instagram, hook, app);
  eq(ig, 'my app had 0 users… then i found this 😳\n\ncybershield.app 🔗 link in bio, or comment "APP" and i\'ll DM it\n\n#appmarketing #indiehacker #buildinpublic #saasmarketing #ugcads', 'Instagram: the founder\'s format with the app domain and 5 hashtags');
  ok(!/https?:\/\//.test(ig), 'the domain shows without https:// (founder: "only app name")');
  eq(shared.captionFor('facebook', shared.DEFAULT_TEMPLATES.facebook, hook, app).split('\n').pop(), '#appmarketing #indiehacker #buildinpublic', 'Facebook: 3 hashtags');
  eq(shared.captionFor('youtube', shared.DEFAULT_TEMPLATES.youtube, hook, app).split('\n').pop().split(' ').length, 3, 'YouTube: 3 hashtags (the ones shown above the title)');
  eq(shared.captionFor('tiktok', shared.DEFAULT_TEMPLATES.tiktok, hook, app).split('\n').pop().split(' ').length, 5, 'TikTok: 5 hashtags');
  ok(/comment "APP"/.test(shared.DEFAULT_TEMPLATES.tiktok.split('\n')[2]) && /comment "APP"/.test(shared.DEFAULT_TEMPLATES.youtube.split('\n')[2]), 'TikTok and YouTube lead with "comment" (bio links need 1,000 followers; Shorts links aren\'t clickable)');
  ok(!/link in bio/.test(shared.DEFAULT_TEMPLATES.facebook), 'Facebook has no "link in bio" (Pages have none)');
  eq(shared.captionFor('youtube', shared.DEFAULT_TEMPLATES.youtube, hook, app).split('\n')[0], hook, 'YouTube\'s first line (the Short\'s title) is the hook');
  for (const t of shared.TARGETS) ok(shared.HASHTAGS[t] <= 5, `${t}: at most 5 hashtags (Instagram's cap)`);
  const bare = shared.captionFor('instagram', shared.DEFAULT_TEMPLATES.instagram, '', { domain: '', hashtags: [] });
  ok(!/\{|\}/.test(bare) && !bare.startsWith('\n') && !bare.endsWith('\n') && !/\n /.test(bare), 'no app or hook yet: no "{domain}", no blank first line, no stray spaces');
  ok(!/\n{3,}/.test(bare), 'no app yet: no empty blocks left behind');
  ok(shared.captionFor('instagram', '{hook}', 'x'.repeat(3000), app).length === shared.CAPTION_MAX, 'a caption never exceeds 2,200 characters');
  eq(Object.keys(shared.captionsFor(['tiktok', 'youtube'], shared.DEFAULT_TEMPLATES, hook, app)), ['tiktok', 'youtube'], 'captions only for the picked platforms');
  eq(shared.fillCaption('{hook}\n\nlink in bio', ''), 'link in bio', 'no hook: its line goes');

  // Hashtags and the app's domain.
  eq(shared.tag('App Marketing'), '#appmarketing', 'a tag: lower case, no spaces');
  eq(shared.tag('#build-in-public!'), '#buildinpublic', 'symbols dropped');
  eq(shared.tag('###'), '', 'nothing left: no tag');
  eq(shared.tagList('#a, #b #a  c'), ['#a', '#b', '#c'], 'typed tags: split on spaces and commas, no repeats');
  eq(shared.tagList(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 15, 'at most 15 kept');
  eq(shared.tagList(42), [], 'not a list or text: none');
  eq(shared.domainOf('https://www.CyberShield.app/pricing?x=1'), 'cybershield.app', 'domain: no https, no www, no path');
  eq(shared.domainOf('cybershield.app'), 'cybershield.app', 'a bare domain works');
  eq(shared.domainOf('not a site'), '', 'not a web address: none');
  eq(shared.domainOf('javascript:alert(1)'), '', 'a script link is not a domain');
  eq(shared.domainOf('localhost'), '', 'no dot: not a public site');

  // Post links: only to that platform.
  eq(shared.postLink('instagram', 'instagram.com/reel/abc/'), 'https://instagram.com/reel/abc/', 'Instagram link without https: cleaned');
  eq(shared.postLink('tiktok', 'https://www.tiktok.com/@maya/video/123'), 'https://www.tiktok.com/@maya/video/123', 'TikTok link kept');
  ok(shared.postLink('facebook', 'https://fb.watch/xyz/') && shared.postLink('facebook', 'https://www.facebook.com/reel/1'), 'Facebook: facebook.com and fb.watch');
  ok(shared.postLink('youtube', 'https://youtube.com/shorts/abcdefghijk') && shared.postLink('youtube', 'youtu.be/abcdefghijk'), 'YouTube: youtube.com and youtu.be');
  eq(shared.postLink('tiktok', 'https://www.instagram.com/reel/abc/'), null, 'another platform\'s link refused');
  eq(shared.postLink('instagram', 'https://instagram.com.evil.example/reel'), null, 'a look-alike host refused');
  eq(shared.postLink('instagram', 'https://evilinstagram.com/reel'), null, 'a host merely ending in the name refused');
  eq(shared.postLink('youtube', 'javascript:alert(1)//youtube.com'), null, 'a script link refused');
  eq(shared.postLink('instagram', 'http://instagram.com/reel/a'), 'https://instagram.com/reel/a', 'http becomes https');
  eq(shared.postLink('instagram', 'https://instagram.com/' + 'a'.repeat(600)), null, 'over-long link refused');
  eq(shared.youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share'), 'dQw4w9WgXcQ', 'Shorts link: its id');
  eq(shared.youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'youtu.be: its id');
  eq(shared.youtubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'watch link: its id');
  eq(shared.youtubeId('https://www.youtube.com/@channel'), null, 'a channel link has no video');

  // Posted state and views.
  eq(shared.stateOf(['instagram', 'tiktok'], { instagram: { postedAt: 'x' } }), 'scheduled', 'one of two posted: still planned');
  eq(shared.stateOf(['instagram', 'tiktok'], { instagram: { postedAt: 'x' }, tiktok: { postedAt: 'y' } }), 'posted', 'every platform posted: posted');
  eq(shared.totalViews({ targets: ['instagram', 'youtube', 'tiktok'], result: { instagram: { views: 120 }, youtube: { views: 30 } } }), 150, 'views add up across platforms');
  eq(shared.totalViews({ targets: ['instagram'], result: {} }), null, 'no views known: none (not 0)');
  eq(shared.totalViews({ targets: ['instagram'], result: { facebook: { views: 9 } } }), null, 'a platform no longer picked doesn\'t count');

  // Times: any platform, past times allowed (log a video already posted), within a year back and 60 days ahead.
  const good = { at: new Date(T0 + 3600e3).toISOString(), targets: ['tiktok', 'youtube'], captions: { tiktok: 'a', youtube: 'b' } };
  eq(shared.badPost(good, T0), null, 'TikTok and YouTube accepted');
  eq(shared.badPost({ ...good, at: new Date(T0 - 30 * 86400e3).toISOString() }, T0), null, 'a past time is fine (logging)');
  ok(shared.badPost({ ...good, at: new Date(T0 - 400 * 86400e3).toISOString() }, T0), 'over a year back refused');
  ok(shared.badPost({ ...good, at: new Date(T0 + 61 * 86400e3).toISOString() }, T0), 'over 60 days ahead refused');
  ok(shared.badPost({ ...good, targets: ['myspace'] }, T0), 'unknown platform refused');
  ok(shared.badPost({ ...good, targets: ['tiktok', 'tiktok'] }, T0), 'a platform twice refused');
  ok(shared.badPost({ ...good, targets: [] }, T0), 'no platform refused');
  ok(/TikTok/.test(shared.badPost({ ...good, captions: { tiktok: 'x'.repeat(2201), youtube: 'b' } }, T0)), 'over-long caption refused, naming the platform');

  // Marking a platform posted.
  eq(sp.markResult('instagram', undefined, { posted: false }, T0), { r: undefined }, 'unticked: no record');
  eq(sp.markResult('instagram', undefined, { posted: true }, T0), { r: { postedAt: new Date(T0).toISOString() } }, 'ticked with no link: posted now');
  eq(sp.markResult('instagram', { postedAt: '2026-11-01T00:00:00.000Z' }, { posted: true }, T0).r.postedAt, '2026-11-01T00:00:00.000Z', 'ticked again: keeps when it was first marked');
  ok(sp.markResult('tiktok', undefined, { posted: true, url: 'https://instagram.com/reel/1' }, T0).error, 'a wrong platform\'s link is refused');
  eq(sp.markResult('tiktok', undefined, { posted: true, url: 'tiktok.com/@a/video/1', views: '1,234' }, T0).r.views, 1234, 'typed views: "1,234" is 1234');
  ok(sp.markResult('instagram', undefined, { posted: true, views: '12.5' }, T0).error && sp.markResult('instagram', undefined, { posted: true, views: '-3' }, T0).error, 'views must be a whole number, not negative');
  eq(sp.markResult('instagram', undefined, { posted: true, views: '' }, T0).r.views, undefined, 'empty views: none');
  eq(sp.markResult('youtube', undefined, { posted: true, url: 'https://youtu.be/dQw4w9WgXcQ', views: '999' }, T0).r.views, 999, 'YouTube views are typed in like every platform (founder 2026-11-26)');

  // Creating: own videos only; planned; any time in range.
  const item = { mediaId: 'mine.mp4', at: new Date(T0 - 86400e3).toISOString(), targets: ['instagram', 'tiktok'], captions: { instagram: 'a', tiktok: 'b', facebook: 'extra' }, title: 'Reel', hook: 'h' };
  const made = await sp.createPosts(ME, [item], T0);
  ok(made.posts?.length === 1 && made.posts[0].state === 'scheduled', 'a video from yesterday is logged, as planned until marked posted');
  eq(Object.keys(made.posts[0].captions), ['instagram', 'tiktok'], 'only the picked platforms\' captions are kept');
  ok((await sp.createPosts(ME, [{ ...item, mediaId: 'someone-elses.mp4' }], T0)).error, 'another account\'s video refused');
  ok((await sp.createPosts(ME, Array(101).fill(item), T0)).error, 'over 100 in one batch refused');
  ok((await sp.createPosts(ME, [{ ...item, targets: ['snapchat'] }], T0)).error, 'unknown platform refused');

  // Editing and marking posted.
  const id = made.posts[0].id;
  let out = await sp.updatePost(ME, id, { rev: store.tables.scheduled_posts.find((r) => r.id === id)?.updated_at, at: item.at, targets: ['instagram', 'tiktok'], captions: item.captions, marks: { instagram: { posted: true, url: 'instagram.com/reel/abc', views: '130' } } }, T0);
  ok(out.post && out.post.result.instagram.url === 'https://instagram.com/reel/abc' && out.post.result.instagram.views === 130, 'Instagram marked posted with its link and views');
  eq(out.post.state, 'scheduled', 'TikTok not posted yet: still planned');
  out = await sp.updatePost(ME, id, { rev: store.tables.scheduled_posts.find((r) => r.id === id)?.updated_at, at: item.at, targets: ['instagram', 'tiktok'], captions: item.captions, marks: { tiktok: { posted: true } } }, T0);
  eq(out.post.state, 'posted', 'both posted: posted');
  ok(out.post.result.instagram.views === 130, 'a platform not in this edit keeps its record');
  ok((await sp.updatePost('someone-else', id, { at: item.at, targets: ['instagram'], captions: { instagram: 'x' } }, T0)).error, 'another account can\'t edit it');
  out = await sp.updatePost(ME, id, { rev: store.tables.scheduled_posts.find((r) => r.id === id)?.updated_at, at: item.at, targets: ['instagram'], captions: { instagram: 'x' } }, T0);
  ok(out.post.state === 'posted' && !('tiktok' in out.post.result), 'TikTok removed: its record goes; Instagram alone is posted');
  ok((await sp.updatePost(ME, id, { rev: store.tables.scheduled_posts.find((r) => r.id === id)?.updated_at, at: item.at, targets: ['instagram'], captions: { instagram: 'x' }, marks: { instagram: { posted: true, url: 'https://evil.example' } } }, T0)).error, 'a bad link is refused and nothing saves');
  eq(await sp.deletePost('someone-else', id), 'gone', 'another account can\'t remove it');
  eq(await sp.deletePost(ME, id, 'an-older-rev'), store.tables.scheduled_posts.find((r) => r.id === id)?.updated_at ? 'changed' : 'ok', 'removing an older copy: refused when it changed since');
  ok(['ok', 'gone'].includes(await sp.deletePost(ME, id, store.tables.scheduled_posts.find((r) => r.id === id)?.updated_at)), 'removing the copy that was opened: removed');
  const lockSrc = fs.readFileSync('src/components/scheduled-posts-view.tsx', 'utf8');
  ok(/await connection\(\)/.test(fs.readFileSync('src/app/(app)/posts/page.tsx', 'utf8')), 'the page renders per request, never prerendered (it reads the clock; the build failed without this)');
  ok(/<fieldset disabled=\{saving\}/.test(lockSrc) && /<fieldset disabled=\{busy !== null\}/.test(lockSrc), 'post and settings forms are locked while saving');

  // Old auto-posted rows read as posted.
  store.tables.scheduled_posts.push({ id: 'old', user_id: ME, media_id: 'mine.mp4', title: '', hook: '', captions: {}, targets: ['instagram', 'facebook'], at: new Date(T0).toISOString(), state: 'posted', result: { instagram: { state: 'done', id: 'M1', url: 'https://www.instagram.com/reel/M1/' }, facebook: { state: 'done' } }, created_at: '' });
  const old = (await sp.listPosts(ME, new Date(T0 - 1).toISOString(), new Date(T0 + 1).toISOString())).find((p) => p.id === 'old');
  ok(old.state === 'posted' && old.result.instagram.url === 'https://www.instagram.com/reel/M1/', 'an old auto-posted reel stays posted with its link');
  ok(!('step' in old.result.instagram) && !('id' in old.result.instagram), 'old posting internals aren\'t sent to the page');

  // The app: typed by hand (free) or analyzed (paid).
  const T = shared.DEFAULT_TEMPLATES;
  ok((await sp.saveSetup(ME, { templates: T, url: 'not a site', hashtags: '' })).error, 'a bad website refused');
  ok((await sp.saveSetup(ME, { templates: { ...T, tiktok: 'x'.repeat(2201) }, url: 'a.app' })).error, 'an over-long template refused');
  ok(!store.tables.scheduled_post_settings.some((r) => r.user_id === ME), 'a refused save writes nothing at all (no half save)');
  const typed = await sp.saveSetup(ME, { rev: (await sp.getSetup(ME)).rev, templates: { ...T, tiktok: 'mine {hook}' }, url: 'https://www.cybershield.app/', hashtags: 'appmarketing, #IndieHacker' });
  eq([typed.app.domain, typed.app.hashtags], ['cybershield.app', ['#appmarketing', '#indiehacker']], 'typed app: domain and cleaned hashtags saved');
  eq((await sp.getTemplates(ME)).tiktok, 'mine {hook}', 'templates saved per platform, in the same write');
  const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => sp.claimAnalysis(ME, T0 + i)));
  ok(claims.filter(Boolean).length <= 5, '8 parallel clicks: never more than 5 pass');
  eq(store.tables.scheduled_post_settings.find((r) => r.user_id === ME).templates.app.runs.length, claims.filter(Boolean).length, 'every analysis that passed is counted (none lost to a parallel write)');
  for (let i = claims.filter(Boolean).length; i < 5; i++) await sp.claimAnalysis(ME, T0 + 5);
  ok(!(await sp.claimAnalysis(ME, T0 + 10)), 'the 6th that day refused');
  ok(await sp.claimAnalysis(ME, T0 + 86400e3 + 10), 'next day: allowed again');
  const tokenA = await sp.claimAnalysis(ME, T0 + 86400e3 + 11);
  const tokenB = await sp.claimAnalysis(ME, T0 + 86400e3 + 12);
  eq(await sp.saveAnalysis(ME, tokenA, 'https://old.app/', { name: 'Old', hashtags: ['#old'] }, T0), null, 'a slower, older analysis never overwrites the newer one');
  const saved = (await sp.saveAnalysis(ME, tokenB, 'https://cybershield.app/', { name: 'CyberShield', hashtags: ['#a', 'b'] }, T0)).app;
  ok(saved.analyzedAt && saved.domain === 'cybershield.app' && saved.hashtags.join() === '#a,#b', 'analysis saved with domain and hashtags');
  const tokenC = await sp.claimAnalysis(ME, T0 + 86400e3 + 13);
  await sp.saveSetup(ME, { rev: (await sp.getSetup(ME)).rev, templates: { ...T, tiktok: 'mine {hook}' }, url: 'typed.app', hashtags: '#typed' });
  ok(await sp.saveAnalysis(ME, tokenC, 'https://late.app/', { name: 'Late', hashtags: ['#late'] }, T0) === null && (await sp.getApp(ME)).domain === 'typed.app', 'typed while an analysis ran: the typed app wins');
  ok(!('runs' in (await sp.getApp(ME))), 'the run log is never sent to the page');
  ok((await sp.getTemplates(ME)).tiktok === 'mine {hook}', 'an analysis keeps the templates');

  // No automatic views (founder 2026-11-26: "only youtube doesn't make sense").
  ok(!/refreshYouTubeViews|YOUTUBE_API_KEY|googleapis/.test(fs.readFileSync('src/lib/server/scheduled-posts.ts', 'utf8')), 'no YouTube views job or API key');
  ok(!fs.existsSync('src/app/api/internal/posts/route.ts') && !JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons.some((c) => c.path === '/api/internal/posts') && !/internal\/posts/.test(fs.readFileSync('src/lib/supabase/session.ts', 'utf8')), 'no calendar cron at all');
  ok(!/updated daily|fill in daily/.test(fs.readFileSync('src/components/scheduled-posts-view.tsx', 'utf8')), 'the page has a views box for YouTube too');

  // Codex 2026-11-26 round 1.
  store.tables.scheduled_posts.push({ id: 'partial', user_id: ME, media_id: 'mine.mp4', title: '', hook: '', captions: {}, targets: ['instagram', 'facebook'], at: new Date(T0).toISOString(), state: 'failed', result: { instagram: { state: 'done', id: 'M2', url: 'https://www.instagram.com/reel/M2/' }, facebook: { state: 'failed', error: 'x' } }, created_at: '' });
  const partial = (await sp.listPosts(ME, new Date(T0 - 1).toISOString(), new Date(T0 + 1).toISOString())).find((p) => p.id === 'partial');
  ok(partial.result.instagram.postedAt && partial.result.instagram.url && !partial.result.facebook && partial.state === 'scheduled', 'an old partly posted row: the platform that went out stays posted with its link');
  const raced = (await sp.createPosts(ME, [{ ...item, targets: ['instagram'], captions: { instagram: 'a' } }], T0)).posts[0];
  const rowR = store.tables.scheduled_posts.find((r) => r.id === raced.id);
  rowR.updated_at = '2026-11-26T09:00:00.000Z';
  const realFrom = store.from;
  let bumped = false;
  store.from = (name) => { const q = realFrom(name); const update = q.update; q.update = (p) => { if (!bumped && name === 'scheduled_posts') { bumped = true; rowR.updated_at = '2026-11-26T09:00:05.000Z'; } return update(p); }; return q; };
  const lost = await sp.updatePost(ME, raced.id, { rev: '2026-11-26T09:00:00.000Z', at: item.at, targets: ['instagram'], captions: { instagram: 'b' } }, T0);
  store.from = realFrom;
  ok(lost.error && rowR.captions.instagram === 'a', 'a post changed between the read and the write (another tab): the stale edit is refused, nothing overwritten');
  ok((await sp.updatePost(ME, raced.id, { at: item.at, targets: ['instagram'], captions: { instagram: 'b' } }, T0)).error, 'an edit without the revision it opened is refused');
  ok((await sp.updatePost(ME, raced.id, { at: item.at, targets: ['instagram'], captions: { instagram: 'b' }, rev: rowR.updated_at }, T0)).post?.captions.instagram === 'b' && rowR.updated_at > '2026-11-26T09:00:05.000Z', 'opened again: it saves and moves updated_at on');
  eq(shared.postLink('instagram', 'https://instagram.com/'), null, 'a home page is not a post');
  eq(shared.postLink('tiktok', 'https://user:pw@tiktok.com/@a/video/1'), null, 'login details in a link refused');
  eq(shared.postLink('facebook', 'https://facebook.com:8443/reel/1'), null, 'a custom port refused');
  eq(shared.postLink('youtube', 'https://youtube.com/@channel'), null, 'YouTube: only a link to one video ');
  eq(shared.youtubeId('https://youtube.com/feed?v=dQw4w9WgXcQ'), null, 'a v= on another YouTube page is not a video');
  const [, both] = await Promise.all([sp.claimAnalysis(ME, T0 + 3 * 86400e3), sp.saveSetup(ME, { rev: (await sp.getSetup(ME)).rev, templates: { ...shared.DEFAULT_TEMPLATES, facebook: 'both {hook}' }, url: 'both.app', hashtags: '#both' })]);
  ok(both.app && (await sp.getTemplates(ME)).facebook === 'both {hook}' && (await sp.getApp(ME)).domain === 'both.app' && store.tables.scheduled_post_settings.find((r) => r.user_id === ME).templates.app.runs.length === 1, 'a save and an analysis claim at the same moment: both kept (no stale overwrite)');
  const staleRev = (await sp.getSetup(ME)).rev;
  await sp.saveSetup(ME, { rev: staleRev, templates: { ...shared.DEFAULT_TEMPLATES, facebook: 'both {hook}' }, url: 'tabone.app', hashtags: '#one' });
  const tabTwo = await sp.saveSetup(ME, { rev: staleRev, templates: { ...shared.DEFAULT_TEMPLATES, facebook: 'tab two' }, url: 'tabtwo.app', hashtags: '#two' });
  ok(tabTwo.stale && (await sp.getApp(ME)).domain === 'tabone.app' && (await sp.getTemplates(ME)).facebook === 'both {hook}', 'a second tab with an older copy of the settings is refused, never overwrites');
  ok(/onStale=\{\(\) => void loadSettings\(\)\}/.test(fs.readFileSync('src/components/scheduled-posts-view.tsx', 'utf8')), 'a refused settings save reloads the latest, keeping the form');
  const oldPost = (await sp.createPosts(ME, [{ ...item, targets: ['instagram'], captions: { instagram: 'a' } }], T0)).posts[0];
  const oldRow = store.tables.scheduled_posts.find((r) => r.id === oldPost.id);
  oldRow.at = new Date(T0 - 400 * 86400e3).toISOString();
  ok((await sp.updatePost(ME, oldPost.id, { rev: oldRow.updated_at, at: oldRow.at, targets: ['instagram'], captions: { instagram: 'a' }, marks: { instagram: { posted: true, views: '50' } } }, T0)).post?.result.instagram.views === 50, 'a post over a year old still takes views and links (its time unchanged)');
  ok((await sp.updatePost(ME, oldPost.id, { rev: oldRow.updated_at, at: new Date(T0 - 500 * 86400e3).toISOString(), targets: ['instagram'], captions: { instagram: 'a' } }, T0)).error, 'moving a post outside the window is still refused');
  ok(/at: sameWhen \? post\.at/.test(fs.readFileSync('src/components/scheduled-posts-view.tsx', 'utf8')), 'an untouched day and time keep the exact moment (clock changes)');
  ok((await sp.saveSetup(ME, { templates: shared.DEFAULT_TEMPLATES, url: 'blind.app' })).error && (await sp.getApp(ME)).domain !== 'blind.app', 'a settings save without its revision is refused (no blind overwrite)');
  eq(await sp.claimAnalysis(ME, T0 + 4 * 86400e3, 'old-rev'), 'stale', 'Analyze from an out-of-date dialog: refused before using a run');
  ok(typeof (await sp.claimAnalysis(ME, T0 + 4 * 86400e3, (await sp.getSetup(ME)).rev)) === 'string', 'Analyze from an up-to-date dialog: claimed');
  const appRoute = fs.readFileSync('src/app/api/posts/app/route.ts', 'utf8');
  ok(/claimAnalysis\(user\.who, Date\.now\(\), rev\)/.test(appRoute) && /status: 409/.test(appRoute) && /JSON\.stringify\(\{ url, rev: currentRev \}\)/.test(fs.readFileSync('src/components/scheduled-posts-view.tsx', 'utf8')), 'the dialog sends its revision with Analyze; out of date is a 409');
  eq(shared.postLink('instagram', 'https://www.instagram.com/mayagrace180/'), null, 'an Instagram profile is not a post');
  eq(shared.postLink('tiktok', 'https://www.tiktok.com/@maya'), null, 'a TikTok profile is not a post');
  ok(shared.postLink('tiktok', 'https://vm.tiktok.com/ZMabc123/') && shared.postLink('instagram', 'https://www.instagram.com/p/Cabc_12/') && shared.postLink('facebook', 'https://www.facebook.com/SummerViola/videos/123456/'), 'short links and every usual post address pass');
  eq(shared.postLink('facebook', 'https://www.facebook.com/settings'), null, 'a Facebook settings page is not a post');
  for (const bad of ['https://www.facebook.com/watch/', 'https://www.facebook.com/reels/', 'https://www.facebook.com/story.php', 'https://fb.watch/']) eq(shared.postLink('facebook', bad), null, `not one post: ${bad}`);
  for (const good of ['https://www.facebook.com/watch/?v=123', 'https://www.facebook.com/reel/987', 'https://www.facebook.com/share/r/1AbC/', 'https://fb.watch/abC1/', 'https://www.facebook.com/story.php?story_fbid=55&id=1']) ok(shared.postLink('facebook', good), `a Facebook post: ${good}`);
  const viewR3 = fs.readFileSync('src/components/scheduled-posts-view.tsx', 'utf8');
  ok(/status === 409\) onStale\(\)/.test(viewR3) && /onStale=\{\(\) => void load\(\)\}/.test(viewR3), 'a 409 reloads the calendar, so reopening shows the latest copy');
  ok((viewR3.match(/disabled=\{busy === "analyze"\}/g) ?? []).length === 2, 'the link and hashtags are locked while Analyze runs');
  ok(/getSetup\(user\.who\)/.test(fs.readFileSync('src/app/api/posts/templates/route.ts', 'utf8')), 'templates and app load from one read');
  const two = (await sp.createPosts(ME, [{ ...item, targets: ['instagram'], captions: { instagram: 'a' } }], T0)).posts[0];
  store.tables.scheduled_posts.find((r) => r.id === two.id).updated_at = '2026-11-26T10:00:00.000Z';
  const tabA = (await sp.listPosts(ME, new Date(T0 - 2 * 86400e3).toISOString(), new Date(T0 + 1).toISOString())).find((p) => p.id === two.id);
  ok((await sp.updatePost(ME, two.id, { at: item.at, targets: ['instagram'], captions: { instagram: 'tab A' }, rev: tabA.updatedAt }, T0)).post, 'tab A saves');
  const stale = await sp.updatePost(ME, two.id, { at: item.at, targets: ['instagram'], captions: { instagram: 'tab B' }, rev: tabA.updatedAt }, T0);
  ok(/changed/.test(stale.error ?? '') && store.tables.scheduled_posts.find((r) => r.id === two.id).captions.instagram === 'tab A', 'tab B, opened before A saved: refused, A\'s edit kept');
  ok(/rev: post\.updatedAt/.test(fs.readFileSync('src/components/scheduled-posts-view.tsx', 'utf8')), 'the page sends the revision it opened');
  const viewSrc = fs.readFileSync('src/components/scheduled-posts-view.tsx', 'utf8');
  ok(/onChange=\{pickTargets\}/.test(viewSrc) && /captionFor\(x, templates\[x\], post\.hook, app\)/.test(viewSrc), 'a platform added to a post starts from its caption format');

  // Helpers still used by the planner.
  const spreadT = [T0 + 1e6, T0 + 2e6, T0 + 3e6];
  eq(shared.finalTimes(['a', 'b', 'c'], spreadT, { b: T0 + 9e6 }), [T0 + 1e6, T0 + 9e6, T0 + 3e6], 'a hand-set time replaces only that video\'s time');
  eq(shared.finalTimes(['a', 'b'], spreadT, { a: null }), [null, T0 + 2e6], 'a time box cleared by hand stays empty');
  const many = shared.randomSlots(40, 9 * 60, 22 * 60, shared.seeded(11));
  ok(many.length === 40 && many.slice(1).every((t, i) => t - many[i] >= shared.MIN_GAP), 'spread: at least 1.5 hours apart');
  eq(shared.randomSlots(5, 540, 1320, shared.seeded(3)), shared.randomSlots(5, 540, 1320, shared.seeded(3)), 'same seed, same times (the screen doesn\'t jump)');
  const texts = [{ id: 'b', text: 'how tf did i get ', start: 0, end: 2.4, y: 73.8, x: 50 }, { id: 'hook', text: 'WAIT...', start: 0, end: 2.4, y: 67.2, x: 50 }, { id: 'd', text: 'pick AI face', start: 5.5, end: 7.2, y: 20, x: 50 }];
  eq(shared.hookWords(texts, { start: 0, end: 2.672 }), 'WAIT... how tf did i get', 'the caption hook is the video\'s own on-screen hook text');
  eq(shared.draftCaptions(['v'], () => 'hi', ['tiktok'], shared.DEFAULT_TEMPLATES, app, { v: { tiktok: 'edited' } }).v.tiktok, 'edited', 'an edited caption is kept on the review screen');

  // Wiring.
  const serverSrc = fs.readFileSync('src/lib/server/scheduled-posts.ts', 'utf8');
  ok(!/graph\.facebook\.com|rupload|META_PAGE_TOKEN|media_publish/.test(serverSrc), 'no auto-posting left (founder: "not useful")');
  ok(!fs.existsSync('src/lib/posts-access.ts') && !fs.existsSync('src/lib/posts-nav.ts'), 'the owner-only gate is gone');
  const nav = load('src/components/nav-links.tsx', { '@/components/pending-link': {}, 'next/navigation': {}, 'lucide-react': {}, 'react/jsx-runtime': { jsx() {}, jsxs() {}, Fragment: {} } });
  eq(nav.NAV.map((i) => i.href), ['/studio', '/guides', '/posts', '/settings'], 'every account: Videos, Guides, Content calendar, Settings (no Viral library: Browse hooks inside a video does the same)');
  eq(nav.NAV[2].label, 'Content calendar', 'named Content calendar');
  eq(nav.NAV[1].label, 'Guides', 'Guides sits under Videos, above Content calendar (founder 2026-11-26)');
  const guides = load('src/lib/guides.ts');
  ok(guides.GUIDES.every((g) => g.steps.length && g.steps.every((s) => s.image.startsWith('/guides/') && fs.existsSync('public' + s.image) && s.alt && s.text)), 'every guide step has its screenshot on disk, alt text and words');
  ok(guides.GUIDES.flatMap((g) => g.steps).filter((s) => s.video).length >= 7 && guides.GUIDES.flatMap((g) => g.steps).every((s) => !s.video || (fs.existsSync('public' + s.video) && fs.statSync('public' + s.video).size < 2e6)), 'guides show real-app clips (founder: stills "look shit"), each on disk and small');
  const gv = fs.readFileSync('src/components/guides-view.tsx', 'utf8');
  ok(/muted loop playsInline/.test(gv) && /v\.play\(\)/.test(gv), 'clips play by themselves, muted and looping (browsers only autoplay muted video)');
  ok(/prefers-reduced-motion: reduce/.test(gv) && /aria-label=\{paused \? `Play: \$\{label\}` : `Pause: \$\{label\}`\}/.test(gv), 'clips can be paused by click or keyboard, and start paused with reduce motion on');
  ok(/"\/guides\/:path\*"/.test(fs.readFileSync('src/proxy.ts', 'utf8')) && /APP_PAGES = \[[^\]]*"\/guides"/.test(fs.readFileSync('src/lib/supabase/session.ts', 'utf8')), 'Guides sits behind sign-in and the plan gate like the rest of the app');
  ok(!/[—–]/.test(fs.readFileSync('src/lib/guides.ts', 'utf8')), 'no em or en dashes in the guide copy');
  ok(fs.existsSync('src/app/(app)/library/page.tsx'), 'the library page stays, so old links still work');
  const setupSrc = fs.readFileSync('src/components/scheduled-posts-view.tsx', 'utf8');
  ok(/role="tablist" aria-label="Platform"/.test(setupSrc) && (setupSrc.match(/aria-label=\{`\$\{NAMES\[tab\]\} caption format`\}/g) ?? []).length === 1, 'captions: one platform at a time in tabs, not four boxes at once (founder: "too congested")');
  ok(/onPaste=\{\(e\) => \{ e\.preventDefault\(\); addTags\(`\$\{draft\} \$\{e\.clipboardData\.getData\("text"\)\}`\); \}\}/.test(setupSrc), 'hashtags pasted on separate lines stay separate tags, and a half-typed tag is kept');
  ok(/aria-label=\{`Remove \$\{h\}`\}/.test(setupSrc) && /\[field-sizing:content\]/.test(setupSrc), 'hashtags show as removable chips, all visible; the caption box grows with its text (founder: scrollbars)');
  eq(shared.tagList('#indie\n#saas, b2b'), ['#indie', '#saas', '#b2b'], 'tags on separate lines or with commas stay separate');
  ok((setupSrc.match(/role="tablist" aria-label="Platform"/g) ?? []).length === 2 && /<CaptionBox t=\{active\} rows=\{9\}/.test(setupSrc), 'the opened post: one platform at a time in tabs, one big caption box (founder: four stacked boxes "looks shit")');
  ok(/type="datetime-local" value=\{when\}/.test(setupSrc) && !/type="time" value=\{time\}/.test(setupSrc), 'the opened post: one When field, not a cramped day + time pair');
  const session = fs.readFileSync('src/lib/supabase/session.ts', 'utf8');
  ok(/APP_PAGES = \[[^\]]*"\/posts"/.test(session) && /\\\/api\\\/posts\(\\\/\|\$\)/.test(session), 'the page and its API sit behind the paid-plan gate like the rest of the app');
  ok(!/isPostsPage|schedulerAllowed/.test(session) && !/scheduler/.test(fs.readFileSync('src/app/api/profile/route.ts', 'utf8')), 'no owner-only 404 or profile flag left');
  const analyzer = fs.readFileSync('src/app/api/posts/app/route.ts', 'utf8');
  const gate = analyzer.indexOf('subscriptionOf(user.who)'), ai = analyzer.indexOf('await geminiJSON');
  ok(gate > 0 && ai > gate && analyzer.indexOf('claimAnalysis') < ai && /status: 402/.test(analyzer), 'the analyzer checks the plan and the daily limit before any AI call (no free AI)');
  ok(/`https:\/\/\$\{parsed\.hostname\}\$\{parsed\.pathname\}`/.test(analyzer), 'only the site address reaches the prompt');
  const view = fs.readFileSync('src/components/scheduled-posts-view.tsx', 'utf8');
  ok((view.match(/<ThumbImg /g) ?? []).length === 3 && (view.match(/<video /g) ?? []).length === 1 && /<video [^>]*preload="none"/.test(view), 'lists show still pictures; the only video is the opened post, loaded when played');
  ok(/<CopyButton text=\{value\}/.test(view) && /Download video/.test(view), 'each caption has Copy; the post has Download');
  ok(!/Scheduled posts|Posting now|Retry|trial reel/i.test(view), 'no auto-posting words left on the page');
  ok(!/[—–]/.test(view + fs.readFileSync('src/lib/scheduled-posts.ts', 'utf8')), 'no em or en dashes in the copy');
});
