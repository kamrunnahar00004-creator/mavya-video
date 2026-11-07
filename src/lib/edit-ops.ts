import { speedOf } from "@/lib/adjust";
import { runTexts } from "@/lib/client";
import { demoClips, pieceSpans, remapTexts, removeDemoClip, storeParts, timeline } from "@/lib/edit";
import { shiftSounds } from "@/lib/sound";
import type { DemoClip, Part, Reference, Run } from "@/lib/types";

/**
 * A clip's pieces changed (trim or delete a piece, Undo; Cut on the hook). Texts follow the same frames; texts only on
 * a deleted piece go with it. `hold` (magnet off): the clip after it stays where it is, the change goes into the empty
 * space before it. Pure: the editor saves what it returns (null when nothing applies).
 */
export function partsChange(r: Run, source: Reference | null, clipId: string, parts: Part[], hold = false): Pick<Run, "hook" | "demo" | "texts"> | null {
  const all = timeline(r, source);
  const seg = all.find((x) => x.id === clipId);
  if (!seg || !parts.length) return null;
  const speed = speedOf(seg.adjust);
  const after = all[all.indexOf(seg) + 1];
  const keep = hold && Boolean(after);
  const newLen = parts.reduce((t, x) => t + Math.max(0.05, x.end - x.start), 0) / speed;
  const fix = (c: DemoClip) => (keep && c.id === after.id ? { ...c, gap: Math.round(Math.max(0, (c.gap ?? 0) + seg.len - newLen) * 1000) / 1000 } : c);
  const spans = pieceSpans(seg);
  let kept = runTexts(r);
  for (let i = 0; i < seg.parts.length; i++) {
    if (parts.some((q) => q.id === seg.parts[i].id)) continue;
    const a = seg.offset + spans[i].at;
    const b = a + spans[i].len;
    kept = kept.filter((x) => x.start < a - 0.001 || x.end > b + 0.001);
  }
  const nextTexts = remapTexts(kept, seg.offset, { parts: seg.parts, speed }, { parts, speed }, keep);
  const stored = storeParts(parts);
  if (clipId === "hook") return { hook: { ...r.hook, ...stored }, demo: keep ? { ...r.demo, clips: demoClips(r).map(fix) } : r.demo, texts: nextTexts };
  return { hook: r.hook, demo: { ...r.demo, clips: demoClips(r).map((c) => (c.id === clipId ? { ...c, ...stored } : fix(c))) }, texts: nextTexts };
}

/**
 * Demo clips `added` go in before demo clip `at` (default: the end). Texts and sounds from the insert point on move
 * later by the new clips' length (at the end nothing moves; a sound already playing across it stays). Pure: the
 * editor saves what it returns (`sounds` only when they changed).
 */
export function insertClipsChange(cur: Run, added: DemoClip[], at?: number): Pick<Run, "demo" | "texts"> & { sounds?: Run["sounds"] } {
  // A single demo turning into clips: "Your demo" becomes "Clip 1".
  const before = demoClips(cur).map((c) => (added.length && c.label === "Your demo" ? { ...c, label: "Clip 1" } : c));
  const pos = at === undefined ? before.length : Math.max(0, Math.min(before.length, at));
  const clips = [...before.slice(0, pos), ...added, ...before.slice(pos)];
  const nextRun: Run = { ...cur, demo: { ...cur.demo, mode: clips.length > 1 ? "clips" : "single", clips } };
  const old = timeline(cur, null);
  const next = before.slice(pos).map((c) => old.find((g) => g.id === c.id)).find(Boolean);
  const from = next ? next.offset : Infinity;
  const by = timeline(nextRun, null).filter((g) => added.some((c) => c.id === g.id)).reduce((t, g) => t + g.gap + g.len, 0);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const texts = runTexts(cur).map((x) => (x.start >= from - 0.05 ? { ...x, start: r(x.start + by), end: r(x.end + by) } : x));
  const sounds = cur.sounds && Number.isFinite(from) ? shiftSounds(cur.sounds, from, by) : cur.sounds;
  return { demo: nextRun.demo, texts, ...(sounds !== cur.sounds ? { sounds } : {}) };
}

/**
 * Several selected things deleted at once (Ctrl/Cmd-click in the editor, then Delete, like CapCut): texts, and clip
 * pieces (every piece of a demo clip removes the clip; the hook always keeps its pieces). Applied one after another to
 * one working copy, so the result is saved once (one Undo).
 */
export function deleteSelection(run: Run, source: Reference | null, textIds: string[], pieces: { seg: string; part: string }[], hold = false): Pick<Run, "hook" | "demo" | "texts"> {
  let r: Run = { ...run, texts: runTexts(run).filter((t) => !textIds.includes(t.id)) };
  for (const segId of [...new Set(pieces.map((p) => p.seg))]) {
    const seg = timeline(r, source).find((x) => x.id === segId);
    if (!seg) continue;
    const gone = new Set(pieces.filter((p) => p.seg === segId).map((p) => p.part));
    const rest = seg.parts.filter((p) => !gone.has(p.id));
    if (rest.length) {
      const change = partsChange(r, source, segId, rest, hold);
      if (change) r = { ...r, ...change };
    } else if (segId !== "hook") r = { ...r, ...removeDemoClip(r, segId, runTexts(r), hold) };
  }
  return { hook: r.hook, demo: r.demo, texts: runTexts(r) };
}
