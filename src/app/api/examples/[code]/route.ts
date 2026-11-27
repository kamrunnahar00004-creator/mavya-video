import { stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { fileResponse } from "@/lib/server/file-response";
import { cloud, libraryLink } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

const SOURCES_DIR = path.join(process.cwd(), ".data", "sources");

/**
 * A library reel's full video, for the "Like this" example beside each demo shot (founder 2026-11-27): the page plays
 * only the shot's moment (start to end). Cloud: a short-lived storage link. Local: the file itself.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/examples/[code]">) {
  const { code } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(code)) return new Response("Not found", { status: 404 });
  if (!(await currentUser())) return signInFirst();
  if (cloud()) {
    const res = NextResponse.redirect(await libraryLink("sources", code), 302);
    res.headers.set("Cache-Control", "private, max-age=1800");
    return res;
  }
  const file = path.join(SOURCES_DIR, `${code}.mp4`);
  try {
    const info = await stat(/* turbopackIgnore: true */ file);
    return fileResponse(request, file, info.size, "video/mp4");
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
