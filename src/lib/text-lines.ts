import type { CSSProperties } from "react";
import { fontCss } from "@/lib/studio-data";
import type { TextLayer } from "@/lib/types";

/**
 * Where a text's lines break, decided once and used by both the preview and the export, so they can never wrap
 * differently (2026-11-03: "by copying the viral script." filled 99.2% of its box; it fit on one line in the
 * preview and wrapped in the export, whose font copy was a hair wider). Measured with the font the editor shows,
 * in a 720x1280 frame where the text box is 88% wide, the same proportions as every player and the export.
 */
const W = 720, H = 1280;
const cache = new Map<string, string>();
let ctx: CanvasRenderingContext2D | null = null;

/** fontCss() uses CSS variables (the editor's self-hosted fonts); a canvas needs the real family names. */
function resolveFamily(css: string): string {
  return css.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (_, name: string, fallback?: string) => {
    const el = document.querySelector("[data-editor-fonts]") ?? document.documentElement;
    return getComputedStyle(el).getPropertyValue(name).trim() || fallback || "sans-serif";
  });
}

/** textLines once the editor's font for this text has loaded (the export waits for it; it never guesses). */
export async function textLinesLoaded(x: Pick<TextLayer, "text" | "font" | "size">, look: { text: CSSProperties; box?: CSSProperties }): Promise<string> {
  await document.fonts.load(`800 ${(x.size / 100) * H}px ${resolveFamily(fontCss(x.font))}`, x.text).catch(() => undefined);
  return textLines(x, look);
}

/** The text with a newline at every line break (explicit ones kept). Before fonts load, the text as it is. */
export function textLines(x: Pick<TextLayer, "text" | "font" | "size">, look: { text: CSSProperties; box?: CSSProperties }): string {
  if (typeof document === "undefined" || !x.text) return x.text;
  const upper = look.text.textTransform === "uppercase";
  const px = (x.size / 100) * H;
  const family = resolveFamily(fontCss(x.font));
  const font = `800 ${px}px ${family}`;
  const spacing = typeof look.text.letterSpacing === "string" && look.text.letterSpacing.endsWith("em") ? parseFloat(look.text.letterSpacing) * px : 0;
  // A box style pads each line left and right (e.g. "0.12em 0.4em"): that room is not there for letters.
  const pad = typeof look.box?.padding === "string" ? parseFloat(look.box.padding.split(/\s+/)[1] ?? look.box.padding) || 0 : 0;
  const max = 0.88 * W - 2 * pad * px;
  const key = [x.text, font, spacing, max, upper].join("|");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return x.text;
  ctx.font = font;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing}px`;
  const width = (s: string) => ctx!.measureText(upper ? s.toUpperCase() : s).width;
  const lines: string[] = [];
  for (const para of x.text.split("\n")) {
    let cur = "";
    for (const word of para.split(/ +/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (!cur || width(next) <= max) cur = next;
      else { lines.push(cur); cur = word; }
    }
    lines.push(cur);
  }
  const out = lines.join("\n");
  // Only remember measurements made with the real font (not a fallback while it loads).
  if (document.fonts.check(font, x.text)) {
    if (cache.size > 2000) cache.clear();
    cache.set(key, out);
  }
  return out;
}
