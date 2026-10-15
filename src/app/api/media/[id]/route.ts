import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { mediaInfo } from "@/lib/server/store";

/** Streams a stored file with Range support, so the browser can seek inside videos. */
export async function GET(request: Request, ctx: RouteContext<"/api/media/[id]">) {
  const { id } = await ctx.params;
  const info = await mediaInfo(id);
  if (!info) return new Response("Not found", { status: 404 });

  const range = request.headers.get("range");
  const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    }
    const stream = Readable.toWeb(createReadStream(info.file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        "Content-Type": info.mime,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(info.file)) as ReadableStream;
  return new Response(stream, {
    headers: { "Content-Type": info.mime, "Content-Length": String(info.size), "Accept-Ranges": "bytes" },
  });
}
