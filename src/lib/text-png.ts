import type { CSSProperties } from "react";
import { FONTS, SYSTEM_FONTS } from "@/lib/studio-data";
import { textLook } from "@/lib/text-styles";
import type { TextLayer } from "@/lib/types";

/**
 * Draws one on-screen text as a full-frame transparent PNG (1080x1920) for the export, with the exact CSS the
 * preview uses (TextRender in run-preview.tsx): same size (percent of the frame height), position, box width and
 * style. The font is embedded (only the glyphs this text uses) so the drawing never falls back to another font.
 */
const W = 1080;
const H = 1920;

/** The built-in fonts are next/font copies of these Google families. */
const GOOGLE_NAME: Record<keyof typeof FONTS, string> = { anton: "Anton", montserrat: "Montserrat", poppins: "Poppins", bebas: "Bebas Neue", marker: "Permanent Marker", geist: "Geist" };

const kebab = (k: string) => (k.startsWith("Webkit") ? `-webkit-${k.slice(6)}` : k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const css = (s: CSSProperties) =>
  Object.entries(s)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${kebab(k)}:${String(v).replace(/"/g, "'")}`)
    .join(";");
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** @font-face rules with the font files inlined, for these characters only (Google Fonts' text= subset). */
async function fontFace(family: string, text: string): Promise<string> {
  const chars = [...new Set(text.replace(/\s/g, ""))].join("");
  for (const spec of [`${family}:wght@800`, family]) {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(spec).replace(/%20/g, "+")}&text=${encodeURIComponent(chars)}&display=block`).catch(() => null);
    if (!res?.ok) continue;
    let sheet = await res.text();
    for (const url of new Set(sheet.match(/https:\/\/fonts\.gstatic\.com\/[^)'"]+/g) ?? [])) {
      const file = await fetch(url).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
      if (file) sheet = sheet.split(url).join(await toDataUrl(file));
    }
    return sheet;
  }
  return "";
}

/** The family name to draw with, and the @font-face rules it needs. */
async function fontFor(font: string, text: string): Promise<{ family: string; face: string }> {
  if ((SYSTEM_FONTS as readonly string[]).includes(font)) return { family: `"${font}", sans-serif`, face: "" };
  const name = font in FONTS ? GOOGLE_NAME[font as keyof typeof FONTS] : font;
  return { family: `"${name}", sans-serif`, face: await fontFace(name, text) };
}

/** The drawn text cropped to what it covers, with where it sits on the 1080x1920 frame (null: nothing drawn). */
export async function textPng(x: TextLayer): Promise<{ png: string; x: number; y: number } | null> {
  const { family, face } = await fontFor(x.font, x.text);
  const look = textLook(x.style, x.color, x.second);
  const base: CSSProperties = { fontFamily: family, fontSize: `${(x.size / 100) * H}px`, fontWeight: 800, lineHeight: 1.12, textAlign: "center", whiteSpace: "pre-wrap", overflowWrap: "break-word", display: "block" };
  const inner = look.box
    ? `<span style="${css({ ...base, lineHeight: 1.45 })}"><span style="${css({ ...look.text, ...look.box })}">${xml(x.text)}</span></span>`
    : `<span style="${css({ ...base, ...look.text })}">${xml(x.text)}</span>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${W}px;height:${H}px;margin:0">` +
    `<style>${xml(face)}</style>` +
    `<div style="position:absolute;left:${x.x}%;top:${x.y}%;transform:translate(-50%,-50%);width:88%">${inner}</div>` +
    `</div></foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  // Crop to the drawn pixels: the render server overlays a small image, not a full frame.
  const alpha = ctx.getImageData(0, 0, W, H).data;
  let [left, top, right, bottom] = [W, H, -1, -1];
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      if (!alpha[(py * W + px) * 4 + 3]) continue;
      if (px < left) left = px;
      if (px > right) right = px;
      if (py < top) top = py;
      bottom = py;
    }
  }
  if (right < 0) return null;
  const out = document.createElement("canvas");
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext("2d")!.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return { png: out.toDataURL("image/png"), x: left, y: top };
}
