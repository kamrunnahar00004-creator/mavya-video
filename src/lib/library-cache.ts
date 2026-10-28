import { fetchPage } from "@/lib/list-client";
import type { Reference } from "@/lib/types";

/**
 * The hook library (curated + the user's own references), loaded once and shared by the video list, the Library page
 * and the video page for a minute, so opening a video never waits for the whole library again. Callers copy the
 * array before changing it.
 */
const URL_ALL = "/api/references?view=studio&all=1";
const FRESH_MS = 60_000;
let cached: { at: number; value: Promise<{ items: Reference[]; next: string | null }> } | null = null;

export function loadLibrary(): Promise<{ items: Reference[]; next: string | null }> {
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.value;
  const value = fetchPage<Reference>(URL_ALL);
  cached = { at: Date.now(), value };
  value.catch(() => { if (cached?.value === value) cached = null; });
  return value;
}

export const libraryMore = (cursor: string) => fetchPage<Reference>(URL_ALL, cursor);
