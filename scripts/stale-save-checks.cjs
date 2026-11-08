// Demo captions survive (founder 2026-11-08: "whatever is in demo the subtitle must stay other than someone explicitly
// deleting them or replacing the clip"). Five demo captions vanished after a hook change: an older copy of the video
// saved its whole caption list over the new one. Checks:
//  1. the server refuses an editor save made from an older copy (409) and keeps the newer captions;
//  2. the browser's save queue sends the version it is based on, moves it on, and on a refusal sends nothing more
//     from that copy and asks the page to load the latest;
//  3. every hook action (swap, pick from My files, trim, cut, delete a piece, speed, magnet on or off) keeps every
//     demo caption, its words, and its place on its own clip; the founder's exact steps are replayed.
// Offline; no browser, no database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 122;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.equal(a, b, msg); };
const near = (a, b, msg, tol = 0.002) => { checks++; assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); };
const plain = (x) => JSON.parse(JSON.stringify(x));

const version = load('src/lib/edit-version.ts');
const adjust = load('src/lib/adjust.ts');

// ---------- browser globals for client.ts ----------
const events = [];
let fetchImpl = null;
const sent = [];
const fakeWindow = { addEventListener() {}, dispatchEvent(e) { events.push(e); return true; } };
class FakeEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
const client = load('src/lib/client.ts', { '@/lib/studio-data': { DEFAULT_FONT: 'TikTok Sans' }, '@/lib/edit-version': version }, {}, {
  window: fakeWindow, CustomEvent: FakeEvent,
  fetch: (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return fetchImpl(url, init); },
});
const edit = load('src/lib/edit.ts', { '@/lib/adjust': adjust });
const sound = load('src/lib/sound.ts');
const ops = load('src/lib/edit-ops.ts', { '@/lib/adjust': adjust, '@/lib/client': client, '@/lib/edit': edit, '@/lib/sound': sound });
const validation = load('src/lib/server/run-validation.ts', { '@/lib/client': client });

// ---------- the server route, on an in-memory store ----------
const USER = 'u1';
let stored = null;
/** Another copy's save landing between the route's first check and the write. */
let raceVersion = null;
const store = {
  getRun: async (id, who) => (stored && stored.id === id && who === USER ? plain(stored) : null),
  getReference: async () => null,
  updateRun: async (id, patch) => { stored = { ...stored, ...plain(patch), updatedAt: new Date().toISOString() }; return plain(stored); },
  // As migration 0019 does under the row lock (tested on Postgres in edit-version-sql-checks.mjs).
  updateRunChecked: async (id, patch, who, base, save, mine) => {
    if (raceVersion) { stored.editVersion = raceVersion; raceVersion = null; }
    if (version.staleEdit(stored.editVersion, base, stored.editSave, mine)) return { stale: true, byGeneration: version.byGeneration(stored, base) };
    const clean = plain(patch); delete clean.editVersion; delete clean.editSave; delete clean.editPrev;
    stored = { ...stored, ...clean, editVersion: crypto.randomUUID(), editSave: version.saveIdOf(save), editPrev: null, updatedAt: new Date().toISOString() };
    return plain(stored);
  },
  deleteRun: async () => {},
};
const route = load('src/app/api/runs/[id]/route.ts', {
  '@/lib/server/store': store,
  '@/lib/server/run-validation': validation,
  '@/lib/server/who': { currentUser: async () => USER, signInFirst: () => new Response('', { status: 401 }) },
  '@/lib/edit': edit,
  '@/lib/client': client,
  '@/lib/edit-version': version,
}, {}, { crypto: globalThis.crypto });
const RUN_ID = '11111111-2222-3333-4444-555555555555';
const ctx = { params: Promise.resolve({ id: RUN_ID }) };
const patch = (body) => route.PATCH(new Request('http://x/api/runs/' + RUN_ID, { method: 'PATCH', body: JSON.stringify(body) }), ctx);

