import { runTexts } from "@/lib/client";
import { containTexts, timeline, videoLength } from "@/lib/edit";
import type { Run } from "@/lib/types";
export function exportLayers(run: Run) {
 const segs = timeline(run, null);
 const total = videoLength(segs.filter(s => s.src));
 // Each text stays inside its own clip (containTexts), whatever older edits saved.
 return containTexts(runTexts(run), segs).map((t,i) => run.texts ? t : { ...t, id: `legacy-export-${i}` })
  .filter(t => t.text.trim() && t.end > t.start && t.start < total && t.end > 0);
}
