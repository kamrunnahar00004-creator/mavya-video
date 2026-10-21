import { signedPut } from "@/lib/server/r2";
import { cloud, extFor, isMediaId, newUpload, registerMedia, uploadedSize } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

/**
 * Direct uploads to storage (cloud only; the server never carries the file, so large demo videos work).
 * {step: "start", mime, size} -> {mediaId, url}: the browser PUTs the file to `url` with that Content-Type.
 * {step: "finish", mediaId, mime, name, asset} -> {mediaId, mime}: checks it arrived and records it (My files if asset).
 * Local mode answers 501 and the browser uses POST /api/media.
 */
const MAX_BYTES = 300 * 1024 * 1024;

export async function POST(request: Request) {
  if (!cloud()) return Response.json({ error: "Direct uploads need storage" }, { status: 501 });
  const who = await currentUser();
  if (!who) return signInFirst();
  const body = (await request.json().catch(() => null)) as { step?: unknown; mime?: unknown; size?: unknown; mediaId?: unknown; name?: unknown; asset?: unknown } | null;
  const mime = typeof body?.mime === "string" ? body.mime : "";
  if (!extFor(mime)) return Response.json({ error: "Use an MP4, MOV, WebM, JPG, PNG, MP3, M4A or WAV file" }, { status: 415 });

  if (body?.step === "start") {
    const size = typeof body.size === "number" ? body.size : 0;
    if (size <= 0 || size > MAX_BYTES) return Response.json({ error: "File is over 300 MB" }, { status: 413 });
    const { mediaId, key } = newUpload(mime);
    return Response.json({ mediaId, url: await signedPut(key, mime) });
  }
  if (body?.step === "finish") {
    const mediaId = typeof body.mediaId === "string" ? body.mediaId : "";
    if (!isMediaId(mediaId) || mediaId.split(".").pop() !== extFor(mime)) return Response.json({ error: "Bad upload" }, { status: 400 });
    const size = await uploadedSize(mediaId);
    if (!size) return Response.json({ error: "The upload did not arrive. Try again." }, { status: 400 });
    if (size > MAX_BYTES) return Response.json({ error: "File is over 300 MB" }, { status: 413 });
    const name = typeof body.name === "string" ? body.name : "Upload";
    await registerMedia(mediaId, mime, size, who, body.asset === true ? name : null);
    return Response.json({ mediaId, mime });
  }
  return Response.json({ error: "Bad request" }, { status: 400 });
}
