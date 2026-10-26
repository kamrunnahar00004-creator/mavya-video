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
export const fontCss = (font: string) => (font in FONTS ? FONTS[font as FontKey].css : font === DEFAULT_FONT ? `var(--font-tiktok-sans, "TikTok Sans"), sans-serif` : `"${font}", sans-serif`);

const loaded = new Set<string>();
const familyParam = (f: string) => encodeURIComponent(f).replace(/%20/g, "+");
/**
 * Loads Google Fonts on demand. `previewText` loads just those characters for the whole picker list in one request.
 * Fonts in use load the real weight-800 face (texts are drawn at 800), else the default face: the same choice the
 * export makes in text-png.ts, so preview and export match (Codex V8). A failed load is forgotten so it retries (V12).
 */
export function loadFonts(fonts: readonly string[], previewText?: string) {
  if (typeof document === "undefined") return;
  const families = fonts.filter((f) => !(f === DEFAULT_FONT && document.querySelector?.("[data-editor-fonts]")) && !(f in FONTS) && !(SYSTEM_FONTS as readonly string[]).includes(f) && !loaded.has(`${f}|${previewText ?? ""}`));
  if (!families.length) return;
  const add = (href: string, keys: string[], onError?: () => void) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onerror = () => {
      link.remove();
      if (onError) onError();
      else keys.forEach((k) => loaded.delete(k));
    };
    document.head.appendChild(link);
  };
  if (previewText) {
    const keys = families.map((f) => `${f}|${previewText}`);
    keys.forEach((k) => loaded.add(k));
    add(`https://fonts.googleapis.com/css2?${families.map((f) => `family=${familyParam(f)}`).join("&")}&display=swap&text=${encodeURIComponent(previewText)}`, keys);
    return;
  }
  for (const f of families) {
    const key = `${f}|`;
    loaded.add(key);
    const bold = `https://fonts.googleapis.com/css2?family=${familyParam(f)}:wght@800&display=swap`;
    // Ask Google first: a 400 means the family has no 800 face (then its default face, as the export does); a network
    // error is temporary, so nothing is cached and the next call tries 800 again (Codex P2V4).
    fetch(bold, { method: "GET", cache: "force-cache" })
      .then((r) => {
        if (r.ok) add(bold, [key]);
        else if (r.status === 400) add(`https://fonts.googleapis.com/css2?family=${familyParam(f)}&display=swap`, [key]);
        else loaded.delete(key);
      })
      .catch(() => loaded.delete(key));
  }
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
