// Captions stay inside the clip they start in (founder 2026-11-07: a hook caption showed over the next clip).
// Regression checks for every case found that day, including Codex's three review rounds. Offline; no network.
const assert = require('node:assert/strict');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

const adjust = load('src/lib/adjust.ts');
const studio = { DEFAULT_FONT: 'TikTok Sans' };
const client = load('src/lib/client.ts', { '@/lib/studio-data': studio });
const edit = load('src/lib/edit.ts', { '@/lib/adjust': adjust });
const gen = load('src/lib/generation-edit.ts', { '@/lib/edit': edit, '@/lib/studio-data': studio, '@/lib/client': client, '@/lib/adjust': adjust });
const { exportLayers } = load('src/lib/export-layers.ts', { '@/lib/client': client, '@/lib/edit': edit });
const { containTexts, timeline, snapTexts, retimeTexts } = edit;

const fr = (x) => Math.round(x * 30);
const clone = (x) => JSON.parse(JSON.stringify(x));
const T = (id, text, start, end) => ({ id, text, start, end, x: 50, y: 20, size: 4.6, font: 'TikTok Sans', color: '#ffffff', style: 'outline' });
const media = (n) => `00000000-0000-4000-8000-00000000000${n}.mp4`;
const hookOf = (seconds, speed = 1) => ({ mode: 'upload', text: '', start: 0, end: seconds, adjust: { speed }, generated: { src: '/api/media/' + media(0), seconds } });
const clip = (id, n, extra = {}) => ({ id, label: id, mediaId: media(n), name: id, seconds: 3, start: 0, end: 3, ...extra });
const runOf = (hook, clips, texts) => ({ id: 'r', title: 't', hook, demo: { clip: null, frame: 'none', mode: 'clips', clips }, texts });
let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

// Each caption, rendered to frames, stays inside the clip it starts in (cut frames from the cumulative timeline).
function framesInside(run, texts) {
  const segs = timeline(run, null);
  const cuts = segs.map((s) => [fr(s.offset), fr(s.offset + s.len)]);
  for (const t of texts) {
    const k = cuts.findIndex(([a, b]) => fr(t.start) >= a && fr(t.start) < b);
    if (k < 0) continue;
    if (fr(t.end) - 1 >= cuts[k][1]) return `${JSON.stringify(t.text)} shows on frame ${fr(t.end) - 1}, its clip ends at frame ${cuts[k][1] - 1}`;
  }
  return null;
}

// 1. The founder's video (timings kept, media replaced): the hook (2.58 s at 1.1x = 2.345 s) had three captions
//    ending at 2.645, over clip 2. Load (snap + contain) and export put every caption inside its clip, and every
//    caption keeps exactly its own frames (none cut to nothing; Codex round 2: millisecond starts on exact edges).
{
  const run = require('./fixtures/caption-leak-run.json');
  ok(framesInside(run, run.texts) !== null, 'fixture: the original data leaks (else this test proves nothing)');
  const segs = timeline(run, null);
  const loaded = containTexts(snapTexts(run.texts, segs), segs);
  const exported = exportLayers({ ...run, texts: loaded });
  ok(framesInside(run, loaded) === null, 'fixture after load: ' + framesInside(run, loaded));
  ok(framesInside(run, exportLayers(run)) === null, 'fixture export: ' + framesInside(run, exportLayers(run)));
  const cuts = segs.map((s) => [fr(s.offset), fr(s.offset + s.len)]);
  for (const t of run.texts) {
    const e = exported.find((x) => x.id === t.id);
    const k = cuts.findIndex(([a, b]) => fr(t.start) >= a && fr(t.start) < b);
    ok(fr(e.start) === fr(t.start) && fr(e.end) - 1 === Math.min(fr(t.end), cuts[k][1]) - 1, `${t.text}: frames ${fr(e.start)}-${fr(e.end) - 1}`);
  }
  ok(containTexts(loaded, segs) === loaded, 'containment is idempotent');
}

