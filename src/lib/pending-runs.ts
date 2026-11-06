"use client";

import type { Reference, Run } from "@/lib/types";

/**
 * Videos being created right now. New video opens the video's page at once and creates it on the server in the
 * background; the page takes the result from here instead of waiting for the create and then loading the video again
 * (founder 2026-11-06: one round trip less, US customers first). The id comes from the browser and the server create is
 * an idempotent upsert, so retrying the same id never makes a second video.
 */
export type Created = { run: Run; source: Reference | null } | { pricing: true } | { error: true; sourceRefId?: string };

const pending = new Map<string, Promise<Created>>();

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
      const created = (await res.json()) as { run: Run; source: Reference | null };
      return created.run?.id === id ? created : { error: true, sourceRefId };
    })
    .catch((): Created => ({ error: true, sourceRefId }));
  pending.set(id, job);
  // Forgotten by the page that used it, or after a minute if no page did (the seller left).
  void job.then(() => setTimeout(() => { if (pending.get(id) === job) pending.delete(id); }, 60_000));
  return job;
}

/** The create in flight for `id`, if this tab started one. Kept until the page that used it calls forgetCreate. */
export function peekCreate(id: string): Promise<Created> | undefined {
  return pending.get(id);
}

/** The page has used (or given up on) this create: a later visit loads the video from the server as usual. */
export function forgetCreate(id: string, job: Promise<Created>) {
  if (pending.get(id) === job) pending.delete(id);
}
