import { mediaInfo } from "@/lib/server/store";
import { fileResponse } from "@/lib/server/file-response";

/** Streams a stored file with Range support for media seeking. */
export async function GET(request: Request, ctx: RouteContext<"/api/media/[id]">) {
  const { id } = await ctx.params;
  const info = await mediaInfo(id);
  if (!info) return new Response("Not found", { status: 404 });
  return fileResponse(request, info.file, info.size, info.mime);
}
