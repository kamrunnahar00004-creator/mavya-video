// My files (founder 2026-11-09: "many of my files are missing... I didn't delete them"). Found: deleting a video (its
// clips were wrong) took its generated hooks, demos, exports, hooks, characters and music out of My files, and only the
// first 24 uploads were loaded. Checks src/lib/my-files.ts (the seven tabs, from records that outlive a video) and the
// wiring (one full read, no "Load more"). Offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

const mf = load('src/lib/my-files.ts');
let checks = 0;
const EXPECTED = 76;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.equal(JSON.stringify(a), JSON.stringify(b), msg); };

const at = (d, h = 10) => `2026-11-0${d}T${String(h).padStart(2, '0')}:00:00.000Z`;
const ref = (id, extra = {}) => ({ id, owner: 'curated', createdAt: at(1), title: id, author: id + 'er', sourceUrl: `https://www.instagram.com/reel/${id}/`, ...extra });
const asset = (id, kind = 'video', name = id + '.mp4', d = 2) => ({ mediaId: id, name, kind, createdAt: at(d) });
const signed = (p) => `https://bucket.r2.cloudflarestorage.com/${p}?X-Amz-Signature=abc`;
const seg = (file, start, end, extra = {}) => ({ url: signed(`media/${file}`), speed: 1, look: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, zoom: 0, panX: 0, panY: 0, flip: false, keys: [] }, pieces: [{ start, end }], ...extra });
const hookSeg = seg('hook.mp4', 0, 3);
const job = (runId, d, n, demoSegs, opts = {}) => ({
  runId, at: at(d, n), src: `/api/media/exp${d}${n}.mp4`, seconds: 18, demo: demoSegs ? { src: `/api/media/demo${d}${n}.mp4`, seconds: 15 } : undefined,
  demoParts: demoSegs ? mf.demoPartsOf([hookSeg, ...demoSegs]) : null, demoTexts: opts.texts ?? null, sounds: opts.sounds ?? [],
});
const gen = (runId, d, file, face, sourceRefId, title = 'Old video') => ({ runId, at: at(d), result: { src: `/api/media/${file}`, seconds: 3, at: at(d) }, from: { title, sourceRefId, hook: { mode: 'upload', text: 'my hook words', face } } });
const run = (id, extra = {}) => ({ id, title: 'Live video', createdAt: at(8), updatedAt: at(8), sourceRefId: null, hook: { mode: 'upload', text: '' }, demo: { clip: null, clips: [] }, exports: [], ...extra });
const empty = { runs: [], generations: [], exports: [], assets: [], refs: [] };

