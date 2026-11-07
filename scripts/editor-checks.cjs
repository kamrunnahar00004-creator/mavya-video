// Editor group selection, delete-many, group paste and inserts (founder 2026-11-07: multi-select and CapCut keys).
// Regression checks for every case the founder and Codex's reviews raised that day. Offline; no browser.
const assert = require('node:assert/strict');
const path = require('node:path');
const { load } = require('./check-module.cjs');
process.chdir(path.join(__dirname, '..'));

const adjust = load('src/lib/adjust.ts');
const studio = { DEFAULT_FONT: 'TikTok Sans' };
const client = load('src/lib/client.ts', { '@/lib/studio-data': studio });
const edit = load('src/lib/edit.ts', { '@/lib/adjust': adjust });
const ops = load('src/lib/edit-ops.ts', { '@/lib/adjust': adjust, '@/lib/client': client, '@/lib/edit': edit });
const sel = load('src/lib/selection.ts');
const sound = load('src/lib/sound.ts');
const { timeline } = edit;

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
// Values from the module sandbox (vm) have its own Array prototype: compare as JSON.
const eq = (a, b, msg) => { checks++; assert.equal(JSON.stringify(a), JSON.stringify(b), msg); };
const T = (id, start, end) => ({ id, text: id, start, end, x: 50, y: 20, size: 4.6, font: 'TikTok Sans', color: '#fff', style: 'outline' });
const media = (n) => `00000000-0000-4000-8000-00000000000${n}.mp4`;
const clip = (id, n, extra = {}) => ({ id, label: id, mediaId: media(n), name: id, seconds: 3, start: 0, end: 3, ...extra });
const hook = { mode: 'upload', text: '', clip: { mediaId: media(0), name: 'hook', kind: 'video', offset: 0, length: 3 }, start: 0, end: 3 };
const runOf = (clips, texts) => ({ id: 'r', title: 't', hook, demo: { clip: null, frame: 'none', mode: 'clips', clips }, texts });
const three = () => [clip('g', 1), clip('b', 2), clip('o', 3)];

// 1. Group selection: toggling, and the stale-group rule (Codex: select a group, add a sound, Delete removed the
//    old group instead of the sound).
{
  eq(sel.toggleInGroup(['t:a'], 't:b'), ['t:a', 't:b'], 'Ctrl-click adds');
  eq(sel.toggleInGroup(['t:a', 't:b'], 't:a'), ['t:b'], 'Ctrl-click again takes it out');
  const keys = ['t:a', 't:b'];
  eq(sel.activeGroup(keys, { selected: true, soundSelected: false, choosing: false, hasSounds: true }), keys, 'a group with a clip/text selected acts');
  eq(sel.activeGroup(keys, { selected: false, soundSelected: true, choosing: false, hasSounds: true }), [], 'a sound picked after the group: the group is inert');
  eq(sel.activeGroup(keys, { selected: true, soundSelected: false, choosing: true, hasSounds: true }), [], 'the sound chooser open over sounds: inert');
  eq(sel.activeGroup(keys, { selected: true, soundSelected: false, choosing: true, hasSounds: false }), keys, 'no sounds at all (the chooser is the empty state): the group still acts');
  eq(sel.activeGroup(['s:1', 's:2'], { selected: false, soundSelected: false, choosing: false, hasSounds: true }), ['s:1', 's:2'], 'a sound-only group acts');
  eq(sel.activeGroup(['t:a'], { selected: true, soundSelected: false, choosing: false, hasSounds: false }), [], 'one key is not a group');
}

