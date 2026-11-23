import { after } from "next/server";
import { cloud, extFor, isMediaId, ownMedia } from "@/lib/server/store";
import { startUpload, finishUpload, expireUploads } from "@/lib/server/uploads";
import { currentUser, signInFirst } from "@/lib/server/who";
import { browserCopying, claimBrowserCopy, copyUploadLinks, isAttempt, masterReady, previewReady, publishCopies, releaseBrowserCopy, releaseBrowserCopyStrict, requestPreview } from "@/lib/server/previews";

/** Largest copies the browser may upload, by the original's size (a 2-minute clip at 10 Mbps is ~150 MB). */
const MB = 1024 * 1024;
const maxCopies = (original: number) => ({ preview: Math.min(100 * MB, original + 20 * MB), master: Math.min(400 * MB, 3 * original + 50 * MB) });
import { thumbLink } from "@/lib/server/thumbs";
export const maxDuration = 300;
export async function POST(request: Request) {
 if (!cloud()) return Response.json({ error: "Direct uploads need storage" }, { status: 501 });
 const who = await currentUser();
 if (!who) return signInFirst();
 const b = await request.json().catch(() => null) as { step?: unknown; mime?: unknown; size?: unknown; mediaId?: unknown; name?: unknown; asset?: unknown; purpose?: unknown; copies?: unknown; previewSize?: unknown; masterSize?: unknown; attempt?: unknown } | null;
 const mime = typeof b?.mime === "string" ? b.mime : "";
 if (!extFor(mime)) return Response.json({ error: "Unsupported file type." }, { status: 415 });
 after(async () => { try { await expireUploads(); } catch (error) { console.error("upload cleanup", error); } });
 try {
  if (b?.step === "start") {
   if (typeof b.size !== "number" || !Number.isSafeInteger(b.size) || b.size <= 0 || b.size > 300 * 1024 * 1024) return Response.json({ error: "File is over 300 MB." }, { status: 413 });
   if (b.purpose === "export-text" && (mime !== "image/png" || b.size > 3_000_000)) return Response.json({ error: "Text image is too large." }, { status: 413 });
   return Response.json(await startUpload(who, mime, b.size, b.purpose === "export-text"));
  }
  if (b?.step === "finish" && typeof b.mediaId === "string" && isMediaId(b.mediaId)) {
   const done = await finishUpload(who, b.mediaId, mime, b.asset === true ? String(b.name ?? "Upload").slice(0,200) : null);
   // A video gets its copies straight away, so the editor plays smoothly from the start: from the uploader's browser
   // when it is making them (previews.ts claimBrowserCopy), else from the render server.
   if (mime.startsWith("video/")) {
    if (b.copies === "browser") await claimBrowserCopy(done.mediaId).catch((error) => { console.error("copy claim", error); after(() => requestPreview(done.mediaId)); });
    else after(() => requestPreview(done.mediaId));
   }
   // And its still picture for lists (My files), so it is ready the first time they open.
   if (mime.startsWith("video/")) after(() => thumbLink(done.mediaId).then(() => undefined, (error) => console.error("upload thumb", error)));
   return Response.json(done);
  }
  // The browser's copies of the user's own video (founder 2026-11-23): links to upload them, then a check that both
  // arrived. Any failure on the way asks the render server instead ("server-copy").
  if ((b?.step === "copies" || b?.step === "copies-done" || b?.step === "server-copy") && typeof b.mediaId === "string" && isMediaId(b.mediaId)) {
   const own = await ownMedia(b.mediaId, who);
   if (!own || !own.mime.startsWith("video/")) return Response.json({ error: "Not found" }, { status: 404 });
   const id = b.mediaId;
   if (b.step === "server-copy") {
    // Forced: even when the marker cannot be removed, the server makes the copies (Codex 2026-11-23).
    await releaseBrowserCopyStrict(id).catch((error) => console.error("copy release", error));
    after(() => requestPreview(id, true));
    return Response.json({ ok: true });
   }
   if (b.step === "copies") {
    if ((await previewReady(id)) && (await masterReady(id))) return Response.json({ ready: true });
    // Only while this browser's claim is live: after it lapsed, the server is the one making them.
    if (!(await browserCopying(id))) return Response.json({ error: "The server makes the copies." }, { status: 409 });
    const cap = maxCopies(own.size);
    const [ps, ms] = [b.previewSize, b.masterSize];
    if (typeof ps !== "number" || typeof ms !== "number" || !Number.isSafeInteger(ps) || !Number.isSafeInteger(ms) || ps <= 0 || ms <= 0 || ps > cap.preview || ms > cap.master) return Response.json({ error: "Bad copy size." }, { status: 413 });
    return Response.json(await copyUploadLinks(id, who, ps, ms));
   }
   // copies-done: check the staged pair and put it in place, else the server makes them.
   const published = isAttempt(b.attempt) && (await publishCopies(id, b.attempt).catch((error) => { console.error("copy publish", error); return false; }));
   await releaseBrowserCopy(id);
   if (!published) {
    after(() => requestPreview(id, true));
    return Response.json({ error: "Copies missing. The server makes them." }, { status: 409 });
   }
   return Response.json({ ok: true });
  }
  return Response.json({ error: "Bad upload." }, { status: 400 });
 } catch (error) {
  console.error("upload", error);
  return Response.json({ error: "Upload failed or expired. Upload it again." }, { status: 409 });
 }
}
