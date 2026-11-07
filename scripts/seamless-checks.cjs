// Clips join with no gap and captions stay on their own clip (founder 2026-11-07: "0 gaps, like CapCut's magnet" and
// "the subtitle matches the clip 100% of the time"). Fuzzed over thousands of random timelines with a fixed seed, so
// every run checks the same cases. Offline, no ffmpeg (scripts/join-checks.cjs renders real files).
//  A. Export joins: plan()'s clips sit back to back, frame after frame; no empty step unless the user left space.
//  B. Captions: every caption's export frames lie inside the one clip (or space) it starts in, start on that clip's
//     first frame when it starts with the clip, and end on its last frame when it ends with the clip. Found
//     2026-11-07: 0.3% of captions showed one frame on the next or previous clip, because the editor and the export
//     add clip lengths in a different order and round some edges the other way.
//  C. Magnet: with the magnet on, every edit (trim, split, delete piece, delete clip, delete selection, insert, move)
//     leaves no space between clips.
const assert = require('node:assert/strict');
const path = require('node:path');
const { load, finish } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

const adjust = load('src/lib/adjust.ts');
const studio = { DEFAULT_FONT: 'TikTok Sans' };
const client = load('src/lib/client.ts', { '@/lib/studio-data': studio });
const edit = load('src/lib/edit.ts', { '@/lib/adjust': adjust });
const sound = load('src/lib/sound.ts');
const layers = load('src/lib/export-layers.ts', { '@/lib/client': client, '@/lib/edit': edit });
const ops = load('src/lib/edit-ops.ts', { '@/lib/adjust': adjust, '@/lib/client': client, '@/lib/edit': edit, '@/lib/sound': sound });
const { timeline, containTexts, segSpeed, videoLength, ownedBy, textOwner } = edit;

