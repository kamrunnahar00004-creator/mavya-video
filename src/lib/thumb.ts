/**
 * A list's still picture of a stored video: a small JPEG made once on the server, never a <video> (founder 2026-11-09:
 * lists decoded 4K HDR originals, slow, and an HDR video can black out a Windows screen). Null for other links.
 */
export function thumbOf(src: string): string | null {
  const base = src.split(/[?#]/)[0];
  return /^\/api\/media\/[\w.-]+$/.test(base) ? `${base}/thumb` : null;
}
