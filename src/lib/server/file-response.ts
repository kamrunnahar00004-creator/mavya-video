import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

/** A single byte range, including suffix ranges used by media clients. */
export function fileResponse(request: Request, file: string, size: number, mime: string) {
  const headers = { "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const invalid = () => new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    if (!match || (!match[1] && !match[2])) return invalid();
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return invalid();
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206, headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
    });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
}
