import { runTexts } from "@/lib/client";
import { containTexts, textOwner, timeline, videoLength } from "@/lib/edit";
import type { Run } from "@/lib/types";
/**
 * The texts an export draws: contained in their clips, each with `owner`, the clip it belongs to by its index among
 * the exported clips (those with a video), so the export shows it on exactly that clip's frames (textFrames).
 */
export function exportLayers(run: Run) {
 const segs = timeline(run, null);
 const exported = segs.filter(s => s.src);
 const total = videoLength(exported);
 // Each text stays inside its own clip (containTexts), whatever older edits saved.
 return containTexts(runTexts(run), segs).map((t,i) => run.texts ? t : { ...t, id: `legacy-export-${i}` })
  .filter(t => t.text.trim() && t.end > t.start && t.start < total && t.end > 0)
  .map(t => ({ ...t, owner: textOwner(t.start, exported) }));
}

/**
 * A text's times in an export of `total` seconds (planLength): inside the video, or null when nothing of it is left
 * (Codex 2026-11-07: a text on the last fraction of a frame past the export's whole frames, start 1.001 and end 1,
 * failed the render job's check). The browser lane draws such a text on no frame either.
 */
export function exportWindow(layer: { start: number; end: number }, total: number): { start: number; end: number } | null {
 const start = Math.max(0, layer.start), end = Math.min(total, layer.end);
 return end > start ? { start, end } : null;
}
