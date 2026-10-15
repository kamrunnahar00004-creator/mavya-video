import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const SOURCES_DIR = path.join(process.cwd(), ".data", "sources");

/** Streams a library video's file so its sound can play (an <audio> element plays the mp4's audio track). Range support for seeking. */
export async function GET(request: Request, ctx: RouteContext<"/api/sounds/[code]">) {
  const { code } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(code)) return new Response("Not found", { status: 404 });
  const file = path.join(SOURCES_DIR, `${code}.mp4`);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const range = request.headers.get("range");
  const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { "Content-Type": "video/mp4", "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" },
    });
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Accept-Ranges": "bytes" } });
}
