// Upload copies made in the browser, with the render server as the fallback (founder 2026-11-23: a 4K iPhone clip
// waited 11-15 minutes for the server's copies). Offline: the plan (which clips the browser takes), the server staying
// out of the way while the browser works (and taking over when it does not), the upload steps (owner only, exact
// sizes), and the client's flow that hands the job to the server on any failure. The real conversion runs in Chrome:
// bash scripts/browser/copies.sh.
const assert = require('node:assert/strict');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

let checks = 0;
const EXPECTED = 43;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

finish('browser-copies-checks', EXPECTED, () => checks, async () => {
  // ---- the plan ----
  const bc = load('src/lib/browser-copies.ts', { mediabunny: {} });
  const base = { width: 3840, height: 2160, fps: 30, seconds: 20, hdr: false, decodable: true, hasAudio: true, audioDecodable: true, colorTagged: true };
  const plan = (x) => JSON.parse(JSON.stringify(bc.copyPlan({ ...base, ...x })));
  ok(JSON.stringify(plan({})) === JSON.stringify({ preview: { width: 854, height: 480 }, cap: false }), `4K landscape: preview 854x480 (${JSON.stringify(plan({}))})`);
  ok(plan({ fps: 60 }).cap === true && plan({ fps: 30.4 }).cap === false && plan({ fps: 24 }).cap === false, 'capped over 30.5 fps like the server -fpsmax; an iPhone 30.4 keeps every frame');
  ok(JSON.stringify(plan({ width: 2160, height: 3840 }).preview) === JSON.stringify({ width: 480, height: 854 }), 'portrait: 480x854');
  ok(JSON.stringify(plan({ width: 320, height: 240 }).preview) === JSON.stringify({ width: 320, height: 240 }), 'never larger than the source');
  ok(plan({ hasAudio: true, audioDecodable: false }).server === 'cannot decode sound' && !plan({ hasAudio: false, audioDecodable: false }).server, 'sound this browser cannot decode goes to the server; no sound at all is fine');
  const src = require('node:fs').readFileSync('src/lib/browser-copies.ts', 'utf8');
  ok(/const s = Math\.floor\(t \* 30 \+ 1e-6\);\s*\n\s*if \(t < 0 \|\| \(plan\.cap && s <= slot\)\) continue;/.test(src) && src.includes('output.addVideoTrack(video);'), 'at most one frame per 1/30 s slot, on the clip\'s own timestamps (no 30 Hz grid)');
  ok(plan({ hdr: true }).server === 'HDR', 'HDR goes to the server (its tone-map)');
  ok(plan({ decodable: false }).server === 'cannot decode', 'video this browser cannot decode (HEVC on some PCs) goes to the server');
  ok(plan({ colorTagged: false }).server === 'untagged colour', 'a clip without colour tags goes to the server (Chrome shifted its greens)');
  ok(plan({ seconds: 121 }).server === 'length' && plan({ seconds: 0 }).server === 'length' && !plan({ seconds: 120 }).server, 'over 2 minutes (memory) or unknown length goes to the server');
  ok(plan({ width: 1921, height: 1081 }).preview.width % 2 === 0 && plan({ width: 1921, height: 1081 }).preview.height % 2 === 0, 'preview sizes are even');
  ok(bc.MASTER.width === 1080 && bc.MASTER.height === 1920, 'the working copy is exactly 1080x1920, as the export expects');
  const kept = (fps, sec = 2) => { let slot = -1, n = 0; for (let i = 0; i < fps * sec; i++) { const t = i / fps, s = Math.floor(t * 30 + 1e-6); if (s > slot) { slot = s; n++; } } return n / sec; };
  ok(kept(60) === 30 && kept(31) <= 30 && kept(50) >= 25 && kept(24) === 24 && kept(30) === 30, `slots: 60->${kept(60)}, 31->${kept(31)}, 50->${kept(50)}, 24->${kept(24)}, 30->${kept(30)} fps`);

  // ---- the server stays out of the way while the browser copies ----
  let marker = null, now = Date.now(), posted = 0, objects = new Set(), copied = [], deleted = [], temps = [];
  const r2 = {
    objectInfo: async (key) => (key.endsWith('.copying') ? marker : objects.has(key) || key.endsWith('.mov') ? { size: 1, mime: 'video/mp4', etag: 'e' } : null),
    putObject: async (key) => { if (key.endsWith('.copying')) marker = { size: 13, mime: 'text/plain', etag: 'm', modified: now }; },
    deleteObject: async (key) => { deleted.push(key); if (key.endsWith('.copying')) marker = null; objects.delete(key); },
    deleteObjectStrict: async (key) => { if (key.endsWith('.copying')) marker = null; },
    copyObject: async (from, to) => { copied.push(`${from.split('.').slice(-2, -1)[0]}->${to.split('.').slice(-2, -1)[0]}`); objects.add(to); },
    objectStart: async (key) => (objects.has(`bad:${key}`) ? new Uint8Array(12) : new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109])),
    signedGet: async (key) => `https://r2.invalid/${key}`,
    signedPut: async (key, type, sec, size) => `https://r2.invalid/${key}?type=${type}&size=${size}`,
  };
  const pv = load('src/lib/server/previews.ts', { '@/lib/server/r2': r2, '@/lib/supabase/server': { createSupabaseAdminClient: () => ({ from: () => ({ insert: async (rows) => { temps.push(...rows); return { error: null }; } }) }) } }, { RENDER_URL: 'https://render.invalid', RENDER_SECRET: 's' }, { fetch: async () => { posted++; return new Response('{}'); }, Date });
  const id = '11111111-1111-4111-8111-111111111111.mov';
  await pv.claimBrowserCopy(id);
  ok(await pv.browserCopying(id), 'a fresh claim means the browser is copying');
  await pv.requestPreview(id);
  ok(posted === 0, 'the server does not start its copy while the browser works');
  marker.modified = now - pv.BROWSER_COPY_MS - 1000;
  ok(!(await pv.browserCopying(id)), 'a browser that went quiet for 6 min is forgotten');
  await pv.requestPreview(id);
  ok(posted === 1, 'and the server makes the copies then (closed tab)');
  const id2 = '22222222-2222-4222-8222-222222222222.mov';
  await pv.claimBrowserCopy(id2); posted = 0;
  await pv.requestPreview(id2, true);
  ok(posted === 1, 'forced (the fallback): the server copies even while a marker is there');
  marker = null;
  ok(!(await pv.browserCopying(id)), 'no marker: not copying');
  const links = await pv.copyUploadLinks(id, 'u1', 1234, 56789);
  ok(/tmp\/copies\/.*\.p480\.mp4\?type=video\/mp4&size=1234/.test(links.preview) && /tmp\/copies\/.*\.v1080\.mp4\?type=video\/mp4&size=56789/.test(links.master) && pv.isAttempt(links.attempt), 'upload links: staging keys of their own, exact sizes, an attempt id');
  ok(temps.length === 2 && temps.every((t) => t.user_id === 'u1' && t.key.startsWith('tmp/copies/')), 'staging files are temporary objects (removed after a day, and with the account)');
  const stage = (kind) => `tmp/copies/${id.replace(/\.mov$/, '')}.${links.attempt}.${kind}.mp4`;
  await pv.claimBrowserCopy(id);
  // Not uploaded yet: nothing published.
  ok(!(await pv.publishCopies(id, links.attempt)) && copied.length === 0, 'a pair not uploaded is not published');
  objects.add(stage('p480')); objects.add(stage('v1080')); objects.add(`bad:${stage('v1080')}`);
  ok(!(await pv.publishCopies(id, links.attempt)) && copied.length === 0, 'a copy that is not an MP4 is not published');
  objects.delete(`bad:${stage('v1080')}`); objects.add(stage('p480')); objects.add(stage('v1080'));
  marker.modified = Date.now() - pv.BROWSER_COPY_MS - 1000;
  ok(!(await pv.publishCopies(id, links.attempt)) && copied.length === 0, 'a claim that lapsed (the server is copying): a late pair is not published');
  objects.add(stage('p480')); objects.add(stage('v1080')); await pv.claimBrowserCopy(id);
  ok(await pv.publishCopies(id, links.attempt) && copied.join() === 'p480->p480,v1080->v1080' && deleted.includes(stage('p480')), 'a good pair: preview then master put in place, staging removed');
  copied = []; objects.add(stage('p480')); objects.add(stage('v1080'));
  ok(await pv.publishCopies(id, links.attempt) && copied.length === 0, 'copies already in place (or a repeated request) are never replaced, and say done');

  // ---- the upload steps ----
  let owner = 'u1', requested = 0, released = 0, claimed = 0, ready = false, afterFns = [], live = true, good = false, forced = false;
  const route = load('src/app/api/uploads/route.ts', {
    'next/server': { after: (fn) => { afterFns.push(fn); } },
    '@/lib/server/store': { cloud: () => true, extFor: (m) => (m.startsWith('video/') ? 'mp4' : null), isMediaId: (x) => /^[0-9a-f-]{36}\.\w+$/.test(x), ownMedia: async (x, who) => (who === owner ? { mime: 'video/quicktime', size: 10 } : null) },
    '@/lib/server/uploads': { startUpload: async () => ({}), finishUpload: async (_w, mid) => ({ mediaId: mid, mime: 'video/quicktime' }), expireUploads: async () => {} },
    '@/lib/server/who': { currentUser: async () => 'u1', signInFirst: () => Response.json({}, { status: 401 }) },
    '@/lib/server/previews': {
      claimBrowserCopy: async () => { claimed++; }, releaseBrowserCopy: async () => { released++; }, releaseBrowserCopyStrict: async () => { released++; throw Error('R2 down'); }, requestPreview: async (_i, force) => { requested++; forced = force; },
      copyUploadLinks: async (_i, who, p, m) => ({ attempt: 'a', preview: `p${p}`, master: `m${m}`, who }), previewReady: async () => ready, masterReady: async () => ready,
      browserCopying: async () => live, isAttempt: (x) => x === 'a', publishCopies: async () => good,
    },
    '@/lib/server/thumbs': { thumbLink: async () => '' },
  });
  const post = async (body) => { afterFns = []; const r = await route.POST(new Request('https://x/api/uploads', { method: 'POST', body: JSON.stringify({ mime: 'video/quicktime', mediaId: id, ...body }) })); for (const f of afterFns) await f(); return r; };
  await post({ step: 'finish', copies: 'browser' });
  ok(claimed === 1 && requested === 0, 'finish with the browser copying: claimed, no server copy');
  await post({ step: 'finish' });
  ok(requested === 1, 'finish without it: the server copy as before');
  const linksR = await (await post({ step: 'copies', previewSize: 100, masterSize: 200 })).json();
  ok(linksR.preview === 'p100' && linksR.master === 'm200', 'copies: upload links with the sizes given');
  ok((await post({ step: 'copies', previewSize: 0, masterSize: 200 })).status === 413 && (await post({ step: 'copies', previewSize: 100, masterSize: 3 * 10 + 51 * 1024 * 1024 })).status === 413, 'bad copies, or bigger than the original allows, are refused');
  live = false;
  ok((await post({ step: 'copies', previewSize: 100, masterSize: 200 })).status === 409, 'no live claim (it lapsed, the server is copying): no links');
  live = true;
  owner = 'someone-else';
  ok((await post({ step: 'copies', previewSize: 100, masterSize: 200 })).status === 404 && (await post({ step: 'server-copy' })).status === 404, 'only the owner (never shared library media) gets links or asks');
  owner = 'u1';
  ready = true;
  ok((await (await post({ step: 'copies', previewSize: 100, masterSize: 200 })).json()).ready === true, 'copies already there: nothing to upload');
  ready = false; requested = 0; released = 0;
  const missing = await post({ step: 'copies-done', attempt: 'a' });
  ok(missing.status === 409 && released === 1 && requested === 1 && forced === true, 'copies-done with a bad pair: the server takes over (forced)');
  good = true; requested = 0; released = 0;
  ok((await post({ step: 'copies-done', attempt: 'a' })).status === 200 && released === 1 && requested === 0, 'copies-done with a good pair: published, marker cleared, no server copy');
  requested = 0; released = 0;
  ok((await post({ step: 'copies-done', attempt: '../x' })).status === 409, 'a made-up attempt id publishes nothing');
  requested = 0; released = 0;
  ok((await post({ step: 'server-copy' })).status === 200 && released === 1 && requested === 1 && forced === true, 'server-copy: forced, even when the marker cannot be removed');

  // ---- the client flow ----
  let calls = [];
  const client = load('src/lib/client.ts', { '@/lib/browser-copies': {}, '@/lib/edit-version': { touchesEdit: () => false }, '@/lib/studio-data': { DEFAULT_FONT: 'x' } }, {}, {
    fetch: async (url, init) => {
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      calls.push(body?.step ?? `${init?.method} ${url}`);
      if (body?.step === 'copies-done') client.__lastDone = body.attempt;
      if (body?.step === 'copies') return Response.json(client.__links ?? { preview: 'https://put/p', master: 'https://put/m' });
      if (String(url).startsWith('https://put/')) return new Response('', { status: client.__putStatus ?? 200 });
      return Response.json({ ok: true });
    },
  });
  const blobs = { preview: new Blob(['p']), master: new Blob(['mm']) };
  calls = [];
  client.__links = { attempt: 'a1', preview: 'https://put/p', master: 'https://put/m' };
  ok(await client.deliverCopies(id, 'video/quicktime', Promise.resolve(blobs)) === 'browser' && calls.join() === 'copies,PUT https://put/m,PUT https://put/p,copies-done' && client.__lastDone === 'a1', `copies made: links, both uploaded, done with the attempt (${calls.join()})`);
  calls = [];
  ok(await client.deliverCopies(id, 'video/quicktime', Promise.resolve(null)) === 'server' && calls.join() === 'server-copy', 'no copies (HDR, no decoder...): the server is asked');
  calls = []; client.__putStatus = 500;
  ok(await client.deliverCopies(id, 'video/quicktime', Promise.resolve(blobs)) === 'server' && calls.at(-1) === 'server-copy', 'an upload that fails: the server is asked');
  client.__putStatus = 200; calls = [];
  ok(await client.deliverCopies(id, 'video/quicktime', Promise.reject(new Error('crash'))) === 'server' && calls.join() === 'server-copy', 'a crash while copying: the server is asked');
  calls = []; client.__links = { preview: 'https://put/p', master: 'https://put/m' };
  ok(await client.deliverCopies(id, 'video/quicktime', Promise.resolve(blobs)) === 'server' && calls.join() === 'copies,server-copy', 'links without an attempt id: the server is asked');
  calls = []; client.__links = { ready: true };
  ok(await client.deliverCopies(id, 'video/quicktime', Promise.resolve(blobs)) === 'browser' && calls.join() === 'copies', 'copies already there: nothing uploaded');
});
