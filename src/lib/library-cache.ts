import { fetchPage } from "@/lib/list-client";
import type { Reference } from "@/lib/types";

const URL_CATALOG = "/api/references?view=catalog&scope=curated&all=1";
export const CATALOG_TTL_MS = 60_000;
type Page = { items: Reference[]; next: string | null };
type Entry = { wall: number; mono: number; value: Promise<Page> };
let cached: Entry | null = null;
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Shared data only. Owned references and full selected recipes never enter this cache. */
export function invalidateLibrary() { cached = null; }
export function loadLibrary(): Promise<Page> {
  const wall = Date.now(), mono = performance.now();
  if (cached && wall >= cached.wall && wall - cached.wall < CATALOG_TTL_MS && mono - cached.mono >= 0 && mono - cached.mono < CATALOG_TTL_MS) return cached.value;
  const entry: Entry = { wall, mono, value: Promise.resolve({ items: [], next: null }) };
  cached = entry;
  entry.value = fetchPage<Reference>(URL_CATALOG).then(page => {
    if (page.items.some(row => row.owner !== "curated" || row.partial !== true)) throw Error("Invalid catalog response");
    // An edit invalidated an in-flight snapshot: its callers must also receive the new snapshot.
    if (cached !== entry) return loadLibrary();
    return freeze(page);
  }).catch(error => { if (cached === entry) cached = null; throw error; });
  return entry.value;
}
/** Continuations are always fresh, and remain curated-only. */
export const libraryMore = async (cursor: string): Promise<Page> => {
  const page = await fetchPage<Reference>(URL_CATALOG, cursor);
  if (page.items.some(row => row.owner !== "curated" || row.partial !== true)) throw Error("Invalid catalog response");
  return page;
};
