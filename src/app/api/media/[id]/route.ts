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
  if (file) return fileResponse(request, file, info.size, info.mime);
  const res = NextResponse.redirect(await mediaLink(id), 302);
  // The link is good for an hour; let the browser reuse the redirect for a while.
  res.headers.set("Cache-Control", "private, max-age=1800");
  return res;
}
