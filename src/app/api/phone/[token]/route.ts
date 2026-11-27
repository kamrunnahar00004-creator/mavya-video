import { after } from "next/server";
import { cloud, getRun, isMediaId, ownMedia } from "@/lib/server/store";
import { startUpload, finishUpload } from "@/lib/server/uploads";
import { requestPreview } from "@/lib/server/previews";
import { thumbLink } from "@/lib/server/thumbs";
import { addToInbox, mayUpload, readPhoneToken } from "@/lib/server/phone-link";

/**
 * Uploads from the phone page (/phone/<token>), signed in by the QR code's token instead of a session: the same two
 * steps as a computer upload (start: a link to put the file; finish: check and keep it), then "add" leaves it in the
 * video's inbox for the computer to place. The server makes the playback copies (the phone does not).
 */
export const maxDuration = 300;

export async function POST(request: Request, ctx: RouteContext<"/api/phone/[token]">) {
  const { token } = await ctx.params;
  const who = readPhoneToken(token);
  if (!who) return Response.json({ error: "This link expired. Scan the QR code again." }, { status: 401 });
  if (!cloud()) return Response.json({ error: "Direct uploads need storage" }, { status: 501 });
  if (!(await getRun(who.run, who.user))) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await mayUpload(who.user))) return Response.json({ error: "Choose a plan to upload." }, { status: 402 });
  const b = (await request.json().catch(() => null)) as { step?: unknown; mime?: unknown; size?: unknown; mediaId?: unknown; name?: unknown; seconds?: unknown; order?: unknown } | null;
  const mime = typeof b?.mime === "string" ? b.mime : "";
  try {
    if (b?.step === "start") {
      if (!mime.startsWith("video/")) return Response.json({ error: "Pick a video." }, { status: 415 });
      if (typeof b.size !== "number" || !Number.isSafeInteger(b.size) || b.size <= 0 || b.size > 300 * 1024 * 1024) return Response.json({ error: "This video is over 300 MB." }, { status: 413 });
      return Response.json(await startUpload(who.user, mime, b.size));
    }
    if (b?.step === "finish" && typeof b.mediaId === "string" && isMediaId(b.mediaId)) {
      if (!mime.startsWith("video/")) return Response.json({ error: "Pick a video." }, { status: 415 });
      const done = await finishUpload(who.user, b.mediaId, mime, String(b.name ?? "Phone video").slice(0, 200));
      after(() => requestPreview(done.mediaId));
      after(() => thumbLink(done.mediaId).then(() => undefined, (error) => console.error("phone thumb", error)));
      return Response.json(done);
    }
    if (b?.step === "add" && typeof b.mediaId === "string" && isMediaId(b.mediaId)) {
      const media = await ownMedia(b.mediaId, who.user);
      if (!media || !media.mime.startsWith("video/")) return Response.json({ error: "Not found" }, { status: 404 });
      const seconds = typeof b.seconds === "number" && Number.isFinite(b.seconds) && b.seconds > 0 && b.seconds < 3600 ? b.seconds : null;
      const order = typeof b.order === "number" && Number.isInteger(b.order) && b.order >= 0 && b.order < 1000 ? b.order : 0;
      if ((await addToInbox(who.run, order, b.mediaId, seconds)) === "full") return Response.json({ error: "Too many videos for now. Try again in an hour." }, { status: 429 });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Bad upload." }, { status: 400 });
  } catch (error) {
    console.error("phone upload", error);
    return Response.json({ error: "Upload failed. Try again." }, { status: 409 });
  }
}
