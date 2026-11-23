import "server-only";
import { copyObject, deleteObject, deleteObjectStrict, objectInfo, objectStart, putObject, signedGet, signedPut } from "@/lib/server/r2";

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

/**
 * Copies made in the uploader's browser (founder 2026-11-23: a 4K clip waited 11-15 minutes for the server's copies on
 * its half CPU). While the browser makes them, this marker tells requestPreview to stay out of the way; the server copy
 * is the fallback: when the browser cannot (HDR, no HEVC decoding, no encoder, a failure) it asks for it, and a browser
 * that went away (closed tab) is forgotten after BROWSER_COPY_MS.
 */
export const copyingKey = (id: string) => `media/${id.replace(/\.[^.]+$/, "")}.copying`;
/** A 2-minute clip takes the browser about 1.5 minutes plus the upload; past this, the server takes over (Codex). */
export const BROWSER_COPY_MS = 6 * 60_000;
export const claimBrowserCopy = (id: string) => putObject(copyingKey(id), Buffer.from(String(Date.now())), "text/plain");
export const releaseBrowserCopy = (id: string) => deleteObject(copyingKey(id));
/** For the fallback: a marker that cannot be removed must not keep the server away (requestPreview's force). */
export const releaseBrowserCopyStrict = (id: string) => deleteObjectStrict(copyingKey(id));
/** Whether the uploader's browser is still making this video's copies. */
export async function browserCopying(id: string, now = Date.now()): Promise<boolean> {
  const marker = await objectInfo(copyingKey(id)).catch(() => null);
  return Boolean(marker && marker.modified !== undefined && now - marker.modified < BROWSER_COPY_MS);
}
/**
 * The browser uploads its copies to staging keys of their own (one attempt each), never straight over the copies the
 * editor and export read (Codex 2026-11-23); publishCopies checks them and puts them in place. Staging files are
 * temporary objects: removed after a day, and with the account.
 */
const stagedKey = (id: string, attempt: string, kind: "p480" | "v1080") => `tmp/copies/${id.replace(/\.[^.]+$/, "")}.${attempt}.${kind}.mp4`;
export const isAttempt = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x);
/** Where the browser uploads its two copies (exact sizes, 15 minutes), and the attempt id that names them. */
export async function copyUploadLinks(id: string, who: string, previewSize: number, masterSize: number) {
  const attempt = crypto.randomUUID();
  const keys = [stagedKey(id, attempt, "p480"), stagedKey(id, attempt, "v1080")];
  // Loaded here only: everything else in this file needs no database.
  const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
  const { error } = await createSupabaseAdminClient().from("temporary_objects").insert(keys.map((key) => ({ key, user_id: who })));
  if (error) throw error;
  return { attempt, preview: await signedPut(keys[0], "video/mp4", 900, previewSize), master: await signedPut(keys[1], "video/mp4", 900, masterSize) };
}
/** A staged copy that is a real MP4 of the size it was signed for. */
async function validStaged(key: string): Promise<{ etag: string } | null> {
  const info = await objectInfo(key).catch(() => null);
  if (!info?.size || info.mime !== "video/mp4") return null;
  const head = await objectStart(key, 12, info.etag).catch(() => null);
  return head && head.length === 12 && String.fromCharCode(...head.slice(4, 8)) === "ftyp" ? { etag: info.etag } : null;
}
/**
 * Puts a checked pair in place: the preview first, the master (what the export waits for) last, so a ready master
 * means a ready pair. A copy already in place (the server made it) is never replaced. False when the pair is not good.
 */
export async function publishCopies(id: string, attempt: string): Promise<boolean> {
  const p = stagedKey(id, attempt, "p480"), m = stagedKey(id, attempt, "v1080");
  // Already in place (a repeated request): done.
  if ((await objectInfo(previewKey(id))) && (await objectInfo(masterKey(id)))) return true;
  // Only while this browser's claim is live: once it lapsed the server is the one making them, and two writers could
  // leave a mixed pair (Codex 2026-11-23).
  if (!(await browserCopying(id))) return false;
  const [vp, vm] = await Promise.all([validStaged(p), validStaged(m)]);
  try {
    if (!vp || !vm) return false;
    if (!(await objectInfo(previewKey(id)))) await copyObject(p, previewKey(id), vp.etag);
    if (!(await objectInfo(masterKey(id)))) await copyObject(m, masterKey(id), vm.etag);
    ready.delete(previewKey(id));
    ready.delete(masterKey(id));
    return true;
  } finally {
    await Promise.all([deleteObject(p), deleteObject(m)]);
  }
}


const ready = new Map<string, number>();
const checking = new Map<string, Promise<boolean>>();
/** Whether this copy exists (a found copy is remembered; a missing one is checked again after a short while). */
async function exists(key: string): Promise<boolean> {
  const until = ready.get(key);
  if (until !== undefined && until > Date.now()) return until === Infinity;
  // Checks for the same copy at the same moment share one storage request (Codex 2026-11-06).
  const running = checking.get(key);
  if (running) return running;
  const check = look(key).finally(() => checking.delete(key));
  checking.set(key, check);
  return check;
}
async function look(key: string): Promise<boolean> {
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
export async function requestPreview(id: string, force = false): Promise<void> {
  try {
    const base = process.env.RENDER_URL?.replace(/\/+$/, "");
    if (!base || !process.env.RENDER_SECRET || !/^[0-9a-f-]{36}\.(mp4|mov|webm|m4v)$/i.test(id)) return;
    // A forced request (the fallback) is never dropped as a repeat (Codex 2026-11-23).
    if (!force && (asked.get(id) ?? 0) > Date.now()) return;
    if (asked.size > 5000) asked.clear();
    asked.set(id, Date.now() + 10 * 60_000);
    const original = await objectInfo(`media/${id}`);
    // Every video gets its copies, small ones too: an HDR clip must never reach the export unconverted (render.mjs
    // TONEMAP; Codex 2026-11-05).
    if (!original || ((await previewReady(id)) && (await masterReady(id)))) return;
    // The uploader's browser is making them: ask again later (not remembered as asked), never twice at once.
    if (!force && (await browserCopying(id))) { asked.delete(id); return; }
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
