// Kling 4.0 character swap (founder 2026-11-21: "it cannot be better than kling 4.0 with face ref"). Offline: real
// ffmpeg, real character photos and ready-made faces; fal, R2, the database and Gemini are stubbed (no network, no cost).
// Checks: the face crop math, the task id (slowdown + length sent) round trip and that the database accepts it, the
// clip sent to Kling (length, size, no sound), the exact request for a library character, an uploaded photo (Gemini
// face box, and its fallback), a character described in words, a short clip, a note, the fallback attempt, the result
// (cut back to length, no sound, sped back), the ready-made faces, and that the old first-frame path is gone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { load, finish } = require('./check-module.cjs');

let n = 0;
const ok = async (label, fn) => { try { await fn(); n++; } catch (e) { console.error(`FAIL: ${label}`); throw e; } };
const ffbin = path.join(process.cwd(), 'node_modules/ffmpeg-static/ffmpeg');
const run = (...a) => execFileSync(ffbin, ['-nostdin', '-v', 'error', '-y', ...a]);
const info = (f) => { try { execFileSync(ffbin, ['-hide_banner', '-i', f], { stdio: 'pipe' }); } catch (e) { return String(e.stderr); } return ''; };
const seconds = (f) => { const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info(f)); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN; };
const size = (f) => { const m = /, (\d{2,5})x(\d{2,5})[, ]/.exec(info(f)); return m ? [+m[1], +m[2]] : null; };
const hasAudio = (f) => /Audio:/.test(info(f));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kling4-swap-'));
const file = (name, bytes) => { const p = path.join(tmp, name); fs.writeFileSync(p, bytes); return p; };

