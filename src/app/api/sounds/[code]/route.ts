import { stat } from "node:fs/promises";
import path from "node:path";
import { fileResponse } from "@/lib/server/file-response";
import { sourceAudio } from "@/lib/server/source-audio";

const SOURCES_DIR = path.join(process.cwd(), ".data", "sources");

/** Audio-only cache for library sounds, with the source as a compatibility fallback. */
export async function GET(request: Request, ctx: RouteContext<"/api/sounds/[code]">) {
  const { code } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(code)) return new Response("Not found", { status: 404 });
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
