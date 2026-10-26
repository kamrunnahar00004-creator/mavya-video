import type { CSSProperties } from "react";

/**
 * On-screen text styles (48). Each is drawn from the text color (fg) and, when `second` is set, a second color
 * (the outline / box / glow / shadow color) the user can pick. Old runs used "outline" | "box" | "shadow" | "plain",
 * which are kept as ids here.
 */
export type StyleGroup = "Outline" | "Box" | "Shadow" | "Glow" | "Gradient" | "Plain";
type Look = { text: CSSProperties; box?: CSSProperties };
export type StylePreset = { id: string; label: string; group: StyleGroup; second?: string; look: (fg: string, ac: string) => Look };

const o = (w: number, c: string): CSSProperties => ({ WebkitTextStroke: `${w}em ${c}`, paintOrder: "stroke fill" });
const box = (bg: string, extra: CSSProperties = {}): CSSProperties => ({
  background: bg, padding: "0.08em 0.32em", borderRadius: "0.18em", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone", ...extra,
});
const stack = (c: string, n: number, step = 0.02) => Array.from({ length: n }, (_, i) => `${(i + 1) * step}em ${(i + 1) * step}em 0 ${c}`).join(", ");
const glow = (c: string, ...r: number[]) => r.map((x) => `0 0 ${x}em ${c}`).join(", ");