// ---------- a video like the founder's: a 5.041 s generated hook and seven demo clips ----------
const A = (speed) => ({ flip: false, keys: [], panX: 0, panY: 0, zoom: 0, speed, volume: 100, warmth: 0, contrast: 0, brightness: 0, saturation: 0 });
const clip = (id, start, end, seconds, speed = 1) => ({ id, label: id, name: id + '.mov', mediaId: `${id}0000-0000-0000-0000-000000000000.mov`, seconds, start, end, parts: [{ id: id + 'p', start, end }], adjust: A(speed) });
const DEMO = { mode: 'clips', clips: [clip('c1', 0, 2.225, 3.666), clip('c2', 2.248, 4.303, 6.298), clip('c3', 5.141, 8.184, 9.498), clip('c4', 8.309, 9.814, 13.531), clip('c5', 3.382, 5.4, 5.4), clip('c6', 2.408, 5.24, 6.765, 1.1), clip('c7', 0.678, 2.868, 3.365)] };
const T = (id, text, start, end) => ({ id, text, start, end, x: 50, y: 50, size: 4, font: 'TikTok Sans', color: '#fff', style: 'outline' });
function baseRun() {
  const r = { id: RUN_ID, title: 'v', createdAt: 'x', updatedAt: 'x', sourceRefId: null, hook: { mode: 'upload', text: 'my app had only 4 users', clip: null, avatarIndex: null, variationIndex: null, start: 0, end: 2.393, parts: [{ id: 'hp', start: 0, end: 2.393 }], adjust: A(1.1), generated: { src: '/api/media/00000000-0000-0000-0000-00000000000a.mp4', seconds: 2.93, at: 'a' } }, demo: plain(DEMO), texts: [] };
  const s = edit.timeline(r, null);
  r.texts = [T('hook', r.hook.text, 0, s[0].len), T('then', '...then i did this', 0, s[0].len),
    ...s.slice(1).map((seg, i) => T('d' + (i + 1), ['my insta reels had no views', 'browse viral reels on mavya.app', 'select your hook', 'select your AI', 'AI will recreate the viral hook', 'copy viral script + upload app demo clips', 'post on insta and go viral'][i], seg.offset + 0.1, seg.offset + seg.len - 0.1))];
  return r;
}
/** Each demo caption's clip and distance from that clip's start. */
function demoPlaces(r) {
  const segs = edit.timeline(r, null);
  return Object.fromEntries(client.runTexts(r).filter((t) => t.id.startsWith('d')).map((t) => {
    const seg = segs.find((s) => s.id !== 'hook' && t.start >= s.offset - 0.001 && t.start < s.offset + s.len);
    return [t.id, { text: t.text, clip: seg ? seg.id : null, at: seg ? t.start - seg.offset : NaN, len: t.end - t.start }];
  }));
}
function keepsDemo(before, after, what) {
  const a = demoPlaces(before), b = demoPlaces(after);
  ok(Object.keys(a).length === 7 && Object.keys(b).length === 7, `${what}: all 7 demo captions still there (${Object.keys(b).length})`);
  ok(Object.keys(a).every((k) => b[k] && b[k].text === a[k].text && b[k].clip === a[k].clip && Math.abs(b[k].at - a[k].at) < 0.002 && Math.abs(b[k].len - a[k].len) < 0.002), `${what}: each on the same clip, same words, same place and length`);
}
// The editor's hook actions, as run-view.tsx makes them (applyGenerated, pickHook, the speed slider).
function swapGenerated(r, seconds, nextSpeed, blankText) {
  const segs = edit.timeline(r, null);
  const sp = adjust.speedOf(r.hook.adjust);
  const moved = edit.retimeTexts(client.runTexts(r), 0, { start: 0, end: segs[0].len * sp, speed: sp }, { start: 0, end: seconds, speed: nextSpeed });
  return { ...r, hook: { ...r.hook, adjust: A(nextSpeed), generated: { src: '/api/media/00000000-0000-0000-0000-00000000000b.mp4', seconds, at: 'b' }, start: 0, end: seconds, parts: undefined, text: blankText ? '' : r.hook.text }, texts: moved.map((t) => (t.id === 'hook' && blankText ? { ...t, text: '' } : t)) };
}
function setSpeed(r, after) {
  const seg = edit.timeline(r, null)[0];
  const before = adjust.speedOf(r.hook.adjust);
  const next = { ...r, hook: { ...r.hook, adjust: A(after) } };
  const texts = edit.remapTexts(client.runTexts(r), seg.offset, { parts: seg.parts, speed: before }, { parts: seg.parts, speed: after });
  return { ...next, texts: edit.containTexts(texts, edit.timeline(next, null)) };
}
const hookParts = (r) => edit.timeline(r, null)[0].parts;
const withParts = (r, parts, hold = false) => ({ ...r, ...ops.partsChange(r, null, 'hook', parts, hold) });

