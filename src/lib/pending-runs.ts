"use client";

import type { Reference, Run } from "@/lib/types";

/**
 * Video data this tab already asked for, so the video's page does not wait for another round trip (founder
 * 2026-11-06: speed for US customers):
 * - `create`: New video opens the page at once and creates the video in the background. The id comes from the
 *   browser and the server create is an idempotent upsert, so retrying the same id never makes a second video.
 * - `prefetch`: pointing at a video's card starts loading its editor data.
 * The page uses an entry once (forgetLoad); unused entries are forgotten (create after 60 s, prefetch after 15 s), so
 * a later visit loads fresh data.
 */
export type Loaded = { run: Run; source: Reference | null };
export type Created = Loaded | { pricing: true } | { error: true; sourceRefId?: string };
export type Pending = { kind: "create"; job: Promise<Created> } | { kind: "prefetch"; job: Promise<Loaded | null> };

const pending = new Map<string, Pending>();

function keep(id: string, entry: Pending, ms: number) {
  pending.set(id, entry);
  const job: Promise<unknown> = entry.job;
  void job.then(() => setTimeout(() => { if (pending.get(id) === entry) pending.delete(id); }, ms));
}

/** Starts creating video `id` (with hook `sourceRefId` when the seller picked one). */
export function startCreate(id: string, sourceRefId?: string): Promise<Created> {
  const job = fetch("/api/runs?view=editor", {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sourceRefId ? { id, sourceRefId } : { id }),
  })
    .then(async (res): Promise<Created> => {
      if (res.status === 402) return { pricing: true };
      if (!res.ok) return { error: true, sourceRefId };
      const created = (await res.json()) as Loaded;
      return created.run?.id === id ? created : { error: true, sourceRefId };
    })
    .catch((): Created => ({ error: true, sourceRefId }));
  keep(id, { kind: "create", job }, 60_000);
  return job;
}

/** Starts loading video `id`'s editor data (a card is pointed at). Never replaces a create in flight. */
export function prefetchRun(id: string) {
  if (pending.has(id)) return;
  const job = fetch(`/api/runs/${id}?view=editor`, { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;
      const loaded = (await res.json()) as Loaded;
      return loaded.run?.id === id ? loaded : null;
    })
    .catch(() => null);
  keep(id, { kind: "prefetch", job }, 15_000);
}

/** What this tab already asked for video `id`, if anything. Kept until the page that used it calls forgetLoad. */
export function peekLoad(id: string): Pending | undefined {
  return pending.get(id);
}

/** The page has used (or given up on) this entry: a later visit loads the video from the server as usual. */
export function forgetLoad(id: string, entry: Pending) {
  if (pending.get(id) === entry) pending.delete(id);
}