export const STYLE_PRESETS: StylePreset[] = [
  // Outline (14)
  { id: "outline", label: "Outline", group: "Outline", second: "Outline color", look: (fg, ac) => ({ text: { color: fg, ...o(0.16, ac) } }) },
  { id: "outline-thin", label: "Thin", group: "Outline", second: "Outline color", look: (fg, ac) => ({ text: { color: fg, ...o(0.06, ac) } }) },
  { id: "outline-medium", label: "Medium", group: "Outline", second: "Outline color", look: (fg, ac) => ({ text: { color: fg, ...o(0.1, ac) } }) },
  { id: "outline-heavy", label: "Heavy", group: "Outline", second: "Outline color", look: (fg, ac) => ({ text: { color: fg, ...o(0.24, ac) } }) },
  { id: "outline-shadow", label: "Outline + shadow", group: "Outline", second: "Outline color", look: (fg, ac) => ({ text: { color: fg, ...o(0.14, ac), textShadow: "0 0.06em 0.25em rgba(0,0,0,0.6)" } }) },
  { id: "outline-hollow", label: "Hollow", group: "Outline", look: (fg) => ({ text: { color: "transparent", ...o(0.05, fg) } }) },
  { id: "outline-offset", label: "Offset", group: "Outline", second: "Offset color", look: (fg, ac) => ({ text: { color: fg, ...o(0.08, ac), textShadow: `0.08em 0.08em 0 ${ac}` } }) },
  { id: "outline-3d", label: "3D", group: "Outline", second: "Depth color", look: (fg, ac) => ({ text: { color: fg, ...o(0.06, ac), textShadow: stack(ac, 5) } }) },
  { id: "outline-comic", label: "Comic", group: "Outline", second: "Outline color", look: (fg, ac) => ({ text: { color: fg, ...o(0.18, ac), textShadow: `0.1em 0.1em 0 ${ac}` } }) },
  { id: "outline-sticker", label: "Sticker", group: "Outline", second: "Sticker color", look: (fg, ac) => ({ text: { color: fg, ...o(0.28, ac), textShadow: "0 0.08em 0.3em rgba(0,0,0,0.45)" } }) },
  { id: "outline-double", label: "Double", group: "Outline", second: "Outer color", look: (fg, ac) => ({ text: { color: fg, ...o(0.06, "#000"), textShadow: glow(ac, 0.04, 0.04, 0.05) } }) },
  { id: "outline-soft", label: "Soft", group: "Outline", second: "Outline color", look: (fg, ac) => ({ text: { color: fg, ...o(0.08, ac), textShadow: glow(ac, 0.15) } }) },
  { id: "outline-retro", label: "Retro", group: "Outline", second: "Retro color", look: (fg, ac) => ({ text: { color: fg, ...o(0.06, "#111"), textShadow: `0.06em 0.06em 0 ${ac}, 0.12em 0.12em 0 #111` } }) },
  { id: "outline-pop", label: "Pop", group: "Outline", second: "Outline color", look: (fg, ac) => ({ text: { color: fg, ...o(0.12, ac), textShadow: `0 0.1em 0 ${ac}` } }) },
  // Box (12)
  { id: "box", label: "Box", group: "Box", second: "Box color", look: (fg, ac) => ({ text: { color: fg }, box: box(ac) }) },
  { id: "box-square", label: "Square", group: "Box", second: "Box color", look: (fg, ac) => ({ text: { color: fg }, box: box(ac, { borderRadius: 0 }) }) },
  { id: "box-pill", label: "Pill", group: "Box", second: "Box color", look: (fg, ac) => ({ text: { color: fg }, box: box(ac, { borderRadius: "999px", padding: "0.1em 0.55em" }) }) },
  { id: "box-tight", label: "Tight", group: "Box", second: "Box color", look: (fg, ac) => ({ text: { color: fg }, box: box(ac, { padding: "0 0.12em", borderRadius: "0.08em" }) }) },
  { id: "box-highlight", label: "Highlighter", group: "Box", second: "Marker color", look: (fg, ac) => ({ text: { color: fg }, box: box(`linear-gradient(transparent 45%, ${ac} 45%)`, { padding: "0 0.1em", borderRadius: 0 }) }) },
  { id: "box-outlined", label: "Framed", group: "Box", second: "Frame color", look: (fg, ac) => ({ text: { color: fg }, box: box("transparent", { boxShadow: `inset 0 0 0 0.07em ${ac}` }) }) },
  { id: "box-hard", label: "Hard shadow", group: "Box", second: "Box color", look: (fg, ac) => ({ text: { color: fg }, box: box(ac, { boxShadow: "0.1em 0.1em 0 #111" }) }) },
  { id: "box-tiktok", label: "Classic", group: "Box", second: "Box color", look: (fg, ac) => ({ text: { color: fg }, box: box(ac, { borderRadius: "0.28em", padding: "0.12em 0.4em" }) }) },
  { id: "box-half", label: "Half fill", group: "Box", second: "Fill color", look: (fg, ac) => ({ text: { color: fg }, box: box(`linear-gradient(transparent 60%, ${ac} 60%)`, { borderRadius: 0, padding: "0 0.06em" }) }) },
  { id: "box-dashed", label: "Stamp", group: "Box", second: "Stamp color", look: (fg, ac) => ({ text: { color: fg }, box: box("transparent", { outline: `0.06em dashed ${ac}`, outlineOffset: "-0.06em" }) }) },
  { id: "box-label", label: "Label", group: "Box", second: "Label color", look: (fg, ac) => ({ text: { color: fg }, box: box(ac, { borderLeft: "0.18em solid #111", borderRadius: "0.06em" }) }) },
  { id: "box-soft", label: "Soft box", group: "Box", second: "Box color", look: (fg, ac) => ({ text: { color: fg }, box: box(ac, { boxShadow: "0 0.1em 0.4em rgba(0,0,0,0.35)", borderRadius: "0.3em" }) }) },
  // Shadow (8)
  { id: "shadow", label: "Shadow", group: "Shadow", look: (fg) => ({ text: { color: fg, textShadow: "0 0.06em 0.3em rgba(0,0,0,0.75)" } }) },
  { id: "shadow-strong", label: "Strong", group: "Shadow", look: (fg) => ({ text: { color: fg, textShadow: "0 0.05em 0.12em rgba(0,0,0,0.95), 0 0.1em 0.5em rgba(0,0,0,0.7)" } }) },
  { id: "shadow-drop", label: "Drop", group: "Shadow", second: "Shadow color", look: (fg, ac) => ({ text: { color: fg, textShadow: `0.07em 0.07em 0 ${ac}` } }) },
  { id: "shadow-long", label: "Long", group: "Shadow", second: "Shadow color", look: (fg, ac) => ({ text: { color: fg, textShadow: stack(ac, 10, 0.015) } }) },
  { id: "shadow-lifted", label: "Lifted", group: "Shadow", look: (fg) => ({ text: { color: fg, textShadow: "0 0.03em 0 rgba(0,0,0,0.5), 0 0.2em 0.35em rgba(0,0,0,0.45)" } }) },
  { id: "shadow-stack", label: "Stacked", group: "Shadow", second: "Layer color", look: (fg, ac) => ({ text: { color: fg, textShadow: `0.05em 0.05em 0 ${ac}, 0.1em 0.1em 0 #111` } }) },
  { id: "shadow-emboss", label: "Emboss", group: "Shadow", look: (fg) => ({ text: { color: fg, textShadow: "-0.03em -0.03em 0 rgba(255,255,255,0.6), 0.04em 0.04em 0 rgba(0,0,0,0.6)" } }) },
  { id: "shadow-soft", label: "Soft", group: "Shadow", look: (fg) => ({ text: { color: fg, textShadow: "0 0 0.6em rgba(0,0,0,0.55)" } }) },
  // Glow (8)
  { id: "glow", label: "Glow", group: "Glow", second: "Glow color", look: (fg, ac) => ({ text: { color: fg, textShadow: glow(ac, 0.2, 0.5) } }) },
  { id: "glow-neon", label: "Neon", group: "Glow", second: "Neon color", look: (fg, ac) => ({ text: { color: fg, textShadow: glow(ac, 0.05, 0.15, 0.4, 0.8) } }) },
  { id: "glow-neon-tube", label: "Neon tube", group: "Glow", second: "Neon color", look: (_fg, ac) => ({ text: { color: "#fff", textShadow: glow(ac, 0.04, 0.1, 0.3, 0.6, 1) } }) },
  { id: "glow-halo", label: "Halo", group: "Glow", second: "Halo color", look: (fg, ac) => ({ text: { color: fg, textShadow: glow(ac, 0.6, 1.2) } }) },
  { id: "glow-fire", label: "Fire", group: "Glow", look: (fg) => ({ text: { color: fg, textShadow: "0 0 0.1em #fff3a0, 0 -0.05em 0.25em #ffb000, 0 -0.1em 0.5em #ff5a00" } }) },
  { id: "glow-ice", label: "Ice", group: "Glow", look: (fg) => ({ text: { color: fg, textShadow: "0 0 0.1em #e0f7ff, 0 0 0.3em #7dd3fc, 0 0 0.6em #0ea5e9" } }) },
  { id: "glow-outline", label: "Glow outline", group: "Glow", second: "Glow color", look: (fg, ac) => ({ text: { color: fg, ...o(0.06, ac), textShadow: glow(ac, 0.25, 0.5) } }) },
  { id: "glow-double", label: "Double glow", group: "Glow", second: "Glow color", look: (fg, ac) => ({ text: { color: fg, textShadow: `${glow("#fff", 0.1)}, ${glow(ac, 0.35, 0.7)}` } }) },
  // Gradient (3)
  { id: "gradient", label: "Gradient", group: "Gradient", second: "Second color", look: (fg, ac) => ({ text: { color: fg, backgroundImage: `linear-gradient(180deg, ${fg}, ${ac})`, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" } }) },
  { id: "gradient-sunset", label: "Sunset", group: "Gradient", look: () => ({ text: { backgroundImage: "linear-gradient(90deg, #f97316, #ec4899, #8b5cf6)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" } }) },
  { id: "gradient-chrome", label: "Chrome", group: "Gradient", look: () => ({ text: { backgroundImage: "linear-gradient(180deg, #ffffff 0%, #9ca3af 50%, #f3f4f6 51%, #6b7280 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", filter: "drop-shadow(0 0.04em 0 rgba(0,0,0,0.6))" } }) },
  // Plain (3)
  { id: "plain", label: "Plain", group: "Plain", look: (fg) => ({ text: { color: fg } }) },
  { id: "plain-caps", label: "Caps", group: "Plain", look: (fg) => ({ text: { color: fg, textTransform: "uppercase", letterSpacing: "0.02em" } }) },
  { id: "plain-spaced", label: "Spaced", group: "Plain", look: (fg) => ({ text: { color: fg, textTransform: "uppercase", letterSpacing: "0.18em" } }) },
];

export const STYLE_GROUPS: StyleGroup[] = ["Outline", "Box", "Shadow", "Glow", "Gradient", "Plain"];
/** Glass and Dark glass were removed (founder 2026-10-26: the export could not blur the video behind them); texts saved with them show as a plain box. */
const RETIRED: Record<string, string> = { "box-glass": "box", "box-dark": "box" };
export const stylePreset = (id: string) => STYLE_PRESETS.find((p) => p.id === (RETIRED[id] ?? id)) ?? STYLE_PRESETS[0];

/** Readable default for the second color: black behind light text, white behind dark text. */
export function autoSecond(fg: string): string {
  const m = fg.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#000000";
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#000000" : "#ffffff";
}

/** The CSS for one text layer: text styles, plus box styles for the inline span when the preset has a box. */
export function textLook(styleId: string, fg: string, second?: string): Look {
  return stylePreset(styleId).look(fg, second ?? autoSecond(fg));
}
