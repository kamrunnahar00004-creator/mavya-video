import { fetchPage } from "@/lib/list-client";
import type { Reference } from "@/lib/types";

/** No account data survives in a module cache. Every mount reads the current authenticated API.
 * Continuation remains available beyond the all=1 per-request bound.
 */
const URL_ALL = "/api/references?view=studio&all=1";
export const loadLibrary = () => fetchPage<Reference>(URL_ALL);
export const libraryMore = (cursor: string) => fetchPage<Reference>(URL_ALL, cursor);