finish('my-files-checks', EXPECTED, () => checks, async () => {
  // Links to files: a signed storage link, its preview copy and an app link all name the same file.
  eq(mf.mediaOf(signed('media/abc-1.v1080.mp4')), 'abc-1.mp4', 'a preview copy names its file');
  eq(mf.mediaOf('/api/media/abc-1.mp4'), 'abc-1.mp4', 'an app link names its file');
  eq([mf.soundSrcOf(signed('library/audio/DaFCnEnNxTM.m4a')), mf.soundSrcOf(signed('media/s1.mp3'))], ['/api/sounds/DaFCnEnNxTM', '/api/media/s1.mp3'], 'export sounds map to where they play in the app');

  // A deleted video (founder: deleted because its clips were wrong): everything it made stays listed.
  {
    const src = {
      ...empty,
      generations: [gen('gone', 3, 'g1.mp4', { kind: 'character', id: 'olivia' }, 'HOOKA')],
      exports: [job('gone', 4, 1, [seg('c1.mp4', 0, 5)], { sounds: ['/api/sounds/HOOKA', '/api/media/song1.mp3'] })],
      refs: [ref('HOOKA')],
    };
    const f = mf.buildFiles(src, null);
    eq(f.generated.map((x) => x.value.g.src), ['/api/media/g1.mp4'], 'deleted video: its generated hook stays');
    eq(f.demos.map((x) => x.value.demo.src), ['/api/media/demo41.mp4'], 'deleted video: its demo stays');
    eq(f.exports.map((x) => x.value.src), ['/api/media/exp41.mp4'], 'deleted video: its export stays');
    eq(f.hooks.map((x) => x.value.id), ['HOOKA'], 'deleted video: its hook stays');
    eq(f.faces.map((x) => x.key), ['face:character:olivia'], 'deleted video: its character stays');
    eq(f.music.map((x) => x.value.src).sort(), ['/api/media/song1.mp3', '/api/sounds/HOOKA'], 'deleted video: its music stays');
    eq([f.generated[0].runTitle, f.exports[0].hookText], ['Old video', 'my hook words'], 'its title and hook words come from what was recorded');
    const from = f.generated[0].value.run;
    ok(from.id === 'gone' && from.sourceRefId === 'HOOKA' && from.hook.face.id === 'olivia', 'Use on it brings its hook and character');
  }

  // Uploaded: every upload, however many (only the first 24 were loaded).
  {
    const assets = Array.from({ length: 212 }, (_, i) => asset(`u${i}.mp4`));
    const f = mf.buildFiles({ ...empty, assets }, null);
    eq(f.uploads.length, 212, 'all 212 uploads listed');
    // Never a hook uploaded under "Generate your hook" (a library row, not an asset), a generated hook or an export.
    const g = mf.buildFiles({ ...empty, assets: [asset('clip.mp4')], refs: [ref('mine', { owner: 'user', mediaId: 'hookup.mp4' })], generations: [gen('r', 3, 'g.mp4', null, null)], exports: [job('r', 4, 1, [seg('clip.mp4', 0, 5)])] }, null);
    eq(g.uploads.map((x) => x.value.mediaId), ['clip.mp4'], 'Uploaded: only uploaded clips');
    eq(g.hooks.map((x) => [x.value.id, x.kind]), [['mine', 'upload']], 'an uploaded hook is under Hooks');
    // A picture is an upload unless it was picked as a face (Codex 2026-11-09: a demo picture became a "character").
    const p = mf.buildFiles({ ...empty, assets: [asset('pic.jpg', 'image', 'pic.jpg'), asset('me.jpg', 'image', 'me.jpg')], runs: [run('r', { hook: { mode: 'upload', text: '', face: { kind: 'photo', mediaId: 'me.jpg' } } })] }, null);
    eq(p.uploads.map((x) => x.value.mediaId), ['pic.jpg'], 'an uploaded picture is under Uploaded');
    eq(p.faces.map((x) => x.key), ['face:photo:me.jpg'], 'a face photo is under Characters, not Uploaded');
    // Codex 2026-11-09: a clip uploaded under "Generate your hook" is an asset; it is a generated hook, not an upload.
    const h = mf.buildFiles({ ...empty, assets: [asset('myhook.mp4'), asset('clip2.mp4')], runs: [run('r', { deletedAt: at(9), hook: { mode: 'upload', text: '', generated: { src: '/api/media/myhook.mp4', seconds: 3, at: at(3) } } })] }, null);
    eq([h.uploads.map((x) => x.value.mediaId), h.generated.map((x) => x.value.g.src)], [['clip2.mp4'], ['/api/media/myhook.mp4']], 'an uploaded hook: under Generated hooks, not Uploaded, also once its video is deleted');
    eq(mf.buildFiles({ ...empty, assets: [asset('s.mp3', 'audio', 's.mp3')] }, null).uploads.length, 0, 'a sound is under Music, not Uploaded');
  }

  // Demos: each demo once.
  {
    const A = [seg('c1.mp4', 0, 5), seg('c2.mp4', 1, 4)];
    const three = mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A), job('r', 4, 2, A), job('r2', 5, 1, A)] }, null);
    eq(three.demos.length, 1, 'the same demo exported three times (two videos): listed once');
    eq(three.demos[0].value.demo.src, '/api/media/demo51.mp4', 'as its newest export');
    eq(three.demos[0].key, 'demo:/api/media/demo41.mp4', 'under its first export, so a name or Delete survives exporting it again');
    eq(three.exports.length, 3, 'every export is still under Exported');
    const B = [seg('c1.mp4', 0, 5), seg('c2.mp4', 1, 3.5)];
    eq(mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A), job('r', 4, 2, B)] }, null).demos.length, 2, 'a clip cut differently: another demo');
    const C = [seg('c1.mp4', 0, 5, { speed: 2 }), seg('c2.mp4', 1, 4)];
    eq(mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A), job('r', 4, 2, C)] }, null).demos.length, 2, 'a clip sped up: another demo');
    const D = [seg('c1.mp4', 0, 5, { look: { brightness: 20 } }), seg('c2.mp4', 1, 4)];
    eq(mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A), job('r', 4, 2, D)] }, null).demos.length, 2, 'a clip with a new look: another demo');
    // Use on a demo puts its file in as the whole demo: exporting that under another hook is the same demo.
    const reused = [seg('demo41.mp4', 0, 15)];
    const r = mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A), job('r2', 5, 1, reused), job('r3', 6, 1, reused)] }, null);
    eq(r.demos.length, 1, 'a demo reused under other hooks: listed once');
    eq(mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A), job('r2', 5, 1, [seg('demo41.mp4', 2, 15)])] }, null).demos.length, 2, 'a reused demo cut shorter: another demo');
    eq(mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A), job('r2', 5, 1, [...reused, seg('c9.mp4', 0, 2)])] }, null).demos.length, 2, 'a reused demo with a clip added: another demo');
    // Codex 2026-11-09: part of a reused demo, or a gap added, is another demo.
    eq(mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A), job('r2', 5, 1, [seg('demo41.mp4', 0, 5)])] }, null).demos.length, 2, 'the first seconds of a reused demo: another demo');
    eq(mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A), job('r', 4, 2, [seg('c1.mp4', 0, 5), seg('c2.mp4', 1, 4, { gap: 0.5 })])] }, null).demos.length, 2, 'a gap added: another demo');
    eq(mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A), job('r2', 5, 1, [seg('demo41.mp4', 0, 15, { gap: 1 })])] }, null).demos.length, 2, 'a reused demo after a gap: another demo');
    // Texts (recorded since 2026-11-09): same clips with other texts is another demo; the same texts is the same.
    const t1 = JSON.stringify([{ text: 'one', start: 1, end: 2 }]), t2 = JSON.stringify([{ text: 'two', start: 1, end: 2 }]);
    eq(mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A, { texts: t1 }), job('r', 4, 2, A, { texts: t2 })] }, null).demos.length, 2, 'other texts: another demo');
    eq(mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A, { texts: t1 }), job('r', 4, 2, A, { texts: t1 })] }, null).demos.length, 1, 'same clips and texts: one demo');
    eq(mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A, { texts: t1 }), job('r2', 5, 1, reused, { texts: '[]' })] }, null).demos.length, 1, 'a reused demo keeps its texts: still one');
    eq(mf.buildFiles({ ...empty, exports: [job('r', 4, 1, A, { texts: t1 }), job('r2', 5, 1, reused, { texts: t2 })] }, null).demos.length, 2, 'a reused demo with texts added: another demo');
    // An export only its video records (no job): listed by its own file.
    const old = run('r', { exports: [{ src: '/api/media/e.mp4', seconds: 10, at: at(3), demo: { src: '/api/media/d.mp4', seconds: 7 } }] });
    const o = mf.buildFiles({ ...empty, runs: [old] }, null);
    eq([o.exports.length, o.demos.length], [1, 1], 'an export the video records is listed');
    const both = mf.buildFiles({ ...empty, runs: [run('r', { exports: [{ src: '/api/media/exp41.mp4', seconds: 18, at: at(4, 1), demo: { src: '/api/media/demo41.mp4', seconds: 15 } }] })], exports: [job('r', 4, 1, A)] }, null);
    eq([both.exports.length, both.demos.length], [1, 1], 'an export in both its job and its video: once');
  }

  // Generated hooks: each once, every version, also when reused in another video.
  {
    const live = run('r', { hook: { mode: 'upload', text: '', versions: [{ src: '/api/media/g1.mp4', seconds: 3, at: at(3) }], generated: { src: '/api/media/g2.mp4', seconds: 3, at: at(4) } } });
    const other = run('r2', { createdAt: at(9), hook: { mode: 'upload', text: '', generated: { src: '/api/media/g2.mp4', seconds: 3, at: at(4) } } });
    const f = mf.buildFiles({ ...empty, runs: [live, other], generations: [gen('r', 3, 'g1.mp4', null, null), gen('r', 4, 'g2.mp4', null, null)] }, null);
    eq(f.generated.map((x) => x.value.g.src).sort(), ['/api/media/g1.mp4', '/api/media/g2.mp4'], 'each generated hook once');
    // Codex 2026-11-09: Use brings the character and hook this one was generated with, not the video's latest.
    const two = mf.buildFiles({ ...empty, runs: [run('r', { sourceRefId: 'H2', hook: { mode: 'upload', text: '', face: { kind: 'character', id: 'sienna' } } })], generations: [gen('r', 3, 'old.mp4', { kind: 'character', id: 'olivia' }, 'H1'), gen('r', 4, 'new.mp4', { kind: 'character', id: 'sienna' }, 'H2')] }, null);
    const old = two.generated.find((x) => x.value.g.src === '/api/media/old.mp4').value.run;
    eq([old.hook.face.id, old.sourceRefId], ['olivia', 'H1'], 'Use on an older generated hook brings its own character and hook');
  }

  // Picked and then replaced (Codex 2026-11-09): every hook, character and sound ever picked stays listed.
  {
    const t = at(5);
    let picked = mf.pickedWith(undefined, { sourceRefId: 'H1', hook: { mode: 'upload', text: '', face: { kind: 'character', id: 'olivia' } }, sounds: [{ id: 's', kind: 'song', src: '/api/media/a.mp3', name: 'A', at: 0, start: 0, volume: 100 }] }, t);
    picked = mf.pickedWith(picked, { sourceRefId: 'H2', hook: { mode: 'upload', text: '', face: { kind: 'character', id: 'sienna' } }, sounds: [{ id: 's', kind: 'song', src: '/api/media/b.mp3', name: 'B', at: 0, start: 0, volume: 100 }] }, at(6));
    eq([picked.refs.map((x) => x.id), picked.faces.map((x) => x.face.id), picked.sounds.map((x) => x.name)], [['H1', 'H2'], ['olivia', 'sienna'], ['A', 'B']], 'the pick history keeps every pick');
    eq(mf.pickedWith(picked, { sourceRefId: 'H1', hook: { mode: 'upload', text: '', face: { kind: 'character', id: 'olivia' } } }, at(7)), null, 'picking one again adds nothing');
    const many = Array.from({ length: 4000 }, (_, i) => ({ id: 'R' + i, at: t }));
    eq(mf.pickedWith({ refs: many }, { sourceRefId: 'new' }, t).refs.length, 4001, 'the history keeps thousands of picks (Codex 2026-11-09: 200 dropped some)');
    const f = mf.buildFiles({ ...empty, runs: [run('r', { deletedAt: at(9), sourceRefId: 'H2', hook: { mode: 'upload', text: '', face: { kind: 'character', id: 'sienna' } }, picked })], refs: [ref('H1'), ref('H2')] }, null);
    eq([f.hooks.map((x) => x.value.id).sort(), f.faces.map((x) => x.key).sort(), f.music.map((x) => x.value.name).sort()], [['H1', 'H2'], ['face:character:olivia', 'face:character:sienna'], ['A', 'B']], 'a deleted video: every hook, character and sound it ever picked');
  }

  // Hooks and characters: each once, whoever used them.
  {
    const f = mf.buildFiles({ ...empty, runs: [run('r', { sourceRefId: 'H1', hook: { mode: 'upload', text: '', face: { kind: 'character', id: 'olivia' } } })], generations: [gen('x', 3, 'g.mp4', { kind: 'character', id: 'olivia' }, 'H1'), gen('y', 4, 'h.mp4', { kind: 'character', id: 'sienna' }, 'H2')], refs: [ref('H1'), ref('H2')] }, null);
    eq(f.hooks.map((x) => x.value.id).sort(), ['H1', 'H2'], 'each hook once');
    eq(f.faces.map((x) => x.key).sort(), ['face:character:olivia', 'face:character:sienna'], 'each character once');
    eq(f.hooks.find((x) => x.value.id === 'H1').runId, 'x', 'listed under the first video that used it');
  }

  // Music: every song picked and sound uploaded, each once, with its name and kind.
  {
    const assets = [asset('s1.mp3', 'audio', 'Golden Hour · JVKE', 2), asset('u1.m4a', 'audio', 'my voice.m4a', 3)];
    const f = mf.buildFiles({ ...empty, assets, refs: [ref('HOOKA')], exports: [job('r', 4, 1, null, { sounds: ['/api/media/s1.mp3', '/api/sounds/HOOKA', '/api/media/u1.m4a'] })] }, null);
    const by = Object.fromEntries(f.music.map((x) => [x.value.src, [x.kind, x.value.name]]));
    eq(by['/api/media/s1.mp3'], ['song', 'Golden Hour · JVKE'], 'a saved song: Songs, its name');
    eq(by['/api/media/u1.m4a'], ['upload', 'my voice'], 'an uploaded sound: Uploads, its name');
    eq(by['/api/sounds/HOOKA'], ['hook', '@HOOKAer'], "a hook's sound: Hook sounds, its creator");
    eq(f.music.length, 3, 'each sound once');
    const g = mf.buildFiles({ ...empty, assets: [asset('u2.mp3', 'audio', 'beat.mp3', 3)] }, null);
    eq(g.music.map((x) => x.value.src), ['/api/media/u2.mp3'], 'an uploaded sound no video used is still listed');
    const named = mf.buildFiles({ ...empty, runs: [run('r', { sounds: [{ id: 's', kind: 'song', src: '/api/media/s1.mp3', name: 'Named in video', at: 0, start: 0, volume: 100 }] })], assets }, null);
    eq(named.music.find((x) => x.value.src === '/api/media/s1.mp3').value.name, 'Named in video', 'a sound in a video keeps the name it has there');
  }

  // The open video as it is now counts (its saved copy may be a moment behind).
  {
    const saved = run('r');
    const now = run('r', { sounds: [{ id: 's', kind: 'upload', src: '/api/media/new.mp3', name: 'new', at: 0, start: 0, volume: 100 }] });
    eq(mf.buildFiles({ ...empty, runs: [saved] }, now).music.map((x) => x.value.src), ['/api/media/new.mp3'], 'the open video counts as it is now');
  }

  // Exported: every export once, newest data from the job.
  {
    const f = mf.buildFiles({ ...empty, exports: [job('a', 4, 1, null), job('b', 5, 1, null)] }, null);
    eq(f.exports.map((x) => x.value.src).sort(), ['/api/media/exp41.mp4', '/api/media/exp51.mp4'], 'every export listed');
    ok(f.exports.every((x) => !('demo' in x.value)), 'an export without a demo part has none');
  }

  // Wiring: one full read of the records that outlive a video; no "Load more"; the export records its demo texts; a
  // saved song is kept as an asset with its name.
  {
    const panel = fs.readFileSync('src/components/history-panel.tsx', 'utf8');
    ok(panel.includes('loadFiles(') && fs.readFileSync('src/lib/files-client.ts', 'utf8').includes('fetch("/api/files"') && panel.includes('buildFiles(') && !/fetchPage|Load more|cursors/.test(panel), 'My files reads /api/files whole, no paging');
    const server = fs.readFileSync('src/lib/server/my-files.ts', 'utf8');
    ok(/from\("generations"\)[\s\S]*eq\("state", "done"\)/.test(server) && /from\("export_jobs"\)[\s\S]*eq\("state", "done"\)/.test(server), 'the server reads finished generations and export jobs');
    ok((server.match(/every\(\(a, b\) => db\.from\(/g) ?? []).length === 6 && (server.match(/\.range\(a, b\)\)/g) ?? []).length === 6 && !/\.limit\(/.test(server), 'every source is read whole, batch by batch (Codex 2026-11-09: a 2000 cap dropped older files)');
    ok(/from\("assets"\)/.test(server) && !/PAGE_SIZE/.test(server), 'uploads: all assets');
    ok(fs.existsSync('src/app/api/files/route.ts') && /fileSources\(who\)/.test(fs.readFileSync('src/app/api/files/route.ts', 'utf8')), 'GET /api/files serves them');
    const exp = fs.readFileSync('src/app/api/runs/[id]/export/route.ts', 'utf8');
    ok(/demoTexts=demoMedia\?JSON\.stringify\(expected\.filter/.test(exp) && /demoSeconds:[^}]*,demoTexts\}/.test(exp), 'an export records its demo texts');
    ok(/saveMedia\(file, true, who\)/.test(fs.readFileSync('src/app/api/songs/[id]/route.ts', 'utf8')), 'a saved song is an asset (its name outlives the video)');
    // Delete video hides the video; every list and page leaves it out, My files still reads it.
    const store = fs.readFileSync('src/lib/server/store.ts', 'utf8');
    ok(/export async function deleteRun[\s\S]{0,400}mavya_patch_run", \{ p_user: who, p_run: id, p_patch: \{ deletedAt: at \} \}/.test(store) && !/from\("runs"\)\.delete\(\)/.test(store), 'Delete video keeps the video stored, hidden');
    ok(/if \(!withDeleted\) query = query\.is\("data->>deletedAt", null\)/.test(store) && /return data\?\.data && !data\.data\.deletedAt \? data\.data : null;/.test(store) && /is\("data->>deletedAt", null\)\.not\("data->product->>at"/.test(store), 'a deleted video is out of the video list, every page and the product carry-over');
    ok(/if \(kind === "runs"\) query = query\.is\("data->>deletedAt", null\);/.test(fs.readFileSync('src/lib/server/list-pages.ts', 'utf8')), 'and out of the paged video lists');
    ok(!/deletedAt/.test(server.split('db.from("runs")')[1].split('.limit(')[0].replace('deletedAt:data->deletedAt', '')) && /listRuns\(who, true\)/.test(server), 'My files still reads deleted videos');
    const route = fs.readFileSync('src/app/api/runs/[id]/route.ts', 'utf8');
    ok(/const picked = pickedWith\(seeded \?\? current\.picked, patch, new Date\(\)\.toISOString\(\)\) \?\? seeded;\n    if \(picked\) patch\.picked = picked;/.test(route) && !/patch\.deletedAt|body\.deletedAt|body\.picked/.test(route), 'every save records picks; a save cannot set them or delete');
    ok(/clipFromAsset\(\{ \.\.\.asset, kind: asset\.kind === "image" \? "image" : "video" \}\)/.test(fs.readFileSync('src/components/run-view.tsx', 'utf8')), 'an uploaded picture goes into the demo as a picture');
    // Codex 2026-11-09: no new work or edits on a deleted video; a hook generating when it was deleted still lands.
    const gen = fs.readFileSync('src/app/api/runs/[id]/generate/route.ts', 'utf8');
    ok(gen.indexOf('if (!(await getRun(id, who))) return Response.json({ error: "Not found" }, { status: 404 });') > -1 && gen.indexOf('getRun(id, who)') < gen.indexOf('reserveGeneration(who'), 'Generate on a deleted video: refused before any quota is used');
    ok(route.includes('if (!body) return Response.json({ error: "Bad request" }, { status: 400 });\n  // Every save needs a live video: a deleted one (hidden, kept for My files) takes no edits, not even a new title.\n  current ??= await getRun(id, who);\n  if (!current) return Response.json({ error: "Not found" }, { status: 404 });'), 'every save needs a live video');
    ok(/const run = await getRunStored\(job\.run_id, who\);/.test(fs.readFileSync('src/lib/server/generation-jobs.ts', 'utf8')) && /export async function getRunStored[\s\S]{0,600}return data\?\.data \?\? null;/.test(store), 'a generation finishing on a deleted video completes');
    // Codex 2026-11-09 round 3: product delete refuses a deleted video; the used-hooks read is batched too; a save
    // records the video's current picks before replacing them.
    const product = fs.readFileSync('src/app/api/runs/[id]/product/route.ts', 'utf8');
    ok(/if \(!\(await getRun\(id, who\)\)\) return Response\.json\(\{ error: "Not found" \}, \{ status: 404 \}\);\n  const updated = await updateRun\(id, \{ product: null, script: null \}, who\);/.test(product), 'product delete on a deleted video: refused');
    ok(/slices\.map\(\(slice\) => every\(\(a, b\) => db\.from\("library"\)/.test(server), 'the used-hooks read is batched');
    ok(/const seeded = pickedWith\(current\.picked, current, current\.updatedAt\);/.test(route), 'a save records the current picks first');
    {
      const live = run('r', { updatedAt: at(4), sourceRefId: 'OLD', hook: { mode: 'upload', text: '', face: { kind: 'character', id: 'ava' } }, sounds: [{ id: 's', kind: 'song', src: '/api/media/old.mp3', name: 'Old', at: 0, start: 0, volume: 100 }] });
      const seeded = mf.pickedWith(undefined, live, live.updatedAt);
      const next = mf.pickedWith(seeded, { sourceRefId: 'NEW', hook: { mode: 'upload', text: '', face: { kind: 'character', id: 'zoe' } }, sounds: [] }, at(5));
      eq([next.refs.map((x) => x.id), next.faces.map((x) => x.face.id), next.sounds.map((x) => x.name)], [['OLD', 'NEW'], ['ava', 'zoe'], ['Old']], 'replacing the picks of a video from before the history keeps the old ones');
    }
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    ok(pkg.scripts.test.includes('node scripts/my-files-checks.cjs'), 'in npm test');
  }
});
