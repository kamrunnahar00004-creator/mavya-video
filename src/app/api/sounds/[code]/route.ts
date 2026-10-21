import { stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { fileResponse } from "@/lib/server/file-response";
import { sourceAudio } from "@/lib/server/source-audio";
import { cloud, libraryLink } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

const SOURCES_DIR = path.join(process.cwd(), ".data", "sources");

/**
 * A library hook's own sound. Cloud: the audio was extracted ahead of time (scripts/upload-library.mjs) and this
 * redirects to a short-lived storage link. Local: extracted once from the full video and cached, with the video itself
 * as the fallback for files without a usable audio track.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/sounds/[code]">) {
  const { code } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(code)) return new Response("Not found", { status: 404 });
  if (!(await currentUser())) return signInFirst();
  if (cloud()) {
    const res = NextResponse.redirect(await libraryLink("audio", code), 302);
    res.headers.set("Cache-Control", "private, max-age=1800");
    return res;
  }
  const source = path.join(SOURCES_DIR, `${code}.mp4`);
  let file = source;
  let info;
  try { info = await stat(source); }
  catch { return new Response("Not found", { status: 404 }); }
  let mime = "video/mp4";
  try {
    file = await sourceAudio(code, file, `${Math.floor(info.mtimeMs)}-${info.size}`);
    info = await stat(/* turbopackIgnore: true */ file);
    mime = "audio/mp4";
  } catch { /* Old files without a usable audio track can still be opened. */ }
  return fileResponse(request, file, info.size, mime);
}
