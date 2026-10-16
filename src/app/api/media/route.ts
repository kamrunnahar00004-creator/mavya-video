import { saveMedia } from "@/lib/server/store";

const MAX_BYTES = 300 * 1024 * 1024;

/** Upload a file. `asset=1` also lists it in the Library panel (clips, recordings, photos). */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "File is over 300 MB" }, { status: 413 });
  try {
    return Response.json(await saveMedia(file, form?.get("asset") === "1"));
  } catch {
    return Response.json({ error: "Use an MP4, MOV, WebM, JPG, PNG, MP3, M4A or WAV file" }, { status: 415 });
  }
}
