"use client";

import type { Reference, Run } from "@/lib/types";

/**
 * Video data this tab already asked for, so the video's page does not wait for another round trip (founder
 * 2026-11-06: speed for US customers):
 * - `create`: New video opens the page at once and creates the video in the background. The id comes from the
 *   browser and the server create is an idempotent upsert, so retrying the same id never makes a second video.
 * - `prefetch`: pointing at a video's card starts loading its editor data.
 * The page uses an entry once and drops it, also when it is left (forgetLoad). A prefetch expires 10 s after the hover
 * (whether or not it answered), stops after 4 s, and is dropped when the video is renamed or deleted (dropLoad); the
 * page waits for it at most 2 s before loading the usual way (Codex 2026-11-06: a stalled request held the editor, and
 * a rename after a hover opened the old title).
 */
export type Loaded = { run: Run; source: Reference | null };
export type Created = Loaded | { pricing: true } | { error: true; sourceRefId?: string };
export type Pending = { kind: "create"; job: Promise<Created> } | { kind: "prefetch"; job: Promise<Loaded | null> };

const pending = new Map<string, Pending>();

function keep(id: string, entry: Pending, ms: number) {
  pending.set(id, entry);
  setTimeout(() => { if (pending.get(id) === entry) pending.delete(id); }, ms);
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
  // The page normally takes it at once; the create itself gives up after 30 s.
  keep(id, { kind: "create", job }, 60_000);
  return job;
}

/** Starts loading video `id`'s editor data (a card is pointed at). Never replaces a create in flight. */
export function prefetchRun(id: string) {
  if (pending.has(id)) return;
  const job = fetch(`/api/runs/${id}?view=editor`, { cache: "no-store", signal: AbortSignal.timeout(4_000) })
    .then(async (res) => {
      if (!res.ok) return null;
      const loaded = (await res.json()) as Loaded;
      return loaded.run?.id === id ? loaded : null;
    })
    .catch(() => null);
  keep(id, { kind: "prefetch", job }, 10_000);
}

/** The prefetched data for `id` is out of date (it was renamed or deleted): the next visit loads it fresh. */
export function dropLoad(id: string) {
  if (pending.get(id)?.kind === "prefetch") pending.delete(id);
}

/** What this tab already asked for video `id`, if anything. Kept until the page that used it calls forgetLoad. */
export function peekLoad(id: string): Pending | undefined {
  return pending.get(id);
}

/** The page has used (or given up on) this entry: a later visit loads the video from the server as usual. */
export function forgetLoad(id: string, entry: Pending) {
  if (pending.get(id) === entry) pending.delete(id);
}

/** What the video's page does with its data: show it, go to pricing, or offer Try again (a failed create). */
export type PageLoad = { loaded: Loaded } | { pricing: true } | { createFailed: { sourceRefId?: string } };

/**
 * The video page's data: a create this tab started (New video), else a hover prefetch, which it waits for at most
 * 2 s before loading the usual way (Codex 2026-11-06: a stalled prefetch held the editor), else the usual load
 * (`fresh`). Entries are used once. Rejects "left" when the page is gone (`alive()` false), so it applies nothing.
 */
export function pageLoad(id: string, fresh: () => Promise<Loaded>, alive: () => boolean): Promise<PageLoad> {
  const known = peekLoad(id);
  if (known?.kind === "create") {
    return known.job.then((created): PageLoad => {
      forgetLoad(id, known);
      if (!alive()) throw Error("left");
      if ("run" in created) return { loaded: created };
      if ("pricing" in created) return { pricing: true };
      return { createFailed: { sourceRefId: created.sourceRefId } };
    });
  }
  if (known?.kind === "prefetch") {
    const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000));
    return Promise.race([known.job, late]).then(async (loaded): Promise<PageLoad> => {
      forgetLoad(id, known);
      if (!alive()) throw Error("left");
      return { loaded: loaded ?? (await fresh()) };
    });
  }
  return fresh().then((loaded) => ({ loaded }));
}

/** Rename or delete: data a hover loaded for this video is out of date, before the change and after it lands. */
export async function changeRun<T>(id: string, work: () => Promise<T>): Promise<T> {
  dropLoad(id);
  try {
    return await work();
  } finally {
    dropLoad(id);
  }
}
