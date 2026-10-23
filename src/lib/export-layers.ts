import { runTexts } from "@/lib/client";
import { timeline, videoLength } from "@/lib/edit";
import type { Run } from "@/lib/types";
export function exportLayers(run: Run) {
 const total = videoLength(timeline(run, null).filter(s => s.src));
 return runTexts(run).map((t,i) => run.texts ? t : { ...t, id: `legacy-export-${i}` })
  .filter(t => t.text.trim() && t.end > t.start && t.start < total && t.end > 0);
}
