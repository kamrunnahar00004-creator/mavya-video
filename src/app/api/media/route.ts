import { cloud, saveMedia } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

const MAX_BYTES = 300 * 1024 * 1024;

/**
 * Upload a file through the server (local mode, and small files). `asset=1` also lists it in My files.
 * In the cloud, the browser uploads straight to storage instead (POST /api/uploads); this stays for small files.
 */
export async function POST(request: Request) {
  const who = await currentUser();
  if (!who) return signInFirst();
  if (cloud() && Number(request.headers.get("content-length") ?? 0) > 4 * 1024 * 1024) {
    return Response.json({ error: "Upload large files directly" }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "File is over 300 MB" }, { status: 413 });
  try {
    return Response.json(await saveMedia(file, form?.get("asset") === "1", who));
  } catch {
    return Response.json({ error: "Use an MP4, MOV, WebM, JPG, PNG, MP3, M4A or WAV file" }, { status: 415 });
  }
}