// 2. Codex round 1: a millisecond-rounded clip edge put a caption on the next clip's first frame.
{
  const run = runOf(hookOf(1.0166), [clip('a', 1)], [T('x', 'x', 0, 2)]);
  const segs = timeline(run, null);
  const [t] = containTexts(run.texts, segs);
  ok(fr(t.end) - 1 < fr(segs[1].offset), `1.0166 s hook: caption last frame ${fr(t.end) - 1}, next clip starts at frame ${fr(segs[1].offset)}`);
}

// 3. Codex round 1: a caption starting in a gap (magnet off) ran into the next clip.
{
  const run = runOf(hookOf(1), [clip('a', 1, { gap: 1 })], [T('g', 'gap', 1.5, 2.5)]);
  const [t] = containTexts(run.texts, timeline(run, null));
  ok(t.end === 2, `gap caption ends ${t.end}, next clip starts at 2`);
}

// 4. Codex rounds 1-2: a shorter regenerated hook moved hook captions (anywhere in the old hook, its last 50 ms
//    included) onto the demo; clean and dirty reconcile and the export must all keep them on the hook.
for (const start of [1.9, 1.95, 1.98, 1.999]) {
  const run = runOf({ ...hookOf(2), generated: { src: '/old', seconds: 2 } }, [clip('a', 1)], [T('hook', 'x', start, 2)]);
  const p = gen.generationPatch(run, run, { src: '/new', seconds: 1 }, 'x');
  const upd = { ...run, hook: p.hook, texts: p.texts };
  const all = [p.texts, gen.reconcileGeneration(run, upd, { texts: false, adjust: false }).texts, gen.reconcileGeneration(run, upd, { texts: true, adjust: true }).texts, exportLayers(upd)];
  for (const texts of all) ok(texts.find((t) => t.id === 'hook').end <= 1, `hook caption from ${start} stays on the 1 s hook`);
}

// 5. retimeTexts (trim / speed of one clip): a caption of the clip whose frames were cut keeps the clip's last
//    0.3 s instead of moving onto the next clip.
{
  const texts = retimeTexts([T('a', 'a', 2.5, 2.9)], 0, { start: 0, end: 3, speed: 1 }, { start: 0, end: 2, speed: 1 });
  ok(texts[0].start >= 1.7 - 1e-9 && texts[0].end <= 2, `retimed caption ${texts[0].start}-${texts[0].end} inside the 2 s clip`);
}

// 6. The server enforces it on every save that changes texts or clips (PATCH, integration through the real route).
{
  const stored = clone(runOf(hookOf(3), [clip('a', 1), clip('b', 2)], [T('h', 'hook line', 0, 3), T('t', 'demo', 3, 6)]));
  let saved = null;
  const route = load('src/app/api/runs/[id]/route.ts', {
    '@/lib/server/store': { getRun: async () => clone(stored), getReference: async () => null, deleteRun: async () => true, updateRun: async (_id, patch) => { saved = patch; return { ...stored, ...patch }; }, updateRunChecked: async (_id, patch) => { saved = patch; return { ...stored, ...patch }; } },
    '@/lib/types': {},
    '@/lib/server/run-validation': { validRunPatch: () => true },
    '@/lib/server/who': { currentUser: async () => 'u', signInFirst: () => Response.json({}, { status: 401 }) },
    '@/lib/render-limits': { renderLimitError: () => null },
    '@/lib/edit': edit,
    '@/lib/client': client,
  });
  const patch = (body) => route.PATCH(new Request('http://x/api/runs/r', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), { params: Promise.resolve({ id: 'r' }) });
  module.exports.pending = (async () => {
    // A trim that shortens the hook to 2 s (clips only, no texts in the body): the stored hook caption is cut to 2.
    await patch({ hook: { ...stored.hook, end: 2 } });
    ok(saved?.texts?.find((t) => t.id === 'h').end === 2, 'timeline-only PATCH contains the stored captions');
    // Texts sent running past their clip are stored inside it.
    await patch({ texts: [T('h', 'hook line', 0, 5)] });
    ok(saved?.texts?.[0].end === 3, 'texts PATCH stores the caption inside its clip');
  })();
}

finish('caption-checks', 38, () => checks, () => module.exports.pending);