let checks = 0;
const EXPECTED = 19;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ms = (x) => Math.round(x * 1000) / 1000;
const media = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}.mp4`;
const SPEEDS = [1, 1, 1, 0.5, 0.75, 1.15, 1.25, 1.5, 2];
let uid = 0;

/** A random run: a generated hook and 0-3 demo clips, each cut into 1-3 pieces on a random grid. */
function randomRun() {
  const grid = pick([0.001, 1 / 30, 0.05, 0.01]);
  const t = () => { const v = rnd() * 3; return grid === 1 / 30 ? Math.round(v * 30) / 30 : ms(Math.round(v / grid) * grid); };
  const pieces = () => {
    const n = 1 + Math.floor(rnd() * 3), ps = [];
    for (let i = 0; i < n; i++) { let a = t(), b = t(); if (a > b) [a, b] = [b, a]; if (b - a < 0.02) b = a + 0.05; ps.push({ id: `p${uid++}`, start: ms(a), end: ms(b) }); }
    return ps;
  };
  const span = (ps) => ({ start: Math.min(...ps.map((p) => p.start)), end: Math.max(...ps.map((p) => p.end)), parts: ps });
  const hook = { mode: 'upload', text: '', ...span(pieces()), adjust: { speed: pick(SPEEDS) }, generated: { src: '/api/media/' + media(0), seconds: 4 } };
  const clips = [];
  for (let i = 0, n = Math.floor(rnd() * 4); i < n; i++) clips.push({ id: `c${uid++}`, label: 'c', mediaId: media(i + 1), name: 'c', seconds: 4, ...span(pieces()), adjust: { speed: pick(SPEEDS) } });
  return { id: 'r', title: 't', hook, demo: { clip: null, frame: 'none', mode: 'clips', clips }, texts: [] };
}
/** The export's spec for a run, as /api/runs/[id]/export builds it (segments only). */
const specOf = (segs) => ({ width: 32, height: 32, fps: 30, total: videoLength(segs), segments: segs.map((s) => ({ gap: s.gap, speed: segSpeed(s), pieces: s.parts })), sounds: [], overlays: [] });

finish('seamless-checks', EXPECTED, () => checks, async () => {
  const { plan, layout, textFrames, planLength } = await import(path.join(process.cwd(), 'render/render.mjs'));

  // A. Export joins.
  {
    let runs = 0, joins = 0, bad = null;
    for (let k = 0; k < 5000 && !bad; k++) {
      const segs = timeline(randomRun(), null), spec = specOf(segs), { steps, segs: where } = layout(spec);
      runs++;
      if (steps.some((s) => s.kind === 'gap')) bad = `run ${k}: an empty step with no space left by the user`;
      if (steps.some((s) => !(s.frames > 0))) bad = `run ${k}: a step with no frames`;
      for (let i = 1; i < where.length && !bad; i++) { joins++; if (where[i].clip.from !== where[i - 1].clip.to) bad = `run ${k}: clip ${i} starts on frame ${where[i].clip.from}, the clip before ends on ${where[i - 1].clip.to}`; }
      const frames = steps.reduce((n, s) => n + s.frames, 0);
      if (!bad && frames !== where[where.length - 1].clip.to) bad = `run ${k}: steps hold ${frames} frames, the last clip ends on ${where[where.length - 1].clip.to}`;
      if (!bad && JSON.stringify(plan(spec)) !== JSON.stringify(steps)) bad = `run ${k}: plan() and layout() disagree`;
    }
    ok(!bad, bad ?? '');
    ok(runs === 5000 && joins > 5000, `export joins: ${runs} runs, ${joins} joins checked`);
  }
  // Space the user left (magnet off) is its own step, and the clip after it starts right where the space ends.
  {
    const run = randomRun();
    run.demo.clips = [{ id: 'g1', label: 'g', mediaId: media(5), name: 'g', seconds: 3, start: 0, end: 1, gap: 0.5 }];
    const { steps, segs: where } = layout(specOf(timeline(run, null)));
    ok(steps.filter((s) => s.kind === 'gap').length === 1 && where[1].gap.from === where[0].clip.to && where[1].clip.from === where[1].gap.to && where[1].gap.to - where[1].gap.from === 15, 'a 0.5 s space is exactly 15 black frames between the clips');
  }

  // B. Captions.
  {
    let captions = 0, leaks = 0, late = 0, short = 0, vanished = 0, fallback = 0, first = null;
    for (let k = 0; k < 20000; k++) {
      const segs = timeline(randomRun(), null), spec = specOf(segs), where = layout(spec);
      const end = where.segs[where.segs.length - 1].clip.to;
      // Captions on each clip: from its exact start, from its start in milliseconds (as saved), and from inside it;
      // all made too long, then contained as every save does.
      const texts = segs.flatMap((s, i) => [
        { id: `e${i}`, start: s.offset, end: 99 },
        { id: `m${i}`, start: ms(s.offset), end: 99 },
        { id: `x${i}`, start: ms(s.offset + rnd() * s.len * 0.9), end: 99 },
        { id: `w${i}`, start: s.offset, end: s.offset + s.len },
      ]);
      for (const t of containTexts(texts, segs)) {
        const owner = segs.findIndex((s) => ownedBy(t.start, s.offset, s.len));
        if (owner < 0) continue;
        const clip = where.segs[owner].clip;
        if (clip.to <= clip.from) continue;
        // As the export sends it: the editor's owner (exportLayers). The fallback (no owner) must agree.
        const f = textFrames(spec, where, { ...t, owner: textOwner(t.start, segs) }), to = Math.min(f.to, end);
        const g = textFrames(spec, where, t);
        if (g.from !== f.from || g.to !== f.to) fallback++;
        captions++;
        // Codex 2026-11-07: a caption with frames on its own clip must show on them, never vanish.
        const plain = [Math.max(Math.round(t.start * 30), clip.from), Math.min(Math.round(t.end * 30), clip.to)];
        if (plain[1] > plain[0] && !(to > f.from)) { vanished++; first ??= `run ${k} caption ${t.id} (${t.start}-${t.end}) shows on no frame, its clip ${clip.from}-${clip.to}`; }
        if (f.from < clip.from || to > clip.to) { leaks++; first ??= `run ${k} caption ${t.id} (${t.start}-${t.end}): frames ${f.from}-${to}, its clip ${clip.from}-${clip.to}`; }
        else if (t.id[0] !== 'x' && f.from !== clip.from) { late++; first ??= `run ${k} caption ${t.id}: starts on frame ${f.from}, its clip on ${clip.from}`; }
        else if (t.id[0] === 'w' && to !== clip.to) { short++; first ??= `run ${k} caption ${t.id}: ends on frame ${to}, its clip on ${clip.to}`; }
      }
    }
    ok(leaks === 0, `no caption frame on another clip (${leaks} of ${captions}): ${first}`);
    ok(late === 0, `a caption made for a clip starts on its first frame (${late} late): ${first}`);
    ok(short === 0, `a caption over a whole clip ends on its last frame (${short} short): ${first}`);
    ok(vanished === 0, `no caption vanishes (${vanished}): ${first}`);
    ok(fallback < captions / 1000, `without an owner the export judges the same frames (${fallback} of ${captions} differ)`);
    ok(captions > 150000, `${captions} captions checked`);
  }
  // Cases the fuzz found (2026-11-07), pinned: an edge the editor puts at 3.3499999999999996 s and the export on frame
  // 101; a caption saved at 4.15 over a clip the export ends on frame 259, not 260.
  {
    const spec = { fps: 30, total: 5, segments: [{ gap: 0, speed: 1, pieces: [{ start: 0, end: 1.05 }] }, { gap: 0, speed: 1, pieces: [{ start: 0, end: 1.15 }, { start: 1, end: 2.15 }] }, { gap: 0, speed: 1.5, pieces: [{ start: 0, end: 1 }] }], sounds: [], overlays: [] };
    const where = layout(spec), [h, a, b] = where.segs.map((s) => s.clip);
    const exact = { start: 1.05 + (1.15 + 1.15), end: 9 };
    const f = textFrames(spec, where, exact);
    ok(f.from >= b.from && f.to <= b.to, `caption at the editor's edge stays on the third clip: ${f.from}-${f.to}, clip ${b.from}-${b.to}`);
    const whole = textFrames(spec, where, { start: 1.05, end: 1.05 + 1.15 + 1.15 });
    ok(whole.from === a.from && whole.to === a.to && h.to === a.from, `caption over the whole second clip: ${whole.from}-${whole.to}, clip ${a.from}-${a.to}`);
  }
  // Codex 2026-11-07: a clip ending at 1.0168 s, a caption on its last 0.8 ms (1.016-1.0168). The editor gives it to
  // that clip; the export must show it there (frame 30), not hand it to the next clip and show it nowhere.
  {
    const run = { id: 'r', title: 't', texts: [], hook: { mode: 'upload', text: '', start: 0, end: 1.0168, adjust: { speed: 1 }, generated: { src: '/api/media/' + media(0), seconds: 4 } }, demo: { clip: null, frame: 'none', mode: 'clips', clips: [{ id: 'n1', label: 'n', mediaId: media(1), name: 'n', seconds: 3, start: 0, end: 2 }] } };
    const segs = timeline(run, null), spec = specOf(segs), where = layout(spec);
    const t = { start: 1.016, end: 1.0168 };
    const owner = textOwner(t.start, segs), f = textFrames(spec, where, { ...t, owner });
    ok(owner && owner.seg === 0 && !owner.gap && f.from === 30 && f.to === 31 && where.segs[0].clip.to === 31, `last-millisecond caption shows on the hook's last frame: owner ${JSON.stringify(owner)}, frames ${f.from}-${f.to}`);
  }
  // Codex 2026-11-07: a clip ending at 1.01 s exports 30 whole frames (1 s); a caption at 1.001-1.01 has nothing left
  // and is left out, never sent as start 1.001, end 1 (the render job refuses it).
  {
    const { validJob } = await import(path.join(process.cwd(), 'render/limits.mjs'));
    const LIMITS = require(path.join(process.cwd(), 'render/constraints.json'));
    const run = { id: 'r', title: 't', texts: [], hook: { mode: 'upload', text: '', start: 0, end: 1.01, adjust: { speed: 1 }, generated: { src: '/api/media/' + media(0), seconds: 4 } }, demo: { clip: null, frame: 'none', mode: 'clips', clips: [] } };
    const segs = timeline(run, null), spec = specOf(segs);
    const total = planLength(spec);
    const kept = layers.exportWindow({ start: 0.5, end: 1.01 }, total), gone = layers.exportWindow({ start: 1.001, end: 1.01 }, total);
    const job = (overlays) => ({ spec: { ...spec, width: LIMITS.width, height: LIMITS.height, total, segments: spec.segments.map((x) => ({ ...x, url: 'https://x.r2.cloudflarestorage.com/a', volume: 1 })), overlays }, output: { url: 'https://x.r2.cloudflarestorage.com/o', contentType: 'video/mp4' }, meta: { who: '00000000-0000-4000-8000-000000000000' } });
    ok(total === 1 && gone === null && kept && kept.start === 0.5 && kept.end === 1, `caption past the whole frames left out: total ${total}, ${JSON.stringify(gone)}, ${JSON.stringify(kept)}`);
    const o = (w) => ({ url: 'https://x.r2.cloudflarestorage.com/t', ...w, x: 1, y: 1 });
    ok(validJob(job([o(kept)])) && !validJob(job([o({ start: 1.001, end: 1 })])), 'the render job accepts the kept caption and would refuse the unclipped one');
  }
  // Captions in a space end where the next clip starts; captions past the end keep plain frames.
  {
    const spec = { fps: 30, total: 3, segments: [{ gap: 0, speed: 1, pieces: [{ start: 0, end: 1 }] }, { gap: 0.5, speed: 1, pieces: [{ start: 0, end: 1.5 }] }], sounds: [], overlays: [] };
    const where = layout(spec);
    const inGap = textFrames(spec, where, { start: 1.1, end: 2.4 });
    ok(inGap.from === 33 && inGap.to === where.segs[1].gap.to && inGap.to === 45, `caption in the space stops where the clip starts: ${inGap.from}-${inGap.to}`);
    const past = textFrames(spec, where, { start: 3.5, end: 4 });
    ok(past.from === 105 && past.to === 120, 'caption past the end keeps its rounded frames');
  }

  // C. Magnet on: no edit leaves space between clips.
  {
    let edits = 0, bad = null;
    for (let k = 0; k < 3000 && !bad; k++) {
      let run = randomRun();
      for (let step = 0; step < 6 && !bad; step++) {
        const segs = timeline(run, null), seg = pick(segs), part = pick(seg.parts), kind = pick(['trim', 'split', 'dropPiece', 'deleteSel', 'deleteClip', 'insert', 'move']);
        let change = null;
        if (kind === 'trim') change = ops.partsChange(run, null, seg.id, seg.parts.map((p) => (p.id === part.id ? { ...p, end: ms(Math.max(p.start + 0.05, p.end - rnd() * 0.5)) } : p)), false);
        else if (kind === 'split') { const at = ms((part.start + part.end) / 2); change = ops.partsChange(run, null, seg.id, seg.parts.flatMap((p) => (p.id === part.id ? [{ ...p, end: at }, { id: `p${uid++}`, start: at, end: p.end }] : [p])), false); }
        else if (kind === 'dropPiece' && seg.parts.length > 1) change = ops.partsChange(run, null, seg.id, seg.parts.filter((p) => p.id !== part.id), false);
        else if (kind === 'deleteSel' && segs.length > 1) change = ops.deleteSelection(run, null, [], [{ seg: seg.id, part: part.id }], false);
        else if (kind === 'deleteClip' && seg.id !== 'hook') change = edit.removeDemoClip(run, seg.id, run.texts, false);
        else if (kind === 'insert') change = ops.insertClipsChange(run, [{ id: `c${uid++}`, label: 'n', mediaId: media(9), name: 'n', seconds: 2, start: 0, end: ms(0.3 + rnd() * 1.5) }], Math.floor(rnd() * 4));
        else if (kind === 'move' && segs.length > 2 && seg.id !== 'hook') change = edit.moveClipPiece(run, run.texts, seg.id, part.id, pick([...segs.filter((s) => s.id !== 'hook' && s.id !== seg.id).map((s) => s.id), null]), `c${uid++}`);
        if (!change) continue;
        run = { ...run, ...change };
        edits++;
        const after = timeline(run, null);
        const spaced = after.find((s) => s.gap !== 0);
        if (spaced) bad = `run ${k}, ${kind}: clip ${spaced.id} has ${spaced.gap} s of space before it`;
        for (let i = 1; i < after.length && !bad; i++) if (after[i].offset !== after[i - 1].offset + after[i - 1].len) bad = `run ${k}, ${kind}: clip ${i} starts at ${after[i].offset}, the clip before ends at ${after[i - 1].offset + after[i - 1].len}`;
        const where = layout(specOf(after));
        if (!bad && where.steps.some((s) => s.kind === 'gap')) bad = `run ${k}, ${kind}: the export has an empty step`;
      }
    }
    ok(!bad, bad ?? '');
    ok(edits > 8000, `${edits} magnet edits checked`);
  }
  // Magnet off keeps the space (the clip after stays put), so the check above is not passing by accident.
  {
    const run = randomRun();
    run.demo.clips = [{ id: 'k1', label: 'k', mediaId: media(6), name: 'k', seconds: 3, start: 0, end: 2 }, { id: 'k2', label: 'k', mediaId: media(7), name: 'k', seconds: 3, start: 0, end: 2 }];
    const seg = timeline(run, null)[1];
    const held = ops.partsChange(run, null, 'k1', [{ ...seg.parts[0], end: 1 }], true);
    ok(held && timeline({ ...run, ...held }, null)[2].gap === 1, 'magnet off: trimming 1 s leaves 1 s of space');
  }
});