// Fixtures: hook clips (with sound, like a downloaded reel) and the fal result Kling 4.0 returns (rounded up, with audio).
const clip = (name, len, w, h) => { const p = path.join(tmp, name); run('-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=30`, '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', String(len), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p); return p; };
const hook = clip('hook.mp4', 3.63, 720, 1280);
const shortHook = clip('short.mp4', 2.53, 720, 1280);
const smallHook = clip('small.mp4', 3.5, 480, 854);
const oddHook = clip('odd.mp4', 3.2, 721, 1001);
const tallHook = clip('tall.mp4', 3.2, 720, 1920);
const tinyHook = clip('tiny.mp4', 0.5, 720, 1280);
const pngPhoto = path.join(tmp, 'upload.png'); run('-i', 'public/characters/ava.jpg', pngPhoto);
const result404 = fs.readFileSync(clip('result.mp4', 4.04, 720, 1280));

// The database's rule for a provider task id (migrations 0005/0015).
const dbAccepts = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) || /^[A-Za-z0-9_./-]{1,200}\|[A-Za-z0-9_-]{1,128}$/.test(v);

async function main() {
  const crop = load('src/lib/face-crop.ts');
  const sh = load('src/lib/short-hook.ts');

  // ---- face crop math ----
  await ok('a face box widens to head and hair, inside the image', () => {
    const r = crop.headRegion([300, 400, 500, 600]);
    assert.ok(r.x < 0.4 && r.x + r.w > 0.6 && r.y < 0.3 && r.y + r.h > 0.5, 'contains the face');
    assert.ok(r.y <= 0.3 - 0.2 * 0.6 + 1e-9, 'room above for hair');
    for (const k of ['x', 'y', 'w', 'h']) assert.ok(r[k] >= 0 && r[k] <= 1, k);
  });
  await ok('a face at the edge stays inside the image', () => {
    const r = crop.headRegion([0, 0, 400, 300]);
    assert.equal(r.x, 0); assert.equal(r.y, 0); assert.ok(r.x + r.w <= 1 && r.y + r.h <= 1);
    const big = crop.headRegion([-50, -10, 1200, 1100]);
    assert.deepEqual({ ...big }, { x: 0, y: 0, w: 1, h: 1 });
  });
  await ok('unusable boxes give null (the fallback region is used)', () => {
    for (const bad of [null, undefined, [], [1, 2, 3], [500, 500, 500, 500], [600, 0, 400, 1000], [0, 0, 10, 10], ['1', 2, 3, 4], [NaN, 0, 500, 500]]) assert.equal(crop.headRegion(bad), null, JSON.stringify(bad));
    assert.ok(crop.FALLBACK_REGION.w > 0.5 && crop.FALLBACK_REGION.y < 0.1, 'fallback: the upper middle');
  });
  await ok('the crop filter cuts by fractions and keeps at least 512 px', () => {
    const f = crop.cropFilter({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    assert.ok(f.startsWith('crop=iw*0.5:ih*0.4:iw*0.1:ih*0.2,'));
    const out = path.join(tmp, 'crop.jpg');
    run('-i', 'public/characters/olivia.jpg', '-vf', f, '-frames:v', '1', out);
    const [w, h] = size(out);
    assert.ok(Math.min(w, h) >= 512, `${w}x${h}`);
  });

  // ---- task id ----
  const ID = '01a1fe10-8bb3-7a51-a8e4-5bbe2e5864ff';
  await ok('the task id carries the length sent; the database accepts it', () => {
    const t = sh.withLength(`kling/v4/video-to-video/edit|${ID}`, 3.633);
    assert.equal(t, `kling/v4/video-to-video/edit/len3.63|${ID}`);
    assert.ok(dbAccepts(t));
    assert.deepEqual({ ...sh.parseTask(t) }, { model: 'kling/v4/video-to-video/edit', id: ID, factor: 1, length: 3.63 });
  });
  await ok('slowdown and length together round trip', () => {
    const t = sh.withLength(sh.withSlow(`kling/v4/video-to-video/edit|${ID}`, 1.2649), 3.2);
    assert.equal(t, `kling/v4/video-to-video/edit/slow1.2649/len3.2|${ID}`);
    assert.ok(dbAccepts(t));
    assert.deepEqual({ ...sh.parseTask(t) }, { model: 'kling/v4/video-to-video/edit', id: ID, factor: 1.2649, length: 3.2 });
  });
  await ok('old Kling 3.0 task ids still read (jobs in flight at the switch)', () => {
    assert.deepEqual({ ...sh.parseTask(`fal-ai/kling-video/v3/standard/motion-control|${ID}`) }, { model: 'fal-ai/kling-video/v3/standard/motion-control', id: ID, factor: 1, length: 0 });
    assert.deepEqual({ ...sh.parseTask(`fal-ai/kling-video/v3/standard/motion-control/slow1.3|${ID}`) }, { model: 'fal-ai/kling-video/v3/standard/motion-control', id: ID, factor: 1.3, length: 0 });
  });
  await ok('a bad length is ignored, never trims to nothing', () => {
    for (const bad of [0, -1, NaN, Infinity, 61]) assert.equal(sh.withLength(`m|${ID}`, bad), `m|${ID}`);
    assert.equal(sh.parseTask(`m/len0|${ID}`).length, 0);
    assert.equal(sh.parseTask(`m/len999|${ID}`).length, 0);
  });

  // ---- hookgen with stubs ----
  let objects = new Map(), falBodies = [], geminiCalls = 0, geminiReply = { box_2d: [180, 300, 420, 700] }, fetchReplies = [];
  const budget = { checkBudget() {}, withWorkBudget: (f) => f(), workSignal: () => AbortSignal.timeout(60000) };
  const ffmpeg = { ffmpegPath: async () => ffbin };
  const gemini = { geminiJSON: async () => { geminiCalls++; if (geminiReply instanceof Error) throw geminiReply; return geminiReply; } };
  const faceRef = load('src/lib/server/face-ref.ts', {
    'node:child_process': require('node:child_process'), 'node:fs/promises': require('node:fs/promises'), 'node:path': path, 'node:util': require('node:util'),
    '@/lib/server/ffmpeg': ffmpeg, '@/lib/server/gemini': gemini, '@/lib/server/work-budget': budget,
  });
  let library = hook;
  const uploaded = 'public/characters/ava.jpg';
  const hookgen = load('src/lib/server/hookgen.ts', {
    '@/lib/server/work-budget': budget, 'node:child_process': require('node:child_process'), 'node:crypto': require('node:crypto'),
    'node:fs/promises': require('node:fs/promises'), 'node:os': os, 'node:path': path, 'node:util': require('node:util'),
    '@/lib/server/ffmpeg': ffmpeg, '@/lib/server/face-ref': faceRef,
    '@/lib/server/r2': { putObject: async (key, bytes, type) => { objects.set(key, { bytes: Buffer.from(bytes), type }); }, signedGet: async (key) => `https://r2.fixture.invalid/${key}` },
    '@/lib/supabase/server': { createSupabaseAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) },
    '@/lib/server/store': {
      libraryFile: async (_kind, _code, dir) => { const p = path.join(dir, 'library.mp4'); fs.copyFileSync(library, p); return p; },
      mediaToFile: async (id, _who, dir) => {
        if (id === 'my-photo') { const p = path.join(dir, 'photo.jpg'); fs.copyFileSync(uploaded, p); return { file: p, mime: 'image/jpeg' }; }
        if (id === 'my-png') { const p = path.join(dir, 'photo.png'); fs.copyFileSync(pngPhoto, p); return { file: p, mime: 'image/png' }; }
        if (id === 'my-video') { const p = path.join(dir, 'clip.mp4'); fs.copyFileSync(hook, p); return { file: p, mime: 'video/mp4' }; }
        if (id === 'broken-jpeg') { const p = path.join(dir, 'broken.jpg'); fs.writeFileSync(p, Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01])); return { file: p, mime: 'image/jpeg' }; }
        if (id === 'fake-jpeg') { const p = path.join(dir, 'fake.jpg'); fs.copyFileSync(hook, p); return { file: p, mime: 'image/jpeg' }; }
        if (id === 'odd-upload') { const p = path.join(dir, 'odd.webm'); run('-f', 'lavfi', '-i', 'testsrc2=size=721x1001:rate=30', '-t', '3.2', '-c:v', 'libvpx-vp9', '-b:v', '200k', '-deadline', 'realtime', p); return { file: p, mime: 'video/webm' }; }
        return null;
      },
    },
  }, { FAL_KEY: 'fixture-only' }, {
    fetch: async (url, init) => {
      if (String(url).startsWith('https://queue.fal.run/') && init?.method === 'POST') { falBodies.push({ url: String(url), body: JSON.parse(init.body) }); return Response.json({ request_id: ID }); }
      const next = fetchReplies.shift(); if (!next) throw Error(`unexpected fetch ${url}`); return next;
    },
  });
  const sentFile = (url) => { const key = url.replace('https://r2.fixture.invalid/', ''); const o = objects.get(key); assert.ok(o, `uploaded ${key}`); return file(path.basename(key), o.bytes); };
  const source = { sourceUrl: 'https://www.instagram.com/reel/FIXTURE123/' };
  const gen = async (face, extra = {}, note, simple) => { objects = new Map(); falBodies = []; geminiCalls = 0; return hookgen.startHook({ hook: { source: 'library', face, ...extra } }, source, 'owner', note, simple); };

  await ok('library character: Kling 4.0 edit, face first then the whole photo, the winning prompt', async () => {
    const task = await gen({ kind: 'character', id: 'olivia' });
    assert.equal(falBodies.length, 1);
    const { url, body } = falBodies[0];
    assert.equal(url, 'https://queue.fal.run/kling/v4/video-to-video/edit');
    assert.equal(body.prompt, hookgen.SWAP_PROMPT);
    assert.equal(body.resolution, '720p'); assert.equal(body.keep_audio, false);
    assert.equal(body.image_urls.length, 2);
    assert.ok(sentFile(body.image_urls[0]).length && fs.readFileSync(sentFile(body.image_urls[0])).equals(fs.readFileSync('public/characters/faces/olivia.jpg')), '@Image1 is the ready-made face');
    assert.deepEqual(size(sentFile(body.image_urls[1])), size('public/characters/olivia.jpg'), '@Image2 is the whole photo (re-encoded JPEG)');
    assert.equal(geminiCalls, 0, 'a library character costs no Gemini call');
    assert.ok(dbAccepts(task) && task.startsWith('kling/v4/video-to-video/edit/len'), task);
    for (const k of ['image_url', 'character_orientation', 'keep_original_sound']) assert.equal(k in body, false, `no Kling 3.0 field ${k}`);
  });
  await ok('the clip Kling gets: same length, no sound, 720x1280, the length in the task id', async () => {
    const task = await gen({ kind: 'character', id: 'olivia' });
    const sent = sentFile(falBodies[0].body.video_url);
    assert.ok(Math.abs(seconds(sent) - 3.63) < 0.06, `length ${seconds(sent)}`);
    assert.equal(hasAudio(sent), false);
    assert.deepEqual(size(sent), [720, 1280]);
    assert.ok(Math.abs(sh.parseTask(task).length - seconds(sent)) < 0.06);
  });
  await ok('uploaded photo: swapped like a character, its face found by Gemini and cut', async () => {
    geminiReply = { box_2d: [180, 300, 420, 700] };
    await gen({ kind: 'photo', mediaId: 'my-photo' });
    const { body } = falBodies[0];
    assert.equal(body.prompt, hookgen.SWAP_PROMPT);
    assert.equal(geminiCalls, 1);
    const face = sentFile(body.image_urls[0]), photo = sentFile(body.image_urls[1]);
    assert.deepEqual(size(photo), size(uploaded), '@Image2 is the whole uploaded photo');
    const [fw, fh] = size(face), [pw, ph] = size(photo);
    assert.ok(fw < pw && fh < ph, `the face is a crop (${fw}x${fh} of ${pw}x${ph})`);
    assert.ok(Math.min(fw, fh) >= 512, 'and big enough');
  });
  await ok('uploaded photo: Gemini down or no face found, still swapped (upper middle)', async () => {
    for (const reply of [new Error('gemini down'), { box_2d: [0, 0, 1, 1] }]) {
      geminiReply = reply;
      await gen({ kind: 'photo', mediaId: 'my-photo' });
      assert.equal(falBodies.length, 1);
      const [fw, fh] = size(sentFile(falBodies[0].body.image_urls[0]));
      assert.ok(fw > 0 && fh > 0);
    }
    geminiReply = { box_2d: [180, 300, 420, 700] };
  });
  await ok('a missing uploaded photo stops before any paid request', async () => {
    await assert.rejects(gen({ kind: 'photo', mediaId: 'gone' }), /photo is missing/);
    assert.equal(falBodies.length, 0);
  });
  await ok('a character described in words: no images, the words in the prompt', async () => {
    await gen({ kind: 'described', text: 'a man in his 30s with a beard' });
    const { body } = falBodies[0];
    assert.equal('image_urls' in body, false);
    assert.equal(body.prompt, hookgen.swapPromptFor('a man in his 30s with a beard'));
    assert.match(body.prompt, /@Video1/); assert.equal(geminiCalls, 0);
  });
  await ok('a short clip is slowed to 3 s or more and the task id says so', async () => {
    library = shortHook;
    const task = await gen({ kind: 'character', id: 'olivia' });
    library = hook;
    const p = sh.parseTask(task);
    assert.ok(p.factor > 1, task);
    const sent = sentFile(falBodies[0].body.video_url);
    assert.ok(seconds(sent) >= 3, `sent ${seconds(sent)} s (Kling 4.0 needs 3)`);
    assert.ok(Math.abs(p.length - seconds(sent)) < 0.06);
  });
  await ok('a small clip is scaled up to 720 px (Kling refuses under 700)', async () => {
    library = smallHook;
    await gen({ kind: 'character', id: 'olivia' });
    library = hook;
    const [w, h] = size(sentFile(falBodies[0].body.video_url));
    assert.equal(w, 720); assert.ok(h >= 1278 && h <= 1282, `${w}x${h}`);
  });
  await ok('Regenerate note goes after the prompt; the fallback attempt is the same request', async () => {
    await gen({ kind: 'character', id: 'olivia' }, {}, 'her smile was too big');
    assert.equal(falBodies[0].body.prompt, `${hookgen.SWAP_PROMPT} Fix this from the last try: her smile was too big.`);
    await gen({ kind: 'character', id: 'olivia' }, {}, undefined, true);
    assert.equal(falBodies[0].url, 'https://queue.fal.run/kling/v4/video-to-video/edit');
    assert.deepEqual(Object.keys(falBodies[0].body).sort(), ['image_urls', 'keep_audio', 'prompt', 'resolution', 'video_url']);
  });

  await ok('odd sizes come out even, each side at least 700 px (Codex: 721 px failed to encode)', async () => {
    library = oddHook;
    await gen({ kind: 'character', id: 'olivia' });
    library = hook;
    const [w, h] = size(sentFile(falBodies[0].body.video_url));
    assert.ok(w % 2 === 0 && h % 2 === 0 && Math.min(w, h) >= 700, `${w}x${h}`);
  });
  await ok('a too tall clip is cropped into the Kling 4.0 ratio range, 0.40 to 2.50', async () => {
    library = tallHook;
    await gen({ kind: 'character', id: 'olivia' });
    library = hook;
    const [w, h] = size(sentFile(falBodies[0].body.video_url));
    assert.ok(w / h >= 0.4 && w / h <= 2.5 && Math.min(w, h) >= 700 && Math.max(w, h) <= 4553, `${w}x${h}`);
  });
  await ok('a clip under 1 s is refused before any paid request (its slowdown would not fit the task id)', async () => {
    library = tinyHook;
    await assert.rejects(gen({ kind: 'character', id: 'olivia' }), /too short/);
    library = hook;
    assert.equal(falBodies.length, 0);
  });
  await ok('an uploaded PNG is sent as a real JPEG', async () => {
    await gen({ kind: 'photo', mediaId: 'my-png' });
    for (const u of falBodies[0].body.image_urls) assert.ok(fs.readFileSync(sentFile(u)).subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), `${u} is JPEG`);
  });
  await ok('a non-image upload as the face stops before any paid request', async () => {
    await assert.rejects(gen({ kind: 'photo', mediaId: 'my-video' }), /photo is missing/);
    assert.equal(falBodies.length, 0);
  });
  await ok('a failed temp cleanup never hides the accepted (paid) task', async () => {
    const fsp = require('node:fs/promises');
    const api = load('src/lib/server/hookgen.ts', {
      '@/lib/server/work-budget': budget, 'node:child_process': require('node:child_process'), 'node:crypto': require('node:crypto'),
      'node:fs/promises': { ...fsp, rm: async () => { throw Error('EBUSY'); } }, 'node:os': os, 'node:path': path, 'node:util': require('node:util'),
      '@/lib/server/ffmpeg': ffmpeg, '@/lib/server/face-ref': faceRef,
      '@/lib/server/r2': { putObject: async () => {}, signedGet: async (key) => `https://r2.fixture.invalid/${key}` },
      '@/lib/supabase/server': { createSupabaseAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) },
      '@/lib/server/store': { libraryFile: async (_k, _c, dir) => { const p = path.join(dir, 'library.mp4'); fs.copyFileSync(hook, p); return p; }, mediaToFile: async () => null },
    }, { FAL_KEY: 'fixture-only' }, { fetch: async () => Response.json({ request_id: ID }) });
    const task = await api.startHook({ hook: { source: 'library', face: { kind: 'character', id: 'olivia' } } }, source, 'owner');
    assert.ok(task.endsWith(`|${ID}`), task);
  });

  await ok('every size Kling 4.0 might get is valid: even, 700..4553 px, ratio 0.40..2.50', () => {
    for (const s0 of ['5000x2000', '2000x5000', '721x1001', '720x1920', '100x1000', '320x240', '720x1280', '4000x6000', '1920x1080', '247x99', '99x247', '2x720']) {
      const out = path.join(tmp, `size-${s0}.mp4`);
      run('-f', 'lavfi', '-i', `testsrc2=size=${s0}:rate=30`, '-t', '0.2', '-vf', `${sh.minSideFilter},fps=30`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out);
      const [w, h] = size(out);
      assert.ok(w % 2 === 0 && h % 2 === 0 && Math.min(w, h) >= 700 && Math.max(w, h) <= 4553 && w / h >= 0.4 && w / h <= 2.5, `${s0} -> ${w}x${h}`);
    }
  });
  await ok('an uploaded hook video with an odd width is cut and swapped', async () => {
    objects = new Map(); falBodies = [];
    await hookgen.startHook({ hook: { source: 'upload', start: 0, end: 3.2, face: { kind: 'character', id: 'olivia' } } }, { mediaId: 'odd-upload' }, 'owner');
    const [w, h] = size(sentFile(falBodies[0].body.video_url));
    assert.ok(w % 2 === 0 && h % 2 === 0 && Math.min(w, h) >= 700, `${w}x${h}`);
  });
  await ok('a file that only claims to be a JPEG is re-encoded into a real one', async () => {
    await gen({ kind: 'photo', mediaId: 'fake-jpeg' });
    for (const u of falBodies[0].body.image_urls) assert.ok(fs.readFileSync(sentFile(u)).subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), u);
  });
  await ok('a broken file that only looks like a JPEG stops before any paid request', async () => {
    objects = new Map(); falBodies = [];
    await assert.rejects(hookgen.startHook({ hook: { face: { kind: 'photo', mediaId: 'broken-jpeg' }, describe: 'they gasp' } }, null, 'owner'));
    assert.equal(falBodies.length, 0);
  });
  await ok('a described hook with an uploaded PNG gets a real JPEG too', async () => {
    objects = new Map(); falBodies = [];
    await hookgen.startHook({ hook: { face: { kind: 'photo', mediaId: 'my-png' }, describe: 'they gasp at the screen' } }, null, 'owner');
    assert.match(falBodies[0].url, /image-to-video$/);
    assert.ok(fs.readFileSync(sentFile(falBodies[0].body.start_image_url)).subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])));
  });

  // ---- the result ----
  const result = async (task) => { fetchReplies = [Response.json({ status: 'COMPLETED' }), Response.json({ video: { url: 'https://fal.fixture.invalid/out.mp4' } }), new Response(result404)]; return hookgen.checkHook(task); };
  await ok('the result is cut back to the clip length, with no sound', async () => {
    const r = await result(`kling/v4/video-to-video/edit/len3.63|${ID}`);
    assert.equal(r.state, 'done');
    const out = file('done.mp4', r.video);
    assert.ok(Math.abs(seconds(out) - 3.63) < 0.06, `${seconds(out)}`);
    assert.equal(hasAudio(out), false);
    assert.ok(Math.abs(r.seconds - 3.63) < 0.06);
  });
  await ok('a slowed short hook comes back at its original length', async () => {
    const r = await result(`kling/v4/video-to-video/edit/slow1.2649/len3.2|${ID}`);
    const out = file('slow.mp4', r.video);
    assert.ok(Math.abs(seconds(out) - 3.2 / 1.2649) < 0.07, `${seconds(out)}`);
    assert.equal(hasAudio(out), false);
  });
  await ok('a safety refusal is final (no identical paid retry); other failures may retry once', async () => {
    fetchReplies = [Response.json({ status: 'COMPLETED' }), Response.json({ detail: 'content moderation' }, { status: 422 })];
    const refused = await hookgen.checkHook(`kling/v4/video-to-video/edit/len3.63|${ID}`);
    assert.equal(refused.state, 'failed'); assert.equal(refused.final, true);
    fetchReplies = [Response.json({ status: 'COMPLETED' }), new Response('content moderation', { status: 422 })];
    assert.equal((await hookgen.checkHook(`kling/v4/video-to-video/edit/len3.63|${ID}`)).final, true, 'a plain-text refusal too');
    fetchReplies = [Response.json({ status: 'COMPLETED' }), Response.json({ detail: [{ type: 'content_policy_violation' }] }, { status: 422 })];
    assert.equal((await hookgen.checkHook(`kling/v4/video-to-video/edit/len3.63|${ID}`)).final, true, "fal's content_policy_violation too");
    fetchReplies = [Response.json({ status: 'COMPLETED' }), Response.json({ detail: 'internal error' }, { status: 422 })];
    assert.equal((await hookgen.checkHook(`kling/v4/video-to-video/edit/len3.63|${ID}`)).final, undefined);
    const jobs = fs.readFileSync('src/lib/server/generation-jobs.ts', 'utf8');
    assert.ok(jobs.includes('transition(job, job.fallback_used || task.final ? "failed" : "fallback", task.final ? task.error : undefined)'), 'the job settles a final refusal, refunded, with its message');
  });
  await ok('the status is polled on the kling/v4 app path (checked against a real fal request)', async () => {
    const seen = [];
    fetchReplies = [];
    const api = load('src/lib/server/hookgen.ts', {
      '@/lib/server/work-budget': budget, 'node:child_process': require('node:child_process'), 'node:crypto': require('node:crypto'), 'node:fs/promises': require('node:fs/promises'), 'node:os': os, 'node:path': path, 'node:util': require('node:util'),
      '@/lib/server/ffmpeg': ffmpeg, '@/lib/server/face-ref': {}, '@/lib/server/r2': {}, '@/lib/supabase/server': {}, '@/lib/server/store': {},
    }, { FAL_KEY: 'fixture-only' }, { fetch: async (url) => { seen.push(String(url)); return Response.json({ status: 'IN_PROGRESS' }); } });
    assert.equal((await api.checkHook(`kling/v4/video-to-video/edit/len3.63|${ID}`)).state, 'running');
    assert.equal(seen[0], `https://queue.fal.run/kling/v4/requests/${ID}/status`);
  });

  // ---- ready-made faces, the old path gone ----
  await ok('every library character has a ready-made face, a crop of its photo', () => {
    const ids = [...fs.readFileSync('src/lib/characters.ts', 'utf8').matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]).filter((id) => fs.existsSync(`public/characters/${id}.jpg`));
    assert.ok(ids.length >= 70, `${ids.length} characters`);
    for (const id of ids) {
      const face = `public/characters/faces/${id}.jpg`;
      assert.ok(fs.existsSync(face), face);
      const [fw, fh] = size(face), [pw, ph] = size(`public/characters/${id}.jpg`);
      assert.ok(Math.min(fw, fh) >= 512 && fw * fh < pw * ph, `${id}: ${fw}x${fh} of ${pw}x${ph}`);
    }
  });
  await ok('the faces ship with the generation routes', () => {
    const cfg = fs.readFileSync('next.config.ts', 'utf8');
    for (const route of ['/api/runs/*/generate', '/api/internal/generations']) assert.match(cfg, new RegExp(`"${route.replace(/[*/]/g, (c) => `\\${c}`)}": \\[[^\\]]*"\\./public/characters/faces/\\*\\.jpg"`), route);
  });
  await ok('the Gemini first frame and Kling 3.0 motion control are gone', () => {
    const g = fs.readFileSync('src/lib/server/hookgen.ts', 'utf8');
    assert.ok(!/motion-control|gemini-3\.1-flash-image|makeFirstFrame|outfitFor/.test(g));
    assert.ok(!fs.existsSync('src/lib/server/first-frame.ts'));
    assert.ok(!/WrongPerson|first-frame/.test(fs.readFileSync('src/lib/server/generation-jobs.ts', 'utf8')));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
}

finish('kling4-swap-checks', 35, () => n, main, 180000);
