import "server-only";
/** Bound both time and decompressed streamed bytes, including responses without Content-Length. */
export async function boundedFetch(url: string, options: RequestInit & { next?: { revalidate: number } } = {}, cap = 1_000_000, ms = 10_000) {
 const deadline = AbortSignal.timeout(ms);
 const response = await fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline });
 const reader = response.body?.getReader();
 if (!reader) throw new Error("Empty response");
 const chunks: Uint8Array[] = []; let size = 0;
 try {
  while (true) {
   const next = await reader.read();
   if (next.done) break;
   size += next.value.byteLength;
   if (size > cap) { await reader.cancel(); throw new Error("Response too large"); }
   chunks.push(next.value);
  }
 } finally { reader.releaseLock(); }
 return new Response(Buffer.concat(chunks), { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream" } });
}
