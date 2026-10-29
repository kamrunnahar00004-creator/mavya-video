import { retimeTexts, timeline } from "@/lib/edit";
import { DEFAULT_FONT } from "@/lib/studio-data";
import { runTexts, TEXT_Y } from "@/lib/client";
import { speedOf } from "@/lib/adjust";
import type { Run, TextLayer } from "@/lib/types";

type Generated = NonNullable<Run["hook"]["generated"]>;
/**
 * Attach to the current run, preserving later edits. Changed inputs keep the result in history only.
 * The hook text becomes `suggested` (the line written for this product) unless the seller typed their own:
 * `placeholders` are the texts that were never theirs (the stolen video's caption, its title).
 */
export function generationPatch(run: Run, input: Run, generated: Generated, suggested: string, placeholders: string[] = []): Pick<Run, "hook" | "texts"> {
  const hook = run.hook;
  const versions = [...(hook.versions ?? [])];
  // The demo script is written while the hook generates (same click), so it is not part of what the clip was made from.
  const context = (r: Run) => [r.sourceRefId, r.hook.mode, r.hook.source, r.hook.face, r.hook.describe];
  const same = JSON.stringify(context(run)) === JSON.stringify(context(input));
  if (!same) return { hook: { ...hook, versions: [...versions.filter((g) => g.src !== generated.src), generated].slice(-50) }, texts: runTexts(run) };
  if (hook.generated?.src === generated.src) return { hook, texts: runTexts(run) };
  const old = timeline(run, null)[0];
  const speed = speedOf(hook.adjust);
  const texts = retimeTexts(runTexts(run), 0, { start: 0, end: old.len * speed, speed }, { start: 0, end: generated.seconds, speed });
  const base = texts.find((t) => t.id === "hook");
  const item: TextLayer = base
    ? { ...base, text: suggested && (!base.text || base.text === "How is this tool even legal?" || placeholders.includes(base.text)) ? suggested : base.text || suggested }
    : { id: "hook", text: suggested, start: 0, end: Math.round(generated.seconds / speed * 10) / 10, x: 50, y: TEXT_Y.top, size: 4.6, font: DEFAULT_FONT, color: "#ffffff", style: "outline" };
  if (hook.generated) versions.push(hook.generated);
  return { hook: { ...hook, generated, versions: versions.slice(-50), start: 0, end: generated.seconds, parts: undefined, text: item.text }, texts: [item, ...texts.filter((t) => t.id !== "hook")] };
}
