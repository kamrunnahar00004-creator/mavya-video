/**
 * The face reference for Kling 4.0 (founder 2026-11-21). Tested side by side on 7 hooks: Kling 4.0 given the
 * character's FACE (a crop of head and hair) as the reference image swaps the person and keeps the hook's own room,
 * framing and clothes. Given the whole photo, it copied the photo's room and outfit into the hook.
 * Pure: turns a face box into a crop region, all as fractions of the image (no pixel sizes needed), so ffmpeg can cut
 * it with iw/ih expressions. Tested in scripts/kling4-swap-checks.cjs.
 */

/** A region as fractions of the image: left, top, width, height, each 0..1. */
export type Region = { x: number; y: number; w: number; h: number };

/** Used when no face box is available: the upper middle of a portrait, where a selfie's head is. */
export const FALLBACK_REGION: Region = { x: 0.15, y: 0.02, w: 0.7, h: 0.5 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n * 10000) / 10000;

/**
 * A face box from Gemini ([ymin, xmin, ymax, xmax], 0..1000) widened to head and hair: room above for hair, some
 * below for the chin and neck, and to each side for hair that falls past the face. Null when the box is unusable.
 */
export function headRegion(box: unknown): Region | null {
  if (!Array.isArray(box) || box.length !== 4 || !box.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [ymin, xmin, ymax, xmax] = (box as number[]).map((n) => clamp(n, 0, 1000) / 1000);
  const fh = ymax - ymin, fw = xmax - xmin;
  // Too small to be a face anyone could copy, or not a box at all.
  if (fh < 0.03 || fw < 0.03 || fh * fw < 0.002) return null;
  const top = clamp(ymin - fh * 0.6, 0, 1), bottom = clamp(ymax + fh * 0.45, 0, 1);
  const left = clamp(xmin - fw * 0.55, 0, 1), right = clamp(xmax + fw * 0.55, 0, 1);
  return { x: round(left), y: round(top), w: round(right - left), h: round(bottom - top) };
}

/** ffmpeg filter that cuts `r` out of the image and makes sure the short side is at least 512 px. */
export function cropFilter(r: Region): string {
  return `crop=iw*${r.w}:ih*${r.h}:iw*${r.x}:ih*${r.y},scale='if(lt(iw,ih),max(iw,512),-2)':'if(lt(iw,ih),-2,max(ih,512))'`;
}
