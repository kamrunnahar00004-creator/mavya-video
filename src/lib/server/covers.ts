import "server-only";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { downloadTo, putObject, signedGet } from "@/lib/server/r2";
import type { Reference } from "@/lib/types";

/**
 * Hook cards show a small WebP cover (360 px wide, ~20 KB) instead of the full-size JPEG thumbnail (~150 KB).
 * The cover lives at covers/<thumbnail media id>.webp in R2; `data.smallCover = true` on the library row says it exists.
 * The list response carries a signed link to it, so the browser loads every card image straight from R2 at once.
 */
const coverKey = (mediaId: string) => `covers/${mediaId}.webp`;
// Media ids carry their extension (<uuid>.jpg); the R2 key is media/<id>.
const MEDIA_ID = /\/api\/media\/([0-9a-f-]{36}(?:\.[a-z0-9]{2,5})?)/;

/** The media id of a reference's card image, when it is a stored image (not an inline/data thumbnail). */
export function thumbMediaId(ref: Pick<Reference, "analysis" | "thumbUrl">): string | null {
  const thumb = ref.analysis?.segments[0]?.thumb ?? ref.thumbUrl;
  return thumb?.match(MEDIA_ID)?.[1] ?? null;
}

/** Signed cover links for references whose cover exists. Signing is local (no network) and reused per instance. */
export async function coverLinks(refs: Reference[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  await Promise.all(refs.map(async (ref) => {
    const mediaId = ref.smallCover ? thumbMediaId(ref) : null;
    if (mediaId) links.set(ref.id, await signedGet(coverKey(mediaId)));
  }));
  return links;
}

/** Downloads the original thumbnail, writes the small WebP cover. */
export async function makeCover(mediaId: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "cover-"));
  try {
    const file = join(dir, "thumb");
    if (!(await downloadTo(`media/${mediaId}`, file))) throw new Error("Thumbnail missing");
    const webp = await sharp(await readFile(file)).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    await putObject(coverKey(mediaId), webp, "image/webp");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Background fill for references listed without a cover (new library items). Bounded and best effort. */
export async function fillCovers(refs: Reference[]): Promise<void> {
  const db = createSupabaseAdminClient();
  for (const ref of refs.filter((r) => !r.smallCover && thumbMediaId(r)).slice(0, 6)) {
    try {
      await makeCover(thumbMediaId(ref)!);
      // Re-read just before writing so only the cover flag changes.
      const { data, error } = await db.from("library").select("data").eq("id", ref.id).maybeSingle<{ data: Record<string, unknown> }>();
      if (error || !data) continue;
      if (data.data.smallCover === true) continue;
      const updated = await db.from("library").update({ data: { ...data.data, smallCover: true } }).eq("id", ref.id);
      if (updated.error) console.error("cover flag", ref.id, updated.error);
    } catch (error) {
      console.error("cover fill", ref.id, error);
    }
  }
}
