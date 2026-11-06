import "server-only";
import { objectInfo, signedGet, signedPut } from "@/lib/server/r2";

/**
 * Preview copies of uploaded videos: a light 480p version the editor and phone preview play (render/server.mjs
 * makePreview). Phone recordings are often 4K at ~46 Mbps; playing those in a 250px preview stalls. The export reads the
 * working copy below. A copy belongs to its original: the same media access opens it, and account deletion removes it.
 */
export const previewKey = (id: string) => `media/${id.replace(/\.[^.]+$/, "")}.p480.mp4`;
/** The first copies (720p, 2026-11-03), still removed with the account. */
export const oldPreviewKey = (id: string) => `media/${id.replace(/\.[^.]+$/, "")}.preview.mp4`;
/**
 * The export's working copy (short side 1080), made in the same pass: a 720x1280 export reads it instead of a 4K
 * original, a quarter of the pixels to decode on the small render server (founder 2026-11-03: no paid upgrade).
 */
export const masterKey = (id: string) => `media/${id.replace(/\.[^.]+$/, "")}.v1080.mp4`;
/** The first working copies (short side 1080, not cut to the frame), still removed with the account. */
export const oldMasterKey = (id: string) => `media/${id.replace(/\.[^.]+$/, "")}.m1080.mp4`;


const ready = new Map<string, number>();
/** Whether this copy exists (a found copy is remembered; a missing one is checked again after a short while). */
async function exists(key: string): Promise<boolean> {
  const until = ready.get(key);
  if (until !== undefined && until > Date.now()) return until === Infinity;
  const found = Boolean(await objectInfo(key).catch(() => null));
  if (ready.size > 5000) ready.clear();
  // A missing copy is checked again after 2 s (was 20 s): a copy finished just after a check shows up at once (Codex
  // 2026-11-06). The check is one storage HEAD request.
  ready.set(key, found ? Infinity : Date.now() + 2_000);
  return found;
}
export const previewReady = (id: string) => exists(previewKey(id));
export const masterReady = (id: string) => exists(masterKey(id));

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
    // Every video gets its copies, small ones too: an HDR clip must never reach the export unconverted (render.mjs
    // TONEMAP; Codex 2026-11-05).
    if (!original || ((await previewReady(id)) && (await masterReady(id)))) return;
    const res = await fetch(`${base}/previews`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RENDER_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({
        id, input: await signedGet(`media/${id}`, 3500),
        output: { url: await signedPut(previewKey(id), "video/mp4", 3600), contentType: "video/mp4" },
        master: { url: await signedPut(masterKey(id), "video/mp4", 3600), contentType: "video/mp4" },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`preview request ${res.status}`);
  } catch (error) {
    asked.delete(id);
    console.error("preview", id, error);
  }
}

/**
 * The export's source for an uploaded clip: the working copy when it is ready, else "wait" (and the copy is asked for
 * again). Never the original: the browser shows an HDR original flat and washed out (measured in Chrome 2026-11-05)
 * and only the copy is known to be SDR, so during a render server outage exports wait rather than risk it (Codex
 * 2026-11-05).
 */
export async function exportSource(id: string): Promise<"copy" | "wait"> {
  if (await masterReady(id)) return "copy";
  await requestPreview(id);
  return "wait";
}