finish('stale-save-checks', EXPECTED, () => checks, async () => {
  // ---- 1. edit-version rules ----
  ok(version.touchesEdit({ texts: [] }) && version.touchesEdit({ hook: {} }) && version.touchesEdit({ demo: {} }) && version.touchesEdit({ sounds: [] }) && version.touchesEdit({ sound: null }), 'captions, hook, demo and sounds are editor saves');
  ok(!version.touchesEdit({ title: 'x' }) && !version.touchesEdit({ productNotes: 'x' }), 'a rename or product note is not');
  ok(!version.staleEdit(undefined, null) && !version.staleEdit(undefined, 'v1'), 'a video with no version yet takes any save');
  ok(!version.staleEdit('v2', 'v2'), 'a save from the current version is taken');
  ok(version.staleEdit('v2', 'v1'), 'a save from an older version is refused');
  ok(version.staleEdit('v2', undefined) && version.staleEdit('v2', null), 'a save that names no version is refused once the video has one');

  // ---- 2. the server: two copies of the same video ----
  stored = baseRun();
  let res = await patch({ texts: stored.texts, base: null });
  eq(res.status, 200, 'first editor save on a video with no version is taken');
  const v1 = stored.editVersion;
  ok(typeof v1 === 'string' && v1.length > 10, 'the save gives the video a version');
  eq((await res.json()).editVersion, v1, 'the reply carries the new version');
  // Copy A and copy B both load v1. B adds nothing but removes nothing either; A deletes nothing. B saves first.
  const fresh = stored.texts.slice(0, 3);
  res = await patch({ texts: stored.texts, base: v1 });
  eq(res.status, 200, 'copy B saves from v1');
  const v2 = stored.editVersion;
  ok(v2 !== v1, 'each editor save moves the version on');
  res = await patch({ texts: fresh, hook: stored.hook, base: v1 });
  eq(res.status, 409, 'copy A, still on v1, is refused');
  eq((await res.json()).stale, true, 'the refusal says the copy is out of date');
  eq(stored.texts.length, 9, 'the refused save removed no caption');
  eq(stored.editVersion, v2, 'the refused save left the version alone');
  res = await patch({ texts: fresh });
  eq(res.status, 409, 'a page from before versions (sends none) cannot overwrite either');
  eq(stored.texts.length, 9, 'still all 9 captions');
  // Two copies on the same version at the same moment: the route's first check passes, the locked write refuses.
  raceVersion = 'landed-first';
  res = await patch({ texts: fresh, base: v2 });
  eq(res.status, 409, 'a save racing another copy is refused at the write');
  eq(stored.texts.length, 9, 'and removes no caption');
  stored.editVersion = v2;
  res = await patch({ title: 'renamed' });
  eq(res.status, 200, 'a rename from any copy still works (it writes no captions)');
  eq(stored.editVersion, v2, 'a rename does not move the version');
  res = await patch({ texts: stored.texts.filter((t) => t.id !== 'd3'), base: v2 });
  eq(res.status, 200, 'an explicit delete from the current copy is taken');
  eq(stored.texts.length, 8, 'and removes just that caption');

  // ---- 3. the browser save queue ----
  stored = baseRun();
  stored.editVersion = 'srv-1';
  fetchImpl = async (url, init) => route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
  client.setEditVersion(RUN_ID, 'srv-1');
  sent.length = 0;
  let saved = await client.patchRun(RUN_ID, { texts: stored.texts });
  eq(sent[0].body.base, 'srv-1', 'an editor save sends the version the page loaded');
  ok(saved && saved.editVersion && saved.editVersion !== 'srv-1', 'the server moved it on');
  saved = await client.patchRun(RUN_ID, { texts: stored.texts });
  ok(sent[1].body.base !== 'srv-1', 'the next save is based on the version the last save made, not the old one');
  ok(!('base' in (await (async () => { sent.length = 0; await client.patchRun(RUN_ID, { title: 'x' }); return sent[0].body; })())), 'a rename sends no version');
  // Another copy saves meanwhile: this page's next save is refused, nothing else from it is sent, the page is told.
  stored.editVersion = 'other-copy';
  const keepTexts = plain(stored.texts);
  sent.length = 0; events.length = 0;
  const refused = client.patchRun(RUN_ID, { texts: [] });
  await client.waitRunSaves(RUN_ID);
  eq(await refused, null, 'the save from the old copy comes back refused');
  eq(JSON.stringify(stored.texts), JSON.stringify(keepTexts), 'the newer captions on the server are untouched');
  eq(events.length, 1, 'the page is told once');
  eq(events[0].type, client.STALE_RUN_EVENT, 'with the stale-video event');
  eq(events[0].detail, RUN_ID, 'naming this video');
  eq(client.saveStateOf(RUN_ID), 'idle', 'no error label left behind');
  await new Promise((r) => setTimeout(r, 3300));
  eq(sent.length, 1, 'a refused save is never retried');
  // Edits queued from the old copy while the refused save was in flight are dropped, not sent.
  client.setEditVersion(RUN_ID, 'reloaded');
  fetchImpl = async () => { await new Promise((r) => setTimeout(r, 300)); return new Response(JSON.stringify({ error: version.STALE_MESSAGE, stale: true }), { status: 409 }); };
  sent.length = 0; events.length = 0;
  const first = client.patchRun(RUN_ID, { texts: [] });
  client.flushRunSaves();
  const queued = client.patchRun(RUN_ID, { texts: [T('x', 'x', 0, 1)] });
  eq(await first, null, 'refused');
  eq(await queued, null, 'the edit queued behind it is dropped too');
  await new Promise((r) => setTimeout(r, 600));
  eq(sent.length, 1, 'only the refused request went out');
  // While the latest version loads, edits from the old copy are dropped, never sent later under the new version.
  sent.length = 0;
  eq(await client.patchRun(RUN_ID, { texts: [T('late', 'late', 0, 1)] }), null, 'an edit from the refused copy is dropped');
  await new Promise((r) => setTimeout(r, 400));
  eq(sent.length, 0, 'and never sent');
  fetchImpl = async (url, init) => route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
  sent.length = 0;
  ok((await client.patchRun(RUN_ID, { title: 'renamed again' })) !== null, 'a rename still goes through meanwhile');
  stored.editVersion = 'latest';
  client.setEditVersion(RUN_ID, 'latest');
  sent.length = 0;
  ok((await client.patchRun(RUN_ID, { texts: stored.texts })) !== null && sent[0].body.base === 'latest', 'once the latest version is loaded, edits save again, based on it');
  // A generated hook lands (its version comes with the result). Every save this page had not sent is cancelled; the
  // page saves its merged state again (checked below). Codex 2026-11-08 repro: an editor save waiting behind a slow
  // rename must not go out with the new version.
  {
    let release = null;
    fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.title) await new Promise((r) => { release = r; });
      return route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
    };
    stored.editVersion = 'before-gen';
    client.setEditVersion(RUN_ID, 'before-gen');
    sent.length = 0; events.length = 0;
    const rename = client.patchRun(RUN_ID, { title: 'slow rename' });
    client.flushRunSaves();
    await new Promise((r) => setTimeout(r, 20));
    const oldEdit = client.patchRun(RUN_ID, { hook: stored.hook, texts: [] });
    client.flushRunSaves();
    const queued = client.patchRun(RUN_ID, { texts: [] });
    ok(['title', 'hook', 'texts'].every((k) => client.unsavedSections(RUN_ID).has(k)), 'unsaved sections include what is in flight, waiting and queued');
    stored.editVersion = 'gen-done';
    client.adoptGeneratedVersion(RUN_ID, 'gen-done');
    release();
    await Promise.all([rename, oldEdit, queued]);
    await new Promise((r) => setTimeout(r, 400));
    ok(sent.length === 1 && sent[0].body.title === 'slow rename', 'only the rename already on its way went out; the old hook and captions never did');
    eq(stored.texts.length, 9, 'captions kept');
    eq(events.length, 0, 'no reload');
  }
  {
    // A save already on its way when the hook landed, refused by the server: dropped quietly, no reload, no lockout.
    let release = null;
    fetchImpl = async (url, init) => { await new Promise((r) => { release = r; }); return route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx); };
    stored.editVersion = 'v-a';
    client.setEditVersion(RUN_ID, 'v-a');
    sent.length = 0; events.length = 0;
    const onWay = client.patchRun(RUN_ID, { texts: stored.texts });
    client.flushRunSaves();
    await new Promise((r) => setTimeout(r, 20));
    stored.editVersion = 'v-gen';
    client.adoptGeneratedVersion(RUN_ID, 'v-gen');
    release();
    eq(await onWay, null, 'refused');
    eq(events.length, 0, 'quietly: no reload');
    fetchImpl = async (url, init) => route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
    sent.length = 0;
    ok((await client.patchRun(RUN_ID, { texts: stored.texts })) !== null && sent[0].body.base === 'v-gen', 'the next save goes out on the generation\'s version');
  }
  {
    // A save the server took just before the hook landed answers after it: the newer version stays.
    let release = null;
    fetchImpl = async (url, init) => { const res = await route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx); await new Promise((r) => { release = r; }); return res; };
    stored.editVersion = 'v-b';
    client.setEditVersion(RUN_ID, 'v-b');
    const early = client.patchRun(RUN_ID, { texts: stored.texts });
    client.flushRunSaves();
    await new Promise((r) => setTimeout(r, 20));
    stored.editVersion = 'v-gen2';
    client.adoptGeneratedVersion(RUN_ID, 'v-gen2');
    release();
    await early;
    fetchImpl = async (url, init) => route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
    sent.length = 0;
    await client.patchRun(RUN_ID, { texts: stored.texts });
    eq(sent[0].body.base, 'v-gen2', 'a late answer does not roll the version back');
  }
  {
    // The server writes a save but its answer is lost (network): the retry, 3 s later, still has the old version. It
    // names the unanswered save, so the server knows the newer version came from this page: taken, no reload.
    let lose = true;
    fetchImpl = async (url, init) => {
      const res = await route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
      if (lose) { lose = false; throw new TypeError('network'); }
      return res;
    };
    stored.editVersion = 'v-net';
    client.setEditVersion(RUN_ID, 'v-net');
    sent.length = 0; events.length = 0;
    await client.patchRun(RUN_ID, { texts: stored.texts });
    ok(stored.editVersion !== 'v-net' && stored.editSave === sent[0].body.save, 'the server wrote the save whose answer was lost');
    await new Promise((r) => setTimeout(r, 3400));
    await client.waitRunSaves(RUN_ID);
    ok(sent.length === 2 && sent[1].body.base === 'v-net' && sent[1].body.mine.includes(sent[0].body.save), 'the retry names the unanswered save');
    ok(stored.editSave === sent[1].body.save && events.length === 0, 'and is taken: no false reload');
    sent.length = 0;
    await client.patchRun(RUN_ID, { texts: stored.texts });
    eq(sent[0].body.mine.length, 0, 'once answered, no save is named any more');
    // Another copy cannot borrow this: it names no save of this page.
    const beforeCopy = stored.editVersion;
    const r = await patch({ texts: [], base: 'v-net', save: 'x', mine: ['not-this-page'] });
    eq(r.status, 409, 'an older copy is still refused');
    eq(stored.editVersion, beforeCopy, 'and changes nothing');
  }
  {
    // Refused while a hook is generating: the generation moved the version on; the page waits for its result rather
    // than reloading, and saves the refused edits again on the new version.
    fetchImpl = async (url, init) => route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
    client.setEditVersion(RUN_ID, 'mine-old');
    // What a finished generation leaves (migration 0019): a new version, no save id, the version it followed.
    stored.editVersion = 'gen-moved'; stored.editSave = null; stored.editPrev = 'mine-old';
    events.length = 0; sent.length = 0;
    await client.patchRun(RUN_ID, { texts: stored.texts, sounds: [] });
    eq(events.length, 1, 'the page is told about the refusal');
    ok(client.refusedByGeneration(RUN_ID), 'and that the generation alone moved the version on');
    const lost = client.takeRefusedSections(RUN_ID);
    ok(lost.has('texts') && lost.has('sounds'), 'with the sections that were not saved');
    eq(client.takeRefusedSections(RUN_ID).size, 0, 'handed over once');
    eq(await client.patchRun(RUN_ID, { texts: [] }), null, 'edits wait meanwhile');
    client.adoptGeneratedVersion(RUN_ID, 'gen-moved');
    sent.length = 0;
    ok((await client.patchRun(RUN_ID, { texts: stored.texts })) !== null && sent[0].body.base === 'gen-moved', 'the generation\'s result lets edits save again');
  }
  {
    // Codex 2026-11-08: another tab saved while this page was generating. Its refusal is not the generation's, so the
    // page reloads instead of saving its old captions over the other tab's.
    fetchImpl = async (url, init) => route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
    client.setEditVersion(RUN_ID, 'mine-3');
    stored.editVersion = 'other-tab'; stored.editSave = 'other-tab-save'; stored.editPrev = null;
    events.length = 0;
    await client.patchRun(RUN_ID, { texts: [] });
    ok(events.length === 1 && !client.refusedByGeneration(RUN_ID), 'another tab\'s save is not taken for the generation');
    stored.editVersion = 'gen-after-other'; stored.editSave = null; stored.editPrev = 'other-tab';
    client.setEditVersion(RUN_ID, 'mine-3');
    events.length = 0;
    await client.patchRun(RUN_ID, { texts: [] });
    ok(events.length === 1 && !client.refusedByGeneration(RUN_ID), 'nor a generation that followed another tab\'s save');
    eq(stored.texts.length, 9, 'the other tab\'s captions stay');
    client.setEditVersion(RUN_ID, stored.editVersion);
  }
  {
    // Codex 2026-11-08: a save waiting behind the refused one is dropped after the refusal was reported; its sections
    // must still be there when the generated hook arrives.
    let release = null;
    fetchImpl = async (url, init) => { const body = JSON.parse(init.body); if (body.texts) await new Promise((r) => { release = r; }); return route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx); };
    client.setEditVersion(RUN_ID, 'old-2');
    stored.editVersion = 'moved-2';
    events.length = 0;
    const first = client.patchRun(RUN_ID, { texts: stored.texts });
    client.flushRunSaves();
    await new Promise((r) => setTimeout(r, 20));
    const second = client.patchRun(RUN_ID, { sounds: [] });
    client.flushRunSaves();
    release();
    await Promise.all([first, second]);
    await new Promise((r) => setTimeout(r, 50));
    const all = client.takeRefusedSections(RUN_ID);
    ok(events.length === 1 && all.has('texts') && all.has('sounds'), 'the save dropped after the refusal is kept for saving again too');
    client.setEditVersion(RUN_ID, 'moved-2');
  }
  {
    // The answer arrives but its body is lost while reading: the save was written, so its id is still named.
    let lose = true;
    fetchImpl = async (url, init) => {
      const res = await route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
      if (lose) { lose = false; return { ok: true, status: 200, json: async () => { throw new TypeError('body lost'); } }; }
      return res;
    };
    stored.editVersion = 'v-body';
    client.setEditVersion(RUN_ID, 'v-body');
    sent.length = 0; events.length = 0;
    await client.patchRun(RUN_ID, { texts: stored.texts });
    await new Promise((r) => setTimeout(r, 3400));
    await client.waitRunSaves(RUN_ID);
    ok(sent.length === 2 && sent[1].body.mine.includes(sent[0].body.save) && events.length === 0 && stored.editSave === sent[1].body.save, 'a reply lost while reading still lets the retry through');
  }
  {
    // Codex 2026-11-08: the generated hook arrives before any refusal. Taken only if it followed this page's version or
    // one of its own saves; if another tab saved in between, the page must load the latest instead.
    fetchImpl = async (url, init) => route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
    stored.editVersion = 'base-g'; stored.editSave = 'x'; stored.editPrev = null;
    client.setEditVersion(RUN_ID, 'base-g');
    ok(client.generationFollows(RUN_ID, { editSave: null, editPrev: 'base-g', editPrevSave: 'x' }), 'a generation right after this page\'s version is taken');
    ok(!client.generationFollows(RUN_ID, { editSave: null, editPrev: 'other-tab-version', editPrevSave: 'other-tab-save' }), 'one after another tab\'s save is not');
    ok(!client.generationFollows(RUN_ID, { editSave: 'someone', editPrev: 'base-g', editPrevSave: null }), 'nor a version someone saved after the generation');
    sent.length = 0;
    await client.patchRun(RUN_ID, { texts: stored.texts });
    const mySave = sent[0].body.save;
    ok(client.generationFollows(RUN_ID, { editSave: null, editPrev: 'whatever-my-save-made', editPrevSave: mySave }), 'one right after this page\'s own save is taken even before its answer');
    client.setEditVersion(RUN_ID, null);
    ok(client.generationFollows(RUN_ID, { editSave: null, editPrev: null, editPrevSave: null }), 'a video from before versions does not reload after its first generation');
    client.setEditVersion(RUN_ID, stored.editVersion);
  }
  {
    // Abandoning the copy (a generated hook followed another tab): everything queued or waiting is cancelled and
    // nothing goes out later under the version the reload brings.
    let release = null;
    fetchImpl = async (url, init) => { const body = JSON.parse(init.body); if (body.title) await new Promise((r) => { release = r; }); return route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx); };
    client.setEditVersion(RUN_ID, stored.editVersion);
    sent.length = 0;
    const slow = client.patchRun(RUN_ID, { title: 'slow' });
    client.flushRunSaves();
    await new Promise((r) => setTimeout(r, 20));
    const waiting = client.patchRun(RUN_ID, { texts: [] });
    client.flushRunSaves();
    const queuedOld = client.patchRun(RUN_ID, { texts: [] });
    client.abandonCopy(RUN_ID);
    eq(await client.patchRun(RUN_ID, { texts: [] }), null, 'new edits from the abandoned copy are not saved');
    client.setEditVersion(RUN_ID, stored.editVersion);
    release();
    await Promise.all([slow, waiting, queuedOld]);
    await new Promise((r) => setTimeout(r, 400));
    ok(sent.length === 1 && sent[0].body.title === 'slow', 'nothing from the old copy goes out after the reload');
    eq(stored.texts.length, 9, 'captions kept');
  }
  {
    // Codex 2026-11-08 repro: a request fails (network) after its copy was abandoned and reloaded: no retry with the
    // new version.
    let fail = null;
    fetchImpl = async () => { await new Promise((_, rej) => { fail = rej; }); };
    client.setEditVersion(RUN_ID, 'r-v1');
    sent.length = 0;
    const old = client.patchRun(RUN_ID, { texts: [] });
    client.flushRunSaves();
    await new Promise((r) => setTimeout(r, 20));
    client.abandonCopy(RUN_ID);
    client.setEditVersion(RUN_ID, 'r-v2');
    fetchImpl = async (url, init) => route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
    fail(new TypeError('network'));
    await old;
    await new Promise((r) => setTimeout(r, 3400));
    ok(sent.length === 1 && sent[0].body.base === 'r-v1', 'the failed old save is not retried under the new version');
    eq(stored.texts.length, 9, 'captions kept');
    client.setEditVersion(RUN_ID, stored.editVersion);
  }
  {
    // Codex 2026-11-08: a rename's answer carries the video's current version (maybe another tab's); it must not
    // become this page's version, or this page's old captions would pass.
    fetchImpl = async (url, init) => route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
    client.setEditVersion(RUN_ID, 'page-v');
    stored.editVersion = 'tab-b-v'; stored.editSave = 'tab-b';
    await client.patchRun(RUN_ID, { title: 'rename from the old copy' });
    events.length = 0; sent.length = 0;
    await client.patchRun(RUN_ID, { texts: [] });
    ok(sent[0].body.base === 'page-v' && events.length === 1 && stored.texts.length === 9, 'after a rename, old captions are still refused');
    client.setEditVersion(RUN_ID, stored.editVersion);
  }
  {
    // Codex 2026-11-08: a failed save due for a retry when the video is opened again: the load cancels it, so it is
    // never sent with the new version.
    let fail = true;
    fetchImpl = async (url, init) => { if (fail) { fail = false; throw new TypeError('network'); } return route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx); };
    client.setEditVersion(RUN_ID, stored.editVersion);
    sent.length = 0;
    await client.patchRun(RUN_ID, { texts: [] });
    stored.editVersion = 'tab-b-2'; stored.editSave = 'tab-b-2';
    client.setEditVersion(RUN_ID, 'tab-b-2');
    await new Promise((r) => setTimeout(r, 3400));
    ok(sent.length === 1 && stored.texts.length === 9, 'the old retry never goes out after the video loads again');
  }
  {
    // Codex 2026-11-08 repro: a save is written but every answer is lost; then the page loads a copy (maybe an older
    // prefetch). The old save ids must not let that copy through.
    fetchImpl = async (url, init) => { await route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx); throw new TypeError('answer lost'); };
    client.setEditVersion(RUN_ID, stored.editVersion);
    await client.patchRun(RUN_ID, { texts: stored.texts });
    const lostSave = stored.editSave;
    client.setEditVersion(RUN_ID, 'an-older-prefetch-version');
    fetchImpl = async (url, init) => route.PATCH(new Request('http://x' + url, { method: 'PATCH', body: init.body }), ctx);
    sent.length = 0; events.length = 0;
    await client.patchRun(RUN_ID, { texts: [] });
    ok(!sent[0].body.mine.includes(lostSave) && events.length === 1 && stored.texts.length === 9, 'a loaded copy does not inherit the old save ids');
    client.setEditVersion(RUN_ID, stored.editVersion);
  }
  // The page's wiring.
  const view = fs.readFileSync('src/components/run-view.tsx', 'utf8');
  ok(/const load = waitRunSaves\(id\)\.catch\(\(\) => false\)\.then\(\(\) => pageLoad\(id, fresh, \(\) => alive\)\)/.test(view), 'the page lets its own pending saves land before it loads the video');
  ok(/setEditVersion\(id, data\.editVersion\);[\s\S]{0,900}containTexts\(snapTexts/.test(view), 'the page records the version as it loads, before its first save');
  const onStale = view.slice(view.indexOf('const onStale'), view.indexOf('const onStale') + 1600);
  ok(/clearTimeout\(saveTimer\.current\)/.test(onStale) && /clearTimeout\(adjustTimer\.current\)/.test(onStale), 'a refusal cancels the edits waiting to be saved');
  ok(/const unsaved = unsavedSections\(updated\.id\);[\s\S]{0,700}const dirty = \{ texts: Boolean\(saveTimer\.current\) \|\| unsaved\.has\("texts"\), adjust: Boolean\(adjustTimer\.current\) \|\| unsaved\.has\("hook"\) \};/.test(view), 'edits not yet confirmed by the server count as unsaved when a hook lands');
  ok(/adoptGeneratedVersion\(updated\.id, updated\.editVersion\);\s*\n\s*const again = Object\.fromEntries\(\[\.\.\.unsaved\]/.test(view) && /if \(Object\.keys\(again\)\.length\) void patchRun\(updated\.id, \{ \.\.\.again, project: null \}\);/.test(view), 'the page takes the generation\'s version and saves its unsaved edits again from the merged state');
  ok(/key=\{loadKey\}\s*\n\s*run=\{run\}/.test(view) && /<VideoEditor\s*\n\s*\/\/[^\n]*\n\s*key=\{loadKey\}/.test(view), 'a reload after a refusal starts a fresh editor (no Undo back to the old copy)');
  const staleHandler = view.slice(view.indexOf('const onStale'), view.indexOf('const onStale') + 1400);
  ok(/if \(generating\.current && refusedByGeneration\(id\)\) \{[\s\S]{0,600}awaitingGeneration\.current = waiting;\s*\n\s*return;/.test(staleHandler), 'a refusal while a hook generates waits for it instead of reloading');
  ok(/for \(const k of awaitingGeneration\.current \? \[\.\.\.awaitingGeneration\.current, \.\.\.takeRefusedSections\(updated\.id\)\] : \[\]\) unsaved\.add\(k\);/.test(view), 'the generated hook saves the refused edits again');
  ok(/if \(updated\.editVersion && cur\?\.id === updated\.id && !generationFollows\(updated\.id, updated\)\) \{[\s\S]{0,250}abandonCopy\(updated\.id\);[\s\S]{0,400}setLoadKey\(\(k\) => k \+ 1\);\s*\n\s*return;/.test(view), 'a generated hook that followed another tab\'s save makes the page load the latest');
  ok(/if \(awaitingGeneration\.current\) \{ awaitingGeneration\.current = null; setLoadKey\(\(k\) => k \+ 1\); \}/.test(view), 'if the generation fails, the page loads the latest version');
  ok(/addEventListener\(STALE_RUN_EVENT[\s\S]{0,10}/.test(view) && /setLoadKey\(\(k\) => k \+ 1\)/.test(view.slice(view.indexOf('const onStale'), view.indexOf('const onStale') + 1600)), 'a refusal loads the latest version');

  // ---- 4. hook actions never touch demo captions ----
  const r0 = baseRun();
  // The founder's steps: pick the 5.041 s hook from My files (speed of the video it was made in), then trim it.
  let r = swapGenerated(r0, 5.041, 1.15, true);
  keepsDemo(r0, r, 'pick a generated hook from My files');
  eq(client.runTexts(r).find((t) => t.id === 'hook').text, '', 'picking from My files leaves the hook words empty to retype (by design)');
  ok(client.runTexts(r).some((t) => t.id === 'then'), 'other hook captions stay');
  const p = hookParts(r)[0];
  let r2 = withParts(r, [{ ...p, start: 1.554, end: 4.461 }]);
  keepsDemo(r0, r2, 'then trim it to 1.554-4.461 (magnet on)');
  near(client.runTexts(r2).find((t) => t.id === 'd1').start, edit.timeline(r2, null)[1].offset + 0.1, 'first demo caption follows its clip');
  // Every other hook action, from the same start.
  for (const [what, make] of [
    ['a longer generated hook', () => swapGenerated(r0, 6.2, 1.1, false)],
    ['a shorter generated hook', () => swapGenerated(r0, 1.2, 1.1, false)],
    ['a generated hook at a new speed', () => swapGenerated(r0, 3.3, 1.5, false)],
    ['trim the hook start (magnet on)', () => withParts(r0, [{ ...hookParts(r0)[0], start: 0.8 }])],
    ['trim the hook end (magnet off)', () => withParts(r0, [{ ...hookParts(r0)[0], end: 1.6 }], true)],
    ['extend the hook (magnet off)', () => withParts(withParts(r0, [{ ...hookParts(r0)[0], end: 1.6 }]), [{ ...hookParts(r0)[0], end: 2.9 }], true)],
    ['extend the hook end (magnet on)', () => withParts(r0, [{ ...hookParts(r0)[0], end: 2.9 }])],
    ['cut the hook in two', () => { const q = hookParts(r0)[0]; return withParts(r0, [{ ...q, end: 1.2 }, { id: 'h2', start: 1.2, end: q.end }]); }],
    ['delete a cut piece of the hook (magnet on)', () => { const q = hookParts(r0)[0]; const cut = withParts(r0, [{ ...q, end: 1.2 }, { id: 'h2', start: 1.2, end: q.end }]); return { ...cut, ...ops.deleteSelection(cut, null, [], [{ seg: 'hook', part: 'h2' }], false) }; }],
    ['delete a cut piece of the hook (magnet off)', () => { const q = hookParts(r0)[0]; const cut = withParts(r0, [{ ...q, end: 1.2 }, { id: 'h2', start: 1.2, end: q.end }]); return { ...cut, ...ops.deleteSelection(cut, null, [], [{ seg: 'hook', part: 'h2' }], true) }; }],
    ['speed the hook up', () => setSpeed(r0, 2)],
    ['slow the hook down', () => setSpeed(r0, 0.5)],
  ]) keepsDemo(r0, make(), what);
  // Explicit delete still deletes, only what was picked.
  const del = { ...r0, ...ops.deleteSelection(r0, null, ['d4'], [], false) };
  ok(!client.runTexts(del).some((t) => t.id === 'd4') && client.runTexts(del).length === 8, 'deleting a caption on purpose removes only that one');
});
