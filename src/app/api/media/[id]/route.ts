import { NextResponse, after } from "next/server";
import { masterReady, previewKey, previewReady, requestPreview } from "@/lib/server/previews";
import { signedGet } from "@/lib/server/r2";
import { fileResponse } from "@/lib/server/file-response";
import { localMediaPath, mediaAccess, mediaLink } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

/**
 * A stored file: only its owner (or anyone, for shared library media) may open it.
 * Local: streamed from disk with Range support. Cloud: a redirect to a short-lived R2 link (R2 handles ranges).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/media/[id]">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  const info = await mediaAccess(id, who);
  if (!info) return new Response("Not found", { status: 404 });
  const file = localMediaPath(id);
  const params = new URL(request.url).searchParams;
  // ?link=1: a storage link for reading pixels (crossOrigin). It must differ from the players' link: storage sends no
  // "Vary: Origin", so the browser would reuse their cached non-CORS copy and the read fails. A lifetime other than
  // the default skips the shared link cache, so each one is signed afresh.
  // ?preview=1: the light copy of an uploaded video when it exists (src/lib/server/previews.ts), else the original.
  const preview = params.has("preview") && !file && info.mime.startsWith("video/") && (await previewReady(id));
  if (params.has("link")) return Response.json({ url: file ? `/api/media/${id}` : preview ? await signedGet(previewKey(id), 1800) : await mediaLink(id, 1800) }, { headers: { "Cache-Control": "no-store" } });
  if (file) return fileResponse(request, file, info.size, info.mime);
  if (params.has("preview") && info.mime.startsWith("video/")) {
    if (preview) {
      // Older uploads have a preview but no export copy yet: make it now, so the next export is fast.
      after(async () => { if (!(await masterReady(id))) await requestPreview(id); });
      const res = NextResponse.redirect(await signedGet(previewKey(id)), 302);
      res.headers.set("Cache-Control", "private, max-age=1800");
      return res;
    }
    // No copy yet: ask for one and play the original meanwhile (not remembered, so the copy is used once it lands).
    after(() => requestPreview(id));
    const res = NextResponse.redirect(await mediaLink(id), 302);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
  // ?download=<name>: the link saves the file (the export's Download button).
  const download = params.get("download");
  const res = NextResponse.redirect(await mediaLink(id, undefined, download ? `${download.slice(0, 80)}.${id.split(".").pop()}` : undefined), 302);
  // The link is good for an hour; let the browser reuse the redirect for a while.
  res.headers.set("Cache-Control", download ? "no-store" : "private, max-age=1800");
  return res;
}