// 2. Delete-many: texts, pieces of one clip, pieces across clips, whole clips, the hook kept; magnet on and off.
{
  const split = { ...clip('g', 1), parts: [{ id: 'p1', start: 0, end: 1 }, { id: 'p2', start: 1, end: 2 }, { id: 'p3', start: 2, end: 3 }] };
  const run = runOf([split, clip('b', 2), clip('o', 3)], [T('ta', 3, 4), T('tb', 6, 9), T('tc', 9, 12)]);
  let out = ops.deleteSelection(run, null, ['tc'], [{ seg: 'g', part: 'p2' }]);
  eq(out.demo.clips.find((c) => c.id === 'g').parts.map((p) => p.id), ['p1', 'p3'], 'one piece of a clip goes, the others stay');
  ok(!out.texts.some((t) => t.id === 'tc'), 'a selected text goes');
  out = ops.deleteSelection(run, null, [], [{ seg: 'b', part: 'p0' }, { seg: 'o', part: 'p0' }]);
  eq(out.demo.clips.map((c) => c.id), ['g'], 'whole clips go');
  ok(!out.texts.some((t) => t.id === 'tb' || t.id === 'tc'), 'texts only on deleted clips go with them');
  out = ops.deleteSelection(run, null, [], [{ seg: 'hook', part: 'p0' }, { seg: 'b', part: 'p0' }]);
  ok(out.hook.clip && timeline({ ...run, ...out }, null)[0].id === 'hook', 'the hook is never deleted');
  // Magnet off: deleting blue keeps orange in place (a gap takes blue's space).
  out = ops.deleteSelection(run, null, [], [{ seg: 'b', part: 'p0' }], true);
  const segs = timeline({ ...run, ...out }, null);
  ok(Math.abs(segs.find((s) => s.id === 'o').offset - 9) < 1e-9, 'magnet off: the clip after stays at 9 s');
  out = ops.deleteSelection(run, null, [], [{ seg: 'b', part: 'p0' }], false);
  ok(Math.abs(timeline({ ...run, ...out }, null).find((s) => s.id === 'o').offset - 6) < 1e-9, 'magnet on: the clip after moves up to 6 s');
}

// 3. Group paste placement (Codex: non-adjacent clips; a layer before the first clip; between clips; no clips).
{
  // Green (3-6) and orange (9-12) copied; pasted at the end (anchor 12): copies at 12-15 and 15-18.
  const place = sel.groupPlacer([{ lo: 3, len: 3 }, { lo: 9, len: 3 }], 3, 12);
  ok(place(9) === 15, `orange's caption (9) lands on the orange copy at ${place(9)}`);
  ok(place(4) === 13, 'inside the first copy');
  ok(place(7) === 15, `between the copies (7): ${place(7)}, never past the next copy's start (15)`);
  ok(place(2) === 11, 'before the first copied clip it keeps its distance');
  ok(sel.groupPlacer([{ lo: 3, len: 3 }], 3, 1)(0) === 0, 'never below 0');
  ok(sel.groupPlacer([], 3, 1)(6) === 4, 'no clips: same spacing from the playhead');
}

// 4. Pasted sounds keep their rows apart (Codex: overlapping copies on one row cut each other short).
{
  const rowFor = sel.pastedRows([0, 1], [0, 1]);
  ok(rowFor(0) === 2 && rowFor(1) === 3, 'two copied rows become two new rows after the existing ones');
  const pieces = [
    { id: 'a', at: 6, end: 12, row: rowFor(0), start: 0 },
    { id: 'b', at: 8, end: 12, row: rowFor(1), start: 0 },
  ];
  ok(sound.pieceEnd(pieces, 0, 20) === 12 && sound.pieceEnd(pieces, 1, 20) === 12, 'both pasted sounds keep their full length');
}

// 5. Inserting clips moves the sounds after the insert point like the texts (Codex: sounds stayed behind).
{
  const moved = sound.shiftSounds([{ id: 'a', at: 0, end: 12, start: 0 }, { id: 'b', at: 6, end: 9, start: 1 }, { id: 'c', at: 9, start: 0 }], 6, 3);
  eq(moved.map((p) => [p.at, p.end, p.start]), [[0, 12, 0], [9, 12, 1], [12, undefined, 0]], 'from the insert point on they move by the inserted length; a sound playing across it stays');
}

console.log(`editor-checks: ${checks} checks pass`);
