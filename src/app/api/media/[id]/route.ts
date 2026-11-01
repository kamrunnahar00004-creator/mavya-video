import { NextResponse } from "next/server";
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
  if (params.has("link")) return Response.json({ url: file ? `/api/media/${id}` : await mediaLink(id, 1800) }, { headers: { "Cache-Control": "no-store" } });
  if (file) return fileResponse(request, file, info.size, info.mime);
  // ?download=<name>: the link saves the file (the export's Download button).
  const download = params.get("download");
  const res = NextResponse.redirect(await mediaLink(id, undefined, download ? `${download.slice(0, 80)}.${id.split(".").pop()}` : undefined), 302);
  // The link is good for an hour; let the browser reuse the redirect for a while.
  res.headers.set("Cache-Control", download ? "no-store" : "private, max-age=1800");
  return res;
}
