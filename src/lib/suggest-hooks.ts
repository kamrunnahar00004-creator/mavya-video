import type { Reference } from "@/lib/types";

/**
 * Three hooks on the hook step (founder 2026-11-27): picked from the library's top hooks by views (ones with a full
 * shot breakdown), in an order set by the video's id, so each new video, and each user, gets a different three.
 * Clicking one opens it big with its numbers; "Use this hook" there picks it.
 */
export function suggestHooks(refs: Reference[], seed: string, n = 3): Reference[] {
  const pool = refs.filter((r) => (r.owner ?? "curated") === "curated" && r.views != null).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 24);
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  return pool.map((r) => ({ r, k: rnd() })).sort((a, b) => a.k - b.k).slice(0, n).map((x) => x.r);
}

