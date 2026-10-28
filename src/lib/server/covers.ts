import "server-only";
import { signedGet } from "@/lib/server/r2";
import type { Reference } from "@/lib/types";

/** Covers are curated derivatives. Never mint grants from a user-controlled thumbnail URL.
 * New covers require an explicit offline maintenance operation, not a list GET.
 */
const MEDIA_ID = /^\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.[a-z0-9]{2,5})?)$/;
export function thumbMediaId(ref: Pick<Reference, "analysis" | "thumbUrl">): string | null {
  return (ref.analysis?.segments[0]?.thumb ?? ref.thumbUrl)?.match(MEDIA_ID)?.[1] ?? null;
}
export async function coverLinks(refs: Reference[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  await Promise.all(refs.map(async ref => {
    const mediaId = ref.owner === "curated" && ref.smallCover ? thumbMediaId(ref) : null;
    if (mediaId) links.set(ref.id, await signedGet(`covers/${mediaId}.webp`));
  }));
  return links;
}
