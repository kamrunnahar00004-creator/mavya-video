import { speedOf } from "@/lib/adjust";
import { runTexts } from "@/lib/client";
import { demoClips, pieceSpans, remapTexts, removeDemoClip, storeParts, timeline } from "@/lib/edit";
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
