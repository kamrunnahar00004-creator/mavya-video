import { after } from "next/server";
import { cloud, extFor, isMediaId } from "@/lib/server/store";
import { startUpload, finishUpload, expireUploads } from "@/lib/server/uploads";
import { currentUser, signInFirst } from "@/lib/server/who";
export const maxDuration = 300;
export async function POST(request: Request) {
 if (!cloud()) return Response.json({ error: "Direct uploads need storage" }, { status: 501 });
 const who = await currentUser();
 if (!who) return signInFirst();
 const b = await request.json().catch(() => null) as { step?: unknown; mime?: unknown; size?: unknown; mediaId?: unknown; name?: unknown; asset?: unknown } | null;
 const mime = typeof b?.mime === "string" ? b.mime : "";
 if (!extFor(mime)) return Response.json({ error: "Unsupported file type." }, { status: 415 });
 after(async () => { try { await expireUploads(); } catch (error) { console.error("upload cleanup", error); } });
 try {
  if (b?.step === "start") {
   if (typeof b.size !== "number" || !Number.isSafeInteger(b.size) || b.size <= 0 || b.size > 300 * 1024 * 1024) return Response.json({ error: "File is over 300 MB." }, { status: 413 });
   return Response.json(await startUpload(who, mime, b.size));
  }
  if (b?.step === "finish" && typeof b.mediaId === "string" && isMediaId(b.mediaId)) return Response.json(await finishUpload(who, b.mediaId, mime, b.asset === true ? String(b.name ?? "Upload").slice(0,200) : null));
  return Response.json({ error: "Bad upload." }, { status: 400 });
 } catch (error) {
  console.error("upload", error);
  return Response.json({ error: "Upload failed or expired. Upload it again." }, { status: 409 });
 }
}
