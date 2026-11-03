import "server-only";
import { objectInfo, signedGet, signedPut } from "@/lib/server/r2";

/**
 * Preview copies of uploaded videos: a light 480p version the editor and phone preview play (render/server.mjs
 * makePreview). Phone recordings are often 4K at ~46 Mbps; playing those in a 250px preview stalls. The export always
 * reads the original. A copy belongs to its original: the same media access opens it, and account deletion removes it.
 */
export const previewKey = (id: string) => `media/${id.replace(/\.[^.]+$/, "")}.preview.mp4`;

/** Below this the original plays fine as it is. */
const SMALL = 3 * 1024 * 1024;

const ready = new Map<string, number>();
/** Whether the copy exists (a found copy is remembered; a missing one is checked again after a short while). */
export async function previewReady(id: string): Promise<boolean> {
  const until = ready.get(id);
  if (until !== undefined && until > Date.now()) return until === Infinity;
  const found = Boolean(await objectInfo(previewKey(id)).catch(() => null));
  if (ready.size > 5000) ready.clear();
  ready.set(id, found ? Infinity : Date.now() + 20_000);
  return found;
}

const asked = new Map<string, number>();
/** Asks the render server for the copy. Never throws: without a copy the original plays. */
export async function requestPreview(id: string): Promise<void> {
  try {
    const base = process.env.RENDER_URL?.replace(/\/+$/, "");
    if (!base || !process.env.RENDER_SECRET || !/^[0-9a-f-]{36}\.(mp4|mov|webm|m4v)$/i.test(id)) return;
    if ((asked.get(id) ?? 0) > Date.now()) return;
    if (asked.size > 5000) asked.clear();
    asked.set(id, Date.now() + 10 * 60_000);
    const original = await objectInfo(`media/${id}`);
    if (!original || original.size < SMALL || (await previewReady(id))) return;
    const res = await fetch(`${base}/previews`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RENDER_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ id, input: await signedGet(`media/${id}`, 3500), output: { url: await signedPut(previewKey(id), "video/mp4", 3600), contentType: "video/mp4" } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`preview request ${res.status}`);
  } catch (error) {
    asked.delete(id);
    console.error("preview", id, error);
  }
}
