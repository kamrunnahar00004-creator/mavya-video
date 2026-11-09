import { NextResponse } from "next/server";
import { localMediaPath, mediaAccess } from "@/lib/server/store";
import { localThumb, thumbLink } from "@/lib/server/thumbs";
import { fileResponse } from "@/lib/server/file-response";
import { stat } from "node:fs/promises";
import { currentUser, signInFirst } from "@/lib/server/who";

/** A still picture of a stored video (src/lib/server/thumbs.ts); a picture is itself. Owner only, like the file. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  const info = await mediaAccess(id, who);
  if (!info) return new Response("Not found", { status: 404 });
  if (!info.mime.startsWith("video/")) return NextResponse.redirect(new URL(`/api/media/${id}`, _request.url), 302);
  // Local storage (development): made next to the file and sent from disk.
  const file = localMediaPath(id);
  if (file) {
    try { const out = await localThumb(file); return fileResponse(_request, out, (await stat(out)).size, "image/jpeg"); }
    catch { return new Response("Unavailable", { status: 503 }); }
  }
  try {
    const res = NextResponse.redirect(await thumbLink(id), 302);
    // The picture never changes: the browser keeps the redirect for a day (the link lasts a day).
    res.headers.set("Cache-Control", "private, max-age=82800, immutable");
    return res;
  } catch (error) {
    console.error("thumb", id, error);
    return new Response("Unavailable", { status: 503 });
  }
}
