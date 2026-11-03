/**
 * The light copy of an uploaded video for in-app players (made after upload, see src/lib/server/previews.ts); the
 * original plays until the copy exists. Not for the hook (it stays as generated) or the export (always the original).
 */
export function previewOf<T extends string | null | undefined>(src: T): T {
  if (!src) return src;
  const [path, hash] = src.split("#");
  if (!/^\/api\/media\/[0-9a-f-]{36}\.\w+$/i.test(path)) return src;
  return `${path}?preview=1${hash !== undefined ? `#${hash}` : ""}` as T;
}
