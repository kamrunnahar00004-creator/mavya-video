// Texts must survive re-timing (founder 2026-11-12: "after generation where did all my subtitles go?"). A new 1.63 s
// hook, trimmed to 0.96-1.63 and then slowed to 0.5x, put every later text 1 ms before its clip's start (6.288 on a
// clip at 6.289): containTexts judged each the previous clip's, cut it to 1 ms, and 9 of 11 texts were lost. The
// fixture is that run's timeline (clip lengths and text times; ids and words replaced). Both edit orders must keep
// every text, at its length, on its clip; a deliberate start before an edge (over a frame) is left alone.
const assert = require('node:assert/strict');
const { load } = require('./check-module.cjs');
const adjust = load('src/lib/adjust.ts', { react: {} });
const edit = load('src/lib/edit.ts', { '@/lib/adjust': adjust });
const sound = load('src/lib/sound.ts', { '@/lib/edit': edit, '@/lib/adjust': adjust });
const ops = load('src/lib/edit-ops.ts', { '@/lib/adjust': adjust, '@/lib/edit': edit, '@/lib/client': { runTexts: (r) => r.texts }, '@/lib/sound': sound, '@/lib/types': {} });
const R = require('./fixtures/text-drift-run.json');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); };

// The editor's own steps (run-view.tsx applyGenerated, setParts, liveAdjust).
const generate = (r, seconds) => {
  const sp = adjust.speedOf(r.hook.adjust), old = edit.timeline(r, null)[0];
  const texts = edit.retimeTexts(r.texts, 0, { start: 0, end: old.len * sp, speed: sp }, { start: 0, end: seconds, speed: sp });
  return { ...r, hook: { ...r.hook, generated: { ...r.hook.generated, seconds }, start: 0, end: seconds, parts: undefined }, texts };
};
const trim = (r, a, b) => { const s = edit.timeline(r, null)[0]; return { ...r, ...ops.partsChange(r, null, 'hook', [{ ...s.parts[0], start: a, end: b }]) }; };
const speed = (r, v) => {
  const seg = edit.timeline(r, null)[0];
  const texts = edit.remapTexts(r.texts, seg.offset, { parts: seg.parts, speed: adjust.speedOf(seg.adjust) }, { parts: seg.parts, speed: v });
  const next = { ...r, hook: { ...r.hook, adjust: { ...r.hook.adjust, speed: v } } };
  return { ...next, texts: edit.containTexts(texts, edit.timeline(next, null)) };
};
const owner = (r) => { const segs = edit.timeline(r, null); return r.texts.map((t) => edit.textOwner(t.start, segs)?.seg ?? null); };

const generated = generate(R, 1.63);
const before = owner(generated);
for (const [name, out] of [['trim, then speed', speed(trim(generated, 0.96, 1.63), 0.5)], ['speed, then trim', trim(speed(generated, 0.5), 0.96, 1.63)]]) {
  const saved = edit.containTexts(edit.snapTexts(out.texts, edit.timeline(out, null)), edit.timeline(out, null)); // as the page loads it again
  ok(saved.length === R.texts.length, `${name}: all ${R.texts.length} texts kept (${saved.length})`);
  const short = saved.filter((t, i) => t.end - t.start < Math.min(0.3, R.texts[i].end - R.texts[i].start - 0.01));
  ok(short.length === 0, `${name}: no text squashed (${JSON.stringify(short.map((t) => [t.text, t.start, t.end]))})`);
  ok(JSON.stringify(owner({ ...out, texts: saved })) === JSON.stringify(before), `${name}: every text stays on its clip (${owner({ ...out, texts: saved })} vs ${before})`);
}

// The rule itself.
const segs = [{ id: 'a', offset: 0, len: 2 }, { id: 'b', offset: 2, len: 2 }].map((s) => ({ ...s, gap: 0, parts: [], adjust: {} }));
const t = (start, end) => ({ id: 'x', text: 'x', start, end, x: 50, y: 50, size: 4, font: 'f', color: '#fff', style: 'outline' });
const one = (x) => edit.containTexts([x], segs)[0];
ok(one(t(1.999, 3.5)).start === 2 && one(t(1.999, 3.5)).end === 3.5, 'a start 1 ms before a clip moves onto it and keeps its length');
ok(one(t(1.98, 3.5)).start === 2, 'up to 20 ms (under a frame) is drift');
ok(one(t(1.9, 3.5)).start === 1.9 && one(t(1.9, 3.5)).end === 2, 'a deliberate start 100 ms before stays on the earlier clip, ending at its edge');
ok(one(t(1.995, 2.01)).start === 1.995, 'a text shorter than the drift is not moved past its own end');
ok(edit.containTexts([t(0.5, 1.5)], segs)[0].start === 0.5, 'an ordinary text is untouched');

console.log(`text-drift-checks: ${checks} checks pass`);
