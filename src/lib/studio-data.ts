/** Proven SaaS hook structures. {product} is filled from the project's product name. */
export const HOOK_TEMPLATES: string[] = [
  "How is this tool even legal?",
  "I replaced my $500 subscription with this.",
  "POV: you just found {product}.",
  "Nobody is talking about this tool.",
  "Stop paying for tools that do less than this.",
  "I've been gatekeeping {product} for months.",
  "I wish I knew about {product} a year ago.",
  "I can't believe {product} actually does this.",
];

export function fillHook(text: string, product: string): string {
  return text.replaceAll("{product}", product.trim() || "this app");
}

export const FONTS = {
  anton: { label: "Anton", css: "var(--font-anton)" },
  montserrat: { label: "Montserrat", css: "var(--font-montserrat)" },
  poppins: { label: "Poppins", css: "var(--font-poppins)" },
  bebas: { label: "Bebas Neue", css: "var(--font-bebas)" },
  marker: { label: "Marker", css: "var(--font-marker)" },
  geist: { label: "Geist", css: "var(--font-geist-sans)" },
} as const;
export type FontKey = keyof typeof FONTS;

/** Extra fonts from Google Fonts, loaded on demand (only when shown in the picker or used). */
export const GOOGLE_FONTS = [
  "TikTok Sans", "Inter", "Roboto", "Open Sans", "Lato", "Oswald", "Raleway", "Nunito", "Rubik", "Work Sans", "DM Sans",
  "Manrope", "Archivo Black", "Barlow", "Barlow Condensed", "Bangers", "Bungee", "Fredoka", "Lobster", "Pacifico", "Dancing Script",
  "Caveat", "Shadows Into Light", "Indie Flower", "Kalam", "Satisfy", "Righteous", "Russo One", "Teko", "Titan One", "Luckiest Guy",
  "Chewy", "Comfortaa", "Quicksand", "Josefin Sans", "Space Grotesk", "Sora", "Outfit", "Plus Jakarta Sans", "Lexend", "Syne",
  "Abril Fatface", "Playfair Display", "Merriweather", "Bricolage Grotesque", "Unbounded", "Alfa Slab One", "Black Ops One", "Rock Salt", "Kanit", "Prompt",
  "Exo 2", "Saira Condensed", "Fjalla One", "Press Start 2P",
] as const;

/** Fonts every device already has: never fetched from Google. */
export const SYSTEM_FONTS = ["Arial", "Helvetica", "Impact", "Verdana", "Georgia"] as const;

/** The font every new text starts with: TikTok's own caption font (founder 2026-10-24; free on Google Fonts). */
export const DEFAULT_FONT = "TikTok Sans";

/** Every font the text picker offers: TikTok Sans first, Arial, the built-in ones, system ones, then Google. A text's `font` is a key or a family name. */
export const FONT_CHOICES: { id: string; label: string }[] = [
  { id: DEFAULT_FONT, label: DEFAULT_FONT },
  { id: "Arial", label: "Arial Bold" },
  ...(Object.keys(FONTS) as FontKey[]).map((k) => ({ id: k, label: FONTS[k].label })),
  ...SYSTEM_FONTS.filter((f) => f !== "Arial").map((f) => ({ id: f, label: f })),
  ...GOOGLE_FONTS.filter((f) => f !== DEFAULT_FONT).map((f) => ({ id: f, label: f })),
];

export const fontLabel = (font: string) => (font in FONTS ? FONTS[font as FontKey].label : font === "Arial" ? "Arial Bold" : font);
export const fontCss = (font: string) => (font in FONTS ? FONTS[font as FontKey].css : `"${font}", sans-serif`);

const loaded = new Set<string>();
/** Loads Google Fonts on demand. `previewText` loads just those characters (tiny files, for the picker list). */
export function loadFonts(fonts: readonly string[], previewText?: string) {
  if (typeof document === "undefined") return;
  const families = fonts.filter((f) => !(f in FONTS) && !(SYSTEM_FONTS as readonly string[]).includes(f) && !loaded.has(`${f}|${previewText ?? ""}`));
  if (!families.length) return;
  families.forEach((f) => loaded.add(`${f}|${previewText ?? ""}`));
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}`).join("&")}&display=swap${previewText ? `&text=${encodeURIComponent(previewText)}` : ""}`;
  document.head.appendChild(link);
}

export const TEXT_COLORS = ["#ffffff", "#000000", "#facc15", "#f97316", "#ef4444", "#22c55e", "#38bdf8", "#e879f9"];

/** A STYLE_PRESETS id (src/lib/text-styles.ts); the 4 below are the original ones the old editor still lists. */
export type TextStyle = string;
export const TEXT_STYLES: { id: TextStyle; label: string }[] = [
  { id: "outline", label: "Outline" },
  { id: "box", label: "Box" },
  { id: "shadow", label: "Shadow" },
  { id: "plain", label: "Plain" },
];
